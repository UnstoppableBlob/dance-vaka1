"use client";

import { useActionState, useState } from "react";

import type {
  GradeAnalysisDetails,
  GradeFormState,
  TeacherGradeView,
} from "@/lib/grades/types";

export type GradeAnalysisDraft = {
  automatedOverall: number;
  formScore: number | null;
  activityScore: number | null;
  timingScore: number | null;
  coverageScore: number;
  analysisDetails: GradeAnalysisDetails;
};

export type GradeAction = (
  previousState: GradeFormState,
  formData: FormData,
) => Promise<GradeFormState>;

const initialState: GradeFormState = {};

function persistedAnalysis(
  grade: TeacherGradeView | null,
): GradeAnalysisDraft | null {
  if (
    !grade ||
    grade.automatedOverall === null ||
    grade.coverageScore === null ||
    !grade.analysisDetails
  ) {
    return null;
  }
  return {
    automatedOverall: grade.automatedOverall,
    formScore: grade.formScore,
    activityScore: grade.activityScore,
    timingScore: grade.timingScore,
    coverageScore: grade.coverageScore,
    analysisDetails: grade.analysisDetails,
  };
}

export function GradeEditor({
  currentAnalysis,
  initialGrade,
  action,
}: {
  currentAnalysis: GradeAnalysisDraft | null;
  initialGrade: TeacherGradeView | null;
  action: GradeAction;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [useOverride, setUseOverride] = useState(
    Boolean(initialGrade?.overrideReason),
  );
  const analysis = currentAnalysis ?? persistedAnalysis(initialGrade);
  const released =
    initialGrade?.status === "RELEASED" || state.status === "RELEASED";
  const scoreErrors = [
    ...(state.errors?.automatedOverall ?? []),
    ...(state.errors?.formScore ?? []),
    ...(state.errors?.activityScore ?? []),
    ...(state.errors?.timingScore ?? []),
    ...(state.errors?.coverageScore ?? []),
  ];

  if (!analysis) {
    return (
      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Grade and feedback</h2>
        <p className="mt-2 text-sm text-slate-600">
          Run the browser analysis before saving or releasing a grade.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-semibold text-slate-900">Grade and feedback</h2>
      <p className="mt-1 text-sm text-slate-500">
        {released
          ? "This grade has been released and is now read-only."
          : "Save a private draft, or release the current values to the student."}
      </p>

      {!currentAnalysis && initialGrade ? (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          {[
            ["Automated", analysis.automatedOverall],
            ["Form", analysis.formScore],
            ["Activity", analysis.activityScore],
            ["Timing", analysis.timingScore],
            ["Coverage", analysis.coverageScore],
            ["Final", initialGrade.finalScore],
          ].map(([label, score]) => (
            <div key={label} className="rounded bg-slate-50 px-3 py-2">
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="mt-1 font-medium text-slate-800">
                {score === null ? "Not provided" : `${score}%`}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <form action={formAction} className="mt-5 space-y-5">
        <input
          type="hidden"
          name="automatedOverall"
          value={analysis.automatedOverall}
        />
        <input
          type="hidden"
          name="formScore"
          value={analysis.formScore ?? ""}
        />
        <input
          type="hidden"
          name="activityScore"
          value={analysis.activityScore ?? ""}
        />
        <input
          type="hidden"
          name="timingScore"
          value={analysis.timingScore ?? ""}
        />
        <input
          type="hidden"
          name="coverageScore"
          value={analysis.coverageScore}
        />
        <input
          type="hidden"
          name="analysisDetails"
          value={JSON.stringify(analysis.analysisDetails)}
        />

        <div>
          <label htmlFor="grade-feedback" className="auth-label">
            Written feedback{" "}
            <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <textarea
            id="grade-feedback"
            name="feedback"
            className="auth-input min-h-28 resize-y"
            maxLength={5000}
            defaultValue={initialGrade?.feedback ?? ""}
            disabled={pending || released}
          />
          {state.errors?.feedback?.map((message) => (
            <p key={message} className="auth-error">
              {message}
            </p>
          ))}
        </div>

        <div className="rounded-md bg-slate-50 p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <input
              type="checkbox"
              name="useOverride"
              checked={useOverride}
              onChange={(event) => setUseOverride(event.target.checked)}
              disabled={pending || released}
            />
            Override the {analysis.automatedOverall}% automated estimate
          </label>
          {useOverride ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="override-score" className="auth-label">
                  Final score
                </label>
                <input
                  id="override-score"
                  name="overrideScore"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  required
                  className="auth-input"
                  defaultValue={
                    initialGrade?.finalScore ?? analysis.automatedOverall
                  }
                  disabled={pending || released}
                />
                {state.errors?.overrideScore?.map((message) => (
                  <p key={message} className="auth-error">
                    {message}
                  </p>
                ))}
              </div>
              <div>
                <label htmlFor="override-reason" className="auth-label">
                  Required reason
                </label>
                <textarea
                  id="override-reason"
                  name="overrideReason"
                  required
                  maxLength={1000}
                  className="auth-input min-h-20 resize-y"
                  defaultValue={initialGrade?.overrideReason ?? ""}
                  disabled={pending || released}
                />
                {state.errors?.overrideReason?.map((message) => (
                  <p key={message} className="auth-error">
                    {message}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {state.errors?.analysisDetails?.map((message) => (
          <p key={message} className="auth-error">
            {message}
          </p>
        ))}
        {scoreErrors.map((message) => (
          <p key={message} className="auth-error">
            {message}
          </p>
        ))}
        {state.message ? (
          <p
            className={
              state.success ? "text-sm text-emerald-700" : "auth-error"
            }
            role="status"
          >
            {state.message}
          </p>
        ) : null}

        {!released ? (
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              name="intent"
              value="draft"
              className="secondary-button"
              disabled={pending}
            >
              {pending ? "Saving…" : "Save draft"}
            </button>
            <button
              type="submit"
              name="intent"
              value="release"
              className="primary-button"
              disabled={pending}
              onClick={(event) => {
                if (
                  !window.confirm(
                    "Release this grade to the student? It cannot be edited afterward.",
                  )
                ) {
                  event.preventDefault();
                }
              }}
            >
              {pending ? "Saving…" : "Save and release"}
            </button>
          </div>
        ) : null}
      </form>
    </section>
  );
}
