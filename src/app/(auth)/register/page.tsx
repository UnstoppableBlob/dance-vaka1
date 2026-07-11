import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RegisterForm } from "@/app/(auth)/register/register-form";
import { dashboardPathForRole } from "@/lib/auth/authorization";
import { getCurrentUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Register | MotionMatch" };

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect(dashboardPathForRole(user.role));
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-semibold text-slate-950">
        Create an account
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Choose your permanent role and a unique username.
      </p>
      <RegisterForm />
    </section>
  );
}
