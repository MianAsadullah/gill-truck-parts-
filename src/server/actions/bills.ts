"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission, AuthError, type AuthUser } from "@/lib/auth";
import { PERM, PermissionError } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit";
import { extend, num, round2, sumMoney } from "@/lib/money";
import { nextDocumentNumber } from "@/lib/sequence";
import { postJournalEntry, SYSTEM_ACCOUNTS } from "@/lib/ledger";
import type { ActionResult } from "@/lib/validation/invoice";
import {
  billFormSchema,
  payBillsSchema,
  parseFormDate,
  type BillFormValues,
  type PayBillsValues,
} from "@/lib/validation/purchasing";

/**
 * Bills and bill payments (PUR / ACC).
 *
 * HOW A/P AVOIDS DOUBLE-COUNTING
 * ------------------------------
 * Receiving inventory already posts DR Inventory Asset / CR Accounts
 * Payable — the liability exists the moment the parts are on the shelf,
 * whether or not the vendor's paperwork has caught up. So:
 *
 *   - A bill entered AGAINST a receipt does NOT post to the GL again. It
 *     records the vendor's invoice number, terms and due date against the
 *     liability the receipt already created, and marks the receipt billed.
 *   - A bill with NO receipt (rent, freight, shop supplies) is an expense
 *     bill and DOES post: DR the chosen expense accounts / CR A/P.
 *
 * This mirrors how QuickBooks converts an item receipt into a bill rather
 * than stacking a second liability on top of it. A/P aging therefore reads
 * from bills plus any receipt that has not yet been billed.
 */

