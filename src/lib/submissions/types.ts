import type { StudentAssignmentStatus } from "@/lib/assignments/types";

export type StudentSubmissionSummary = {
  id: string;
  videoAssetId: string;
  submittedAt: Date;
  completedAt: Date;
  submittedLate: boolean;
  gradingStarted: boolean;
};

export type StudentAssignmentDetail = {
  id: string;
  classId: string;
  className: string;
  teacherUsername: string;
  title: string;
  instructions: string | null;
  dueAt: Date | null;
  publishedAt: Date;
  status: StudentAssignmentStatus;
  referenceVideo: {
    id: string;
    contentType: string;
  };
  submission: StudentSubmissionSummary | null;
};

export type SubmissionFormState = {
  success?: boolean;
  message?: string;
  errors?: { videoAssetId?: string[] };
};
