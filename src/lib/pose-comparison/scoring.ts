import { clamp } from "@/lib/pose-comparison/math";
import type { WeightedScorePart } from "@/lib/pose-comparison/types";

export function average(values: readonly (number | null | undefined)[]) {
  const finite = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  return finite.length
    ? finite.reduce((sum, value) => sum + value, 0) / finite.length
    : null;
}

export function weightedScore(parts: readonly WeightedScorePart[]) {
  const usable = parts.filter(
    (part): part is { value: number; weight: number } =>
      typeof part.value === "number" &&
      Number.isFinite(part.value) &&
      Number.isFinite(part.weight) &&
      part.weight > 0,
  );
  const totalWeight = usable.reduce((sum, part) => sum + part.weight, 0);
  if (usable.length === 0 || totalWeight === 0) return null;
  const result =
    usable.reduce((sum, part) => sum + part.value * part.weight, 0) /
    totalWeight;
  return Math.round(clamp(result, 0, 100));
}

export function getTimingScore(
  masterDuration: number,
  studentDuration: number,
) {
  if (
    !Number.isFinite(masterDuration) ||
    !Number.isFinite(studentDuration) ||
    masterDuration <= 0 ||
    studentDuration <= 0
  ) {
    return null;
  }
  const ratio =
    Math.min(masterDuration, studentDuration) /
    Math.max(masterDuration, studentDuration);
  return Math.round(clamp(ratio * 100, 0, 100));
}

export function getCoverageScore(matchedFrames: number, totalFrames: number) {
  if (!Number.isFinite(totalFrames) || totalFrames <= 0) return 0;
  return Math.round(clamp((matchedFrames / totalFrames) * 100, 0, 100));
}
