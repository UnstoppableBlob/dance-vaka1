import type { Metadata } from "next";
import Link from "next/link";

import { DashboardHeader } from "@/app/(dashboard)/dashboard-header";
import {
  acceptInvitationAction,
  declineInvitationAction,
} from "@/app/(dashboard)/student/actions";
import { ConfirmSubmitButton } from "@/components/forms/confirm-submit-button";
import { ClassStatus, UserRole } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/dal";
import { getStudentDashboardOverview } from "@/lib/dashboard/student-dashboard-service";
import type { StudentDashboardAssignment } from "@/lib/dashboard/student-types";
import {
  listStudentClasses,
  listStudentInvitations,
} from "@/lib/memberships/membership-service";

export const metadata: Metadata = {
  title: "Student dashboard | Dance Academy",
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

function AssignmentList({
  assignments,
  emptyMessage,
}: {
  assignments: StudentDashboardAssignment[];
  emptyMessage: string;
}) {
  if (assignments.length === 0) {
    return <p className="mt-3 text-sm text-slate-500">{emptyMessage}</p>;
  }

  return (
    <ul className="mt-4 divide-y divide-slate-200">
      {assignments.map((assignment) => (
        <li
          key={assignment.id}
          className="flex flex-wrap items-start justify-between gap-3 py-4 first:pt-0"
        >
          <div>
            <Link
              href={`/student/assignments/${assignment.id}`}
              className="font-medium text-slate-900 hover:text-indigo-700 hover:underline"
            >
              {assignment.title}
            </Link>
            <p className="mt-1 text-sm text-slate-500">
              {assignment.className} · {assignment.teacherUsername}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {assignment.completedAt
                ? `Completed ${dateFormatter.format(assignment.completedAt)}`
                : assignment.dueAt
                  ? `Due ${dateFormatter.format(assignment.dueAt)}`
                  : "No due date"}
            </p>
          </div>
          <span
            className={
              assignment.status === "LATE"
                ? "rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-800"
                : "rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700"
            }
          >
            {statusLabels[assignment.status]}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function StudentDashboard() {
  const user = await requireRole(UserRole.STUDENT);
  const [invitations, classes, overview] = await Promise.all([
    listStudentInvitations(user),
    listStudentClasses(user),
    getStudentDashboardOverview(user),
  ]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-8 sm:px-10">
      <DashboardHeader user={user} />
      <section className="py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-slate-950">
              Student dashboard
            </h1>
            <p className="mt-3 max-w-2xl text-slate-600">
              Keep track of your classes, assignments, and released results.
            </p>
          </div>
          <Link href="/student/history" className="secondary-button">
            View complete history
          </Link>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">
              Pending invitations
            </h2>
            {invitations.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                You have no pending invitations.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200">
                {invitations.map((invitation) => (
                  <li key={invitation.id} className="py-4 first:pt-0">
                    <p className="font-medium text-slate-900">
                      {invitation.className}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Teacher: {invitation.teacherUsername}
                    </p>
                    <div className="mt-3 flex gap-3">
                      <form
                        action={acceptInvitationAction.bind(
                          null,
                          invitation.id,
                        )}
                      >
                        <button type="submit" className="primary-button">
                          Accept
                        </button>
                      </form>
                      <form
                        action={declineInvitationAction.bind(
                          null,
                          invitation.id,
                        )}
                      >
                        <ConfirmSubmitButton
                          confirmMessage={`Decline the invitation to ${invitation.className}?`}
                          pendingLabel="Declining…"
                        >
                          Decline
                        </ConfirmSubmitButton>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Enrolled classes</h2>
            {classes.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                Accepted classes will appear here.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200">
                {classes.map((danceClass) => (
                  <li key={danceClass.id} className="py-4 first:pt-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-900">
                        {danceClass.name}
                      </p>
                      {danceClass.status === ClassStatus.ARCHIVED && (
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          Archived
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      Teacher: {danceClass.teacherUsername}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">
              Upcoming and current
            </h2>
            <AssignmentList
              assignments={overview.upcomingAssignments}
              emptyMessage="You have no upcoming assignments."
            />
          </section>

          <section className="rounded-lg border border-red-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Late assignments</h2>
            <AssignmentList
              assignments={overview.lateAssignments}
              emptyMessage="You have no late assignments."
            />
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-semibold text-slate-900">Completed work</h2>
              <Link
                href="/student/history"
                className="text-sm text-indigo-700 hover:underline"
              >
                All history
              </Link>
            </div>
            <AssignmentList
              assignments={overview.completedAssignments}
              emptyMessage="Completed assignments will appear here."
            />
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Released grades</h2>
            {overview.releasedGrades.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                Grades will appear here after your teacher releases them.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200">
                {overview.releasedGrades.map((grade) => (
                  <li key={grade.id} className="py-4 first:pt-0">
                    <Link
                      href={`/student/grades/${grade.id}`}
                      className="font-medium text-slate-900 hover:text-indigo-700 hover:underline"
                    >
                      {grade.assignmentTitle}
                    </Link>
                    <p className="mt-1 text-sm text-slate-500">
                      {grade.className}
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-700">
                      {grade.finalScore === null
                        ? "Grade released"
                        : `${grade.finalScore}%`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
