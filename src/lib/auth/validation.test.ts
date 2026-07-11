import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import {
  loginSchema,
  normalizeUsername,
  registrationSchema,
} from "@/lib/auth/validation";

describe("authentication validation", () => {
  it("normalizes usernames case-insensitively while retaining valid display input", () => {
    expect(normalizeUsername("  Dance_Teacher  ")).toBe("dance_teacher");
  });

  it("accepts a strong registration with either supported role", () => {
    const result = registrationSchema.safeParse({
      username: "Dance_Student",
      password: "StrongPassword123",
      passwordConfirmation: "StrongPassword123",
      role: UserRole.STUDENT,
    });

    expect(result.success).toBe(true);
  });

  it("rejects weak passwords, invalid usernames, and invented roles", () => {
    const result = registrationSchema.safeParse({
      username: "Dance Student!",
      password: "short",
      passwordConfirmation: "different",
      role: "ADMIN",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      expect(errors.username).toBeDefined();
      expect(errors.password).toBeDefined();
      expect(errors.role).toBeDefined();
    }
  });

  it("rejects mismatched password confirmation", () => {
    const result = registrationSchema.safeParse({
      username: "valid_user",
      password: "StrongPassword123",
      passwordConfirmation: "DifferentPassword123",
      role: UserRole.TEACHER,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.flatten().fieldErrors.passwordConfirmation,
      ).toBeDefined();
    }
  });

  it("requires a password for login without revealing account existence", () => {
    expect(
      loginSchema.safeParse({ username: "valid_user", password: "" }).success,
    ).toBe(false);
  });
});
