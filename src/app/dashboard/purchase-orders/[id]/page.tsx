import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney, formatQty, num, round4 } from "@/lib/money";
import { QbWindow, QbPill, QbButton, QbBanner, QbFieldset } from "@/components/qb/Ui";
import { PoStatusButtons } from "@/components/purchasing/PoStatusButtons";

export default async function PurchaseOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ received?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.permissions.includes(PERM.PURCHASING_VIEW)) {
    return (
      <QbWindow title="Purchase Order">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role cannot view purchasing.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const { id } = await params;
  const { received } = await searchParams;

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      vendor: true,
      createdBy: { select: { employeeCode: true, fullName: true } },
      lines: { orderBy: { lineNo: "asc" } },
      receipts: {
        orderBy: { receivedDate: "desc" },
        include: {
          lines: { include: { poLine: { select: { lineNo: true, sku: true } } } },
          createdBy: { select: { employeeCode: true } },
        },
      },
    },
  });

  if (!po) notFound();

  const canReceive = user.permissions.includes(PERM.PURCHASING_RECEIVE);
  const canEdit = user.permissions.includes(PERM.PURCHASING_CREATE_PO);
  const canBill = user.permissions.includes(PERM.PURCHASING_ENTER_BILL);
  const receivable = po.status === "OPEN" || po.status === "PARTIALLY_RECEIVED";

  const unbilledReceipts = po.receipts.filter((r) => !r.isBilled);

  return (
    <QbWindow
      title={"Purchase Order " + po.poNumber}
      subtitle={"— " + po.vendor.companyName}
      toolbar={
        <>
          {canReceive && receivable ? (
            <Link href={"/dashboard/purchase-orders/" + po.id + "/receive"}>
              <QbButton size="sm" variant="primary">
                Receive Inventory
              </QbButton>
            </Link>
          ) : null}
          {canBill && unbilledReceipts.length > 0 ? (
            <Link href={"/dashboard/bills/new?receiptId=" + unbilledReceipts[0].id}>
              <QbButton size="sm">Enter Bill</QbButton>
            </Link>
          ) : null}
          <Link href="/dashboard/purchase-orders">
            <QbButton size="sm">Close</QbButton>
          </Link>
        </>
      }
      bodyClassName="bg-qb-chrome"
    >
      <div className="p-2 space-y-2">
        {received ? (
          <QbBanner variant="ok" title={"Receipt " + received + " posted"}>
            Stock and weighted-average cost have been updated, and the general ledger has been
            posted (DR Inventory Asset / CR Accounts Payable).
          </QbBanner>
        ) : null}
        {po.status === "DRAFT" ? (
          <QbBanner variant="warn" title="Draft">
            This purchase order has not been issued. It does not count toward
            quantity-on-order and cannot be received against.
          </QbBanner>
        ) : null}
        {po.status === "CANCELLED" ? (
          <QbBanner variant="err" title="Cancelled" />
        ) : null}

        <div className="bg-white border border-qb-line p-2 flex flex-wrap gap-6">
          <div className="text-qb leading-[15px] min-w-[220px]">
            <div className="qb-fieldset-legend">Vendor</div>
            <div className="font-bold">{po.vendor.companyName}</div>
            {po.vendor.contactName ? <div>{po.vendor.contactName}</div> : null}
            {po.vendor.address1 ? <div>{po.vendor.address1}</div> : null}
            <div>
              {po.vendor.city ? po.vendor.city + ", " : ""}
              {po.vendor.state ?? ""} {po.vendor.postalCode ?? ""}
            </div>
            {po.vendor.phone ? <div className="font-qbMono">{po.vendor.phone}</div> : null}
            {po.vendor.accountNo ? (
              <div className="pt-1">Our account: {po.vendor.accountNo}</div>
            ) : null}
          </div>

          <table className="qb-grid w-[290px]">
            <tbody>
              <tr>
                <td className="font-bold w-[104px]">P.O. No.</td>
                <td className="font-qbMono">{po.poNumber}</td>
              </tr>
              <tr>
                <td className="font-bold">Order Date</td>
                <td className="font-qbMono">{po.orderDate.toLocaleDateString("en-US")}</td>
              </tr>
              <tr>
                <td className="font-bold">Expected</td>
                <td className="font-qbMono">
                  {po.expectedDate?.toLocaleDateString("en-US") ?? "—"}
                </td>
              </tr>
              <tr>
                <td className="font-bold">Ship Via</td>
                <td>{po.shipVia ?? "—"}</td>
              </tr>
              <tr>
                <td className="font-bold">Status</td>
                <td>
                  <QbPill status={po.status} />
                </td>
              </tr>
              <tr>
                <td className="font-bold">Raised By</td>
                <td>{po.createdBy.employeeCode}</td>
              </tr>
            </tbody>
          </table>

          {canEdit ? (
            <div className="min-w-[180px]">
              <div className="qb-fieldset-legend pb-1">Actions</div>
              <PoStatusButtons poId={po.id} status={po.status} />
            </div>
          ) : null}
        </div>

        {/* Lines */}
        <div className="bg-white border border-qb-line overflow-x-auto">
          <table className="qb-grid min-w-[880px]">
            <thead>
              <tr>
                <th style={{ width: 26 }}>#</th>
                <th style={{ width: 120 }}>Item</th>
                <th>Description</th>
                <th style={{ width: 100 }}>Vendor Part</th>
                <th style={{ width: 52 }} className="text-right">Ord</th>
                <th style={{ width: 52 }} className="text-right">Rcvd</th>
                <th style={{ width: 58 }} className="text-right">Outstd</th>
                <th style={{ width: 80 }} className="text-right">Unit Cost</th>
                <th style={{ width: 88 }} className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((line) => {
                const outstanding = round4(
                  num(line.quantityOrdered) - num(line.quantityReceived),
                );
                return (
                  <tr key={line.id}>
                    <td className="text-center font-qbMono text-qb-inkMuted">{line.lineNo}</td>
                    <td className="font-qbMono">{line.sku ?? ""}</td>
                    <td>{line.description}</td>
                    <td className="font-qbMono text-qb-xs">{line.vendorPartNo ?? ""}</td>
                    <td className="qb-grid-num">{formatQty(line.quantityOrdered)}</td>
                    <td className="qb-grid-num">{formatQty(line.quantityReceived)}</td>
                    <td
                      className={
                        "qb-grid-num " + (outstanding > 0 ? "font-bold" : "text-qb-inkMuted")
                      }
                    >
                      {formatQty(outstanding)}
                    </td>
                    <td className="qb-grid-num">{formatMoney(line.unitCost)}</td>
                    <td className="qb-grid-num">{formatMoney(line.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-qb-grid-header">
                <td colSpan={8} className="border border-qb-gridLine px-1 text-right">
                  Subtotal
                </td>
                <td className="border border-qb-gridLine px-1 qb-grid-num">
                  {formatMoney(po.subtotal)}
                </td>
              </tr>
              <tr className="bg-qb-grid-header">
                <td colSpan={8} className="border border-qb-gridLine px-1 text-right">
                  Freight
                </td>
                <td className="border border-qb-gridLine px-1 qb-grid-num">
                  {formatMoney(po.freight)}
                </td>
              </tr>
              <tr className="bg-qb-grid-header font-bold">
                <td colSpan={8} className="border border-qb-gridLine px-1 text-right">
                  Total
                </td>
                <td className="border border-qb-gridLine px-1 qb-grid-num">
                  {formatMoney(po.total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {po.memo ? (
          <QbFieldset legend="Memo">
            <div className="text-qb">{po.memo}</div>
          </QbFieldset>
        ) : null}

        {/* Receipt history */}
        <QbFieldset legend={"Receipt History (" + po.receipts.length + ")"}>
          {po.receipts.length === 0 ? (
            <div className="text-qb text-qb-inkMuted py-1">
              Nothing received against this order yet.
            </div>
          ) : (
            po.receipts.map((receipt) => (
              <div key={receipt.id} className="pb-2">
                <div className="text-qb font-bold pb-[2px]">
                  {receipt.receiptNo} &middot;{" "}
                  {receipt.receivedDate.toLocaleDateString("en-US")} &middot; received by{" "}
                  {receipt.createdBy.employeeCode}
                  {receipt.vendorPackingSlip ? (
                    <span className="font-normal text-qb-inkMuted">
                      {" "}
                      &middot; slip {receipt.vendorPackingSlip}
                    </span>
                  ) : null}
                  {receipt.isBilled ? (
                    <span className="text-qb-greenDark"> &middot; billed</span>
                  ) : (
                    <span className="text-qb-amber"> &middot; not yet billed</span>
                  )}
                </div>
                <table className="qb-grid bg-white">
                  <thead>
                    <tr>
                      <th style={{ width: 30 }}>Ln</th>
                      <th style={{ width: 130 }}>Item</th>
                      <th style={{ width: 70 }} className="text-right">Qty</th>
                      <th style={{ width: 90 }} className="text-right">Unit Cost</th>
                      <th style={{ width: 90 }} className="text-right">Amount</th>
                      <th>&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipt.lines.map((rl) => (
                      <tr key={rl.id}>
                        <td className="text-center font-qbMono">{rl.poLine.lineNo}</td>
                        <td className="font-qbMono">{rl.poLine.sku ?? ""}</td>
                        <td className="qb-grid-num">{formatQty(rl.quantity)}</td>
                        <td className="qb-grid-num">{formatMoney(rl.unitCost)}</td>
                        <td className="qb-grid-num">{formatMoney(rl.amount)}</td>
                        <td />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </QbFieldset>
      </div>
    </QbWindow>
  );
}
