"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission, AuthError, type AuthUser } from "@/lib/auth";
import { PERM, PermissionError } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit";
import { num, round2, sumMoney } from "@/lib/money";
import { nextDocumentNumber } from "@/lib/sequence";
import { postJournalEntry, SYSTEM_ACCOUNTS } from "@/lib/ledger";
import type { ActionResult } from "@/lib/validation/invoice";
import { parseFormDate } from "@/lib/validation/purchasing";
import {
  receivePaymentSchema,
  type ReceivePaymentValues,
} from "@/lib/validation/payments";

/**
 * Receive Payments (SAL / ACC).
 *
 * Posts DR the deposit account / CR Accounts Receivable, draws down each
 * invoice's balance, and moves the customer's running balance — all in one
 * transaction, so a payment can never be recorded against an invoice whose
 * balance did not move.
 *
 * Overpayment is allowed and parked in CustomerPayment.unapplied rather than
 * being refused: a fleet customer paying a round number against a statement
 * is routine, and the counter should not have to turn the money away.
 */



async function guard(
  perm: (typeof PERM)[keyof typeof PERM],
): Promise<{ user: AuthUser } | { error: string }> {
  try {
    return { user: await requirePermission(perm) };
  } catch (err) {
    if (err instanceof PermissionError) {
      return { error: "You do not have permission to perform this action." };
    }
    if (err instanceof AuthError) {
      return { error: "Your session has expired. Please sign in again." };
    }
    throw err;
  }
}

export async function receiveCustomerPayment(
  input: ReceivePaymentValues,
): Promise<
  ActionResult<{ paymentNo: string; applied: number; unapplied: number }>
> {
  const g = await guard(PERM.SALES_RECEIVE_PAYMENT);
  if ("error" in g) return { ok: false, error: g.error };
  const { user } = g;

  const parsed = receivePaymentSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      if (!fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the form.",
      fieldErrors,
    };
  }
  const form = parsed.data;

  const paymentDate = parseFormDate(form.paymentDate);
  if (!paymentDate) return { ok: false, error: "Enter a valid payment date." };

  const applications = form.applications.filter((a) => a.amount > 0);

  const [customer, depositAccount, invoices] = await Promise.all([
    prisma.customer.findUnique({ where: { id: form.customerId } }),
    prisma.account.findUnique({ where: { id: form.depositAccountId } }),
    applications.length
      ? prisma.invoice.findMany({
          where: { id: { in: applications.map((a) => a.invoiceId) } },
        })
      : Promise.resolve([]),
  ]);

  if (!customer) return { ok: false, error: "That customer no longer exists." };
  if (!depositAccount) return { ok: false, error: "That deposit account no longer exists." };

  const invoiceMap = new Map(invoices.map((i) => [i.id, i]));
  for (const app of applications) {
    const invoice = invoiceMap.get(app.invoiceId);
    if (!invoice) return { ok: false, error: "One of the invoices no longer exists." };
    if (invoice.customerId !== customer.id) {
      return { ok: false, error: "Invoice " + invoice.invoiceNo + " belongs to another customer." };
    }
    if (invoice.status === "VOID") {
      return { ok: false, error: "Invoice " + invoice.invoiceNo + " is void." };
    }
    if (app.amount > num(invoice.balanceDue) + 0.005) {
      return {
        ok: false,
        error:
          "Cannot apply " +
          app.amount.toFixed(2) +
          " to invoice " +
          invoice.invoiceNo +
          " — only " +
          num(invoice.balanceDue).toFixed(2) +
          " is outstanding.",
      };
    }
  }

  const applied = sumMoney(applications.map((a) => a.amount));
  const unapplied = round2(form.amount - applied);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const paymentNo = await nextDocumentNumber(tx, "CUSTOMER_PAYMENT");

      const payment = await tx.customerPayment.create({
        data: {
          paymentNo,
          customerId: customer.id,
          paymentDate,
          method: form.method,
          referenceNo: form.referenceNo,
          amount: round2(form.amount),
          unapplied,
          depositAccountId: depositAccount.id,
          memo: form.memo,
          createdById: user.id,
          applications: {
            create: applications.map((a) => ({
              invoiceId: a.invoiceId,
              amount: a.amount,
            })),
          },
        },
        select: { id: true, paymentNo: true },
      });

      for (const app of applications) {
        const invoice = invoiceMap.get(app.invoiceId)!;
        const newPaid = round2(num(invoice.amountPaid) + app.amount);
        const newBalance = round2(num(invoice.total) - newPaid);
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            amountPaid: newPaid,
            balanceDue: newBalance,
            status: newBalance <= 0.005 ? "PAID" : "PARTIALLY_PAID",
          },
        });
      }

      // The whole receipt reduces what the customer owes, including any
      // unapplied portion — it is their money sitting on account.
      await tx.customer.update({
        where: { id: customer.id },
        data: { balance: { decrement: round2(form.amount) } },
      });

      await postJournalEntry({
        tx,
        source: "CUSTOMER_PAYMENT",
        entryDate: paymentDate,
        memo: "Payment " + paymentNo + " - " + customer.companyName,
        referenceType: "CUSTOMER_PAYMENT",
        referenceId: payment.id,
        createdById: user.id,
        lines: [
          {
            accountNumber: depositAccount.number,
            debit: round2(form.amount),
            memo: paymentNo,
            customerId: customer.id,
          },
          {
            accountNumber: SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE,
            credit: round2(form.amount),
            memo: paymentNo,
            customerId: customer.id,
          },
        ],
      });

      await writeAuditLog({
        tx,
        user,
        action: "PAYMENT",
        entity: "CustomerPayment",
        entityId: payment.id,
        summary:
          user.fullName +
          " received " +
          round2(form.amount).toFixed(2) +
          " from " +
          customer.companyName +
          " (" +
          paymentNo +
          ", " +
          form.method +
          (form.referenceNo ? " " + form.referenceNo : "") +
          "), applied " +
          applied.toFixed(2) +
          " across " +
          applications.length +
          " invoice" +
          (applications.length === 1 ? "" : "s") +
          (unapplied > 0 ? ", " + unapplied.toFixed(2) + " left on account" : ""),
        changes: { paymentNo, amount: round2(form.amount), applied, unapplied },
      });

      return { paymentNo, applied, unapplied };
    });

    revalidatePath("/dashboard/invoices");
    revalidatePath("/dashboard/accounting/ar-aging");
    revalidatePath("/dashboard");
    return { ok: true, data: result };
  } catch (err) {
    console.error("[receiveCustomerPayment]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The payment could not be posted.",
    };
  }
}