function fieldErrorsFrom(issues: { path: (string | number)[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.join(".");
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

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

/* ══════════════════════════════════════════════════════════ enter bill ═══ */

export async function createBill(
  input: BillFormValues,
): Promise<ActionResult<{ id: string; billNo: string; total: number }>> {
  const g = await guard(PERM.PURCHASING_ENTER_BILL);
  if ("error" in g) return { ok: false, error: g.error };
  const { user } = g;

  const parsed = billFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
    };
  }
  const form = parsed.data;

  const billDate = parseFormDate(form.billDate);
  if (!billDate) return { ok: false, error: "Enter a valid bill date." };

  const [vendor, terms, receipt] = await Promise.all([
    prisma.vendor.findUnique({ where: { id: form.vendorId } }),
    form.termsId ? prisma.terms.findUnique({ where: { id: form.termsId } }) : null,
    form.receiptId
      ? prisma.receipt.findUnique({
          where: { id: form.receiptId },
          include: {
            po: { select: { poNumber: true, vendorId: true } },
            lines: { include: { poLine: { select: { sku: true, description: true } } } },
          },
        })
      : null,
  ]);

  if (!vendor) return { ok: false, error: "That vendor no longer exists." };
  if (form.receiptId && !receipt) {
    return { ok: false, error: "That item receipt no longer exists." };
  }
  if (receipt && receipt.isBilled) {
    return { ok: false, error: "That item receipt has already been billed." };
  }
  if (receipt && receipt.po.vendorId !== vendor.id) {
    return { ok: false, error: "That item receipt belongs to a different vendor." };
  }

  const duplicate = await prisma.bill.findFirst({
    where: { vendorId: vendor.id, billNo: form.billNo.trim() },
    select: { id: true },
  });
  if (duplicate) {
    return {
      ok: false,
      error:
        "Invoice " + form.billNo + " has already been entered for " + vendor.companyName + ".",
      fieldErrors: { billNo: "Duplicate vendor invoice number" },
    };
  }

  // Against a receipt the amount is the receipt's value — the clerk is
  // matching paperwork, not re-keying prices.
  const receiptTotal = receipt ? sumMoney(receipt.lines.map((l) => l.amount)) : 0;

  const expenseLines = form.lines.map((line, index) => ({
    lineNo: index + 1,
    accountId: line.accountId,
    description: line.description,
    quantity: line.quantity || 1,
    unitCost: line.unitCost,
    amount: extend(line.quantity || 1, line.unitCost),
  }));

  const subtotal = receipt ? receiptTotal : sumMoney(expenseLines.map((l) => l.amount));
  const total = round2(subtotal);

  const netDays = terms?.netDays ?? 0;
  const dueDate =
    parseFormDate(form.dueDate) ??
    (netDays > 0 ? new Date(billDate.getTime() + netDays * 86_400_000) : billDate);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.create({
        data: {
          billNo: form.billNo.trim(),
          vendorId: vendor.id,
          poId: receipt?.poId ?? null,
          receiptId: receipt?.id ?? null,
          billDate,
          dueDate,
          termsId: form.termsId ?? vendor.termsId,
          status: "OPEN",
          memo: form.memo,
          subtotal,
          taxTotal: 0,
          total,
          amountPaid: 0,
          balanceDue: total,
          lines: receipt
            ? {
                // Mirror the receipt's lines so the bill is readable on its
                // own, without having to open the receipt.
                create: receipt.lines.map((l, i) => ({
                  lineNo: i + 1,
                  description:
                    (l.poLine.sku ? l.poLine.sku + " - " : "") + l.poLine.description,
                  quantity: num(l.quantity),
                  unitCost: num(l.unitCost),
                  amount: num(l.amount),
                })),
              }
            : { create: expenseLines },
        },
        select: { id: true, billNo: true },
      });

      if (receipt) {
        await tx.receipt.update({ where: { id: receipt.id }, data: { isBilled: true } });
        // No GL posting and no vendor.balance change: the receipt already
        // created this liability. See the module comment.
      } else {
        // postJournalEntry resolves accounts by NUMBER, so translate the
        // account ids the form submitted. Reading them inside the
        // transaction also validates that each one still exists.
        const accountIds = [
          ...new Set(
            expenseLines
              .map((l) => l.accountId)
              .filter((id): id is string => !!id),
          ),
        ];
        const accounts = await tx.account.findMany({
          where: { id: { in: accountIds } },
          select: { id: true, number: true },
        });
        const numberById = new Map(accounts.map((a) => [a.id, a.number]));

        const missing = accountIds.filter((id) => !numberById.has(id));
        if (missing.length > 0) {
          throw new Error("An expense account on this bill no longer exists.");
        }

        await postJournalEntry({
          tx,
          source: "BILL",
          entryDate: billDate,
          memo: "Bill " + bill.billNo + " - " + vendor.companyName,
          referenceType: "BILL",
          referenceId: bill.id,
          billId: bill.id,
          createdById: user.id,
          lines: [
            ...expenseLines
              .filter((l) => l.accountId && l.amount !== 0)
              .map((l) => ({
                accountNumber: numberById.get(l.accountId as string) as string,
                debit: l.amount,
                memo: l.description,
              })),
            {
              accountNumber: SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE,
              credit: total,
              memo: "Bill " + bill.billNo,
              vendorId: vendor.id,
            },
          ],
        });

        await tx.vendor.update({
          where: { id: vendor.id },
          data: { balance: { increment: total } },
        });
      }

      await writeAuditLog({
        tx,
        user,
        action: "CREATE",
        entity: "Bill",
        entityId: bill.id,
        summary:
          user.fullName +
          " entered bill " +
          bill.billNo +
          " from " +
          vendor.companyName +
          " for " +
          total.toFixed(2) +
          (receipt ? " against item receipt " + receipt.receiptNo : " (expense bill)"),
        changes: { billNo: bill.billNo, total, receiptNo: receipt?.receiptNo ?? null },
      });

      return { id: bill.id, billNo: bill.billNo, total };
    });

    revalidatePath("/dashboard/bills");
    revalidatePath("/dashboard/purchase-orders");
    return { ok: true, data: result };
  } catch (err) {
    console.error("[createBill]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The bill could not be saved.",
    };
  }
}

/* ═══════════════════════════════════════════════════════════ pay bills ═══ */

