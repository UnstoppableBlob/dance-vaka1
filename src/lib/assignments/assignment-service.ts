import "server-only";

import {
  AssignmentStatus,
  ClassStatus,
  MediaAssetKind,
  MediaAssetStatus,
  UserRole,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import type { SafeUser } from "@/lib/auth/types";
import {
  ClassAuthorizationError,
  DanceClassNotFoundError,
} from "@/lib/classes/class-service";
import { classIdSchema } from "@/lib/classes/validation";
import { db } from "@/lib/db";
import type {
  StudentAssignment,
  StudentAssignmentStatus,
  TeacherAssignment,
} from "@/lib/assignments/types";
import {
  assignmentDraftSchema,
  assignmentIdSchema,
  normalizeAssignmentTitle,
  type AssignmentDraftInput,
} from "@/lib/assignments/validation";

const assignmentSelect = {
  id: true,
  classId: true,
  title: true,
  instructions: true,
  dueAt: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  archivedAt: true,
  _count: { select: { assignedStudents: true } },
  referenceVideo: {
    select: {
      id: true,
      status: true,
      originalFilename: true,
      contentType: true,
      byteSize: true,
    },
  },
} as const;

type SelectedAssignment = Prisma.AssignmentGetPayload<{
  select: typeof assignmentSelect;
}>;

export class AssignmentNotFoundError extends Error {
  constructor() {
    super("Assignment not found.");
    this.name = "AssignmentNotFoundError";
  }
}

export class AssignmentTitleTakenError extends Error {
  constructor() {
    super("This class already has an assignment with that title.");
    this.name = "AssignmentTitleTakenError";
  }
}

export class ReferenceVideoUnavailableError extends Error {
  constructor() {
    super("Choose a ready reference video uploaded by your account.");
    this.name = "ReferenceVideoUnavailableError";
  }
}

export class AssignmentNotEditableError extends Error {
  constructor() {
    super("Only active drafts can be edited.");
    this.name = "AssignmentNotEditableError";
  }
}

export class ArchivedClassAssignmentError extends Error {
  constructor() {
    super("Assignments cannot be created or edited in an archived class.");
    this.name = "ArchivedClassAssignmentError";
  }
}

export class AssignmentPublishReferenceRequiredError extends Error {
  constructor() {
    super("Upload and save a ready reference video before publishing.");
    this.name = "AssignmentPublishReferenceRequiredError";
  }
}

export class AssignmentNotPublishableError extends Error {
  constructor() {
    super("Only active assignment drafts can be published.");
    this.name = "AssignmentNotPublishableError";
  }
}

export class StudentAssignmentAuthorizationError extends Error {
  constructor() {
    super("Only students can view assigned work.");
    this.name = "StudentAssignmentAuthorizationError";
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

function serializeAssignment(
  assignment: SelectedAssignment,
): TeacherAssignment {
  return {
    id: assignment.id,
    classId: assignment.classId,
    title: assignment.title,
    instructions: assignment.instructions,
    dueAt: assignment.dueAt,
    status: assignment.status,
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
    publishedAt: assignment.publishedAt,
    archivedAt: assignment.archivedAt,
    recipientCount: assignment._count.assignedStudents,
    referenceVideo: assignment.referenceVideo
      ? {
          ...assignment.referenceVideo,
          byteSize:
            assignment.referenceVideo.byteSize === null
              ? null
              : Number(assignment.referenceVideo.byteSize),
        }
      : null,
  };
}

function isSerializationConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}

export function deriveStudentAssignmentStatus({
  dueAt,
  hasSubmission,
  completedAt,
  now = new Date(),
}: {
  dueAt: Date | null;
  hasSubmission: boolean;
  completedAt: Date | null;
  now?: Date;
}): StudentAssignmentStatus {
  if (completedAt) return "COMPLETED";
  if (dueAt && dueAt.getTime() < now.getTime()) return "LATE";
  return hasSubmission ? "IN_PROGRESS" : "NOT_STARTED";
}

async function requireOwnedClass(
  transaction: Prisma.TransactionClient,
  teacherId: string,
  classId: string,
) {
  const danceClass = await transaction.danceClass.findFirst({
    where: { id: classId, teacherId },
    select: { id: true, status: true },
  });
  if (!danceClass) throw new DanceClassNotFoundError();
  return danceClass;
}

async function requireReferenceVideo(
  transaction: Prisma.TransactionClient,
  teacherId: string,
  assetId: string | null,
  assignmentId?: string,
) {
  if (!assetId) return;
  const asset = await transaction.mediaAsset.findFirst({
    where: {
      id: assetId,
      ownerId: teacherId,
      kind: MediaAssetKind.REFERENCE_VIDEO,
      status: MediaAssetStatus.READY,
      OR: [
        { referenceFor: null },
        ...(assignmentId ? [{ referenceFor: { id: assignmentId } }] : []),
      ],
    },
    select: { id: true },
  });
  if (!asset) throw new ReferenceVideoUnavailableError();
}

export async function createAssignmentDraft(
  actor: SafeUser,
  classId: string,
  input: AssignmentDraftInput,
): Promise<TeacherAssignment> {
  requireTeacher(actor);
  const parsedClassId = classIdSchema.parse(classId);
  const values = assignmentDraftSchema.parse(input);

  try {
    const assignment = await db.$transaction(async (transaction) => {
      const danceClass = await requireOwnedClass(
        transaction,
        actor.id,
        parsedClassId,
      );
      if (danceClass.status === ClassStatus.ARCHIVED) {
        throw new ArchivedClassAssignmentError();
      }
      await requireReferenceVideo(
        transaction,
        actor.id,
        values.referenceVideoAssetId,
      );
      return transaction.assignment.create({
        data: {
          classId: parsedClassId,
          createdById: actor.id,
          title: values.title,
          titleNormalized: normalizeAssignmentTitle(values.title),
          instructions: values.instructions,
          dueAt: values.dueAt,
          referenceVideoAssetId: values.referenceVideoAssetId,
        },
        select: assignmentSelect,
      });
    });
    return serializeAssignment(assignment);
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new AssignmentTitleTakenError();
    throw error;
  }
}

export async function listTeacherAssignments(
  actor: SafeUser,
  classId: string,
): Promise<TeacherAssignment[]> {
  requireTeacher(actor);
  const parsedClassId = classIdSchema.parse(classId);
  const assignments = await db.$transaction(async (transaction) => {
    await requireOwnedClass(transaction, actor.id, parsedClassId);
    return transaction.assignment.findMany({
      where: { classId: parsedClassId },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      select: assignmentSelect,
    });
  });
  return assignments.map(serializeAssignment);
}

export async function getTeacherAssignment(
  actor: SafeUser,
  classId: string,
  assignmentId: string,
): Promise<TeacherAssignment> {
  requireTeacher(actor);
  const parsedClassId = classIdSchema.parse(classId);
  const parsedAssignmentId = assignmentIdSchema.parse(assignmentId);
  const assignment = await db.assignment.findFirst({
    where: {
      id: parsedAssignmentId,
      classId: parsedClassId,
      danceClass: { teacherId: actor.id },
    },
    select: assignmentSelect,
  });
  if (!assignment) throw new AssignmentNotFoundError();
  return serializeAssignment(assignment);
}

export async function updateAssignmentDraft(
  actor: SafeUser,
  classId: string,
  assignmentId: string,
  input: AssignmentDraftInput,
): Promise<TeacherAssignment> {
  requireTeacher(actor);
  const parsedClassId = classIdSchema.parse(classId);
  const parsedAssignmentId = assignmentIdSchema.parse(assignmentId);
  const values = assignmentDraftSchema.parse(input);

  try {
    const assignment = await db.$transaction(async (transaction) => {
      const danceClass = await requireOwnedClass(
        transaction,
        actor.id,
        parsedClassId,
      );
      if (danceClass.status === ClassStatus.ARCHIVED) {
        throw new ArchivedClassAssignmentError();
      }
      const current = await transaction.assignment.findFirst({
        where: { id: parsedAssignmentId, classId: parsedClassId },
        select: { id: true, status: true },
      });
      if (!current) throw new AssignmentNotFoundError();
      if (current.status !== AssignmentStatus.DRAFT) {
        throw new AssignmentNotEditableError();
      }
      await requireReferenceVideo(
        transaction,
        actor.id,
        values.referenceVideoAssetId,
        parsedAssignmentId,
      );
      return transaction.assignment.update({
        where: { id: parsedAssignmentId },
        data: {
          title: values.title,
          titleNormalized: normalizeAssignmentTitle(values.title),
          instructions: values.instructions,
          dueAt: values.dueAt,
          referenceVideoAssetId: values.referenceVideoAssetId,
        },
        select: assignmentSelect,
      });
    });
    return serializeAssignment(assignment);
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new AssignmentTitleTakenError();
    throw error;
  }
}

export async function archiveAssignmentDraft(
  actor: SafeUser,
  classId: string,
  assignmentId: string,
): Promise<TeacherAssignment> {
  requireTeacher(actor);
  const parsedClassId = classIdSchema.parse(classId);
  const parsedAssignmentId = assignmentIdSchema.parse(assignmentId);
  const assignment = await db.$transaction(async (transaction) => {
    await requireOwnedClass(transaction, actor.id, parsedClassId);
    const current = await transaction.assignment.findFirst({
      where: { id: parsedAssignmentId, classId: parsedClassId },
      select: { id: true, status: true },
    });
    if (!current) throw new AssignmentNotFoundError();
    if (current.status === AssignmentStatus.ARCHIVED) {
      return transaction.assignment.findUniqueOrThrow({
        where: { id: parsedAssignmentId },
        select: assignmentSelect,
      });
    }
    if (current.status !== AssignmentStatus.DRAFT) {
      throw new AssignmentNotEditableError();
    }
    return transaction.assignment.update({
      where: { id: parsedAssignmentId },
      data: { status: AssignmentStatus.ARCHIVED, archivedAt: new Date() },
      select: assignmentSelect,
    });
  });
  return serializeAssignment(assignment);
}

export async function publishAssignmentDraft(
  actor: SafeUser,
  classId: string,
  assignmentId: string,
): Promise<TeacherAssignment> {
  requireTeacher(actor);
  const parsedClassId = classIdSchema.parse(classId);
  const parsedAssignmentId = assignmentIdSchema.parse(assignmentId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const assignment = await db.$transaction(
        async (transaction) => {
          const danceClass = await requireOwnedClass(
            transaction,
            actor.id,
            parsedClassId,
          );
          if (danceClass.status === ClassStatus.ARCHIVED) {
            throw new ArchivedClassAssignmentError();
          }

          const current = await transaction.assignment.findFirst({
            where: { id: parsedAssignmentId, classId: parsedClassId },
            select: {
              id: true,
              status: true,
              referenceVideo: {
                select: {
                  ownerId: true,
                  kind: true,
                  status: true,
                },
              },
            },
          });
          if (!current) throw new AssignmentNotFoundError();
          if (current.status !== AssignmentStatus.DRAFT) {
            throw new AssignmentNotPublishableError();
          }
          if (
            !current.referenceVideo ||
            current.referenceVideo.ownerId !== actor.id ||
            current.referenceVideo.kind !== MediaAssetKind.REFERENCE_VIDEO ||
            current.referenceVideo.status !== MediaAssetStatus.READY
          ) {
            throw new AssignmentPublishReferenceRequiredError();
          }

          const publishedAt = new Date();
          const published = await transaction.assignment.updateMany({
            where: {
              id: parsedAssignmentId,
              classId: parsedClassId,
              status: AssignmentStatus.DRAFT,
            },
            data: { status: AssignmentStatus.PUBLISHED, publishedAt },
          });
          if (published.count !== 1) {
            throw new AssignmentNotPublishableError();
          }

          const activeMembers = await transaction.classMembership.findMany({
            where: { classId: parsedClassId, removedAt: null },
            select: { studentId: true },
          });
          if (activeMembers.length > 0) {
            await transaction.assignmentStudent.createMany({
              data: activeMembers.map(({ studentId }) => ({
                assignmentId: parsedAssignmentId,
                studentId,
                assignedAt: publishedAt,
              })),
            });
          }

          return transaction.assignment.findUniqueOrThrow({
            where: { id: parsedAssignmentId },
            select: assignmentSelect,
          });
        },
        { isolationLevel: "Serializable" },
      );
      return serializeAssignment(assignment);
    } catch (error) {
      if (isSerializationConflict(error) && attempt < 2) continue;
      throw error;
    }
  }

  throw new Error("Assignment publication could not be completed.");
}

export async function listStudentAssignments(
  actor: SafeUser,
  now = new Date(),
): Promise<StudentAssignment[]> {
  if (actor.role !== UserRole.STUDENT) {
    throw new StudentAssignmentAuthorizationError();
  }

  const records = await db.assignmentStudent.findMany({
    where: {
      studentId: actor.id,
      assignment: { status: AssignmentStatus.PUBLISHED },
    },
    orderBy: { assignedAt: "desc" },
    select: {
      assignedAt: true,
      assignment: {
        select: {
          id: true,
          classId: true,
          title: true,
          instructions: true,
          dueAt: true,
          publishedAt: true,
          danceClass: {
            select: {
              name: true,
              teacher: { select: { username: true } },
            },
          },
          submissions: {
            where: { studentId: actor.id },
            take: 1,
            select: { completedAt: true },
          },
        },
      },
    },
  });

  return records.flatMap(({ assignment, assignedAt }) => {
    if (!assignment.publishedAt) return [];
    const submission = assignment.submissions[0];
    return [
      {
        id: assignment.id,
        classId: assignment.classId,
        className: assignment.danceClass.name,
        teacherUsername: assignment.danceClass.teacher.username,
        title: assignment.title,
        instructions: assignment.instructions,
        dueAt: assignment.dueAt,
        publishedAt: assignment.publishedAt,
        assignedAt,
        status: deriveStudentAssignmentStatus({
          dueAt: assignment.dueAt,
          hasSubmission: Boolean(submission),
          completedAt: submission?.completedAt ?? null,
          now,
        }),
      },
    ];
  });
}
