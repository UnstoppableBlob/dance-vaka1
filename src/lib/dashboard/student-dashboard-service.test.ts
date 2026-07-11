import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AssignmentStatus,
  GradeStatus,
  SubmissionStatus,
  UserRole,
} from "@/generated/prisma/enums";
import { dummyPasswordHash } from "@/lib/auth/password";
import type { SafeUser } from "@/lib/auth/types";
import { db } from "@/lib/db";
import {
  getStudentDashboardOverview,
  getStudentHistoryPage,
  getStudentReleasedGrade,
  StudentDashboardAuthorizationError,
  StudentReleasedGradeNotFoundError,
} from "@/lib/dashboard/student-dashboard-service";

let teacher: SafeUser;
let studentOne: SafeUser;
let studentTwo: SafeUser;
let classId: string;
let releasedGradeId: string;
let draftGradeId: string;
let otherStudentGradeId: string;
const userIds: string[] = [];
let sequence = 0;

function uniqueValue(label: string, maxLength = 100) {
  sequence += 1;
  return `vitest_student_dashboard_${label}_${Date.now().toString(36)}_${sequence}`.slice(
    0,
    maxLength,
  );
}

async function createActor(role: UserRole, label: string): Promise<SafeUser> {
  const username = uniqueValue(label, 40);
  const actor = await db.user.create({
    data: {
      username,
      usernameNormalized: username.toLowerCase(),
      passwordHash: dummyPasswordHash,
      role,
    },
    select: { id: true, username: true, role: true },
  });
  userIds.push(actor.id);
  return actor;
}

