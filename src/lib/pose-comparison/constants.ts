export const POSE_MATCH_THRESHOLD = 0.18;

export const POSE_COMPARE_LANDMARKS = [
  0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28,
] as const;

export const POSE_SIDE_SWAP = new Map<number, number>([
  [11, 12],
  [12, 11],
  [13, 14],
  [14, 13],
  [15, 16],
  [16, 15],
  [23, 24],
  [24, 23],
  [25, 26],
  [26, 25],
  [27, 28],
  [28, 27],
]);

export const POSE_COMPARE_SEGMENTS = [
  { label: "shoulders", from: 11, to: 12 },
  { label: "left upper arm", from: 11, to: 13 },
  { label: "left forearm", from: 13, to: 15 },
  { label: "right upper arm", from: 12, to: 14 },
  { label: "right forearm", from: 14, to: 16 },
  { label: "hips", from: 23, to: 24 },
  { label: "left thigh", from: 23, to: 25 },
  { label: "left lower leg", from: 25, to: 27 },
  { label: "right thigh", from: 24, to: 26 },
  { label: "right lower leg", from: 26, to: 28 },
] as const;

export const POSE_COMPARE_JOINTS = [
  { label: "left elbow", a: 11, b: 13, c: 15 },
  { label: "right elbow", a: 12, b: 14, c: 16 },
  { label: "left knee", a: 23, b: 25, c: 27 },
  { label: "right knee", a: 24, b: 26, c: 28 },
  { label: "left shoulder", a: 23, b: 11, c: 13 },
  { label: "right shoulder", a: 24, b: 12, c: 14 },
  { label: "left hip", a: 11, b: 23, c: 25 },
  { label: "right hip", a: 12, b: 24, c: 26 },
] as const;

export const SKELETON_CONNECTIONS = [
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
] as const;

export const ANALYSIS_WEIGHTS = {
  form: 0.58,
  activity: 0.24,
  timing: 0.12,
  coverage: 0.06,
} as const;
