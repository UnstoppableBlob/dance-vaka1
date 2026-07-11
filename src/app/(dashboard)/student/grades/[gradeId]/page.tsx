import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DashboardHeader } from "@/app/(dashboard)/dashboard-header";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { UserRole } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/dal";
import {
  getStudentReleasedGrade,
  StudentReleasedGradeNotFoundError,
} from "@/lib/dashboard/student-dashboard-service";

export const metadata: Metadata = { title: "Released grade | Dance Academy" };

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

export default async function StudentGradePage({
  params,
}: {
  params: Promise<{ gradeId: string }>;
}) {
  const actor = await requireRole(UserRole.STUDENT);
  const { gradeId } = await params;
  let grade;
  try {
    grade = await getStudentReleasedGrade(actor, gradeId);
  } catch (error) {
    if (error instanceof StudentReleasedGradeNotFoundError) notFound();
    throw error;
  }

  const scoreRows = [
    ["Automated overall", grade.automatedOverall],
    ["Form", grade.formScore],
    ["Activity", grade.activityScore],
    ["Timing", grade.timingScore],
    ["Coverage", grade.coverageScore],
  ] as const;

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-8 sm:px-10">
      <DashboardHeader user={actor} />
      <section className="py-10">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/student" },
            { label: "History", href: "/student/history" },
            { label: grade.assignmentTitle },
          ]}
        />
        <h1 className="mt-6 text-3xl font-semibold text-slate-950">
          {grade.assignmentTitle}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {grade.className} · Released {dateFormatter.format(grade.releasedAt)}
        </p>

        <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Final grade</h2>
          <p className="mt-2 text-3xl font-semibold text-slate-950">
            {grade.finalScore === null ? "Released" : `${grade.finalScore}%`}
          </p>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2">
            {scoreRows.map(([label, score]) => (
              <div key={label} className="rounded bg-slate-50 px-3 py-2">
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="mt-1 font-medium text-slate-800">
                  {score === null ? "Not provided" : `${score}%`}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Teacher feedback</h2>
          <p className="mt-3 whitespace-pre-wrap text-slate-700">
            {grade.feedback || "No written feedback was provided."}
          </p>
          {grade.overrideReason && (
            <p className="mt-4 text-sm text-slate-600">
              Adjustment note: {grade.overrideReason}
            </p>
          )}
        </section>

        <Link
          href={`/student/assignments/${grade.assignmentId}`}
          className="mt-6 inline-block text-sm font-medium text-indigo-700 hover:underline"
        >
          View assignment
        </Link>
      </section>
    </main>
  );
}
