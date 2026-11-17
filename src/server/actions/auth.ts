"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  createSession,
  destroySession,
  verifyPassword,
  getCurrentUser,
} from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { ROLE_PERMISSIONS, type RoleCodeName, type Permission } from "@/lib/permissions";

const loginSchema = z.object({
  email: z.string().trim().min(1, "Enter your user name or e-mail").toLowerCase(),
  password: z.string().min(1, "Enter your password"),
});

export type LoginState = { error?: string } | undefined;

/**
 * Sign in. Deliberately vague on failure — "not recognized" rather than
 * "no such user" or "wrong password" — so the form cannot be used to
 * enumerate who works here.
 */
export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter your credentials." };
  }

  const { email, password } = parsed.data;

  // Accept either the e-mail or the employee code, since staff know their
  // initials better than their e-mail address.
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { employeeCode: email.toUpperCase() }],
    },
    include: { role: true },
  });

  if (!user || !user.isActive) {
    await writeAuditLog({
      action: "LOGIN_FAILED",
      entity: "User",
      summary: "Failed sign-in for '" + email + "' (unknown or inactive account)",
      isSensitive: true,
      user: null,
    });
    return { error: "That user name and password were not recognized." };
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const roleCode = user.role.code as RoleCodeName;
    await writeAuditLog({
      action: "LOGIN_FAILED",
      entity: "User",
      entityId: user.id,
      summary: "Failed sign-in for " + user.fullName + " (bad password)",
      isSensitive: true,
      user: {
        id: user.id,
        employeeCode: user.employeeCode,
        email: user.email,
        fullName: user.fullName,
        roleCode,
        roleName: user.role.name,
        maxDiscountPct: Number(user.role.maxDiscountPct),
        permissions: (ROLE_PERMISSIONS[roleCode] ?? []) as Permission[],
      },
    });
    return { error: "That user name and password were not recognized." };
  }

  await createSession(user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await writeAuditLog({
    action: "LOGIN",
    entity: "User",
    entityId: user.id,
    summary: user.fullName + " signed in as " + user.role.name,
  });

  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  const user = await getCurrentUser();
  if (user) {
    await writeAuditLog({
      action: "LOGOUT",
      entity: "User",
      entityId: user.id,
      summary: user.fullName + " signed out",
      user,
    });
  }
  await destroySession();
  redirect("/login");
}
