import "server-only";

import { ClassStatus, UserRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import type { SafeUser } from "@/lib/auth/types";
import type { TeacherClassSummary } from "@/lib/classes/types";
import {
  classIdSchema,
  createClassSchema,
  normalizeClassName,
  renameClassSchema,
  type CreateClassInput,
  type RenameClassInput,
} from "@/lib/classes/validation";

const teacherClassSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  _count: {
    select: {
      memberships: { where: { removedAt: null } },
      assignments: true,
    },
  },
} as const;

export class ClassAuthorizationError extends Error {
  constructor() {
    super("Only teachers can manage classes.");
    this.name = "ClassAuthorizationError";
  }
}

export class DanceClassNotFoundError extends Error {
  constructor() {
    super("Class not found.");
    this.name = "DanceClassNotFoundError";
  }
}

export class ClassNameTakenError extends Error {
  constructor() {
    super("You already have a class with that name.");
    this.name = "ClassNameTakenError";
  }
}

function requireTeacher(actor: SafeUser) {
  if (actor.role !== UserRole.TEACHER) {
    throw new ClassAuthorizationError();
  }
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export async function createTeacherClass(
  actor: SafeUser,
  input: CreateClassInput,
): Promise<TeacherClassSummary> {
  requireTeacher(actor);
  const values = createClassSchema.parse(input);

  try {
    return await db.danceClass.create({
      data: {
        teacherId: actor.id,
        name: values.name,
        nameNormalized: normalizeClassName(values.name),
        description: values.description,
      },
      select: teacherClassSelect,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ClassNameTakenError();
    }
    throw error;
  }
}

export async function listTeacherClasses(
  actor: SafeUser,
): Promise<TeacherClassSummary[]> {
  requireTeacher(actor);
  return db.danceClass.findMany({
    where: { teacherId: actor.id },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: teacherClassSelect,
  });
}

export async function getTeacherClass(
  actor: SafeUser,
  classId: string,
): Promise<TeacherClassSummary> {
  requireTeacher(actor);
  const id = classIdSchema.parse(classId);
  const danceClass = await db.danceClass.findFirst({
    where: { id, teacherId: actor.id },
    select: teacherClassSelect,
  });

  if (!danceClass) {
    throw new DanceClassNotFoundError();
  }

  return danceClass;
}

export async function renameTeacherClass(
  actor: SafeUser,
  classId: string,
  input: RenameClassInput,
): Promise<TeacherClassSummary> {
  requireTeacher(actor);
  const id = classIdSchema.parse(classId);
  const values = renameClassSchema.parse(input);

  try {
    return await db.$transaction(async (transaction) => {
      const ownedClass = await transaction.danceClass.findFirst({
        where: { id, teacherId: actor.id },
        select: { id: true },
      });
      if (!ownedClass) {
        throw new DanceClassNotFoundError();
      }

      return transaction.danceClass.update({
        where: { id },
        data: {
          name: values.name,
          nameNormalized: normalizeClassName(values.name),
        },
        select: teacherClassSelect,
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ClassNameTakenError();
    }
    throw error;
  }
}

export async function archiveTeacherClass(
  actor: SafeUser,
  classId: string,
): Promise<TeacherClassSummary> {
  requireTeacher(actor);
  const id = classIdSchema.parse(classId);

  return db.$transaction(async (transaction) => {
    const ownedClass = await transaction.danceClass.findFirst({
      where: { id, teacherId: actor.id },
      select: { status: true },
    });
    if (!ownedClass) {
      throw new DanceClassNotFoundError();
    }

    if (ownedClass.status === ClassStatus.ARCHIVED) {
      return transaction.danceClass.findUniqueOrThrow({
        where: { id },
        select: teacherClassSelect,
      });
    }

    return transaction.danceClass.update({
      where: { id },
      data: { status: ClassStatus.ARCHIVED, archivedAt: new Date() },
      select: teacherClassSelect,
    });
  });
}
