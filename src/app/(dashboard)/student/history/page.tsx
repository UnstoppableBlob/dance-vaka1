import type { Metadata } from "next";
import Link from "next/link";

import { DashboardHeader } from "@/app/(dashboard)/dashboard-header";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { UserRole } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/dal";
import { getStudentHistoryPage } from "@/lib/dashboard/student-dashboard-service";

export const metadata: Metadata = {
  title: "Assignment history | Dance Academy",
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

export default async function StudentHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const actor = await requireRole(UserRole.STUDENT);
  const query = await searchParams;
  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page;
  const history = await getStudentHistoryPage(actor, Number(rawPage ?? 1));

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-8 sm:px-10">
      <DashboardHeader user={actor} />
      <section className="py-10">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/student" },
            { label: "Assignment history" },
          ]}
        />
        <h1 className="mt-6 text-3xl font-semibold text-slate-950">
          Assignment history
        </h1>
        <p className="mt-3 text-slate-600">
          Your completed assignments and any grades your teachers have released.
        </p>

        {history.items.length === 0 ? (
          <p className="mt-8 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">
            You have not completed any assignments yet.
          </p>
        ) : (
          <ul className="mt-8 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white px-5">
            {history.items.map((item) => (
              <li
                key={item.assignmentId}
                className="flex flex-wrap items-start justify-between gap-4 py-5"
              >
                <div>
                  <Link
                    href={`/student/assignments/${item.assignmentId}`}
                    className="font-medium text-slate-900 hover:text-indigo-700 hover:underline"
                  >
                    {item.assignmentTitle}
                  </Link>
                  <p className="mt-1 text-sm text-slate-500">
                    {item.className} · {item.teacherUsername}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Completed {dateFormatter.format(item.completedAt)}
                  </p>
                </div>
                {item.releasedGrade ? (
                  <Link
                    href={`/student/grades/${item.releasedGrade.id}`}
                    className="text-sm font-medium text-indigo-700 hover:underline"
                  >
                    {item.releasedGrade.finalScore === null
                      ? "View released grade"
                      : `${item.releasedGrade.finalScore}% · View grade`}
                  </Link>
                ) : (
                  <span className="text-sm text-slate-500">
                    Grade not released
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {history.totalPages > 1 && (
          <nav
            className="mt-6 flex items-center justify-between"
            aria-label="History pages"
          >
            {history.page > 1 ? (
              <Link
                href={`/student/history?page=${history.page - 1}`}
                className="secondary-button"
              >
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm text-slate-600">
              Page {history.page} of {history.totalPages}
            </span>
            {history.page < history.totalPages ? (
              <Link
                href={`/student/history?page=${history.page + 1}`}
                className="secondary-button"
              >
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
    </main>
  );
}
