import "server-only";

import { headers } from "next/headers";

const safeAddressPattern = /^[0-9a-f:.]{1,64}$/i;

export async function getClientAddress() {
  const requestHeaders = await headers();
  const candidates = [
    requestHeaders.get("x-real-ip"),
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim(),
  ];
  return (
    candidates.find((candidate): candidate is string =>
      Boolean(candidate && safeAddressPattern.test(candidate)),
    ) ?? "unknown"
  );
}
