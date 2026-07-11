import type { Point2D } from "@/lib/pose-comparison/types";

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function getVector(from: Point2D, to: Point2D): Point2D {
  return { x: to.x - from.x, y: to.y - from.y };
}

export function getVectorAngleDifference(a: Point2D, b: Point2D) {
  const angleA = Math.atan2(a.y, a.x);
  const angleB = Math.atan2(b.y, b.x);
  let difference = Math.abs(angleA - angleB);
  if (difference > Math.PI) difference = Math.PI * 2 - difference;
  return difference;
}

export function getJointAngle(
  a: Point2D | undefined,
  b: Point2D | undefined,
  c: Point2D | undefined,
) {
  if (!a || !b || !c) return null;
  const vectorA = getVector(b, a);
  const vectorC = getVector(b, c);
  const lengthA = Math.hypot(vectorA.x, vectorA.y);
  const lengthC = Math.hypot(vectorC.x, vectorC.y);
  if (lengthA <= 0.001 || lengthC <= 0.001) return null;
  const dot = vectorA.x * vectorC.x + vectorA.y * vectorC.y;
  return Math.acos(clamp(dot / (lengthA * lengthC), -1, 1));
}
