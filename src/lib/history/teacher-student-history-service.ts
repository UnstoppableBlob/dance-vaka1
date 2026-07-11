import "server-only";

import { MediaAssetStatus, UserRole } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { deriveStudentAssignmentStatus } from "@/lib/assignments/assignment-service";
import { assignmentIdSchema } from "@/lib/assignments/validation";
import type { SafeUser } from "@/lib/auth/types";
import { ClassAuthorizationError } from "@/lib/classes/class-service";
import { classIdSchema } from "@/lib/classes/validation";
import { db } from "@/lib/db";
import { gradeAnalysisDetailsSchema } from "@/lib/grades/validation";
import type {
  TeacherGradingContext,
  TeacherStudentHistory,
} from "@/lib/history/types";
import { z } from "zod";

const studentIdSchema = z.uuid("Invalid student ID.");

export class TeacherStudentHistoryNotFoundError extends Error {
  constructor() {
    super("Student history not found.");
    this.name = "TeacherStudentHistoryNotFoundError";
  }
}

export class TeacherGradingContextNotFoundError extends Error {
  constructor() {
    super("Completed assignment not found or unavailable for grading.");
    this.name = "TeacherGradingContextNotFoundError";
  }
}

function requireTeacher(actor: SafeUser) {
  if (actor.role !== UserRole.TEACHER) throw new ClassAuthorizationError();
}

async function requireStudentRelationship(
  transaction: Prisma.TransactionClient,
  teacherId: string,
  classId: string,
  studentId: string,
) {
  const membership = await transaction.classMembership.findFirst({
    where: {
      classId,
      studentId,
      danceClass: { teacherId },
    },
    select: {
      joinedAt: true,
      removedAt: true,
      student: { select: { username: true } },
      danceClass: { select: { name: true } },
    },
  });
  if (!membership) throw new TeacherStudentHistoryNotFoundError();
  return membership;
}

export async function getTeacherStudentHistory(
  actor: SafeUser,
  classId: string,
  studentId: string,
  now = new Date(),
): Promise<TeacherStudentHistory> {
  requireTeacher(actor);
  const parsedClassId = classIdSchema.parse(classId);
  const parsedStudentId = studentIdSchema.parse(studentId);

  return db.$transaction(async (transaction) => {
    const membership = await requireStudentRelationship(
      transaction,
      actor.id,
      parsedClassId,
      parsedStudentId,
    );
    const records = await transaction.assignmentStudent.findMany({
      where: {
        studentId: parsedStudentId,
        assignment: { classId: parsedClassId },
      },
      orderBy: { assignedAt: "desc" },
      select: {
        assignedAt: true,
        assignment: {
          select: {
            id: true,
            title: true,
            dueAt: true,
            referenceVideo: { select: { status: true } },
            submissions: {
              where: { studentId: parsedStudentId },
              take: 1,
              select: {
                videoAssetId: true,
                completedAt: true,
                grade: { select: { status: true } },
                video: { select: { status: true } },
              },
            },
          },
        },
      },
    });

    return {
      classId: parsedClassId,
      className: membership.danceClass.name,
      studentId: parsedStudentId,
      studentUsername: membership.student.username,
      joinedAt: membership.joinedAt,
      removedAt: membership.removedAt,
      assignments: records.map(({ assignment, assignedAt }) => {
        const submission = assignment.submissions[0];
        const completedAt = submission?.completedAt ?? null;
        return {
          id: assignment.id,
          title: assignment.title,
          assignedAt,
          dueAt: assignment.dueAt,
          status: deriveStudentAssignmentStatus({
            dueAt: assignment.dueAt,
            hasSubmission: Boolean(submission),
            completedAt,
            now,
          }),
          completedAt,
          gradeStatus: submission?.grade?.status ?? "NOT_STARTED",
          canGrade: Boolean(
            completedAt &&
            submission?.videoAssetId &&
            submission.video?.status === MediaAssetStatus.READY &&
            assignment.referenceVideo?.status === MediaAssetStatus.READY,
          ),
        };
      }),
    };
  });
}

