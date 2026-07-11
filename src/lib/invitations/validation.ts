import { z } from "zod";

import { usernameSchema } from "@/lib/auth/validation";

export const inviteStudentSchema = z.object({
  username: usernameSchema,
});

export const invitationIdSchema = z.uuid("Invalid invitation ID.");

export type InviteStudentInput = z.input<typeof inviteStudentSchema>;
