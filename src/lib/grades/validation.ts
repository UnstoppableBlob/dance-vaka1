import { z } from "zod";

import { DEFAULT_ANALYSIS_MAX_FRAMES } from "@/lib/pose-comparison/sampling";

const scoreSchema = z
  .number({ error: "Enter a whole-number score." })
  .int("Scores must be whole numbers.")
  .min(0, "Scores cannot be below 0.")
  .max(100, "Scores cannot be above 100.");

export const gradeAnalysisDetailsSchema = z
  .object({
    version: z.literal(1),
    analyzedAt: z.iso.datetime(),
    sampleCount: z.number().int().min(1).max(DEFAULT_ANALYSIS_MAX_FRAMES),
    matchedFrames: z.number().int().min(0).max(DEFAULT_ANALYSIS_MAX_FRAMES),
    mismatchCounts: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(100),
          count: z.number().int().min(1).max(DEFAULT_ANALYSIS_MAX_FRAMES),
        }),
      )
      .max(20),
  })
  .strict()
  .superRefine((details, context) => {
    if (details.matchedFrames > details.sampleCount) {
      context.addIssue({
        code: "custom",
        path: ["matchedFrames"],
        message: "Matched frames cannot exceed sampled frames.",
      });
    }
  });

export const teacherGradeInputSchema = z
  .object({
    automatedOverall: scoreSchema,
    formScore: scoreSchema.nullable(),
    activityScore: scoreSchema.nullable(),
    timingScore: scoreSchema.nullable(),
    coverageScore: scoreSchema,
    analysisDetails: gradeAnalysisDetailsSchema,
    feedback: z.string().trim().max(5000).nullable(),
    overrideScore: scoreSchema.nullable(),
    overrideReason: z.string().trim().max(1000).nullable(),
  })
  .superRefine((grade, context) => {
    if (grade.overrideScore !== null && !grade.overrideReason) {
      context.addIssue({
        code: "custom",
        path: ["overrideReason"],
        message: "Explain why the final score is being adjusted.",
      });
    }
  })
  .transform((grade) => ({
    ...grade,
    feedback: grade.feedback || null,
    overrideReason:
      grade.overrideScore === null ? null : grade.overrideReason || null,
  }));

export const gradeSubmissionIdSchema = z.uuid("Invalid submission ID.");
