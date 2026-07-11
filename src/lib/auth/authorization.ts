import { UserRole } from "@/generated/prisma/enums";
import type { SafeUser } from "@/lib/auth/types";

export function dashboardPathForRole(role: UserRole) {
  return role === UserRole.TEACHER ? "/teacher" : "/student";
}

export type RoleAccessDecision =
  { allowed: true; user: SafeUser } | { allowed: false; redirectTo: string };

export function decideRoleAccess(
  user: SafeUser | null,
  requiredRole: UserRole,
): RoleAccessDecision {
  if (!user) {
    return { allowed: false, redirectTo: "/login" };
  }

  if (user.role !== requiredRole) {
    return { allowed: false, redirectTo: dashboardPathForRole(user.role) };
  }

  return { allowed: true, user };
}
