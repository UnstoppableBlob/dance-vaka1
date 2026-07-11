import { randomUUID } from "node:crypto";

export type MediaObjectCategory = "references" | "submissions";

const fallbackExtension = "webm";

export function createMediaObjectKey({
  ownerId,
  category,
  extension,
}: {
  ownerId: string;
  category: MediaObjectCategory;
  extension?: string;
}) {
  const safeOwnerId = ownerId.replace(/[^a-zA-Z0-9-]/g, "");
  const safeExtension = (extension ?? fallbackExtension)
    .toLowerCase()
    .replace(/^\./, "")
    .replace(/[^a-z0-9]/g, "");

  if (!safeOwnerId) {
    throw new Error("A valid owner ID is required to create an object key.");
  }

  return `${category}/${safeOwnerId}/${randomUUID()}.${safeExtension || fallbackExtension}`;
}
