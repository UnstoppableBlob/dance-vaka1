"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { UserRole } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/dal";
import { mediaAssetIdSchema } from "@/lib/media/validation";
import {
  StudentAssignmentUnavailableError,
  SubmissionLockedError,
  SubmissionVideoUnavailableError,
  submitAndCompleteAssignment,
} from "@/lib/submissions/submission-service";
import type { SubmissionFormState } from "@/lib/submissions/types";

export async function submitAssignmentAction(
  assignmentId: string,
  _previousState: SubmissionFormState,
  formData: FormData,
): Promise<SubmissionFormState> {
  const actor = await requireRole(UserRole.STUDENT);
  const rawVideoAssetId = formData.get("videoAssetId");
  const parsedVideoAssetId = mediaAssetIdSchema.safeParse(rawVideoAssetId);
  if (!parsedVideoAssetId.success) {
    return {
      errors: { videoAssetId: ["Upload a response video before submitting."] },
    };
  }

  try {
    await submitAndCompleteAssignment(
      actor,
      assignmentId,
      parsedVideoAssetId.data,
    );
  } catch (error) {
    if (error instanceof SubmissionVideoUnavailableError) {
      return { errors: { videoAssetId: [error.message] } };
    }
    if (
      error instanceof SubmissionLockedError ||
      error instanceof StudentAssignmentUnavailableError
    ) {
      return { message: error.message };
    }
    console.error("Assignment submission failed.");
    return {
      message: "The response could not be submitted. Please try again.",
    };
  }

  revalidatePath("/student");
  revalidatePath(`/student/assignments/${assignmentId}`);
  redirect(`/student/assignments/${assignmentId}`);
}
