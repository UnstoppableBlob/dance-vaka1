import "server-only";

import {
  AssignmentStatus,
  GradeStatus,
  UserRole,
} from "@/generated/prisma/enums";
import type { SafeUser } from "@/lib/auth/types";
import { deriveStudentAssignmentStatus } from "@/lib/assignments/assignment-service";
import { db } from "@/lib/db";
import type {
  StudentDashboardAssignment,
  StudentDashboardOverview,
  StudentHistoryPage,
  StudentReleasedGradeDetail,
} from "@/lib/dashboard/student-types";
import { z } from "zod";

const DASHBOARD_LIMIT = 5;
export const STUDENT_HISTORY_PAGE_SIZE = 10;
const gradeIdSchema = z.uuid("Invalid grade ID.");

export class StudentDashboardAuthorizationError extends Error {
  constructor() {
    super("Only students can view student dashboard data.");
    this.name = "StudentDashboardAuthorizationError";
  }
}

export class StudentReleasedGradeNotFoundError extends Error {
  constructor() {
    super("Released grade not found.");
    this.name = "StudentReleasedGradeNotFoundError";
  }
}

function requireStudent(actor: SafeUser) {
  if (actor.role !== UserRole.STUDENT) {
    throw new StudentDashboardAuthorizationError();
  }
}

const dashboardAssignmentSelect = {
  assignment: {
    select: {
      id: true,
      title: true,
      dueAt: true,
      danceClass: {
        select: {
          name: true,
          teacher: { select: { username: true } },
        },
      },
      submissions: {
        take: 1,
        select: { completedAt: true },
      },
    },
  },
} as const;

function mapDashboardAssignment(
  record: {
    assignment: {
      id: string;
      title: string;
      dueAt: Date | null;
      danceClass: { name: string; teacher: { username: string } };
      submissions: { completedAt: Date | null }[];
    };
  },
  now: Date,
): StudentDashboardAssignment {
  const submission = record.assignment.submissions[0];
  return {
    id: record.assignment.id,
    className: record.assignment.danceClass.name,
    teacherUsername: record.assignment.danceClass.teacher.username,
    title: record.assignment.title,
    dueAt: record.assignment.dueAt,
    completedAt: submission?.completedAt ?? null,
    status: deriveStudentAssignmentStatus({
      dueAt: record.assignment.dueAt,
      hasSubmission: Boolean(submission),
      completedAt: submission?.completedAt ?? null,
      now,
    }),
  };
}

