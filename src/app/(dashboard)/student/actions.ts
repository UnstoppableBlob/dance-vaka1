"use server";

import { revalidatePath } from "next/cache";

import { UserRole } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/dal";
import {
  acceptClassInvitation,
  declineClassInvitation,
  InvitationUnavailableError,
} from "@/lib/memberships/membership-service";

async function respondToInvitation(
  invitationId: string,
  response: "accept" | "decline",
) {
  const actor = await requireRole(UserRole.STUDENT);
  try {
    if (response === "accept") {
      await acceptClassInvitation(actor, invitationId);
    } else {
      await declineClassInvitation(actor, invitationId);
    }
  } catch (error) {
    if (!(error instanceof InvitationUnavailableError)) {
      throw error;
    }
  }
  revalidatePath("/student");
}

export async function acceptInvitationAction(invitationId: string) {
  await respondToInvitation(invitationId, "accept");
}

export async function declineInvitationAction(invitationId: string) {
  await respondToInvitation(invitationId, "decline");
}
