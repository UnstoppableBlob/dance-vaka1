import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AssignmentStatus,
  GradeStatus,
  MediaAssetKind,
  MediaAssetStatus,
  SubmissionStatus,
  UserRole,
} from "@/generated/prisma/enums";
import { dummyPasswordHash } from "@/lib/auth/password";
import type { SafeUser } from "@/lib/auth/types";
import {
  ClassAuthorizationError,
  createTeacherClass,
} from "@/lib/classes/class-service";
import { db } from "@/lib/db";
import {
  getTeacherGradingContext,
  getTeacherStudentHistory,
  TeacherGradingContextNotFoundError,
  TeacherStudentHistoryNotFoundError,
} from "@/lib/history/teacher-student-history-service";
import {
  createAuthorizedMediaRead,
  createAuthorizedTeacherSubmissionRead,
  MediaAssetUnavailableError,
} from "@/lib/media/media-service";
import type { CreateReadUrlInput, ObjectStorage } from "@/lib/storage/types";

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

let teacherOne: SafeUser;
let teacherTwo: SafeUser;
let studentOne: SafeUser;
let studentTwo: SafeUser;
const createdUserIds: string[] = [];
let sequence = 0;

function uniqueValue(label: string, maxLength = 30) {
  sequence += 1;
  return `vitest_history_${label}_${Date.now().toString(36)}_${sequence}`.slice(
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

async function createMedia(ownerId: string, kind: MediaAssetKind) {
  return db.mediaAsset.create({
    data: {
      ownerId,
      kind,
      status: MediaAssetStatus.READY,
      bucket: "history-test-bucket",
      objectKey: `history-tests/${uniqueValue("object", 80)}.webm`,
      originalFilename: "dance.webm",
      contentType: "video/webm",
      byteSize: BigInt(4096),
      uploadedAt: new Date(),
    },
  });
}

describe.sequential("teacher student history and grading context", () => {
  let classId: string;
  let otherClassId: string;
  let futureAssignmentId: string;
  let lateAssignmentId: string;
  let completedAssignmentId: string;
  let gradedAssignmentId: string;
  let completedReferenceId: string;
  let completedReferenceKey: string;
  let completedSubmissionId: string;
  let completedVideoId: string;
  let completedVideoKey: string;
  const completedAt = new Date("2027-01-10T12:00:00.000Z");

  beforeAll(async () => {
    await db.danceClass.deleteMany({
      where: {
        teacher: { usernameNormalized: { startsWith: "vitest_history_" } },
      },
    });
    await db.mediaAsset.deleteMany({
      where: {
        owner: { usernameNormalized: { startsWith: "vitest_history_" } },
      },
    });
    await db.user.deleteMany({
      where: { usernameNormalized: { startsWith: "vitest_history_" } },
    });
    teacherOne = await createActor(UserRole.TEACHER, "teacher_one");
    teacherTwo = await createActor(UserRole.TEACHER, "teacher_two");
    studentOne = await createActor(UserRole.STUDENT, "student_one");
    studentTwo = await createActor(UserRole.STUDENT, "student_two");

    const danceClass = await createTeacherClass(teacherOne, {
      name: uniqueValue("class", 100),
      description: "",
    });
    const otherClass = await createTeacherClass(teacherTwo, {
      name: uniqueValue("other_class", 100),
      description: "",
    });
    classId = danceClass.id;
    otherClassId = otherClass.id;
    await db.classMembership.create({
      data: {
        classId,
        studentId: studentOne.id,
        removedAt: new Date("2027-01-15T12:00:00.000Z"),
      },
    });

    async function createAssignment(label: string, dueAt: Date | null) {
      const reference = await createMedia(
        teacherOne.id,
        MediaAssetKind.REFERENCE_VIDEO,
      );
      const assignment = await db.assignment.create({
        data: {
          classId,
          createdById: teacherOne.id,
          title: uniqueValue(label, 100),
          titleNormalized: uniqueValue(
            `${label}_normalized`,
            100,
          ).toLowerCase(),
          dueAt,
          status: AssignmentStatus.PUBLISHED,
          publishedAt: new Date("2027-01-01T12:00:00.000Z"),
          referenceVideoAssetId: reference.id,
        },
      });
      await db.assignmentStudent.create({
        data: { assignmentId: assignment.id, studentId: studentOne.id },
      });
      return { assignment, reference };
    }

    const future = await createAssignment(
      "future",
      new Date("2027-02-01T12:00:00.000Z"),
    );
    const late = await createAssignment(
      "late",
      new Date("2027-01-05T12:00:00.000Z"),
    );
    const completed = await createAssignment(
      "completed",
      new Date("2027-01-09T12:00:00.000Z"),
    );
    const graded = await createAssignment("graded", null);
    futureAssignmentId = future.assignment.id;
    lateAssignmentId = late.assignment.id;
    completedAssignmentId = completed.assignment.id;
    gradedAssignmentId = graded.assignment.id;
    completedReferenceId = completed.reference.id;
    completedReferenceKey = completed.reference.objectKey;

    const completedVideo = await createMedia(
      studentOne.id,
      MediaAssetKind.SUBMISSION_VIDEO,
    );
    const gradedVideo = await createMedia(
      studentOne.id,
      MediaAssetKind.SUBMISSION_VIDEO,
    );
    completedVideoId = completedVideo.id;
    completedVideoKey = completedVideo.objectKey;
    const completedSubmission = await db.submission.create({
      data: {
        assignmentId: completed.assignment.id,
        studentId: studentOne.id,
        videoAssetId: completedVideo.id,
        status: SubmissionStatus.SUBMITTED,
        submittedAt: completedAt,
        completedAt,
      },
    });
    const gradedSubmission = await db.submission.create({
      data: {
        assignmentId: graded.assignment.id,
        studentId: studentOne.id,
        videoAssetId: gradedVideo.id,
        status: SubmissionStatus.SUBMITTED,
        submittedAt: completedAt,
        completedAt,
      },
    });
    completedSubmissionId = completedSubmission.id;
    await db.grade.create({
      data: {
        submissionId: gradedSubmission.id,
        teacherId: teacherOne.id,
        status: GradeStatus.DRAFT,
      },
    });

    const unrelatedReference = await createMedia(
      teacherTwo.id,
      MediaAssetKind.REFERENCE_VIDEO,
    );
    const unrelatedAssignment = await db.assignment.create({
      data: {
        classId: otherClassId,
        createdById: teacherTwo.id,
        title: uniqueValue("unrelated", 100),
        titleNormalized: uniqueValue("unrelated_normalized", 100).toLowerCase(),
        status: AssignmentStatus.PUBLISHED,
        publishedAt: new Date(),
        referenceVideoAssetId: unrelatedReference.id,
      },
    });
    await db.assignmentStudent.create({
      data: { assignmentId: unrelatedAssignment.id, studentId: studentOne.id },
    });
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

  it("returns every assigned class assignment with completion and grade state", async () => {
    const history = await getTeacherStudentHistory(
      teacherOne,
      classId,
      studentOne.id,
      new Date("2027-01-20T12:00:00.000Z"),
    );

    expect(history).toMatchObject({
      classId,
      studentId: studentOne.id,
      studentUsername: studentOne.username,
      removedAt: expect.any(Date),
    });
    expect(history.assignments).toHaveLength(4);
    expect(history.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: futureAssignmentId,
          status: "NOT_STARTED",
          completedAt: null,
          gradeStatus: "NOT_STARTED",
        }),
        expect.objectContaining({ id: lateAssignmentId, status: "LATE" }),
        expect.objectContaining({
          id: completedAssignmentId,
          status: "COMPLETED",
          completedAt,
          gradeStatus: "NOT_STARTED",
          canGrade: true,
        }),
        expect.objectContaining({
          id: gradedAssignmentId,
          status: "COMPLETED",
          gradeStatus: GradeStatus.DRAFT,
          canGrade: true,
        }),
      ]),
    );
  });

  it("returns the exact completed reference and submission grading records", async () => {
    const context = await getTeacherGradingContext(
      teacherOne,
      classId,
      studentOne.id,
      completedAssignmentId,
    );
    expect(context).toMatchObject({
      classId,
      studentId: studentOne.id,
      assignmentId: completedAssignmentId,
      referenceVideo: { id: completedReferenceId },
      submission: {
        id: completedSubmissionId,
        videoAssetId: completedVideoId,
        completedAt,
      },
      gradeStatus: "NOT_STARTED",
    });
  });

  it("authorizes private submission media only for the owning class teacher", async () => {
    const storage = new ReadStorage();
    const [referenceRead, submissionRead] = await Promise.all([
      createAuthorizedMediaRead(teacherOne, completedReferenceId, { storage }),
      createAuthorizedTeacherSubmissionRead(teacherOne, completedSubmissionId, {
        storage,
      }),
    ]);
    expect(referenceRead.assetId).toBe(completedReferenceId);
    expect(submissionRead.assetId).toBe(completedVideoId);
    expect(storage.readRequests).toEqual(
      expect.arrayContaining([
        { key: completedReferenceKey, expiresInSeconds: 300 },
        { key: completedVideoKey, expiresInSeconds: 300 },
      ]),
    );
    await expect(
      createAuthorizedTeacherSubmissionRead(teacherTwo, completedSubmissionId, {
        storage,
      }),
    ).rejects.toBeInstanceOf(MediaAssetUnavailableError);
    await expect(
      createAuthorizedTeacherSubmissionRead(studentOne, completedSubmissionId, {
        storage,
      }),
    ).rejects.toBeInstanceOf(MediaAssetUnavailableError);
  });

  it("blocks other teachers, unrelated students, roles, and mismatched grading routes", async () => {
    await expect(
      getTeacherStudentHistory(teacherTwo, classId, studentOne.id),
    ).rejects.toBeInstanceOf(TeacherStudentHistoryNotFoundError);
    await expect(
      getTeacherStudentHistory(teacherOne, classId, studentTwo.id),
    ).rejects.toBeInstanceOf(TeacherStudentHistoryNotFoundError);
    await expect(
      getTeacherStudentHistory(studentOne, classId, studentOne.id),
    ).rejects.toBeInstanceOf(ClassAuthorizationError);

    await expect(
      getTeacherGradingContext(
        teacherOne,
        classId,
        studentOne.id,
        futureAssignmentId,
      ),
    ).rejects.toBeInstanceOf(TeacherGradingContextNotFoundError);
    await expect(
      getTeacherGradingContext(
        teacherOne,
        classId,
        studentTwo.id,
        completedAssignmentId,
      ),
    ).rejects.toBeInstanceOf(TeacherGradingContextNotFoundError);
    await expect(
      getTeacherGradingContext(
        teacherTwo,
        classId,
        studentOne.id,
        completedAssignmentId,
      ),
    ).rejects.toBeInstanceOf(TeacherGradingContextNotFoundError);
  });
});
