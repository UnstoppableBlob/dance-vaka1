import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AssignmentStatus,
  MediaAssetKind,
  MediaAssetStatus,
  UserRole,
} from "@/generated/prisma/enums";
import {
  ArchivedClassAssignmentError,
  AssignmentNotPublishableError,
  AssignmentPublishReferenceRequiredError,
  createAssignmentDraft,
  deriveStudentAssignmentStatus,
  listStudentAssignments,
  publishAssignmentDraft,
  StudentAssignmentAuthorizationError,
} from "@/lib/assignments/assignment-service";
import { dummyPasswordHash } from "@/lib/auth/password";
import type { SafeUser } from "@/lib/auth/types";
import {
  archiveTeacherClass,
  ClassAuthorizationError,
  createTeacherClass,
  DanceClassNotFoundError,
} from "@/lib/classes/class-service";
import { db } from "@/lib/db";

let teacherOne: SafeUser;
let teacherTwo: SafeUser;
let studentOne: SafeUser;
let studentTwo: SafeUser;
let studentThree: SafeUser;
const createdUserIds: string[] = [];
let sequence = 0;

function uniqueValue(label: string, maxLength = 30) {
  sequence += 1;
  return `vitest_publish_${label}_${Date.now().toString(36)}_${sequence}`.slice(
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

async function createClass(label: string) {
  return createTeacherClass(teacherOne, {
    name: uniqueValue(label, 100),
    description: "",
  });
}

async function createReadyReference() {
  return db.mediaAsset.create({
    data: {
      ownerId: teacherOne.id,
      kind: MediaAssetKind.REFERENCE_VIDEO,
      status: MediaAssetStatus.READY,
      bucket: "publish-test-bucket",
      objectKey: `publish-tests/${uniqueValue("object", 80)}.webm`,
      originalFilename: "reference.webm",
      contentType: "video/webm",
      byteSize: BigInt(1024),
      uploadedAt: new Date(),
    },
  });
}

async function createPublishableDraft(
  classId: string,
  options: { dueAt?: Date | null; title?: string } = {},
) {
  const reference = await createReadyReference();
  return createAssignmentDraft(teacherOne, classId, {
    title: options.title ?? uniqueValue("draft", 100),
    instructions: null,
    dueAt: options.dueAt ?? null,
    referenceVideoAssetId: reference.id,
  });
}

describe.sequential("assignment publishing and student visibility", () => {
  beforeAll(async () => {
    await db.danceClass.deleteMany({
      where: {
        teacher: { usernameNormalized: { startsWith: "vitest_publish_" } },
      },
    });
    await db.mediaAsset.deleteMany({
      where: {
        owner: { usernameNormalized: { startsWith: "vitest_publish_" } },
      },
    });
    await db.user.deleteMany({
      where: { usernameNormalized: { startsWith: "vitest_publish_" } },
    });
    teacherOne = await createActor(UserRole.TEACHER, "teacher_one");
    teacherTwo = await createActor(UserRole.TEACHER, "teacher_two");
    studentOne = await createActor(UserRole.STUDENT, "student_one");
    studentTwo = await createActor(UserRole.STUDENT, "student_two");
    studentThree = await createActor(UserRole.STUDENT, "student_three");
  });

  afterAll(async () => {
    await db.danceClass.deleteMany({
      where: { teacherId: { in: createdUserIds } },
    });
    await db.mediaAsset.deleteMany({
      where: { ownerId: { in: createdUserIds } },
    });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await db.$disconnect();
  });

  it("requires a ready reference video and leaves an invalid draft unchanged", async () => {
    const danceClass = await createClass("requirements");
    const noVideo = await createAssignmentDraft(teacherOne, danceClass.id, {
      title: uniqueValue("no_video", 100),
      instructions: null,
      dueAt: null,
      referenceVideoAssetId: null,
    });
    await expect(
      publishAssignmentDraft(teacherOne, danceClass.id, noVideo.id),
    ).rejects.toBeInstanceOf(AssignmentPublishReferenceRequiredError);

    const withVideo = await createPublishableDraft(danceClass.id);
    await db.mediaAsset.update({
      where: { id: withVideo.referenceVideo!.id },
      data: { status: MediaAssetStatus.DELETED, deletedAt: new Date() },
    });
    await expect(
      publishAssignmentDraft(teacherOne, danceClass.id, withVideo.id),
    ).rejects.toBeInstanceOf(AssignmentPublishReferenceRequiredError);

    const stored = await db.assignment.findMany({
      where: { id: { in: [noVideo.id, withVideo.id] } },
      select: { status: true, publishedAt: true },
    });
    expect(stored).toEqual([
      { status: AssignmentStatus.DRAFT, publishedAt: null },
      { status: AssignmentStatus.DRAFT, publishedAt: null },
    ]);
  });

  it("atomically publishes and snapshots only active class members", async () => {
    const danceClass = await createClass("snapshot");
    await db.classMembership.createMany({
      data: [
        { classId: danceClass.id, studentId: studentOne.id },
        { classId: danceClass.id, studentId: studentTwo.id },
        {
          classId: danceClass.id,
          studentId: studentThree.id,
          removedAt: new Date(),
        },
      ],
    });
    const draft = await createPublishableDraft(danceClass.id);
    const published = await publishAssignmentDraft(
      teacherOne,
      danceClass.id,
      draft.id,
    );
    const recipients = await db.assignmentStudent.findMany({
      where: { assignmentId: draft.id },
      orderBy: { studentId: "asc" },
    });

    expect(published.status).toBe(AssignmentStatus.PUBLISHED);
    expect(published.publishedAt).toBeInstanceOf(Date);
    expect(published.recipientCount).toBe(2);
    expect(recipients.map(({ studentId }) => studentId).sort()).toEqual(
      [studentOne.id, studentTwo.id].sort(),
    );
    expect(
      recipients.every(
        ({ assignedAt }) =>
          assignedAt.getTime() === published.publishedAt?.getTime(),
      ),
    ).toBe(true);
    await expect(
      publishAssignmentDraft(teacherOne, danceClass.id, draft.id),
    ).rejects.toBeInstanceOf(AssignmentNotPublishableError);
  });

  it("keeps the recipient snapshot unchanged after roster changes", async () => {
    const danceClass = await createClass("immutable");
    await db.classMembership.create({
      data: { classId: danceClass.id, studentId: studentOne.id },
    });
    const draft = await createPublishableDraft(danceClass.id);
    await publishAssignmentDraft(teacherOne, danceClass.id, draft.id);

    await db.$transaction([
      db.classMembership.update({
        where: {
          classId_studentId: {
            classId: danceClass.id,
            studentId: studentOne.id,
          },
        },
        data: { removedAt: new Date() },
      }),
      db.classMembership.create({
        data: { classId: danceClass.id, studentId: studentThree.id },
      }),
    ]);

    expect(
      await db.assignmentStudent.findMany({
        where: { assignmentId: draft.id },
        select: { studentId: true },
      }),
    ).toEqual([{ studentId: studentOne.id }]);
    await expect(listStudentAssignments(studentOne)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: draft.id })]),
    );
    expect(await listStudentAssignments(studentThree)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: draft.id })]),
    );
  });

  it("shows only published recipient work and derives Not started and Late", async () => {
    const danceClass = await createClass("visibility");
    await db.classMembership.create({
      data: { classId: danceClass.id, studentId: studentTwo.id },
    });
    const now = new Date("2026-10-15T12:00:00.000Z");
    const future = await createPublishableDraft(danceClass.id, {
      title: uniqueValue("future", 100),
      dueAt: new Date("2026-10-16T12:00:00.000Z"),
    });
    const late = await createPublishableDraft(danceClass.id, {
      title: uniqueValue("late", 100),
      dueAt: new Date("2026-10-14T12:00:00.000Z"),
    });
    const hiddenDraft = await createPublishableDraft(danceClass.id, {
      title: uniqueValue("hidden", 100),
    });
    await publishAssignmentDraft(teacherOne, danceClass.id, future.id);
    await publishAssignmentDraft(teacherOne, danceClass.id, late.id);

    const visible = await listStudentAssignments(studentTwo, now);
    expect(visible).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: future.id, status: "NOT_STARTED" }),
        expect.objectContaining({ id: late.id, status: "LATE" }),
      ]),
    );
    expect(visible).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: hiddenDraft.id })]),
    );
    expect(await listStudentAssignments(studentOne, now)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: future.id })]),
    );
  });

  it("derives progress and completion without overriding completion as late", () => {
    const dueAt = new Date("2026-10-14T12:00:00.000Z");
    const now = new Date("2026-10-15T12:00:00.000Z");
    expect(
      deriveStudentAssignmentStatus({
        dueAt: null,
        hasSubmission: true,
        completedAt: null,
        now,
      }),
    ).toBe("IN_PROGRESS");
    expect(
      deriveStudentAssignmentStatus({
        dueAt,
        hasSubmission: true,
        completedAt: new Date("2026-10-15T13:00:00.000Z"),
        now,
      }),
    ).toBe("COMPLETED");
  });

  it("blocks publication by another teacher or student and from archived classes", async () => {
    const danceClass = await createClass("authorization");
    const draft = await createPublishableDraft(danceClass.id);
    await expect(
      publishAssignmentDraft(teacherTwo, danceClass.id, draft.id),
    ).rejects.toBeInstanceOf(DanceClassNotFoundError);
    await expect(
      publishAssignmentDraft(studentOne, danceClass.id, draft.id),
    ).rejects.toBeInstanceOf(ClassAuthorizationError);
    await expect(listStudentAssignments(teacherOne)).rejects.toBeInstanceOf(
      StudentAssignmentAuthorizationError,
    );

    await archiveTeacherClass(teacherOne, danceClass.id);
    await expect(
      publishAssignmentDraft(teacherOne, danceClass.id, draft.id),
    ).rejects.toBeInstanceOf(ArchivedClassAssignmentError);
  });
});
