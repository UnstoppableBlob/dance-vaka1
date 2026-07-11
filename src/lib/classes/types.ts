import type { ClassStatus } from "@/generated/prisma/enums";

export type TeacherClassSummary = {
  id: string;
  name: string;
  description: string | null;
  status: ClassStatus;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  _count: {
    memberships: number;
    assignments: number;
  };
};

export type ClassFormState = {
  errors?: {
    name?: string[];
    description?: string[];
  };
  message?: string;
  success?: boolean;
  values?: {
    name?: string;
    description?: string;
  };
};
