import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DashboardHeader } from "@/app/(dashboard)/dashboard-header";
import {
  archiveAssignmentAction,
  publishAssignmentAction,
} from "@/app/(dashboard)/teacher/classes/[classId]/assignments/actions";
import { AssignmentForm } from "@/app/(dashboard)/teacher/classes/[classId]/assignments/assignment-form";
import { ConfirmSubmitButton } from "@/components/forms/confirm-submit-button";
import { VideoCaptionNotice } from "@/components/media/video-caption-notice";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import {
  AssignmentStatus,
  ClassStatus,
  UserRole,
} from "@/generated/prisma/enums";
import {
  AssignmentNotFoundError,
  getTeacherAssignment,
} from "@/lib/assignments/assignment-service";
import { requireRole } from "@/lib/auth/dal";
import {
  DanceClassNotFoundError,
  getTeacherClass,
} from "@/lib/classes/class-service";
import { createAuthorizedMediaRead } from "@/lib/media/media-service";

export const metadata: Metadata = {
  title: "Assignment | Dance Academy",
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function assignmentStatusLabel(status: AssignmentStatus) {
  if (status === AssignmentStatus.DRAFT) return "Draft";
  if (status === AssignmentStatus.PUBLISHED) return "Published";
  return "Archived";
}

export default async function AssignmentPage({
  params,
}: {
  params: Promise<{ classId: string; assignmentId: string }>;
}) {
  const actor = await requireRole(UserRole.TEACHER);
  const { classId, assignmentId } = await params;
  let assignment;
  let danceClass;
  try {
    [assignment, danceClass] = await Promise.all([
      getTeacherAssignment(actor, classId, assignmentId),
      getTeacherClass(actor, classId),
    ]);
  } catch (error) {
    if (
      error instanceof AssignmentNotFoundError ||
      error instanceof DanceClassNotFoundError
    ) {
      notFound();
    }
    throw error;
  }

  const referenceRead = assignment.referenceVideo
    ? await createAuthorizedMediaRead(actor, assignment.referenceVideo.id)
    : null;
  const archiveAction = archiveAssignmentAction.bind(
    null,
    classId,
    assignment.id,
  );
  const publishAction = publishAssignmentAction.bind(
    null,
    classId,
    assignment.id,
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
      <DashboardHeader user={actor} />
      <div className="py-8">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/teacher" },
            { label: danceClass.name, href: `/teacher/classes/${classId}` },
            { label: assignment.title },
          ]}
        />
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold text-slate-950">
            {assignment.title}
          </h1>
          <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
            {assignmentStatusLabel(assignment.status)}
          </span>
        </div>

        {assignment.status === AssignmentStatus.DRAFT &&
        danceClass.status === ClassStatus.ACTIVE ? (
          <div className="mt-8">
            <AssignmentForm
              classId={classId}
              assignment={{
                id: assignment.id,
                title: assignment.title,
                instructions: assignment.instructions ?? "",
                dueAtValue: assignment.dueAt
                  ? assignment.dueAt.toISOString().slice(0, 16)
                  : "",
                referenceVideoAssetId: assignment.referenceVideo?.id ?? null,
                referenceVideoUrl: referenceRead?.readUrl ?? null,
                referenceContentType:
                  assignment.referenceVideo?.contentType ?? null,
              }}
            />
            <div className="mt-10 grid gap-6 border-t border-slate-200 pt-6 sm:grid-cols-2">
              <section>
                <h2 className="font-semibold text-slate-900">Publish draft</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Publishing assigns this work to the students currently in the
                  class and locks the draft.
                </p>
                {assignment.referenceVideo ? (
                  <form action={publishAction} className="mt-4">
                    <ConfirmSubmitButton
                      className="primary-button"
                      confirmMessage="Publish this assignment to the current class roster? The draft will be locked."
                      pendingLabel="Publishing…"
                    >
                      Publish assignment
                    </ConfirmSubmitButton>
                  </form>
                ) : (
                  <p className="mt-3 text-sm text-amber-800">
                    Save a ready reference video before publishing.
                  </p>
                )}
              </section>
              <section>
                <h2 className="font-semibold text-slate-900">Archive draft</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Archiving keeps the assignment history but prevents further
                  editing.
                </p>
                <form action={archiveAction} className="mt-4">
                  <ConfirmSubmitButton
                    confirmMessage="Archive this assignment draft? It will become read-only."
                    pendingLabel="Archiving…"
                  >
                    Archive assignment
                  </ConfirmSubmitButton>
                </form>
              </section>
            </div>
          </div>
        ) : (
          <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
            {assignment.status === AssignmentStatus.DRAFT ? (
              <p className="mb-5 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                This draft is read-only because the class is archived.
              </p>
            ) : null}
            <dl className="space-y-4">
              {assignment.status === AssignmentStatus.PUBLISHED ? (
                <>
                  <div>
                    <dt className="text-sm font-medium text-slate-500">
                      Published
                    </dt>
                    <dd className="mt-1 text-slate-900">
                      {assignment.publishedAt
                        ? `${dateTimeFormatter.format(assignment.publishedAt)} UTC`
                        : "Published"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-slate-500">
                      Assigned students
                    </dt>
                    <dd className="mt-1 text-slate-900">
                      {assignment.recipientCount}
                    </dd>
                  </div>
                </>
              ) : null}
              <div>
                <dt className="text-sm font-medium text-slate-500">Due date</dt>
                <dd className="mt-1 text-slate-900">
                  {assignment.dueAt
                    ? `${dateTimeFormatter.format(assignment.dueAt)} UTC`
                    : "No due date"}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-500">
                  Instructions
                </dt>
                <dd className="mt-1 whitespace-pre-wrap text-slate-900">
                  {assignment.instructions || "No instructions"}
                </dd>
              </div>
            </dl>
            {referenceRead ? (
              <>
                <video
                  controls
                  playsInline
                  aria-label="Assignment reference video"
                  className="mt-6 aspect-video w-full rounded-md bg-slate-950 object-contain"
                >
                  <source
                    src={referenceRead.readUrl}
                    type={assignment.referenceVideo?.contentType}
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
              </>
            ) : null}
            {assignment.status === AssignmentStatus.DRAFT ? (
              <form action={archiveAction} className="mt-6">
                <ConfirmSubmitButton
                  confirmMessage="Archive this assignment draft? It will become read-only."
                  pendingLabel="Archiving…"
                >
                  Archive assignment
                </ConfirmSubmitButton>
              </form>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}
