import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney, num, round2, sumMoney } from "@/lib/money";
import { agingBucket, AGING_BUCKETS, type AgingBucketLabel } from "@/lib/ledger";
import { QbWindow, QbBanner, QbEmpty, QbButton, QbInput } from "@/components/qb/Ui";

export const metadata = { title: "A/P Aging Summary — Gill Truck Parts" };

const BUCKETS = AGING_BUCKETS.map((b) => b.label);

/**
 * A/P Aging Summary (ACC).
 *
 * Includes BOTH open bills and item receipts that have not yet been billed.
 * That second group matters: receiving parts creates the liability
 * immediately (DR Inventory / CR A/P), so an aging that only counted bills
 * would understate what is owed by exactly the amount sitting on the
 * receiving dock waiting for paperwork. QuickBooks shows item receipts in
 * A/P for the same reason.
 */
export default async function ApAgingPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.PURCHASING_VIEW)) {
    return (
      <QbWindow title="A/P Aging Summary">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot view payables.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const params = await searchParams;
  const asOf = params.asOf ? new Date(params.asOf + "T23:59:59") : new Date();

  const [bills, unbilledReceipts] = await Promise.all([
    prisma.bill.findMany({
      where: {
        status: { in: ["OPEN", "PARTIALLY_PAID"] },
        balanceDue: { gt: 0 },
        billDate: { lte: asOf },
      },
      select: {
        id: true,
        billNo: true,
        billDate: true,
        dueDate: true,
        balanceDue: true,
        vendor: { select: { id: true, vendorNo: true, companyName: true } },
      },
    }),
    prisma.receipt.findMany({
      where: { isBilled: false, receivedDate: { lte: asOf } },
      select: {
        id: true,
        receiptNo: true,
        receivedDate: true,
        lines: { select: { amount: true } },
        po: {
          select: {
            poNumber: true,
            vendor: { select: { id: true, vendorNo: true, companyName: true } },
          },
        },
      },
    }),
  ]);

  type Row = {
    vendorId: string;
    vendorNo: string;
    name: string;
    buckets: Record<string, number>;
    total: number;
    unbilled: number;
  };

  const byVendor = new Map<string, Row>();

  function rowFor(v: { id: string; vendorNo: string; companyName: string }): Row {
    let row = byVendor.get(v.id);
    if (!row) {
      row = {
        vendorId: v.id,
        vendorNo: v.vendorNo,
        name: v.companyName,
        buckets: Object.fromEntries(BUCKETS.map((b) => [b, 0])),
        total: 0,
        unbilled: 0,
      };
      byVendor.set(v.id, row);
    }
    return row;
  }

  for (const bill of bills) {
    const row = rowFor(bill.vendor);
    const bucket: AgingBucketLabel = agingBucket(bill.dueDate, asOf);
    const amount = num(bill.balanceDue);
    row.buckets[bucket] = round2(row.buckets[bucket] + amount);
    row.total = round2(row.total + amount);
  }

  for (const receipt of unbilledReceipts) {
    const vendor = receipt.po.vendor;
    const row = rowFor(vendor);
    const amount = sumMoney(receipt.lines.map((l) => l.amount));
    if (amount === 0) continue;
    // An unbilled receipt has no due date yet, so it ages from the day the
    // parts arrived.
    const bucket: AgingBucketLabel = agingBucket(receipt.receivedDate, asOf);
    row.buckets[bucket] = round2(row.buckets[bucket] + amount);
    row.total = round2(row.total + amount);
    row.unbilled = round2(row.unbilled + amount);
  }

  const rows = [...byVendor.values()].sort((a, b) => b.total - a.total);
  const columnTotals = Object.fromEntries(
    BUCKETS.map((b) => [b, sumMoney(rows.map((r) => r.buckets[b]))]),
  );
  const grandTotal = sumMoney(rows.map((r) => r.total));
  const unbilledTotal = sumMoney(rows.map((r) => r.unbilled));

  return (
    <QbWindow
      title="A/P Aging Summary"
      subtitle={"— as of " + asOf.toLocaleDateString("en-US")}
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
          <QbInput
            id="asOf"
            name="asOf"
            type="date"
            defaultValue={params.asOf ?? ""}
            className="w-[140px]"
          />
        </div>
        <QbButton type="submit" size="sm">
          Refresh
        </QbButton>
        <Link href="/dashboard/bills?filter=unpaid" className="qb-btn qb-btn-sm">
          Pay Bills
        </Link>
      </form>

      <div className="p-2 space-y-2">
        {unbilledTotal > 0 ? (
          <QbBanner variant="warn" title="Includes item receipts not yet billed">
            {formatMoney(unbilledTotal)} of the total below is stock that has been received
            but whose vendor invoice has not arrived. The liability is real — the parts are
            on the shelf — but there is no bill to pay against it yet.
          </QbBanner>
        ) : null}

        {rows.length === 0 ? (
          <QbEmpty>Nothing owed. Every bill is paid.</QbEmpty>
        ) : (
          <table className="qb-grid">
            <thead>
              <tr>
                <th style={{ width: 64 }}>No.</th>
                <th>Vendor</th>
                {BUCKETS.map((b) => (
                  <th key={b} style={{ width: 96 }} className="text-right">
                    {b}
                  </th>
                ))}
                <th style={{ width: 104 }} className="text-right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.vendorId}>
                  <td className="font-qbMono">{row.vendorNo}</td>
                  <td className="truncate" title={row.name}>
                    {row.name}
                    {row.unbilled > 0 ? (
                      <span
                        className="text-qb-xs text-qb-amber"
                        title="Includes unbilled item receipts"
                      >
                        {" "}
                        (incl. {formatMoney(row.unbilled)} unbilled)
                      </span>
                    ) : null}
                  </td>
                  {BUCKETS.map((b) => (
                    <td
                      key={b}
                      className={
                        "qb-grid-num " +
                        (row.buckets[b] === 0
                          ? "text-qb-inkDisabled"
                          : b === "> 90"
                            ? "text-qb-red font-bold"
                            : b !== "Current"
                              ? "text-qb-amber"
                              : "")
                      }
                    >
                      {row.buckets[b] === 0 ? "" : formatMoney(row.buckets[b])}
                    </td>
                  ))}
                  <td className="qb-grid-num font-bold">{formatMoney(row.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-qb-grid-header font-bold">
                <td colSpan={2} className="border border-qb-gridLine px-1 text-right">
                  TOTAL
                </td>
                {BUCKETS.map((b) => (
                  <td key={b} className="border border-qb-gridLine px-1 qb-grid-num">
                    {formatMoney(columnTotals[b] ?? 0)}
                  </td>
                ))}
                <td className="border border-qb-gridLine px-1 qb-grid-num">
                  {formatMoney(grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </QbWindow>
  );
}
