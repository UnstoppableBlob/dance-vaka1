import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/(auth)/login/login-form";
import { dashboardPathForRole } from "@/lib/auth/authorization";
import { getCurrentUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Sign in | MotionMatch" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect(dashboardPathForRole(user.role));
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-semibold text-slate-950">Sign in</h1>
      <p className="mt-2 text-sm text-slate-600">
        Continue to your teacher or student dashboard.
      </p>
      <LoginForm />
    </section>
  );
}
