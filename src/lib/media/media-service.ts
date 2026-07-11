import "server-only";

import {
  AssignmentStatus,
  MediaAssetKind,
  MediaAssetStatus,
  UserRole,
} from "@/generated/prisma/enums";
import type { SafeUser } from "@/lib/auth/types";
import { assignmentIdSchema } from "@/lib/assignments/validation";
import { db } from "@/lib/db";
import { getStorageConfig } from "@/lib/env";
import type {
  AuthorizedMediaRead,
  AuthorizedMediaUpload,
  CleanupResult,
  MediaAssetSummary,
} from "@/lib/media/types";
import {
  getValidatedMediaExtension,
  hasValidVideoSignature,
  mediaAssetIdSchema,
  mediaUploadSchema,
  type MediaUploadInput,
} from "@/lib/media/validation";
import { submissionIdSchema } from "@/lib/submissions/validation";
import {
  createMediaObjectKey,
  getObjectStorage,
  type ObjectStorage,
} from "@/lib/storage";

const URL_LIFETIME_SECONDS = 5 * 60;
const DEFAULT_ABANDONED_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_BATCH_SIZE = 100;

type MediaDependencies = {
  storage: ObjectStorage;
  bucket: string;
};

type CleanupOptions = {
  storage?: ObjectStorage;
  olderThan?: Date;
  limit?: number;
};

export class MediaAuthorizationError extends Error {
  constructor() {
    super("This account cannot create that type of media.");
    this.name = "MediaAuthorizationError";
  }
}

export class MediaAssetUnavailableError extends Error {
  constructor() {
    super("Media asset not found or unavailable.");
    this.name = "MediaAssetUnavailableError";
  }
}

export class MediaUploadVerificationError extends Error {
  constructor(
    message = "The uploaded object does not match the requested video.",
  ) {
    super(message);
    this.name = "MediaUploadVerificationError";
  }
}

function resolveStorage(overrides?: Partial<MediaDependencies>) {
  return overrides?.storage ?? getObjectStorage();
}

function resolveBucket(overrides?: Partial<MediaDependencies>) {
  return overrides?.bucket ?? getStorageConfig().S3_BUCKET;
}

function assertKindAllowed(actor: SafeUser, kind: MediaAssetKind) {
  const allowed =
    (actor.role === UserRole.TEACHER &&
      kind === MediaAssetKind.REFERENCE_VIDEO) ||
    (actor.role === UserRole.STUDENT &&
      kind === MediaAssetKind.SUBMISSION_VIDEO);
  if (!allowed) {
    throw new MediaAuthorizationError();
  }
}

function toSummary(asset: {
  id: string;
  kind: MediaAssetKind;
  status: MediaAssetStatus;
  contentType: string;
  byteSize: bigint | null;
  originalFilename: string | null;
  createdAt: Date;
  uploadedAt: Date | null;
}): MediaAssetSummary {
  return {
    id: asset.id,
    kind: asset.kind,
    status: asset.status,
    contentType: asset.contentType,
    byteSize: Number(asset.byteSize ?? 0),
    originalFilename: asset.originalFilename ?? "video",
    createdAt: asset.createdAt,
    uploadedAt: asset.uploadedAt,
  };
}

