import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DashboardHeader } from "@/app/(dashboard)/dashboard-header";
import { StudentSubmissionForm } from "@/app/(dashboard)/student/assignments/[assignmentId]/submission-form";
import { VideoCaptionNotice } from "@/components/media/video-caption-notice";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { UserRole } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/dal";
import {
  createAuthorizedAssignmentReferenceRead,
  createAuthorizedMediaRead,
} from "@/lib/media/media-service";
import {
  getStudentAssignmentDetail,
  StudentAssignmentUnavailableError,
} from "@/lib/submissions/submission-service";

export const metadata: Metadata = {
  title: "Assignment | MotionMatch",
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export default async function StudentAssignmentPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const actor = await requireRole(UserRole.STUDENT);
  const { assignmentId } = await params;
  let assignment;
  try {
    assignment = await getStudentAssignmentDetail(actor, assignmentId);
  } catch (error) {
    if (error instanceof StudentAssignmentUnavailableError) notFound();
    throw error;
  }

  const [referenceRead, responseRead] = await Promise.all([
    createAuthorizedAssignmentReferenceRead(actor, assignment.id),
    assignment.submission
      ? createAuthorizedMediaRead(actor, assignment.submission.videoAssetId)
      : Promise.resolve(null),
  ]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
      <DashboardHeader user={actor} />
      <div className="py-8">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/student" },
            { label: assignment.title },
          ]}
        />
        <h1 className="mt-6 text-3xl font-semibold text-slate-950">
          {assignment.title}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {assignment.className} · {assignment.teacherUsername}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          {assignment.dueAt
            ? `Due ${dateFormatter.format(assignment.dueAt)} UTC`
            : "No due date"}
        </p>

        {assignment.instructions ? (
          <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Instructions</h2>
            <p className="mt-3 whitespace-pre-wrap text-slate-700">
              {assignment.instructions}
            </p>
          </section>
        ) : null}

        <section className="mt-6" aria-labelledby="reference-heading">
          <h2
            id="reference-heading"
            className="text-xl font-semibold text-slate-950"
          >
            Teacher reference
          </h2>
          <video
            controls
            playsInline
            aria-label="Teacher reference video"
            className="mt-4 aspect-video w-full rounded-md bg-slate-950 object-contain"
          >
            <source
              src={referenceRead.readUrl}
              type={referenceRead.contentType}
            />
            <track
              default
              kind="captions"
              src="data:text/vtt,WEBVTT"
              srcLang="en"
              label="No spoken captions"
            />
          </video>
          <VideoCaptionNotice />
        </section>

        <StudentSubmissionForm
          assignmentId={assignment.id}
          currentSubmission={
            assignment.submission && responseRead
              ? {
                  videoAssetId: assignment.submission.videoAssetId,
                  videoUrl: responseRead.readUrl,
                  contentType: responseRead.contentType,
                  submittedLate: assignment.submission.submittedLate,
                  gradingStarted: assignment.submission.gradingStarted,
                }
              : null
          }
        />
      </div>
    </main>
  );
}
