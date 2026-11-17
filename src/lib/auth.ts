import "server-only";

import { cookies, headers } from "next/headers";
import { cache } from "react";
import { createHmac, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import {
  PERM,
  PermissionError,
  ROLE_PERMISSIONS,
  type Permission,
  type RoleCodeName,
} from "@/lib/permissions";

const COOKIE_NAME = "gtp_session";
const SESSION_TTL_HOURS = 12; // one shift
const BCRYPT_ROUNDS = 10;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "SESSION_SECRET is missing or too short. Set it in .env (min 32 chars).",
    );
  }
  return s;
}

/** Opaque token the browser holds; only its SHA-256 is stored server-side. */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sign(token: string): string {
  return createHmac("sha256", secret()).update(token).digest("base64url");
}

/** Constant-time compare so a signature cannot be brute-forced byte by byte. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function hashOverrideCode(code: string): Promise<string> {
  return bcrypt.hash(code.trim(), BCRYPT_ROUNDS);
}

/**
 * The authenticated principal. `permissions` is resolved once per request and
 * is the ONLY thing authorization decisions may read.
 */
export interface AuthUser {
  id: string;
  employeeCode: string;
  email: string;
  fullName: string;
  roleCode: RoleCodeName;
  roleName: string;
  maxDiscountPct: number;
  permissions: Permission[];
}

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/** Best-effort client IP, honouring the usual proxy headers. */
export async function getRequestMeta(): Promise<RequestMeta> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    return {
      ipAddress:
        forwarded?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
      userAgent: h.get("user-agent"),
    };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

/**
 * Resolve the current user from the session cookie.
 *
 * Wrapped in React's `cache` so a page that calls it in a layout, a page and
 * three components still performs exactly one database round trip.
 */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  let raw: string | undefined;
  try {
    raw = (await cookies()).get(COOKIE_NAME)?.value;
  } catch {
    return null;
  }
  if (!raw) return null;

  const sep = raw.lastIndexOf(".");
  if (sep <= 0) return null;
  const token = raw.slice(0, sep);
  const signature = raw.slice(sep + 1);
  if (!safeEqual(signature, sign(token))) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { role: true } } },
  });

  if (!session || session.expiresAt < new Date()) return null;
  if (!session.user.isActive) return null;

  const roleCode = session.user.role.code as RoleCodeName;

  // Permissions come from the DB so an admin can re-grant at runtime; the
  // code-level defaults are the fallback for a role with no rows yet.
  const granted = await prisma.rolePermission.findMany({
    where: { roleId: session.user.roleId },
    include: { permission: true },
  });

  const permissions =
    granted.length > 0
      ? (granted.map((g) => g.permission.key) as Permission[])
      : (ROLE_PERMISSIONS[roleCode] ?? []);

  return {
    id: session.user.id,
    employeeCode: session.user.employeeCode,
    email: session.user.email,
    fullName: session.user.fullName,
    roleCode,
    roleName: session.user.role.name,
    maxDiscountPct: Number(session.user.role.maxDiscountPct),
    permissions,
  };
});

export async function createSession(userId: string): Promise<void> {
  const token = newToken();
  const meta = await getRequestMeta();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    },
  });

  (await cookies()).set(COOKIE_NAME, token + "." + sign(token), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (raw) {
    const sep = raw.lastIndexOf(".");
    const token = sep > 0 ? raw.slice(0, sep) : raw;
    await prisma.session
      .deleteMany({ where: { tokenHash: hashToken(token) } })
      .catch(() => undefined);
  }
  jar.delete(COOKIE_NAME);
}

/** Housekeeping; safe to call from a cron route. */
export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}

export class AuthError extends Error {
  readonly statusCode = 401;
  constructor(message = "Not signed in") {
    super(message);
    this.name = "AuthError";
  }
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError();
  return user;
}

export function userCan(user: AuthUser | null, perm: Permission): boolean {
  return !!user && user.permissions.includes(perm);
}

/**
 * The authorization choke point. Every server action and API route that does
 * anything privileged starts with a call to this.
 *
 * A denial is recorded in the audit trail — attempts matter as much as
 * successes when a counter terminal starts probing for cost data.
 */
export async function requirePermission(perm: Permission): Promise<AuthUser> {
  const user = await requireUser();
  if (!user.permissions.includes(perm)) {
    // Imported lazily: audit.ts imports auth.ts, so a static import here
    // would be a cycle.
    const { writeAuditLog } = await import("@/lib/audit");
    await writeAuditLog({
      action: "PERMISSION_DENIED",
      entity: "Permission",
      entityId: perm,
      summary:
        user.fullName + " was denied " + perm + " (role " + user.roleCode + ")",
      isSensitive: true,
      user,
    });
    throw new PermissionError(perm);
  }
  return user;
}

/** Convenience: may the current user see purchase costs at all? */
export async function canViewCost(): Promise<boolean> {
  return userCan(await getCurrentUser(), PERM.INVENTORY_VIEW_COST);
}

/**
 * Verify a manager's override code. Returns the approving user, or null.
 *
 * Takes an employee code rather than a user id so the counter clerk never
 * needs to know (or be able to enumerate) internal identifiers.
 */
export async function verifyOverrideCode(
  employeeCode: string,
  code: string,
): Promise<AuthUser | null> {
  const approver = await prisma.user.findFirst({
    where: { employeeCode: employeeCode.trim().toUpperCase(), isActive: true },
    include: { role: true },
  });
  if (!approver?.overrideCodeHash) return null;

  const ok = await bcrypt.compare(code.trim(), approver.overrideCodeHash);
  if (!ok) return null;

  const roleCode = approver.role.code as RoleCodeName;
  const granted = await prisma.rolePermission.findMany({
    where: { roleId: approver.roleId },
    include: { permission: true },
  });
  const permissions =
    granted.length > 0
      ? (granted.map((g) => g.permission.key) as Permission[])
      : (ROLE_PERMISSIONS[roleCode] ?? []);

  // Holding a valid code is not enough — the role must carry the approval
  // permission. This stops a demoted manager's old code from working.
  if (!permissions.includes(PERM.PRICING_APPROVE_OVERRIDE)) return null;

  return {
    id: approver.id,
    employeeCode: approver.employeeCode,
    email: approver.email,
    fullName: approver.fullName,
    roleCode,
    roleName: approver.role.name,
    maxDiscountPct: Number(approver.role.maxDiscountPct),
    permissions,
  };
}
