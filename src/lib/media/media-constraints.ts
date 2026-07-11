export const MAX_MEDIA_BYTES = 250 * 1024 * 1024;

export const contentTypeByExtension = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
} as const;

export type SupportedMediaExtension = keyof typeof contentTypeByExtension;
export type SupportedMediaType =
  (typeof contentTypeByExtension)[SupportedMediaExtension];

export const supportedMediaTypes = Object.values(contentTypeByExtension);
