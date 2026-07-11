"use client";

import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  GradeEditor,
  type GradeAction,
  type GradeAnalysisDraft,
} from "@/components/grading/grade-editor";
import { VideoCaptionNotice } from "@/components/media/video-caption-notice";
import type { TeacherGradeView } from "@/lib/grades/types";
import { buildPoseAnalysis } from "@/lib/pose-comparison/analysis";
import {
  POSE_COMPARE_LANDMARKS,
  SKELETON_CONNECTIONS,
} from "@/lib/pose-comparison/constants";
import { buildPoseFeedback } from "@/lib/pose-comparison/feedback";
import { comparePoseLandmarks } from "@/lib/pose-comparison/form";
import {
  cloneLandmarks,
  getPoseQuality,
  isVisible,
} from "@/lib/pose-comparison/landmarks";
import { clamp } from "@/lib/pose-comparison/math";
import {
  createAlignedSampleTimes,
  formatAnalysisTime,
  getTimelineColor,
} from "@/lib/pose-comparison/sampling";
import type {
  PoseAnalysis,
  PoseAnalysisSample,
  PoseLandmarks,
} from "@/lib/pose-comparison/types";

const MEDIAPIPE_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
const USE_E2E_POSE_FIXTURE =
  process.env.NEXT_PUBLIC_E2E_POSE_FIXTURE === "true";

type VideoSource = {
  url: string;
  contentType: string;
};

type AnalyzedFrame = {
  landmarks: PoseLandmarks | null;
  quality: number;
};

type GradingSample = PoseAnalysisSample & {
  index: number;
  progress: number;
  masterTime: number;
  studentTime: number;
  master: AnalyzedFrame;
  student: AnalyzedFrame;
};

type GradingAnalysis = PoseAnalysis<GradingSample> & { analyzedAt: string };

function createE2EPoseFixture(
  progress: number,
  student: boolean,
): PoseLandmarks {
  const phase = progress * Math.PI * 2;
  const studentOffset = student ? 0.015 : 0;

  return Array.from({ length: 33 }, (_, index) => ({
    x:
      0.5 +
      ((index % 5) - 2) * 0.055 +
      Math.sin(phase + index * 0.17) * 0.018 +
      studentOffset,
    y:
      0.12 +
      Math.floor(index / 5) * 0.105 +
      Math.cos(phase + index * 0.11) * 0.014,
    z: 0,
    visibility: 0.99,
  }));
}

type VideoPanelProps = {
  title: string;
  source: VideoSource;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onReady: (duration: number) => void;
  onError: () => void;
};

function VideoPanel({
  title,
  source,
  videoRef,
  canvasRef,
  onReady,
  onError,
}: VideoPanelProps) {
  useEffect(() => {
    const video = videoRef.current;
    if (
      video &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      Number.isFinite(video.duration) &&
      video.duration > 0
    ) {
      onReady(video.duration);
    } else {
      video?.load();
    }
  }, [onReady, source.url, videoRef]);

  return (
    <section>
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <div className="relative mt-3 aspect-video overflow-hidden rounded-md bg-slate-950">
        <video
          ref={videoRef}
          controls
          playsInline
          preload="auto"
          crossOrigin="anonymous"
          onCanPlay={(event) => onReady(event.currentTarget.duration)}
          onError={onError}
          aria-label={`${title} video`}
          className="h-full w-full object-contain"
        >
          <source src={source.url} type={source.contentType} />
          <track
            default
            kind="captions"
            src="data:text/vtt,WEBVTT"
            srcLang="en"
            label="No spoken captions"
          />
        </video>
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
      </div>
      <VideoCaptionNotice />
    </section>
  );
}

function ScoreCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-950">
        {value == null ? "—" : Math.round(value)}
      </p>
    </div>
  );
}

async function createPoseLandmarker() {
  const { FilesetResolver, PoseLandmarker: PoseLandmarkerClass } =
    await import("@mediapipe/tasks-vision");
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
  const create = (delegate: "GPU" | "CPU") =>
    PoseLandmarkerClass.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.45,
      minPosePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
    });

  try {
    return await create("GPU");
  } catch {
    return create("CPU");
  }
}

