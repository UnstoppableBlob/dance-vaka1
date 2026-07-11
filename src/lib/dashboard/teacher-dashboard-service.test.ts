import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AssignmentStatus,
  GradeStatus,
  InvitationStatus,
  SubmissionStatus,
  UserRole,
} from "@/generated/prisma/enums";
import { dummyPasswordHash } from "@/lib/auth/password";
import type { SafeUser } from "@/lib/auth/types";
import {
  archiveTeacherClass,
  ClassAuthorizationError,
  createTeacherClass,
} from "@/lib/classes/class-service";
import {
  getTeacherDashboardOverview,
  getTeacherSubmissionDetail,
  TeacherSubmissionNotFoundError,
} from "@/lib/dashboard/teacher-dashboard-service";
import { db } from "@/lib/db";

let teacherOne: SafeUser;
let teacherTwo: SafeUser;
let studentOne: SafeUser;
let studentTwo: SafeUser;
const createdUserIds: string[] = [];
let sequence = 0;

function uniqueValue(label: string, maxLength = 30) {
  sequence += 1;
  return `vitest_dash_${label}_${Date.now().toString(36)}_${sequence}`.slice(
    0,
    maxLength,
  );
}

async function createActor(role: UserRole, label: string): Promise<SafeUser> {
  const username = uniqueValue(label);
  const actor = await db.user.create({
    data: {
      username,
      usernameNormalized: username.toLowerCase(),
      passwordHash: dummyPasswordHash,
      role,
    },
    select: { id: true, username: true, role: true },
  });
  createdUserIds.push(actor.id);
  return actor;
}

