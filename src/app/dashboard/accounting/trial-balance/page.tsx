import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney, num, round2, sumMoney } from "@/lib/money";
import { isDebitNormal } from "@/lib/ledger";
import { QbWindow, QbBanner, QbButton, QbInput } from "@/components/qb/Ui";

export const metadata = { title: "Trial Balance — Gill Truck Parts" };

/**
 * Trial Balance (ACC).
 *
 * Computed from journal lines rather than from the cached Account.balance
 * column, deliberately: a trial balance whose source is the same cached
 * figure it is meant to validate proves nothing. Summing the underlying
 * postings means a drift between the two would show up here as an
 * out-of-balance warning instead of hiding.
 */
export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.ACCOUNTING_VIEW_GL)) {
    return (
      <QbWindow title="Trial Balance">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot view the general ledger.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const params = await searchParams;
  const asOf = params.asOf ? new Date(params.asOf + "T23:59:59") : null;

  const [accounts, lines] = await Promise.all([
    prisma.account.findMany({
      orderBy: { number: "asc" },
      select: { id: true, number: true, name: true, type: true, balance: true },
    }),
    prisma.journalLine.findMany({
      where: asOf ? { entry: { entryDate: { lte: asOf } } } : {},
      select: { accountId: true, debit: true, credit: true },
    }),
  ]);

  const totals = new Map<string, { debit: number; credit: number }>();
  for (const line of lines) {
    const entry = totals.get(line.accountId) ?? { debit: 0, credit: 0 };
    entry.debit = round2(entry.debit + num(line.debit));
    entry.credit = round2(entry.credit + num(line.credit));
    totals.set(line.accountId, entry);
  }

  const rows = accounts
    .map((account) => {
      const t = totals.get(account.id) ?? { debit: 0, credit: 0 };
      const net = round2(t.debit - t.credit);
      const debitNormal = isDebitNormal(account.type);
      return {
        account,
        debitColumn: net > 0 ? net : 0,
        creditColumn: net < 0 ? Math.abs(net) : 0,
        // Compare against the cached column so drift is visible.
        cached: debitNormal ? num(account.balance) : num(account.balance),
        expectedCached: debitNormal ? net : round2(-net),
      };
    })
    .filter((r) => r.debitColumn !== 0 || r.creditColumn !== 0);

  const totalDebit = sumMoney(rows.map((r) => r.debitColumn));
  const totalCredit = sumMoney(rows.map((r) => r.creditColumn));
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005;

  const drifted = rows.filter(
    (r) => Math.abs(r.cached - r.expectedCached) > 0.005,
  );

  return (
    <QbWindow
      title="Trial Balance"
      subtitle={asOf ? "— as of " + asOf.toLocaleDateString("en-US") : "— all dates"}
      bodyClassName="bg-white"
    >
      <form
        method="get"
        className="bg-qb-chrome border-b border-qb-line px-2 py-1 flex items-end gap-2 sticky top-0 z-20"
      >
        <div>
          <label htmlFor="asOf" className="qb-label block">
            As of
          </label>
          <QbInput id="asOf" name="asOf" type="date" defaultValue={params.asOf ?? ""} className="w-[140px]" />
        </div>
        <QbButton type="submit" size="sm">
          Refresh
        </QbButton>
        <Link href="/dashboard/accounting/general-ledger" className="qb-btn qb-btn-sm">
          General Ledger
        </Link>
      </form>

      <div className="p-2 space-y-2">
        {!balanced ? (
          <QbBanner variant="err" title="The ledger does not balance">
            Debits total {formatMoney(totalDebit)} against credits of{" "}
            {formatMoney(totalCredit)} — a difference of{" "}
            {formatMoney(Math.abs(totalDebit - totalCredit))}. This should be impossible:
            every posting goes through a routine that refuses to write an unbalanced entry.
            Investigate before relying on any report.
          </QbBanner>
        ) : (
          <QbBanner variant="ok" title="In balance">
            Debits and credits both total {formatMoney(totalDebit)} across {rows.length}{" "}
            accounts.
          </QbBanner>
        )}

        {drifted.length > 0 ? (
          <QbBanner variant="warn" title="Cached balance drift">
            {drifted.length} account
            {drifted.length === 1 ? "'s" : "s'"} stored balance differs from the sum of its
            postings:{" "}
            {drifted.map((d) => d.account.number + " " + d.account.name).join(", ")}.
          </QbBanner>
        ) : null}

        <table className="qb-grid">
          <thead>
            <tr>
              <th style={{ width: 80 }}>Number</th>
              <th>Account</th>
              <th style={{ width: 120 }} className="text-right">Debit</th>
              <th style={{ width: 120 }} className="text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.account.id}>
                <td className="font-qbMono">
                  <Link
                    href={
                      "/dashboard/accounting/general-ledger?account=" + row.account.number
                    }
                    className="text-qb-blue hover:underline"
                  >
                    {row.account.number}
                  </Link>
                </td>
                <td>{row.account.name}</td>
                <td className="qb-grid-num">
                  {row.debitColumn === 0 ? "" : formatMoney(row.debitColumn)}
                </td>
                <td className="qb-grid-num">
                  {row.creditColumn === 0 ? "" : formatMoney(row.creditColumn)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-qb-grid-header font-bold">
              <td colSpan={2} className="border border-qb-gridLine px-1 text-right">
                TOTAL
              </td>
              <td className="border border-qb-gridLine px-1 qb-grid-num">
                {formatMoney(totalDebit)}
              </td>
              <td className="border border-qb-gridLine px-1 qb-grid-num">
                {formatMoney(totalCredit)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </QbWindow>
  );
}
