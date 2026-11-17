import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatCurrency, formatMoney, num, sumMoney } from "@/lib/money";
import { QbWindow, QbFieldset, QbBanner, QbPill, QbEmpty } from "@/components/qb/Ui";
import {
  QbWorkflowPanel,
  QbWorkflowTile,
  QbFlowArrow,
} from "@/components/qb/Workflow";
import { SYSTEM_ACCOUNTS } from "@/lib/ledger";

export const metadata = { title: "Home — Gill Truck Parts" };

/**
 * The QuickBooks Home Page.
 *
 * Left: the workflow diagrams (Vendors, Customers, Inventory, Company).
 * Right: account balances, reminders and recent activity.
 *
 * Every number on this page is permission-gated. The "Inventory Value"
 * figure, for instance, is cost x quantity — so it only renders for a role
 * holding reports.view_inventory_valuation, and the query that computes it
 * does not even run otherwise.
 */
export default async function DashboardHome() {
  const user = await getCurrentUser();
  if (!user) return null;

  const can = (perm: string) => user.permissions.includes(perm as never);
  const showCost = can(PERM.INVENTORY_VIEW_COST);
  const showValuation = can(PERM.REPORTS_VIEW_INVENTORY_VALUATION);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    openInvoices,
    todayInvoices,
    recentInvoices,
    lowStock,
    receivablePos,
    unpaidBills,
    arAccount,
    recentOverrides,
  ] = await Promise.all([
    prisma.invoice.findMany({
      where: { status: { in: ["OPEN", "PARTIALLY_PAID"] } },
      select: { balanceDue: true },
    }),
    prisma.invoice.findMany({
      where: {
        invoiceDate: { gte: startOfToday },
        status: { not: "VOID" },
      },
      select: { total: true, costTotal: true },
    }),
    prisma.invoice.findMany({
      where: { status: { not: "DRAFT" } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        invoiceNo: true,
        invoiceDate: true,
        total: true,
        status: true,
        licensePlate: true,
        customer: { select: { companyName: true } },
      },
    }),
    // Low stock: below reorder point. Uses a raw query because Prisma
    // cannot compare two columns in a `where`.
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM products
      WHERE "isActive" = true
        AND type = 'INVENTORY'
        AND "quantityOnHand" <= "reorderPoint"
        AND "reorderPoint" > 0
    `,
    can(PERM.PURCHASING_VIEW)
      ? prisma.purchaseOrder.count({
          where: { status: { in: ["OPEN", "PARTIALLY_RECEIVED"] } },
        })
      : Promise.resolve(0),
    can(PERM.PURCHASING_ENTER_BILL)
      ? prisma.bill.findMany({
          where: { status: { in: ["OPEN", "PARTIALLY_PAID"] } },
          select: { balanceDue: true },
        })
      : Promise.resolve([]),
    can(PERM.ACCOUNTING_VIEW_GL)
      ? prisma.account.findUnique({
          where: { number: SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE },
          select: { balance: true, name: true, number: true },
        })
      : Promise.resolve(null),
    can(PERM.AUDIT_VIEW)
      ? prisma.priceOverride.findMany({
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            sku: true,
            minimumPrice: true,
            approvedPrice: true,
            concessionAmount: true,
            createdAt: true,
            approvedBy: { select: { employeeCode: true } },
            requestedBy: { select: { employeeCode: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const arTotal = sumMoney(openInvoices.map((i) => i.balanceDue));
  const todaySales = sumMoney(todayInvoices.map((i) => i.total));
  const todayCost = sumMoney(todayInvoices.map((i) => i.costTotal));
  const apTotal = sumMoney(unpaidBills.map((b) => b.balanceDue));
  const lowStockCount = Number(lowStock[0]?.count ?? 0);

  // Only computed for roles allowed to see valuation.
  let inventoryValue: number | null = null;
  if (showValuation) {
    const rows = await prisma.$queryRaw<{ value: string | null }[]>`
      SELECT COALESCE(SUM("quantityOnHand" * "averageCost"), 0)::text AS value
      FROM products
      WHERE "isActive" = true AND type = 'INVENTORY'
    `;
    inventoryValue = num(rows[0]?.value ?? 0);
  }

  return (
    <div className="flex flex-col gap-2 min-h-0">
      <QbWindow
        title="Home"
        subtitle={"— " + user.fullName}
        bodyClassName="bg-qb-chrome"
      >
        <div className="p-2 grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-2 items-start">
          {/* ───────────────────────────── Workflow diagrams ───────────── */}
          <div className="flex flex-col gap-2 min-w-0">
            <QbWorkflowPanel title="Vendors">
              <QbWorkflowTile
                label="Purchase Orders"
                href="/dashboard/purchase-orders/new"
                icon="po"
                disabled={!can(PERM.PURCHASING_CREATE_PO)}
              />
              <QbFlowArrow />
              <QbWorkflowTile
                label="Receive Inventory"
                href="/dashboard/purchase-orders?filter=receivable"
                icon="receive"
                disabled={!can(PERM.PURCHASING_RECEIVE)}
                badge={receivablePos || undefined}
              />
              <QbFlowArrow />
              <QbWorkflowTile
                label="Enter Bills"
                href="/dashboard/bills/new"
                icon="bill"
                disabled={!can(PERM.PURCHASING_ENTER_BILL)}
              />
              <QbFlowArrow />
              <QbWorkflowTile
                label="Pay Bills"
                href="/dashboard/bills?filter=unpaid"
                icon="checks"
                disabled={!can(PERM.PURCHASING_PAY_BILL)}
              />
              <div className="w-px self-stretch bg-qb-line mx-2" aria-hidden="true" />
              <QbWorkflowTile
                label="Vendors"
                href="/dashboard/vendors"
                icon="vendor"
                accent="slate"
                disabled={!can(PERM.PURCHASING_VIEW)}
              />
            </QbWorkflowPanel>

            <QbWorkflowPanel title="Customers">
              <QbWorkflowTile
                label="Create Invoices"
                href="/dashboard/invoices/new"
                icon="invoice"
                accent="green"
                disabled={!can(PERM.SALES_CREATE_INVOICE)}
              />
              <QbFlowArrow />
              <QbWorkflowTile
                label="Receive Payments"
                href="/dashboard/payments/new"
                icon="payment"
                disabled={!can(PERM.SALES_RECEIVE_PAYMENT)}
              />
              <QbFlowArrow />
              <QbWorkflowTile
                label="Record Deposits"
                href="/dashboard/accounting/deposits"
                icon="deposit"
                disabled={!can(PERM.ACCOUNTING_POST_JOURNAL)}
              />
              <div className="w-px self-stretch bg-qb-line mx-2" aria-hidden="true" />
              <QbWorkflowTile
                label="Customers"
                href="/dashboard/customers"
                icon="customer"
                accent="slate"
                disabled={!can(PERM.SALES_VIEW)}
              />
              <QbWorkflowTile
                label="Invoice List"
                href="/dashboard/invoices"
                icon="invoice"
                accent="slate"
                disabled={!can(PERM.SALES_VIEW)}
              />
            </QbWorkflowPanel>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              <QbWorkflowPanel title="Inventory">
                <QbWorkflowTile
                  label="Item List"
                  href="/dashboard/items"
                  icon="item"
                  disabled={!can(PERM.INVENTORY_VIEW)}
                  badge={lowStockCount || undefined}
                />
                <QbWorkflowTile
                  label="Adjust Quantity"
                  href="/dashboard/items/adjust"
                  icon="adjust"
                  disabled={!can(PERM.INVENTORY_ADJUST)}
                />
              </QbWorkflowPanel>

              <QbWorkflowPanel title="Company">
                <QbWorkflowTile
                  label="Reports"
                  href="/dashboard/reports"
                  icon="report"
                  disabled={!can(PERM.REPORTS_VIEW_SALES)}
                />
                <QbWorkflowTile
                  label="Chart of Accounts"
                  href="/dashboard/accounting/accounts"
                  icon="ledger"
                  disabled={!can(PERM.ACCOUNTING_VIEW_GL)}
                />
                <QbWorkflowTile
                  label="Audit Trail"
                  href="/dashboard/audit"
                  icon="audit"
                  disabled={!can(PERM.AUDIT_VIEW)}
                />
              </QbWorkflowPanel>
            </div>
          </div>

          {/* ───────────────────────────── Right rail ───────────────────── */}
          <div className="flex flex-col gap-2 min-w-0">
            <QbFieldset legend="Account Balances">
              <table className="qb-grid">
                <tbody>
                  <tr>
                    <td>Accounts Receivable</td>
                    <td className="qb-grid-num w-[88px]">
                      {formatMoney(arTotal)}
                    </td>
                  </tr>
                  {can(PERM.PURCHASING_ENTER_BILL) ? (
                    <tr>
                      <td>Accounts Payable</td>
                      <td className="qb-grid-num">{formatMoney(apTotal)}</td>
                    </tr>
                  ) : null}
                  {showValuation && inventoryValue !== null ? (
                    <tr>
                      <td>Inventory Asset</td>
                      <td className="qb-grid-num">{formatMoney(inventoryValue)}</td>
                    </tr>
                  ) : null}
                  {arAccount ? (
                    <tr>
                      <td className="text-qb-inkMuted">
                        {arAccount.number} GL balance
                      </td>
                      <td className="qb-grid-num text-qb-inkMuted">
                        {formatMoney(arAccount.balance)}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </QbFieldset>

            <QbFieldset legend="Today">
              <table className="qb-grid">
                <tbody>
                  <tr>
                    <td>Invoiced</td>
                    <td className="qb-grid-num w-[88px]">
                      {formatMoney(todaySales)}
                    </td>
                  </tr>
                  <tr>
                    <td>Tickets</td>
                    <td className="qb-grid-num">{todayInvoices.length}</td>
                  </tr>
                  {/*
                    Gross profit is cost-derived, so it is behind
                    inventory.view_margin. A counter terminal sees the two
                    rows above and nothing more.
                  */}
                  {can(PERM.INVENTORY_VIEW_MARGIN) ? (
                    <>
                      <tr>
                        <td>Cost of Goods</td>
                        <td className="qb-grid-num">{formatMoney(todayCost)}</td>
                      </tr>
                      <tr className="font-bold">
                        <td>Gross Profit</td>
                        <td className="qb-grid-num">
                          {formatMoney(todaySales - todayCost)}
                        </td>
                      </tr>
                    </>
                  ) : null}
                </tbody>
              </table>
            </QbFieldset>

            <QbFieldset legend="Reminders">
              <ul className="text-qb space-y-1">
                {lowStockCount > 0 && can(PERM.INVENTORY_VIEW) ? (
                  <li>
                    <Link
                      href="/dashboard/items?filter=low-stock"
                      className="text-qb-blue hover:underline"
                    >
                      {lowStockCount} item{lowStockCount === 1 ? "" : "s"} at or
                      below reorder point
                    </Link>
                  </li>
                ) : null}
                {openInvoices.length > 0 ? (
                  <li>
                    <Link
                      href="/dashboard/invoices?status=open"
                      className="text-qb-blue hover:underline"
                    >
                      {openInvoices.length} open invoice
                      {openInvoices.length === 1 ? "" : "s"} totalling{" "}
                      {formatCurrency(arTotal)}
                    </Link>
                  </li>
                ) : null}
                {receivablePos > 0 && can(PERM.PURCHASING_RECEIVE) ? (
                  <li>
                    <Link
                      href="/dashboard/purchase-orders?filter=receivable"
                      className="text-qb-blue hover:underline"
                    >
                      {receivablePos} purchase order
                      {receivablePos === 1 ? "" : "s"} awaiting receipt
                    </Link>
                  </li>
                ) : null}
                {lowStockCount === 0 && openInvoices.length === 0 ? (
                  <li className="text-qb-inkMuted">Nothing needs attention.</li>
                ) : null}
              </ul>
            </QbFieldset>

            {!showCost ? (
              <QbBanner variant="warn" title="Counter view">
                Purchase costs and profit margins are not available to your
                role. Selling prices and the minimum price are.
              </QbBanner>
            ) : null}

            {can(PERM.AUDIT_VIEW) && recentOverrides.length > 0 ? (
              <QbFieldset legend="Recent Price Overrides">
                <table className="qb-grid">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="text-right w-[52px]">Min</th>
                      <th className="text-right w-[52px]">Sold</th>
                      <th className="w-[40px]">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOverrides.map((o) => (
                      <tr key={o.id}>
                        <td title={o.sku}>{o.sku}</td>
                        <td className="qb-grid-num">{formatMoney(o.minimumPrice)}</td>
                        <td className="qb-grid-num text-qb-red font-bold">
                          {formatMoney(o.approvedPrice)}
                        </td>
                        <td>{o.approvedBy.employeeCode}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Link
                  href="/dashboard/audit?action=PRICE_OVERRIDE_APPROVED"
                  className="text-qb-xs text-qb-blue hover:underline inline-block pt-1"
                >
                  View full audit trail &rarr;
                </Link>
              </QbFieldset>
            ) : null}
          </div>
        </div>
      </QbWindow>

      {/* ─────────────────────────────── Recent invoices ───────────────── */}
      <QbWindow title="Recent Invoices" bodyClassName="bg-white">
        {recentInvoices.length === 0 ? (
          <QbEmpty>
            No invoices yet.{" "}
            <Link href="/dashboard/invoices/new" className="text-qb-blue hover:underline">
              Create the first one.
            </Link>
          </QbEmpty>
        ) : (
          <table className="qb-grid">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Invoice #</th>
                <th style={{ width: 80 }}>Date</th>
                <th>Customer</th>
                <th style={{ width: 90 }}>Plate</th>
                <th style={{ width: 100 }}>Status</th>
                <th style={{ width: 90 }} className="text-right">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {recentInvoices.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <Link
                      href={"/dashboard/invoices/" + inv.id}
                      className="text-qb-blue hover:underline font-qbMono"
                    >
                      {inv.invoiceNo}
                    </Link>
                  </td>
                  <td className="font-qbMono">
                    {inv.invoiceDate.toLocaleDateString("en-US", {
                      month: "2-digit",
                      day: "2-digit",
                      year: "2-digit",
                    })}
                  </td>
                  <td className="truncate">{inv.customer.companyName}</td>
                  <td className="font-qbMono">{inv.licensePlate ?? ""}</td>
                  <td>
                    <QbPill status={inv.status} />
                  </td>
                  <td className="qb-grid-num">{formatMoney(inv.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QbWindow>
    </div>
  );
}
