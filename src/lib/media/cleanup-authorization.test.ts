import { describe, expect, it } from "vitest";

import { isValidCleanupAuthorization } from "@/lib/media/cleanup-authorization";

describe("media cleanup authorization", () => {
  const secret = "test-cleanup-secret-that-is-long-enough";

  it("accepts only the exact bearer secret", () => {
    expect(isValidCleanupAuthorization(`Bearer ${secret}`, secret)).toBe(true);
    expect(isValidCleanupAuthorization(secret, secret)).toBe(false);
    expect(isValidCleanupAuthorization("Bearer wrong", secret)).toBe(false);
    expect(isValidCleanupAuthorization(null, secret)).toBe(false);
  });
});
