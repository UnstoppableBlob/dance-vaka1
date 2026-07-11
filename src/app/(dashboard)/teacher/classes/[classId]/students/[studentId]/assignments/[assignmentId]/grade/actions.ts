"use server";

import { revalidatePath } from "next/cache";

import { UserRole } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/dal";
import {
  GradeSubmissionUnavailableError,
  ReleasedGradeLockedError,
  saveAndReleaseTeacherGrade,
  saveTeacherGradeDraft,
} from "@/lib/grades/grade-service";
import type { GradeFormState } from "@/lib/grades/types";
import { teacherGradeInputSchema } from "@/lib/grades/validation";

function stringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function nullableScore(formData: FormData, key: string) {
  const value = stringValue(formData, key);
  return value === "" ? null : Number(value);
}

function requiredScore(formData: FormData, key: string) {
  const value = stringValue(formData, key);
  return value === "" ? Number.NaN : Number(value);
}

function parseGradeForm(
  formData: FormData,
):
  | { success: true; data: ReturnType<typeof teacherGradeInputSchema.parse> }
  | { success: false; state: GradeFormState } {
  const rawDetails = stringValue(formData, "analysisDetails");
  if (!rawDetails || rawDetails.length > 20_000) {
    return {
      success: false,
      state: {
        errors: { analysisDetails: ["Run the analysis again before saving."] },
      },
    };
  }

  let analysisDetails: unknown;
  try {
    analysisDetails = JSON.parse(rawDetails);
  } catch {
    return {
      success: false,
      state: {
        errors: {
          analysisDetails: ["The analysis summary is invalid. Run it again."],
        },
      },
    };
  }

  const usesOverride = stringValue(formData, "useOverride") === "on";
  const result = teacherGradeInputSchema.safeParse({
    automatedOverall: requiredScore(formData, "automatedOverall"),
    formScore: nullableScore(formData, "formScore"),
    activityScore: nullableScore(formData, "activityScore"),
    timingScore: nullableScore(formData, "timingScore"),
    coverageScore: requiredScore(formData, "coverageScore"),
    analysisDetails,
    feedback: stringValue(formData, "feedback"),
    overrideScore: usesOverride
      ? requiredScore(formData, "overrideScore")
      : null,
    overrideReason: usesOverride
      ? stringValue(formData, "overrideReason")
      : null,
  });
  if (!result.success) {
    return {
      success: false,
      state: { errors: result.error.flatten().fieldErrors },
    };
  }
  return { success: true, data: result.data };
}

export async function submitGradeAction(
  classId: string,
  studentId: string,
  assignmentId: string,
  submissionId: string,
  _previousState: GradeFormState,
  formData: FormData,
): Promise<GradeFormState> {
  const actor = await requireRole(UserRole.TEACHER);
  const parsed = parseGradeForm(formData);
  if (!parsed.success) return parsed.state;
  const shouldRelease = stringValue(formData, "intent") === "release";

  try {
    const grade = shouldRelease
      ? await saveAndReleaseTeacherGrade(actor, submissionId, parsed.data)
      : await saveTeacherGradeDraft(actor, submissionId, parsed.data);
    const gradingPath = `/teacher/classes/${classId}/students/${studentId}/assignments/${assignmentId}/grade`;
    revalidatePath(gradingPath);
    revalidatePath(`/teacher/classes/${classId}/students/${studentId}`);
    revalidatePath("/teacher");
    if (shouldRelease) {
      revalidatePath("/student");
      revalidatePath("/student/history");
      revalidatePath(`/student/grades/${grade.id}`);
    }
    return {
      success: true,
      status: grade.status,
      message: shouldRelease
        ? "Grade released to the student."
        : "Draft saved.",
    };
  } catch (error) {
    if (
      error instanceof GradeSubmissionUnavailableError ||
      error instanceof ReleasedGradeLockedError
    ) {
      return { message: error.message };
    }
    console.error("Grade save failed.");
    return { message: "The grade could not be saved. Please try again." };
  }
}
