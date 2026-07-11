"use server";

import { revalidatePath } from "next/cache";

import { UserRole } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/dal";
import { DanceClassNotFoundError } from "@/lib/classes/class-service";
import {
  ArchivedClassInvitationError,
  cancelClassInvitation,
  InvitationAlreadyPendingError,
  InvitationNotFoundError,
  InvitationTargetNotFoundError,
  inviteStudentToClass,
  StudentAlreadyMemberError,
} from "@/lib/invitations/invitation-service";
import type { InvitationFormState } from "@/lib/invitations/types";
import { inviteStudentSchema } from "@/lib/invitations/validation";
import { normalizeUsername } from "@/lib/auth/validation";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const INVITATION_WINDOW_MS = 60 * 60 * 1000;

function stringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function inviteStudentAction(
  classId: string,
  _previousState: InvitationFormState,
  formData: FormData,
): Promise<InvitationFormState> {
  const actor = await requireRole(UserRole.TEACHER);
  const input = { username: stringValue(formData, "username") };
  const result = inviteStudentSchema.safeParse(input);

  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors, values: input };
  }

  let rateLimits;
  try {
    rateLimits = await Promise.all([
      consumeRateLimit("invitation-teacher", actor.id, {
        limit: 20,
        windowMs: INVITATION_WINDOW_MS,
      }),
      consumeRateLimit(
        "invitation-target",
        `${actor.id}:${normalizeUsername(result.data.username)}`,
        { limit: 5, windowMs: INVITATION_WINDOW_MS },
      ),
    ]);
  } catch {
    console.error("Invitation rate-limit check failed.");
    return {
      message: "We could not send the invitation. Please try again.",
      values: input,
    };
  }
  if (rateLimits.some((limit) => !limit.allowed)) {
    return {
      message: "Too many invitation attempts. Try again later.",
      values: input,
    };
  }

  try {
    const invitation = await inviteStudentToClass(actor, classId, input);
    revalidatePath(`/teacher/classes/${classId}`);
    return {
      success: true,
      message: `Invitation sent to ${invitation.studentUsername}.`,
      values: { username: "" },
    };
  } catch (error) {
    if (
      error instanceof InvitationTargetNotFoundError ||
      error instanceof InvitationAlreadyPendingError ||
      error instanceof StudentAlreadyMemberError
    ) {
      return { errors: { username: [error.message] }, values: input };
    }
    if (
      error instanceof ArchivedClassInvitationError ||
      error instanceof DanceClassNotFoundError
    ) {
      return { message: error.message, values: input };
    }

    console.error("Student invitation failed.");
    return {
      message: "We could not send the invitation. Please try again.",
      values: input,
    };
  }
}

export async function cancelInvitationAction(
  classId: string,
  invitationId: string,
) {
  const actor = await requireRole(UserRole.TEACHER);

  try {
    await cancelClassInvitation(actor, classId, invitationId);
  } catch (error) {
    if (
      error instanceof InvitationNotFoundError ||
      error instanceof DanceClassNotFoundError
    ) {
      return;
    }
    throw error;
  }

  revalidatePath(`/teacher/classes/${classId}`);
}
