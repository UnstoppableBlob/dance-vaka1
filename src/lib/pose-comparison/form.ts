import {
  POSE_COMPARE_JOINTS,
  POSE_COMPARE_SEGMENTS,
  POSE_MATCH_THRESHOLD,
} from "@/lib/pose-comparison/constants";
import {
  getJointAngle,
  getVector,
  getVectorAngleDifference,
} from "@/lib/pose-comparison/math";
import { normalizePoseForComparison } from "@/lib/pose-comparison/normalization";
import type {
  NormalizedPose,
  Point2D,
  PoseComparison,
  PoseLandmarks,
  PoseMismatch,
} from "@/lib/pose-comparison/types";

type ComponentComparison = {
  error: number;
  mismatches: PoseMismatch[];
};

export function getNormalizedPosePointError(
  a: ReadonlyMap<number, Point2D>,
  b: ReadonlyMap<number, Point2D>,
) {
  let total = 0;
  let count = 0;
  for (const [index, pointA] of a.entries()) {
    const pointB = b.get(index);
    if (!pointB) continue;
    total += Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
    count += 1;
  }
  return count >= 6 ? total / count : Number.POSITIVE_INFINITY;
}

export function getSegmentComparison(
  studentPoints: ReadonlyMap<number, Point2D>,
  masterPoints: ReadonlyMap<number, Point2D>,
): ComponentComparison {
  const mismatches: PoseMismatch[] = [];
  let total = 0;
  let count = 0;

  for (const segment of POSE_COMPARE_SEGMENTS) {
    const studentFrom = studentPoints.get(segment.from);
    const studentTo = studentPoints.get(segment.to);
    const masterFrom = masterPoints.get(segment.from);
    const masterTo = masterPoints.get(segment.to);
    if (!studentFrom || !studentTo || !masterFrom || !masterTo) continue;

    const endpointError =
      (Math.hypot(studentFrom.x - masterFrom.x, studentFrom.y - masterFrom.y) +
        Math.hypot(studentTo.x - masterTo.x, studentTo.y - masterTo.y)) /
      2;
    const angleError =
      getVectorAngleDifference(
        getVector(studentFrom, studentTo),
        getVector(masterFrom, masterTo),
      ) / Math.PI;
    const error = endpointError * 0.55 + angleError * 0.45;
    total += error;
    count += 1;
    if (error > POSE_MATCH_THRESHOLD)
      mismatches.push({ label: segment.label, error });
  }

  return {
    error: count >= 4 ? total / count : Number.POSITIVE_INFINITY,
    mismatches,
  };
}

export function getJointComparison(
  studentPoints: ReadonlyMap<number, Point2D>,
  masterPoints: ReadonlyMap<number, Point2D>,
): ComponentComparison {
  const mismatches: PoseMismatch[] = [];
  let total = 0;
  let count = 0;

  for (const joint of POSE_COMPARE_JOINTS) {
    const studentAngle = getJointAngle(
      studentPoints.get(joint.a),
      studentPoints.get(joint.b),
      studentPoints.get(joint.c),
    );
    const masterAngle = getJointAngle(
      masterPoints.get(joint.a),
      masterPoints.get(joint.b),
      masterPoints.get(joint.c),
    );
    if (studentAngle == null || masterAngle == null) continue;
    const error = Math.abs(studentAngle - masterAngle) / Math.PI;
    total += error;
    count += 1;
    if (error > POSE_MATCH_THRESHOLD)
      mismatches.push({ label: joint.label, error });
  }

  return {
    error: count >= 2 ? total / count : Number.POSITIVE_INFINITY,
    mismatches,
  };
}

export function getPoseComparisonCandidate(
  student: NormalizedPose,
  master: NormalizedPose,
) {
  const pointError = getNormalizedPosePointError(student.points, master.points);
  const segmentComparison = getSegmentComparison(student.points, master.points);
  const jointComparison = getJointComparison(student.points, master.points);
  const parts = [
    { value: pointError, weight: 0.45 },
    { value: segmentComparison.error, weight: 0.35 },
    { value: jointComparison.error, weight: 0.2 },
  ].filter((part) => Number.isFinite(part.value));
  if (parts.length === 0) {
    return { student, error: Number.POSITIVE_INFINITY, mismatches: [] };
  }
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const error =
    parts.reduce((sum, part) => sum + part.value * part.weight, 0) /
    totalWeight;
  const mismatches = [
    ...segmentComparison.mismatches,
    ...jointComparison.mismatches,
  ]
    .sort((a, b) => b.error - a.error)
    .slice(0, 3);
  return { student, error, mismatches };
}

export function comparePoseLandmarks(
  studentLandmarks: PoseLandmarks,
  masterLandmarks: PoseLandmarks,
): PoseComparison | null {
  const studentVariants = [
    normalizePoseForComparison(studentLandmarks, {
      mirrorX: false,
      swapSides: false,
      label: "normal",
    }),
    normalizePoseForComparison(studentLandmarks, {
      mirrorX: true,
      swapSides: false,
      label: "mirrored",
    }),
    normalizePoseForComparison(studentLandmarks, {
      mirrorX: true,
      swapSides: true,
      label: "mirrored-sides",
    }),
  ].filter((pose): pose is NormalizedPose => pose !== null);
  const master = normalizePoseForComparison(masterLandmarks, false);
  if (studentVariants.length === 0 || !master) return null;

  const best = studentVariants
    .map((student) => getPoseComparisonCandidate(student, master))
    .filter((candidate) => Number.isFinite(candidate.error))
    .sort((a, b) => a.error - b.error)[0];
  if (!best) return null;

  return {
    error: best.error,
    score: Math.max(
      0,
      Math.min(100, Math.round(100 - (best.error / POSE_MATCH_THRESHOLD) * 35)),
    ),
    mirrored: best.student.label !== "normal",
    mismatches: best.mismatches,
  };
}
