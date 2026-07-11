import "server-only";

import { db } from "@/lib/db";
import { hashSessionToken } from "@/lib/auth/session-token";
import type { SafeUser } from "@/lib/auth/types";

export async function getSessionUser(token?: string): Promise<SafeUser | null> {
  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const session = await db.session.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          username: true,
          role: true,
          disabledAt: true,
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt <= new Date() || session.user.disabledAt) {
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  return {
    id: session.user.id,
    username: session.user.username,
    role: session.user.role,
  };
}

export async function invalidateSession(token?: string) {
  if (!token) {
    return;
  }

  await db.session.deleteMany({
    where: { tokenHash: hashSessionToken(token) },
  });
}

export async function cleanupExpiredSessions(now = new Date()) {
  const result = await db.session.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  return result.count;
}
