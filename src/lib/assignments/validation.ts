import { z } from "zod";

export function cleanAssignmentTitle(title: string) {
  return title.trim().normalize("NFKC").replace(/\s+/g, " ");
}

export function normalizeAssignmentTitle(title: string) {
  return cleanAssignmentTitle(title).toLocaleLowerCase("en-US");
}

const titleSchema = z
  .string()
  .transform(cleanAssignmentTitle)
  .pipe(
    z
      .string()
      .min(2, "Title must be at least 2 characters.")
      .max(160, "Title must be at most 160 characters."),
  );

const instructionsSchema = z
  .union([z.string(), z.null()])
  .transform((value) => value?.trim() || null)
  .refine(
    (value) => value === null || value.length <= 5000,
    "Instructions must be at most 5,000 characters.",
  );

export const assignmentIdSchema = z.uuid("Invalid assignment ID.");

export const assignmentDraftSchema = z.object({
  title: titleSchema,
  instructions: instructionsSchema,
  dueAt: z.date().nullable(),
  referenceVideoAssetId: z.uuid("Invalid reference video ID.").nullable(),
});

const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function parseLocalDueDate(value: string, timezoneOffset: string) {
  if (!value) return null;
  const parts = localDateTimePattern.exec(value);
  if (!parts) {
    throw new Error("Enter a valid due date and time.");
  }

  const offset = Number(timezoneOffset);
  if (!Number.isInteger(offset) || offset < -840 || offset > 840) {
    throw new Error("Enter a valid due date and time.");
  }
  const [, yearValue, monthValue, dayValue, hourValue, minuteValue] = parts;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const verified = new Date(localAsUtc);
  if (
    verified.getUTCFullYear() !== year ||
    verified.getUTCMonth() !== month - 1 ||
    verified.getUTCDate() !== day ||
    verified.getUTCHours() !== hour ||
    verified.getUTCMinutes() !== minute
  ) {
    throw new Error("Enter a valid due date and time.");
  }
  return new Date(localAsUtc + offset * 60_000);
}

export type AssignmentDraftInput = z.output<typeof assignmentDraftSchema>;
