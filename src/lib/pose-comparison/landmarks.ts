import type {
  Point2D,
  PoseLandmark,
  PoseLandmarks,
} from "@/lib/pose-comparison/types";

export function isVisible(
  landmark: PoseLandmark | null | undefined,
  threshold = 0.35,
): landmark is PoseLandmark {
  return Boolean(
    landmark &&
    Number.isFinite(landmark.x) &&
    Number.isFinite(landmark.y) &&
    (landmark.visibility == null || landmark.visibility >= threshold),
  );
}

export function cloneLandmarks(landmarks: PoseLandmarks): PoseLandmark[] {
  return landmarks.map(({ x, y, z, visibility }) => ({
    x,
    y,
    z,
    visibility,
  }));
}

export function getPoseCenter(landmarks: PoseLandmarks): Point2D | null {
  const points = [0, 11, 12, 23, 24]
    .map((index) => landmarks[index])
    .filter((point) => isVisible(point, 0.25));
  if (points.length === 0) return null;
  const total = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: total.x / points.length, y: total.y / points.length };
}

export function getPoseQuality(landmarks: PoseLandmarks) {
  return [0, 11, 12, 23, 24].reduce(
    (quality, index) => quality + (isVisible(landmarks[index], 0.35) ? 1 : 0),
    0,
  );
}