function seekVideo(
  video: HTMLVideoElement,
  timeSeconds: number,
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      reject(
        new Error("A video could not be read. Reload the page and try again."),
      );
      return;
    }
    if (signal.aborted) {
      reject(new DOMException("Analysis canceled.", "AbortError"));
      return;
    }

    const safeTime = clamp(timeSeconds, 0, Math.max(0, video.duration - 0.02));
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
      signal.removeEventListener("abort", handleAbort);
      if (timeoutId) clearTimeout(timeoutId);
    };
    const finish = () => {
      cleanup();
      requestAnimationFrame(() => resolve());
    };
    const handleSeeked = () => finish();
    const handleError = () => {
      cleanup();
      reject(new Error("A private video could not be decoded."));
    };
    const handleAbort = () => {
      cleanup();
      reject(new DOMException("Analysis canceled.", "AbortError"));
    };

    if (
      Math.abs(video.currentTime - safeTime) < 0.015 &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      finish();
      return;
    }

    video.addEventListener("seeked", handleSeeked, { once: true });
    video.addEventListener("error", handleError, { once: true });
    signal.addEventListener("abort", handleAbort, { once: true });
    timeoutId = setTimeout(() => {
      cleanup();
      reject(
        new Error("Video seeking timed out. Reload the page and try again."),
      );
    }, 10_000);
    video.currentTime = safeTime;
  });
}

function drawSkeletonOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  landmarks: PoseLandmarks | null,
  color: string,
) {
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio));
  canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio));
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks || video.videoWidth <= 0 || video.videoHeight <= 0) return;

  const canvasRatio = canvas.width / canvas.height;
  const videoRatio = video.videoWidth / video.videoHeight;
  const drawWidth =
    videoRatio > canvasRatio ? canvas.width : canvas.height * videoRatio;
  const drawHeight =
    videoRatio > canvasRatio ? canvas.width / videoRatio : canvas.height;
  const offsetX = (canvas.width - drawWidth) / 2;
  const offsetY = (canvas.height - drawHeight) / 2;
  const toCanvasPoint = (index: number) => {
    const point = landmarks[index];
    return point
      ? { x: offsetX + point.x * drawWidth, y: offsetY + point.y * drawHeight }
      : null;
  };

  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 3 * pixelRatio;
  context.lineCap = "round";
  for (const [from, to] of SKELETON_CONNECTIONS) {
    const first = landmarks[from];
    const second = landmarks[to];
    if (!isVisible(first, 0.25) || !isVisible(second, 0.25)) continue;
    const start = toCanvasPoint(from);
    const end = toCanvasPoint(to);
    if (!start || !end) continue;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }
  for (const index of POSE_COMPARE_LANDMARKS) {
    const point = landmarks[index];
    const canvasPoint = toCanvasPoint(index);
    if (!isVisible(point, 0.25) || !canvasPoint) continue;
    context.beginPath();
    context.arc(
      canvasPoint.x,
      canvasPoint.y,
      (index === 0 ? 5 : 4) * pixelRatio,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}

function clearOverlay(canvas: HTMLCanvasElement | null) {
  const context = canvas?.getContext("2d");
  if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
}

function readableError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return null;
  if (error instanceof Error && error.message) return error.message;
  return "Analysis failed. Check both videos and try again.";
}

