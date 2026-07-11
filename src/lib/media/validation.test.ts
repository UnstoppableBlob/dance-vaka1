import { describe, expect, it } from "vitest";

import { MediaAssetKind } from "@/generated/prisma/enums";
import {
  hasValidVideoSignature,
  MAX_MEDIA_BYTES,
  mediaUploadSchema,
} from "@/lib/media/validation";
import { createMediaObjectKey } from "@/lib/storage/object-key";

const validUpload = {
  kind: MediaAssetKind.REFERENCE_VIDEO,
  filename: "lesson.webm",
  contentType: "video/webm",
  byteSize: 1024,
};

describe("media upload validation", () => {
  it("accepts supported matching video types", () => {
    expect(mediaUploadSchema.parse(validUpload)).toEqual(validUpload);
    expect(
      mediaUploadSchema.parse({
        ...validUpload,
        filename: "practice.MP4",
        contentType: "VIDEO/MP4",
      }),
    ).toMatchObject({ filename: "practice.MP4", contentType: "video/mp4" });
  });

  it("rejects extension spoofing, unsupported files, unsafe names, and size violations", () => {
    for (const input of [
      { ...validUpload, filename: "video.mp4" },
      { ...validUpload, filename: "video.exe", contentType: "video/mp4" },
      { ...validUpload, filename: "../video.webm" },
      { ...validUpload, byteSize: 0 },
      { ...validUpload, byteSize: MAX_MEDIA_BYTES + 1 },
    ]) {
      expect(mediaUploadSchema.safeParse(input).success).toBe(false);
    }
  });

  it("recognizes WebM and ISO media signatures instead of trusting MIME metadata", () => {
    expect(
      hasValidVideoSignature(
        "video/webm",
        Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]),
      ),
    ).toBe(true);
    expect(
      hasValidVideoSignature(
        "video/mp4",
        Uint8Array.from([
          0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f,
          0x6d,
        ]),
      ),
    ).toBe(true);
    expect(
      hasValidVideoSignature(
        "video/webm",
        new TextEncoder().encode("<html>not a video"),
      ),
    ).toBe(false);
  });

  it("creates collision-resistant keys without using the original filename", () => {
    const first = createMediaObjectKey({
      ownerId: "5a187fd1-cff4-4859-9518-df3497e8bf2f",
      category: "references",
      extension: "webm",
    });
    const second = createMediaObjectKey({
      ownerId: "5a187fd1-cff4-4859-9518-df3497e8bf2f",
      category: "references",
      extension: "webm",
    });

    expect(first).toMatch(
      /^references\/5a187fd1-cff4-4859-9518-df3497e8bf2f\/[0-9a-f-]{36}\.webm$/,
    );
    expect(second).not.toBe(first);
  });
});
