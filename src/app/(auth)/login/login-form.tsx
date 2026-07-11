"use client";

import Link from "next/link";
import { useActionState } from "react";

import { loginAction } from "@/app/(auth)/actions";
import type { AuthFormState } from "@/lib/auth/types";

const initialState: AuthFormState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialState);

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
          required
          aria-describedby={
            state.errors?.username ? "username-error" : undefined
          }
          className="auth-input"
        />
        {state.errors?.username && (
          <p id="username-error" className="auth-error">
            {state.errors.username[0]}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="auth-label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          required
          aria-describedby={
            state.errors?.password ? "password-error" : undefined
          }
          className="auth-input"
        />
        {state.errors?.password && (
          <p id="password-error" className="auth-error">
            {state.errors.password[0]}
          </p>
        )}
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
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-center text-sm text-slate-600">
        Need an account?{" "}
        <Link
          href="/register"
          className="font-medium text-indigo-700 hover:underline"
        >
          Register
        </Link>
      </p>
    </form>
  );
}