export async function payBills(
  input: PayBillsValues,
): Promise<ActionResult<{ paymentNo: string; amount: number; billCount: number }>> {
  const g = await guard(PERM.PURCHASING_PAY_BILL);
  if ("error" in g) return { ok: false, error: g.error };
  const { user } = g;

  const parsed = payBillsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the form.",
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
    };
  }
  const form = parsed.data;

  const paymentDate = parseFormDate(form.paymentDate);
  if (!paymentDate) return { ok: false, error: "Enter a valid payment date." };

  const applications = form.payments.filter((p) => p.amount > 0);
  if (applications.length === 0) {
    return { ok: false, error: "Enter an amount to pay on at least one bill." };
  }

  const [bills, bankAccount] = await Promise.all([
    prisma.bill.findMany({
      where: { id: { in: applications.map((a) => a.billId) } },
      include: { vendor: { select: { id: true, companyName: true } } },
    }),
    prisma.account.findUnique({ where: { id: form.bankAccountId } }),
  ]);

  if (!bankAccount) return { ok: false, error: "That bank account no longer exists." };

  const billMap = new Map(bills.map((b) => [b.id, b]));
  for (const app of applications) {
    const bill = billMap.get(app.billId);
    if (!bill) return { ok: false, error: "One of the selected bills no longer exists." };
    if (bill.status === "VOID") {
      return { ok: false, error: "Bill " + bill.billNo + " is void." };
    }
    if (app.amount > num(bill.balanceDue) + 0.005) {
      return {
        ok: false,
        error:
          "Cannot pay " +
          app.amount.toFixed(2) +
          " on bill " +
          bill.billNo +
          " — only " +
          num(bill.balanceDue).toFixed(2) +
          " is outstanding.",
      };
    }
  }

  // A run can cover several vendors; group so each gets its own payment
  // document and its own balance movement, which is what reconciliation and
  // vendor statements expect.
  const byVendor = new Map<string, { vendorId: string; name: string; total: number }>();
  for (const app of applications) {
    const bill = billMap.get(app.billId)!;
    const entry = byVendor.get(bill.vendorId) ?? {
      vendorId: bill.vendorId,
      name: bill.vendor.companyName,
      total: 0,
    };
    entry.total = round2(entry.total + app.amount);
    byVendor.set(bill.vendorId, entry);
  }

  const grandTotal = sumMoney(applications.map((a) => a.amount));

  try {
    const result = await prisma.$transaction(async (tx) => {
      let firstPaymentNo = "";

      for (const vendorGroup of byVendor.values()) {
        const paymentNo = await nextDocumentNumber(tx, "BILL_PAYMENT");
        if (!firstPaymentNo) firstPaymentNo = paymentNo;

        const vendorApps = applications.filter(
          (a) => billMap.get(a.billId)!.vendorId === vendorGroup.vendorId,
        );

        const payment = await tx.billPayment.create({
          data: {
            paymentNo,
            vendorId: vendorGroup.vendorId,
            paymentDate,
            method: form.method,
            referenceNo: form.referenceNo,
            amount: vendorGroup.total,
            bankAccountId: bankAccount.id,
            memo: form.memo,
            createdById: user.id,
            applications: {
              create: vendorApps.map((a) => ({ billId: a.billId, amount: a.amount })),
            },
          },
          select: { id: true, paymentNo: true },
        });

        for (const app of vendorApps) {
          const bill = billMap.get(app.billId)!;
          const newPaid = round2(num(bill.amountPaid) + app.amount);
          const newBalance = round2(num(bill.total) - newPaid);
          await tx.bill.update({
            where: { id: bill.id },
            data: {
              amountPaid: newPaid,
              balanceDue: newBalance,
              status: newBalance <= 0.005 ? "PAID" : "PARTIALLY_PAID",
            },
          });
        }

        await tx.vendor.update({
          where: { id: vendorGroup.vendorId },
          data: { balance: { decrement: vendorGroup.total } },
        });

        // DR Accounts Payable / CR the bank account the cheque is drawn on.
        await postJournalEntry({
          tx,
          source: "BILL_PAYMENT",
          entryDate: paymentDate,
          memo: "Bill payment " + paymentNo + " - " + vendorGroup.name,
          referenceType: "BILL_PAYMENT",
          referenceId: payment.id,
          createdById: user.id,
          lines: [
            {
              accountNumber: SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE,
              debit: vendorGroup.total,
              memo: paymentNo,
              vendorId: vendorGroup.vendorId,
            },
            {
              accountNumber: bankAccount.number,
              credit: vendorGroup.total,
              memo: paymentNo,
            },
          ],
        });

        await writeAuditLog({
          tx,
          user,
          action: "PAYMENT",
          entity: "BillPayment",
          entityId: payment.id,
          summary:
            user.fullName +
            " paid " +
            vendorGroup.total.toFixed(2) +
            " to " +
            vendorGroup.name +
            " (" +
            paymentNo +
            ", " +
            form.method +
            (form.referenceNo ? " " + form.referenceNo : "") +
            ") from " +
            bankAccount.number +
            " " +
            bankAccount.name,
          changes: { paymentNo, amount: vendorGroup.total, bills: vendorApps.length },
        });
      }

      return {
        paymentNo: firstPaymentNo,
        amount: grandTotal,
        billCount: applications.length,
      };
    });

    revalidatePath("/dashboard/bills");
    revalidatePath("/dashboard/accounting/ap-aging");
    revalidatePath("/dashboard");
    return { ok: true, data: result };
  } catch (err) {
    console.error("[payBills]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The payment could not be posted.",
    };
  }
}
