import "server-only";

import {
  AssignmentStatus,
  MediaAssetKind,
  MediaAssetStatus,
  SubmissionStatus,
  UserRole,
} from "@/generated/prisma/enums";
import type { SafeUser } from "@/lib/auth/types";
import { assignmentIdSchema } from "@/lib/assignments/validation";
import { deriveStudentAssignmentStatus } from "@/lib/assignments/assignment-service";
import { db } from "@/lib/db";
import { mediaAssetIdSchema } from "@/lib/media/validation";
import type {
  StudentAssignmentDetail,
  StudentSubmissionSummary,
} from "@/lib/submissions/types";

export class StudentSubmissionAuthorizationError extends Error {
  constructor() {
    super("Only students can submit assigned work.");
    this.name = "StudentSubmissionAuthorizationError";
  }
}

export class StudentAssignmentUnavailableError extends Error {
  constructor() {
    super("Assignment not found or unavailable.");
    this.name = "StudentAssignmentUnavailableError";
  }
}

export class SubmissionVideoUnavailableError extends Error {
  constructor() {
    super("Choose a ready response video uploaded by your account.");
    this.name = "SubmissionVideoUnavailableError";
  }
}

export class SubmissionLockedError extends Error {
  constructor() {
    super("This response cannot be replaced because grading has started.");
    this.name = "SubmissionLockedError";
  }
}

function requireStudent(actor: SafeUser) {
  if (actor.role !== UserRole.STUDENT) {
    throw new StudentSubmissionAuthorizationError();
  }
}

function isSerializationConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}

export async function getStudentAssignmentDetail(
  actor: SafeUser,
  assignmentId: string,
  now = new Date(),
): Promise<StudentAssignmentDetail> {
  requireStudent(actor);
  const parsedAssignmentId = assignmentIdSchema.parse(assignmentId);
  const record = await db.assignmentStudent.findFirst({
    where: {
      assignmentId: parsedAssignmentId,
      studentId: actor.id,
      assignment: { status: AssignmentStatus.PUBLISHED },
    },
    select: {
      assignment: {
        select: {
          id: true,
          classId: true,
          title: true,
          instructions: true,
          dueAt: true,
          publishedAt: true,
          danceClass: {
            select: {
              name: true,
              teacher: { select: { username: true } },
            },
          },
          referenceVideo: {
            select: { id: true, status: true, contentType: true },
          },
          submissions: {
            where: { studentId: actor.id },
            take: 1,
            select: {
              id: true,
              videoAssetId: true,
              submittedAt: true,
              completedAt: true,
              grade: { select: { id: true } },
            },
          },
        },
      },
    },
  });
  const assignment = record?.assignment;
  if (
    !assignment ||
    !assignment.publishedAt ||
    !assignment.referenceVideo ||
    assignment.referenceVideo.status !== MediaAssetStatus.READY
  ) {
    throw new StudentAssignmentUnavailableError();
  }

  const submission = assignment.submissions[0];
  const submissionSummary =
    submission?.videoAssetId && submission.submittedAt && submission.completedAt
      ? {
          id: submission.id,
          videoAssetId: submission.videoAssetId,
          submittedAt: submission.submittedAt,
          completedAt: submission.completedAt,
          submittedLate: Boolean(
            assignment.dueAt && submission.submittedAt > assignment.dueAt,
          ),
          gradingStarted: Boolean(submission.grade),
        }
      : null;

  return {
    id: assignment.id,
    classId: assignment.classId,
    className: assignment.danceClass.name,
    teacherUsername: assignment.danceClass.teacher.username,
    title: assignment.title,
    instructions: assignment.instructions,
    dueAt: assignment.dueAt,
    publishedAt: assignment.publishedAt,
    status: deriveStudentAssignmentStatus({
      dueAt: assignment.dueAt,
      hasSubmission: Boolean(submission),
      completedAt: submission?.completedAt ?? null,
      now,
    }),
    referenceVideo: {
      id: assignment.referenceVideo.id,
      contentType: assignment.referenceVideo.contentType,
    },
    submission: submissionSummary,
  };
}

