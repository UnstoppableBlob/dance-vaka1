import "server-only";

import { cookies } from "next/headers";

import { sessionCookieName } from "@/lib/auth/session-token";

export async function getSessionCookieToken() {
  return (await cookies()).get(sessionCookieName)?.value;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(sessionCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    priority: "high",
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(sessionCookieName);
}
