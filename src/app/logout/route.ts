import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, destroySession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";

/**
 * Sign-out as a GET route so the File menu can link to it directly.
 * Safe because the session cookie is SameSite=Lax: a cross-site image or
 * link cannot trigger it with the cookie attached in a way that matters,
 * and the worst case is a user being signed out.
 */
export async function GET(request: NextRequest) {
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
  return NextResponse.redirect(new URL("/login", request.url));
}
