import type { UserRole } from "@/generated/prisma/enums";

export type SafeUser = {
  id: string;
  username: string;
  role: UserRole;
};

export type AuthFieldErrors = Partial<
  Record<"username" | "password" | "passwordConfirmation" | "role", string[]>
>;

export type AuthFormState = {
  errors?: AuthFieldErrors;
  message?: string;
  values?: {
    username?: string;
    role?: UserRole;
  };
};
