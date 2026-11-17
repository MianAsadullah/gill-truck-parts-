import { z } from "zod";

/**
 * Customer payment validation (SAL).
 *
 * Separate from the server action because a `"use server"` module may only
 * export async functions.
 */

export const receivePaymentSchema = z
  .object({
    customerId: z.string().min(1, "Select a customer"),
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"),
    method: z.enum(["CASH", "CHECK", "CREDIT_CARD", "ACH", "STORE_CREDIT", "OTHER"]),
    referenceNo: z.string().trim().max(40).nullable(),
    depositAccountId: z.string().min(1, "Choose the account to deposit into"),
    memo: z.string().trim().max(500).nullable(),
    amount: z
      .number({ invalid_type_error: "Amount must be a number" })
      .finite()
      .positive("Enter the amount received"),
    applications: z.array(
      z.object({
        invoiceId: z.string().min(1),
        amount: z.number().finite().min(0),
      }),
    ),
  })
  .superRefine((form, ctx) => {
    const applied = form.applications.reduce((s, a) => s + a.amount, 0);
    if (applied > form.amount + 0.005) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["applications"],
        message:
          "You have applied " +
          applied.toFixed(2) +
          " but only received " +
          form.amount.toFixed(2) +
          ".",
      });
    }
  });

export type ReceivePaymentValues = z.infer<typeof receivePaymentSchema>;
