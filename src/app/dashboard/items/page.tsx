import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney, formatPercent, formatQty, marginPct, num, sumMoney } from "@/lib/money";
import { QbWindow, QbBanner, QbEmpty, QbButton, QbInput } from "@/components/qb/Ui";
import { cn } from "@/lib/cn";

export const metadata = { title: "Item List — Gill Truck Parts" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "stocked", label: "Stocked" },
  { key: "low-stock", label: "Reorder" },
  { key: "service", label: "Service & Fees" },
  { key: "inactive", label: "Inactive" },
] as const;

/**
 * Item List (INV).
 *
 * The Cost, Margin and Value columns exist only for roles holding
 * inventory.view_cost, and — just as important — the cost columns are
 * omitted from the Prisma `select` for everyone else, so the figures never
 * enter the server process on a counter session, let alone the HTML.
 */
export default async function ItemListPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.INVENTORY_VIEW)) {
    return (
      <QbWindow title="Item List">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot view inventory.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const canViewCost = user.permissions.includes(PERM.INVENTORY_VIEW_COST);
  const canEdit = user.permissions.includes(PERM.INVENTORY_EDIT);
  const canAdjust = user.permissions.includes(PERM.INVENTORY_ADJUST);

  const params = await searchParams;
  const filter = params.filter ?? "all";
  const q = (params.q ?? "").trim();

  const filterWhere: Prisma.ProductWhereInput =
    filter === "stocked"
      ? { type: "INVENTORY", isActive: true }
      : filter === "service"
        ? { type: { in: ["SERVICE", "OTHER_CHARGE", "NON_INVENTORY"] }, isActive: true }
        : filter === "inactive"
          ? { isActive: false }
          : { isActive: true };

  const products = await prisma.product.findMany({
    where: {
      ...filterWhere,
      ...(q
        ? {
            OR: [
              { sku: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
              { barcode: { equals: q } },
              { binLocation: { contains: q, mode: "insensitive" } },
              { crossReferences: { some: { number: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    orderBy: { sku: "asc" },
    take: 400,
    select: {
      id: true,
      sku: true,
      type: true,
      description: true,
      unitOfMeasure: true,
      binLocation: true,
      standardPrice: true,
      minimumPrice: true,
      quantityOnHand: true,
      quantityOnOrder: true,
      quantityCommitted: true,
      reorderPoint: true,
      isActive: true,
      category: { select: { name: true } },
      brand: { select: { name: true } },
    },
  });

  // The cost firewall at query level. Costs are fetched in a SECOND query
  // that only runs for a privileged role, rather than as a conditional
  // spread inside the select above — a conditional select collapses
  // Prisma's inferred type to `unknown` and would force casts right where
  // the cost values are handled. This way the SQL for a counter session
  // genuinely never mentions a cost column, and the types stay honest.
  const costById = new Map<string, number>();
  if (canViewCost && products.length > 0) {
    const costs = await prisma.product.findMany({
      where: { id: { in: products.map((p) => p.id) } },
      select: { id: true, averageCost: true },
    });
    for (const c of costs) costById.set(c.id, num(c.averageCost));
  }

  // `low-stock` compares two columns, which Prisma cannot express in a
  // `where`, so it is applied after the fetch.
  const rows =
    filter === "low-stock"
      ? products.filter(
          (p) =>
            p.type === "INVENTORY" &&
            num(p.reorderPoint) > 0 &&
            num(p.quantityOnHand) <= num(p.reorderPoint),
        )
      : products;

  const inventoryValue = canViewCost
    ? sumMoney(
        rows
          .filter((p) => p.type === "INVENTORY")
          .map((p) => num(p.quantityOnHand) * (costById.get(p.id) ?? 0)),
      )
    : null;

  return (
    <QbWindow
      title="Item List"
      subtitle={"— " + rows.length + " items"}
      toolbar={
        <>
          {canAdjust ? (
            <Link href="/dashboard/items/adjust">
              <QbButton size="sm">Adjust Quantity</QbButton>
            </Link>
          ) : null}
          {canEdit ? (
            <Link href="/dashboard/items/new">
              <QbButton size="sm" variant="primary">
                New Item
              </QbButton>
            </Link>
          ) : null}
        </>
      }
      bodyClassName="bg-white"
    >
      <form
        method="get"
        className="bg-qb-chrome border-b border-qb-line px-2 py-1 flex items-center gap-2 flex-wrap sticky top-0 z-20"
      >
        <span className="qb-label">View</span>
        <div className="flex items-stretch">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={"/dashboard/items?filter=" + f.key + (q ? "&q=" + encodeURIComponent(q) : "")}
              className={
                "qb-btn rounded-none border-r-0 last:border-r " +
                (filter === f.key ? "bg-qb-gridSelect border-qb-field font-bold" : "")
              }
            >
              {f.label}
            </Link>
          ))}
        </div>
        <input type="hidden" name="filter" value={filter} />
        <QbInput
          name="q"
          defaultValue={q}
          className="max-w-[260px]"
          placeholder="SKU, description, OEM number, barcode, bin"
          aria-label="Search items"
        />
        <QbButton type="submit" size="sm">
          Find
        </QbButton>
        {inventoryValue !== null ? (
          <span className="ml-auto text-qb-xs text-qb-inkMuted">
            Inventory value shown: {formatMoney(inventoryValue)}
          </span>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <QbEmpty>No items match this view.</QbEmpty>
      ) : (
        <table className="qb-grid">
          <thead>
            <tr>
              <th style={{ width: 116 }}>Item</th>
              <th>Description</th>
              <th style={{ width: 110 }}>Category</th>
              <th style={{ width: 46 }}>Bin</th>
              <th style={{ width: 54 }} className="text-right">On Hand</th>
              <th style={{ width: 54 }} className="text-right">On PO</th>
              <th style={{ width: 54 }} className="text-right">Reorder</th>
              <th style={{ width: 72 }} className="text-right">Price</th>
              <th style={{ width: 68 }} className="text-right">Min</th>
              {canViewCost ? (
                <>
                  <th style={{ width: 68 }} className="text-right">Avg Cost</th>
                  <th style={{ width: 52 }} className="text-right">GP%</th>
                  <th style={{ width: 84 }} className="text-right">Value</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const onHand = num(p.quantityOnHand);
              const reorder = num(p.reorderPoint);
              const stocked = p.type === "INVENTORY";
              const low = stocked && reorder > 0 && onHand <= reorder;
              const cost = canViewCost ? (costById.get(p.id) ?? 0) : null;
              const gp = cost === null ? null : marginPct(num(p.standardPrice), cost);
              return (
                <tr key={p.id} className={cn(!p.isActive && "text-qb-inkDisabled")}>
                  <td className="font-qbMono">
                    {canEdit ? (
                      <Link
                        href={"/dashboard/items/" + p.id}
                        className="text-qb-blue hover:underline"
                      >
                        {p.sku}
                      </Link>
                    ) : (
                      p.sku
                    )}
                  </td>
                  <td className="truncate" title={p.description}>
                    {p.description}
                    {!stocked ? (
                      <span className="text-qb-inkMuted text-qb-xs">
                        {" · "}
                        {p.type === "SERVICE" ? "service" : p.type === "OTHER_CHARGE" ? "charge" : "non-stock"}
                      </span>
                    ) : null}
                  </td>
                  <td className="truncate text-qb-xs">{p.category?.name ?? ""}</td>
                  <td className="text-qb-xs">{p.binLocation ?? ""}</td>
                  <td
                    className={cn(
                      "qb-grid-num",
                      stocked && onHand <= 0 && "text-qb-red font-bold",
                      low && onHand > 0 && "text-qb-amber font-bold",
                    )}
                    title={low ? "At or below reorder point" : undefined}
                  >
                    {stocked ? formatQty(onHand) : "—"}
                  </td>
                  <td className="qb-grid-num text-qb-inkMuted">
                    {stocked && num(p.quantityOnOrder) > 0
                      ? formatQty(p.quantityOnOrder)
                      : ""}
                  </td>
                  <td className="qb-grid-num text-qb-inkMuted">
                    {stocked && reorder > 0 ? formatQty(reorder) : ""}
                  </td>
                  <td className="qb-grid-num">{formatMoney(p.standardPrice)}</td>
                  <td className="qb-grid-num text-qb-inkMuted">
                    {formatMoney(p.minimumPrice)}
                  </td>
                  {canViewCost ? (
                    <>
                      <td className="qb-grid-num">{cost === null ? "" : formatMoney(cost)}</td>
                      <td
                        className={cn(
                          "qb-grid-num",
                          gp !== null && gp < 0.1 && "text-qb-red font-bold",
                        )}
                      >
                        {gp === null ? "" : formatPercent(gp, 1)}
                      </td>
                      <td className="qb-grid-num text-qb-inkMuted">
                        {stocked && cost !== null ? formatMoney(onHand * cost) : ""}
                      </td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </QbWindow>
  );
}
