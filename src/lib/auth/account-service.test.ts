import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  UserRole,
  type UserRole as UserRoleValue,
} from "@/generated/prisma/enums";
import {
  authenticateAccount,
  DuplicateUsernameError,
  registerAccount,
} from "@/lib/auth/account-service";
import { verifyPassword } from "@/lib/auth/password";
import {
  cleanupExpiredSessions,
  getSessionUser,
  invalidateSession,
} from "@/lib/auth/session-store";
import { hashSessionToken } from "@/lib/auth/session-token";
import { db } from "@/lib/db";

const password = "IntegrationPassword123";
const createdUserIds: string[] = [];
let sequence = 0;

function uniqueUsername(prefix: string) {
  sequence += 1;
  return `vitest_${prefix}_${Date.now().toString(36)}_${sequence}`.slice(0, 30);
}

async function createAccount(
  role: UserRoleValue = UserRole.STUDENT,
  prefix = "user",
) {
  const account = await registerAccount({
    username: uniqueUsername(prefix),
    password,
    passwordConfirmation: password,
    role,
  });
  createdUserIds.push(account.user.id);
  return account;
}

describe.sequential("database-backed authentication", () => {
  beforeAll(async () => {
    await db.session.deleteMany({
      where: { user: { usernameNormalized: { startsWith: "vitest_" } } },
    });
    await db.user.deleteMany({
      where: { usernameNormalized: { startsWith: "vitest_" } },
    });
  });

  afterAll(async () => {
    await db.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await db.$disconnect();
  });

  it("registers a user with a hash and a server-verifiable session", async () => {
    const account = await createAccount(UserRole.TEACHER, "register");
    const storedUser = await db.user.findUniqueOrThrow({
      where: { id: account.user.id },
      select: { username: true, passwordHash: true, role: true },
    });
    const storedSession = await db.session.findUniqueOrThrow({
      where: { tokenHash: hashSessionToken(account.token) },
    });

    expect(storedUser.passwordHash).not.toBe(password);
    expect(await verifyPassword(storedUser.passwordHash, password)).toBe(true);
    expect(storedUser.role).toBe(UserRole.TEACHER);
    expect(storedSession.tokenHash).not.toBe(account.token);
    expect(await getSessionUser(account.token)).toEqual(account.user);
    expect(account.user).not.toHaveProperty("passwordHash");
  });

  it("prevents duplicate usernames even when casing differs", async () => {
    const username = uniqueUsername("duplicate");
    const first = await registerAccount({
      username,
      password,
      passwordConfirmation: password,
      role: UserRole.STUDENT,
    });
    createdUserIds.push(first.user.id);

    await expect(
      registerAccount({
        username: username.toUpperCase(),
        password,
        passwordConfirmation: password,
        role: UserRole.TEACHER,
      }),
    ).rejects.toBeInstanceOf(DuplicateUsernameError);
  });

  it("logs in case-insensitively and rotates the current session", async () => {
    const registered = await createAccount(UserRole.STUDENT, "login");
    const authenticated = await authenticateAccount(
      {
        username: registered.user.username.toUpperCase(),
        password,
      },
      registered.token,
    );

    expect(authenticated?.user).toEqual(registered.user);
    expect(authenticated?.token).not.toBe(registered.token);
    expect(await getSessionUser(registered.token)).toBeNull();
    expect(await getSessionUser(authenticated?.token)).toEqual(registered.user);
  });

  it("returns the same null result for an unknown username and a bad password", async () => {
    const registered = await createAccount(UserRole.STUDENT, "invalid");

    await expect(
      authenticateAccount({
        username: "vitest_missing_account",
        password,
      }),
    ).resolves.toBeNull();
    await expect(
      authenticateAccount({
        username: registered.user.username,
        password: "WrongPassword123",
      }),
    ).resolves.toBeNull();
  });

  it("invalidates a database session on sign-out", async () => {
    const account = await createAccount(UserRole.STUDENT, "logout");

    expect(await getSessionUser(account.token)).toEqual(account.user);
    await invalidateSession(account.token);
    expect(await getSessionUser(account.token)).toBeNull();
  });

  it("cleans expired sessions without removing active sessions", async () => {
    const account = await createAccount(UserRole.STUDENT, "cleanup");
    await db.session.create({
      data: {
        userId: account.user.id,
        tokenHash: "f".repeat(64),
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    expect(await cleanupExpiredSessions(new Date())).toBeGreaterThanOrEqual(1);
    expect(await getSessionUser(account.token)).toEqual(account.user);
  });
});
