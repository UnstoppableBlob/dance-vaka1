import { signOutAction } from "@/app/(auth)/actions";
import type { SafeUser } from "@/lib/auth/types";
import Link from "next/link";

export function DashboardHeader({ user }: { user: SafeUser }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
      <div>
        <Link
          href={user.role === "TEACHER" ? "/teacher" : "/student"}
          className="font-semibold text-slate-950 hover:text-indigo-700"
        >
          Dance Academy
        </Link>
        <p className="text-sm text-slate-500">
          {user.username} · {user.role === "TEACHER" ? "Teacher" : "Student"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <nav
          aria-label="Account navigation"
          className="flex items-center gap-1"
        >
          <Link
            href={user.role === "TEACHER" ? "/teacher" : "/student"}
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Dashboard
          </Link>
          {user.role === "STUDENT" ? (
            <Link
              href="/student/history"
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              History
            </Link>
          ) : null}
        </nav>
        <form action={signOutAction}>
          <button type="submit" className="secondary-button">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