describe.sequential("student dashboard and history visibility", () => {
  beforeAll(async () => {
    await db.user.deleteMany({
      where: {
        usernameNormalized: { startsWith: "vitest_student_dashboard_" },
      },
    });
    teacher = await createActor(UserRole.TEACHER, "teacher");
    studentOne = await createActor(UserRole.STUDENT, "student_one");
    studentTwo = await createActor(UserRole.STUDENT, "student_two");

    const danceClass = await db.danceClass.create({
      data: {
        name: uniqueValue("class"),
        nameNormalized: uniqueValue("class_normalized").toLowerCase(),
        teacherId: teacher.id,
      },
    });
    classId = danceClass.id;
    await db.classMembership.createMany({
      data: [
        { classId, studentId: studentOne.id },
        { classId, studentId: studentTwo.id },
      ],
    });

    async function createAssignedWork({
      student,
      label,
      dueAt,
      completedAt,
    }: {
      student: SafeUser;
      label: string;
      dueAt: Date | null;
      completedAt?: Date;
    }) {
      const title = uniqueValue(label);
      const assignment = await db.assignment.create({
        data: {
          classId,
          createdById: teacher.id,
          title,
          titleNormalized: title.toLowerCase(),
          dueAt,
          status: AssignmentStatus.PUBLISHED,
          publishedAt: new Date("2027-01-01T00:00:00.000Z"),
        },
      });
      await db.assignmentStudent.create({
        data: { assignmentId: assignment.id, studentId: student.id },
      });
      const submission = completedAt
        ? await db.submission.create({
            data: {
              assignmentId: assignment.id,
              studentId: student.id,
              status: SubmissionStatus.SUBMITTED,
              submittedAt: completedAt,
              completedAt,
            },
          })
        : null;
      return { assignment, submission };
    }

    await createAssignedWork({
      student: studentOne,
      label: "upcoming",
      dueAt: new Date("2027-03-01T00:00:00.000Z"),
    });
    await createAssignedWork({
      student: studentOne,
      label: "late",
      dueAt: new Date("2027-01-01T00:00:00.000Z"),
    });

    const completedWork = [];
    for (let index = 0; index < 12; index += 1) {
      completedWork.push(
        await createAssignedWork({
          student: studentOne,
          label: `completed_${index}`,
          dueAt: null,
          completedAt: new Date(Date.UTC(2027, 0, index + 1)),
        }),
      );
    }

    const released = await db.grade.create({
      data: {
        submissionId: completedWork[11].submission!.id,
        teacherId: teacher.id,
        status: GradeStatus.RELEASED,
        automatedOverall: 90,
        finalScore: 92,
        feedback: "Good control.",
        releasedAt: new Date("2027-02-01T00:00:00.000Z"),
      },
    });
    releasedGradeId = released.id;

    const draft = await db.grade.create({
      data: {
        submissionId: completedWork[10].submission!.id,
        teacherId: teacher.id,
        status: GradeStatus.DRAFT,
        finalScore: 61,
        feedback: "This must remain private.",
      },
    });
    draftGradeId = draft.id;

    const otherWork = await createAssignedWork({
      student: studentTwo,
      label: "other_student",
      dueAt: null,
      completedAt: new Date("2027-01-20T00:00:00.000Z"),
    });
    const otherGrade = await db.grade.create({
      data: {
        submissionId: otherWork.submission!.id,
        teacherId: teacher.id,
        status: GradeStatus.RELEASED,
        finalScore: 99,
        releasedAt: new Date("2027-02-02T00:00:00.000Z"),
      },
    });
    otherStudentGradeId = otherGrade.id;
  });

  afterAll(async () => {
    await db.danceClass.deleteMany({ where: { id: classId } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it("categorizes only the signed-in student's assignments and released grades", async () => {
    const overview = await getStudentDashboardOverview(
      studentOne,
      new Date("2027-02-01T12:00:00.000Z"),
    );

    expect(overview.upcomingAssignments).toHaveLength(1);
    expect(overview.upcomingAssignments[0]).toMatchObject({
      status: "NOT_STARTED",
    });
    expect(overview.lateAssignments).toHaveLength(1);
    expect(overview.lateAssignments[0]).toMatchObject({ status: "LATE" });
    expect(overview.completedAssignments).toHaveLength(5);
    expect(
      overview.completedAssignments.every(
        (item) => item.status === "COMPLETED",
      ),
    ).toBe(true);
    expect(overview.releasedGrades).toEqual([
      expect.objectContaining({ id: releasedGradeId, finalScore: 92 }),
    ]);
    expect(JSON.stringify(overview)).not.toContain("other_student");
    expect(JSON.stringify(overview)).not.toContain("This must remain private");
  });

  it("paginates completed work and exposes only released grade summaries", async () => {
    const firstPage = await getStudentHistoryPage(studentOne, 1);
    const secondPage = await getStudentHistoryPage(studentOne, 2);
    const allItems = [...firstPage.items, ...secondPage.items];

    expect(firstPage).toMatchObject({
      page: 1,
      pageSize: 10,
      totalItems: 12,
      totalPages: 2,
    });
    expect(firstPage.items).toHaveLength(10);
    expect(secondPage.items).toHaveLength(2);
    expect(allItems.filter((item) => item.releasedGrade)).toEqual([
      expect.objectContaining({
        releasedGrade: expect.objectContaining({ id: releasedGradeId }),
      }),
    ]);
    expect(JSON.stringify(allItems)).not.toContain(draftGradeId);
    expect(JSON.stringify(allItems)).not.toContain(otherStudentGradeId);
  });

  it("returns only the signed-in student's released grade detail", async () => {
    await expect(
      getStudentReleasedGrade(studentOne, releasedGradeId),
    ).resolves.toMatchObject({
      id: releasedGradeId,
      finalScore: 92,
      feedback: "Good control.",
    });
    await expect(
      getStudentReleasedGrade(studentOne, draftGradeId),
    ).rejects.toBeInstanceOf(StudentReleasedGradeNotFoundError);
    await expect(
      getStudentReleasedGrade(studentOne, otherStudentGradeId),
    ).rejects.toBeInstanceOf(StudentReleasedGradeNotFoundError);
  });

  it("denies teacher access to all student dashboard queries", async () => {
    await expect(getStudentDashboardOverview(teacher)).rejects.toBeInstanceOf(
      StudentDashboardAuthorizationError,
    );
    await expect(getStudentHistoryPage(teacher, 1)).rejects.toBeInstanceOf(
      StudentDashboardAuthorizationError,
    );
    await expect(
      getStudentReleasedGrade(teacher, releasedGradeId),
    ).rejects.toBeInstanceOf(StudentDashboardAuthorizationError);
  });
});
