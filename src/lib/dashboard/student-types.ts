import type { StudentAssignmentStatus } from "@/lib/assignments/types";

export type StudentDashboardAssignment = {
  id: string;
  className: string;
  teacherUsername: string;
  title: string;
  dueAt: Date | null;
  completedAt: Date | null;
  status: StudentAssignmentStatus;
};

export type StudentReleasedGradeSummary = {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  className: string;
  finalScore: number | null;
  releasedAt: Date;
};

export type StudentDashboardOverview = {
  upcomingAssignments: StudentDashboardAssignment[];
  lateAssignments: StudentDashboardAssignment[];
  completedAssignments: StudentDashboardAssignment[];
  releasedGrades: StudentReleasedGradeSummary[];
};

export type StudentHistoryItem = {
  assignmentId: string;
  assignmentTitle: string;
  className: string;
  teacherUsername: string;
  dueAt: Date | null;
  completedAt: Date;
  releasedGrade: {
    id: string;
    finalScore: number | null;
    releasedAt: Date;
  } | null;
};

export type StudentHistoryPage = {
  items: StudentHistoryItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type StudentReleasedGradeDetail = StudentReleasedGradeSummary & {
  automatedOverall: number | null;
  formScore: number | null;
  activityScore: number | null;
  timingScore: number | null;
  coverageScore: number | null;
  feedback: string | null;
  overrideReason: string | null;
};
