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
import { invitationIdSchema } from "@/lib/invitations/validation";
import type {
  ClassRosterMember,
  StudentClassSummary,
  StudentInvitation,
} from "@/lib/memberships/types";
import { z } from "zod";

const studentIdSchema = z.uuid("Invalid student ID.");

export class StudentAuthorizationError extends Error {
  constructor() {
    super("Only students can respond to class invitations.");
    this.name = "StudentAuthorizationError";
  }
}

export class InvitationUnavailableError extends Error {
  constructor() {
    super("This invitation is no longer available.");
    this.name = "InvitationUnavailableError";
  }
}

export class MembershipNotFoundError extends Error {
  constructor() {
    super("Active class membership not found.");
    this.name = "MembershipNotFoundError";
  }
}

function requireStudent(actor: SafeUser) {
  if (actor.role !== UserRole.STUDENT) {
    throw new StudentAuthorizationError();
  }
}

function requireTeacher(actor: SafeUser) {
  if (actor.role !== UserRole.TEACHER) {
    throw new ClassAuthorizationError();
  }
}

async function requireOwnedClass(
  transaction: Prisma.TransactionClient,
  teacherId: string,
  classId: string,
) {
  const danceClass = await transaction.danceClass.findFirst({
    where: { id: classId, teacherId },
    select: { id: true },
  });
  if (!danceClass) {
    throw new DanceClassNotFoundError();
  }
}

export async function listStudentInvitations(
  actor: SafeUser,
): Promise<StudentInvitation[]> {
  requireStudent(actor);
  const now = new Date();
  const invitations = await db.classInvitation.findMany({
    where: {
      studentId: actor.id,
      status: InvitationStatus.PENDING,
      danceClass: { status: ClassStatus.ACTIVE },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      classId: true,
      createdAt: true,
      expiresAt: true,
      danceClass: {
        select: {
          name: true,
          teacher: { select: { username: true } },
        },
      },
    },
  });

  return invitations.map((invitation) => ({
    id: invitation.id,
    classId: invitation.classId,
    className: invitation.danceClass.name,
    teacherUsername: invitation.danceClass.teacher.username,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
  }));
}

export async function acceptClassInvitation(
  actor: SafeUser,
  invitationId: string,
) {
  requireStudent(actor);
  const id = invitationIdSchema.parse(invitationId);
  const now = new Date();

  const accepted = await db.$transaction(async (transaction) => {
    const invitation = await transaction.classInvitation.findFirst({
      where: { id, studentId: actor.id },
      select: {
        id: true,
        classId: true,
        status: true,
        expiresAt: true,
        danceClass: { select: { status: true } },
      },
    });
    if (
      !invitation ||
      invitation.status !== InvitationStatus.PENDING ||
      invitation.danceClass.status !== ClassStatus.ACTIVE
    ) {
      return false;
    }

    if (invitation.expiresAt && invitation.expiresAt <= now) {
      await transaction.classInvitation.updateMany({
        where: { id, studentId: actor.id, status: InvitationStatus.PENDING },
        data: { status: InvitationStatus.EXPIRED, respondedAt: now },
      });
      return false;
    }

    const updated = await transaction.classInvitation.updateMany({
      where: { id, studentId: actor.id, status: InvitationStatus.PENDING },
      data: {
        status: InvitationStatus.ACCEPTED,
        respondedAt: now,
        canceledAt: null,
      },
    });
    if (updated.count !== 1) {
      return false;
    }

    await transaction.classMembership.upsert({
      where: {
        classId_studentId: {
          classId: invitation.classId,
          studentId: actor.id,
        },
      },
      create: {
        classId: invitation.classId,
        studentId: actor.id,
        joinedAt: now,
      },
      update: { joinedAt: now, removedAt: null },
    });
    return true;
  });

  if (!accepted) {
    throw new InvitationUnavailableError();
  }
}

export async function declineClassInvitation(
  actor: SafeUser,
  invitationId: string,
) {
  requireStudent(actor);
  const id = invitationIdSchema.parse(invitationId);
  const now = new Date();

  const declined = await db.$transaction(async (transaction) => {
    const invitation = await transaction.classInvitation.findFirst({
      where: { id, studentId: actor.id },
      select: {
        status: true,
        expiresAt: true,
        danceClass: { select: { status: true } },
      },
    });
    if (
      !invitation ||
      invitation.status !== InvitationStatus.PENDING ||
      invitation.danceClass.status !== ClassStatus.ACTIVE
    ) {
      return false;
    }
    if (invitation.expiresAt && invitation.expiresAt <= now) {
      await transaction.classInvitation.updateMany({
        where: { id, studentId: actor.id, status: InvitationStatus.PENDING },
        data: { status: InvitationStatus.EXPIRED, respondedAt: now },
      });
      return false;
    }

    const updated = await transaction.classInvitation.updateMany({
      where: { id, studentId: actor.id, status: InvitationStatus.PENDING },
      data: { status: InvitationStatus.DECLINED, respondedAt: now },
    });
    return updated.count === 1;
  });

  if (!declined) {
    throw new InvitationUnavailableError();
  }
}

export async function listStudentClasses(
  actor: SafeUser,
): Promise<StudentClassSummary[]> {
  requireStudent(actor);
  const memberships = await db.classMembership.findMany({
    where: { studentId: actor.id, removedAt: null },
    orderBy: { joinedAt: "desc" },
    select: {
      joinedAt: true,
      danceClass: {
        select: {
          id: true,
          name: true,
          status: true,
          teacher: { select: { username: true } },
        },
      },
    },
  });

  return memberships.map(({ danceClass, joinedAt }) => ({
    id: danceClass.id,
    name: danceClass.name,
    status: danceClass.status,
    teacherUsername: danceClass.teacher.username,
    joinedAt,
  }));
}

export async function listActiveClassMembers(
  actor: SafeUser,
  classId: string,
): Promise<ClassRosterMember[]> {
  requireTeacher(actor);
  const id = classIdSchema.parse(classId);

  return db.$transaction(async (transaction) => {
    await requireOwnedClass(transaction, actor.id, id);
    const memberships = await transaction.classMembership.findMany({
      where: { classId: id, removedAt: null },
      orderBy: { student: { usernameNormalized: "asc" } },
      select: {
        studentId: true,
        joinedAt: true,
        student: { select: { username: true } },
      },
    });
    return memberships.map((membership) => ({
      studentId: membership.studentId,
      username: membership.student.username,
      joinedAt: membership.joinedAt,
    }));
  });
}

export async function removeStudentFromClass(
  actor: SafeUser,
  classId: string,
  studentId: string,
) {
  requireTeacher(actor);
  const parsedClassId = classIdSchema.parse(classId);
  const parsedStudentId = studentIdSchema.parse(studentId);

  return db.$transaction(async (transaction) => {
    await requireOwnedClass(transaction, actor.id, parsedClassId);
    const removed = await transaction.classMembership.updateMany({
      where: {
        classId: parsedClassId,
        studentId: parsedStudentId,
        removedAt: null,
      },
      data: { removedAt: new Date() },
    });
    if (removed.count !== 1) {
      throw new MembershipNotFoundError();
    }
  });
}
