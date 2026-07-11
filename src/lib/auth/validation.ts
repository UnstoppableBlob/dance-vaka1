import { UserRole } from "@/generated/prisma/enums";
import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(30, "Username must be at most 30 characters.")
  .regex(/^[A-Za-z0-9_]+$/, "Use only letters, numbers, and underscores.")
  .transform((value) => value.normalize("NFKC"));

const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(128, "Password must be at most 128 characters.")
  .regex(/[a-z]/, "Password must contain a lowercase letter.")
  .regex(/[A-Z]/, "Password must contain an uppercase letter.")
  .regex(/[0-9]/, "Password must contain a number.");

export const registrationSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
    passwordConfirmation: z.string(),
    role: z.enum([UserRole.TEACHER, UserRole.STUDENT], {
      error: "Choose Teacher or Student.",
    }),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: "Passwords do not match.",
    path: ["passwordConfirmation"],
  });

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, "Enter your password.").max(128),
});

export type RegistrationInput = z.infer<typeof registrationSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export function normalizeUsername(username: string) {
  return username.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}
