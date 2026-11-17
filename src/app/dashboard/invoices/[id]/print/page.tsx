import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney, formatQty, num } from "@/lib/money";
import { PrintTrigger } from "./PrintTrigger";

export const metadata = { title: "Print Invoice — Gill Truck Parts" };

/**
 * The printable invoice / PDF source.
 *
 * Rendered as a plain letter-size document with the application chrome
 * suppressed by the `@media print` rules in globals.css. "Export to PDF" is
 * the browser's own Print-to-PDF — which is deliberate: it needs no
 * server-side headless browser, produces selectable text rather than a
 * raster, and is the workflow counter staff already know from QuickBooks.
 *
 * Note this document carries NO cost or margin figures for any role. It is
 * the copy that goes to the customer; cost has no business being in a file
 * that gets e-mailed out.
 */
export default async function PrintInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.permissions.includes(PERM.SALES_VIEW)) redirect("/dashboard");

  const { id } = await params;

  const [invoice, company] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: true,
        vehicle: true,
        terms: true,
        rep: { select: { employeeCode: true, fullName: true } },
        lines: { orderBy: { lineNo: "asc" } },
      },
    }),
    prisma.companySettings.findUnique({ where: { id: "default" } }),
  ]);

  if (!invoice) notFound();

  const parts = invoice.lines.filter(
    (l) => l.itemType === "INVENTORY" || l.itemType === "NON_INVENTORY",
  );
  const services = invoice.lines.filter((l) => l.itemType !== "INVENTORY" && l.itemType !== "NON_INVENTORY");

  return (
    <div className="bg-[#808080] min-h-full overflow-auto">
      <PrintTrigger />

      {/* On-screen toolbar; removed from the printed page. */}
      <div
        className="qb-no-print sticky top-0 z-10 bg-qb-chrome border-b
                   border-qb-border px-3 py-2 flex items-center gap-2"
      >
        <button type="button" className="qb-btn" data-print-button="true">
          Print / Save as PDF
        </button>
        <a href={"/dashboard/invoices/" + invoice.id} className="qb-btn">
          Back to Invoice
        </a>
        <span className="text-qb-xs text-qb-inkMuted ml-auto">
          Use your browser&rsquo;s &ldquo;Save as PDF&rdquo; destination to export.
        </span>
      </div>

      {/* The sheet */}
      <div
        className="qb-print-sheet bg-white mx-auto my-4 shadow-qb-window
                   w-[8.5in] min-h-[11in] p-[0.6in] text-qb-ink"
        style={{ fontFamily: "Tahoma, Verdana, sans-serif" }}
      >
        {/* Letterhead */}
        <div className="flex justify-between items-start border-b-2 border-qb-ink pb-3">
          <div>
            <div className="text-[22px] font-bold leading-tight">
              {company?.legalName ?? "Gill Truck Parts"}
            </div>
            <div className="text-qb-md leading-[16px] pt-1">
              {company?.address1 ? <div>{company.address1}</div> : null}
              <div>
                {company?.city ? company.city + ", " : ""}
                {company?.state ?? ""} {company?.postalCode ?? ""}
              </div>
              {company?.phone ? <div>Phone: {company.phone}</div> : null}
              {company?.email ? <div>{company.email}</div> : null}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[26px] font-bold tracking-wide">INVOICE</div>
            <table className="text-qb-md mt-1 ml-auto">
              <tbody>
                <tr>
                  <td className="pr-3 text-right font-bold">Invoice No.</td>
                  <td className="text-right font-qbMono">{invoice.invoiceNo}</td>
                </tr>
                <tr>
                  <td className="pr-3 text-right font-bold">Date</td>
                  <td className="text-right font-qbMono">
                    {invoice.invoiceDate.toLocaleDateString("en-US")}
                  </td>
                </tr>
                {invoice.dueDate ? (
                  <tr>
                    <td className="pr-3 text-right font-bold">Due</td>
                    <td className="text-right font-qbMono">
                      {invoice.dueDate.toLocaleDateString("en-US")}
                    </td>
                  </tr>
                ) : null}
                <tr>
                  <td className="pr-3 text-right font-bold">Terms</td>
                  <td className="text-right">{invoice.terms?.name ?? "Due on receipt"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {invoice.status === "VOID" ? (
          <div className="text-center text-[36px] font-bold text-qb-red py-4 tracking-[0.2em]">
            V O I D
          </div>
        ) : null}

        {/* Bill-to + vehicle */}
        <div className="grid grid-cols-2 gap-4 pt-4">
          <div>
            <div className="text-qb font-bold uppercase tracking-wide border-b border-qb-line pb-[2px] mb-1">
              Bill To
            </div>
            <div className="text-qb-md leading-[16px]">
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
              {invoice.customer.phone ? <div>{invoice.customer.phone}</div> : null}
              <div className="pt-1 text-qb">
                Account: <span className="font-qbMono">{invoice.customer.customerNo}</span>
              </div>
            </div>
          </div>

          <div>
            <div className="text-qb font-bold uppercase tracking-wide border-b border-qb-line pb-[2px] mb-1">
              Unit / Vehicle
            </div>
            <table className="text-qb-md w-full">
              <tbody>
                <tr>
                  <td className="font-bold pr-2 w-[94px]">License Plate</td>
                  <td className="font-qbMono">{invoice.licensePlate ?? "—"}</td>
                </tr>
                {invoice.vehicle?.unitNumber ? (
                  <tr>
                    <td className="font-bold pr-2">Unit No.</td>
                    <td className="font-qbMono">{invoice.vehicle.unitNumber}</td>
                  </tr>
                ) : null}
                {invoice.vehicle ? (
                  <tr>
                    <td className="font-bold pr-2">Vehicle</td>
                    <td>
                      {[invoice.vehicle.year, invoice.vehicle.make, invoice.vehicle.model]
                        .filter(Boolean)
                        .join(" ") || "—"}
                    </td>
                  </tr>
                ) : null}
                {invoice.vehicle?.vin ? (
                  <tr>
                    <td className="font-bold pr-2">VIN</td>
                    <td className="font-qbMono text-qb">{invoice.vehicle.vin}</td>
                  </tr>
                ) : null}
                {invoice.vehicle?.odometer ? (
                  <tr>
                    <td className="font-bold pr-2">Odometer</td>
                    <td className="font-qbMono">
                      {invoice.vehicle.odometer.toLocaleString("en-US")}
                    </td>
                  </tr>
                ) : null}
                <tr>
                  <td className="font-bold pr-2">Service Date</td>
                  <td className="font-qbMono">
                    {invoice.serviceDate?.toLocaleDateString("en-US") ?? "—"}
                  </td>
                </tr>
                <tr>
                  <td className="font-bold pr-2">Rep</td>
                  <td>{invoice.rep?.employeeCode ?? "—"}</td>
                </tr>
                {invoice.poNumber ? (
                  <tr>
                    <td className="font-bold pr-2">Your P.O.</td>
                    <td className="font-qbMono">{invoice.poNumber}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {/* Line items — parts, then labor, the way a repair ticket reads */}
        <table className="w-full mt-5 text-qb-md border-collapse">
          <thead>
            <tr className="bg-[#EDEDED]">
              <th className="border border-qb-ink/40 px-1 py-[3px] text-left w-[106px]">
                Part No.
              </th>
              <th className="border border-qb-ink/40 px-1 py-[3px] text-left">
                Description
              </th>
              <th className="border border-qb-ink/40 px-1 py-[3px] text-right w-[48px]">
                Qty
              </th>
              <th className="border border-qb-ink/40 px-1 py-[3px] text-center w-[38px]">
                U/M
              </th>
              <th className="border border-qb-ink/40 px-1 py-[3px] text-right w-[70px]">
                Rate
              </th>
              <th className="border border-qb-ink/40 px-1 py-[3px] text-right w-[78px]">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {parts.length > 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="border border-qb-ink/40 px-1 py-[2px] bg-[#F7F7F7]
                             font-bold text-qb uppercase tracking-wide"
                >
                  Parts
                </td>
              </tr>
            ) : null}
            {parts.map((line) => (
              <tr key={line.id}>
                <td className="border border-qb-ink/40 px-1 py-[3px] font-qbMono">
                  {line.sku ?? ""}
                </td>
                <td className="border border-qb-ink/40 px-1 py-[3px]">
                  {line.description}
                  {line.isTaxable ? "" : " *"}
                </td>
                <td className="border border-qb-ink/40 px-1 py-[3px] text-right font-qbMono">
                  {formatQty(line.quantity)}
                </td>
                <td className="border border-qb-ink/40 px-1 py-[3px] text-center">
                  {line.unitOfMeasure}
                </td>
                <td className="border border-qb-ink/40 px-1 py-[3px] text-right font-qbMono">
                  {formatMoney(line.rate)}
                </td>
                <td className="border border-qb-ink/40 px-1 py-[3px] text-right font-qbMono">
                  {formatMoney(line.amount)}
                </td>
              </tr>
            ))}

            {services.length > 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="border border-qb-ink/40 px-1 py-[2px] bg-[#F7F7F7]
                             font-bold text-qb uppercase tracking-wide"
                >
                  Labor &amp; Service
                </td>
              </tr>
            ) : null}
            {services.map((line) => (
              <tr key={line.id}>
                <td className="border border-qb-ink/40 px-1 py-[3px] font-qbMono">
                  {line.sku ?? ""}
                </td>
                <td className="border border-qb-ink/40 px-1 py-[3px]">
                  {line.description}
                  {line.isTaxable ? "" : " *"}
                </td>
                <td className="border border-qb-ink/40 px-1 py-[3px] text-right font-qbMono">
                  {formatQty(line.quantity)}
                </td>
                <td className="border border-qb-ink/40 px-1 py-[3px] text-center">
                  {line.unitOfMeasure}
                </td>
                <td className="border border-qb-ink/40 px-1 py-[3px] text-right font-qbMono">
                  {formatMoney(line.rate)}
                </td>
                <td className="border border-qb-ink/40 px-1 py-[3px] text-right font-qbMono">
                  {formatMoney(line.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-between items-start pt-4 gap-6">
          <div className="text-qb-md flex-1">
            {invoice.customerMessage ? (
              <p className="pb-2">{invoice.customerMessage}</p>
            ) : null}
            {invoice.lines.some((l) => !l.isTaxable) ? (
              <p className="text-qb text-qb-inkMuted">* Non-taxable item</p>
            ) : null}
            {invoice.customer.taxExempt ? (
              <p className="text-qb">
                Tax exempt &mdash; resale certificate{" "}
                {invoice.customer.resaleCertNo ?? "on file"}
              </p>
            ) : null}
            <p className="text-qb text-qb-inkMuted pt-3">
              Returns accepted within 30 days with this invoice. Electrical
              parts and special orders are non-returnable. Core charges are
              refunded on receipt of a rebuildable core.
            </p>
          </div>

          <table className="text-qb-md w-[250px] border-collapse shrink-0">
            <tbody>
              <tr>
                <td className="px-1 py-[3px] text-right">Subtotal</td>
                <td className="px-1 py-[3px] text-right font-qbMono w-[92px]">
                  {formatMoney(invoice.subtotal)}
                </td>
              </tr>
              <tr>
                <td className="px-1 py-[3px] text-right">
                  Sales Tax ({(num(invoice.taxRate) * 100).toFixed(3)}%)
                </td>
                <td className="px-1 py-[3px] text-right font-qbMono">
                  {formatMoney(invoice.taxTotal)}
                </td>
              </tr>
              <tr className="border-t-2 border-qb-ink">
                <td className="px-1 py-[4px] text-right font-bold text-[14px]">
                  Total
                </td>
                <td className="px-1 py-[4px] text-right font-bold font-qbMono text-[14px]">
                  {formatMoney(invoice.total)}
                </td>
              </tr>
              {num(invoice.amountPaid) > 0 ? (
                <tr>
                  <td className="px-1 py-[3px] text-right">Payments</td>
                  <td className="px-1 py-[3px] text-right font-qbMono">
                    {formatMoney(invoice.amountPaid)}
                  </td>
                </tr>
              ) : null}
              <tr className="bg-[#EDEDED]">
                <td className="px-1 py-[4px] text-right font-bold">Balance Due</td>
                <td className="px-1 py-[4px] text-right font-bold font-qbMono">
                  {formatMoney(invoice.balanceDue)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="pt-8 text-qb text-center text-qb-inkMuted border-t border-qb-line mt-6">
          {company?.legalName ?? "Gill Truck Parts"}
          {company?.taxId ? " · Tax ID " + company.taxId : ""}
          {" · Invoice "}
          {invoice.invoiceNo}
        </div>
      </div>
    </div>
  );
}