export async function getTeacherGradingContext(
  actor: SafeUser,
  classId: string,
  studentId: string,
  assignmentId: string,
): Promise<TeacherGradingContext> {
  requireTeacher(actor);
  const parsedClassId = classIdSchema.parse(classId);
  const parsedStudentId = studentIdSchema.parse(studentId);
  const parsedAssignmentId = assignmentIdSchema.parse(assignmentId);

  return db.$transaction(async (transaction) => {
    let membership;
    try {
      membership = await requireStudentRelationship(
        transaction,
        actor.id,
        parsedClassId,
        parsedStudentId,
      );
    } catch (error) {
      if (error instanceof TeacherStudentHistoryNotFoundError) {
        throw new TeacherGradingContextNotFoundError();
      }
      throw error;
    }

    const record = await transaction.assignmentStudent.findFirst({
      where: {
        assignmentId: parsedAssignmentId,
        studentId: parsedStudentId,
        assignment: { classId: parsedClassId },
      },
      select: {
        assignment: {
          select: {
            id: true,
            title: true,
            instructions: true,
            dueAt: true,
            referenceVideo: {
              select: {
                id: true,
                status: true,
                contentType: true,
                originalFilename: true,
              },
            },
            submissions: {
              where: {
                studentId: parsedStudentId,
                completedAt: { not: null },
              },
              take: 1,
              select: {
                id: true,
                videoAssetId: true,
                submittedAt: true,
                completedAt: true,
                video: {
                  select: {
                    status: true,
                    contentType: true,
                    originalFilename: true,
                  },
                },
                grade: {
                  select: {
                    id: true,
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
                  },
                },
              },
            },
          },
        },
      },
    });
    const assignment = record?.assignment;
    const submission = assignment?.submissions[0];
    if (
      !assignment ||
      !assignment.referenceVideo ||
      assignment.referenceVideo.status !== MediaAssetStatus.READY ||
      !submission ||
      !submission.videoAssetId ||
      !submission.submittedAt ||
      !submission.completedAt ||
      !submission.video ||
      submission.video.status !== MediaAssetStatus.READY
    ) {
      throw new TeacherGradingContextNotFoundError();
    }
    const parsedDetails = gradeAnalysisDetailsSchema.safeParse(
      submission.grade?.analysisDetails,
    );

    return {
      classId: parsedClassId,
      className: membership.danceClass.name,
      studentId: parsedStudentId,
      studentUsername: membership.student.username,
      assignmentId: assignment.id,
      assignmentTitle: assignment.title,
      instructions: assignment.instructions,
      dueAt: assignment.dueAt,
      referenceVideo: {
        id: assignment.referenceVideo.id,
        contentType: assignment.referenceVideo.contentType,
        originalFilename: assignment.referenceVideo.originalFilename,
      },
      submission: {
        id: submission.id,
        videoAssetId: submission.videoAssetId,
        contentType: submission.video.contentType,
        originalFilename: submission.video.originalFilename,
        submittedAt: submission.submittedAt,
        completedAt: submission.completedAt,
      },
      gradeStatus: submission.grade?.status ?? "NOT_STARTED",
      grade: submission.grade
        ? {
            id: submission.grade.id,
            status: submission.grade.status,
            automatedOverall: submission.grade.automatedOverall,
            formScore: submission.grade.formScore,
            activityScore: submission.grade.activityScore,
            timingScore: submission.grade.timingScore,
            coverageScore: submission.grade.coverageScore,
            analysisDetails: parsedDetails.success ? parsedDetails.data : null,
            finalScore: submission.grade.finalScore,
            overrideReason: submission.grade.overrideReason,
            feedback: submission.grade.feedback,
            releasedAt: submission.grade.releasedAt,
          }
        : null,
    };
  });
}
