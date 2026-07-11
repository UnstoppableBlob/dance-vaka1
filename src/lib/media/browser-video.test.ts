import { describe, expect, it } from "vitest";

import {
  cameraErrorMessage,
  chooseRecordingFormat,
  formatElapsedTime,
  validateBrowserVideo,
} from "@/lib/media/browser-video";
import { MAX_MEDIA_BYTES } from "@/lib/media/media-constraints";

describe("browser video utilities", () => {
  it("chooses the first recording format supported by the browser", () => {
    expect(
      chooseRecordingFormat((type) => type === "video/webm;codecs=vp8,opus"),
    ).toEqual({
      recorderMimeType: "video/webm;codecs=vp8,opus",
      contentType: "video/webm",
      extension: "webm",
    });
    expect(chooseRecordingFormat(() => false)).toBeUndefined();
  });

  it("validates files and infers a missing browser MIME type", () => {
    expect(
      validateBrowserVideo({ name: "dance.MP4", type: "", size: 1024 }),
    ).toEqual({
      valid: true,
      selection: { extension: "mp4", contentType: "video/mp4" },
    });
    expect(
      validateBrowserVideo({
        name: "dance.webm",
        type: "video/webm;codecs=vp8",
        size: 1024,
      }),
    ).toMatchObject({ valid: true });
  });

  it("rejects mismatches, unsupported extensions, empty files, and oversized files", () => {
    for (const input of [
      { name: "dance.mp4", type: "video/webm", size: 10 },
      { name: "dance.avi", type: "video/x-msvideo", size: 10 },
      { name: "dance.webm", type: "video/webm", size: 0 },
      {
        name: "dance.webm",
        type: "video/webm",
        size: MAX_MEDIA_BYTES + 1,
      },
    ]) {
      expect(validateBrowserVideo(input).valid).toBe(false);
    }
  });

  it("formats timers and explains common permission failures", () => {
    expect(formatElapsedTime(0)).toBe("00:00");
    expect(formatElapsedTime(65.9)).toBe("01:05");
    expect(cameraErrorMessage({ name: "NotAllowedError" })).toContain("denied");
    expect(cameraErrorMessage({ name: "NotFoundError" })).toContain(
      "No camera",
    );
  });
});