export async function requestMediaUpload(
  actor: SafeUser,
  input: MediaUploadInput,
  overrides?: Partial<MediaDependencies>,
): Promise<AuthorizedMediaUpload> {
  const values = mediaUploadSchema.parse(input);
  assertKindAllowed(actor, values.kind);
  const storage = resolveStorage(overrides);
  const bucket = resolveBucket(overrides);
  const extension = getValidatedMediaExtension(values.filename);
  const category =
    values.kind === MediaAssetKind.REFERENCE_VIDEO
      ? "references"
      : "submissions";
  const objectKey = createMediaObjectKey({
    ownerId: actor.id,
    category,
    extension,
  });

  const asset = await db.mediaAsset.create({
    data: {
      ownerId: actor.id,
      kind: values.kind,
      bucket,
      objectKey,
      originalFilename: values.filename,
      contentType: values.contentType,
      byteSize: BigInt(values.byteSize),
    },
  });

  try {
    const uploadUrl = await storage.createUploadUrl({
      key: objectKey,
      contentType: values.contentType,
      contentLength: values.byteSize,
      expiresInSeconds: URL_LIFETIME_SECONDS,
    });
    const expiresAt = new Date(Date.now() + URL_LIFETIME_SECONDS * 1000);
    return {
      asset: toSummary(asset),
      uploadUrl,
      expiresAt,
      headers: {
        "Content-Type": values.contentType,
      },
    };
  } catch (error) {
    await db.mediaAsset.deleteMany({
      where: {
        id: asset.id,
        ownerId: actor.id,
        status: MediaAssetStatus.PENDING_UPLOAD,
      },
    });
    throw error;
  }
}

export async function completeMediaUpload(
  actor: SafeUser,
  assetId: string,
  overrides?: Partial<MediaDependencies>,
): Promise<MediaAssetSummary> {
  const id = mediaAssetIdSchema.parse(assetId);
  const storage = resolveStorage(overrides);
  const asset = await db.mediaAsset.findFirst({
    where: {
      id,
      ownerId: actor.id,
      status: MediaAssetStatus.PENDING_UPLOAD,
    },
  });
  if (!asset) {
    throw new MediaAssetUnavailableError();
  }

  const metadata = await storage.getMetadata(asset.objectKey);
  const expectedSize = Number(asset.byteSize);
  if (!metadata) {
    throw new MediaUploadVerificationError(
      "The uploaded object was not found.",
    );
  }
  if (
    metadata.contentType?.toLowerCase() !== asset.contentType.toLowerCase() ||
    metadata.contentLength !== expectedSize
  ) {
    throw new MediaUploadVerificationError();
  }
  const prefix = await storage.readPrefix(asset.objectKey, 16);
  if (!hasValidVideoSignature(asset.contentType, prefix)) {
    throw new MediaUploadVerificationError(
      "The uploaded file contents do not match the declared video type.",
    );
  }

  const uploadedAt = new Date();
  const updated = await db.mediaAsset.updateMany({
    where: {
      id,
      ownerId: actor.id,
      status: MediaAssetStatus.PENDING_UPLOAD,
    },
    data: {
      status: MediaAssetStatus.READY,
      byteSize: BigInt(metadata.contentLength),
      etag: metadata.etag,
      uploadedAt,
    },
  });
  if (updated.count !== 1) {
    throw new MediaAssetUnavailableError();
  }

  return toSummary({ ...asset, status: MediaAssetStatus.READY, uploadedAt });
}

export async function createAuthorizedMediaRead(
  actor: SafeUser,
  assetId: string,
  overrides?: Partial<MediaDependencies>,
): Promise<AuthorizedMediaRead> {
  const id = mediaAssetIdSchema.parse(assetId);
  const storage = resolveStorage(overrides);
  const asset = await db.mediaAsset.findFirst({
    where: { id, ownerId: actor.id, status: MediaAssetStatus.READY },
    select: {
      id: true,
      objectKey: true,
      contentType: true,
      byteSize: true,
    },
  });
  if (!asset || asset.byteSize === null) {
    throw new MediaAssetUnavailableError();
  }

  const readUrl = await storage.createReadUrl({
    key: asset.objectKey,
    expiresInSeconds: URL_LIFETIME_SECONDS,
  });
  return {
    assetId: asset.id,
    readUrl,
    expiresAt: new Date(Date.now() + URL_LIFETIME_SECONDS * 1000),
    contentType: asset.contentType,
    byteSize: Number(asset.byteSize),
  };
}

