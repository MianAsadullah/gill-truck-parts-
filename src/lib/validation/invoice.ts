import { z } from "zod";

/**
 * Invoice validation (SAL).
 *
 * One schema, two consumers: React Hook Form resolves it in the browser for
 * instant field errors, and the server action parses the submitted payload
 * with the same schema before it touches the database. The server parse is
 * not a formality — a client can post anything.
 *
 * DESIGN NOTE — why no `z.coerce` and no `.default()` here
 * --------------------------------------------------------
 * Both make a schema's *input* type diverge from its *output* type
 * (`.default()` makes the field optional on input; `z.coerce.date()` claims
 * to accept a Date). React Hook Form is generic over one field-values type,
 * so a divergent schema forces casts at every `register`, `setValue` and
 * `getValues` call — and casts are exactly where type safety quietly stops
 * protecting a money form.
 *
 * Instead this schema describes the shape the DOM actually produces: dates
 * are "YYYY-MM-DD" strings (what `<input type="date">` gives) and money is
 * already a number (the form registers those inputs with `setValueAs`).
 * Input and output are identical, so `InvoiceFormValues` is the single type
 * used by the form, the action signature and the action body. The action
 * converts the date strings to `Date` once, after validation.
 *
 * Also deliberately NOT here: pricing legality. Whether a rate is below a
 * part's minimum depends on that part's current minimumPrice, which only the
 * server can be trusted to read. Zod enforces shape; pricing.ts enforces
 * policy.
 */

const ITEM_TYPES = ["INVENTORY", "NON_INVENTORY", "SERVICE", "OTHER_CHARGE"] as const;

/** ISO calendar date, as produced by <input type="date">. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date (YYYY-MM-DD)")
  .refine((s) => !Number.isNaN(new Date(s + "T00:00:00").getTime()), {
    message: "That date does not exist",
  });

/** An optional date field: either an ISO date, or "" / null when cleared. */
const isoDateOrEmpty = z.union([isoDate, z.literal(""), z.null()]);

/** Convert a validated form date into a Date at local midnight. */
export function parseFormDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value + "T00:00:00");
  return Number.isNaN(date.getTime()) ? null : date;
}

export const priceOverrideRequestSchema = z.object({
  /** Employee code of the approving manager, e.g. "MG". */
  approverCode: z
    .string()
    .trim()
    .min(1, "Approver initials are required")
    .max(12),
  /** The manager's override code. Never logged in plaintext. */
  overrideCode: z.string().trim().min(4, "Override code is required").max(32),
  reason: z
    .string()
    .trim()
    .min(4, "Enter a reason (at least 4 characters)")
    .max(280, "Keep the reason under 280 characters"),
});

export type PriceOverrideRequest = z.infer<typeof priceOverrideRequestSchema>;

export const invoiceLineSchema = z
  .object({
    /** Stable key for the form's field array; not persisted. */
    key: z.string(),
    lineNo: z.number().int().positive(),

    /** Null for a manual labor / service / misc line. */
    productId: z.string().nullable(),
    isManual: z.boolean(),
    itemType: z.enum(ITEM_TYPES),

    sku: z.string().max(40).nullable(),
    description: z
      .string()
      .trim()
      .min(1, "Description is required")
      .max(300, "Description is too long"),

    quantity: z
      .number({ invalid_type_error: "Qty must be a number" })
      .finite("Qty must be a number")
      .refine((v) => v !== 0, "Qty cannot be zero")
      .refine((v) => Math.abs(v) <= 1_000_000, "Qty is unreasonably large"),

    unitOfMeasure: z.string().trim().max(12),

    rate: z
      .number({ invalid_type_error: "Rate must be a number" })
      .finite("Rate must be a number")
      .min(0, "Rate cannot be negative")
      .max(1_000_000, "Rate is unreasonably large"),

    isTaxable: z.boolean(),

    /** Present only when this line is priced below the part's minimum. */
    override: priceOverrideRequestSchema.nullable(),
  })
  .superRefine((line, ctx) => {
    // An inventory line must name a real part — that is what makes it
    // deduct stock. A manual line must not.
    if (!line.isManual && !line.productId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["productId"],
        message: "Select an item, or mark the line as manual labor/service.",
      });
    }
    if (line.isManual && line.productId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["productId"],
        message: "A manual line cannot reference an inventory item.",
      });
    }
    // Manual lines are service-priced by the writer; they never carry an
    // INVENTORY type, because that is the flag the stock engine reads.
    if (line.isManual && line.itemType === "INVENTORY") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["itemType"],
        message: "Manual lines must be Service, Non-Inventory or Other Charge.",
      });
    }
  });

export type InvoiceLineValues = z.infer<typeof invoiceLineSchema>;

export const invoiceFormSchema = z
  .object({
    /** Set when editing; empty when creating. */
    id: z.string().nullable(),

    customerId: z.string().min(1, "Select a customer"),
    vehicleId: z.string().nullable(),

    /** Free text so a walk-in plate can be typed without a vehicle record. */
    licensePlate: z.string().trim().max(20).nullable(),

    invoiceDate: isoDate,
    serviceDate: isoDateOrEmpty,
    dueDate: isoDateOrEmpty,

    termsId: z.string().nullable(),
    repId: z.string().nullable(),
    taxCodeId: z.string().nullable(),
    poNumber: z.string().trim().max(40).nullable(),

    memo: z.string().trim().max(500).nullable(),
    customerMessage: z.string().trim().max(500).nullable(),

    lines: z.array(invoiceLineSchema).min(1, "Add at least one line before saving"),

    /** false keeps the invoice out of the GL as a draft. */
    postToLedger: z.boolean(),
  })
  .superRefine((invoice, ctx) => {
    // Line numbers must be unique — they are half of the InvoiceLine
    // composite key, so a duplicate would otherwise fail deep inside the
    // transaction with an opaque constraint error.
    const seen = new Set<number>();
    invoice.lines.forEach((line, i) => {
      if (seen.has(line.lineNo)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lines", i, "lineNo"],
          message: "Duplicate line number",
        });
      }
      seen.add(line.lineNo);
    });

    // ISO dates compare correctly as strings, so no parsing is needed here.
    if (invoice.serviceDate && invoice.serviceDate > invoice.invoiceDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["serviceDate"],
        message: "Service date cannot be after the invoice date.",
      });
    }
    if (invoice.dueDate && invoice.dueDate < invoice.invoiceDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueDate"],
        message: "Due date cannot be before the invoice date.",
      });
    }
  });

/**
 * The one type shared by the form, the server action's signature and its
 * body. `z.input` and `z.output` are identical for this schema by design.
 */
export type InvoiceFormValues = z.infer<typeof invoiceFormSchema>;

/** Shape returned by every invoice server action. */
export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      /** Dotted field paths, e.g. "lines.2.rate", for RHF setError. */
      fieldErrors?: Record<string, string>;
      /** Set when the failure was a below-minimum price. */
      pricingViolation?: {
        lineNo: number;
        sku: string;
        minimumPrice: number;
        attemptedRate: number;
        discountPct: number;
        requiresApproval: boolean;
      };
    };