export async function submitAndCompleteAssignment(
  actor: SafeUser,
  assignmentId: string,
  videoAssetId: string,
  now = new Date(),
): Promise<StudentSubmissionSummary> {
  requireStudent(actor);
  const parsedAssignmentId = assignmentIdSchema.parse(assignmentId);
  const parsedVideoAssetId = mediaAssetIdSchema.parse(videoAssetId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(
        async (transaction) => {
          const submissionLockKey = `${parsedAssignmentId}:${actor.id}`;
          await transaction.$queryRaw`
            SELECT pg_advisory_xact_lock(
              hashtextextended(${submissionLockKey}, 0)
            )::text AS "lock"
          `;
          await transaction.$queryRaw`
            SELECT "id"
            FROM "Submission"
            WHERE "assignmentId" = ${parsedAssignmentId}::uuid
              AND "studentId" = ${actor.id}::uuid
            FOR UPDATE
          `;

          const recipient = await transaction.assignmentStudent.findFirst({
            where: {
              assignmentId: parsedAssignmentId,
              studentId: actor.id,
              assignment: { status: AssignmentStatus.PUBLISHED },
            },
            select: { assignment: { select: { dueAt: true } } },
          });
          if (!recipient) throw new StudentAssignmentUnavailableError();

          const existing = await transaction.submission.findUnique({
            where: {
              assignmentId_studentId: {
                assignmentId: parsedAssignmentId,
                studentId: actor.id,
              },
            },
            select: {
              id: true,
              completedAt: true,
              grade: { select: { id: true } },
            },
          });
          if (existing?.grade) throw new SubmissionLockedError();

          const video = await transaction.mediaAsset.findFirst({
            where: {
              id: parsedVideoAssetId,
              ownerId: actor.id,
              kind: MediaAssetKind.SUBMISSION_VIDEO,
              status: MediaAssetStatus.READY,
              OR: [
                { submissionFor: null },
                ...(existing ? [{ submissionFor: { id: existing.id } }] : []),
              ],
            },
            select: { id: true },
          });
          if (!video) throw new SubmissionVideoUnavailableError();

          const submission = existing
            ? await transaction.submission.update({
                where: { id: existing.id },
                data: {
                  videoAssetId: video.id,
                  status: SubmissionStatus.SUBMITTED,
                  submittedAt: now,
                  completedAt: existing.completedAt ?? now,
                },
                select: {
                  id: true,
                  videoAssetId: true,
                  submittedAt: true,
                  completedAt: true,
                },
              })
            : await transaction.submission.create({
                data: {
                  assignmentId: parsedAssignmentId,
                  studentId: actor.id,
                  videoAssetId: video.id,
                  status: SubmissionStatus.SUBMITTED,
                  submittedAt: now,
                  completedAt: now,
                },
                select: {
                  id: true,
                  videoAssetId: true,
                  submittedAt: true,
                  completedAt: true,
                },
              });

          if (
            !submission.videoAssetId ||
            !submission.submittedAt ||
            !submission.completedAt
          ) {
            throw new Error("Submission completion invariant failed.");
          }
          return {
            id: submission.id,
            videoAssetId: submission.videoAssetId,
            submittedAt: submission.submittedAt,
            completedAt: submission.completedAt,
            submittedLate: Boolean(
              recipient.assignment.dueAt &&
              submission.submittedAt > recipient.assignment.dueAt,
            ),
            gradingStarted: false,
          };
        },
        { isolationLevel: "ReadCommitted" },
      );
    } catch (error) {
      if (isSerializationConflict(error) && attempt < 2) continue;
      throw error;
    }
  }

  throw new Error("Submission could not be completed.");
}
