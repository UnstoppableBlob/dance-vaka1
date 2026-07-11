import { normalizePoseForComparison } from "@/lib/pose-comparison/normalization";
import { average } from "@/lib/pose-comparison/scoring";
import type { PoseLandmarks } from "@/lib/pose-comparison/types";

export function getMotionEnergy(
  landmarkFrames: readonly (PoseLandmarks | null | undefined)[],
) {
  const energies: Array<number | null> = [];
  for (let index = 1; index < landmarkFrames.length; index += 1) {
    const previous = normalizePoseForComparison(
      landmarkFrames[index - 1],
      false,
    );
    const current = normalizePoseForComparison(landmarkFrames[index], false);
    if (!previous || !current) {
      energies.push(null);
      continue;
    }

    let total = 0;
    let count = 0;
    for (const [landmarkIndex, point] of current.points.entries()) {
      const previousPoint = previous.points.get(landmarkIndex);
      if (!previousPoint) continue;
      total += Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
      count += 1;
    }
    energies.push(count >= 6 ? total / count : null);
  }
  return energies;
}

export function getActivityScore(
  masterEnergy: readonly (number | null | undefined)[],
  studentEnergy: readonly (number | null | undefined)[],
) {
  const pairs = masterEnergy
    .map((masterValue, index) => ({
      masterValue,
      studentValue: studentEnergy[index],
    }))
    .filter(
      (pair): pair is { masterValue: number; studentValue: number } =>
        typeof pair.masterValue === "number" &&
        Number.isFinite(pair.masterValue) &&
        typeof pair.studentValue === "number" &&
        Number.isFinite(pair.studentValue),
    );
  if (pairs.length === 0) return null;

  const masterAverage = average(pairs.map((pair) => pair.masterValue));
  const studentAverage = average(pairs.map((pair) => pair.studentValue));
  if (masterAverage == null || studentAverage == null) return null;
  const scale = Math.max(masterAverage, studentAverage, 0.02);
  const meanDifference = average(
    pairs.map((pair) => Math.abs(pair.masterValue - pair.studentValue)),
  );
  if (meanDifference == null) return null;
  return Math.max(
    0,
    Math.min(100, Math.round(100 - (meanDifference / scale) * 55)),
  );
}
