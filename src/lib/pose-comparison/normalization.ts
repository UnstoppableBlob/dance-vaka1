import {
  POSE_COMPARE_LANDMARKS,
  POSE_SIDE_SWAP,
} from "@/lib/pose-comparison/constants";
import { isVisible } from "@/lib/pose-comparison/landmarks";
import type {
  NormalizedPose,
  Point2D,
  PoseLandmarks,
  PoseVariantLabel,
} from "@/lib/pose-comparison/types";

export type NormalizePoseOptions = {
  mirrorX?: boolean;
  swapSides?: boolean;
  label?: PoseVariantLabel;
};

export function normalizePoseForComparison(
  landmarks: PoseLandmarks | null | undefined,
  options: NormalizePoseOptions | boolean = {},
): NormalizedPose | null {
  const normalizedOptions: NormalizePoseOptions =
    typeof options === "boolean"
      ? {
          mirrorX: options,
          swapSides: false,
          label: options ? "mirrored" : "normal",
        }
      : options;
  const {
    mirrorX = false,
    swapSides = false,
    label = "normal",
  } = normalizedOptions;
  const leftShoulder = landmarks?.[11];
  const rightShoulder = landmarks?.[12];
  const leftHip = landmarks?.[23];
  const rightHip = landmarks?.[24];
  const anchorPoints = [leftShoulder, rightShoulder, leftHip, rightHip].filter(
    (point) => isVisible(point, 0.2),
  );
  if (anchorPoints.length < 2) return null;

  const anchor = anchorPoints.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  anchor.x /= anchorPoints.length;
  anchor.y /= anchorPoints.length;

  const shoulderScale =
    isVisible(leftShoulder, 0.2) && isVisible(rightShoulder, 0.2)
      ? Math.hypot(
          rightShoulder.x - leftShoulder.x,
          rightShoulder.y - leftShoulder.y,
        )
      : 0;
  const torsoScale = anchorPoints.reduce(
    (largest, point) =>
      Math.max(largest, Math.hypot(point.x - anchor.x, point.y - anchor.y)),
    0,
  );
  const scale = Math.max(shoulderScale, torsoScale, 0.001);
  const points = new Map<number, Point2D>();

  for (const index of POSE_COMPARE_LANDMARKS) {
    const point = landmarks?.[index];
    if (!isVisible(point, 0.2)) continue;
    const normalizedIndex = swapSides
      ? (POSE_SIDE_SWAP.get(index) ?? index)
      : index;
    const x = (point.x - anchor.x) / scale;
    points.set(normalizedIndex, {
      x: mirrorX ? -x : x,
      y: (point.y - anchor.y) / scale,
    });
  }

  return points.size >= 6 ? { label, points } : null;
}
