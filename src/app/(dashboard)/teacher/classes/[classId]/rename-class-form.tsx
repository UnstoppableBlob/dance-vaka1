"use client";

import { useActionState } from "react";

import { renameClassAction } from "@/app/(dashboard)/teacher/classes/actions";
import type { ClassFormState } from "@/lib/classes/types";

export function RenameClassForm({
  classId,
  currentName,
}: {
  classId: string;
  currentName: string;
}) {
  const renameAction = renameClassAction.bind(null, classId);
  const initialState: ClassFormState = { values: { name: currentName } };
  const [state, action, pending] = useActionState(renameAction, initialState);

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="rename-class" className="auth-label">
          Class name
        </label>
        <input
          id="rename-class"
          name="name"
          defaultValue={state.values?.name ?? currentName}
          minLength={2}
          maxLength={120}
          required
          aria-describedby={
            state.errors?.name ? "rename-class-error" : undefined
          }
          className="auth-input"
        />
        {state.errors?.name && (
          <p id="rename-class-error" className="auth-error">
            {state.errors.name[0]}
          </p>
        )}
      </div>

      {state.message && (
        <p
          role="status"
          className={`text-sm ${state.success ? "text-emerald-700" : "text-red-700"}`}
        >
          {state.message}
        </p>
      )}

      <button type="submit" disabled={pending} className="secondary-button">
        {pending ? "Saving…" : "Save name"}
      </button>
    </form>
  );
}
