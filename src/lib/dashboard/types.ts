import type { GradeStatus } from "@/generated/prisma/enums";
import type { TeacherClassSummary } from "@/lib/classes/types";

export type DashboardInvitation = {
  id: string;
  classId: string;
  className: string;
  studentUsername: string;
  createdAt: Date;
};

export type DashboardAssignmentProgress = {
  id: string;
  classId: string;
  className: string;
  title: string;
  publishedAt: Date;
  recipientCount: number;
  completedCount: number;
};

export type DashboardSubmission = {
  id: string;
  studentId: string;
  classId: string;
  className: string;
  assignmentId: string;
  assignmentTitle: string;
  studentUsername: string;
  submittedAt: Date;
};

export type TeacherDashboardOverview = {
  classes: TeacherClassSummary[];
  pendingInvitationCount: number;
  pendingInvitations: DashboardInvitation[];
  assignmentProgress: DashboardAssignmentProgress[];
  recentSubmissions: DashboardSubmission[];
  needsReviewCount: number;
  needsReview: DashboardSubmission[];
};

export type TeacherSubmissionDetail = DashboardSubmission & {
  completedAt: Date;
  gradeStatus: GradeStatus | null;
};
