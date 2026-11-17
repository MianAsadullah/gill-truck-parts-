import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { QbWindow, QbFieldset } from "@/components/qb/Ui";

export const metadata = { title: "Reports — Gill Truck Parts" };

interface ReportLink {
  label: string;
  href: string;
  description: string;
  permission: string;
}

const GROUPS: { title: string; reports: ReportLink[] }[] = [
  {
    title: "Sales",
    reports: [
      {
        label: "Sales by Item Summary",
        href: "/dashboard/reports/sales-summary",
        description: "Units and revenue per part, with margin for roles that may see cost.",
        permission: PERM.REPORTS_VIEW_SALES,
      },
      {
        label: "Sales Tax Liability",
        href: "/dashboard/reports/sales-tax",
        description: "Taxable and non-taxable sales with tax collected, per tax code.",
        permission: PERM.REPORTS_VIEW_SALES,
      },
      {
        label: "A/R Aging Summary",
        href: "/dashboard/accounting/ar-aging",
        description: "Who owes what, bucketed by how late it is.",
        permission: PERM.SALES_VIEW,
      },
    ],
  },
  {
    title: "Inventory",
    reports: [
      {
        label: "Inventory Valuation",
        href: "/dashboard/reports/inventory-valuation",
        description: "Quantity on hand at average cost, with retail value and spread.",
        permission: PERM.REPORTS_VIEW_INVENTORY_VALUATION,
      },
      {
        label: "Reorder Report",
        href: "/dashboard/items?filter=low-stock",
        description: "Parts at or below their reorder point.",
        permission: PERM.INVENTORY_VIEW,
      },
    ],
  },
  {
    title: "Purchasing",
    reports: [
      {
        label: "A/P Aging Summary",
        href: "/dashboard/accounting/ap-aging",
        description: "What we owe, including stock received but not yet billed.",
        permission: PERM.PURCHASING_VIEW,
      },
      {
        label: "Open Purchase Orders",
        href: "/dashboard/purchase-orders?filter=receivable",
        description: "Orders awaiting delivery, with received-versus-ordered progress.",
        permission: PERM.PURCHASING_VIEW,
      },
    ],
  },
  {
    title: "Accountant",
    reports: [
      {
        label: "Trial Balance",
        href: "/dashboard/accounting/trial-balance",
        description: "Every account's debit and credit position, summed from postings.",
        permission: PERM.ACCOUNTING_VIEW_GL,
      },
      {
        label: "General Ledger",
        href: "/dashboard/accounting/general-ledger",
        description: "Posting detail per account with a running balance.",
        permission: PERM.ACCOUNTING_VIEW_GL,
      },
      {
        label: "Audit Trail",
        href: "/dashboard/audit",
        description: "Every login, posting, void and price override, append-only.",
        permission: PERM.AUDIT_VIEW,
      },
    ],
  },
];

/**
 * Report Centre (REP).
 *
 * Reports the signed-in role cannot run are not listed at all — a counter
 * terminal's HTML contains no link to inventory valuation, so there is
 * nothing to discover by reading the page source.
 */
export default async function ReportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const can = (perm: string) => user.permissions.includes(perm as never);

  const groups = GROUPS.map((g) => ({
    ...g,
    reports: g.reports.filter((r) => can(r.permission)),
  })).filter((g) => g.reports.length > 0);

  return (
    <QbWindow title="Report Centre" subtitle={"— " + user.roleName} bodyClassName="bg-qb-chrome">
      <div className="p-2 grid grid-cols-1 md:grid-cols-2 gap-2 items-start">
        {groups.map((group) => (
          <QbFieldset key={group.title} legend={group.title}>
            <ul className="space-y-[6px] pt-1">
              {group.reports.map((report) => (
                <li key={report.href}>
                  <Link
                    href={report.href}
                    className="text-qb font-bold text-qb-blue hover:underline"
                  >
                    {report.label}
                  </Link>
                  <div className="text-qb-xs text-qb-inkMuted">{report.description}</div>
                </li>
              ))}
            </ul>
          </QbFieldset>
        ))}
        {groups.length === 0 ? (
          <QbFieldset legend="No reports">
            <div className="text-qb text-qb-inkMuted">
              Your role does not have access to any reports.
            </div>
          </QbFieldset>
        ) : null}
      </div>
    </QbWindow>
  );
}
