import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DashboardHeader } from "@/app/(dashboard)/dashboard-header";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { UserRole } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/dal";
import {
  getTeacherStudentHistory,
  TeacherStudentHistoryNotFoundError,
} from "@/lib/history/teacher-student-history-service";

export const metadata: Metadata = {
  title: "Student history | MotionMatch",
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

const statusLabels = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  LATE: "Late",
  COMPLETED: "Completed",
} as const;

const gradeLabels = {
  NOT_STARTED: "Not started",
  DRAFT: "Draft",
  RELEASED: "Released",
} as const;

export default async function TeacherStudentHistoryPage({
  params,
}: {
  params: Promise<{ classId: string; studentId: string }>;
}) {
  const actor = await requireRole(UserRole.TEACHER);
  const { classId, studentId } = await params;
  let history;
  try {
    history = await getTeacherStudentHistory(actor, classId, studentId);
  } catch (error) {
    if (error instanceof TeacherStudentHistoryNotFoundError) notFound();
    throw error;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-8 sm:px-10">
      <DashboardHeader user={actor} />
      <div className="py-8">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/teacher" },
            {
              label: history.className,
              href: `/teacher/classes/${history.classId}`,
            },
            { label: history.studentUsername },
          ]}
        />
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold text-slate-950">
            {history.studentUsername}
          </h1>
          {history.removedAt ? (
            <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
              Former student
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-slate-500">
          {history.className} · Joined {dateFormatter.format(history.joinedAt)}
        </p>

        <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Assignment history</h2>
          {history.assignments.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              This student has not been assigned any work in this class.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200">
              {history.assignments.map((assignment) => (
                <li
                  key={assignment.id}
                  className="grid gap-3 py-4 first:pt-0 sm:grid-cols-[minmax(0,1fr)_140px_140px]"
                >
                  <div>
                    {assignment.canGrade ? (
                      <Link
                        href={`/teacher/classes/${history.classId}/students/${history.studentId}/assignments/${assignment.id}/grade`}
                        className="font-medium text-indigo-700 hover:underline"
                      >
                        {assignment.title}
                      </Link>
                    ) : (
                      <p className="font-medium text-slate-900">
                        {assignment.title}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-slate-500">
                      {assignment.completedAt
                        ? `Completed ${dateFormatter.format(assignment.completedAt)}`
                        : assignment.dueAt
                          ? `Due ${dateFormatter.format(assignment.dueAt)}`
                          : "No due date"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Assignment</p>
                    <p className="mt-1 text-sm">
                      {statusLabels[assignment.status]}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Grade</p>
                    <p className="mt-1 text-sm">
                      {gradeLabels[assignment.gradeStatus]}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
