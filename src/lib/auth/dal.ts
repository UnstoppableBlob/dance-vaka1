import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import type { UserRole } from "@/generated/prisma/enums";
import { decideRoleAccess } from "@/lib/auth/authorization";
import { getSessionCookieToken } from "@/lib/auth/cookies";
import { getSessionUser } from "@/lib/auth/session-store";

export const getCurrentUser = cache(async () => {
  const token = await getSessionCookieToken();
  return getSessionUser(token);
});

export async function requireRole(requiredRole: UserRole) {
  const decision = decideRoleAccess(await getCurrentUser(), requiredRole);

  if (!decision.allowed) {
    redirect(decision.redirectTo);
  }

  return decision.user;
}
