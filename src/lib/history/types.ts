import type { GradeStatus } from "@/generated/prisma/enums";
import type { StudentAssignmentStatus } from "@/lib/assignments/types";
import type { TeacherGradeView } from "@/lib/grades/types";

export type HistoryGradeStatus = GradeStatus | "NOT_STARTED";

export type TeacherStudentAssignmentHistory = {
  id: string;
  title: string;
  assignedAt: Date;
  dueAt: Date | null;
  status: StudentAssignmentStatus;
  completedAt: Date | null;
  gradeStatus: HistoryGradeStatus;
  canGrade: boolean;
};

export type TeacherStudentHistory = {
  classId: string;
  className: string;
  studentId: string;
  studentUsername: string;
  joinedAt: Date;
  removedAt: Date | null;
  assignments: TeacherStudentAssignmentHistory[];
};

export type TeacherGradingContext = {
  classId: string;
  className: string;
  studentId: string;
  studentUsername: string;
  assignmentId: string;
  assignmentTitle: string;
  instructions: string | null;
  dueAt: Date | null;
  referenceVideo: {
    id: string;
    contentType: string;
    originalFilename: string | null;
  };
  submission: {
    id: string;
    videoAssetId: string;
    contentType: string;
    originalFilename: string | null;
    submittedAt: Date;
    completedAt: Date;
  };
  gradeStatus: HistoryGradeStatus;
  grade: TeacherGradeView | null;
};
