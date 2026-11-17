import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney, sumMoney } from "@/lib/money";
import { QbWindow, QbPill, QbEmpty, QbButton, QbBanner } from "@/components/qb/Ui";

export const metadata = { title: "Invoices — Gill Truck Parts" };

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "paid", label: "Paid" },
  { key: "draft", label: "Drafts" },
  { key: "void", label: "Void" },
] as const;

/**
 * The invoice list — QuickBooks' "Invoices" centre list view: a filter strip
 * across the top, a dense grid, and a totals footer.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.SALES_VIEW)) {
    return (
      <QbWindow title="Invoices">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot view invoices.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const params = await searchParams;
  const status = params.status ?? "all";
  const q = (params.q ?? "").trim();

  const statusWhere: Prisma.InvoiceWhereInput =
    status === "open"
      ? { status: { in: ["OPEN", "PARTIALLY_PAID"] } }
      : status === "paid"
        ? { status: "PAID" }
        : status === "draft"
          ? { status: "DRAFT" }
          : status === "void"
            ? { status: "VOID" }
            : {};

  const where: Prisma.InvoiceWhereInput = {
    ...statusWhere,
    ...(q
      ? {
          OR: [
            { invoiceNo: { contains: q, mode: "insensitive" } },
            { licensePlate: { contains: q, mode: "insensitive" } },
            { poNumber: { contains: q, mode: "insensitive" } },
            { customer: { companyName: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: { invoiceDate: "desc" },
    take: 200,
    select: {
      id: true,
      invoiceNo: true,
      invoiceDate: true,
      dueDate: true,
      licensePlate: true,
      poNumber: true,
      status: true,
      total: true,
      balanceDue: true,
      customer: { select: { companyName: true, customerNo: true } },
      rep: { select: { employeeCode: true } },
      _count: { select: { lines: true, overrides: true } },
    },
  });

  const total = sumMoney(invoices.map((i) => i.total));
  const outstanding = sumMoney(invoices.map((i) => i.balanceDue));

  return (
    <QbWindow
      title="Invoices"
      subtitle={"— " + invoices.length + " shown"}
      toolbar={
        user.permissions.includes(PERM.SALES_CREATE_INVOICE) ? (
          <Link href="/dashboard/invoices/new">
            <QbButton size="sm" variant="primary">
              New Invoice
            </QbButton>
          </Link>
        ) : null
      }
      bodyClassName="bg-white"
    >
      {/* Filter strip */}
      <form
        className="bg-qb-chrome border-b border-qb-line px-2 py-1
                   flex items-center gap-2 flex-wrap sticky top-0 z-20"
        method="get"
      >
        <span className="qb-label">View</span>
        <div className="flex items-stretch">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={
                "/dashboard/invoices?status=" + f.key + (q ? "&q=" + encodeURIComponent(q) : "")
              }
              className={
                "qb-btn rounded-none border-r-0 last:border-r " +
                (status === f.key ? "bg-qb-gridSelect border-qb-field font-bold" : "")
              }
            >
              {f.label}
            </Link>
          ))}
        </div>
        <input type="hidden" name="status" value={status} />
        <input
          name="q"
          defaultValue={q}
          className="qb-input max-w-[240px]"
          placeholder="Invoice no., customer, plate, or PO"
          aria-label="Search invoices"
        />
        <QbButton type="submit" size="sm">
          Find
        </QbButton>
        {q ? (
          <Link href={"/dashboard/invoices?status=" + status} className="qb-btn qb-btn-sm">
            Clear
          </Link>
        ) : null}
      </form>

      {invoices.length === 0 ? (
        <QbEmpty>
          No invoices match this view.{" "}
          <Link href="/dashboard/invoices/new" className="text-qb-blue hover:underline">
            Create one.
          </Link>
        </QbEmpty>
      ) : (
        <table className="qb-grid">
          <thead>
            <tr>
              <th style={{ width: 92 }}>Invoice #</th>
              <th style={{ width: 76 }}>Date</th>
              <th>Customer</th>
              <th style={{ width: 84 }}>Plate</th>
              <th style={{ width: 84 }}>P.O. No.</th>
              <th style={{ width: 40 }}>Rep</th>
              <th style={{ width: 34 }} className="text-right" title="Line count">
                Ln
              </th>
              <th style={{ width: 76 }}>Due</th>
              <th style={{ width: 104 }}>Status</th>
              <th style={{ width: 88 }} className="text-right">
                Amount
              </th>
              <th style={{ width: 88 }} className="text-right">
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => {
              const overdue =
                inv.dueDate !== null &&
                inv.dueDate < new Date() &&
                Number(inv.balanceDue) > 0;
              return (
                <tr key={inv.id}>
                  <td>
                    <Link
                      href={"/dashboard/invoices/" + inv.id}
                      className="text-qb-blue hover:underline font-qbMono"
                    >
                      {inv.invoiceNo}
                    </Link>
                    {inv._count.overrides > 0 ? (
                      <span
                        className="text-qb-red font-bold"
                        title={
                          inv._count.overrides +
                          " price override(s) recorded on this invoice"
                        }
                      >
                        {" ⚠"}
                      </span>
                    ) : null}
                  </td>
                  <td className="font-qbMono">
                    {inv.invoiceDate.toLocaleDateString("en-US", {
                      month: "2-digit",
                      day: "2-digit",
                      year: "2-digit",
                    })}
                  </td>
                  <td className="truncate" title={inv.customer.companyName}>
                    {inv.customer.companyName}
                  </td>
                  <td className="font-qbMono">{inv.licensePlate ?? ""}</td>
                  <td className="font-qbMono text-qb-xs">{inv.poNumber ?? ""}</td>
                  <td>{inv.rep?.employeeCode ?? ""}</td>
                  <td className="qb-grid-num text-qb-inkMuted">{inv._count.lines}</td>
                  <td className={"font-qbMono " + (overdue ? "text-qb-red font-bold" : "")}>
                    {inv.dueDate
                      ? inv.dueDate.toLocaleDateString("en-US", {
                          month: "2-digit",
                          day: "2-digit",
                          year: "2-digit",
                        })
                      : ""}
                  </td>
                  <td>
                    <QbPill status={inv.status} />
                    {overdue ? (
                      <span className="text-qb-xs text-qb-red font-bold"> OVERDUE</span>
                    ) : null}
                  </td>
                  <td className="qb-grid-num">{formatMoney(inv.total)}</td>
                  <td
                    className={
                      "qb-grid-num " +
                      (Number(inv.balanceDue) > 0 ? "font-bold" : "text-qb-inkMuted")
                    }
                  >
                    {formatMoney(inv.balanceDue)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-qb-grid-header font-bold">
              <td colSpan={9} className="border border-qb-gridLine px-1 text-right">
                Totals ({invoices.length} invoice{invoices.length === 1 ? "" : "s"})
              </td>
              <td className="border border-qb-gridLine px-1 qb-grid-num">
                {formatMoney(total)}
              </td>
              <td className="border border-qb-gridLine px-1 qb-grid-num">
                {formatMoney(outstanding)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </QbWindow>
  );
}
