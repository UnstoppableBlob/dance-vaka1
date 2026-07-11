import "server-only";

import {
  AssignmentStatus,
  InvitationStatus,
  UserRole,
} from "@/generated/prisma/enums";
import type { SafeUser } from "@/lib/auth/types";
import { ClassAuthorizationError } from "@/lib/classes/class-service";
import { db } from "@/lib/db";
import type {
  DashboardSubmission,
  TeacherDashboardOverview,
  TeacherSubmissionDetail,
} from "@/lib/dashboard/types";
import { submissionIdSchema } from "@/lib/submissions/validation";

const classSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  _count: {
    select: {
      memberships: { where: { removedAt: null } },
      assignments: true,
    },
  },
} as const;

const submissionSelect = {
  id: true,
  submittedAt: true,
  student: { select: { id: true, username: true } },
  assignment: {
    select: {
      id: true,
      title: true,
      danceClass: { select: { id: true, name: true } },
    },
  },
} as const;

export class TeacherSubmissionNotFoundError extends Error {
  constructor() {
    super("Submission not found.");
    this.name = "TeacherSubmissionNotFoundError";
  }
}

function requireTeacher(actor: SafeUser) {
  if (actor.role !== UserRole.TEACHER) throw new ClassAuthorizationError();
}

function mapSubmission(submission: {
  id: string;
  submittedAt: Date | null;
  student: { id: string; username: string };
  assignment: {
    id: string;
    title: string;
    danceClass: { id: string; name: string };
  };
}): DashboardSubmission | null {
  if (!submission.submittedAt) return null;
  return {
    id: submission.id,
    studentId: submission.student.id,
    classId: submission.assignment.danceClass.id,
    className: submission.assignment.danceClass.name,
    assignmentId: submission.assignment.id,
    assignmentTitle: submission.assignment.title,
    studentUsername: submission.student.username,
    submittedAt: submission.submittedAt,
  };
}

export async function getTeacherDashboardOverview(
  actor: SafeUser,
): Promise<TeacherDashboardOverview> {
  requireTeacher(actor);
  const teacherId = actor.id;

  const [
    classes,
    pendingInvitationCount,
    pendingInvitations,
    publishedAssignments,
    recentSubmissionRows,
    needsReviewCount,
    needsReviewRows,
  ] = await Promise.all([
    db.danceClass.findMany({
      where: { teacherId },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      select: classSelect,
    }),
    db.classInvitation.count({
      where: {
        status: InvitationStatus.PENDING,
        danceClass: { teacherId },
      },
    }),
    db.classInvitation.findMany({
      where: {
        status: InvitationStatus.PENDING,
        danceClass: { teacherId },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        classId: true,
        createdAt: true,
        student: { select: { username: true } },
        danceClass: { select: { name: true } },
      },
    }),
    db.assignment.findMany({
      where: {
        status: AssignmentStatus.PUBLISHED,
        danceClass: { teacherId },
      },
      orderBy: { publishedAt: "desc" },
      take: 8,
      select: {
        id: true,
        classId: true,
        title: true,
        publishedAt: true,
        danceClass: { select: { name: true } },
        _count: {
          select: {
            assignedStudents: true,
            submissions: { where: { completedAt: { not: null } } },
          },
        },
      },
    }),
    db.submission.findMany({
      where: {
        submittedAt: { not: null },
        assignment: { danceClass: { teacherId } },
      },
      orderBy: { submittedAt: "desc" },
      take: 5,
      select: submissionSelect,
    }),
    db.submission.count({
      where: {
        completedAt: { not: null },
        grade: null,
        assignment: { danceClass: { teacherId } },
      },
    }),
    db.submission.findMany({
      where: {
        completedAt: { not: null },
        grade: null,
        assignment: { danceClass: { teacherId } },
      },
      orderBy: { submittedAt: "asc" },
      take: 5,
      select: submissionSelect,
    }),
  ]);

  return {
    classes,
    pendingInvitationCount,
    pendingInvitations: pendingInvitations.map((invitation) => ({
      id: invitation.id,
      classId: invitation.classId,
      className: invitation.danceClass.name,
      studentUsername: invitation.student.username,
      createdAt: invitation.createdAt,
    })),
    assignmentProgress: publishedAssignments.flatMap((assignment) =>
      assignment.publishedAt
        ? [
            {
              id: assignment.id,
              classId: assignment.classId,
              className: assignment.danceClass.name,
              title: assignment.title,
              publishedAt: assignment.publishedAt,
              recipientCount: assignment._count.assignedStudents,
              completedCount: assignment._count.submissions,
            },
          ]
        : [],
    ),
    recentSubmissions: recentSubmissionRows.flatMap((submission) => {
      const mapped = mapSubmission(submission);
      return mapped ? [mapped] : [];
    }),
    needsReviewCount,
    needsReview: needsReviewRows.flatMap((submission) => {
      const mapped = mapSubmission(submission);
      return mapped ? [mapped] : [];
    }),
  };
}

export async function getTeacherSubmissionDetail(
  actor: SafeUser,
  submissionId: string,
): Promise<TeacherSubmissionDetail> {
  requireTeacher(actor);
  const id = submissionIdSchema.parse(submissionId);
  const submission = await db.submission.findFirst({
    where: {
      id,
      completedAt: { not: null },
      assignment: { danceClass: { teacherId: actor.id } },
    },
    select: {
      ...submissionSelect,
      completedAt: true,
      grade: { select: { status: true } },
    },
  });
  const mapped = submission ? mapSubmission(submission) : null;
  if (!submission || !submission.completedAt || !mapped) {
    throw new TeacherSubmissionNotFoundError();
  }
  return {
    ...mapped,
    completedAt: submission.completedAt,
    gradeStatus: submission.grade?.status ?? null,
  };
}
