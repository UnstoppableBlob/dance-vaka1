"use client";

import { useActionState } from "react";

import { createClassAction } from "@/app/(dashboard)/teacher/classes/actions";
import type { ClassFormState } from "@/lib/classes/types";

const initialState: ClassFormState = {};

export function CreateClassForm() {
  const [state, action, pending] = useActionState(
    createClassAction,
    initialState,
  );

  return (
    <form
      action={action}
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
    >
      <div>
        <label htmlFor="class-name" className="auth-label">
          Class name
        </label>
        <input
          id="class-name"
          name="name"
          defaultValue={state.values?.name}
          minLength={2}
          maxLength={120}
          required
          aria-describedby={state.errors?.name ? "class-name-error" : undefined}
          className="auth-input"
          placeholder="Tuesday beginners"
        />
        {state.errors?.name && (
          <p id="class-name-error" className="auth-error">
            {state.errors.name[0]}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="class-description" className="auth-label">
          Description{" "}
          <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <textarea
          id="class-description"
          name="description"
          defaultValue={state.values?.description}
          maxLength={1000}
          rows={3}
          aria-describedby={
            state.errors?.description ? "class-description-error" : undefined
          }
          className="auth-input resize-y"
          placeholder="Level, schedule, or a short note"
        />
        {state.errors?.description && (
          <p id="class-description-error" className="auth-error">
            {state.errors.description[0]}
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

      <button type="submit" disabled={pending} className="primary-button">
        {pending ? "Creating…" : "Create class"}
      </button>
    </form>
  );
}
