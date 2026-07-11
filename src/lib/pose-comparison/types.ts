export type PoseLandmark = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

export type PoseLandmarks = readonly PoseLandmark[];

export type Point2D = {
  x: number;
  y: number;
};

export type PoseVariantLabel = "normal" | "mirrored" | "mirrored-sides";

export type NormalizedPose = {
  label: PoseVariantLabel;
  points: ReadonlyMap<number, Point2D>;
};

export type PoseMismatch = {
  label: string;
  error: number;
};

export type PoseComparison = {
  error: number;
  score: number;
  mirrored: boolean;
  mismatches: PoseMismatch[];
};

export type PoseAnalysisSample = {
  master: { landmarks: PoseLandmarks | null };
  student: { landmarks: PoseLandmarks | null };
  comparison: PoseComparison | null;
};

export type PoseMismatchCount = {
  label: string;
  count: number;
};

export type PoseAnalysis<
  TSample extends PoseAnalysisSample = PoseAnalysisSample,
> = {
  samples: TSample[];
  formScore: number | null;
  activityScore: number | null;
  timingScore: number | null;
  coverageScore: number;
  overall: number | null;
  mismatchCounts: PoseMismatchCount[];
  masterEnergy: Array<number | null>;
  studentEnergy: Array<number | null>;
};

export type WeightedScorePart = {
  value: number | null | undefined;
  weight: number;
};