async function createPublishedAssignment(
  teacher: SafeUser,
  classId: string,
  label: string,
) {
  return db.assignment.create({
    data: {
      classId,
      createdById: teacher.id,
      title: uniqueValue(label, 100),
      titleNormalized: uniqueValue(`${label}_normalized`, 100).toLowerCase(),
      status: AssignmentStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  });
}

describe.sequential("teacher dashboard overview", () => {
  let activeClassId: string;
  let archivedClassId: string;
  let otherClassId: string;
  let pendingInvitationId: string;
  let teacherAssignmentId: string;
  let otherAssignmentId: string;
  let needsReviewSubmissionId: string;
  let gradedSubmissionId: string;
  let otherSubmissionId: string;

  beforeAll(async () => {
    await db.danceClass.deleteMany({
      where: {
        teacher: { usernameNormalized: { startsWith: "vitest_dash_" } },
      },
    });
    await db.user.deleteMany({
      where: { usernameNormalized: { startsWith: "vitest_dash_" } },
    });
    teacherOne = await createActor(UserRole.TEACHER, "teacher_one");
    teacherTwo = await createActor(UserRole.TEACHER, "teacher_two");
    studentOne = await createActor(UserRole.STUDENT, "student_one");
    studentTwo = await createActor(UserRole.STUDENT, "student_two");

    const activeClass = await createTeacherClass(teacherOne, {
      name: uniqueValue("active_class", 100),
      description: "Teacher one active class",
    });
    const archivedClass = await createTeacherClass(teacherOne, {
      name: uniqueValue("archived_class", 100),
      description: "",
    });
    const otherClass = await createTeacherClass(teacherTwo, {
      name: uniqueValue("other_class", 100),
      description: "",
    });
    await archiveTeacherClass(teacherOne, archivedClass.id);
    activeClassId = activeClass.id;
    archivedClassId = archivedClass.id;
    otherClassId = otherClass.id;

    await db.classMembership.createMany({
      data: [
        { classId: activeClass.id, studentId: studentOne.id },
        { classId: activeClass.id, studentId: studentTwo.id },
      ],
    });
    const invitation = await db.classInvitation.create({
      data: {
        classId: activeClass.id,
        studentId: studentOne.id,
        invitedUsernameNormalized: studentOne.username.toLowerCase(),
        status: InvitationStatus.PENDING,
      },
    });
    pendingInvitationId = invitation.id;
    await db.classInvitation.create({
      data: {
        classId: otherClass.id,
        studentId: studentOne.id,
        invitedUsernameNormalized: studentOne.username.toLowerCase(),
        status: InvitationStatus.PENDING,
      },
    });

    const teacherAssignment = await createPublishedAssignment(
      teacherOne,
      activeClass.id,
      "teacher_assignment",
    );
    const otherAssignment = await createPublishedAssignment(
      teacherTwo,
      otherClass.id,
      "other_assignment",
    );
    teacherAssignmentId = teacherAssignment.id;
    otherAssignmentId = otherAssignment.id;
    await db.assignmentStudent.createMany({
      data: [
        { assignmentId: teacherAssignment.id, studentId: studentOne.id },
        { assignmentId: teacherAssignment.id, studentId: studentTwo.id },
        { assignmentId: otherAssignment.id, studentId: studentOne.id },
      ],
    });

    const needsReview = await db.submission.create({
      data: {
        assignmentId: teacherAssignment.id,
        studentId: studentOne.id,
        status: SubmissionStatus.SUBMITTED,
        submittedAt: new Date("2026-12-02T12:00:00.000Z"),
        completedAt: new Date("2026-12-02T12:00:00.000Z"),
      },
    });
    const graded = await db.submission.create({
      data: {
        assignmentId: teacherAssignment.id,
        studentId: studentTwo.id,
        status: SubmissionStatus.SUBMITTED,
        submittedAt: new Date("2026-12-03T12:00:00.000Z"),
        completedAt: new Date("2026-12-03T12:00:00.000Z"),
      },
    });
    const otherSubmission = await db.submission.create({
      data: {
        assignmentId: otherAssignment.id,
        studentId: studentOne.id,
        status: SubmissionStatus.SUBMITTED,
        submittedAt: new Date("2026-12-04T12:00:00.000Z"),
        completedAt: new Date("2026-12-04T12:00:00.000Z"),
      },
    });
    needsReviewSubmissionId = needsReview.id;
    gradedSubmissionId = graded.id;
    otherSubmissionId = otherSubmission.id;
    await db.grade.createMany({
      data: [
        {
          submissionId: graded.id,
          teacherId: teacherOne.id,
          status: GradeStatus.DRAFT,
        },
        {
          submissionId: otherSubmission.id,
          teacherId: teacherTwo.id,
          status: GradeStatus.DRAFT,
        },
      ],
    });
  });

  afterAll(async () => {
    await db.danceClass.deleteMany({
      where: { teacherId: { in: createdUserIds } },
    });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await db.$disconnect();
  });

  it("scopes every dashboard list and count to the signed-in teacher", async () => {
    const overview = await getTeacherDashboardOverview(teacherOne);

    expect(overview.classes.map(({ id }) => id).sort()).toEqual(
      [activeClassId, archivedClassId].sort(),
    );
    expect(overview.classes.some(({ id }) => id === otherClassId)).toBe(false);
    expect(overview.pendingInvitationCount).toBe(1);
    expect(overview.pendingInvitations).toEqual([
      expect.objectContaining({
        id: pendingInvitationId,
        classId: activeClassId,
        studentUsername: studentOne.username,
      }),
    ]);

    expect(overview.assignmentProgress).toEqual([
      expect.objectContaining({
        id: teacherAssignmentId,
        recipientCount: 2,
        completedCount: 2,
      }),
    ]);
    expect(
      overview.assignmentProgress.some(({ id }) => id === otherAssignmentId),
    ).toBe(false);

    expect(overview.recentSubmissions.map(({ id }) => id).sort()).toEqual(
      [needsReviewSubmissionId, gradedSubmissionId].sort(),
    );
    expect(
      overview.recentSubmissions.some(({ id }) => id === otherSubmissionId),
    ).toBe(false);
    expect(overview.needsReviewCount).toBe(1);
    expect(overview.needsReview).toEqual([
      expect.objectContaining({ id: needsReviewSubmissionId }),
    ]);
  });

  it("returns only owned submission details and rejects cross-teacher access", async () => {
    await expect(
      getTeacherSubmissionDetail(teacherOne, needsReviewSubmissionId),
    ).resolves.toMatchObject({
      id: needsReviewSubmissionId,
      classId: activeClassId,
      gradeStatus: null,
    });
    await expect(
      getTeacherSubmissionDetail(teacherOne, gradedSubmissionId),
    ).resolves.toMatchObject({ gradeStatus: GradeStatus.DRAFT });
    await expect(
      getTeacherSubmissionDetail(teacherTwo, needsReviewSubmissionId),
    ).rejects.toBeInstanceOf(TeacherSubmissionNotFoundError);
    await expect(
      getTeacherSubmissionDetail(teacherOne, otherSubmissionId),
    ).rejects.toBeInstanceOf(TeacherSubmissionNotFoundError);
  });

  it("rejects dashboard and submission access by students", async () => {
    await expect(
      getTeacherDashboardOverview(studentOne),
    ).rejects.toBeInstanceOf(ClassAuthorizationError);
    await expect(
      getTeacherSubmissionDetail(studentOne, needsReviewSubmissionId),
    ).rejects.toBeInstanceOf(ClassAuthorizationError);
  });
});
