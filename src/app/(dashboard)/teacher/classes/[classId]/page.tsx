import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DashboardHeader } from "@/app/(dashboard)/dashboard-header";
import { archiveClassAction } from "@/app/(dashboard)/teacher/classes/actions";
import { RenameClassForm } from "@/app/(dashboard)/teacher/classes/[classId]/rename-class-form";
import { cancelInvitationAction } from "@/app/(dashboard)/teacher/classes/[classId]/invitations/actions";
import { InviteStudentForm } from "@/app/(dashboard)/teacher/classes/[classId]/invitations/invite-student-form";
import { removeStudentAction } from "@/app/(dashboard)/teacher/classes/[classId]/memberships/actions";
import { ConfirmSubmitButton } from "@/components/forms/confirm-submit-button";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import {
  AssignmentStatus,
  ClassStatus,
  UserRole,
} from "@/generated/prisma/enums";
import { listTeacherAssignments } from "@/lib/assignments/assignment-service";
import { requireRole } from "@/lib/auth/dal";
import {
  DanceClassNotFoundError,
  getTeacherClass,
} from "@/lib/classes/class-service";
import { listPendingClassInvitations } from "@/lib/invitations/invitation-service";
import { listActiveClassMembers } from "@/lib/memberships/membership-service";

export const metadata: Metadata = { title: "Class | MotionMatch" };

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
});

export default async function TeacherClassPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const user = await requireRole(UserRole.TEACHER);
  const { classId } = await params;

  let danceClass;
  try {
    danceClass = await getTeacherClass(user, classId);
  } catch (error) {
    if (error instanceof DanceClassNotFoundError) {
      notFound();
    }
    throw error;
  }

  const [pendingInvitations, roster, assignments] = await Promise.all([
    listPendingClassInvitations(user, danceClass.id),
    listActiveClassMembers(user, danceClass.id),
    listTeacherAssignments(user, danceClass.id),
  ]);
  const archiveAction = archiveClassAction.bind(null, danceClass.id);

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-8 sm:px-10">
      <DashboardHeader user={user} />
      <div className="py-8">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/teacher" },
            { label: danceClass.name },
          ]}
        />

        <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold text-slate-950">
                {danceClass.name}
              </h1>
              {danceClass.status === ClassStatus.ARCHIVED && (
                <span className="rounded bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700">
                  Archived
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Created {dateFormatter.format(danceClass.createdAt)} · Updated{" "}
              {dateFormatter.format(danceClass.updatedAt)}
            </p>
          </div>
        </div>

        {danceClass.description && (
          <p className="mt-5 max-w-2xl whitespace-pre-wrap text-slate-600">
            {danceClass.description}
          </p>
        )}

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Class overview</h2>
            <dl className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm text-slate-500">Students</dt>
                <dd className="mt-1 text-2xl font-semibold">
                  {danceClass._count.memberships}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-slate-500">Assignments</dt>
                <dd className="mt-1 text-2xl font-semibold">
                  {danceClass._count.assignments}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Rename class</h2>
            <div className="mt-4">
              <RenameClassForm
                classId={danceClass.id}
                currentName={danceClass.name}
              />
            </div>
          </section>
        </div>

        <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-slate-900">Assignments</h2>
            {danceClass.status === ClassStatus.ACTIVE ? (
              <Link
                href={`/teacher/classes/${danceClass.id}/assignments/new`}
                className="primary-button"
              >
                New assignment
              </Link>
            ) : null}
          </div>
          {assignments.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              No assignment drafts yet.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200">
              {assignments.map((assignment) => (
                <li key={assignment.id} className="py-3 first:pt-0">
                  <Link
                    href={`/teacher/classes/${danceClass.id}/assignments/${assignment.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 hover:text-indigo-700"
                  >
                    <span className="font-medium">{assignment.title}</span>
                    <span className="text-xs text-slate-500">
                      {assignment.status === AssignmentStatus.DRAFT
                        ? "Draft"
                        : assignment.status === AssignmentStatus.PUBLISHED
                          ? `Published · ${assignment.recipientCount} students`
                          : "Archived"}
                      {assignment.referenceVideo ? " · Video ready" : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <h2 className="font-semibold text-slate-900">
                Pending invitations
              </h2>
              {pendingInvitations.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">
                  No students are waiting to respond.
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-slate-200">
                  {pendingInvitations.map((invitation) => {
                    const cancelAction = cancelInvitationAction.bind(
                      null,
                      danceClass.id,
                      invitation.id,
                    );
                    return (
                      <li
                        key={invitation.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
                      >
                        <div>
                          <p className="font-medium text-slate-900">
                            {invitation.studentUsername}
                          </p>
                          <p className="text-xs text-slate-500">
                            Sent {dateFormatter.format(invitation.createdAt)}
                          </p>
                        </div>
                        <form action={cancelAction}>
                          <ConfirmSubmitButton
                            className="inline-flex min-h-11 items-center text-sm font-medium text-red-700 hover:underline"
                            confirmMessage={`Cancel the invitation for ${invitation.studentUsername}?`}
                            pendingLabel="Canceling…"
                          >
                            Cancel
                          </ConfirmSubmitButton>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div>
              <h2 className="font-semibold text-slate-900">Invite a student</h2>
              {danceClass.status === ClassStatus.ACTIVE ? (
                <div className="mt-4">
                  <InviteStudentForm classId={danceClass.id} />
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  Archived classes cannot send new invitations.
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Class roster</h2>
          {roster.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              No students are currently enrolled.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200">
              {roster.map((member) => (
                <li
                  key={member.studentId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
                >
                  <div>
                    <Link
                      href={`/teacher/classes/${danceClass.id}/students/${member.studentId}`}
                      className="font-medium text-slate-900 hover:text-indigo-700 hover:underline"
                    >
                      {member.username}
                    </Link>
                    <p className="text-xs text-slate-500">
                      Joined {dateFormatter.format(member.joinedAt)}
                    </p>
                  </div>
                  <form
                    action={removeStudentAction.bind(
                      null,
                      danceClass.id,
                      member.studentId,
                    )}
                  >
                    <ConfirmSubmitButton
                      className="inline-flex min-h-11 items-center text-sm font-medium text-red-700 hover:underline"
                      confirmMessage={`Remove ${member.username} from this class? Their assignment history will be kept.`}
                      pendingLabel="Removing…"
                    >
                      Remove
                    </ConfirmSubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        {danceClass.status === ClassStatus.ACTIVE && (
          <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Archive class</h2>
            <p className="mt-2 text-sm text-slate-600">
              Archiving removes this class from the active list without deleting
              its history.
            </p>
            <form action={archiveAction} className="mt-4">
              <ConfirmSubmitButton
                confirmMessage={`Archive ${danceClass.name}? Existing history will remain available.`}
                pendingLabel="Archiving…"
              >
                Archive class
              </ConfirmSubmitButton>
            </form>
          </section>
        )}
      </div>
    </main>
  );
}
