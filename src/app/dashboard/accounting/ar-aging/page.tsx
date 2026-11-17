import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney, num, round2, sumMoney } from "@/lib/money";
import { agingBucket, AGING_BUCKETS, type AgingBucketLabel } from "@/lib/ledger";
import { QbWindow, QbBanner, QbEmpty, QbButton, QbInput } from "@/components/qb/Ui";

export const metadata = { title: "A/R Aging Summary — Gill Truck Parts" };

const BUCKETS = AGING_BUCKETS.map((b) => b.label);

/**
 * A/R Aging Summary (ACC).
 *
 * Buckets every open invoice by how far past its due date it is, as of the
 * chosen date. Unapplied customer payments are shown as a negative line,
 * because a customer sitting on a credit is not the same as one who owes
 * nothing — and netting it silently would overstate what is collectable.
 */
export default async function ArAgingPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.SALES_VIEW)) {
    return (
      <QbWindow title="A/R Aging Summary">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot view receivables.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const params = await searchParams;
  const asOf = params.asOf ? new Date(params.asOf + "T23:59:59") : new Date();

  const [invoices, credits] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        status: { in: ["OPEN", "PARTIALLY_PAID"] },
        balanceDue: { gt: 0 },
        invoiceDate: { lte: asOf },
      },
      select: {
        id: true,
        invoiceNo: true,
        invoiceDate: true,
        dueDate: true,
        balanceDue: true,
        customer: { select: { id: true, customerNo: true, companyName: true } },
      },
      orderBy: { dueDate: "asc" },
    }),
    prisma.customerPayment.findMany({
      where: { unapplied: { gt: 0 }, paymentDate: { lte: asOf } },
      select: {
        id: true,
        unapplied: true,
        customer: { select: { id: true, customerNo: true, companyName: true } },
      },
    }),
  ]);

  type Row = {
    customerId: string;
    customerNo: string;
    name: string;
    buckets: Record<string, number>;
    total: number;
    oldest: number;
  };

  const byCustomer = new Map<string, Row>();

  function rowFor(c: { id: string; customerNo: string; companyName: string }): Row {
    let row = byCustomer.get(c.id);
    if (!row) {
      row = {
        customerId: c.id,
        customerNo: c.customerNo,
        name: c.companyName,
        buckets: Object.fromEntries(BUCKETS.map((b) => [b, 0])),
        total: 0,
        oldest: 0,
      };
      byCustomer.set(c.id, row);
    }
    return row;
  }

  for (const invoice of invoices) {
    const row = rowFor(invoice.customer);
    const bucket: AgingBucketLabel = agingBucket(invoice.dueDate, asOf);
    const amount = num(invoice.balanceDue);
    row.buckets[bucket] = round2(row.buckets[bucket] + amount);
    row.total = round2(row.total + amount);
    if (invoice.dueDate) {
      const days = Math.floor((asOf.getTime() - invoice.dueDate.getTime()) / 86_400_000);
      if (days > row.oldest) row.oldest = days;
    }
  }

  for (const credit of credits) {
    const row = rowFor(credit.customer);
    const amount = round2(-num(credit.unapplied));
    row.buckets.Current = round2(row.buckets.Current + amount);
    row.total = round2(row.total + amount);
  }

  const rows = [...byCustomer.values()].sort((a, b) => b.total - a.total);
  const columnTotals = Object.fromEntries(
    BUCKETS.map((b) => [b, sumMoney(rows.map((r) => r.buckets[b]))]),
  );
  const grandTotal = sumMoney(rows.map((r) => r.total));
  const pastDue = round2(grandTotal - (columnTotals.Current ?? 0));

  return (
    <QbWindow
      title="A/R Aging Summary"
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
        <span className="ml-auto text-qb-xs text-qb-inkMuted">
          {formatMoney(pastDue)} of {formatMoney(grandTotal)} is past due
        </span>
      </form>

      {rows.length === 0 ? (
        <QbEmpty>Nothing outstanding. Every invoice is paid.</QbEmpty>
      ) : (
        <table className="qb-grid">
          <thead>
            <tr>
              <th style={{ width: 64 }}>No.</th>
              <th>Customer</th>
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
              <tr key={row.customerId}>
                <td className="font-qbMono">{row.customerNo}</td>
                <td className="truncate" title={row.name}>
                  <Link
                    href={"/dashboard/invoices?q=" + encodeURIComponent(row.name)}
                    className="text-qb-blue hover:underline"
                  >
                    {row.name}
                  </Link>
                  {row.oldest > 90 ? (
                    <span className="text-qb-xs text-qb-red font-bold">
                      {" "}
                      {row.oldest}d
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

      <div className="px-2 py-2 text-qb-xs text-qb-inkMuted border-t border-qb-line">
        Aged by due date. Unapplied customer payments appear as negative amounts in the
        Current column rather than being netted away, so a customer holding a credit is
        visibly different from one with a clean account.
      </div>
    </QbWindow>
  );
}
