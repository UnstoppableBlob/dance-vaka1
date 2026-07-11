import "server-only";

import { z } from "zod";

const trueOrFalse = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

const databaseSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
});

const authSchema = z.object({
  SESSION_SECRET: z.string().min(32),
});

const storageSchema = z.object({
  S3_REGION: z.string().min(1),
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: trueOrFalse,
});

const mediaCleanupSchema = z.object({
  MEDIA_CLEANUP_SECRET: z.string().min(32),
});

function formatEnvironmentError(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join(", ");
}

export function getDatabaseConfig() {
  const result = databaseSchema.safeParse(process.env);

  if (!result.success) {
    throw new Error(
      `Invalid database environment configuration: ${formatEnvironmentError(result.error)}`,
    );
  }

  return result.data;
}

export function getStorageConfig() {
  const result = storageSchema.safeParse(process.env);

  if (!result.success) {
    throw new Error(
      `Invalid storage environment configuration: ${formatEnvironmentError(result.error)}`,
    );
  }

  return result.data;
}

export function getAuthConfig() {
  const result = authSchema.safeParse(process.env);

  if (!result.success) {
    throw new Error(
      `Invalid authentication environment configuration: ${formatEnvironmentError(result.error)}`,
    );
  }

  return result.data;
}

export function getMediaCleanupConfig() {
  const result = mediaCleanupSchema.safeParse(process.env);

  if (!result.success) {
    throw new Error(
      `Invalid media cleanup configuration: ${formatEnvironmentError(result.error)}`,
    );
  }

  return result.data;
}
