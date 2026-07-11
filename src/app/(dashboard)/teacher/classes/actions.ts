"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { UserRole } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/dal";
import {
  archiveTeacherClass,
  ClassNameTakenError,
  createTeacherClass,
  DanceClassNotFoundError,
  renameTeacherClass,
} from "@/lib/classes/class-service";
import type { ClassFormState } from "@/lib/classes/types";
import { createClassSchema, renameClassSchema } from "@/lib/classes/validation";

function stringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function createClassAction(
  _previousState: ClassFormState,
  formData: FormData,
): Promise<ClassFormState> {
  const actor = await requireRole(UserRole.TEACHER);
  const input = {
    name: stringValue(formData, "name"),
    description: stringValue(formData, "description"),
  };
  const result = createClassSchema.safeParse(input);

  if (!result.success) {
    return {
      errors: result.error.flatten().fieldErrors,
      values: input,
    };
  }

  let danceClass;
  try {
    danceClass = await createTeacherClass(actor, input);
  } catch (error) {
    if (error instanceof ClassNameTakenError) {
      return {
        errors: { name: [error.message] },
        values: input,
      };
    }

    console.error("Class creation failed.");
    return {
      message: "We could not create the class. Please try again.",
      values: input,
    };
  }

  revalidatePath("/teacher");
  redirect(`/teacher/classes/${danceClass.id}`);
}

export async function renameClassAction(
  classId: string,
  _previousState: ClassFormState,
  formData: FormData,
): Promise<ClassFormState> {
  const actor = await requireRole(UserRole.TEACHER);
  const input = { name: stringValue(formData, "name") };
  const result = renameClassSchema.safeParse(input);

  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors, values: input };
  }

  try {
    const danceClass = await renameTeacherClass(actor, classId, input);
    revalidatePath("/teacher");
    revalidatePath(`/teacher/classes/${classId}`);
    return {
      success: true,
      message: "Class name updated.",
      values: { name: danceClass.name },
    };
  } catch (error) {
    if (error instanceof ClassNameTakenError) {
      return {
        errors: { name: [error.message] },
        values: input,
      };
    }
    if (error instanceof DanceClassNotFoundError) {
      return { message: "Class not found or unavailable.", values: input };
    }

    console.error("Class rename failed.");
    return {
      message: "We could not rename the class. Please try again.",
      values: input,
    };
  }
}

export async function archiveClassAction(classId: string) {
  const actor = await requireRole(UserRole.TEACHER);

  try {
    await archiveTeacherClass(actor, classId);
  } catch (error) {
    if (error instanceof DanceClassNotFoundError) {
      redirect("/teacher");
    }
    throw error;
  }

  revalidatePath("/teacher");
  revalidatePath(`/teacher/classes/${classId}`);
  redirect("/teacher");
}
