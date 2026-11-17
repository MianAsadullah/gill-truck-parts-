import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PERM, PERMISSION_CATALOG, ROLE_LABELS, type RoleCodeName } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatPercent, num } from "@/lib/money";
import { QbWindow, QbBanner, QbFieldset } from "@/components/qb/Ui";
import { cn } from "@/lib/cn";

export const metadata = { title: "Preferences — Gill Truck Parts" };

/**
 * Preferences (SEC).
 *
 * Read-only in this build. It is still worth having, because the permission
 * matrix is the thing people most often need to see and most often guess
 * wrong about — "can the counter see cost?" is answered here definitively
 * rather than by reading code.
 */
export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.ADMIN_SETTINGS)) {
    return (
      <QbWindow title="Preferences">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot view company preferences.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const [company, roles, users, terms, taxCodes] = await Promise.all([
    prisma.companySettings.findUnique({ where: { id: "default" } }),
    prisma.role.findMany({
      orderBy: { code: "asc" },
      include: {
        permissions: { include: { permission: { select: { key: true } } } },
        _count: { select: { users: true } },
      },
    }),
    prisma.user.findMany({
      orderBy: { employeeCode: "asc" },
      include: { role: { select: { code: true, name: true } } },
    }),
    prisma.terms.findMany({ orderBy: { netDays: "asc" } }),
    prisma.taxCode.findMany({ orderBy: { code: "asc" } }),
  ]);

  // The permissions worth calling out on their own line, because they are
  // the ones that decide whether money and cost are visible.
  const KEY_PERMISSIONS = [
    PERM.INVENTORY_VIEW_COST,
    PERM.INVENTORY_VIEW_MARGIN,
    PERM.PRICING_SELL_BELOW_MIN,
    PERM.PRICING_APPROVE_OVERRIDE,
    PERM.REPORTS_VIEW_PROFIT,
    PERM.AUDIT_VIEW,
  ];

  return (
    <QbWindow title="Preferences" subtitle="— read-only" bodyClassName="bg-qb-chrome">
      <div className="p-2 space-y-2">
        <QbBanner variant="warn">
          This screen is read-only in this build. Company details, users, terms and tax codes
          are editable through the database or the seed.
        </QbBanner>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 items-start">
          <QbFieldset legend="Company">
            <table className="qb-grid bg-white">
              <tbody>
                <tr>
                  <td className="w-[160px] font-bold">Legal name</td>
                  <td>{company?.legalName ?? "Gill Truck Parts"}</td>
                </tr>
                <tr>
                  <td className="font-bold">Address</td>
                  <td>
                    {company?.address1 ?? ""}
                    {company?.city ? ", " + company.city : ""} {company?.state ?? ""}{" "}
                    {company?.postalCode ?? ""}
                  </td>
                </tr>
                <tr>
                  <td className="font-bold">Phone</td>
                  <td className="font-qbMono">{company?.phone ?? ""}</td>
                </tr>
                <tr>
                  <td className="font-bold">Tax ID</td>
                  <td className="font-qbMono">{company?.taxId ?? ""}</td>
                </tr>
                <tr className={cn(company?.allowPriceOverride === false && "bg-qb-warnBg")}>
                  <td className="font-bold">Price overrides</td>
                  <td>
                    {company?.allowPriceOverride === false ? (
                      <strong className="text-qb-red">
                        DISABLED company-wide — no below-minimum sale is possible
                      </strong>
                    ) : (
                      "Allowed with a manager override code"
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="font-bold">Fiscal year starts</td>
                  <td>Month {company?.fiscalYearStartMonth ?? 1}</td>
                </tr>
              </tbody>
            </table>
          </QbFieldset>

          <QbFieldset legend="Users">
            <table className="qb-grid bg-white">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Code</th>
                  <th>Name</th>
                  <th style={{ width: 130 }}>Role</th>
                  <th style={{ width: 56 }} className="text-center">Override</th>
                  <th style={{ width: 50 }} className="text-center">Active</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={cn(!u.isActive && "text-qb-inkDisabled")}>
                    <td className="font-qbMono">{u.employeeCode}</td>
                    <td className="truncate">{u.fullName}</td>
                    <td className="text-qb-xs">{u.role.name}</td>
                    <td className="text-center text-qb-xs">
                      {u.overrideCodeHash ? (
                        <span className="text-qb-greenDark" title="Has an override code set">
                          set
                        </span>
                      ) : (
                        <span className="text-qb-inkDisabled">—</span>
                      )}
                    </td>
                    <td className="text-center text-qb-xs">{u.isActive ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </QbFieldset>
        </div>

        <QbFieldset legend="Permission Matrix — who can see cost and approve discounts">
          <div className="overflow-x-auto">
            <table className="qb-grid bg-white min-w-[760px]">
              <thead>
                <tr>
                  <th style={{ width: 180 }}>Permission</th>
                  {roles.map((r) => (
                    <th key={r.id} className="text-center" style={{ width: 96 }}>
                      {ROLE_LABELS[r.code as RoleCodeName] ?? r.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {KEY_PERMISSIONS.map((perm) => (
                  <tr key={perm}>
                    <td title={PERMISSION_CATALOG[perm]?.description}>
                      {PERMISSION_CATALOG[perm]?.description ?? perm}
                    </td>
                    {roles.map((role) => {
                      const has = role.permissions.some((p) => p.permission.key === perm);
                      return (
                        <td
                          key={role.id}
                          className={cn(
                            "text-center font-bold",
                            has ? "text-qb-greenDark bg-qb-okBg" : "text-qb-red bg-qb-errBg",
                          )}
                        >
                          {has ? "YES" : "NO"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="bg-qb-grid-header">
                  <td className="font-bold">Max discount below minimum</td>
                  {roles.map((role) => (
                    <td key={role.id} className="text-center font-bold">
                      {num(role.maxDiscountPct) > 0
                        ? formatPercent(num(role.maxDiscountPct), 0)
                        : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="text-qb-inkMuted">Users in role</td>
                  {roles.map((role) => (
                    <td key={role.id} className="text-center text-qb-inkMuted">
                      {role._count.users}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="text-qb-xs text-qb-inkMuted pt-1">
            Grants live in the database and are re-synced from src/lib/permissions.ts by the
            seed, so the code and the data cannot drift apart silently.
          </div>
        </QbFieldset>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 items-start">
          <QbFieldset legend="Terms">
            <table className="qb-grid bg-white">
              <thead>
                <tr>
                  <th>Name</th>
                  <th style={{ width: 70 }} className="text-right">Net Days</th>
                  <th style={{ width: 90 }} className="text-right">Discount</th>
                </tr>
              </thead>
              <tbody>
                {terms.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td className="qb-grid-num">{t.netDays}</td>
                    <td className="qb-grid-num">
                      {num(t.discountPct) > 0
                        ? formatPercent(num(t.discountPct), 0) + " / " + t.discountDays + "d"
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </QbFieldset>

          <QbFieldset legend="Sales Tax Codes">
            <table className="qb-grid bg-white">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Code</th>
                  <th>Jurisdiction</th>
                  <th style={{ width: 80 }} className="text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {taxCodes.map((t) => (
                  <tr key={t.id} className={cn(!t.isActive && "text-qb-inkDisabled")}>
                    <td className="font-qbMono">{t.code}</td>
                    <td>{t.name}</td>
                    <td className="qb-grid-num">{formatPercent(num(t.rate), 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </QbFieldset>
        </div>
      </div>
    </QbWindow>
  );
}
