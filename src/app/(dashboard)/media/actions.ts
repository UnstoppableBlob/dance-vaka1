"use server";

import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/dal";
import {
  completeMediaUpload,
  createAuthorizedMediaRead,
  requestMediaUpload,
} from "@/lib/media/media-service";
import type { MediaUploadInput } from "@/lib/media/validation";

async function requireAuthenticatedUser() {
  const actor = await getCurrentUser();
  if (!actor) {
    redirect("/login");
  }
  return actor;
}

export async function requestMediaUploadAction(input: MediaUploadInput) {
  return requestMediaUpload(await requireAuthenticatedUser(), input);
}

export async function completeMediaUploadAction(assetId: string) {
  return completeMediaUpload(await requireAuthenticatedUser(), assetId);
}

export async function createMediaReadAction(assetId: string) {
  return createAuthorizedMediaRead(await requireAuthenticatedUser(), assetId);
}
