import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney, formatPercent, num, round2, sumMoney } from "@/lib/money";
import { QbWindow, QbBanner, QbEmpty, QbButton, QbInput } from "@/components/qb/Ui";

export const metadata = { title: "Sales Tax Liability — Gill Truck Parts" };

/**
 * Sales Tax Liability (REP).
 *
 * Splits each tax code's sales into taxable and non-taxable and shows the
 * tax actually collected, then reconciles the total against the Sales Tax
 * Payable account. The reconciliation line is the point of the report: a
 * mismatch between what was charged and what was posted is what turns into
 * a problem at filing time.
 */
export default async function SalesTaxPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.REPORTS_VIEW_SALES)) {
    return (
      <QbWindow title="Sales Tax Liability">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot run sales reports.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const params = await searchParams;
  const from = params.from ? new Date(params.from + "T00:00:00") : null;
  const to = params.to ? new Date(params.to + "T23:59:59") : null;

  const invoices = await prisma.invoice.findMany({
    where: {
      status: { not: "VOID" },
      ...(from || to
        ? { invoiceDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    select: {
      id: true,
      subtotal: true,
      taxTotal: true,
      taxRate: true,
      taxCode: { select: { id: true, code: true, name: true, rate: true, agency: true } },
      customer: { select: { taxExempt: true } },
      lines: { select: { amount: true, isTaxable: true } },
    },
  });

  type Bucket = {
    key: string;
    code: string;
    name: string;
    agency: string;
    rate: number;
    taxable: number;
    nonTaxable: number;
    tax: number;
    invoices: number;
  };

  const buckets = new Map<string, Bucket>();

  for (const inv of invoices) {
    const key = inv.taxCode?.id ?? (inv.customer.taxExempt ? "EXEMPT" : "NONE");
    const bucket = buckets.get(key) ?? {
      key,
      code: inv.taxCode?.code ?? (inv.customer.taxExempt ? "EXEMPT" : "NON"),
      name: inv.taxCode?.name ?? (inv.customer.taxExempt ? "Tax exempt / resale" : "No tax code"),
      agency: inv.taxCode?.agency ?? "—",
      rate: num(inv.taxCode?.rate ?? inv.taxRate),
      taxable: 0,
      nonTaxable: 0,
      tax: 0,
      invoices: 0,
    };

    const taxable = sumMoney(inv.lines.filter((l) => l.isTaxable).map((l) => l.amount));
    const nonTaxable = sumMoney(inv.lines.filter((l) => !l.isTaxable).map((l) => l.amount));

    // A tax-exempt customer's lines may still be flagged taxable on the
    // item; what matters for the return is that no tax was charged.
    bucket.taxable = round2(bucket.taxable + (inv.customer.taxExempt ? 0 : taxable));
    bucket.nonTaxable = round2(
      bucket.nonTaxable + (inv.customer.taxExempt ? taxable + nonTaxable : nonTaxable),
    );
    bucket.tax = round2(bucket.tax + num(inv.taxTotal));
    bucket.invoices += 1;
    buckets.set(key, bucket);
  }

  const rows = [...buckets.values()].sort((a, b) => b.tax - a.tax);
  const totalTaxable = sumMoney(rows.map((r) => r.taxable));
  const totalNonTaxable = sumMoney(rows.map((r) => r.nonTaxable));
  const totalTax = sumMoney(rows.map((r) => r.tax));

  const payable = await prisma.account.findUnique({
    where: { number: "2200" },
    select: { balance: true, number: true, name: true },
  });
  const glTax = payable ? num(payable.balance) : null;
  // Only comparable when the report covers all time.
  const comparable = !from && !to && glTax !== null;
  const drift = comparable ? round2(glTax - totalTax) : null;

  return (
    <QbWindow
      title="Sales Tax Liability"
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
      </form>

      <div className="p-2 space-y-2">
        {drift !== null && Math.abs(drift) > 0.005 ? (
          <QbBanner variant="err" title="Collected tax does not agree with the ledger">
            Sales Tax Payable ({payable?.number}) shows {formatMoney(glTax ?? 0)} but invoices
            total {formatMoney(totalTax)} — a difference of {formatMoney(Math.abs(drift))}.
          </QbBanner>
        ) : comparable ? (
          <QbBanner variant="ok">
            Agrees with Sales Tax Payable ({formatMoney(glTax ?? 0)}).
          </QbBanner>
        ) : null}

        {rows.length === 0 ? (
          <QbEmpty>No sales in this period.</QbEmpty>
        ) : (
          <table className="qb-grid">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Tax Code</th>
                <th>Jurisdiction</th>
                <th style={{ width: 110 }}>Agency</th>
                <th style={{ width: 60 }} className="text-right">Rate</th>
                <th style={{ width: 54 }} className="text-right">Invoices</th>
                <th style={{ width: 116 }} className="text-right">Taxable Sales</th>
                <th style={{ width: 116 }} className="text-right">Non-Taxable</th>
                <th style={{ width: 110 }} className="text-right">Tax Collected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="font-qbMono">{r.code}</td>
                  <td>{r.name}</td>
                  <td className="text-qb-xs">{r.agency}</td>
                  <td className="qb-grid-num">{formatPercent(r.rate, 3)}</td>
                  <td className="qb-grid-num text-qb-inkMuted">{r.invoices}</td>
                  <td className="qb-grid-num">{formatMoney(r.taxable)}</td>
                  <td className="qb-grid-num text-qb-inkMuted">{formatMoney(r.nonTaxable)}</td>
                  <td className="qb-grid-num font-bold">{formatMoney(r.tax)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-qb-grid-header font-bold">
                <td colSpan={5} className="border border-qb-gridLine px-1 text-right">TOTAL</td>
                <td className="border border-qb-gridLine px-1 qb-grid-num">{formatMoney(totalTaxable)}</td>
                <td className="border border-qb-gridLine px-1 qb-grid-num">{formatMoney(totalNonTaxable)}</td>
                <td className="border border-qb-gridLine px-1 qb-grid-num">{formatMoney(totalTax)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </QbWindow>
  );
}
