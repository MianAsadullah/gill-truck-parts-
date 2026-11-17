import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney, formatQty, num, sumMoney } from "@/lib/money";
import { QbWindow, QbPill, QbEmpty, QbButton, QbBanner } from "@/components/qb/Ui";

export const metadata = { title: "Purchase Orders — Gill Truck Parts" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "receivable", label: "Awaiting Receipt" },
  { key: "open", label: "Open" },
  { key: "draft", label: "Drafts" },
  { key: "closed", label: "Closed" },
] as const;

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.PURCHASING_VIEW)) {
    return (
      <QbWindow title="Purchase Orders">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot view purchasing.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const params = await searchParams;
  const filter = params.filter ?? "all";
  const q = (params.q ?? "").trim();

  const statusWhere: Prisma.PurchaseOrderWhereInput =
    filter === "receivable"
      ? { status: { in: ["OPEN", "PARTIALLY_RECEIVED"] } }
      : filter === "open"
        ? { status: "OPEN" }
        : filter === "draft"
          ? { status: "DRAFT" }
          : filter === "closed"
            ? { status: { in: ["RECEIVED", "CLOSED", "CANCELLED"] } }
            : {};

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: {
      ...statusWhere,
      ...(q
        ? {
            OR: [
              { poNumber: { contains: q, mode: "insensitive" } },
              { vendor: { companyName: { contains: q, mode: "insensitive" } } },
              { lines: { some: { sku: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    orderBy: { orderDate: "desc" },
    take: 200,
    include: {
      vendor: { select: { companyName: true, vendorNo: true } },
      createdBy: { select: { employeeCode: true } },
      lines: { select: { quantityOrdered: true, quantityReceived: true } },
      _count: { select: { receipts: true } },
    },
  });

  const total = sumMoney(purchaseOrders.map((p) => p.total));
  const canReceive = user.permissions.includes(PERM.PURCHASING_RECEIVE);

  return (
    <QbWindow
      title="Purchase Orders"
      subtitle={"— " + purchaseOrders.length + " shown"}
      toolbar={
        user.permissions.includes(PERM.PURCHASING_CREATE_PO) ? (
          <Link href="/dashboard/purchase-orders/new">
            <QbButton size="sm" variant="primary">
              New Purchase Order
            </QbButton>
          </Link>
        ) : null
      }
      bodyClassName="bg-white"
    >
      <form
        className="bg-qb-chrome border-b border-qb-line px-2 py-1 flex items-center gap-2 flex-wrap sticky top-0 z-20"
        method="get"
      >
        <span className="qb-label">View</span>
        <div className="flex items-stretch">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={
                "/dashboard/purchase-orders?filter=" +
                f.key +
                (q ? "&q=" + encodeURIComponent(q) : "")
              }
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
        <input
          name="q"
          defaultValue={q}
          className="qb-input max-w-[240px]"
          placeholder="PO number, vendor, or SKU"
          aria-label="Search purchase orders"
        />
        <QbButton type="submit" size="sm">
          Find
        </QbButton>
      </form>

      {purchaseOrders.length === 0 ? (
        <QbEmpty>
          No purchase orders match this view.{" "}
          <Link href="/dashboard/purchase-orders/new" className="text-qb-blue hover:underline">
            Create one.
          </Link>
        </QbEmpty>
      ) : (
        <table className="qb-grid">
          <thead>
            <tr>
              <th style={{ width: 92 }}>P.O. No.</th>
              <th style={{ width: 76 }}>Date</th>
              <th>Vendor</th>
              <th style={{ width: 76 }}>Expected</th>
              <th style={{ width: 40 }}>By</th>
              <th style={{ width: 110 }} className="text-right">
                Received
              </th>
              <th style={{ width: 128 }}>Status</th>
              <th style={{ width: 92 }} className="text-right">
                Total
              </th>
              <th style={{ width: 70 }}>&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {purchaseOrders.map((po) => {
              const ordered = sumMoney(po.lines.map((l) => l.quantityOrdered));
              const received = sumMoney(po.lines.map((l) => l.quantityReceived));
              const pct = ordered > 0 ? Math.round((received / ordered) * 100) : 0;
              const receivable = po.status === "OPEN" || po.status === "PARTIALLY_RECEIVED";
              const late =
                po.expectedDate !== null && po.expectedDate < new Date() && receivable;
              return (
                <tr key={po.id}>
                  <td>
                    <Link
                      href={"/dashboard/purchase-orders/" + po.id}
                      className="text-qb-blue hover:underline font-qbMono"
                    >
                      {po.poNumber}
                    </Link>
                  </td>
                  <td className="font-qbMono">
                    {po.orderDate.toLocaleDateString("en-US", {
                      month: "2-digit",
                      day: "2-digit",
                      year: "2-digit",
                    })}
                  </td>
                  <td className="truncate" title={po.vendor.companyName}>
                    {po.vendor.companyName}
                  </td>
                  <td className={"font-qbMono " + (late ? "text-qb-red font-bold" : "")}>
                    {po.expectedDate
                      ? po.expectedDate.toLocaleDateString("en-US", {
                          month: "2-digit",
                          day: "2-digit",
                          year: "2-digit",
                        })
                      : ""}
                  </td>
                  <td>{po.createdBy.employeeCode}</td>
                  <td className="qb-grid-num font-qbMono text-qb-xs">
                    {formatQty(received)} / {formatQty(ordered)}
                    {ordered > 0 ? (
                      <span className="text-qb-inkMuted"> ({pct}%)</span>
                    ) : null}
                  </td>
                  <td>
                    <QbPill status={po.status} />
                    {late ? (
                      <span className="text-qb-xs text-qb-red font-bold"> LATE</span>
                    ) : null}
                  </td>
                  <td className="qb-grid-num">{formatMoney(po.total)}</td>
                  <td className="text-center">
                    {canReceive && receivable ? (
                      <Link
                        href={"/dashboard/purchase-orders/" + po.id + "/receive"}
                        className="text-qb-xs text-qb-blue hover:underline"
                      >
                        receive
                      </Link>
                    ) : po._count.receipts > 0 ? (
                      <span className="text-qb-xs text-qb-inkMuted">
                        {po._count.receipts} rct
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-qb-grid-header font-bold">
              <td colSpan={7} className="border border-qb-gridLine px-1 text-right">
                Total ({purchaseOrders.length} order
                {purchaseOrders.length === 1 ? "" : "s"})
              </td>
              <td className="border border-qb-gridLine px-1 qb-grid-num">
                {formatMoney(total)}
              </td>
              <td className="border border-qb-gridLine" />
            </tr>
          </tfoot>
        </table>
      )}
    </QbWindow>
  );
}
