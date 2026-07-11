"use client";

import Link from "next/link";
import { useActionState } from "react";

import { registerAction } from "@/app/(auth)/actions";
import { UserRole } from "@/generated/prisma/enums";
import type { AuthFormState } from "@/lib/auth/types";

const initialState: AuthFormState = {};

function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p id={id} className="auth-error">
      {errors[0]}
    </p>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, initialState);

  return (
    <form action={action} className="mt-8 space-y-5">
      <div>
        <label htmlFor="username" className="auth-label">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          defaultValue={state.values?.username}
          minLength={3}
          maxLength={30}
          pattern="[A-Za-z0-9_]+"
          title="Use 3–30 letters, numbers, or underscores."
          required
          aria-describedby={
            state.errors?.username ? "username-error" : undefined
          }
          className="auth-input"
        />
        <FieldError id="username-error" errors={state.errors?.username} />
      </div>

      <fieldset
        aria-describedby={state.errors?.role ? "role-error" : undefined}
      >
        <legend className="auth-label">Account type</legend>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {[
            [UserRole.TEACHER, "Teacher"],
            [UserRole.STUDENT, "Student"],
          ].map(([value, label]) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-3 text-sm"
            >
              <input
                type="radio"
                name="role"
                value={value}
                defaultChecked={state.values?.role === value}
                required
              />
              {label}
            </label>
          ))}
        </div>
        <FieldError id="role-error" errors={state.errors?.role} />
      </fieldset>

      <div>
        <label htmlFor="password" className="auth-label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{12,128}"
          title="Use at least 12 characters with uppercase, lowercase, and a number."
          required
          aria-describedby="password-help password-error"
          className="auth-input"
        />
        <p id="password-help" className="mt-1 text-xs text-slate-500">
          At least 12 characters, including uppercase, lowercase, and a number.
        </p>
        <FieldError id="password-error" errors={state.errors?.password} />
      </div>

      <div>
        <label htmlFor="passwordConfirmation" className="auth-label">
          Confirm password
        </label>
        <input
          id="passwordConfirmation"
          name="passwordConfirmation"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          aria-describedby={
            state.errors?.passwordConfirmation
              ? "password-confirmation-error"
              : undefined
          }
          className="auth-input"
        />
        <FieldError
          id="password-confirmation-error"
          errors={state.errors?.passwordConfirmation}
        />
      </div>

      {state.message && (
        <p
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-700"
        >
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="primary-button w-full"
      >
        {pending ? "Creating account…" : "Create account"}
      </button>

      <p className="text-center text-sm text-slate-600">
        Already registered?{" "}
        <Link
          href="/login"
          className="font-medium text-indigo-700 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
