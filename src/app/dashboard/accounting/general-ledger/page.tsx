import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney, num, round2, sumMoney } from "@/lib/money";
import { isDebitNormal } from "@/lib/ledger";
import { QbWindow, QbBanner, QbEmpty, QbButton, QbSelect, QbInput } from "@/components/qb/Ui";

export const metadata = { title: "General Ledger — Gill Truck Parts" };

/**
 * General Ledger detail (ACC).
 *
 * One account at a time with a running balance, the way QuickBooks' GL
 * report reads. The running balance is accumulated in the account's natural
 * direction, so an asset account shows debits increasing it and a liability
 * shows credits increasing it — rather than a raw signed column that an
 * accountant would have to re-interpret per account.
 */
export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; from?: string; to?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.ACCOUNTING_VIEW_GL)) {
    return (
      <QbWindow title="General Ledger">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot view the general ledger.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const params = await searchParams;
  const accounts = await prisma.account.findMany({
    orderBy: { number: "asc" },
    select: { id: true, number: true, name: true, type: true },
  });

  const selectedNumber = params.account ?? accounts[0]?.number ?? "";
  const account = accounts.find((a) => a.number === selectedNumber) ?? null;

  const from = params.from ? new Date(params.from + "T00:00:00") : null;
  const to = params.to ? new Date(params.to + "T23:59:59") : null;

  const dateWhere: Prisma.JournalEntryWhereInput =
    from || to
      ? { entryDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {};

  const lines = account
    ? await prisma.journalLine.findMany({
        where: { accountId: account.id, entry: dateWhere },
        orderBy: [{ entry: { entryDate: "asc" } }, { entry: { entryNo: "asc" } }, { lineNo: "asc" }],
        include: {
          entry: {
            select: {
              entryNo: true,
              entryDate: true,
              source: true,
              memo: true,
              invoiceId: true,
              billId: true,
            },
          },
        },
        take: 500,
      })
    : [];

  // Opening balance: everything before the window, in the account's natural
  // direction. Without this the running balance is meaningless on a filtered
  // date range.
  let opening = 0;
  if (account && from) {
    const prior = await prisma.journalLine.findMany({
      where: { accountId: account.id, entry: { entryDate: { lt: from } } },
      select: { debit: true, credit: true },
    });
    const debits = sumMoney(prior.map((l) => l.debit));
    const credits = sumMoney(prior.map((l) => l.credit));
    opening = isDebitNormal(account.type) ? round2(debits - credits) : round2(credits - debits);
  }

  let running = opening;
  const rows = lines.map((line) => {
    const debit = num(line.debit);
    const credit = num(line.credit);
    const delta = account && isDebitNormal(account.type) ? debit - credit : credit - debit;
    running = round2(running + delta);
    return { line, debit, credit, running };
  });

  const totalDebit = sumMoney(rows.map((r) => r.debit));
  const totalCredit = sumMoney(rows.map((r) => r.credit));

  return (
    <QbWindow
      title="General Ledger"
      subtitle={account ? "— " + account.number + " " + account.name : undefined}
      bodyClassName="bg-white"
    >
      <form
        method="get"
        className="bg-qb-chrome border-b border-qb-line px-2 py-1 flex items-end gap-2 flex-wrap sticky top-0 z-20"
      >
        <div>
          <label htmlFor="account" className="qb-label block">
            Account
          </label>
          <QbSelect
            id="account"
            name="account"
            defaultValue={selectedNumber}
            className="w-[300px]"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.number}>
                {a.number} &mdash; {a.name}
              </option>
            ))}
          </QbSelect>
        </div>
        <div>
          <label htmlFor="from" className="qb-label block">
            From
          </label>
          <QbInput id="from" name="from" type="date" defaultValue={params.from ?? ""} className="w-[130px]" />
        </div>
        <div>
          <label htmlFor="to" className="qb-label block">
            To
          </label>
          <QbInput id="to" name="to" type="date" defaultValue={params.to ?? ""} className="w-[130px]" />
        </div>
        <QbButton type="submit" size="sm">
          Refresh
        </QbButton>
        <Link href="/dashboard/accounting/trial-balance" className="qb-btn qb-btn-sm">
          Trial Balance
        </Link>
      </form>

      {!account ? (
        <QbEmpty>Choose an account.</QbEmpty>
      ) : rows.length === 0 ? (
        <QbEmpty>No postings to {account.name} in this period.</QbEmpty>
      ) : (
        <table className="qb-grid">
          <thead>
            <tr>
              <th style={{ width: 80 }}>Date</th>
              <th style={{ width: 84 }}>Entry</th>
              <th style={{ width: 130 }}>Source</th>
              <th>Memo</th>
              <th style={{ width: 96 }} className="text-right">Debit</th>
              <th style={{ width: 96 }} className="text-right">Credit</th>
              <th style={{ width: 104 }} className="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {from ? (
              <tr className="bg-qb-chromeAlt">
                <td colSpan={6} className="border border-qb-gridLine px-1 text-right italic">
                  Opening balance
                </td>
                <td className="border border-qb-gridLine px-1 qb-grid-num font-bold">
                  {formatMoney(opening)}
                </td>
              </tr>
            ) : null}
            {rows.map(({ line, debit, credit, running: bal }) => (
              <tr key={line.id}>
                <td className="font-qbMono">
                  {line.entry.entryDate.toLocaleDateString("en-US", {
                    month: "2-digit",
                    day: "2-digit",
                    year: "2-digit",
                  })}
                </td>
                <td className="font-qbMono">
                  {line.entry.invoiceId ? (
                    <Link
                      href={"/dashboard/invoices/" + line.entry.invoiceId}
                      className="text-qb-blue hover:underline"
                    >
                      {line.entry.entryNo}
                    </Link>
                  ) : (
                    line.entry.entryNo
                  )}
                </td>
                <td className="text-qb-xs">{line.entry.source.replace(/_/g, " ")}</td>
                <td className="truncate" title={line.memo ?? line.entry.memo ?? ""}>
                  {line.memo ?? line.entry.memo ?? ""}
                </td>
                <td className="qb-grid-num">{debit === 0 ? "" : formatMoney(debit)}</td>
                <td className="qb-grid-num">{credit === 0 ? "" : formatMoney(credit)}</td>
                <td className="qb-grid-num font-bold">{formatMoney(bal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-qb-grid-header font-bold">
              <td colSpan={4} className="border border-qb-gridLine px-1 text-right">
                Totals for {account.number} {account.name}
              </td>
              <td className="border border-qb-gridLine px-1 qb-grid-num">
                {formatMoney(totalDebit)}
              </td>
              <td className="border border-qb-gridLine px-1 qb-grid-num">
                {formatMoney(totalCredit)}
              </td>
              <td className="border border-qb-gridLine px-1 qb-grid-num">
                {formatMoney(running)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </QbWindow>
  );
}
