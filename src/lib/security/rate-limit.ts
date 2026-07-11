import "server-only";

import { createHmac } from "node:crypto";

import { db } from "@/lib/db";
import { getAuthConfig } from "@/lib/env";

export type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function hashRateLimitKey(scope: string, identifier: string) {
  const { SESSION_SECRET } = getAuthConfig();
  return createHmac("sha256", SESSION_SECRET)
    .update(`rate-limit:${scope}:${identifier}`)
    .digest("hex");
}

export async function consumeRateLimit(
  scope: string,
  identifier: string,
  policy: RateLimitPolicy,
  now = new Date(),
): Promise<RateLimitResult> {
  if (
    !Number.isSafeInteger(policy.limit) ||
    policy.limit < 1 ||
    !Number.isSafeInteger(policy.windowMs) ||
    policy.windowMs < 1
  ) {
    throw new Error("Invalid rate-limit policy.");
  }
  const keyHash = hashRateLimitKey(scope, identifier);

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${keyHash}, 0))::text AS "lock"
    `;
    const bucket = await transaction.rateLimitBucket.findUnique({
      where: { keyHash },
    });
    if (!bucket || bucket.expiresAt <= now) {
      const expiresAt = new Date(now.getTime() + policy.windowMs);
      await transaction.rateLimitBucket.upsert({
        where: { keyHash },
        create: { keyHash, count: 1, windowStartedAt: now, expiresAt },
        update: { count: 1, windowStartedAt: now, expiresAt },
      });
      return {
        allowed: true,
        remaining: policy.limit - 1,
        retryAfterSeconds: Math.ceil(policy.windowMs / 1000),
      };
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.expiresAt.getTime() - now.getTime()) / 1000),
    );
    if (bucket.count >= policy.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    const updated = await transaction.rateLimitBucket.update({
      where: { keyHash },
      data: { count: { increment: 1 } },
      select: { count: true },
    });
    return {
      allowed: true,
      remaining: Math.max(0, policy.limit - updated.count),
      retryAfterSeconds,
    };
  });
}

export async function clearRateLimit(scope: string, identifier: string) {
  await db.rateLimitBucket.deleteMany({
    where: { keyHash: hashRateLimitKey(scope, identifier) },
  });
}

export async function cleanupExpiredRateLimits(now = new Date()) {
  const result = await db.rateLimitBucket.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  return result.count;
}
