import { z } from "zod";

export function cleanClassName(name: string) {
  return name.trim().normalize("NFKC").replace(/\s+/g, " ");
}

export function normalizeClassName(name: string) {
  return cleanClassName(name).toLocaleLowerCase("en-US");
}

const classNameSchema = z
  .string()
  .transform(cleanClassName)
  .pipe(
    z
      .string()
      .min(2, "Class name must be at least 2 characters.")
      .max(120, "Class name must be at most 120 characters."),
  );

const descriptionSchema = z
  .string()
  .trim()
  .max(1000, "Description must be at most 1000 characters.")
  .transform((value) => value || null);

export const createClassSchema = z.object({
  name: classNameSchema,
  description: descriptionSchema,
});

export const renameClassSchema = z.object({
  name: classNameSchema,
});

export const classIdSchema = z.uuid("Invalid class ID.");

export type CreateClassInput = z.input<typeof createClassSchema>;
export type RenameClassInput = z.input<typeof renameClassSchema>;
