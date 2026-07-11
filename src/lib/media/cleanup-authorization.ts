import { timingSafeEqual } from "node:crypto";

export function isValidCleanupAuthorization(
  authorization: string | null,
  secret: string,
) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization ?? "");
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}
