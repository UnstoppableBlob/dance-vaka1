import { z } from "zod";

export const submissionIdSchema = z.uuid("Invalid submission ID.");
