import Link from "next/link";
import { redirect } from "next/navigation";
import type { AccountType } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatAccounting, num } from "@/lib/money";
import { isDebitNormal } from "@/lib/ledger";
import { QbWindow, QbBanner, QbEmpty } from "@/components/qb/Ui";

export const metadata = { title: "Chart of Accounts — Gill Truck Parts" };

const TYPE_ORDER: AccountType[] = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "INCOME",
  "COST_OF_GOODS_SOLD",
  "EXPENSE",
  "OTHER_INCOME",
  "OTHER_EXPENSE",
];

const TYPE_LABELS: Record<AccountType, string> = {
  ASSET: "Assets",
  LIABILITY: "Liabilities",
  EQUITY: "Equity",
  INCOME: "Income",
  COST_OF_GOODS_SOLD: "Cost of Goods Sold",
  EXPENSE: "Expense",
  OTHER_INCOME: "Other Income",
  OTHER_EXPENSE: "Other Expense",
};

/**
 * Chart of Accounts (ACC).
 *
 * Grouped by account type in the conventional balance-sheet-then-P&L order,
 * with each account's running balance shown on its natural side. Balances
 * come from the `balance` column that `postJournalEntry` maintains, so this
 * list and the trial balance are always the same numbers.
 */
export default async function ChartOfAccountsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.ACCOUNTING_VIEW_GL)) {
    return (
      <QbWindow title="Chart of Accounts">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot view the general ledger.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const accounts = await prisma.account.findMany({
    orderBy: { number: "asc" },
    include: { _count: { select: { journalLines: true } } },
  });

  const grouped = TYPE_ORDER.map((type) => ({
    type,
    label: TYPE_LABELS[type],
    rows: accounts.filter((a) => a.type === type),
  })).filter((g) => g.rows.length > 0);

  return (
    <QbWindow
      title="Chart of Accounts"
      subtitle={"— " + accounts.length + " accounts"}
      bodyClassName="bg-white"
    >
      {accounts.length === 0 ? (
        <QbEmpty>No accounts have been set up.</QbEmpty>
      ) : (
        <table className="qb-grid">
          <thead>
            <tr>
              <th style={{ width: 70 }}>Number</th>
              <th>Account Name</th>
              <th style={{ width: 170 }}>Type</th>
              <th style={{ width: 60 }} className="text-center">Txns</th>
              <th style={{ width: 40 }} className="text-center">Side</th>
              <th style={{ width: 110 }} className="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((group) => (
              <>
                <tr key={group.type} className="bg-qb-grid-header">
                  <td
                    colSpan={6}
                    className="border border-qb-gridLine px-1 font-bold uppercase tracking-wide text-qb-inkMuted"
                  >
                    {group.label}
                  </td>
                </tr>
                {group.rows.map((account) => (
                  <tr key={account.id}>
                    <td className="font-qbMono">{account.number}</td>
                    <td className={account.isActive ? "" : "text-qb-inkDisabled"}>
                      {account.name}
                      {account.isSystem ? (
                        <span
                          className="text-qb-xs text-qb-blue"
                          title="Used by the posting engine; cannot be deleted"
                        >
                          {" "}
                          [system]
                        </span>
                      ) : null}
                      {!account.isActive ? (
                        <span className="text-qb-xs"> (inactive)</span>
                      ) : null}
                    </td>
                    <td className="text-qb-xs text-qb-inkMuted">
                      {account.subType.replace(/_/g, " ").toLowerCase()}
                    </td>
                    <td className="text-center text-qb-inkMuted">
                      {account._count.journalLines > 0 ? (
                        <Link
                          href={"/dashboard/accounting/general-ledger?account=" + account.number}
                          className="text-qb-blue hover:underline"
                        >
                          {account._count.journalLines}
                        </Link>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="text-center text-qb-xs text-qb-inkMuted">
                      {isDebitNormal(account.type) ? "DR" : "CR"}
                    </td>
                    <td
                      className={
                        "qb-grid-num " +
                        (num(account.balance) === 0 ? "text-qb-inkDisabled" : "")
                      }
                    >
                      {formatAccounting(account.balance)}
                    </td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      )}
      <div className="px-2 py-2 text-qb-xs text-qb-inkMuted border-t border-qb-line">
        Balances are maintained transactionally by the posting engine. Accounts marked
        [system] are referenced by invoicing, receiving and payment posting, so they cannot
        be removed.
      </div>
    </QbWindow>
  );
}
