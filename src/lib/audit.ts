import "server-only";

import type { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, getRequestMeta, type AuthUser } from "@/lib/auth";
import type { Tx } from "@/lib/db";

/**
 * Audit trail (AUD).
 *
 * The audit_logs table is append-only: a Postgres trigger installed by
 * migration `rls_and_audit_guards` raises an exception on UPDATE or DELETE,
 * so neither this application nor a compromised DB role can rewrite history.
 * There is intentionally no updateAuditLog / deleteAuditLog export.
 */

export interface AuditInput {
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  summary: string;
  /** Field-level before/after, for UPDATE actions. */
  changes?: Prisma.InputJsonValue | null;
  /** Surfaces the row in the compliance report (overrides, voids, denials). */
  isSensitive?: boolean;
  /** Pass the already-resolved user to avoid a second lookup. */
  user?: AuthUser | null;
  /** Pass the transaction client to make the log atomic with its subject. */
  tx?: Tx;
}

/**
 * Write one audit row. Never throws: an audit failure must not roll back a
 * legitimate sale at the counter. Failures are logged to stderr so they
 * surface in monitoring instead of disappearing.
 *
 * When `tx` is supplied the write joins that transaction and WILL roll back
 * with it — which is what we want for price overrides, where the log and the
 * invoice must be all-or-nothing.
 */
export async function writeAuditLog(input: AuditInput): Promise<void> {
  try {
    const user = input.user ?? (await getCurrentUser());
    const meta = await getRequestMeta();
    const client = input.tx ?? prisma;

    await client.auditLog.create({
      data: {
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        userId: user?.id ?? null,
        userLabel: user ? user.fullName + " (" + user.employeeCode + ")" : "system",
        roleCode: user?.roleCode ?? null,
        summary: input.summary,
        changes: input.changes ?? undefined,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        isSensitive: input.isSensitive ?? false,
      },
    });
  } catch (err) {
    if (input.tx) throw err; // transactional callers must see the failure
    console.error("[audit] failed to write audit log", err);
  }
}

type JsonScalar = string | number | boolean | null;

/**
 * Flatten a value into something JSON-safe. Prisma Decimal and Date both
 * stringify sensibly, and anything else exotic becomes its string form
 * rather than failing the write.
 */
function normalizeForLog(value: unknown): JsonScalar {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return String(value);
}

/**
 * Diff two records down to the fields that actually changed, so an UPDATE
 * log says "price 412.00 -> 389.00" rather than dumping the whole row.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: (keyof T)[],
): Prisma.InputJsonValue | null {
  const changes: Record<string, { from: JsonScalar; to: JsonScalar }> = {};
  for (const field of fields) {
    if (!(field in after)) continue;
    const from = normalizeForLog(before[field]);
    const to = normalizeForLog(after[field]);
    if (from !== to) changes[String(field)] = { from, to };
  }
  return Object.keys(changes).length > 0
    ? (changes as unknown as Prisma.InputJsonValue)
    : null;
}
