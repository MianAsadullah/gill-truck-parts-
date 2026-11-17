import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM, ROLE_LABELS } from "@/lib/permissions";
import { QbMenuBar } from "@/components/qb/MenuBar";
import { QbIconBar, type ShortcutSection } from "@/components/qb/IconBar";
import { QbStatusBar } from "@/components/qb/StatusBar";
import { prisma } from "@/lib/db";

/**
 * The application shell: menu bar across the top, collapsible icon bar down
 * the left, document area in the middle, status bar along the bottom. The
 * whole thing is fixed to the viewport and only the document area scrolls,
 * which is what makes it feel like a desktop app rather than a web page.
 *
 * Shortcuts are filtered by permission here, server-side. A counter
 * terminal's HTML never contains a link to the inventory valuation report.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const can = (perm: string) => user.permissions.includes(perm as never);

  const [company, openInvoiceCount, receivablePoCount] = await Promise.all([
    prisma.companySettings.findUnique({ where: { id: "default" } }),
    prisma.invoice.count({ where: { status: { in: ["OPEN", "PARTIALLY_PAID"] } } }),
    can(PERM.PURCHASING_VIEW)
      ? prisma.purchaseOrder.count({
          where: { status: { in: ["OPEN", "PARTIALLY_RECEIVED"] } },
        })
      : Promise.resolve(0),
  ]);

  const sections: ShortcutSection[] = [
    {
      title: "Home",
      items: [{ label: "Home Page", href: "/dashboard", icon: "home" }],
    },
    {
      title: "Customers",
      items: [
        ...(can(PERM.SALES_CREATE_INVOICE)
          ? ([{ label: "Create Invoice", href: "/dashboard/invoices/new", icon: "invoice" }] as const)
          : []),
        ...(can(PERM.SALES_VIEW)
          ? ([
              {
                label: "Invoices",
                href: "/dashboard/invoices",
                icon: "invoice",
                badge: openInvoiceCount || undefined,
              },
              { label: "Customers", href: "/dashboard/customers", icon: "customer" },
            ] as const)
          : []),
        ...(can(PERM.SALES_RECEIVE_PAYMENT)
          ? ([{ label: "Receive Payment", href: "/dashboard/payments/new", icon: "payment" }] as const)
          : []),
      ],
    },
    {
      title: "Vendors",
      items: [
        ...(can(PERM.PURCHASING_VIEW)
          ? ([
              {
                label: "Purchase Orders",
                href: "/dashboard/purchase-orders",
                icon: "po",
                badge: receivablePoCount || undefined,
              },
              { label: "Vendors", href: "/dashboard/vendors", icon: "vendor" },
            ] as const)
          : []),
        ...(can(PERM.PURCHASING_RECEIVE)
          ? ([
              {
                label: "Receive Inventory",
                href: "/dashboard/purchase-orders?filter=receivable",
                icon: "receive",
              },
            ] as const)
          : []),
        ...(can(PERM.PURCHASING_ENTER_BILL)
          ? ([{ label: "Bills", href: "/dashboard/bills", icon: "bill" }] as const)
          : []),
      ],
    },
    {
      title: "Inventory",
      items: [
        ...(can(PERM.INVENTORY_VIEW)
          ? ([{ label: "Item List", href: "/dashboard/items", icon: "item" }] as const)
          : []),
      ],
    },
    {
      title: "Accounting",
      items: [
        ...(can(PERM.ACCOUNTING_VIEW_GL)
          ? ([
              {
                label: "Chart of Accounts",
                href: "/dashboard/accounting/accounts",
                icon: "ledger",
              },
              {
                label: "General Ledger",
                href: "/dashboard/accounting/general-ledger",
                icon: "ledger",
              },
            ] as const)
          : []),
        ...(can(PERM.SALES_VIEW)
          ? ([
              { label: "A/R Aging", href: "/dashboard/accounting/ar-aging", icon: "report" },
            ] as const)
          : []),
        ...(can(PERM.PURCHASING_ENTER_BILL)
          ? ([
              { label: "A/P Aging", href: "/dashboard/accounting/ap-aging", icon: "report" },
            ] as const)
          : []),
      ],
    },
    {
      title: "Reports",
      items: [
        ...(can(PERM.REPORTS_VIEW_SALES)
          ? ([{ label: "Reports", href: "/dashboard/reports", icon: "report" }] as const)
          : []),
        ...(can(PERM.AUDIT_VIEW)
          ? ([{ label: "Audit Trail", href: "/dashboard/audit", icon: "audit" }] as const)
          : []),
        ...(can(PERM.ADMIN_SETTINGS)
          ? ([{ label: "Preferences", href: "/dashboard/settings", icon: "settings" }] as const)
          : []),
      ],
    },
  ].filter((section) => section.items.length > 0) as ShortcutSection[];

  const userLabel = user.fullName + " (" + user.employeeCode + ")";
  const roleLabel = ROLE_LABELS[user.roleCode] ?? user.roleName;

  return (
    <div className="h-full w-full flex flex-col bg-qb-chrome">
      <QbMenuBar />

      <div className="flex-1 min-h-0 flex">
        <QbIconBar sections={sections} userLabel={userLabel} roleLabel={roleLabel} />
        <main className="flex-1 min-w-0 min-h-0 overflow-auto p-2">{children}</main>
      </div>

      <QbStatusBar
        companyName={company?.legalName ?? "Gill Truck Parts"}
        userLabel={userLabel}
        roleLabel={roleLabel}
      />
    </div>
  );
}
