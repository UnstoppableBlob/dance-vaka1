import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  cleanupExpiredRateLimits,
  consumeRateLimit,
  hashRateLimitKey,
} from "@/lib/security/rate-limit";

const keys: string[] = [];

function newIdentity(scope: string) {
  const identifier = `vitest-rate-${scope}-${Date.now()}-${keys.length}`;
  keys.push(hashRateLimitKey(scope, identifier));
  return identifier;
}

describe.sequential("persistent rate limiting", () => {
  afterAll(async () => {
    await db.rateLimitBucket.deleteMany({ where: { keyHash: { in: keys } } });
    await db.$disconnect();
  });

  it("allows only the configured number of requests in a window", async () => {
    const scope = "window";
    const identifier = newIdentity(scope);
    const policy = { limit: 2, windowMs: 60_000 };
    const now = new Date("2027-01-01T00:00:00.000Z");

    await expect(
      consumeRateLimit(scope, identifier, policy, now),
    ).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
    await expect(
      consumeRateLimit(scope, identifier, policy, now),
    ).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    });
    await expect(
      consumeRateLimit(scope, identifier, policy, now),
    ).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
    });
    await expect(
      consumeRateLimit(
        scope,
        identifier,
        policy,
        new Date(now.getTime() + 60_001),
      ),
    ).resolves.toMatchObject({ allowed: true, remaining: 1 });
  });

  it("serializes concurrent attempts so the limit cannot be raced", async () => {
    const scope = "concurrent";
    const identifier = newIdentity(scope);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        consumeRateLimit(scope, identifier, { limit: 3, windowMs: 60_000 }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    expect(results.filter((result) => !result.allowed)).toHaveLength(5);
  });

  it("stores only HMAC keys and removes expired buckets", async () => {
    const scope = "privacy";
    const identifier = newIdentity(scope);
    const now = new Date("2027-01-01T00:00:00.000Z");
    await consumeRateLimit(
      scope,
      identifier,
      { limit: 1, windowMs: 1000 },
      now,
    );
    const stored = await db.rateLimitBucket.findUniqueOrThrow({
      where: { keyHash: hashRateLimitKey(scope, identifier) },
    });
    expect(stored.keyHash).not.toContain(identifier);
    expect(
      await cleanupExpiredRateLimits(new Date(now.getTime() + 1001)),
    ).toBeGreaterThanOrEqual(1);
  });
});
