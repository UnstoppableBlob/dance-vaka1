import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DashboardHeader } from "@/app/(dashboard)/dashboard-header";
import { submitGradeAction } from "@/app/(dashboard)/teacher/classes/[classId]/students/[studentId]/assignments/[assignmentId]/grade/actions";
import { PoseAnalysis } from "@/components/grading/pose-analysis";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { UserRole } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/dal";
import {
  getTeacherGradingContext,
  TeacherGradingContextNotFoundError,
} from "@/lib/history/teacher-student-history-service";
import {
  createAuthorizedMediaRead,
  createAuthorizedTeacherSubmissionRead,
} from "@/lib/media/media-service";

export const metadata: Metadata = {
  title: "Grade submission | MotionMatch",
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export default async function TeacherGradingPage({
  params,
}: {
  params: Promise<{
    classId: string;
    studentId: string;
    assignmentId: string;
  }>;
}) {
  const actor = await requireRole(UserRole.TEACHER);
  const { classId, studentId, assignmentId } = await params;
  let context;
  try {
    context = await getTeacherGradingContext(
      actor,
      classId,
      studentId,
      assignmentId,
    );
  } catch (error) {
    if (error instanceof TeacherGradingContextNotFoundError) notFound();
    throw error;
  }

  const [referenceRead, submissionRead] = await Promise.all([
    createAuthorizedMediaRead(actor, context.referenceVideo.id),
    createAuthorizedTeacherSubmissionRead(actor, context.submission.id),
  ]);
  const gradeAction = submitGradeAction.bind(
    null,
    context.classId,
    context.studentId,
    context.assignmentId,
    context.submission.id,
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <DashboardHeader user={actor} />
      <div className="py-8">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/teacher" },
            {
              label: context.className,
              href: `/teacher/classes/${context.classId}`,
            },
            {
              label: context.studentUsername,
              href: `/teacher/classes/${context.classId}/students/${context.studentId}`,
            },
            { label: context.assignmentTitle },
          ]}
        />
        <h1 className="mt-6 text-3xl font-semibold text-slate-950">
          {context.assignmentTitle}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {context.studentUsername} · {context.className} · Submitted{" "}
          {dateFormatter.format(context.submission.submittedAt)} UTC
        </p>

        <PoseAnalysis
          reference={{
            url: referenceRead.readUrl,
            contentType: referenceRead.contentType,
          }}
          submission={{
            url: submissionRead.readUrl,
            contentType: submissionRead.contentType,
          }}
          initialGrade={context.grade}
          gradeAction={gradeAction}
        />

        <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Grading status</h2>
          <p className="mt-2 text-sm text-slate-600">
            {context.gradeStatus === "NOT_STARTED"
              ? "Not started"
              : context.gradeStatus === "DRAFT"
                ? "Draft"
                : "Released"}
          </p>
          <p className="mt-3 text-sm text-slate-500">
            Analysis stays in this browser. Only the score summary, override
            reason, and written feedback are saved.
          </p>
        </section>
      </div>
    </main>
  );
}
