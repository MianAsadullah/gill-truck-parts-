import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney, formatQty, formatPercent, num, marginPct } from "@/lib/money";
import {
  QbWindow,
  QbPill,
  QbButton,
  QbBanner,
  QbFieldset,
} from "@/components/qb/Ui";

/**
 * Invoice detail.
 *
 * The cost and margin columns, and the entire override/GL panel, are gated
 * on permissions — and the cost figures are stripped from the query result
 * before render for roles without inventory.view_cost, so a counter
 * terminal's HTML contains no cost at all.
 */
export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.permissions.includes(PERM.SALES_VIEW)) {
    return (
      <QbWindow title="Invoice">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role cannot view invoices.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const { id } = await params;
  const canViewCost = user.permissions.includes(PERM.INVENTORY_VIEW_COST);
  const canViewMargin = user.permissions.includes(PERM.INVENTORY_VIEW_MARGIN);
  const canViewGl = user.permissions.includes(PERM.ACCOUNTING_VIEW_GL);
  const canViewAudit = user.permissions.includes(PERM.AUDIT_VIEW);

  // The override and GL panels are fetched as SEPARATE, conditional queries
  // rather than as a conditional `include`. Two reasons: a conditional
  // include collapses Prisma's inferred type to the `false` branch and
  // breaks type safety, and this way an unprivileged role's request never
  // loads that data into the process at all.
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      customer: true,
      vehicle: true,
      terms: true,
      taxCode: true,
      rep: { select: { employeeCode: true, fullName: true } },
      createdBy: { select: { employeeCode: true, fullName: true } },
      lines: { orderBy: { lineNo: "asc" } },
    },
  });

  if (!invoice) notFound();

  const overrides = canViewAudit
    ? await prisma.priceOverride.findMany({
        where: { invoiceId: invoice.id },
        orderBy: { lineNo: "asc" },
        include: {
          approvedBy: { select: { employeeCode: true, fullName: true } },
          requestedBy: { select: { employeeCode: true, fullName: true } },
        },
      })
    : [];

  const journalEntries = canViewGl
    ? await prisma.journalEntry.findMany({
        where: { invoiceId: invoice.id },
        orderBy: { createdAt: "asc" },
        include: { lines: { include: { account: true }, orderBy: { lineNo: "asc" } } },
      })
    : [];

  return (
    <QbWindow
      title={"Invoice " + invoice.invoiceNo}
      subtitle={"— " + invoice.customer.companyName}
      toolbar={
        <>
          <Link href={"/dashboard/invoices/" + invoice.id + "/print"} target="_blank">
            <QbButton size="sm">Print / PDF</QbButton>
          </Link>
          <Link href="/dashboard/invoices">
            <QbButton size="sm">Close</QbButton>
          </Link>
        </>
      }
      bodyClassName="bg-qb-chrome"
    >
      <div className="p-2 space-y-2">
        {invoice.status === "VOID" ? (
          <QbBanner variant="err" title="This invoice is void">
            Voided {invoice.voidedAt?.toLocaleString("en-US")}.{" "}
            {invoice.voidReason ? "Reason: " + invoice.voidReason : ""}
          </QbBanner>
        ) : null}
        {invoice.status === "DRAFT" ? (
          <QbBanner variant="warn" title="Draft">
            This invoice has not been posted to the general ledger and has not
            reduced inventory.
          </QbBanner>
        ) : null}

        {/* Header */}
        <div className="bg-white border border-qb-line p-2 flex flex-wrap gap-6">
          <div className="text-qb leading-[15px] min-w-[200px]">
            <div className="qb-fieldset-legend">Bill To</div>
            <div className="font-bold">{invoice.customer.companyName}</div>
            {invoice.customer.contactName ? (
              <div>{invoice.customer.contactName}</div>
            ) : null}
            {invoice.customer.billingAddress1 ? (
              <div>{invoice.customer.billingAddress1}</div>
            ) : null}
            <div>
              {invoice.customer.city ? invoice.customer.city + ", " : ""}
              {invoice.customer.state ?? ""} {invoice.customer.postalCode ?? ""}
            </div>
          </div>

          <table className="qb-grid w-[300px]">
            <tbody>
              <tr>
                <td className="font-bold w-[110px]">Invoice #</td>
                <td className="font-qbMono">{invoice.invoiceNo}</td>
              </tr>
              <tr>
                <td className="font-bold">Date</td>
                <td className="font-qbMono">
                  {invoice.invoiceDate.toLocaleDateString("en-US")}
                </td>
              </tr>
              <tr>
                <td className="font-bold">Service Date</td>
                <td className="font-qbMono">
                  {invoice.serviceDate?.toLocaleDateString("en-US") ?? "—"}
                </td>
              </tr>
              <tr>
                <td className="font-bold">Due Date</td>
                <td className="font-qbMono">
                  {invoice.dueDate?.toLocaleDateString("en-US") ?? "—"}
                </td>
              </tr>
              <tr>
                <td className="font-bold">Status</td>
                <td>
                  <QbPill status={invoice.status} />
                </td>
              </tr>
            </tbody>
          </table>

          <table className="qb-grid w-[300px]">
            <tbody>
              <tr>
                <td className="font-bold w-[110px]">License Plate</td>
                <td className="font-qbMono">{invoice.licensePlate ?? "—"}</td>
              </tr>
              <tr>
                <td className="font-bold">Vehicle</td>
                <td>
                  {invoice.vehicle
                    ? [
                        invoice.vehicle.year,
                        invoice.vehicle.make,
                        invoice.vehicle.model,
                      ]
                        .filter(Boolean)
                        .join(" ") || "—"
                    : "—"}
                </td>
              </tr>
              <tr>
                <td className="font-bold">Terms</td>
                <td>{invoice.terms?.name ?? "—"}</td>
              </tr>
              <tr>
                <td className="font-bold">Rep</td>
                <td>{invoice.rep?.employeeCode ?? "—"}</td>
              </tr>
              <tr>
                <td className="font-bold">P.O. No.</td>
                <td className="font-qbMono">{invoice.poNumber ?? "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Lines */}
        <div className="bg-white border border-qb-line overflow-x-auto">
          <table className="qb-grid min-w-[860px]">
            <thead>
              <tr>
                <th style={{ width: 26 }}>#</th>
                <th style={{ width: 120 }}>Item</th>
                <th>Description</th>
                <th style={{ width: 54 }} className="text-right">
                  Qty
                </th>
                <th style={{ width: 40 }}>U/M</th>
                <th style={{ width: 78 }} className="text-right">
                  Rate
                </th>
                <th style={{ width: 86 }} className="text-right">
                  Amount
                </th>
                {canViewCost ? (
                  <>
                    <th style={{ width: 70 }} className="text-right">
                      Cost
                    </th>
                    <th style={{ width: 54 }} className="text-right">
                      GP%
                    </th>
                  </>
                ) : null}
                <th style={{ width: 30 }}>Tax</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => {
                const amount = num(line.amount);
                const cost = num(line.costAmount);
                const gp = marginPct(amount, cost);
                return (
                  <tr
                    key={line.id}
                    className={line.isManual ? "bg-[#F4F8FB]" : undefined}
                  >
                    <td className="text-center font-qbMono text-qb-inkMuted">
                      {line.lineNo}
                    </td>
                    <td className="font-qbMono">
                      {line.sku ?? (
                        <span className="text-qb-inkMuted italic">
                          {line.itemType === "SERVICE" ? "labor" : "manual"}
                        </span>
                      )}
                    </td>
                    <td>{line.description}</td>
                    <td className="qb-grid-num">{formatQty(line.quantity)}</td>
                    <td className="text-center text-qb-xs">{line.unitOfMeasure}</td>
                    <td className="qb-grid-num">{formatMoney(line.rate)}</td>
                    <td className="qb-grid-num">{formatMoney(amount)}</td>
                    {canViewCost ? (
                      <>
                        <td className="qb-grid-num text-qb-inkMuted">
                          {formatMoney(cost)}
                        </td>
                        <td className="qb-grid-num">
                          {gp === null ? "—" : formatPercent(gp, 1)}
                        </td>
                      </>
                    ) : null}
                    <td className="text-center text-qb-xs">
                      {line.isTaxable ? "Tax" : "Non"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals + memo */}
        <div className="flex flex-wrap gap-2 justify-between items-start">
          <div className="flex-1 min-w-[260px] space-y-2">
            {invoice.customerMessage ? (
              <QbFieldset legend="Customer Message">
                <div className="text-qb">{invoice.customerMessage}</div>
              </QbFieldset>
            ) : null}
            {invoice.memo ? (
              <QbFieldset legend="Internal Memo">
                <div className="text-qb">{invoice.memo}</div>
              </QbFieldset>
            ) : null}
            <QbFieldset legend="Entered By">
              <div className="text-qb">
                {invoice.createdBy.fullName} ({invoice.createdBy.employeeCode}) on{" "}
                {invoice.createdAt.toLocaleString("en-US")}
              </div>
            </QbFieldset>
          </div>

          <table className="qb-grid w-[290px] shrink-0 bg-white">
            <tbody>
              <tr>
                <td className="font-bold">Subtotal</td>
                <td className="qb-grid-num w-[100px]">
                  {formatMoney(invoice.subtotal)}
                </td>
              </tr>
              <tr>
                <td>
                  Sales Tax
                  <span className="text-qb-inkMuted">
                    {" "}
                    ({formatPercent(invoice.taxRate, 3)})
                  </span>
                </td>
                <td className="qb-grid-num">{formatMoney(invoice.taxTotal)}</td>
              </tr>
              <tr className="bg-qb-gridSelect">
                <td className="font-bold text-qb-md">Total</td>
                <td className="qb-grid-num font-bold text-qb-md">
                  {formatMoney(invoice.total)}
                </td>
              </tr>
              <tr>
                <td>Payments Applied</td>
                <td className="qb-grid-num">{formatMoney(invoice.amountPaid)}</td>
              </tr>
              <tr>
                <td className="font-bold">Balance Due</td>
                <td className="qb-grid-num font-bold">
                  {formatMoney(invoice.balanceDue)}
                </td>
              </tr>
              {canViewMargin ? (
                <>
                  <tr>
                    <td colSpan={2} className="bg-qb-chromeDark h-[4px] p-0" />
                  </tr>
                  <tr>
                    <td className="text-qb-inkMuted">Total Cost</td>
                    <td className="qb-grid-num text-qb-inkMuted">
                      {formatMoney(invoice.costTotal)}
                    </td>
                  </tr>
                  <tr>
                    <td className="font-bold">Gross Profit</td>
                    <td className="qb-grid-num font-bold">
                      {formatMoney(num(invoice.subtotal) - num(invoice.costTotal))}
                    </td>
                  </tr>
                  <tr>
                    <td>Margin</td>
                    <td className="qb-grid-num">
                      {(() => {
                        const m = marginPct(invoice.subtotal, invoice.costTotal);
                        return m === null ? "—" : formatPercent(m, 1);
                      })()}
                    </td>
                  </tr>
                </>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Price overrides — audit view only */}
        {canViewAudit && overrides.length > 0 ? (
          <QbFieldset legend="Price Overrides Recorded On This Invoice">
            <table className="qb-grid bg-white">
              <thead>
                <tr>
                  <th style={{ width: 30 }}>Ln</th>
                  <th style={{ width: 130 }}>Item</th>
                  <th style={{ width: 70 }} className="text-right">
                    Minimum
                  </th>
                  <th style={{ width: 70 }} className="text-right">
                    Sold At
                  </th>
                  <th style={{ width: 54 }} className="text-right">
                    Below
                  </th>
                  <th style={{ width: 80 }} className="text-right">
                    Conceded
                  </th>
                  <th style={{ width: 120 }}>Approved By</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.id}>
                    <td className="text-center font-qbMono">{o.lineNo}</td>
                    <td className="font-qbMono">{o.sku}</td>
                    <td className="qb-grid-num">{formatMoney(o.minimumPrice)}</td>
                    <td className="qb-grid-num text-qb-red font-bold">
                      {formatMoney(o.approvedPrice)}
                    </td>
                    <td className="qb-grid-num text-qb-red">
                      {formatPercent(o.discountPct, 1)}
                    </td>
                    <td className="qb-grid-num text-qb-red font-bold">
                      {formatMoney(o.concessionAmount)}
                    </td>
                    <td title={o.approvedBy.fullName}>
                      {o.approvedBy.employeeCode} &mdash; {o.approvedBy.fullName}
                    </td>
                    <td className="whitespace-normal">{o.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </QbFieldset>
        ) : null}

        {/* GL posting — accounting view only */}
        {canViewGl && journalEntries.length > 0 ? (
          <QbFieldset legend="General Ledger Posting">
            {journalEntries.map((entry) => (
              <div key={entry.id} className="pb-2">
                <div className="text-qb font-bold pb-[2px]">
                  {entry.entryNo} &middot; {entry.entryDate.toLocaleDateString("en-US")}{" "}
                  &middot; {entry.source}
                  {entry.isReversal ? " (reversal)" : ""}
                </div>
                <table className="qb-grid bg-white">
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>Account</th>
                      <th>Name</th>
                      <th style={{ width: 90 }} className="text-right">
                        Debit
                      </th>
                      <th style={{ width: 90 }} className="text-right">
                        Credit
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="font-qbMono">{line.account.number}</td>
                        <td>{line.account.name}</td>
                        <td className="qb-grid-num">
                          {num(line.debit) === 0 ? "" : formatMoney(line.debit)}
                        </td>
                        <td className="qb-grid-num">
                          {num(line.credit) === 0 ? "" : formatMoney(line.credit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-qb-grid-header font-bold">
                      <td colSpan={2} className="border border-qb-gridLine px-1 text-right">
                        Totals (must be equal)
                      </td>
                      <td className="border border-qb-gridLine px-1 qb-grid-num">
                        {formatMoney(entry.totalDebit)}
                      </td>
                      <td className="border border-qb-gridLine px-1 qb-grid-num">
                        {formatMoney(entry.totalCredit)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ))}
          </QbFieldset>
        ) : null}
      </div>
    </QbWindow>
  );
}
