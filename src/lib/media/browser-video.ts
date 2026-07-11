import {
  contentTypeByExtension,
  MAX_MEDIA_BYTES,
  type SupportedMediaExtension,
  type SupportedMediaType,
} from "@/lib/media/media-constraints";

export type BrowserVideoSelection = {
  extension: SupportedMediaExtension;
  contentType: SupportedMediaType;
};

export type RecordingFormat = BrowserVideoSelection & {
  recorderMimeType: string;
};

const recordingCandidates: RecordingFormat[] = [
  {
    recorderMimeType: "video/webm;codecs=vp9,opus",
    contentType: "video/webm",
    extension: "webm",
  },
  {
    recorderMimeType: "video/webm;codecs=vp8,opus",
    contentType: "video/webm",
    extension: "webm",
  },
  {
    recorderMimeType: "video/webm",
    contentType: "video/webm",
    extension: "webm",
  },
  {
    recorderMimeType: "video/mp4",
    contentType: "video/mp4",
    extension: "mp4",
  },
];

export function chooseRecordingFormat(
  isTypeSupported: (mimeType: string) => boolean,
) {
  return recordingCandidates.find((candidate) =>
    isTypeSupported(candidate.recorderMimeType),
  );
}

export function validateBrowserVideo(input: {
  name: string;
  type: string;
  size: number;
}):
  | { valid: true; selection: BrowserVideoSelection }
  | { valid: false; message: string } {
  if (input.size <= 0) {
    return { valid: false, message: "The selected video is empty." };
  }
  if (input.size > MAX_MEDIA_BYTES) {
    return { valid: false, message: "Video must be 250 MB or smaller." };
  }

  const extension = input.name.split(".").pop()?.toLowerCase();
  if (!extension || !(extension in contentTypeByExtension)) {
    return {
      valid: false,
      message: "Use an MP4, WebM, MOV, or M4V video.",
    };
  }

  const supportedExtension = extension as SupportedMediaExtension;
  const expectedType = contentTypeByExtension[supportedExtension];
  const suppliedType = input.type.split(";", 1)[0].trim().toLowerCase();
  if (suppliedType && suppliedType !== expectedType) {
    return {
      valid: false,
      message: "The filename extension does not match the video type.",
    };
  }

  return {
    valid: true,
    selection: { extension: supportedExtension, contentType: expectedType },
  };
}

export function formatElapsedTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function cameraErrorMessage(error: unknown) {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera or microphone access was denied. Allow access in your browser settings, or choose an existing video.";
    case "NotFoundError":
      return "No camera or microphone was found. Connect a device, or choose an existing video.";
    case "NotReadableError":
      return "The camera or microphone is busy in another app. Close it there and try again.";
    default:
      return "The camera could not be started. You can still choose an existing video.";
  }
}
