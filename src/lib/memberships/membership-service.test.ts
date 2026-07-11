import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ClassStatus,
  InvitationStatus,
  UserRole,
} from "@/generated/prisma/enums";
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
  cancelClassInvitation,
  inviteStudentToClass,
} from "@/lib/invitations/invitation-service";
import {
  acceptClassInvitation,
  declineClassInvitation,
  InvitationUnavailableError,
  listActiveClassMembers,
  listStudentClasses,
  listStudentInvitations,
  MembershipNotFoundError,
  removeStudentFromClass,
  StudentAuthorizationError,
} from "@/lib/memberships/membership-service";

let teacherOne: SafeUser;
let teacherTwo: SafeUser;
let studentOne: SafeUser;
let studentTwo: SafeUser;
const createdUserIds: string[] = [];
let sequence = 0;

function uniqueValue(label: string, maxLength = 30) {
  sequence += 1;
  return `vitest_member_${label}_${Date.now().toString(36)}_${sequence}`.slice(
    0,
    maxLength,
  );
}

async function createActor(role: UserRole, label: string): Promise<SafeUser> {
  const username = uniqueValue(label);
  const user = await db.user.create({
    data: {
      username,
      usernameNormalized: username.toLowerCase(),
      passwordHash: dummyPasswordHash,
      role,
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

describe.sequential("student invitations and class memberships", () => {
  beforeAll(async () => {
    await db.danceClass.deleteMany({
      where: {
        teacher: { usernameNormalized: { startsWith: "vitest_member_" } },
      },
    });
    await db.user.deleteMany({
      where: { usernameNormalized: { startsWith: "vitest_member_" } },
    });

    teacherOne = await createActor(UserRole.TEACHER, "teacher_one");
    teacherTwo = await createActor(UserRole.TEACHER, "teacher_two");
    studentOne = await createActor(UserRole.STUDENT, "student_one");
    studentTwo = await createActor(UserRole.STUDENT, "student_two");
  });

  afterAll(async () => {
    await db.danceClass.deleteMany({
      where: { teacherId: { in: createdUserIds } },
    });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await db.$disconnect();
  });

  it("lists and atomically accepts only the signed-in student's invitation", async () => {
    const danceClass = await createClass("accept");
    const invitation = await inviteStudentToClass(teacherOne, danceClass.id, {
      username: studentOne.username,
    });

    const pending = await listStudentInvitations(studentOne);
    expect(pending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: invitation.id,
          classId: danceClass.id,
          className: danceClass.name,
          teacherUsername: teacherOne.username,
        }),
      ]),
    );
    expect(await listStudentInvitations(studentTwo)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: invitation.id })]),
    );

    await acceptClassInvitation(studentOne, invitation.id);
    const [storedInvitation, membership] = await db.$transaction([
      db.classInvitation.findUniqueOrThrow({ where: { id: invitation.id } }),
      db.classMembership.findUniqueOrThrow({
        where: {
          classId_studentId: {
            classId: danceClass.id,
            studentId: studentOne.id,
          },
        },
      }),
    ]);
    expect(storedInvitation.status).toBe(InvitationStatus.ACCEPTED);
    expect(storedInvitation.respondedAt).toBeInstanceOf(Date);
    expect(membership.removedAt).toBeNull();
    await expect(listStudentClasses(studentOne)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: danceClass.id, name: danceClass.name }),
      ]),
    );
  });

  it("declines without creating a membership", async () => {
    const danceClass = await createClass("decline");
    const invitation = await inviteStudentToClass(teacherOne, danceClass.id, {
      username: studentOne.username,
    });

    await declineClassInvitation(studentOne, invitation.id);
    const stored = await db.classInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(stored.status).toBe(InvitationStatus.DECLINED);
    expect(stored.respondedAt).toBeInstanceOf(Date);
    expect(
      await db.classMembership.count({
        where: { classId: danceClass.id, studentId: studentOne.id },
      }),
    ).toBe(0);
  });

  it("rejects canceled, expired, already-used, and archived stale invitations", async () => {
    const canceledClass = await createClass("stale_cancel");
    const canceled = await inviteStudentToClass(teacherOne, canceledClass.id, {
      username: studentOne.username,
    });
    await cancelClassInvitation(teacherOne, canceledClass.id, canceled.id);
    await expect(
      acceptClassInvitation(studentOne, canceled.id),
    ).rejects.toBeInstanceOf(InvitationUnavailableError);

    const expiredClass = await createClass("stale_expired");
    const expired = await inviteStudentToClass(teacherOne, expiredClass.id, {
      username: studentOne.username,
    });
    await db.classInvitation.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await expect(
      acceptClassInvitation(studentOne, expired.id),
    ).rejects.toBeInstanceOf(InvitationUnavailableError);
    expect(
      (
        await db.classInvitation.findUniqueOrThrow({
          where: { id: expired.id },
        })
      ).status,
    ).toBe(InvitationStatus.EXPIRED);

    const usedClass = await createClass("stale_used");
    const used = await inviteStudentToClass(teacherOne, usedClass.id, {
      username: studentOne.username,
    });
    await acceptClassInvitation(studentOne, used.id);
    await expect(
      acceptClassInvitation(studentOne, used.id),
    ).rejects.toBeInstanceOf(InvitationUnavailableError);

    const archivedClass = await createClass("stale_archived");
    const archived = await inviteStudentToClass(teacherOne, archivedClass.id, {
      username: studentTwo.username,
    });
    await archiveTeacherClass(teacherOne, archivedClass.id);
    await expect(
      declineClassInvitation(studentTwo, archived.id),
    ).rejects.toBeInstanceOf(InvitationUnavailableError);
    expect(archivedClass.status).toBe(ClassStatus.ACTIVE);
  });

  it("removes without deletion and reactivates the same membership", async () => {
    const danceClass = await createClass("reactivate");
    const firstInvitation = await inviteStudentToClass(
      teacherOne,
      danceClass.id,
      { username: studentTwo.username },
    );
    await acceptClassInvitation(studentTwo, firstInvitation.id);
    const original = await db.classMembership.findUniqueOrThrow({
      where: {
        classId_studentId: {
          classId: danceClass.id,
          studentId: studentTwo.id,
        },
      },
    });

    await removeStudentFromClass(teacherOne, danceClass.id, studentTwo.id);
    const removed = await db.classMembership.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(removed.removedAt).toBeInstanceOf(Date);
    expect(await listActiveClassMembers(teacherOne, danceClass.id)).toEqual([]);
    expect(await listStudentClasses(studentTwo)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: danceClass.id })]),
    );

    const secondInvitation = await inviteStudentToClass(
      teacherOne,
      danceClass.id,
      { username: studentTwo.username },
    );
    expect(secondInvitation.id).toBe(firstInvitation.id);
    await acceptClassInvitation(studentTwo, secondInvitation.id);

    const reactivated = await db.classMembership.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(reactivated.id).toBe(original.id);
    expect(reactivated.removedAt).toBeNull();
    await expect(
      listActiveClassMembers(teacherOne, danceClass.id),
    ).resolves.toEqual([
      expect.objectContaining({
        studentId: studentTwo.id,
        username: studentTwo.username,
      }),
    ]);
  });

  it("blocks unauthorized joining and roster changes", async () => {
    const danceClass = await createClass("authorization");
    const invitation = await inviteStudentToClass(teacherOne, danceClass.id, {
      username: studentOne.username,
    });

    await expect(
      acceptClassInvitation(studentTwo, invitation.id),
    ).rejects.toBeInstanceOf(InvitationUnavailableError);
    await expect(
      acceptClassInvitation(teacherOne, invitation.id),
    ).rejects.toBeInstanceOf(StudentAuthorizationError);
    expect(
      await db.classMembership.count({
        where: { classId: danceClass.id, studentId: studentOne.id },
      }),
    ).toBe(0);

    await acceptClassInvitation(studentOne, invitation.id);
    await expect(
      listActiveClassMembers(teacherTwo, danceClass.id),
    ).rejects.toBeInstanceOf(DanceClassNotFoundError);
    await expect(
      removeStudentFromClass(teacherTwo, danceClass.id, studentOne.id),
    ).rejects.toBeInstanceOf(DanceClassNotFoundError);
    await expect(
      removeStudentFromClass(studentOne, danceClass.id, studentOne.id),
    ).rejects.toBeInstanceOf(ClassAuthorizationError);

    await removeStudentFromClass(teacherOne, danceClass.id, studentOne.id);
    await expect(
      removeStudentFromClass(teacherOne, danceClass.id, studentOne.id),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
  });
});
