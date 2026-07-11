import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MediaAssetKind,
  MediaAssetStatus,
  SubmissionStatus,
  UserRole,
} from "@/generated/prisma/enums";
import {
  createAssignmentDraft,
  publishAssignmentDraft,
} from "@/lib/assignments/assignment-service";
import { dummyPasswordHash } from "@/lib/auth/password";
import type { SafeUser } from "@/lib/auth/types";
import { createTeacherClass } from "@/lib/classes/class-service";
import { db } from "@/lib/db";
import {
  createAuthorizedAssignmentReferenceRead,
  MediaAssetUnavailableError,
} from "@/lib/media/media-service";
import type { CreateReadUrlInput, ObjectStorage } from "@/lib/storage/types";
import {
  getStudentAssignmentDetail,
  StudentAssignmentUnavailableError,
  StudentSubmissionAuthorizationError,
  SubmissionLockedError,
  SubmissionVideoUnavailableError,
  submitAndCompleteAssignment,
} from "@/lib/submissions/submission-service";

class ReadStorage implements ObjectStorage {
  readRequests: CreateReadUrlInput[] = [];

  async createUploadUrl() {
    return "https://storage.test/upload";
  }

  async createReadUrl(input: CreateReadUrlInput) {
    this.readRequests.push(input);
    return `https://storage.test/read/${encodeURIComponent(input.key)}`;
  }

  async getMetadata() {
    return null;
  }

  async readPrefix() {
    return new Uint8Array();
  }

  async delete() {}
}

let teacher: SafeUser;
let studentOne: SafeUser;
let studentTwo: SafeUser;
const createdUserIds: string[] = [];
let sequence = 0;

