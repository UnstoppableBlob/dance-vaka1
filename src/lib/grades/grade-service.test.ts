import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";

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
  getStudentReleasedGrade,
  StudentReleasedGradeNotFoundError,
} from "@/lib/dashboard/student-dashboard-service";
import { db } from "@/lib/db";
import {
  GradeAuthorizationError,
  GradeSubmissionUnavailableError,
  ReleasedGradeLockedError,
  saveAndReleaseTeacherGrade,
  saveTeacherGradeDraft,
} from "@/lib/grades/grade-service";
import type { TeacherGradeInput } from "@/lib/grades/types";
import {
  getStudentAssignmentDetail,
  SubmissionLockedError,
  submitAndCompleteAssignment,
} from "@/lib/submissions/submission-service";

let teacher: SafeUser;
let otherTeacher: SafeUser;
let student: SafeUser;
let classId: string;
let assignmentId: string;
let submissionId: string;
let replacementVideoId: string;
let gradeId: string;
const userIds: string[] = [];
let sequence = 0;

function uniqueValue(label: string, maximum = 100) {
  sequence += 1;
  return `vitest_grade_${label}_${Date.now().toString(36)}_${sequence}`.slice(
    0,
    maximum,
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

async function createReadyVideo(ownerId: string, kind: MediaAssetKind) {
  return db.mediaAsset.create({
    data: {
      ownerId,
      kind,
      status: MediaAssetStatus.READY,
      bucket: "grade-test-bucket",
      objectKey: `grade-tests/${uniqueValue("video", 80)}.webm`,
      originalFilename: "dance.webm",
      contentType: "video/webm",
      byteSize: BigInt(4096),
      uploadedAt: new Date(),
    },
  });
}

function gradeInput(
  overrides: Partial<TeacherGradeInput> = {},
): TeacherGradeInput {
  return {
    automatedOverall: 82,
    formScore: 84,
    activityScore: 80,
    timingScore: 79,
    coverageScore: 90,
    analysisDetails: {
      version: 1,
      analyzedAt: "2027-02-01T12:00:00.000Z",
      sampleCount: 20,
      matchedFrames: 18,
      mismatchCounts: [{ label: "left elbow", count: 3 }],
    },
    feedback: "Keep the landing controlled.",
    overrideScore: null,
    overrideReason: null,
    ...overrides,
  };
}

describe.sequential("teacher grade persistence and release", () => {
  beforeAll(async () => {
    await db.user.deleteMany({
      where: { usernameNormalized: { startsWith: "vitest_grade_" } },
    });
    teacher = await createActor(UserRole.TEACHER, "teacher");
    otherTeacher = await createActor(UserRole.TEACHER, "other_teacher");
    student = await createActor(UserRole.STUDENT, "student");
    const danceClass = await db.danceClass.create({
      data: {
        teacherId: teacher.id,
        name: uniqueValue("class"),
        nameNormalized: uniqueValue("class_normalized").toLowerCase(),
      },
    });
    classId = danceClass.id;
    await db.classMembership.create({
      data: { classId, studentId: student.id },
    });
    const reference = await createReadyVideo(
      teacher.id,
      MediaAssetKind.REFERENCE_VIDEO,
    );
    const assignment = await db.assignment.create({
      data: {
        classId,
        createdById: teacher.id,
        title: uniqueValue("assignment"),
        titleNormalized: uniqueValue("assignment_normalized").toLowerCase(),
        status: AssignmentStatus.PUBLISHED,
        publishedAt: new Date("2027-01-01T00:00:00.000Z"),
        referenceVideoAssetId: reference.id,
      },
    });
    assignmentId = assignment.id;
    await db.assignmentStudent.create({
      data: { assignmentId, studentId: student.id },
    });
    const response = await createReadyVideo(
      student.id,
      MediaAssetKind.SUBMISSION_VIDEO,
    );
    const replacement = await createReadyVideo(
      student.id,
      MediaAssetKind.SUBMISSION_VIDEO,
    );
    replacementVideoId = replacement.id;
    const submission = await db.submission.create({
      data: {
        assignmentId,
        studentId: student.id,
        videoAssetId: response.id,
        status: SubmissionStatus.SUBMITTED,
        submittedAt: new Date("2027-01-20T00:00:00.000Z"),
        completedAt: new Date("2027-01-20T00:00:00.000Z"),
      },
    });
    submissionId = submission.id;
  });

  afterAll(async () => {
    await db.danceClass.deleteMany({ where: { id: classId } });
    await db.mediaAsset.deleteMany({ where: { ownerId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it("enforces role, ownership, score bounds, and override reasons", async () => {
    await expect(
      saveTeacherGradeDraft(otherTeacher, submissionId, gradeInput()),
    ).rejects.toBeInstanceOf(GradeSubmissionUnavailableError);
    await expect(
      saveTeacherGradeDraft(student, submissionId, gradeInput()),
    ).rejects.toBeInstanceOf(GradeAuthorizationError);
    await expect(
      saveTeacherGradeDraft(
        teacher,
        submissionId,
        gradeInput({ automatedOverall: 101 }),
      ),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      saveTeacherGradeDraft(
        teacher,
        submissionId,
        gradeInput({ overrideScore: 88, overrideReason: "   " }),
      ),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("saves a private draft and immediately locks response replacement", async () => {
    const grade = await saveTeacherGradeDraft(
      teacher,
      submissionId,
      gradeInput(),
    );
    gradeId = grade.id;
    expect(grade).toMatchObject({
      status: GradeStatus.DRAFT,
      automatedOverall: 82,
      finalScore: 82,
      overrideReason: null,
      releasedAt: null,
    });
    await expect(
      getStudentReleasedGrade(student, grade.id),
    ).rejects.toBeInstanceOf(StudentReleasedGradeNotFoundError);
    await expect(
      submitAndCompleteAssignment(student, assignmentId, replacementVideoId),
    ).rejects.toBeInstanceOf(SubmissionLockedError);
    await expect(
      getStudentAssignmentDetail(student, assignmentId),
    ).resolves.toMatchObject({ submission: { gradingStarted: true } });
  });

  it("replaces draft analysis and applies a justified final-score override", async () => {
    const updated = await saveTeacherGradeDraft(
      teacher,
      submissionId,
      gradeInput({
        automatedOverall: 86,
        formScore: 88,
        overrideScore: 91,
        overrideReason:
          "The final sequence showed stronger control than the sample average.",
        analysisDetails: {
          version: 1,
          analyzedAt: "2027-02-02T12:00:00.000Z",
          sampleCount: 24,
          matchedFrames: 23,
          mismatchCounts: [],
        },
      }),
    );
    expect(updated).toMatchObject({
      id: gradeId,
      status: GradeStatus.DRAFT,
      automatedOverall: 86,
      formScore: 88,
      finalScore: 91,
      overrideReason: expect.stringContaining("stronger control"),
      analysisDetails: { sampleCount: 24, matchedFrames: 23 },
    });
  });

  it("atomically saves and releases the current grade to only that student", async () => {
    const releasedAt = new Date("2027-02-03T12:00:00.000Z");
    const released = await saveAndReleaseTeacherGrade(
      teacher,
      submissionId,
      gradeInput({
        automatedOverall: 86,
        overrideScore: 91,
        overrideReason:
          "The final sequence showed stronger control than the sample average.",
      }),
      releasedAt,
    );
    expect(released).toMatchObject({
      id: gradeId,
      status: GradeStatus.RELEASED,
      finalScore: 91,
      releasedAt,
    });
    await expect(
      getStudentReleasedGrade(student, gradeId),
    ).resolves.toMatchObject({
      id: gradeId,
      finalScore: 91,
      feedback: "Keep the landing controlled.",
      releasedAt,
    });
  });

  it("keeps released grades immutable", async () => {
    await expect(
      saveTeacherGradeDraft(teacher, submissionId, gradeInput()),
    ).rejects.toBeInstanceOf(ReleasedGradeLockedError);
    await expect(
      saveAndReleaseTeacherGrade(teacher, submissionId, gradeInput()),
    ).rejects.toBeInstanceOf(ReleasedGradeLockedError);
  });
});
