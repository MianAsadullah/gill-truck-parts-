import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney, formatPercent, formatQty, marginPct, num, round2, sumMoney } from "@/lib/money";
import { QbWindow, QbBanner, QbEmpty } from "@/components/qb/Ui";
import { cn } from "@/lib/cn";

export const metadata = { title: "Inventory Valuation — Gill Truck Parts" };

/**
 * Inventory Valuation Summary (REP).
 *
 * Quantity on hand at weighted-average cost, with retail value alongside so
 * the spread is visible. This whole report is cost-derived, which is why it
 * sits behind reports.view_inventory_valuation — a permission the counter
 * role does not hold. The page is refused outright rather than rendered with
 * blanked columns.
 */
export default async function InventoryValuationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.REPORTS_VIEW_INVENTORY_VALUATION)) {
    return (
      <QbWindow title="Inventory Valuation">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Inventory valuation is quantity multiplied by purchase cost, so it is restricted
            to roles that may view cost. Your role ({user.roleName}) may not.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const products = await prisma.product.findMany({
    where: { type: "INVENTORY", isActive: true },
    orderBy: { sku: "asc" },
    include: { category: { select: { name: true } } },
  });

  const rows = products.map((p) => {
    const onHand = num(p.quantityOnHand);
    const cost = num(p.averageCost);
    const price = num(p.standardPrice);
    return {
      id: p.id,
      sku: p.sku,
      description: p.description,
      category: p.category?.name ?? "",
      onHand,
      cost,
      price,
      assetValue: round2(onHand * cost),
      retailValue: round2(onHand * price),
      margin: marginPct(price, cost),
      negative: onHand < 0,
    };
  });

  const totalAsset = sumMoney(rows.map((r) => r.assetValue));
  const totalRetail = sumMoney(rows.map((r) => r.retailValue));
  const negatives = rows.filter((r) => r.negative);

  const glInventory = await prisma.account.findUnique({
    where: { number: "1300" },
    select: { balance: true, name: true, number: true },
  });
  const glBalance = glInventory ? num(glInventory.balance) : null;
  const drift = glBalance === null ? null : round2(glBalance - totalAsset);

  return (
    <QbWindow
      title="Inventory Valuation Summary"
      subtitle={"— " + rows.length + " stocked items"}
      bodyClassName="bg-white"
    >
      <div className="p-2 space-y-2">
        {negatives.length > 0 ? (
          <QbBanner variant="warn" title={negatives.length + " item(s) at negative quantity"}>
            {negatives.map((n) => n.sku).join(", ")}. Negative stock usually means a sale was
            entered before the receipt. Valuation of a negative quantity is not meaningful.
          </QbBanner>
        ) : null}

        {drift !== null && Math.abs(drift) > 0.005 ? (
          <QbBanner variant="err" title="Valuation does not agree with the ledger">
            The Inventory Asset account ({glInventory?.number}) shows{" "}
            {formatMoney(glBalance ?? 0)} but the items below total {formatMoney(totalAsset)}
            — a difference of {formatMoney(Math.abs(drift))}. Investigate before relying on
            either figure.
          </QbBanner>
        ) : drift !== null ? (
          <QbBanner variant="ok">
            Agrees with the Inventory Asset account ({formatMoney(glBalance ?? 0)}).
          </QbBanner>
        ) : null}

        {rows.length === 0 ? (
          <QbEmpty>No stocked items.</QbEmpty>
        ) : (
          <table className="qb-grid">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Item</th>
                <th>Description</th>
                <th style={{ width: 110 }}>Category</th>
                <th style={{ width: 64 }} className="text-right">On Hand</th>
                <th style={{ width: 78 }} className="text-right">Avg Cost</th>
                <th style={{ width: 104 }} className="text-right">Asset Value</th>
                <th style={{ width: 78 }} className="text-right">Price</th>
                <th style={{ width: 104 }} className="text-right">Retail Value</th>
                <th style={{ width: 54 }} className="text-right">GP%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={cn(r.negative && "bg-qb-errBg")}>
                  <td className="font-qbMono">{r.sku}</td>
                  <td className="truncate" title={r.description}>{r.description}</td>
                  <td className="truncate text-qb-xs">{r.category}</td>
                  <td className={cn("qb-grid-num", r.negative && "text-qb-red font-bold")}>
                    {formatQty(r.onHand)}
                  </td>
                  <td className="qb-grid-num">{formatMoney(r.cost)}</td>
                  <td className="qb-grid-num font-bold">{formatMoney(r.assetValue)}</td>
                  <td className="qb-grid-num text-qb-inkMuted">{formatMoney(r.price)}</td>
                  <td className="qb-grid-num text-qb-inkMuted">{formatMoney(r.retailValue)}</td>
                  <td className={cn("qb-grid-num", r.margin !== null && r.margin < 0.1 && "text-qb-red")}>
                    {r.margin === null ? "" : formatPercent(r.margin, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-qb-grid-header font-bold">
                <td colSpan={5} className="border border-qb-gridLine px-1 text-right">
                  TOTAL
                </td>
                <td className="border border-qb-gridLine px-1 qb-grid-num">
                  {formatMoney(totalAsset)}
                </td>
                <td className="border border-qb-gridLine" />
                <td className="border border-qb-gridLine px-1 qb-grid-num">
                  {formatMoney(totalRetail)}
                </td>
                <td className="border border-qb-gridLine px-1 qb-grid-num">
                  {(() => {
                    const m = marginPct(totalRetail, totalAsset);
                    return m === null ? "" : formatPercent(m, 1);
                  })()}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </QbWindow>
  );
}
