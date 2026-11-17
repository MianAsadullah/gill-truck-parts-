import "server-only";

import type { AccountType, JournalSource } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { num, round2, sumMoney } from "@/lib/money";
import { nextDocumentNumber } from "@/lib/sequence";

/**
 * General ledger (ACC).
 *
 * Every posting goes through `postJournalEntry`, which refuses to write an
 * unbalanced entry. That single check is what makes the trial balance a
 * tautology rather than something that needs reconciling.
 *
 * Account numbers the posting engine depends on. These are created by the
 * seed with isSystem = true, which blocks deletion.
 */
export const SYSTEM_ACCOUNTS = {
  CHECKING: "1000",
  ACCOUNTS_RECEIVABLE: "1200",
  INVENTORY: "1300",
  ACCOUNTS_PAYABLE: "2000",
  SALES_TAX_PAYABLE: "2200",
  PARTS_INCOME: "4000",
  SERVICE_INCOME: "4100",
  FREIGHT_INCOME: "4200",
  COGS_PARTS: "5000",
  INVENTORY_SHRINKAGE: "5900",
  PRICE_CONCESSIONS: "4900",
} as const;

/**
 * Normal balance side. An asset with a debit balance and a liability with a
 * credit balance are both "positive"; this map is how we keep the stored
 * `balance` column meaningful without storing a sign convention per row.
 */
const DEBIT_NORMAL: AccountType[] = [
  "ASSET",
  "EXPENSE",
  "COST_OF_GOODS_SOLD",
  "OTHER_EXPENSE",
];

export function isDebitNormal(type: AccountType): boolean {
  return DEBIT_NORMAL.includes(type);
}

export interface JournalLineInput {
  /** Account number, e.g. "1200". Resolved to an id during posting. */
  accountNumber: string;
  debit?: number;
  credit?: number;
  memo?: string | null;
  customerId?: string | null;
  vendorId?: string | null;
}

export interface PostEntryInput {
  tx: Tx;
  source: JournalSource;
  entryDate?: Date;
  memo?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  invoiceId?: string | null;
  billId?: string | null;
  createdById: string;
  lines: JournalLineInput[];
  isReversal?: boolean;
  reversesId?: string | null;
}

