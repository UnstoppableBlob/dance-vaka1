import type {
  AssignmentStatus,
  MediaAssetStatus,
} from "@/generated/prisma/enums";

export type AssignmentReferenceVideo = {
  id: string;
  status: MediaAssetStatus;
  originalFilename: string | null;
  contentType: string;
  byteSize: number | null;
};

export type TeacherAssignment = {
  id: string;
  classId: string;
  title: string;
  instructions: string | null;
  dueAt: Date | null;
  status: AssignmentStatus;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  archivedAt: Date | null;
  recipientCount: number;
  referenceVideo: AssignmentReferenceVideo | null;
};

export type StudentAssignmentStatus =
  "NOT_STARTED" | "IN_PROGRESS" | "LATE" | "COMPLETED";

export type StudentAssignment = {
  id: string;
  classId: string;
  className: string;
  teacherUsername: string;
  title: string;
  instructions: string | null;
  dueAt: Date | null;
  publishedAt: Date;
  assignedAt: Date;
  status: StudentAssignmentStatus;
};

export type AssignmentFormState = {
  errors?: Partial<
    Record<
      "title" | "instructions" | "dueAt" | "referenceVideoAssetId",
      string[]
    >
  >;
  message?: string;
};
