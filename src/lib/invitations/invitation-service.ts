import "server-only";

import {
  ClassStatus,
  InvitationStatus,
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
import type { PendingInvitation } from "@/lib/invitations/types";
import {
  invitationIdSchema,
  inviteStudentSchema,
  type InviteStudentInput,
} from "@/lib/invitations/validation";
import { normalizeUsername } from "@/lib/auth/validation";

export class InvitationTargetNotFoundError extends Error {
  constructor() {
    super("No eligible student account was found for that exact username.");
    this.name = "InvitationTargetNotFoundError";
  }
}

export class InvitationAlreadyPendingError extends Error {
  constructor() {
    super("That student already has a pending invitation to this class.");
    this.name = "InvitationAlreadyPendingError";
  }
}

export class StudentAlreadyMemberError extends Error {
  constructor() {
    super("That student is already enrolled in this class.");
    this.name = "StudentAlreadyMemberError";
  }
}

export class ArchivedClassInvitationError extends Error {
  constructor() {
    super("Archived classes cannot send new invitations.");
    this.name = "ArchivedClassInvitationError";
  }
}

export class InvitationNotFoundError extends Error {
  constructor() {
    super("Invitation not found.");
    this.name = "InvitationNotFoundError";
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

async function requireOwnedClass(
  transaction: Prisma.TransactionClient,
  teacherId: string,
  classId: string,
) {
  const danceClass = await transaction.danceClass.findFirst({
    where: { id: classId, teacherId },
    select: { id: true, status: true },
  });

  if (!danceClass) {
    throw new DanceClassNotFoundError();
  }

  return danceClass;
}

export async function inviteStudentToClass(
  actor: SafeUser,
  classId: string,
  input: InviteStudentInput,
): Promise<PendingInvitation> {
  requireTeacher(actor);
  const id = classIdSchema.parse(classId);
  const values = inviteStudentSchema.parse(input);
  const usernameNormalized = normalizeUsername(values.username);

  try {
    return await db.$transaction(async (transaction) => {
      const danceClass = await requireOwnedClass(transaction, actor.id, id);
      if (danceClass.status === ClassStatus.ARCHIVED) {
        throw new ArchivedClassInvitationError();
      }

      const student = await transaction.user.findUnique({
        where: { usernameNormalized },
        select: {
          id: true,
          username: true,
          role: true,
          disabledAt: true,
        },
      });
      if (!student || student.role !== UserRole.STUDENT || student.disabledAt) {
        throw new InvitationTargetNotFoundError();
      }

      const membership = await transaction.classMembership.findUnique({
        where: { classId_studentId: { classId: id, studentId: student.id } },
        select: { removedAt: true },
      });
      if (membership && membership.removedAt === null) {
        throw new StudentAlreadyMemberError();
      }

      const existing = await transaction.classInvitation.findUnique({
        where: { classId_studentId: { classId: id, studentId: student.id } },
        select: { id: true, status: true },
      });
      if (existing?.status === InvitationStatus.PENDING) {
        throw new InvitationAlreadyPendingError();
      }

      const now = new Date();
      const invitation = existing
        ? await transaction.classInvitation.update({
            where: { id: existing.id },
            data: {
              status: InvitationStatus.PENDING,
              invitedUsernameNormalized: usernameNormalized,
              createdAt: now,
              respondedAt: null,
              canceledAt: null,
              expiresAt: null,
            },
            select: {
              id: true,
              createdAt: true,
              student: { select: { username: true } },
            },
          })
        : await transaction.classInvitation.create({
            data: {
              classId: id,
              studentId: student.id,
              invitedUsernameNormalized: usernameNormalized,
            },
            select: {
              id: true,
              createdAt: true,
              student: { select: { username: true } },
            },
          });

      return {
        id: invitation.id,
        studentUsername: invitation.student.username,
        createdAt: invitation.createdAt,
      };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new InvitationAlreadyPendingError();
    }
    throw error;
  }
}

export async function listPendingClassInvitations(
  actor: SafeUser,
  classId: string,
): Promise<PendingInvitation[]> {
  requireTeacher(actor);
  const id = classIdSchema.parse(classId);

  return db.$transaction(async (transaction) => {
    await requireOwnedClass(transaction, actor.id, id);
    const invitations = await transaction.classInvitation.findMany({
      where: { classId: id, status: InvitationStatus.PENDING },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        student: { select: { username: true } },
      },
    });

    return invitations.map((invitation) => ({
      id: invitation.id,
      studentUsername: invitation.student.username,
      createdAt: invitation.createdAt,
    }));
  });
}

export async function cancelClassInvitation(
  actor: SafeUser,
  classId: string,
  invitationId: string,
) {
  requireTeacher(actor);
  const parsedClassId = classIdSchema.parse(classId);
  const parsedInvitationId = invitationIdSchema.parse(invitationId);

  return db.$transaction(async (transaction) => {
    await requireOwnedClass(transaction, actor.id, parsedClassId);
    const result = await transaction.classInvitation.updateMany({
      where: {
        id: parsedInvitationId,
        classId: parsedClassId,
        status: InvitationStatus.PENDING,
      },
      data: {
        status: InvitationStatus.CANCELED,
        canceledAt: new Date(),
      },
    });

    if (result.count !== 1) {
      throw new InvitationNotFoundError();
    }
  });
}
