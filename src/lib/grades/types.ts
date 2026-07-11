import type { GradeStatus } from "@/generated/prisma/enums";

export type GradeAnalysisDetails = {
  version: 1;
  analyzedAt: string;
  sampleCount: number;
  matchedFrames: number;
  mismatchCounts: Array<{ label: string; count: number }>;
};

export type TeacherGradeInput = {
  automatedOverall: number;
  formScore: number | null;
  activityScore: number | null;
  timingScore: number | null;
  coverageScore: number;
  analysisDetails: GradeAnalysisDetails;
  feedback: string | null;
  overrideScore: number | null;
  overrideReason: string | null;
};

export type TeacherGradeRecord = {
  id: string;
  submissionId: string;
  status: GradeStatus;
  automatedOverall: number;
  formScore: number | null;
  activityScore: number | null;
  timingScore: number | null;
  coverageScore: number;
  analysisDetails: GradeAnalysisDetails;
  finalScore: number;
  overrideReason: string | null;
  feedback: string | null;
  releasedAt: Date | null;
};

export type TeacherGradeView = {
  id: string;
  status: GradeStatus;
  automatedOverall: number | null;
  formScore: number | null;
  activityScore: number | null;
  timingScore: number | null;
  coverageScore: number | null;
  analysisDetails: GradeAnalysisDetails | null;
  finalScore: number | null;
  overrideReason: string | null;
  feedback: string | null;
  releasedAt: Date | null;
};

export type GradeFormState = {
  success?: boolean;
  status?: GradeStatus;
  message?: string;
  errors?: Partial<
    Record<
      | "automatedOverall"
      | "formScore"
      | "activityScore"
      | "timingScore"
      | "coverageScore"
      | "analysisDetails"
      | "feedback"
      | "overrideScore"
      | "overrideReason",
      string[]
    >
  >;
};
