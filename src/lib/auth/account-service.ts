import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  dummyPasswordHash,
  hashPassword,
  verifyPassword,
} from "@/lib/auth/password";
import {
  createSessionMaterial,
  hashSessionToken,
} from "@/lib/auth/session-token";
import type { SafeUser } from "@/lib/auth/types";
import {
  loginSchema,
  normalizeUsername,
  registrationSchema,
  type LoginInput,
  type RegistrationInput,
} from "@/lib/auth/validation";

export class DuplicateUsernameError extends Error {
  constructor() {
    super("That username is already in use.");
    this.name = "DuplicateUsernameError";
  }
}

type AuthenticatedAccount = {
  user: SafeUser;
  token: string;
  expiresAt: Date;
};

async function persistSession(
  transaction: Prisma.TransactionClient,
  userId: string,
  previousToken?: string,
) {
  const session = createSessionMaterial();

  if (previousToken) {
    await transaction.session.deleteMany({
      where: { tokenHash: hashSessionToken(previousToken) },
    });
  }

  await transaction.session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  await transaction.session.create({
    data: {
      userId,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
    },
  });

  return session;
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export async function registerAccount(
  input: RegistrationInput,
  previousToken?: string,
): Promise<AuthenticatedAccount> {
  const values = registrationSchema.parse(input);
  const passwordHash = await hashPassword(values.password);

  try {
    return await db.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          username: values.username,
          usernameNormalized: normalizeUsername(values.username),
          passwordHash,
          role: values.role,
        },
        select: { id: true, username: true, role: true },
      });
      const session = await persistSession(transaction, user.id, previousToken);

      return { user, token: session.token, expiresAt: session.expiresAt };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new DuplicateUsernameError();
    }

    throw error;
  }
}

export async function authenticateAccount(
  input: LoginInput,
  previousToken?: string,
): Promise<AuthenticatedAccount | null> {
  const values = loginSchema.parse(input);
  const user = await db.user.findUnique({
    where: { usernameNormalized: normalizeUsername(values.username) },
    select: {
      id: true,
      username: true,
      role: true,
      passwordHash: true,
      disabledAt: true,
    },
  });
  const passwordIsValid = await verifyPassword(
    user?.passwordHash ?? dummyPasswordHash,
    values.password,
  );

  if (!user || !passwordIsValid || user.disabledAt) {
    return null;
  }

  const session = await db.$transaction((transaction) =>
    persistSession(transaction, user.id, previousToken),
  );

  return {
    user: { id: user.id, username: user.username, role: user.role },
    token: session.token,
    expiresAt: session.expiresAt,
  };
}