export async function createAuthorizedAssignmentReferenceRead(
  actor: SafeUser,
  assignmentId: string,
  overrides?: Partial<MediaDependencies>,
): Promise<AuthorizedMediaRead> {
  if (actor.role !== UserRole.STUDENT) {
    throw new MediaAssetUnavailableError();
  }
  const parsedAssignmentId = assignmentIdSchema.parse(assignmentId);
  const storage = resolveStorage(overrides);
  const record = await db.assignmentStudent.findFirst({
    where: {
      assignmentId: parsedAssignmentId,
      studentId: actor.id,
      assignment: { status: AssignmentStatus.PUBLISHED },
    },
    select: {
      assignment: {
        select: {
          referenceVideo: {
            select: {
              id: true,
              objectKey: true,
              contentType: true,
              byteSize: true,
              status: true,
            },
          },
        },
      },
    },
  });
  const asset = record?.assignment.referenceVideo;
  if (
    !asset ||
    asset.status !== MediaAssetStatus.READY ||
    asset.byteSize === null
  ) {
    throw new MediaAssetUnavailableError();
  }

  const readUrl = await storage.createReadUrl({
    key: asset.objectKey,
    expiresInSeconds: URL_LIFETIME_SECONDS,
  });
  return {
    assetId: asset.id,
    readUrl,
    expiresAt: new Date(Date.now() + URL_LIFETIME_SECONDS * 1000),
    contentType: asset.contentType,
    byteSize: Number(asset.byteSize),
  };
}

export async function createAuthorizedTeacherSubmissionRead(
  actor: SafeUser,
  submissionId: string,
  overrides?: Partial<MediaDependencies>,
): Promise<AuthorizedMediaRead> {
  if (actor.role !== UserRole.TEACHER) {
    throw new MediaAssetUnavailableError();
  }
  const parsedSubmissionId = submissionIdSchema.parse(submissionId);
  const storage = resolveStorage(overrides);
  const submission = await db.submission.findFirst({
    where: {
      id: parsedSubmissionId,
      completedAt: { not: null },
      assignment: { danceClass: { teacherId: actor.id } },
    },
    select: {
      video: {
        select: {
          id: true,
          objectKey: true,
          contentType: true,
          byteSize: true,
          status: true,
        },
      },
    },
  });
  const asset = submission?.video;
  if (
    !asset ||
    asset.status !== MediaAssetStatus.READY ||
    asset.byteSize === null
  ) {
    throw new MediaAssetUnavailableError();
  }

  const readUrl = await storage.createReadUrl({
    key: asset.objectKey,
    expiresInSeconds: URL_LIFETIME_SECONDS,
  });
  return {
    assetId: asset.id,
    readUrl,
    expiresAt: new Date(Date.now() + URL_LIFETIME_SECONDS * 1000),
    contentType: asset.contentType,
    byteSize: Number(asset.byteSize),
  };
}

export async function cleanupAbandonedMediaUploads(
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const storage = options.storage ?? getObjectStorage();
  const olderThan =
    options.olderThan ?? new Date(Date.now() - DEFAULT_ABANDONED_AGE_MS);
  const limit = Math.min(
    Math.max(options.limit ?? DEFAULT_CLEANUP_BATCH_SIZE, 1),
    500,
  );
  const candidates = await db.mediaAsset.findMany({
    where: {
      status: MediaAssetStatus.PENDING_UPLOAD,
      createdAt: { lt: olderThan },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, objectKey: true },
  });

  let claimed = 0;
  let deleted = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const claimedAt = new Date();
    const result = await db.mediaAsset.updateMany({
      where: {
        id: candidate.id,
        status: MediaAssetStatus.PENDING_UPLOAD,
        createdAt: { lt: olderThan },
      },
      data: { status: MediaAssetStatus.DELETED, deletedAt: claimedAt },
    });
    if (result.count !== 1) {
      continue;
    }
    claimed += 1;

    try {
      await storage.delete(candidate.objectKey);
      deleted += 1;
    } catch {
      failed += 1;
      await db.mediaAsset.updateMany({
        where: {
          id: candidate.id,
          status: MediaAssetStatus.DELETED,
          deletedAt: claimedAt,
          uploadedAt: null,
        },
        data: { status: MediaAssetStatus.PENDING_UPLOAD, deletedAt: null },
      });
    }
  }

  return { claimed, deleted, failed };
}
