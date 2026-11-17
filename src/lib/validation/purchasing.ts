import { z } from "zod";

/**
 * Purchasing validation (PUR).
 *
 * Same discipline as validation/invoice.ts: no `z.coerce` and no `.default()`,
 * so `z.input` and `z.output` are identical and React Hook Form needs no
 * casts. Dates are "YYYY-MM-DD" strings; the server action converts them.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date (YYYY-MM-DD)");

const isoDateOrEmpty = z.union([isoDate, z.literal(""), z.null()]);

export function parseFormDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ──────────────────────────────────────────────────── purchase order ───── */

export const purchaseOrderLineSchema = z
  .object({
    key: z.string(),
    lineNo: z.number().int().positive(),

    /** Null for a non-stock / expense line typed free-form. */
    productId: z.string().nullable(),
    sku: z.string().max(40).nullable(),
    description: z
      .string()
      .trim()
      .min(1, "Description is required")
      .max(300, "Description is too long"),
    /** The vendor's own part number, printed on the PO they receive. */
    vendorPartNo: z.string().trim().max(60).nullable(),

    quantityOrdered: z
      .number({ invalid_type_error: "Qty must be a number" })
      .finite("Qty must be a number")
      .positive("Qty must be greater than zero")
      .max(1_000_000, "Qty is unreasonably large"),

    unitCost: z
      .number({ invalid_type_error: "Cost must be a number" })
      .finite("Cost must be a number")
      .min(0, "Cost cannot be negative")
      .max(1_000_000, "Cost is unreasonably large"),
  })
  .superRefine((line, ctx) => {
    if (!line.productId && !line.description.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["description"],
        message: "Select an item or type a description.",
      });
    }
  });

export type PurchaseOrderLineValues = z.infer<typeof purchaseOrderLineSchema>;

export const purchaseOrderFormSchema = z.object({
  id: z.string().nullable(),
  vendorId: z.string().min(1, "Select a vendor"),
  orderDate: isoDate,
  expectedDate: isoDateOrEmpty,
  shipVia: z.string().trim().max(60).nullable(),
  memo: z.string().trim().max(500).nullable(),
  freight: z
    .number({ invalid_type_error: "Freight must be a number" })
    .finite()
    .min(0, "Freight cannot be negative"),
  lines: z.array(purchaseOrderLineSchema).min(1, "Add at least one line"),
  /** false saves a draft that cannot yet be received against. */
  submit: z.boolean(),
});

export type PurchaseOrderFormValues = z.infer<typeof purchaseOrderFormSchema>;

/* ────────────────────────────────────────────────────────── receiving ───── */

export const receiptLineSchema = z.object({
  poLineId: z.string().min(1),
  /** How many are being received on this trip. Zero means "not this time". */
  quantity: z
    .number({ invalid_type_error: "Qty must be a number" })
    .finite("Qty must be a number")
    .min(0, "Qty cannot be negative")
    .max(1_000_000, "Qty is unreasonably large"),
  /**
   * Actual landed unit cost, which routinely differs from the PO cost —
   * price increases, substitutions, a surcharge. This is the number that
   * feeds weighted-average cost, so it is captured per receipt rather than
   * assumed from the order.
   */
  unitCost: z
    .number({ invalid_type_error: "Cost must be a number" })
    .finite("Cost must be a number")
    .min(0, "Cost cannot be negative"),
});

export type ReceiptLineValues = z.infer<typeof receiptLineSchema>;

export const receiveFormSchema = z
  .object({
    poId: z.string().min(1),
    receivedDate: isoDate,
    vendorPackingSlip: z.string().trim().max(60).nullable(),
    memo: z.string().trim().max(500).nullable(),
    lines: z.array(receiptLineSchema).min(1),
    /** Close the PO even if some quantity is still outstanding. */
    closeShort: z.boolean(),
  })
  .superRefine((form, ctx) => {
    if (!form.lines.some((l) => l.quantity > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lines"],
        message: "Enter a quantity on at least one line.",
      });
    }
  });

export type ReceiveFormValues = z.infer<typeof receiveFormSchema>;

/* ──────────────────────────────────────────────────────────── bills ───── */

export const billLineSchema = z.object({
  key: z.string(),
  lineNo: z.number().int().positive(),
  /** Expense bills post to an account; inventory bills come from a receipt. */
  accountId: z.string().nullable(),
  description: z.string().trim().min(1, "Description is required").max(300),
  quantity: z.number().finite().min(0),
  unitCost: z.number().finite().min(0, "Cost cannot be negative"),
});

export type BillLineValues = z.infer<typeof billLineSchema>;

export const billFormSchema = z
  .object({
    vendorId: z.string().min(1, "Select a vendor"),
    billNo: z.string().trim().min(1, "Enter the vendor's invoice number").max(60),
    billDate: isoDate,
    dueDate: isoDateOrEmpty,
    termsId: z.string().nullable(),
    memo: z.string().trim().max(500).nullable(),
    /**
     * When set, this bill settles an existing item receipt. The inventory and
     * A/P were already posted by the receipt, so the bill only links and
     * marks it billed — it does NOT post again.
     */
    receiptId: z.string().nullable(),
    lines: z.array(billLineSchema),
  })
  .superRefine((form, ctx) => {
    if (!form.receiptId && form.lines.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lines"],
        message: "Add at least one expense line, or select an item receipt.",
      });
    }
    for (const [i, line] of form.lines.entries()) {
      if (!line.accountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lines", i, "accountId"],
          message: "Choose an expense account.",
        });
      }
    }
  });

export type BillFormValues = z.infer<typeof billFormSchema>;

export const payBillsSchema = z
  .object({
    paymentDate: isoDate,
    bankAccountId: z.string().min(1, "Choose the account to pay from"),
    method: z.enum(["CHECK", "ACH", "CREDIT_CARD", "CASH", "OTHER"]),
    referenceNo: z.string().trim().max(40).nullable(),
    memo: z.string().trim().max(500).nullable(),
    payments: z
      .array(
        z.object({
          billId: z.string().min(1),
          amount: z.number().finite().min(0),
        }),
      )
      .min(1),
  })
  .superRefine((form, ctx) => {
    if (!form.payments.some((p) => p.amount > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payments"],
        message: "Enter an amount to pay on at least one bill.",
      });
    }
  });

export type PayBillsValues = z.infer<typeof payBillsSchema>;
