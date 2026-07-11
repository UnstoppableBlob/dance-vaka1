"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  completeMediaUploadAction,
  requestMediaUploadAction,
} from "@/app/(dashboard)/media/actions";
import { VideoCaptionNotice } from "@/components/media/video-caption-notice";
import type { MediaAssetKind } from "@/generated/prisma/enums";
import {
  cameraErrorMessage,
  chooseRecordingFormat,
  formatElapsedTime,
  validateBrowserVideo,
  type BrowserVideoSelection,
  type RecordingFormat,
} from "@/lib/media/browser-video";
import { MAX_MEDIA_BYTES } from "@/lib/media/media-constraints";
import type { MediaAssetSummary } from "@/lib/media/types";

type RecorderPhase =
  | "idle"
  | "requesting-camera"
  | "camera"
  | "recording"
  | "review"
  | "uploading"
  | "uploaded";

type SelectedVideo = BrowserVideoSelection & {
  blob: Blob;
  filename: string;
  previewUrl: string;
};

export type VideoRecorderProps = {
  kind: MediaAssetKind;
  title?: string;
  disabled?: boolean;
  onUploaded?: (asset: MediaAssetSummary) => void;
  onUploadedDiscarded?: (asset: MediaAssetSummary) => void;
  onBusyChange?: (busy: boolean) => void;
};

function uploadBlobWithProgress({
  url,
  blob,
  contentType,
  signal,
  onProgress,
}: {
  url: string;
  blob: Blob;
  contentType: string;
  signal: AbortSignal;
  onProgress: (percent: number) => void;
}) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    signal.addEventListener("abort", abort, { once: true });
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", contentType);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      signal.removeEventListener("abort", abort);
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(
          new Error(`Storage upload failed with status ${request.status}.`),
        );
      }
    });
    request.addEventListener("error", () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("The storage upload could not be completed."));
    });
    request.addEventListener("abort", () => {
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Upload canceled.", "AbortError"));
    });
    request.send(blob);
  });
}

