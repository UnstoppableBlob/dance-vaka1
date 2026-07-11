import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import {
  dashboardPathForRole,
  decideRoleAccess,
} from "@/lib/auth/authorization";

const teacher = {
  id: "11111111-1111-1111-1111-111111111111",
  username: "teacher",
  role: UserRole.TEACHER,
};
const student = {
  id: "22222222-2222-2222-2222-222222222222",
  username: "student",
  role: UserRole.STUDENT,
};

describe("role authorization", () => {
  it("sends unauthenticated users to login", () => {
    expect(decideRoleAccess(null, UserRole.TEACHER)).toEqual({
      allowed: false,
      redirectTo: "/login",
    });
  });

  it("allows users into their own role area", () => {
    expect(decideRoleAccess(teacher, UserRole.TEACHER)).toEqual({
      allowed: true,
      user: teacher,
    });
    expect(decideRoleAccess(student, UserRole.STUDENT)).toEqual({
      allowed: true,
      user: student,
    });
  });

  it("redirects cross-role access to the user's real dashboard", () => {
    expect(decideRoleAccess(teacher, UserRole.STUDENT)).toEqual({
      allowed: false,
      redirectTo: "/teacher",
    });
    expect(decideRoleAccess(student, UserRole.TEACHER)).toEqual({
      allowed: false,
      redirectTo: "/student",
    });
  });

  it("maps each immutable role to one dashboard", () => {
    expect(dashboardPathForRole(UserRole.TEACHER)).toBe("/teacher");
    expect(dashboardPathForRole(UserRole.STUDENT)).toBe("/student");
  });
});
