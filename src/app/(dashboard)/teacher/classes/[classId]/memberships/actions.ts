"use server";

import { revalidatePath } from "next/cache";

import { UserRole } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/dal";
import { DanceClassNotFoundError } from "@/lib/classes/class-service";
import {
  MembershipNotFoundError,
  removeStudentFromClass,
} from "@/lib/memberships/membership-service";

export async function removeStudentAction(classId: string, studentId: string) {
  const actor = await requireRole(UserRole.TEACHER);
  try {
    await removeStudentFromClass(actor, classId, studentId);
  } catch (error) {
    if (
      error instanceof MembershipNotFoundError ||
      error instanceof DanceClassNotFoundError
    ) {
      return;
    }
    throw error;
  }
  revalidatePath(`/teacher/classes/${classId}`);
  revalidatePath("/teacher");
}
