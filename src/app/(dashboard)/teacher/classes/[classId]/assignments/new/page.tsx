import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DashboardHeader } from "@/app/(dashboard)/dashboard-header";
import { AssignmentForm } from "@/app/(dashboard)/teacher/classes/[classId]/assignments/assignment-form";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { ClassStatus, UserRole } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/dal";
import {
  DanceClassNotFoundError,
  getTeacherClass,
} from "@/lib/classes/class-service";

export const metadata: Metadata = {
  title: "New assignment | Dance Academy",
};

export default async function NewAssignmentPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const actor = await requireRole(UserRole.TEACHER);
  const { classId } = await params;
  let danceClass;
  try {
    danceClass = await getTeacherClass(actor, classId);
  } catch (error) {
    if (error instanceof DanceClassNotFoundError) notFound();
    throw error;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
      <DashboardHeader user={actor} />
      <div className="py-8">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/teacher" },
            {
              label: danceClass.name,
              href: `/teacher/classes/${danceClass.id}`,
            },
            { label: "New assignment" },
          ]}
        />
        <h1 className="mt-6 text-3xl font-semibold text-slate-950">
          New assignment draft
        </h1>
        {danceClass.status === ClassStatus.ARCHIVED ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            This class is archived, so new assignments cannot be created.
          </p>
        ) : (
          <div className="mt-8">
            <AssignmentForm classId={danceClass.id} />
          </div>
        )}
      </div>
    </main>
  );
}
