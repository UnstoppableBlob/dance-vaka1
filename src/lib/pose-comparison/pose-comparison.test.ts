import { describe, expect, it } from "vitest";

import {
  buildPoseAnalysis,
  buildPoseFeedback,
  comparePoseLandmarks,
  getActivityScore,
  getCoverageScore,
  getJointAngle,
  getMotionEnergy,
  getTimingScore,
  getVectorAngleDifference,
  normalizePoseForComparison,
  weightedScore,
} from "@/lib/pose-comparison";
import type {
  PoseAnalysisSample,
  PoseLandmark,
  PoseLandmarks,
} from "@/lib/pose-comparison";

function makePose(): PoseLandmark[] {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 0,
  }));
  const visiblePoints: Record<number, [number, number]> = {
    0: [0.54, 0.12],
    11: [0.4, 0.3],
    12: [0.6, 0.3],
    13: [0.3, 0.38],
    14: [0.7, 0.43],
    15: [0.2, 0.3],
    16: [0.78, 0.58],
    23: [0.44, 0.58],
    24: [0.57, 0.58],
    25: [0.38, 0.78],
    26: [0.63, 0.76],
    27: [0.32, 0.95],
    28: [0.72, 0.88],
  };
  for (const [rawIndex, [x, y]] of Object.entries(visiblePoints)) {
    landmarks[Number(rawIndex)] = { x, y, z: 0, visibility: 1 };
  }
  return landmarks;
}

function transformPose(
  pose: PoseLandmarks,
  transform: (point: PoseLandmark) => PoseLandmark,
) {
  return pose.map((point) =>
    point.visibility === 0 ? { ...point } : transform(point),
  );
}

describe("pose form comparison", () => {
  it("scores identical poses at 100 without selecting a mirrored variant", () => {
    const pose = makePose();
    expect(comparePoseLandmarks(pose, pose)).toMatchObject({
      error: 0,
      score: 100,
      mirrored: false,
      mismatches: [],
    });
  });

  it("normalizes translation and scale before comparing landmarks", () => {
    const master = makePose();
    const transformed = transformPose(master, (point) => ({
      ...point,
      x: point.x * 1.7 + 2.4,
      y: point.y * 1.7 - 0.8,
    }));
    expect(comparePoseLandmarks(transformed, master)?.score).toBe(100);
  });

  it("recognizes an asymmetric horizontally mirrored pose", () => {
    const master = makePose();
    const mirrored = transformPose(master, (point) => ({
      ...point,
      x: 1 - point.x,
    }));
    expect(comparePoseLandmarks(mirrored, master)).toMatchObject({
      score: 100,
      mirrored: true,
    });
  });

  it("lowers the score and identifies form areas for a mismatched pose", () => {
    const master = makePose();
    const student = makePose();
    student[13] = { x: 0.52, y: 0.28, visibility: 1 };
    student[15] = { x: 0.64, y: 0.2, visibility: 1 };
    student[25] = { x: 0.52, y: 0.7, visibility: 1 };
    student[27] = { x: 0.7, y: 0.72, visibility: 1 };
    const comparison = comparePoseLandmarks(student, master);

    expect(comparison).not.toBeNull();
    expect(comparison!.score).toBeLessThan(90);
    expect(comparison!.mismatches.length).toBeGreaterThan(0);
  });

  it("returns null when too few visible landmarks can be normalized", () => {
    const incomplete = makePose().map((point, index) => ({
      ...point,
      visibility: [11, 12, 23, 24, 25].includes(index) ? 1 : 0,
    }));
    expect(normalizePoseForComparison(incomplete)).toBeNull();
    expect(comparePoseLandmarks(incomplete, makePose())).toBeNull();
  });

  it("calculates limb-direction and joint angles deterministically", () => {
    expect(
      getVectorAngleDifference({ x: -1, y: 0.01 }, { x: -1, y: -0.01 }),
    ).toBeCloseTo(0.02, 3);
    expect(
      getJointAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }),
    ).toBeCloseTo(Math.PI / 2);
    expect(getJointAngle(undefined, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });
});

describe("motion, timing, weighting, and feedback", () => {
  it("derives matching motion-energy patterns and handles missing frames", () => {
    const first = makePose();
    const second = makePose();
    second[15] = { ...second[15], x: second[15].x + 0.12 };
    const energy = getMotionEnergy([first, second, null]);

    expect(energy[0]).toBeGreaterThan(0);
    expect(energy[1]).toBeNull();
    expect(getActivityScore(energy, energy)).toBe(100);
    expect(getActivityScore([null], [null])).toBeNull();
  });

  it("scores duration ratios and rejects invalid durations", () => {
    expect(getTimingScore(10, 10)).toBe(100);
    expect(getTimingScore(10, 5)).toBe(50);
    expect(getTimingScore(0, 5)).toBeNull();
    expect(getTimingScore(Number.NaN, 5)).toBeNull();
  });

  it("keeps coverage, weighted, activity, and pose scores within 0–100", () => {
    expect(getCoverageScore(20, 10)).toBe(100);
    expect(getCoverageScore(-2, 10)).toBe(0);
    expect(weightedScore([{ value: 500, weight: 1 }])).toBe(100);
    expect(weightedScore([{ value: -500, weight: 1 }])).toBe(0);
    expect(weightedScore([{ value: null, weight: 1 }])).toBeNull();
    expect(getActivityScore([0], [10])).toBeGreaterThanOrEqual(0);

    const distorted = makePose();
    distorted[15] = { x: 1000, y: -1000, visibility: 1 };
    const score = comparePoseLandmarks(distorted, makePose())?.score;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("aggregates coverage, configured weights, mismatches, and feedback", () => {
    const pose = makePose();
    const comparison = comparePoseLandmarks(pose, pose)!;
    const samples: PoseAnalysisSample[] = [
      {
        master: { landmarks: pose },
        student: { landmarks: pose },
        comparison: {
          ...comparison,
          mismatches: [{ label: "left elbow", error: 0.3 }],
        },
      },
      {
        master: { landmarks: pose },
        student: { landmarks: null },
        comparison: null,
      },
    ];
    const analysis = buildPoseAnalysis(samples, 10, 8);
    const feedback = buildPoseFeedback(analysis, 10, 8);

    expect(analysis.formScore).toBe(100);
    expect(analysis.coverageScore).toBe(50);
    expect(analysis.timingScore).toBe(80);
    expect(analysis.overall).toBeGreaterThanOrEqual(0);
    expect(analysis.overall).toBeLessThanOrEqual(100);
    expect(analysis.mismatchCounts).toEqual([
      { label: "left elbow", count: 1 },
    ]);
    expect(feedback).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Pose detected in 50%"),
        expect.stringContaining("left elbow"),
        expect.stringContaining("2.0s shorter"),
      ]),
    );
  });
});