export async function getStudentDashboardOverview(
  actor: SafeUser,
  now = new Date(),
): Promise<StudentDashboardOverview> {
  requireStudent(actor);
  const recipientWhere = {
    studentId: actor.id,
    assignment: { status: AssignmentStatus.PUBLISHED },
  } as const;
  const incompleteSubmissionFilter = {
    none: { studentId: actor.id, completedAt: { not: null } },
  } as const;

  const [upcoming, late, completed, releasedGrades] = await Promise.all([
    db.assignmentStudent.findMany({
      where: {
        ...recipientWhere,
        assignment: {
          status: AssignmentStatus.PUBLISHED,
          OR: [{ dueAt: null }, { dueAt: { gte: now } }],
          submissions: incompleteSubmissionFilter,
        },
      },
      orderBy: { assignment: { dueAt: { sort: "asc", nulls: "last" } } },
      take: DASHBOARD_LIMIT,
      select: {
        assignment: {
          ...dashboardAssignmentSelect.assignment,
          select: {
            ...dashboardAssignmentSelect.assignment.select,
            submissions: {
              where: { studentId: actor.id },
              take: 1,
              select: { completedAt: true },
            },
          },
        },
      },
    }),
    db.assignmentStudent.findMany({
      where: {
        ...recipientWhere,
        assignment: {
          status: AssignmentStatus.PUBLISHED,
          dueAt: { lt: now },
          submissions: incompleteSubmissionFilter,
        },
      },
      orderBy: { assignment: { dueAt: "asc" } },
      take: DASHBOARD_LIMIT,
      select: {
        assignment: {
          ...dashboardAssignmentSelect.assignment,
          select: {
            ...dashboardAssignmentSelect.assignment.select,
            submissions: {
              where: { studentId: actor.id },
              take: 1,
              select: { completedAt: true },
            },
          },
        },
      },
    }),
    db.assignmentStudent.findMany({
      where: {
        ...recipientWhere,
        assignment: {
          status: AssignmentStatus.PUBLISHED,
          submissions: {
            some: { studentId: actor.id, completedAt: { not: null } },
          },
        },
      },
      orderBy: { assignedAt: "desc" },
      take: DASHBOARD_LIMIT,
      select: {
        assignment: {
          ...dashboardAssignmentSelect.assignment,
          select: {
            ...dashboardAssignmentSelect.assignment.select,
            submissions: {
              where: { studentId: actor.id },
              take: 1,
              select: { completedAt: true },
            },
          },
        },
      },
    }),
    db.grade.findMany({
      where: {
        status: GradeStatus.RELEASED,
        releasedAt: { not: null },
        submission: {
          studentId: actor.id,
          assignment: {
            status: AssignmentStatus.PUBLISHED,
            assignedStudents: { some: { studentId: actor.id } },
          },
        },
      },
      orderBy: { releasedAt: "desc" },
      take: DASHBOARD_LIMIT,
      select: {
        id: true,
        finalScore: true,
        releasedAt: true,
        submission: {
          select: {
            assignment: {
              select: {
                id: true,
                title: true,
                danceClass: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    upcomingAssignments: upcoming.map((record) =>
      mapDashboardAssignment(record, now),
    ),
    lateAssignments: late.map((record) => mapDashboardAssignment(record, now)),
    completedAssignments: completed.map((record) =>
      mapDashboardAssignment(record, now),
    ),
    releasedGrades: releasedGrades.flatMap((grade) =>
      grade.releasedAt
        ? [
            {
              id: grade.id,
              assignmentId: grade.submission.assignment.id,
              assignmentTitle: grade.submission.assignment.title,
              className: grade.submission.assignment.danceClass.name,
              finalScore: grade.finalScore,
              releasedAt: grade.releasedAt,
            },
          ]
        : [],
    ),
  };
}

export async function getStudentHistoryPage(
  actor: SafeUser,
  requestedPage: number,
): Promise<StudentHistoryPage> {
  requireStudent(actor);
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
  const where = {
    studentId: actor.id,
    completedAt: { not: null },
    assignment: {
      status: AssignmentStatus.PUBLISHED,
      assignedStudents: { some: { studentId: actor.id } },
    },
  } as const;
  const totalItems = await db.submission.count({ where });
  const totalPages = Math.max(
    1,
    Math.ceil(totalItems / STUDENT_HISTORY_PAGE_SIZE),
  );
  const currentPage = Math.min(page, totalPages);
  const submissions = await db.submission.findMany({
    where,
    orderBy: { completedAt: "desc" },
    skip: (currentPage - 1) * STUDENT_HISTORY_PAGE_SIZE,
    take: STUDENT_HISTORY_PAGE_SIZE,
    select: {
      completedAt: true,
      assignment: {
        select: {
          id: true,
          title: true,
          dueAt: true,
          danceClass: {
            select: {
              name: true,
              teacher: { select: { username: true } },
            },
          },
        },
      },
      grade: {
        select: {
          id: true,
          status: true,
          finalScore: true,
          releasedAt: true,
        },
      },
    },
  });

  return {
    items: submissions.flatMap((submission) => {
      if (!submission.completedAt) return [];
      const releasedGrade =
        submission.grade?.status === GradeStatus.RELEASED &&
        submission.grade.releasedAt
          ? {
              id: submission.grade.id,
              finalScore: submission.grade.finalScore,
              releasedAt: submission.grade.releasedAt,
            }
          : null;
      return [
        {
          assignmentId: submission.assignment.id,
          assignmentTitle: submission.assignment.title,
          className: submission.assignment.danceClass.name,
          teacherUsername: submission.assignment.danceClass.teacher.username,
          dueAt: submission.assignment.dueAt,
          completedAt: submission.completedAt,
          releasedGrade,
        },
      ];
    }),
    page: currentPage,
    pageSize: STUDENT_HISTORY_PAGE_SIZE,
    totalItems,
    totalPages,
  };
}

export async function getStudentReleasedGrade(
  actor: SafeUser,
  gradeId: string,
): Promise<StudentReleasedGradeDetail> {
  requireStudent(actor);
  const id = gradeIdSchema.parse(gradeId);
  const grade = await db.grade.findFirst({
    where: {
      id,
      status: GradeStatus.RELEASED,
      releasedAt: { not: null },
      submission: {
        studentId: actor.id,
        assignment: {
          status: AssignmentStatus.PUBLISHED,
          assignedStudents: { some: { studentId: actor.id } },
        },
      },
    },
    select: {
      id: true,
      automatedOverall: true,
      formScore: true,
      activityScore: true,
      timingScore: true,
      coverageScore: true,
      finalScore: true,
      feedback: true,
      overrideReason: true,
      releasedAt: true,
      submission: {
        select: {
          assignment: {
            select: {
              id: true,
              title: true,
              danceClass: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!grade?.releasedAt) throw new StudentReleasedGradeNotFoundError();

  return {
    id: grade.id,
    assignmentId: grade.submission.assignment.id,
    assignmentTitle: grade.submission.assignment.title,
    className: grade.submission.assignment.danceClass.name,
    finalScore: grade.finalScore,
    releasedAt: grade.releasedAt,
    automatedOverall: grade.automatedOverall,
    formScore: grade.formScore,
    activityScore: grade.activityScore,
    timingScore: grade.timingScore,
    coverageScore: grade.coverageScore,
    feedback: grade.feedback,
    overrideReason: grade.overrideReason,
  };
}
