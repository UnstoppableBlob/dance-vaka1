import { clamp } from "@/lib/pose-comparison/math";

export type AlignedSampleTime = {
  index: number;
  progress: number;
  masterTime: number;
  studentTime: number;
};

export function createAlignedSampleTimes({
  masterDuration,
  studentDuration,
  sampleFps = 4,
  maxFrames = 72,
}: {
  masterDuration: number;
  studentDuration: number;
  sampleFps?: number;
  maxFrames?: number;
}): AlignedSampleTime[] {
  if (
    !Number.isFinite(masterDuration) ||
    !Number.isFinite(studentDuration) ||
    masterDuration <= 0 ||
    studentDuration <= 0
  ) {
    throw new Error("Both videos must have a valid duration before analysis.");
  }

  const safeFps = clamp(Number.isFinite(sampleFps) ? sampleFps : 4, 1, 10);
  const safeMaximum = Math.round(
    clamp(Number.isFinite(maxFrames) ? maxFrames : 72, 12, 180),
  );
  const sampleCount = Math.max(
    8,
    Math.min(
      safeMaximum,
      Math.ceil(Math.max(masterDuration, studentDuration) * safeFps),
    ),
  );

  return Array.from({ length: sampleCount }, (_, index) => {
    const progress = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    return {
      index,
      progress,
      masterTime: progress * masterDuration,
      studentTime: progress * studentDuration,
    };
  });
}

export function formatAnalysisTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "--";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.max(0, seconds - minutes * 60);
  return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
}

export function getTimelineColor(score: number | null) {
  if (score == null) return "bg-slate-500";
  if (score >= 85) return "bg-emerald-500";
  if (score >= 68) return "bg-amber-400";
  return "bg-red-500";
}
