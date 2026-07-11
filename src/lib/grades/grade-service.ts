import "server-only";

import {
  GradeStatus,
  MediaAssetStatus,
  SubmissionStatus,
  UserRole,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import type { SafeUser } from "@/lib/auth/types";
import { db } from "@/lib/db";
import type { TeacherGradeInput, TeacherGradeRecord } from "@/lib/grades/types";
import {
  gradeAnalysisDetailsSchema,
  gradeSubmissionIdSchema,
  teacherGradeInputSchema,
} from "@/lib/grades/validation";

export class GradeAuthorizationError extends Error {
  constructor() {
    super("Only teachers can grade submissions.");
    this.name = "GradeAuthorizationError";
  }
}

export class GradeSubmissionUnavailableError extends Error {
  constructor() {
    super("Submission not found or unavailable for grading.");
    this.name = "GradeSubmissionUnavailableError";
  }
}

export class ReleasedGradeLockedError extends Error {
  constructor() {
    super("Released grades cannot be changed.");
    this.name = "ReleasedGradeLockedError";
  }
}

function requireTeacher(actor: SafeUser) {
  if (actor.role !== UserRole.TEACHER) throw new GradeAuthorizationError();
}

const gradeSelect = {
  id: true,
  submissionId: true,
  status: true,
  automatedOverall: true,
  formScore: true,
  activityScore: true,
  timingScore: true,
  coverageScore: true,
  analysisDetails: true,
  finalScore: true,
  overrideReason: true,
  feedback: true,
  releasedAt: true,
} as const;

type SelectedGrade = Prisma.GradeGetPayload<{ select: typeof gradeSelect }>;

function serializeGrade(grade: SelectedGrade): TeacherGradeRecord {
  const parsedDetails = gradeAnalysisDetailsSchema.parse(grade.analysisDetails);
  if (
    grade.automatedOverall === null ||
    grade.coverageScore === null ||
    grade.finalScore === null
  ) {
    throw new Error("Saved grade invariant failed.");
  }
  return {
    ...grade,
    automatedOverall: grade.automatedOverall,
    coverageScore: grade.coverageScore,
    finalScore: grade.finalScore,
    analysisDetails: parsedDetails,
  };
}

async function writeTeacherGrade(
  actor: SafeUser,
  submissionId: string,
  input: TeacherGradeInput,
  status: GradeStatus,
  now: Date,
) {
  requireTeacher(actor);
  const id = gradeSubmissionIdSchema.parse(submissionId);
  const values = teacherGradeInputSchema.parse(input);

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))::text AS "lock"
    `;
    const submission = await transaction.submission.findFirst({
      where: {
        id,
        status: SubmissionStatus.SUBMITTED,
        completedAt: { not: null },
        video: { status: MediaAssetStatus.READY },
        assignment: {
          danceClass: { teacherId: actor.id },
          referenceVideo: { status: MediaAssetStatus.READY },
        },
      },
      select: {
        id: true,
        grade: { select: { id: true, status: true, teacherId: true } },
      },
    });
    if (
      !submission ||
      (submission.grade && submission.grade.teacherId !== actor.id)
    ) {
      throw new GradeSubmissionUnavailableError();
    }
    if (submission.grade?.status === GradeStatus.RELEASED) {
      throw new ReleasedGradeLockedError();
    }

    const gradeData = {
      automatedOverall: values.automatedOverall,
      formScore: values.formScore,
      activityScore: values.activityScore,
      timingScore: values.timingScore,
      coverageScore: values.coverageScore,
      analysisDetails: values.analysisDetails,
      finalScore: values.overrideScore ?? values.automatedOverall,
      overrideReason: values.overrideReason,
      feedback: values.feedback,
      status,
      releasedAt: status === GradeStatus.RELEASED ? now : null,
    } satisfies Prisma.GradeUpdateInput;

    const grade = submission.grade
      ? await transaction.grade.update({
          where: { id: submission.grade.id },
          data: gradeData,
          select: gradeSelect,
        })
      : await transaction.grade.create({
          data: {
            ...gradeData,
            teacher: { connect: { id: actor.id } },
            submission: { connect: { id: submission.id } },
          },
          select: gradeSelect,
        });
    return serializeGrade(grade);
  });
}

export async function saveTeacherGradeDraft(
  actor: SafeUser,
  submissionId: string,
  input: TeacherGradeInput,
  now = new Date(),
) {
  return writeTeacherGrade(actor, submissionId, input, GradeStatus.DRAFT, now);
}

export async function saveAndReleaseTeacherGrade(
  actor: SafeUser,
  submissionId: string,
  input: TeacherGradeInput,
  now = new Date(),
) {
  return writeTeacherGrade(
    actor,
    submissionId,
    input,
    GradeStatus.RELEASED,
    now,
  );
}
