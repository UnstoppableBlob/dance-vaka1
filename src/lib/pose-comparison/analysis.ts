import { ANALYSIS_WEIGHTS } from "@/lib/pose-comparison/constants";
import {
  getActivityScore,
  getMotionEnergy,
} from "@/lib/pose-comparison/motion";
import {
  average,
  getCoverageScore,
  getTimingScore,
  weightedScore,
} from "@/lib/pose-comparison/scoring";
import type {
  PoseAnalysis,
  PoseAnalysisSample,
  PoseMismatchCount,
} from "@/lib/pose-comparison/types";

export function countMismatches(samples: readonly PoseAnalysisSample[]) {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    for (const mismatch of sample.comparison?.mismatches ?? []) {
      counts.set(mismatch.label, (counts.get(mismatch.label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, count]): PoseMismatchCount => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function buildPoseAnalysis<TSample extends PoseAnalysisSample>(
  samples: readonly TSample[],
  masterDuration: number,
  studentDuration: number,
): PoseAnalysis<TSample> {
  const copiedSamples = [...samples];
  const formScores = copiedSamples.flatMap((sample) =>
    sample.comparison && Number.isFinite(sample.comparison.score)
      ? [sample.comparison.score]
      : [],
  );
  const formScore = average(formScores);
  const masterEnergy = getMotionEnergy(
    copiedSamples.map((sample) => sample.master.landmarks),
  );
  const studentEnergy = getMotionEnergy(
    copiedSamples.map((sample) => sample.student.landmarks),
  );
  const activityScore = getActivityScore(masterEnergy, studentEnergy);
  const timingScore = getTimingScore(masterDuration, studentDuration);
  const coverageScore = getCoverageScore(
    formScores.length,
    copiedSamples.length,
  );
  const overall = weightedScore([
    { value: formScore, weight: ANALYSIS_WEIGHTS.form },
    { value: activityScore, weight: ANALYSIS_WEIGHTS.activity },
    { value: timingScore, weight: ANALYSIS_WEIGHTS.timing },
    { value: coverageScore, weight: ANALYSIS_WEIGHTS.coverage },
  ]);

  return {
    samples: copiedSamples,
    formScore,
    activityScore,
    timingScore,
    coverageScore,
    overall,
    mismatchCounts: countMismatches(copiedSamples),
    masterEnergy,
    studentEnergy,
  };
}
