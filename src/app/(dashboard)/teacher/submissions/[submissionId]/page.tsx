import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DashboardHeader } from "@/app/(dashboard)/dashboard-header";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { UserRole } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/dal";
import {
  getTeacherSubmissionDetail,
  TeacherSubmissionNotFoundError,
} from "@/lib/dashboard/teacher-dashboard-service";

export const metadata: Metadata = {
  title: "Student submission | Dance Academy",
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export default async function TeacherSubmissionPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const actor = await requireRole(UserRole.TEACHER);
  const { submissionId } = await params;
  let submission;
  try {
    submission = await getTeacherSubmissionDetail(actor, submissionId);
  } catch (error) {
    if (error instanceof TeacherSubmissionNotFoundError) notFound();
    throw error;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-8 sm:px-10">
      <DashboardHeader user={actor} />
      <div className="py-8">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/teacher" },
            { label: `${submission.studentUsername}'s submission` },
          ]}
        />
        <h1 className="mt-6 text-3xl font-semibold text-slate-950">
          {submission.studentUsername}&apos;s submission
        </h1>
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
          <dl className="space-y-4">
            <div>
              <dt className="text-sm font-medium text-slate-500">Assignment</dt>
              <dd className="mt-1">
                <Link
                  href={`/teacher/classes/${submission.classId}/assignments/${submission.assignmentId}`}
                  className="font-medium text-indigo-700 hover:underline"
                >
                  {submission.assignmentTitle}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-slate-500">Class</dt>
              <dd className="mt-1">
                <Link
                  href={`/teacher/classes/${submission.classId}`}
                  className="text-indigo-700 hover:underline"
                >
                  {submission.className}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-slate-500">Submitted</dt>
              <dd className="mt-1">
                {dateFormatter.format(submission.submittedAt)} UTC
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-slate-500">
                Grade status
              </dt>
              <dd className="mt-1">
                {submission.gradeStatus ?? "Not started"}
              </dd>
            </div>
          </dl>
          <p className="mt-6 text-sm text-slate-500">
            Open the grading page to review the private reference and response
            videos together.
          </p>
          <Link
            href={`/teacher/classes/${submission.classId}/students/${submission.studentId}/assignments/${submission.assignmentId}/grade`}
            className="primary-button mt-4"
          >
            Open grading page
          </Link>
        </section>
      </div>
    </main>
  );
}
