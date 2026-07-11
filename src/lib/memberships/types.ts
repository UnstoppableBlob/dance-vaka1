import type { ClassStatus } from "@/generated/prisma/enums";

export type StudentInvitation = {
  id: string;
  classId: string;
  className: string;
  teacherUsername: string;
  createdAt: Date;
  expiresAt: Date | null;
};

export type StudentClassSummary = {
  id: string;
  name: string;
  status: ClassStatus;
  teacherUsername: string;
  joinedAt: Date;
};

export type ClassRosterMember = {
  studentId: string;
  username: string;
  joinedAt: Date;
};
