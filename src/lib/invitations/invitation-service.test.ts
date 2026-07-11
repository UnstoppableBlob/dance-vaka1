import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { InvitationStatus, UserRole } from "@/generated/prisma/enums";
import { dummyPasswordHash } from "@/lib/auth/password";
import type { SafeUser } from "@/lib/auth/types";
import {
  archiveTeacherClass,
  ClassAuthorizationError,
  createTeacherClass,
  DanceClassNotFoundError,
} from "@/lib/classes/class-service";
import { db } from "@/lib/db";
import {
  ArchivedClassInvitationError,
  cancelClassInvitation,
  InvitationAlreadyPendingError,
  InvitationNotFoundError,
  InvitationTargetNotFoundError,
  inviteStudentToClass,
  listPendingClassInvitations,
  StudentAlreadyMemberError,
} from "@/lib/invitations/invitation-service";

let teacherOne: SafeUser;
let teacherTwo: SafeUser;
let studentOne: SafeUser;
let studentTwo: SafeUser;
let disabledStudent: SafeUser;
const createdUserIds: string[] = [];
let sequence = 0;

function uniqueValue(label: string, maxLength = 30) {
  sequence += 1;
  return `vitest_invite_${label}_${Date.now().toString(36)}_${sequence}`.slice(
    0,
    maxLength,
  );
}

async function createActor(
  role: UserRole,
  label: string,
  disabled = false,
): Promise<SafeUser> {
  const username = uniqueValue(label);
  const user = await db.user.create({
    data: {
      username,
      usernameNormalized: username.toLowerCase(),
      passwordHash: dummyPasswordHash,
      role,
      disabledAt: disabled ? new Date() : null,
    },
    select: { id: true, username: true, role: true },
  });
  createdUserIds.push(user.id);
  return user;
}

async function createClass(label: string) {
  return createTeacherClass(teacherOne, {
    name: uniqueValue(label, 100),
    description: "",
  });
}

describe.sequential("teacher-side class invitations", () => {
  beforeAll(async () => {
    await db.danceClass.deleteMany({
      where: {
        teacher: { usernameNormalized: { startsWith: "vitest_invite_" } },
      },
    });
    await db.user.deleteMany({
      where: { usernameNormalized: { startsWith: "vitest_invite_" } },
    });

    teacherOne = await createActor(UserRole.TEACHER, "teacher_one");
    teacherTwo = await createActor(UserRole.TEACHER, "teacher_two");
    studentOne = await createActor(UserRole.STUDENT, "student_one");
    studentTwo = await createActor(UserRole.STUDENT, "student_two");
    disabledStudent = await createActor(UserRole.STUDENT, "disabled", true);
  });

  afterAll(async () => {
    await db.danceClass.deleteMany({
      where: { teacherId: { in: createdUserIds } },
    });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await db.$disconnect();
  });

  it("invites an existing student by exact username case-insensitively", async () => {
    const danceClass = await createClass("exact");
    const invitation = await inviteStudentToClass(teacherOne, danceClass.id, {
      username: studentOne.username.toUpperCase(),
    });
    const stored = await db.classInvitation.findUniqueOrThrow({
      where: {
        classId_studentId: {
          classId: danceClass.id,
          studentId: studentOne.id,
        },
      },
    });

    expect(invitation.studentUsername).toBe(studentOne.username);
    expect(stored.status).toBe(InvitationStatus.PENDING);
    expect(stored.invitedUsernameNormalized).toBe(
      studentOne.username.toLowerCase(),
    );
  });

  it("uses one privacy-safe error for missing, teacher, and disabled accounts", async () => {
    const danceClass = await createClass("ineligible");

    await expect(
      inviteStudentToClass(teacherOne, danceClass.id, {
        username: "missing_student_account",
      }),
    ).rejects.toBeInstanceOf(InvitationTargetNotFoundError);
    await expect(
      inviteStudentToClass(teacherOne, danceClass.id, {
        username: teacherTwo.username,
      }),
    ).rejects.toBeInstanceOf(InvitationTargetNotFoundError);
    await expect(
      inviteStudentToClass(teacherOne, danceClass.id, {
        username: disabledStudent.username,
      }),
    ).rejects.toBeInstanceOf(InvitationTargetNotFoundError);
  });

  it("prevents duplicate pending invitations", async () => {
    const danceClass = await createClass("duplicate");
    await inviteStudentToClass(teacherOne, danceClass.id, {
      username: studentOne.username,
    });

    await expect(
      inviteStudentToClass(teacherOne, danceClass.id, {
        username: studentOne.username,
      }),
    ).rejects.toBeInstanceOf(InvitationAlreadyPendingError);
    expect(
      await db.classInvitation.count({
        where: { classId: danceClass.id, studentId: studentOne.id },
      }),
    ).toBe(1);
  });

  it("does not invite an actively enrolled student", async () => {
    const danceClass = await createClass("member");
    await db.classMembership.create({
      data: { classId: danceClass.id, studentId: studentTwo.id },
    });

    await expect(
      inviteStudentToClass(teacherOne, danceClass.id, {
        username: studentTwo.username,
      }),
    ).rejects.toBeInstanceOf(StudentAlreadyMemberError);
  });

  it("lists, cancels, and safely reuses a historical invitation", async () => {
    const danceClass = await createClass("cancel");
    const first = await inviteStudentToClass(teacherOne, danceClass.id, {
      username: studentTwo.username,
    });

    await expect(
      listPendingClassInvitations(teacherOne, danceClass.id),
    ).resolves.toEqual([first]);
    await cancelClassInvitation(teacherOne, danceClass.id, first.id);

    const canceled = await db.classInvitation.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(canceled.status).toBe(InvitationStatus.CANCELED);
    expect(canceled.canceledAt).toBeInstanceOf(Date);
    await expect(
      listPendingClassInvitations(teacherOne, danceClass.id),
    ).resolves.toEqual([]);
    await expect(
      cancelClassInvitation(teacherOne, danceClass.id, first.id),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);

    const reinvited = await inviteStudentToClass(teacherOne, danceClass.id, {
      username: studentTwo.username,
    });
    expect(reinvited.id).toBe(first.id);
    expect(reinvited.createdAt.getTime()).toBeGreaterThanOrEqual(
      first.createdAt.getTime(),
    );
  });

  it("blocks invitation access through another teacher or a student", async () => {
    const danceClass = await createClass("private");
    const invitation = await inviteStudentToClass(teacherOne, danceClass.id, {
      username: studentOne.username,
    });

    await expect(
      listPendingClassInvitations(teacherTwo, danceClass.id),
    ).rejects.toBeInstanceOf(DanceClassNotFoundError);
    await expect(
      inviteStudentToClass(teacherTwo, danceClass.id, {
        username: studentTwo.username,
      }),
    ).rejects.toBeInstanceOf(DanceClassNotFoundError);
    await expect(
      cancelClassInvitation(teacherTwo, danceClass.id, invitation.id),
    ).rejects.toBeInstanceOf(DanceClassNotFoundError);
    await expect(
      inviteStudentToClass(studentOne, danceClass.id, {
        username: studentTwo.username,
      }),
    ).rejects.toBeInstanceOf(ClassAuthorizationError);
  });

  it("does not send new invitations from archived classes", async () => {
    const danceClass = await createClass("archived");
    await archiveTeacherClass(teacherOne, danceClass.id);

    await expect(
      inviteStudentToClass(teacherOne, danceClass.id, {
        username: studentOne.username,
      }),
    ).rejects.toBeInstanceOf(ArchivedClassInvitationError);
  });
});
