import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney, formatPercent, formatQty, marginPct, num, round2, sumMoney } from "@/lib/money";
import { QbWindow, QbBanner, QbEmpty, QbButton, QbInput } from "@/components/qb/Ui";
import { cn } from "@/lib/cn";

export const metadata = { title: "Sales by Item — Gill Truck Parts" };

/**
 * Sales by Item Summary (REP).
 *
 * Margin columns are gated on reports.view_profit, and the cost figures
 * behind them are only selected from the database when that permission is
 * held — a counter login sees units and revenue only.
 */
export default async function SalesSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.REPORTS_VIEW_SALES)) {
    return (
      <QbWindow title="Sales by Item Summary">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot run sales reports.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const showProfit = user.permissions.includes(PERM.REPORTS_VIEW_PROFIT);
  const params = await searchParams;

  const from = params.from ? new Date(params.from + "T00:00:00") : null;
  const to = params.to ? new Date(params.to + "T23:59:59") : null;

  const lineWhere = {
    invoice: {
      status: { not: "VOID" as const },
      ...(from || to
        ? { invoiceDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
  };

  /**
   * One normalized row shape, built from two separate queries rather than a
   * conditional `select`. The privileged query asks for costAmount; the
   * unprivileged one does not, so cost never reaches this process for a role
   * that may not see it — and because each branch has a literal select,
   * Prisma's inference stays intact and no casts are needed.
   */
  type SalesLine = {
    sku: string | null;
    description: string;
    itemType: string;
    quantity: number;
    amount: number;
    costAmount: number | null;
  };

  const lines: SalesLine[] = showProfit
    ? (
        await prisma.invoiceLine.findMany({
          where: lineWhere,
          select: {
            sku: true,
            description: true,
            itemType: true,
            quantity: true,
            amount: true,
            costAmount: true,
          },
        })
      ).map((l) => ({
        sku: l.sku,
        description: l.description,
        itemType: String(l.itemType),
        quantity: num(l.quantity),
        amount: num(l.amount),
        costAmount: num(l.costAmount),
      }))
    : (
        await prisma.invoiceLine.findMany({
          where: lineWhere,
          select: {
            sku: true,
            description: true,
            itemType: true,
            quantity: true,
            amount: true,
          },
        })
      ).map((l) => ({
        sku: l.sku,
        description: l.description,
        itemType: String(l.itemType),
        quantity: num(l.quantity),
        amount: num(l.amount),
        costAmount: null,
      }));

  type Agg = {
    key: string;
    sku: string;
    description: string;
    itemType: string;
    qty: number;
    revenue: number;
    cost: number;
  };

  const byItem = new Map<string, Agg>();
  for (const line of lines) {
    const key = line.sku ?? "(" + line.itemType + ") " + line.description;
    const agg = byItem.get(key) ?? {
      key,
      sku: line.sku ?? "—",
      description: line.description,
      itemType: line.itemType,
      qty: 0,
      revenue: 0,
      cost: 0,
    };
    agg.qty = round2(agg.qty + line.quantity);
    agg.revenue = round2(agg.revenue + line.amount);
    agg.cost = round2(agg.cost + (line.costAmount ?? 0));
    byItem.set(key, agg);
  }

  const rows = [...byItem.values()].sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = sumMoney(rows.map((r) => r.revenue));
  const totalCost = showProfit ? sumMoney(rows.map((r) => r.cost)) : 0;
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);

  return (
    <QbWindow
      title="Sales by Item Summary"
      subtitle={
        "— " +
        (from ? from.toLocaleDateString("en-US") : "all time") +
        " to " +
        (to ? to.toLocaleDateString("en-US") : "today")
      }
      bodyClassName="bg-white"
    >
      <form
        method="get"
        className="bg-qb-chrome border-b border-qb-line px-2 py-1 flex items-end gap-2 sticky top-0 z-20"
      >
        <div>
          <label htmlFor="from" className="qb-label block">From</label>
          <QbInput id="from" name="from" type="date" defaultValue={params.from ?? ""} className="w-[140px]" />
        </div>
        <div>
          <label htmlFor="to" className="qb-label block">To</label>
          <QbInput id="to" name="to" type="date" defaultValue={params.to ?? ""} className="w-[140px]" />
        </div>
        <QbButton type="submit" size="sm">Refresh</QbButton>
        <span className="ml-auto text-qb-xs text-qb-inkMuted">
          {rows.length} items &middot; {formatMoney(totalRevenue)} revenue
        </span>
      </form>

      {rows.length === 0 ? (
        <QbEmpty>No sales in this period.</QbEmpty>
      ) : (
        <table className="qb-grid">
          <thead>
            <tr>
              <th style={{ width: 130 }}>Item</th>
              <th>Description</th>
              <th style={{ width: 70 }} className="text-right">Units</th>
              <th style={{ width: 110 }} className="text-right">Revenue</th>
              <th style={{ width: 58 }} className="text-right">% of Sales</th>
              {showProfit ? (
                <>
                  <th style={{ width: 110 }} className="text-right">Cost</th>
                  <th style={{ width: 110 }} className="text-right">Gross Profit</th>
                  <th style={{ width: 58 }} className="text-right">GP%</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const gp = showProfit ? round2(r.revenue - r.cost) : 0;
              const pct = showProfit ? marginPct(r.revenue, r.cost) : null;
              return (
                <tr key={r.key}>
                  <td className="font-qbMono">{r.sku}</td>
                  <td className="truncate" title={r.description}>{r.description}</td>
                  <td className="qb-grid-num">{formatQty(r.qty)}</td>
                  <td className="qb-grid-num">{formatMoney(r.revenue)}</td>
                  <td className="qb-grid-num text-qb-inkMuted">
                    {totalRevenue > 0 ? ((r.revenue / totalRevenue) * 100).toFixed(1) + "%" : ""}
                  </td>
                  {showProfit ? (
                    <>
                      <td className="qb-grid-num text-qb-inkMuted">{formatMoney(r.cost)}</td>
                      <td className={cn("qb-grid-num", gp < 0 && "text-qb-red font-bold")}>
                        {formatMoney(gp)}
                      </td>
                      <td className={cn("qb-grid-num", pct !== null && pct < 0.1 && "text-qb-red")}>
                        {pct === null ? "" : formatPercent(pct, 1)}
                      </td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-qb-grid-header font-bold">
              <td colSpan={2} className="border border-qb-gridLine px-1 text-right">TOTAL</td>
              <td className="border border-qb-gridLine px-1 qb-grid-num">{formatQty(totalQty)}</td>
              <td className="border border-qb-gridLine px-1 qb-grid-num">{formatMoney(totalRevenue)}</td>
              <td className="border border-qb-gridLine px-1 qb-grid-num">100.0%</td>
              {showProfit ? (
                <>
                  <td className="border border-qb-gridLine px-1 qb-grid-num">{formatMoney(totalCost)}</td>
                  <td className="border border-qb-gridLine px-1 qb-grid-num">
                    {formatMoney(round2(totalRevenue - totalCost))}
                  </td>
                  <td className="border border-qb-gridLine px-1 qb-grid-num">
                    {(() => {
                      const m = marginPct(totalRevenue, totalCost);
                      return m === null ? "" : formatPercent(m, 1);
                    })()}
                  </td>
                </>
              ) : null}
            </tr>
          </tfoot>
        </table>
      )}
    </QbWindow>
  );
}
