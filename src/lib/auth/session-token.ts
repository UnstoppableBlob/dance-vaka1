import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { getAuthConfig } from "@/lib/env";

export const sessionCookieName = "dance_academy_session";
export const sessionDurationMilliseconds = 30 * 24 * 60 * 60 * 1000;

export function hashSessionToken(token: string) {
  const { SESSION_SECRET } = getAuthConfig();
  return createHmac("sha256", SESSION_SECRET).update(token).digest("hex");
}

export function createSessionMaterial() {
  const token = randomBytes(32).toString("base64url");

  return {
    token,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + sessionDurationMilliseconds),
  };
}
