import type { PoseAnalysis } from "@/lib/pose-comparison/types";

export function gradeLabel(score: number | null | undefined) {
  if (score == null || !Number.isFinite(score)) return "Not enough pose data";
  if (score >= 90) return "Excellent match";
  if (score >= 80) return "Strong match";
  if (score >= 68) return "Needs review";
  return "Needs significant correction";
}

export function buildPoseFeedback(
  analysis: PoseAnalysis,
  masterDuration: number,
  studentDuration: number,
) {
  const feedback = [
    `Overall: ${gradeLabel(analysis.overall)}. Pose detected in ${analysis.coverageScore}% of matched frames.`,
  ];
  feedback.push(
    analysis.mismatchCounts.length > 0
      ? `Most different form areas: ${analysis.mismatchCounts
          .slice(0, 4)
          .map((item) => item.label)
          .join(", ")}.`
      : "No consistent form mismatch stood out in the sampled frames.",
  );
  const durationDifference = studentDuration - masterDuration;
  feedback.push(
    `Timing: student video is ${Math.abs(durationDifference).toFixed(1)}s ${
      durationDifference >= 0 ? "longer" : "shorter"
    } than the master.`,
  );
  feedback.push(
    "Activity score compares the motion-energy pattern across the clips; form score compares normalized pose landmarks, limb angles, and joint angles.",
  );
  return feedback;
}
