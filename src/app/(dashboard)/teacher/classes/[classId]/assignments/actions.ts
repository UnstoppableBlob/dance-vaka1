"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { UserRole } from "@/generated/prisma/enums";
import {
  archiveAssignmentDraft,
  ArchivedClassAssignmentError,
  AssignmentNotEditableError,
  AssignmentNotFoundError,
  AssignmentNotPublishableError,
  AssignmentPublishReferenceRequiredError,
  AssignmentTitleTakenError,
  createAssignmentDraft,
  publishAssignmentDraft,
  ReferenceVideoUnavailableError,
  updateAssignmentDraft,
} from "@/lib/assignments/assignment-service";
import type { AssignmentFormState } from "@/lib/assignments/types";
import {
  assignmentDraftSchema,
  parseLocalDueDate,
} from "@/lib/assignments/validation";
import { requireRole } from "@/lib/auth/dal";
import { DanceClassNotFoundError } from "@/lib/classes/class-service";

function stringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function parseDraftForm(
  formData: FormData,
):
  | { success: true; data: ReturnType<typeof assignmentDraftSchema.parse> }
  | { success: false; state: AssignmentFormState } {
  const dueAtValue = stringValue(formData, "dueAt");
  let dueAt: Date | null;
  try {
    dueAt = parseLocalDueDate(
      dueAtValue,
      stringValue(formData, "timezoneOffset"),
    );
  } catch (error) {
    return {
      success: false,
      state: {
        errors: {
          dueAt: [
            error instanceof Error
              ? error.message
              : "Enter a valid due date and time.",
          ],
        },
      },
    };
  }

  const referenceVideoAssetId = stringValue(formData, "referenceVideoAssetId");
  const result = assignmentDraftSchema.safeParse({
    title: stringValue(formData, "title"),
    instructions: stringValue(formData, "instructions"),
    dueAt,
    referenceVideoAssetId: referenceVideoAssetId || null,
  });
  if (!result.success) {
    return {
      success: false,
      state: { errors: result.error.flatten().fieldErrors },
    };
  }
  return { success: true, data: result.data };
}

function assignmentErrorState(error: unknown): AssignmentFormState | null {
  if (error instanceof AssignmentTitleTakenError) {
    return { errors: { title: [error.message] } };
  }
  if (error instanceof ReferenceVideoUnavailableError) {
    return { errors: { referenceVideoAssetId: [error.message] } };
  }
  if (
    error instanceof ArchivedClassAssignmentError ||
    error instanceof AssignmentNotEditableError ||
    error instanceof AssignmentNotFoundError ||
    error instanceof DanceClassNotFoundError
  ) {
    return { message: error.message };
  }
  return null;
}

export async function createAssignmentAction(
  classId: string,
  _previousState: AssignmentFormState,
  formData: FormData,
): Promise<AssignmentFormState> {
  const actor = await requireRole(UserRole.TEACHER);
  const parsed = parseDraftForm(formData);
  if (!parsed.success) return parsed.state;

  let assignmentId: string;
  try {
    const assignment = await createAssignmentDraft(actor, classId, parsed.data);
    assignmentId = assignment.id;
  } catch (error) {
    const state = assignmentErrorState(error);
    if (state) return state;
    console.error("Assignment draft creation failed.");
    return {
      message: "The assignment could not be created. Please try again.",
    };
  }

  revalidatePath(`/teacher/classes/${classId}`);
  redirect(`/teacher/classes/${classId}/assignments/${assignmentId}`);
}

export async function updateAssignmentAction(
  classId: string,
  assignmentId: string,
  _previousState: AssignmentFormState,
  formData: FormData,
): Promise<AssignmentFormState> {
  const actor = await requireRole(UserRole.TEACHER);
  const parsed = parseDraftForm(formData);
  if (!parsed.success) return parsed.state;

  try {
    await updateAssignmentDraft(actor, classId, assignmentId, parsed.data);
  } catch (error) {
    const state = assignmentErrorState(error);
    if (state) return state;
    console.error("Assignment draft update failed.");
    return { message: "The assignment could not be saved. Please try again." };
  }

  revalidatePath(`/teacher/classes/${classId}`);
  revalidatePath(`/teacher/classes/${classId}/assignments/${assignmentId}`);
  return { message: "Draft saved." };
}

export async function archiveAssignmentAction(
  classId: string,
  assignmentId: string,
) {
  const actor = await requireRole(UserRole.TEACHER);
  try {
    await archiveAssignmentDraft(actor, classId, assignmentId);
  } catch (error) {
    if (
      error instanceof AssignmentNotFoundError ||
      error instanceof AssignmentNotEditableError ||
      error instanceof DanceClassNotFoundError
    ) {
      return;
    }
    throw error;
  }
  revalidatePath(`/teacher/classes/${classId}`);
  revalidatePath(`/teacher/classes/${classId}/assignments/${assignmentId}`);
}

export async function publishAssignmentAction(
  classId: string,
  assignmentId: string,
) {
  const actor = await requireRole(UserRole.TEACHER);
  try {
    await publishAssignmentDraft(actor, classId, assignmentId);
  } catch (error) {
    if (
      error instanceof AssignmentNotFoundError ||
      error instanceof AssignmentNotPublishableError ||
      error instanceof AssignmentPublishReferenceRequiredError ||
      error instanceof ArchivedClassAssignmentError ||
      error instanceof DanceClassNotFoundError
    ) {
      return;
    }
    throw error;
  }
  revalidatePath(`/teacher/classes/${classId}`);
  revalidatePath(`/teacher/classes/${classId}/assignments/${assignmentId}`);
  revalidatePath("/student");
}
