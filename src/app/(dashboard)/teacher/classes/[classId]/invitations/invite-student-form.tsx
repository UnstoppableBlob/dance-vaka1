"use client";

import { useActionState } from "react";

import { inviteStudentAction } from "@/app/(dashboard)/teacher/classes/[classId]/invitations/actions";
import type { InvitationFormState } from "@/lib/invitations/types";

export function InviteStudentForm({ classId }: { classId: string }) {
  const actionWithClass = inviteStudentAction.bind(null, classId);
  const initialState: InvitationFormState = {};
  const [state, action, pending] = useActionState(
    actionWithClass,
    initialState,
  );

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="student-username" className="auth-label">
          Student username
        </label>
        <input
          key={state.success ? state.message : "student-username"}
          id="student-username"
          name="username"
          defaultValue={state.values?.username}
          minLength={3}
          maxLength={30}
          pattern="[A-Za-z0-9_]+"
          title="Enter the student's exact username."
          required
          autoComplete="off"
          aria-describedby="student-username-help student-username-error"
          className="auth-input"
          placeholder="student_username"
        />
        <p id="student-username-help" className="mt-1 text-xs text-slate-500">
          Enter an existing student account exactly; there is no public user
          search.
        </p>
        {state.errors?.username && (
          <p id="student-username-error" className="auth-error">
            {state.errors.username[0]}
          </p>
        )}
      </div>

      {state.message && (
        <p
          role={state.success ? "status" : "alert"}
          className={`text-sm ${state.success ? "text-emerald-700" : "text-red-700"}`}
        >
          {state.message}
        </p>
      )}

      <button type="submit" disabled={pending} className="primary-button">
        {pending ? "Sending…" : "Send invitation"}
      </button>
    </form>
  );
}
