"use client";

import { useActionState, useCallback, useState } from "react";

import { submitAssignmentAction } from "@/app/(dashboard)/student/assignments/actions";
import { VideoCaptionNotice } from "@/components/media/video-caption-notice";
import { VideoRecorder } from "@/components/media/video-recorder";
import { MediaAssetKind } from "@/generated/prisma/enums";
import type { MediaAssetSummary } from "@/lib/media/types";
import type { SubmissionFormState } from "@/lib/submissions/types";

type StudentSubmissionFormProps = {
  assignmentId: string;
  currentSubmission: {
    videoAssetId: string;
    videoUrl: string;
    contentType: string;
    submittedLate: boolean;
    gradingStarted: boolean;
  } | null;
};

const initialState: SubmissionFormState = {};

export function StudentSubmissionForm({
  assignmentId,
  currentSubmission,
}: StudentSubmissionFormProps) {
  const action = submitAssignmentAction.bind(null, assignmentId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [videoAssetId, setVideoAssetId] = useState("");
  const [showRecorder, setShowRecorder] = useState(!currentSubmission);
  const [recorderBusy, setRecorderBusy] = useState(false);
  const [replacementUploaded, setReplacementUploaded] = useState(false);

  const handleUploaded = useCallback((asset: MediaAssetSummary) => {
    setVideoAssetId(asset.id);
    setReplacementUploaded(true);
  }, []);
  const handleUploadedDiscarded = useCallback(() => {
    setVideoAssetId("");
    setReplacementUploaded(false);
  }, []);
  const handleRecorderBusy = useCallback((busy: boolean) => {
    setRecorderBusy(busy);
  }, []);

  return (
    <section className="mt-8" aria-labelledby="response-heading">
      <h2
        id="response-heading"
        className="text-xl font-semibold text-slate-950"
      >
        Your response
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        You may replace your response until grading begins. Once a teacher
        starts grading, replacement is locked.
      </p>

      {currentSubmission && !showRecorder ? (
        <div className="mt-5 rounded-lg border border-slate-200 bg-white p-5">
          <video
            controls
            playsInline
            aria-label="Submitted response video"
            className="aspect-video w-full rounded-md bg-slate-950 object-contain"
          >
            <source
              src={currentSubmission.videoUrl}
              type={currentSubmission.contentType}
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
          <p className="mt-3 text-sm font-medium text-green-700">
            Assignment complete
            {currentSubmission.submittedLate ? " · Submitted late" : ""}
          </p>
          {currentSubmission.gradingStarted ? (
            <p className="mt-2 text-sm text-slate-600">
              Grading has started, so this response is locked.
            </p>
          ) : (
            <button
              type="button"
              className="secondary-button mt-4"
              onClick={() => setShowRecorder(true)}
            >
              Replace response
            </button>
          )}
        </div>
      ) : (
        <form action={formAction} className="mt-5 space-y-4">
          <input type="hidden" name="videoAssetId" value={videoAssetId} />
          <VideoRecorder
            kind={MediaAssetKind.SUBMISSION_VIDEO}
            title={
              currentSubmission
                ? "Record a replacement"
                : "Record your response"
            }
            disabled={pending}
            onUploaded={handleUploaded}
            onUploadedDiscarded={handleUploadedDiscarded}
            onBusyChange={handleRecorderBusy}
          />
          {replacementUploaded ? (
            <p className="text-sm font-medium text-green-700">
              Response uploaded. Submit it to complete the assignment.
            </p>
          ) : null}
          {state.errors?.videoAssetId?.map((error) => (
            <p key={error} className="text-sm text-red-700" role="alert">
              {error}
            </p>
          ))}
          {state.message ? (
            <p
              className={
                state.success
                  ? "text-sm text-green-700"
                  : "text-sm text-red-700"
              }
              role="status"
            >
              {state.message}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className="primary-button"
              disabled={pending || recorderBusy || !videoAssetId}
              onClick={(event) => {
                if (
                  currentSubmission &&
                  !window.confirm(
                    "Replace your completed response with this video?",
                  )
                ) {
                  event.preventDefault();
                }
              }}
            >
              {pending
                ? "Submitting…"
                : currentSubmission
                  ? "Submit replacement"
                  : "Submit and mark complete"}
            </button>
            {currentSubmission ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setVideoAssetId("");
                  setReplacementUploaded(false);
                  setShowRecorder(false);
                }}
                disabled={pending || recorderBusy}
              >
                Cancel replacement
              </button>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}