export function VideoRecorder({
  kind,
  title = "Record a dance video",
  disabled = false,
  onUploaded,
  onUploadedDiscarded,
  onBusyChange,
}: VideoRecorderProps) {
  const headingId = useId();
  const fileInputId = useId();
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef(0);
  const chunksRef = useRef<Blob[]>([]);
  const recordedBytesRef = useRef(0);
  const recordingTooLargeRef = useRef(false);
  const recordingFormatRef = useRef<RecordingFormat | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(
    null,
  );
  const [recordingFormat, setRecordingFormat] =
    useState<RecordingFormat | null>(null);
  const [cameraAvailable, setCameraAvailable] = useState<boolean | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [uploadedAsset, setUploadedAsset] = useState<MediaAssetSummary | null>(
    null,
  );

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (liveVideoRef.current) {
      liveVideoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      uploadAbortRef.current?.abort();
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.ondataavailable = null;
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      stopTimer();
      stopCamera();
      revokePreview();
    };
  }, [revokePreview, stopCamera, stopTimer]);

  const replaceSelectedVideo = useCallback(
    (video: Omit<SelectedVideo, "previewUrl">) => {
      revokePreview();
      const previewUrl = URL.createObjectURL(video.blob);
      previewUrlRef.current = previewUrl;
      setSelectedVideo({ ...video, previewUrl });
      setUploadedAsset(null);
      setUploadFailed(false);
      setUploadProgress(0);
      setMessage(null);
      setPhase("review");
    },
    [revokePreview],
  );

  const startCamera = async () => {
    setMessage(null);
    setPhase("requesting-camera");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setCameraAvailable(false);
      setPhase("idle");
      setMessage(
        "This browser cannot record video here. Choose an existing video instead.",
      );
      return;
    }

    try {
      setCameraAvailable(true);
      setRecordingFormat(
        chooseRecordingFormat((mimeType) =>
          MediaRecorder.isTypeSupported(mimeType),
        ) ?? null,
      );
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: true,
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        await liveVideoRef.current.play();
      }
      setPhase("camera");
    } catch (error) {
      if (!mountedRef.current) return;
      stopCamera();
      setPhase("idle");
      setMessage(cameraErrorMessage(error));
    }
  };

  const finishRecording = useCallback(() => {
    stopTimer();
    stopCamera();
    recorderRef.current = null;

    if (recordingTooLargeRef.current) {
      chunksRef.current = [];
      setMessage("The recording exceeded the 250 MB upload limit.");
      setPhase("idle");
      return;
    }

    const format = recordingFormatRef.current;
    const blob = format
      ? new Blob(chunksRef.current, { type: format.contentType })
      : null;
    chunksRef.current = [];
    if (!format || !blob || blob.size === 0) {
      setMessage("No video data was recorded. Please try again.");
      setPhase("idle");
      return;
    }

    replaceSelectedVideo({
      blob,
      filename: `dance-recording-${Date.now()}.${format.extension}`,
      contentType: format.contentType,
      extension: format.extension,
    });
  }, [replaceSelectedVideo, stopCamera, stopTimer]);

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream || !recordingFormat) {
      setMessage(
        "This browser does not support a compatible recording format. Choose an existing video instead.",
      );
      return;
    }

    try {
      setMessage(null);
      chunksRef.current = [];
      recordedBytesRef.current = 0;
      recordingTooLargeRef.current = false;
      recordingFormatRef.current = recordingFormat;
      const recorder = new MediaRecorder(stream, {
        mimeType: recordingFormat.recorderMimeType,
      });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        recordedBytesRef.current += event.data.size;
        if (recordedBytesRef.current > MAX_MEDIA_BYTES) {
          recordingTooLargeRef.current = true;
          if (recorder.state === "recording") recorder.stop();
          return;
        }
        chunksRef.current.push(event.data);
      };
      recorder.onstop = finishRecording;
      recorder.onerror = () => {
        setMessage(
          "Recording failed. Please try again or choose a video file.",
        );
      };
      recordingStartedAtRef.current = Date.now();
      setElapsedSeconds(0);
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds(
          Math.floor((Date.now() - recordingStartedAtRef.current) / 1000),
        );
      }, 250);
      recorder.start(1000);
      setPhase("recording");
    } catch {
      setMessage(
        "Recording could not start. Try again or choose an existing video.",
      );
    }
  };

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const warnBeforeLinkNavigation = (event: MouseEvent) => {
      const target = event.target;
      const link = target instanceof Element ? target.closest("a[href]") : null;
      if (!link) return;
      if (
        !window.confirm("Leave this page and discard the current recording?")
      ) {
        event.preventDefault();
        event.stopPropagation();
      } else {
        stopRecording();
      }
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", warnBeforeLinkNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", warnBeforeLinkNavigation, true);
    };
  }, [phase, stopRecording]);

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    const result = validateBrowserVideo(file);
    if (!result.valid) {
      setMessage(result.message);
      return;
    }
    stopCamera();
    replaceSelectedVideo({
      blob: file,
      filename: file.name,
      contentType: result.selection.contentType,
      extension: result.selection.extension,
    });
  };

  const discard = () => {
    if (uploadedAsset) onUploadedDiscarded?.(uploadedAsset);
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    stopTimer();
    stopCamera();
    revokePreview();
    setSelectedVideo(null);
    setUploadedAsset(null);
    setUploadFailed(false);
    setUploadProgress(0);
    setElapsedSeconds(0);
    setMessage(null);
    setPhase("idle");
  };

  const upload = async () => {
    if (!selectedVideo) return;
    const controller = new AbortController();
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = controller;
    setPhase("uploading");
    setUploadProgress(0);
    setMessage(null);
    setUploadFailed(false);

    try {
      const authorization = await requestMediaUploadAction({
        kind,
        filename: selectedVideo.filename,
        contentType: selectedVideo.contentType,
        byteSize: selectedVideo.blob.size,
      });
      await uploadBlobWithProgress({
        url: authorization.uploadUrl,
        blob: selectedVideo.blob,
        contentType: authorization.headers["Content-Type"],
        signal: controller.signal,
        onProgress: setUploadProgress,
      });
      const asset = await completeMediaUploadAction(authorization.asset.id);
      setUploadedAsset(asset);
      setPhase("uploaded");
      onUploaded?.(asset);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPhase("review");
      setUploadFailed(true);
      setMessage(
        "The video could not be uploaded. Check your connection and try again.",
      );
    } finally {
      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null;
      }
    }
  };

  const isBusy =
    phase === "requesting-camera" ||
    phase === "recording" ||
    phase === "uploading";

  useEffect(() => {
    onBusyChange?.(isBusy);
  }, [isBusy, onBusyChange]);

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5"
    >
      <h2 id={headingId} className="text-lg font-semibold text-slate-950">
        {title}
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Record with your camera and microphone, or choose an MP4, WebM, MOV, or
        M4V file up to 250 MB.
      </p>

      <div className="mt-5 overflow-hidden rounded-md bg-slate-950">
        {phase === "review" || phase === "uploading" || phase === "uploaded" ? (
          <video
            controls
            playsInline
            src={selectedVideo?.previewUrl}
            aria-label="Recorded video review"
            className="aspect-video w-full object-contain"
          >
            <track
              default
              kind="captions"
              src="data:text/vtt,WEBVTT"
              srcLang="en"
              label="No spoken captions"
            />
          </video>
        ) : (
          <video
            ref={liveVideoRef}
            autoPlay
            muted
            playsInline
            aria-label="Live camera preview"
            className="aspect-video w-full object-contain"
          />
        )}
      </div>
      <VideoCaptionNotice />

      {phase === "recording" ? (
        <div className="mt-4 flex items-center justify-between gap-4">
          <p
            className="font-mono text-lg font-semibold text-red-700"
            aria-live="off"
          >
            ● {formatElapsedTime(elapsedSeconds)}
          </p>
          <button
            type="button"
            className="primary-button"
            onClick={stopRecording}
          >
            Stop recording
          </button>
        </div>
      ) : null}

      {phase === "uploading" ? (
        <div className="mt-4" aria-live="polite">
          <div className="flex justify-between text-sm text-slate-600">
            <span>
              {uploadProgress < 100 ? "Uploading" : "Verifying upload"}
            </span>
            <span>{uploadProgress}%</span>
          </div>
          <progress
            className="mt-2 h-2 w-full accent-indigo-700"
            max={100}
            value={uploadProgress}
          >
            {uploadProgress}%
          </progress>
        </div>
      ) : null}

      {uploadedAsset ? (
        <p className="mt-4 text-sm font-medium text-green-700" role="status">
          Upload ready. Media ID: {uploadedAsset.id}
        </p>
      ) : null}

      {message ? (
        <p className="mt-4 text-sm text-red-700" role="alert">
          {message}
        </p>
      ) : null}

      {cameraAvailable === false ? (
        <p className="mt-4 text-sm text-amber-800">
          Camera recording is unavailable in this browser. File upload still
          works.
        </p>
      ) : null}

      {phase === "camera" && !recordingFormat ? (
        <p className="mt-4 text-sm text-amber-800">
          This browser cannot create a supported recording format. Choose an
          existing video instead.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-3">
        {phase === "idle" ? (
          <button
            type="button"
            className="primary-button"
            onClick={startCamera}
            disabled={disabled}
          >
            Enable camera
          </button>
        ) : null}
        {phase === "requesting-camera" ? (
          <button type="button" className="primary-button" disabled>
            Requesting permission…
          </button>
        ) : null}
        {phase === "camera" ? (
          <>
            <button
              type="button"
              className="primary-button"
              onClick={startRecording}
              disabled={!recordingFormat}
            >
              Start recording
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={discard}
            >
              Cancel camera
            </button>
          </>
        ) : null}
        {phase === "review" ? (
          <>
            <button
              type="button"
              className="primary-button"
              onClick={upload}
              disabled={disabled}
            >
              {uploadFailed ? "Retry upload" : "Upload video"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={discard}
            >
              Discard
            </button>
          </>
        ) : null}
        {phase === "uploaded" ? (
          <button type="button" className="secondary-button" onClick={discard}>
            Record another
          </button>
        ) : null}
        {phase !== "recording" && phase !== "camera" ? (
          <label
            htmlFor={fileInputId}
            role="button"
            tabIndex={isBusy || disabled ? -1 : 0}
            aria-disabled={isBusy || disabled}
            onKeyDown={(event) => {
              if (
                !isBusy &&
                !disabled &&
                (event.key === "Enter" || event.key === " ")
              ) {
                event.preventDefault();
                document.getElementById(fileInputId)?.click();
              }
            }}
            className={`secondary-button ${isBusy || disabled ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
          >
            Choose existing video
          </label>
        ) : null}
        <input
          id={fileInputId}
          className="sr-only"
          tabIndex={-1}
          type="file"
          accept=".mp4,.webm,.mov,.m4v,video/mp4,video/webm,video/quicktime,video/x-m4v"
          disabled={isBusy || disabled}
          onChange={(event) => {
            chooseFile(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </div>
    </section>
  );
}
