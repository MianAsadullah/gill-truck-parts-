import { z } from "zod";
import { normalizePartNumber } from "@/lib/part-number";

/**
 * Product master and adjustment validation (INV).
 *
 * Lives here rather than beside the server actions because a `"use server"`
 * module may only export async functions — a Zod schema exported from one
 * fails the build. Keeping the schemas in a plain module also lets the
 * client form import them for resolver-side validation.
 */

const crossRefSchema = z.object({
  type: z.enum(["OEM", "ALTERNATE", "SUPERSEDED", "INTERCHANGE", "VENDOR_PART"]),
  number: z.string().trim().min(1).max(60),
  manufacturer: z.string().trim().max(60).nullable(),
});

export const productFormSchema = z
  .object({
    id: z.string().nullable(),
    sku: z
      .string()
      .trim()
      .min(1, "SKU is required")
      .max(40)
      .regex(/^[A-Za-z0-9._/-]+$/, "SKU may use letters, digits, dot, dash, slash"),
    type: z.enum(["INVENTORY", "NON_INVENTORY", "SERVICE", "OTHER_CHARGE"]),
    description: z.string().trim().min(1, "Description is required").max(300),
    longDescription: z.string().trim().max(1000).nullable(),
    categoryId: z.string().nullable(),
    brandId: z.string().nullable(),
    preferredVendorId: z.string().nullable(),
    unitOfMeasure: z.string().trim().min(1).max(12),
    barcode: z.string().trim().max(60).nullable(),
    binLocation: z.string().trim().max(30).nullable(),

    standardPrice: z.number().finite().min(0, "Price cannot be negative"),
    minimumPrice: z.number().finite().min(0, "Minimum cannot be negative"),

    /** Ignored entirely unless the caller holds inventory.view_cost. */
    averageCost: z.number().finite().min(0).nullable(),
    standardCost: z.number().finite().min(0).nullable(),

    reorderPoint: z.number().finite().min(0),
    reorderQuantity: z.number().finite().min(0),
    coreCharge: z.number().finite().min(0),
    isTaxable: z.boolean(),
    isActive: z.boolean(),

    crossReferences: z.array(crossRefSchema).max(40),
  })
  .superRefine((p, ctx) => {
    if (p.minimumPrice > p.standardPrice && p.standardPrice > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimumPrice"],
        message:
          "The minimum price cannot be above the list price — every sale would need an override.",
      });
    }
    const seen = new Set<string>();
    p.crossReferences.forEach((x, i) => {
      const key = x.type + "|" + normalizePartNumber(x.number);
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["crossReferences", i, "number"],
          message: "Duplicate cross-reference",
        });
      }
      seen.add(key);
    });
  });

export type ProductFormValues = z.infer<typeof productFormSchema>;


export const adjustmentSchema = z
  .object({
    adjustmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"),
    reason: z.string().trim().min(4, "Enter a reason for this adjustment").max(280),
    lines: z
      .array(
        z.object({
          productId: z.string().min(1),
          /** The counted quantity, not a delta — this is a physical count. */
          newQuantity: z.number().finite().min(-1_000_000).max(1_000_000),
        }),
      )
      .min(1, "Add at least one item"),
  })
  .superRefine((form, ctx) => {
    const seen = new Set<string>();
    form.lines.forEach((l, i) => {
      if (seen.has(l.productId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lines", i, "productId"],
          message: "This item appears twice",
        });
      }
      seen.add(l.productId);
    });
  });

export type AdjustmentValues = z.infer<typeof adjustmentSchema>;
