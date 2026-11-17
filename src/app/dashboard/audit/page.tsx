import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma, AuditAction } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { PERM } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney, num, sumMoney } from "@/lib/money";
import { QbWindow, QbBanner, QbEmpty, QbButton, QbSelect, QbInput, QbFieldset } from "@/components/qb/Ui";
import { cn } from "@/lib/cn";

export const metadata = { title: "Audit Trail — Gill Truck Parts" };

const ACTIONS: AuditAction[] = [
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
  "CREATE",
  "UPDATE",
  "DELETE",
  "VOID",
  "POST",
  "PRICE_OVERRIDE_REQUESTED",
  "PRICE_OVERRIDE_APPROVED",
  "PRICE_OVERRIDE_DENIED",
  "PERMISSION_DENIED",
  "COST_VIEW",
  "EXPORT",
  "RECEIVE",
  "PAYMENT",
];

/**
 * Audit Trail (AUD).
 *
 * Read-only by construction: the table is append-only and this page offers
 * no mutation path. The default view is "sensitive only", because that is
 * the set anyone opening this screen is actually looking for — overrides,
 * voids, failed logins and permission denials — rather than the much larger
 * stream of routine postings.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; sensitive?: string; q?: string; from?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!user.permissions.includes(PERM.AUDIT_VIEW)) {
    return (
      <QbWindow title="Audit Trail">
        <div className="p-3">
          <QbBanner variant="err" title="Access denied">
            Your role ({user.roleName}) cannot view the audit trail.
          </QbBanner>
        </div>
      </QbWindow>
    );
  }

  const params = await searchParams;
  const action = params.action ?? "";
  const sensitiveOnly = params.sensitive !== "0";
  const q = (params.q ?? "").trim();
  const from = params.from ? new Date(params.from + "T00:00:00") : null;

  const where: Prisma.AuditLogWhereInput = {
    ...(action ? { action: action as AuditAction } : {}),
    ...(sensitiveOnly ? { isSensitive: true } : {}),
    ...(from ? { createdAt: { gte: from } } : {}),
    ...(q
      ? {
          OR: [
            { summary: { contains: q, mode: "insensitive" } },
            { userLabel: { contains: q, mode: "insensitive" } },
            { entity: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [logs, overrideStats] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.priceOverride.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        concessionAmount: true,
        approvedBy: { select: { employeeCode: true, fullName: true } },
        requestedBy: { select: { employeeCode: true } },
      },
    }),
  ]);

  // Who is giving away the most money, and who is asking. This is the
  // question the override log exists to answer.
  const byApprover = new Map<string, { label: string; count: number; amount: number }>();
  for (const o of overrideStats) {
    const key = o.approvedBy.employeeCode;
    const entry = byApprover.get(key) ?? {
      label: o.approvedBy.employeeCode + " — " + o.approvedBy.fullName,
      count: 0,
      amount: 0,
    };
    entry.count += 1;
    entry.amount += num(o.concessionAmount);
    byApprover.set(key, entry);
  }
  const approvers = [...byApprover.values()].sort((a, b) => b.amount - a.amount);
  const totalConceded = sumMoney(overrideStats.map((o) => o.concessionAmount));

  return (
    <QbWindow
      title="Audit Trail"
      subtitle={"— " + logs.length + " entries"}
      bodyClassName="bg-white"
    >
      <form
        method="get"
        className="bg-qb-chrome border-b border-qb-line px-2 py-1 flex items-end gap-2 flex-wrap sticky top-0 z-20"
      >
        <div>
          <label htmlFor="action" className="qb-label block">Action</label>
          <QbSelect id="action" name="action" defaultValue={action} className="w-[220px]">
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a.replace(/_/g, " ")}
              </option>
            ))}
          </QbSelect>
        </div>
        <div>
          <label htmlFor="from" className="qb-label block">Since</label>
          <QbInput id="from" name="from" type="date" defaultValue={params.from ?? ""} className="w-[140px]" />
        </div>
        <div>
          <label htmlFor="q" className="qb-label block">Contains</label>
          <QbInput id="q" name="q" defaultValue={q} className="w-[220px]" placeholder="user, entity, or text" />
        </div>
        <label className="flex items-center gap-1 text-qb pb-[3px]">
          <input type="checkbox" name="sensitive" value="1" defaultChecked={sensitiveOnly} className="qb-checkbox" />
          Sensitive only
        </label>
        <input type="hidden" name="sensitive" value="0" />
        <QbButton type="submit" size="sm">Apply</QbButton>
        <Link href="/dashboard/audit?sensitive=0" className="qb-btn qb-btn-sm">
          Show everything
        </Link>
      </form>

      <div className="p-2 space-y-2">
        {approvers.length > 0 ? (
          <QbFieldset legend="Price Override Summary">
            <div className="flex flex-wrap gap-6 items-start">
              <table className="qb-grid w-[380px] bg-white">
                <thead>
                  <tr>
                    <th>Approved By</th>
                    <th style={{ width: 60 }} className="text-right">Count</th>
                    <th style={{ width: 100 }} className="text-right">Conceded</th>
                  </tr>
                </thead>
                <tbody>
                  {approvers.map((a) => (
                    <tr key={a.label}>
                      <td className="truncate">{a.label}</td>
                      <td className="qb-grid-num">{a.count}</td>
                      <td className="qb-grid-num text-qb-red font-bold">
                        {formatMoney(a.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-qb-grid-header font-bold">
                    <td className="border border-qb-gridLine px-1 text-right">Total</td>
                    <td className="border border-qb-gridLine px-1 qb-grid-num">
                      {overrideStats.length}
                    </td>
                    <td className="border border-qb-gridLine px-1 qb-grid-num">
                      {formatMoney(totalConceded)}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <div className="text-qb-xs text-qb-inkMuted max-w-[420px]">
                Dollars given away below the minimum price, by the manager who authorized it.
                Each row here is backed by an immutable PriceOverride record written in the
                same transaction as the invoice, so it cannot be edited or removed after the
                fact.
              </div>
            </div>
          </QbFieldset>
        ) : null}

        {logs.length === 0 ? (
          <QbEmpty>No audit entries match this filter.</QbEmpty>
        ) : (
          <table className="qb-grid">
            <thead>
              <tr>
                <th style={{ width: 128 }}>When</th>
                <th style={{ width: 170 }}>Action</th>
                <th style={{ width: 150 }}>User</th>
                <th style={{ width: 96 }}>Role</th>
                <th>Summary</th>
                <th style={{ width: 100 }}>Entity</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className={cn(log.isSensitive && "bg-qb-warnBg")}>
                  <td className="font-qbMono text-qb-xs">
                    {log.createdAt.toLocaleString("en-US", {
                      month: "2-digit",
                      day: "2-digit",
                      year: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </td>
                  <td
                    className={cn(
                      "text-qb-xs font-bold",
                      log.action.startsWith("PRICE_OVERRIDE") && "text-qb-red",
                      log.action === "PERMISSION_DENIED" && "text-qb-red",
                      log.action === "LOGIN_FAILED" && "text-qb-amber",
                      log.action === "VOID" && "text-qb-red",
                    )}
                  >
                    {log.isSensitive ? "⚠ " : ""}
                    {log.action.replace(/_/g, " ")}
                  </td>
                  <td className="truncate">{log.userLabel ?? "system"}</td>
                  <td className="text-qb-xs">{log.roleCode ?? ""}</td>
                  <td className="whitespace-normal">{log.summary}</td>
                  <td className="text-qb-xs text-qb-inkMuted">{log.entity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="text-qb-xs text-qb-inkMuted">
          This log is append-only. The application exposes no update or delete path for it,
          and a database trigger should be installed in production to reject UPDATE and
          DELETE on the table outright.
        </div>
      </div>
    </QbWindow>
  );
}