export class LedgerError extends Error {
  readonly statusCode = 500;
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

/**
 * Post a balanced double-entry journal entry and move account balances.
 *
 * Must be called inside a transaction (`tx`) so the entry, its lines and the
 * account balance updates commit together with whatever document triggered
 * them. A sale that debits A/R but fails to credit income is worse than a
 * sale that fails outright.
 */
export async function postJournalEntry(input: PostEntryInput): Promise<{
  id: string;
  entryNo: string;
}> {
  const { tx } = input;

  // Drop no-op lines; a 0/0 line is noise, not an error.
  const lines = input.lines
    .map((l) => ({
      ...l,
      debit: round2(num(l.debit)),
      credit: round2(num(l.credit)),
    }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);

  if (lines.length === 0) {
    throw new LedgerError("Cannot post a journal entry with no lines.");
  }

  for (const [i, line] of lines.entries()) {
    if (line.debit < 0 || line.credit < 0) {
      throw new LedgerError(
        "Journal line " + (i + 1) + " has a negative amount; use the opposite side instead.",
      );
    }
    if (line.debit > 0 && line.credit > 0) {
      throw new LedgerError(
        "Journal line " + (i + 1) + " has both a debit and a credit.",
      );
    }
  }

  const totalDebit = sumMoney(lines.map((l) => l.debit));
  const totalCredit = sumMoney(lines.map((l) => l.credit));

  // The invariant. Compared in cents to avoid a float tie-breaker.
  if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
    throw new LedgerError(
      "Journal entry does not balance: debits " +
        totalDebit.toFixed(2) +
        " vs credits " +
        totalCredit.toFixed(2) +
        ".",
    );
  }

  // Resolve account numbers in one query.
  const numbers = [...new Set(lines.map((l) => l.accountNumber))];
  const accounts = await tx.account.findMany({
    where: { number: { in: numbers } },
    select: { id: true, number: true, type: true },
  });

  const byNumber = new Map(accounts.map((a) => [a.number, a]));
  const missing = numbers.filter((n) => !byNumber.has(n));
  if (missing.length > 0) {
    throw new LedgerError(
      "Unknown GL account(s): " + missing.join(", ") + ". Check the chart of accounts.",
    );
  }

  const entryNo = await nextDocumentNumber(tx, "JOURNAL");

  const entry = await tx.journalEntry.create({
    data: {
      entryNo,
      entryDate: input.entryDate ?? new Date(),
      source: input.source,
      memo: input.memo ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      invoiceId: input.invoiceId ?? null,
      billId: input.billId ?? null,
      totalDebit,
      totalCredit,
      isReversal: input.isReversal ?? false,
      reversesId: input.reversesId ?? null,
      createdById: input.createdById,
      lines: {
        create: lines.map((l, i) => {
          const account = byNumber.get(l.accountNumber)!;
          return {
            lineNo: i + 1,
            accountId: account.id,
            debit: l.debit,
            credit: l.credit,
            memo: l.memo ?? null,
            customerId: l.customerId ?? null,
            vendorId: l.vendorId ?? null,
          };
        }),
      },
    },
    select: { id: true, entryNo: true },
  });

  // Move the running balances, respecting each account's normal side.
  for (const line of lines) {
    const account = byNumber.get(line.accountNumber)!;
    const signed = isDebitNormal(account.type)
      ? line.debit - line.credit
      : line.credit - line.debit;
    if (signed === 0) continue;
    await tx.account.update({
      where: { id: account.id },
      data: { balance: { increment: signed } },
    });
  }

  return entry;
}

/**
 * Build the GL lines for a posted invoice.
 *
 * Shape of the entry:
 *   DR  Accounts Receivable        invoice total
 *     CR  Parts Income                      taxable + non-taxable parts
 *     CR  Service Income                    labor and service lines
 *     CR  Sales Tax Payable                 tax collected
 *   DR  Cost of Goods Sold         cost of inventory parts sold
 *     CR  Inventory Asset                   same
 *
 * The COGS pair is omitted when the invoice is pure labor, which keeps a
 * service-only ticket from touching inventory accounts at all.
 */
export function buildInvoiceJournalLines(args: {
  customerId: string;
  invoiceNo: string;
  total: number;
  partsRevenue: number;
  serviceRevenue: number;
  otherRevenue: number;
  taxTotal: number;
  costOfGoodsSold: number;
}): JournalLineInput[] {
  const memo = "Invoice " + args.invoiceNo;
  const lines: JournalLineInput[] = [
    {
      accountNumber: SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE,
      debit: round2(args.total),
      memo,
      customerId: args.customerId,
    },
  ];

  if (args.partsRevenue !== 0) {
    lines.push({
      accountNumber: SYSTEM_ACCOUNTS.PARTS_INCOME,
      credit: round2(args.partsRevenue),
      memo,
      customerId: args.customerId,
    });
  }
  if (args.serviceRevenue !== 0) {
    lines.push({
      accountNumber: SYSTEM_ACCOUNTS.SERVICE_INCOME,
      credit: round2(args.serviceRevenue),
      memo,
      customerId: args.customerId,
    });
  }
  if (args.otherRevenue !== 0) {
    lines.push({
      accountNumber: SYSTEM_ACCOUNTS.FREIGHT_INCOME,
      credit: round2(args.otherRevenue),
      memo,
      customerId: args.customerId,
    });
  }
  if (args.taxTotal !== 0) {
    lines.push({
      accountNumber: SYSTEM_ACCOUNTS.SALES_TAX_PAYABLE,
      credit: round2(args.taxTotal),
      memo,
      customerId: args.customerId,
    });
  }
  if (args.costOfGoodsSold > 0) {
    lines.push(
      {
        accountNumber: SYSTEM_ACCOUNTS.COGS_PARTS,
        debit: round2(args.costOfGoodsSold),
        memo,
      },
      {
        accountNumber: SYSTEM_ACCOUNTS.INVENTORY,
        credit: round2(args.costOfGoodsSold),
        memo,
      },
    );
  }

  return lines;
}

/**
 * Build GL lines for receiving inventory against a PO.
 *   DR Inventory Asset / CR Accounts Payable
 */
export function buildReceiptJournalLines(args: {
  vendorId: string;
  receiptNo: string;
  inventoryValue: number;
}): JournalLineInput[] {
  const memo = "Receipt " + args.receiptNo;
  return [
    {
      accountNumber: SYSTEM_ACCOUNTS.INVENTORY,
      debit: round2(args.inventoryValue),
      memo,
    },
    {
      accountNumber: SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE,
      credit: round2(args.inventoryValue),
      memo,
      vendorId: args.vendorId,
    },
  ];
}

/** Standard aging buckets, matching QuickBooks' A/R and A/P summaries. */
export const AGING_BUCKETS = [
  { label: "Current", min: -Infinity, max: 0 },
  { label: "1 - 30", min: 1, max: 30 },
  { label: "31 - 60", min: 31, max: 60 },
  { label: "61 - 90", min: 61, max: 90 },
  { label: "> 90", min: 91, max: Infinity },
] as const;

export type AgingBucketLabel = (typeof AGING_BUCKETS)[number]["label"];

export function agingBucket(dueDate: Date | null, asOf = new Date()): AgingBucketLabel {
  if (!dueDate) return "Current";
  const days = Math.floor(
    (asOf.getTime() - dueDate.getTime()) / 86_400_000,
  );
  for (const bucket of AGING_BUCKETS) {
    if (days >= bucket.min && days <= bucket.max) return bucket.label;
  }
  return "Current";
}
