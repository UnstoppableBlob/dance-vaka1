"use client";

import { useActionState, useCallback, useState } from "react";

import {
  createAssignmentAction,
  updateAssignmentAction,
} from "@/app/(dashboard)/teacher/classes/[classId]/assignments/actions";
import { VideoRecorder } from "@/components/media/video-recorder";
import { VideoCaptionNotice } from "@/components/media/video-caption-notice";
import { MediaAssetKind } from "@/generated/prisma/enums";
import type { AssignmentFormState } from "@/lib/assignments/types";
import type { MediaAssetSummary } from "@/lib/media/types";

type AssignmentFormProps = {
  classId: string;
  assignment?: {
    id: string;
    title: string;
    instructions: string;
    dueAtValue: string;
    referenceVideoAssetId: string | null;
    referenceVideoUrl: string | null;
    referenceContentType: string | null;
  };
};

const initialState: AssignmentFormState = {};

export function AssignmentForm({ classId, assignment }: AssignmentFormProps) {
  const action = assignment
    ? updateAssignmentAction.bind(null, classId, assignment.id)
    : createAssignmentAction.bind(null, classId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [referenceVideoAssetId, setReferenceVideoAssetId] = useState(
    assignment?.referenceVideoAssetId ?? "",
  );
  const [showRecorder, setShowRecorder] = useState(
    !assignment?.referenceVideoAssetId,
  );
  const [recorderBusy, setRecorderBusy] = useState(false);
  const [replacementUploaded, setReplacementUploaded] = useState(false);

  const handleUploaded = useCallback((asset: MediaAssetSummary) => {
    setReferenceVideoAssetId(asset.id);
    setReplacementUploaded(true);
  }, []);
  const handleUploadedDiscarded = useCallback(() => {
    setReferenceVideoAssetId(assignment?.referenceVideoAssetId ?? "");
    setReplacementUploaded(false);
  }, [assignment?.referenceVideoAssetId]);
  const handleRecorderBusy = useCallback((busy: boolean) => {
    setRecorderBusy(busy);
  }, []);

  return (
    <form action={formAction} className="space-y-7">
      <div>
        <label htmlFor="title" className="auth-label">
          Assignment title
        </label>
        <input
          id="title"
          name="title"
          className="auth-input"
          defaultValue={assignment?.title ?? ""}
          maxLength={160}
          required
          disabled={pending}
        />
        {state.errors?.title?.map((error) => (
          <p key={error} className="auth-error">
            {error}
          </p>
        ))}
      </div>

      <div>
        <label htmlFor="instructions" className="auth-label">
          Instructions{" "}
          <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <textarea
          id="instructions"
          name="instructions"
          className="auth-input min-h-32 resize-y"
          defaultValue={assignment?.instructions ?? ""}
          maxLength={5000}
          disabled={pending}
        />
        {state.errors?.instructions?.map((error) => (
          <p key={error} className="auth-error">
            {error}
          </p>
        ))}
      </div>

      <div>
        <label htmlFor="dueAt" className="auth-label">
          Due date and time in UTC{" "}
          <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <input
          id="dueAt"
          name="dueAt"
          type="datetime-local"
          className="auth-input max-w-sm"
          defaultValue={assignment?.dueAtValue ?? ""}
          disabled={pending}
        />
        <input type="hidden" name="timezoneOffset" value="0" />
        {state.errors?.dueAt?.map((error) => (
          <p key={error} className="auth-error">
            {error}
          </p>
        ))}
      </div>

      <input
        type="hidden"
        name="referenceVideoAssetId"
        value={referenceVideoAssetId}
      />
      <section>
        <h2 className="font-semibold text-slate-900">Reference video</h2>
        {assignment?.referenceVideoUrl && !showRecorder ? (
          <div className="mt-3">
            <video
              controls
              playsInline
              aria-label="Current assignment reference video"
              className="aspect-video w-full rounded-md bg-slate-950 object-contain"
            >
              <source
                src={assignment.referenceVideoUrl}
                type={assignment.referenceContentType ?? undefined}
              />
              <track
                default
                kind="captions"
                src="data:text/vtt,WEBVTT"
                srcLang="en"
                label="No spoken captions"
              />
            </video>
            <VideoCaptionNotice />
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setReplacementUploaded(false);
                  setShowRecorder(true);
                }}
                disabled={pending}
              >
                Replace video
              </button>
              <button
                type="button"
                className="text-sm font-medium text-red-700 hover:underline"
                onClick={() => {
                  if (
                    !window.confirm(
                      "Remove the current reference video from this draft?",
                    )
                  ) {
                    return;
                  }
                  setReferenceVideoAssetId("");
                  setReplacementUploaded(false);
                  setShowRecorder(true);
                }}
                disabled={pending}
              >
                Remove video
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <VideoRecorder
              kind={MediaAssetKind.REFERENCE_VIDEO}
              title={
                assignment?.referenceVideoAssetId
                  ? "Record a replacement reference video"
                  : "Record a reference video"
              }
              disabled={pending}
              onUploaded={handleUploaded}
              onUploadedDiscarded={handleUploadedDiscarded}
              onBusyChange={handleRecorderBusy}
            />
            {replacementUploaded ? (
              <p className="mt-2 text-sm font-medium text-green-700">
                Uploaded reference selected. Save the draft to attach it.
              </p>
            ) : null}
          </div>
        )}
        {state.errors?.referenceVideoAssetId?.map((error) => (
          <p key={error} className="auth-error">
            {error}
          </p>
        ))}
      </section>

      {state.message ? (
        <p
          className={
            state.message === "Draft saved."
              ? "text-sm text-green-700"
              : "text-sm text-red-700"
          }
          role="status"
        >
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        className="primary-button"
        disabled={pending || recorderBusy}
      >
        {pending ? "Saving…" : assignment ? "Save draft" : "Create draft"}
      </button>
    </form>
  );
}