export function PoseAnalysis({
  reference,
  submission,
  initialGrade,
  gradeAction,
}: {
  reference: VideoSource;
  submission: VideoSource;
  initialGrade: TeacherGradeView | null;
  gradeAction: GradeAction;
}) {
  const masterVideoRef = useRef<HTMLVideoElement>(null);
  const studentVideoRef = useRef<HTMLVideoElement>(null);
  const masterCanvasRef = useRef<HTMLCanvasElement>(null);
  const studentCanvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const reviewAbortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const videoReadyRef = useRef({ master: false, student: false });
  const [masterReady, setMasterReady] = useState(false);
  const [studentReady, setStudentReady] = useState(false);
  const [durations, setDurations] = useState({ master: 0, student: 0 });
  const [masterVideoError, setMasterVideoError] = useState<string | null>(null);
  const [studentVideoError, setStudentVideoError] = useState<string | null>(
    null,
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [status, setStatus] = useState("Loading private videos…");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<GradingAnalysis | null>(null);
  const [selectedFrame, setSelectedFrame] = useState(0);

  const handleMasterReady = useCallback((duration: number) => {
    videoReadyRef.current.master = true;
    setMasterReady(true);
    setMasterVideoError(null);
    setDurations((current) => ({ ...current, master: duration }));
    if (videoReadyRef.current.student) {
      setStatus("Private videos loaded. Ready to analyze.");
    }
  }, []);
  const handleStudentReady = useCallback((duration: number) => {
    videoReadyRef.current.student = true;
    setStudentReady(true);
    setStudentVideoError(null);
    setDurations((current) => ({ ...current, student: duration }));
    if (videoReadyRef.current.master) {
      setStatus("Private videos loaded. Ready to analyze.");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      analysisAbortRef.current?.abort();
      reviewAbortRef.current?.abort();
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  const ensureLandmarker = useCallback(async () => {
    if (landmarkerRef.current) return landmarkerRef.current;
    setStatus("Loading the pose model…");
    const landmarker = await createPoseLandmarker();
    if (!mountedRef.current) {
      landmarker.close();
      throw new DOMException("Analysis canceled.", "AbortError");
    }
    landmarkerRef.current = landmarker;
    return landmarker;
  }, []);

  const runAnalysis = useCallback(async () => {
    if (runningRef.current) return;
    const masterVideo = masterVideoRef.current;
    const studentVideo = studentVideoRef.current;
    if (!masterVideo || !studentVideo || !masterReady || !studentReady) {
      setError("Wait for both private videos to finish loading.");
      return;
    }

    runningRef.current = true;
    reviewAbortRef.current?.abort();
    masterVideo.pause();
    studentVideo.pause();
    clearOverlay(masterCanvasRef.current);
    clearOverlay(studentCanvasRef.current);
    setIsAnalyzing(true);
    setError(null);
    setAnalysis(null);
    setSelectedFrame(0);
    const controller = new AbortController();
    analysisAbortRef.current = controller;

    try {
      const landmarker = USE_E2E_POSE_FIXTURE ? null : await ensureLandmarker();
      const schedule = createAlignedSampleTimes({
        masterDuration: masterVideo.duration,
        studentDuration: studentVideo.duration,
      });
      setProgress({ completed: 0, total: schedule.length });
      setStatus("Analyzing pose samples locally in this browser…");
      let detectorTimestamp = 0;
      const samples: GradingSample[] = [];

      for (const sampleTime of schedule) {
        if (controller.signal.aborted) {
          throw new DOMException("Analysis canceled.", "AbortError");
        }
        await seekVideo(masterVideo, sampleTime.masterTime, controller.signal);
        detectorTimestamp += 34;
        const masterResult = landmarker?.detectForVideo(
          masterVideo,
          detectorTimestamp,
        );
        const masterLandmarks = USE_E2E_POSE_FIXTURE
          ? createE2EPoseFixture(sampleTime.progress, false)
          : masterResult?.landmarks[0]
            ? cloneLandmarks(masterResult.landmarks[0])
            : null;

        await seekVideo(
          studentVideo,
          sampleTime.studentTime,
          controller.signal,
        );
        detectorTimestamp += 34;
        const studentResult = landmarker?.detectForVideo(
          studentVideo,
          detectorTimestamp,
        );
        const studentLandmarks = USE_E2E_POSE_FIXTURE
          ? createE2EPoseFixture(sampleTime.progress, true)
          : studentResult?.landmarks[0]
            ? cloneLandmarks(studentResult.landmarks[0])
            : null;
        samples.push({
          ...sampleTime,
          master: {
            landmarks: masterLandmarks,
            quality: masterLandmarks ? getPoseQuality(masterLandmarks) : 0,
          },
          student: {
            landmarks: studentLandmarks,
            quality: studentLandmarks ? getPoseQuality(studentLandmarks) : 0,
          },
          comparison:
            masterLandmarks && studentLandmarks
              ? comparePoseLandmarks(studentLandmarks, masterLandmarks)
              : null,
        });
        if (mountedRef.current) {
          setProgress({ completed: samples.length, total: schedule.length });
        }
      }

      const result = buildPoseAnalysis(
        samples,
        masterVideo.duration,
        studentVideo.duration,
      );
      if (mountedRef.current) {
        setAnalysis({ ...result, analyzedAt: new Date().toISOString() });
        setStatus("Analysis complete.");
      }
    } catch (analysisError) {
      const message = readableError(analysisError);
      if (message && mountedRef.current) {
        setError(message);
        setStatus("Analysis could not be completed.");
      }
    } finally {
      if (analysisAbortRef.current === controller) {
        analysisAbortRef.current = null;
      }
      runningRef.current = false;
      if (mountedRef.current) setIsAnalyzing(false);
    }
  }, [ensureLandmarker, masterReady, studentReady]);

  useEffect(() => {
    const sample = analysis?.samples[selectedFrame];
    const masterVideo = masterVideoRef.current;
    const studentVideo = studentVideoRef.current;
    const masterCanvas = masterCanvasRef.current;
    const studentCanvas = studentCanvasRef.current;
    if (
      !sample ||
      !masterVideo ||
      !studentVideo ||
      !masterCanvas ||
      !studentCanvas
    ) {
      return;
    }

    const controller = new AbortController();
    reviewAbortRef.current?.abort();
    reviewAbortRef.current = controller;
    masterVideo.pause();
    studentVideo.pause();
    Promise.all([
      seekVideo(masterVideo, sample.masterTime, controller.signal),
      seekVideo(studentVideo, sample.studentTime, controller.signal),
    ])
      .then(() => {
        drawSkeletonOverlay(
          masterCanvas,
          masterVideo,
          sample.master.landmarks,
          "#22c55e",
        );
        drawSkeletonOverlay(
          studentCanvas,
          studentVideo,
          sample.student.landmarks,
          "#22d3ee",
        );
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      if (reviewAbortRef.current === controller) reviewAbortRef.current = null;
    };
  }, [analysis, selectedFrame]);

  useEffect(() => {
    const redraw = () => {
      const sample = analysis?.samples[selectedFrame];
      if (
        sample &&
        masterCanvasRef.current &&
        studentCanvasRef.current &&
        masterVideoRef.current &&
        studentVideoRef.current
      ) {
        drawSkeletonOverlay(
          masterCanvasRef.current,
          masterVideoRef.current,
          sample.master.landmarks,
          "#22c55e",
        );
        drawSkeletonOverlay(
          studentCanvasRef.current,
          studentVideoRef.current,
          sample.student.landmarks,
          "#22d3ee",
        );
      }
    };
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, [analysis, selectedFrame]);

  const feedback = analysis
    ? buildPoseFeedback(analysis, durations.master, durations.student)
    : [];
  const selectedSample = analysis?.samples[selectedFrame] ?? null;
  const gradeAnalysis: GradeAnalysisDraft | null =
    analysis?.overall == null
      ? null
      : {
          automatedOverall: Math.round(analysis.overall),
          formScore:
            analysis.formScore == null ? null : Math.round(analysis.formScore),
          activityScore:
            analysis.activityScore == null
              ? null
              : Math.round(analysis.activityScore),
          timingScore:
            analysis.timingScore == null
              ? null
              : Math.round(analysis.timingScore),
          coverageScore: Math.round(analysis.coverageScore),
          analysisDetails: {
            version: 1,
            analyzedAt: analysis.analyzedAt,
            sampleCount: analysis.samples.length,
            matchedFrames: analysis.samples.filter(
              (sample) => sample.comparison !== null,
            ).length,
            mismatchCounts: analysis.mismatchCounts,
          },
        };
  const videoError = masterVideoError || studentVideoError;
  const videosReady = masterReady && studentReady && !videoError;
  const gradeReleased = initialGrade?.status === "RELEASED";
  const progressPercent =
    progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

  return (
    <div className="mt-8">
      <div className="grid gap-6 lg:grid-cols-2">
        <VideoPanel
          title="Teacher reference"
          source={reference}
          videoRef={masterVideoRef}
          canvasRef={masterCanvasRef}
          onReady={handleMasterReady}
          onError={() => {
            videoReadyRef.current.master = false;
            setMasterReady(false);
            setMasterVideoError(
              "The teacher reference could not be loaded. Reload for a fresh private link.",
            );
          }}
        />
        <VideoPanel
          title="Student response"
          source={submission}
          videoRef={studentVideoRef}
          canvasRef={studentCanvasRef}
          onReady={handleStudentReady}
          onError={() => {
            videoReadyRef.current.student = false;
            setStudentReady(false);
            setStudentVideoError(
              "The student response could not be loaded. Reload for a fresh private link.",
            );
          }}
        />
      </div>

      <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-slate-900">Pose comparison</h2>
            <p className="mt-1 text-sm text-slate-500">
              Scores are assistive estimates for teacher review, not automatic
              final grades.
            </p>
          </div>
          {analysis || gradeReleased ? (
            <span className="rounded-md bg-emerald-100 px-3 py-2 text-sm font-medium text-emerald-800">
              {gradeReleased ? "Grade released" : "Analysis complete"}
            </span>
          ) : (
            <button
              type="button"
              className="primary-button"
              disabled={!videosReady || isAnalyzing}
              onClick={runAnalysis}
            >
              {isAnalyzing
                ? "Analysis in progress…"
                : videosReady
                  ? "Analyze videos"
                  : "Buffering videos…"}
            </button>
          )}
        </div>

        {isAnalyzing ? (
          <div
            className="mt-5 flex gap-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4"
            role="status"
            aria-live="polite"
          >
            <svg
              className="mt-0.5 h-6 w-6 shrink-0 animate-spin text-indigo-700 motion-reduce:animate-none"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="opacity-90"
                d="M21 12a9 9 0 0 0-9-9"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-indigo-950">
                {progress.total > 0
                  ? `Analyzing dance frames — ${progressPercent}%`
                  : "Preparing the pose model…"}
              </p>
              <p className="mt-1 text-sm text-indigo-800">{status}</p>
              <progress
                className="mt-3 h-2 w-full accent-indigo-700"
                value={progress.completed}
                max={Math.max(1, progress.total)}
                aria-label="Analysis progress"
              />
              <p className="mt-1 text-xs text-indigo-700">
                {progress.total > 0
                  ? `${progress.completed} of ${progress.total} sampled frames`
                  : "Loading analysis resources"}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-600" aria-live="polite">
            {status}
          </p>
        )}
        {videoError || error ? (
          <p
            className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800"
            role="alert"
          >
            {videoError || error}
          </p>
        ) : null}
      </section>

      {analysis ? (
        <>
          <section className="mt-6" aria-labelledby="score-heading">
            <h2 id="score-heading" className="font-semibold text-slate-900">
              Assistive score estimates
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <ScoreCard label="Overall" value={analysis.overall} />
              <ScoreCard label="Form" value={analysis.formScore} />
              <ScoreCard label="Activity" value={analysis.activityScore} />
              <ScoreCard label="Timing" value={analysis.timingScore} />
              <ScoreCard label="Coverage" value={analysis.coverageScore} />
            </div>
          </section>

          <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Feedback</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              {feedback.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">
              Sampled-frame timeline
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Select a frame to review both detected skeletons.
            </p>
            <div
              className="mt-4 flex flex-wrap gap-1"
              role="group"
              aria-label="Analyzed frames"
            >
              {analysis.samples.map((sample) => (
                <button
                  key={sample.index}
                  type="button"
                  onClick={() => setSelectedFrame(sample.index)}
                  className={`h-6 min-w-2 flex-1 rounded-sm ${getTimelineColor(
                    sample.comparison?.score ?? null,
                  )} ${selectedFrame === sample.index ? "ring-2 ring-indigo-700 ring-offset-1" : ""}`}
                  aria-label={`Frame ${sample.index + 1}: ${
                    sample.comparison
                      ? `${sample.comparison.score} percent form match`
                      : "pose not detected in both videos"
                  }`}
                  aria-pressed={selectedFrame === sample.index}
                />
              ))}
            </div>

            {selectedSample ? (
              <div className="mt-5">
                <label
                  htmlFor="matched-frame"
                  className="text-sm font-medium text-slate-800"
                >
                  Matched-frame review
                </label>
                <input
                  id="matched-frame"
                  type="range"
                  min={0}
                  max={Math.max(0, analysis.samples.length - 1)}
                  value={selectedFrame}
                  onChange={(event) =>
                    setSelectedFrame(Number(event.target.value))
                  }
                  className="mt-2 w-full"
                />
                <p className="mt-2 text-sm text-slate-600">
                  Reference {formatAnalysisTime(selectedSample.masterTime)} ·
                  Student {formatAnalysisTime(selectedSample.studentTime)} ·{" "}
                  {selectedSample.comparison
                    ? `${selectedSample.comparison.score}% form estimate${
                        selectedSample.comparison.mirrored
                          ? " · mirrored match"
                          : ""
                      }`
                    : "pose missing in one or both frames"}
                </p>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      <GradeEditor
        currentAnalysis={gradeAnalysis}
        initialGrade={initialGrade}
        action={gradeAction}
      />
    </div>
  );
}