function uniqueValue(label: string, maxLength = 30) {
  sequence += 1;
  return `vitest_submit_${label}_${Date.now().toString(36)}_${sequence}`.slice(
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

async function createMedia({
  ownerId,
  kind,
  status = MediaAssetStatus.READY,
}: {
  ownerId: string;
  kind: MediaAssetKind;
  status?: MediaAssetStatus;
}) {
  return db.mediaAsset.create({
    data: {
      ownerId,
      kind,
      status,
      bucket: "submission-test-bucket",
      objectKey: `submission-tests/${uniqueValue("object", 80)}.webm`,
      originalFilename: "dance.webm",
      contentType: "video/webm",
      byteSize: BigInt(2048),
      uploadedAt: status === MediaAssetStatus.READY ? new Date() : null,
    },
  });
}

async function createPublishedAssignment({
  students = [studentOne],
  dueAt = null,
}: {
  students?: SafeUser[];
  dueAt?: Date | null;
} = {}) {
  const danceClass = await createTeacherClass(teacher, {
    name: uniqueValue("class", 100),
    description: "",
  });
  if (students.length > 0) {
    await db.classMembership.createMany({
      data: students.map((student) => ({
        classId: danceClass.id,
        studentId: student.id,
      })),
    });
  }
  const reference = await createMedia({
    ownerId: teacher.id,
    kind: MediaAssetKind.REFERENCE_VIDEO,
  });
  const draft = await createAssignmentDraft(teacher, danceClass.id, {
    title: uniqueValue("assignment", 100),
    instructions: "Copy the reference choreography.",
    dueAt,
    referenceVideoAssetId: reference.id,
  });
  const assignment = await publishAssignmentDraft(
    teacher,
    danceClass.id,
    draft.id,
  );
  return { danceClass, assignment, reference };
}

describe.sequential("student assignment submissions", () => {
  beforeAll(async () => {
    await db.danceClass.deleteMany({
      where: {
        teacher: { usernameNormalized: { startsWith: "vitest_submit_" } },
      },
    });
    await db.mediaAsset.deleteMany({
      where: {
        owner: { usernameNormalized: { startsWith: "vitest_submit_" } },
      },
    });
    await db.user.deleteMany({
      where: { usernameNormalized: { startsWith: "vitest_submit_" } },
    });
    teacher = await createActor(UserRole.TEACHER, "teacher");
    studentOne = await createActor(UserRole.STUDENT, "student_one");
    studentTwo = await createActor(UserRole.STUDENT, "student_two");
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

  it("returns an assigned published detail and authorizes its private reference", async () => {
    const { assignment, reference } = await createPublishedAssignment();
    const detail = await getStudentAssignmentDetail(studentOne, assignment.id);
    expect(detail).toMatchObject({
      id: assignment.id,
      status: "NOT_STARTED",
      referenceVideo: { id: reference.id },
      submission: null,
    });
    await expect(
      getStudentAssignmentDetail(studentTwo, assignment.id),
    ).rejects.toBeInstanceOf(StudentAssignmentUnavailableError);
    await expect(
      getStudentAssignmentDetail(teacher, assignment.id),
    ).rejects.toBeInstanceOf(StudentSubmissionAuthorizationError);

    const storage = new ReadStorage();
    const read = await createAuthorizedAssignmentReferenceRead(
      studentOne,
      assignment.id,
      { storage },
    );
    expect(read.assetId).toBe(reference.id);
    expect(storage.readRequests).toEqual([
      { key: reference.objectKey, expiresInSeconds: 300 },
    ]);
    await expect(
      createAuthorizedAssignmentReferenceRead(studentTwo, assignment.id, {
        storage,
      }),
    ).rejects.toBeInstanceOf(MediaAssetUnavailableError);
  });

  it("atomically submits a ready response and marks late work complete", async () => {
    const dueAt = new Date("2026-11-01T12:00:00.000Z");
    const submittedAt = new Date("2026-11-02T12:00:00.000Z");
    const { assignment } = await createPublishedAssignment({ dueAt });
    const video = await createMedia({
      ownerId: studentOne.id,
      kind: MediaAssetKind.SUBMISSION_VIDEO,
    });

    const result = await submitAndCompleteAssignment(
      studentOne,
      assignment.id,
      video.id,
      submittedAt,
    );
    const stored = await db.submission.findUniqueOrThrow({
      where: {
        assignmentId_studentId: {
          assignmentId: assignment.id,
          studentId: studentOne.id,
        },
      },
    });

    expect(result).toMatchObject({
      videoAssetId: video.id,
      submittedAt,
      completedAt: submittedAt,
      submittedLate: true,
      gradingStarted: false,
    });
    expect(stored.status).toBe(SubmissionStatus.SUBMITTED);
    expect(stored.videoAssetId).toBe(video.id);
    expect(stored.submittedAt).toEqual(submittedAt);
    expect(stored.completedAt).toEqual(submittedAt);
    await expect(
      getStudentAssignmentDetail(studentOne, assignment.id, submittedAt),
    ).resolves.toMatchObject({
      status: "COMPLETED",
      submission: { submittedLate: true },
    });
  });

  it("rejects unassigned, unpublished, foreign, pending, and wrong-kind videos", async () => {
    const { assignment } = await createPublishedAssignment();
    const studentTwoVideo = await createMedia({
      ownerId: studentTwo.id,
      kind: MediaAssetKind.SUBMISSION_VIDEO,
    });
    await expect(
      submitAndCompleteAssignment(
        studentTwo,
        assignment.id,
        studentTwoVideo.id,
      ),
    ).rejects.toBeInstanceOf(StudentAssignmentUnavailableError);

    const pending = await createMedia({
      ownerId: studentOne.id,
      kind: MediaAssetKind.SUBMISSION_VIDEO,
      status: MediaAssetStatus.PENDING_UPLOAD,
    });
    const wrongKind = await createMedia({
      ownerId: studentOne.id,
      kind: MediaAssetKind.REFERENCE_VIDEO,
    });
    const foreign = await createMedia({
      ownerId: studentTwo.id,
      kind: MediaAssetKind.SUBMISSION_VIDEO,
    });
    for (const video of [pending, wrongKind, foreign]) {
      await expect(
        submitAndCompleteAssignment(studentOne, assignment.id, video.id),
      ).rejects.toBeInstanceOf(SubmissionVideoUnavailableError);
    }

    const usedVideo = await createMedia({
      ownerId: studentOne.id,
      kind: MediaAssetKind.SUBMISSION_VIDEO,
    });
    await submitAndCompleteAssignment(studentOne, assignment.id, usedVideo.id);
    const otherAssignment = await createPublishedAssignment();
    await expect(
      submitAndCompleteAssignment(
        studentOne,
        otherAssignment.assignment.id,
        usedVideo.id,
      ),
    ).rejects.toBeInstanceOf(SubmissionVideoUnavailableError);

    const danceClass = await createTeacherClass(teacher, {
      name: uniqueValue("unpublished_class", 100),
      description: "",
    });
    const reference = await createMedia({
      ownerId: teacher.id,
      kind: MediaAssetKind.REFERENCE_VIDEO,
    });
    const draft = await createAssignmentDraft(teacher, danceClass.id, {
      title: uniqueValue("unpublished", 100),
      instructions: null,
      dueAt: null,
      referenceVideoAssetId: reference.id,
    });
    await db.assignmentStudent.create({
      data: { assignmentId: draft.id, studentId: studentOne.id },
    });
    const readyVideo = await createMedia({
      ownerId: studentOne.id,
      kind: MediaAssetKind.SUBMISSION_VIDEO,
    });
    await expect(
      submitAndCompleteAssignment(studentOne, draft.id, readyVideo.id),
    ).rejects.toBeInstanceOf(StudentAssignmentUnavailableError);
  });

  it("replaces a response before grading while preserving first completion", async () => {
    const { assignment } = await createPublishedAssignment();
    const firstVideo = await createMedia({
      ownerId: studentOne.id,
      kind: MediaAssetKind.SUBMISSION_VIDEO,
    });
    const secondVideo = await createMedia({
      ownerId: studentOne.id,
      kind: MediaAssetKind.SUBMISSION_VIDEO,
    });
    const firstTime = new Date("2026-11-01T12:00:00.000Z");
    const replacementTime = new Date("2026-11-01T13:00:00.000Z");
    const first = await submitAndCompleteAssignment(
      studentOne,
      assignment.id,
      firstVideo.id,
      firstTime,
    );
    const replacement = await submitAndCompleteAssignment(
      studentOne,
      assignment.id,
      secondVideo.id,
      replacementTime,
    );

    expect(replacement.id).toBe(first.id);
    expect(replacement.videoAssetId).toBe(secondVideo.id);
    expect(replacement.submittedAt).toEqual(replacementTime);
    expect(replacement.completedAt).toEqual(firstTime);
    expect(
      (
        await db.mediaAsset.findUniqueOrThrow({
          where: { id: firstVideo.id },
          select: { submissionFor: { select: { id: true } } },
        })
      ).submissionFor,
    ).toBeNull();
    expect(
      await db.submission.count({
        where: { assignmentId: assignment.id, studentId: studentOne.id },
      }),
    ).toBe(1);
  });

  it("locks replacement as soon as a grade record exists", async () => {
    const { assignment } = await createPublishedAssignment();
    const firstVideo = await createMedia({
      ownerId: studentOne.id,
      kind: MediaAssetKind.SUBMISSION_VIDEO,
    });
    const replacementVideo = await createMedia({
      ownerId: studentOne.id,
      kind: MediaAssetKind.SUBMISSION_VIDEO,
    });
    const submission = await submitAndCompleteAssignment(
      studentOne,
      assignment.id,
      firstVideo.id,
    );
    await db.grade.create({
      data: { submissionId: submission.id, teacherId: teacher.id },
    });

    await expect(
      submitAndCompleteAssignment(
        studentOne,
        assignment.id,
        replacementVideo.id,
      ),
    ).rejects.toBeInstanceOf(SubmissionLockedError);
    const stored = await db.submission.findUniqueOrThrow({
      where: { id: submission.id },
    });
    expect(stored.videoAssetId).toBe(firstVideo.id);
    await expect(
      getStudentAssignmentDetail(studentOne, assignment.id),
    ).resolves.toMatchObject({
      submission: { gradingStarted: true },
    });
  });

  it("rejects submission attempts by teachers", async () => {
    const { assignment } = await createPublishedAssignment();
    const video = await createMedia({
      ownerId: studentOne.id,
      kind: MediaAssetKind.SUBMISSION_VIDEO,
    });
    await expect(
      submitAndCompleteAssignment(teacher, assignment.id, video.id),
    ).rejects.toBeInstanceOf(StudentSubmissionAuthorizationError);
  });
});
