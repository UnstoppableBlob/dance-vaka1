import type { Metadata } from "next";
import Link from "next/link";

import { DashboardHeader } from "@/app/(dashboard)/dashboard-header";
import { CreateClassForm } from "@/app/(dashboard)/teacher/classes/create-class-form";
import { ClassStatus, UserRole } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/dal";
import type { TeacherClassSummary } from "@/lib/classes/types";
import { getTeacherDashboardOverview } from "@/lib/dashboard/teacher-dashboard-service";
import type { DashboardSubmission } from "@/lib/dashboard/types";

export const metadata: Metadata = {
  title: "Teacher dashboard | MotionMatch",
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function ClassCard({ danceClass }: { danceClass: TeacherClassSummary }) {
  return (
    <li>
      <Link
        href={`/teacher/classes/${danceClass.id}`}
        className="block rounded-lg border border-slate-200 bg-white p-5 hover:border-indigo-300"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-950">{danceClass.name}</h3>
            <p className="mt-1 text-sm text-slate-500">
              {danceClass._count.memberships} students ·{" "}
              {danceClass._count.assignments} assignments
            </p>
          </div>
          {danceClass.status === ClassStatus.ARCHIVED ? (
            <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
              Archived
            </span>
          ) : null}
        </div>
        {danceClass.description ? (
          <p className="mt-3 line-clamp-2 text-sm text-slate-600">
            {danceClass.description}
          </p>
        ) : null}
      </Link>
    </li>
  );
}

function SubmissionList({
  submissions,
  emptyMessage,
}: {
  submissions: DashboardSubmission[];
  emptyMessage: string;
}) {
  if (submissions.length === 0) {
    return <p className="mt-3 text-sm text-slate-500">{emptyMessage}</p>;
  }
  return (
    <ul className="mt-4 divide-y divide-slate-200">
      {submissions.map((submission) => (
        <li key={submission.id} className="py-3 first:pt-0">
          <Link
            href={`/teacher/submissions/${submission.id}`}
            className="block hover:text-indigo-700"
          >
            <p className="font-medium">{submission.studentUsername}</p>
            <p className="mt-1 text-sm text-slate-600">
              {submission.assignmentTitle} · {submission.className}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {dateFormatter.format(submission.submittedAt)} UTC
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function TeacherDashboard() {
  const user = await requireRole(UserRole.TEACHER);
  const overview = await getTeacherDashboardOverview(user);
  const activeClasses = overview.classes.filter(
    (danceClass) => danceClass.status === ClassStatus.ACTIVE,
  );
  const archivedClasses = overview.classes.filter(
    (danceClass) => danceClass.status === ClassStatus.ARCHIVED,
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-8 sm:px-10">
      <DashboardHeader user={user} />
      <div className="py-10">
        <h1 className="text-3xl font-semibold text-slate-950">
          Teacher dashboard
        </h1>
        <p className="mt-2 text-slate-600">
          Review class activity and open the work that needs attention.
        </p>

        <dl className="mt-7 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <dt className="text-sm text-slate-500">Active classes</dt>
            <dd className="mt-1 text-2xl font-semibold">
              {activeClasses.length}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <dt className="text-sm text-slate-500">Pending invitations</dt>
            <dd className="mt-1 text-2xl font-semibold">
              {overview.pendingInvitationCount}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <dt className="text-sm text-slate-500">Needs review</dt>
            <dd className="mt-1 text-2xl font-semibold">
              {overview.needsReviewCount}
            </dd>
          </div>
        </dl>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Needs review</h2>
            <SubmissionList
              submissions={overview.needsReview}
              emptyMessage="No completed work is waiting for review."
            />
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Recent submissions</h2>
            <SubmissionList
              submissions={overview.recentSubmissions}
              emptyMessage="No student submissions yet."
            />
          </section>
        </div>

        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">
            Published assignment progress
          </h2>
          {overview.assignmentProgress.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              Published assignments will show completion counts here.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200">
              {overview.assignmentProgress.map((assignment) => (
                <li key={assignment.id} className="py-3 first:pt-0">
                  <Link
                    href={`/teacher/classes/${assignment.classId}/assignments/${assignment.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 hover:text-indigo-700"
                  >
                    <span>
                      <span className="font-medium">{assignment.title}</span>
                      <span className="ml-2 text-sm text-slate-500">
                        {assignment.className}
                      </span>
                    </span>
                    <span className="text-sm font-medium">
                      {assignment.completedCount}/{assignment.recipientCount}{" "}
                      complete
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Pending invitations</h2>
          {overview.pendingInvitations.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              No students are waiting to respond.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200">
              {overview.pendingInvitations.map((invitation) => (
                <li key={invitation.id} className="py-3 first:pt-0">
                  <Link
                    href={`/teacher/classes/${invitation.classId}`}
                    className="flex flex-wrap items-center justify-between gap-3 hover:text-indigo-700"
                  >
                    <span className="font-medium">
                      {invitation.studentUsername}
                    </span>
                    <span className="text-sm text-slate-500">
                      {invitation.className}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section>
            <h2 className="text-xl font-semibold text-slate-950">
              Your classes
            </h2>
            {activeClasses.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-8 text-center">
                <p className="text-sm text-slate-600">
                  Use the form to create your first class.
                </p>
              </div>
            ) : (
              <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                {activeClasses.map((danceClass) => (
                  <ClassCard key={danceClass.id} danceClass={danceClass} />
                ))}
              </ul>
            )}

            {archivedClasses.length > 0 ? (
              <section className="mt-8">
                <h3 className="font-semibold text-slate-900">
                  Archived classes
                </h3>
                <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                  {archivedClasses.map((danceClass) => (
                    <ClassCard key={danceClass.id} danceClass={danceClass} />
                  ))}
                </ul>
              </section>
            ) : null}
          </section>

          <aside>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">
              Create a class
            </h2>
            <CreateClassForm />
          </aside>
        </div>
      </div>
    </main>
  );
}
