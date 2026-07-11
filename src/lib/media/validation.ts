import { z } from "zod";

import { MediaAssetKind } from "@/generated/prisma/enums";
import {
  contentTypeByExtension,
  MAX_MEDIA_BYTES,
  supportedMediaTypes,
} from "@/lib/media/media-constraints";

export {
  MAX_MEDIA_BYTES,
  supportedMediaTypes,
} from "@/lib/media/media-constraints";

export const mediaAssetIdSchema = z.uuid("Invalid media asset ID.");

export const mediaUploadSchema = z
  .object({
    kind: z.enum(MediaAssetKind),
    filename: z
      .string()
      .trim()
      .min(1, "Choose a video file.")
      .max(255, "Filename must be at most 255 characters.")
      .refine(
        (filename) =>
          !/[\u0000-\u001f\u007f/\\\u202a-\u202e\u2066-\u2069]/.test(filename),
        "Filename contains unsupported characters.",
      ),
    contentType: z
      .string()
      .trim()
      .toLowerCase()
      .refine(
        (contentType) =>
          supportedMediaTypes.includes(
            contentType as (typeof supportedMediaTypes)[number],
          ),
        "Unsupported video type. Use MP4, WebM, MOV, or M4V.",
      ),
    byteSize: z
      .number()
      .int()
      .positive("Video must not be empty.")
      .max(MAX_MEDIA_BYTES, "Video must be 250 MB or smaller."),
  })
  .superRefine((input, context) => {
    const extension = input.filename.split(".").pop()?.toLowerCase();
    const expectedType = extension
      ? contentTypeByExtension[extension as keyof typeof contentTypeByExtension]
      : undefined;

    if (!expectedType || expectedType !== input.contentType) {
      context.addIssue({
        code: "custom",
        path: ["filename"],
        message: "The filename extension does not match the video type.",
      });
    }
  });

export type MediaUploadInput = z.input<typeof mediaUploadSchema>;

export function getValidatedMediaExtension(filename: string) {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (!extension || !(extension in contentTypeByExtension)) {
    throw new Error("A validated media filename is required.");
  }
  return extension;
}

export function hasValidVideoSignature(
  contentType: string,
  prefix: Uint8Array,
) {
  if (contentType === "video/webm") {
    return (
      prefix.length >= 4 &&
      prefix[0] === 0x1a &&
      prefix[1] === 0x45 &&
      prefix[2] === 0xdf &&
      prefix[3] === 0xa3
    );
  }
  if (
    contentType === "video/mp4" ||
    contentType === "video/quicktime" ||
    contentType === "video/x-m4v"
  ) {
    return (
      prefix.length >= 12 &&
      prefix[4] === 0x66 &&
      prefix[5] === 0x74 &&
      prefix[6] === 0x79 &&
      prefix[7] === 0x70
    );
  }
  return false;
}
