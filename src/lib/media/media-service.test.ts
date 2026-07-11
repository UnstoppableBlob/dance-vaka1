import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MediaAssetKind,
  MediaAssetStatus,
  UserRole,
} from "@/generated/prisma/enums";
import { dummyPasswordHash } from "@/lib/auth/password";
import type { SafeUser } from "@/lib/auth/types";
import { db } from "@/lib/db";
import {
  cleanupAbandonedMediaUploads,
  completeMediaUpload,
  createAuthorizedMediaRead,
  MediaAssetUnavailableError,
  MediaAuthorizationError,
  MediaUploadVerificationError,
  requestMediaUpload,
} from "@/lib/media/media-service";
import type {
  CreateReadUrlInput,
  CreateUploadUrlInput,
  ObjectStorage,
  StoredObjectMetadata,
} from "@/lib/storage/types";

class FakeStorage implements ObjectStorage {
  metadata = new Map<string, StoredObjectMetadata>();
  uploadRequests: CreateUploadUrlInput[] = [];
  readRequests: CreateReadUrlInput[] = [];
  deletedKeys: string[] = [];
  failUploadSigning = false;
  failDeleteKeys = new Set<string>();
  invalidSignatureKeys = new Set<string>();

  async createUploadUrl(input: CreateUploadUrlInput) {
    this.uploadRequests.push(input);
    if (this.failUploadSigning) {
      throw new Error("signing failed");
    }
    return `https://storage.test/upload/${encodeURIComponent(input.key)}`;
  }

  async createReadUrl(input: CreateReadUrlInput) {
    this.readRequests.push(input);
    return `https://storage.test/read/${encodeURIComponent(input.key)}`;
  }

  async getMetadata(key: string) {
    return this.metadata.get(key) ?? null;
  }

  async readPrefix(key: string) {
    return this.invalidSignatureKeys.has(key)
      ? Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c])
      : Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]);
  }

  async delete(key: string) {
    if (this.failDeleteKeys.has(key)) {
      throw new Error("delete failed");
    }
    this.deletedKeys.push(key);
    this.metadata.delete(key);
  }
}

let teacher: SafeUser;
let otherTeacher: SafeUser;
let student: SafeUser;
const createdUserIds: string[] = [];
let sequence = 0;

function uniqueUsername(label: string) {
  sequence += 1;
  return `vitest_media_${label}_${sequence}`.slice(0, 30);
}

async function createActor(role: UserRole, label: string) {
  const username = uniqueUsername(label);
  const actor = await db.user.create({
    data: {
      username,
      usernameNormalized: username.toLowerCase(),
      passwordHash: dummyPasswordHash,
      role,
    },
    select: { id: true, username: true, role: true },
  });
  createdUserIds.push(actor.id);
  return actor;
}

const referenceInput = {
  kind: MediaAssetKind.REFERENCE_VIDEO,
  filename: "reference.webm",
  contentType: "video/webm",
  byteSize: 4096,
};

describe.sequential("private media authorization", () => {
  beforeAll(async () => {
    await db.user.deleteMany({
      where: { usernameNormalized: { startsWith: "vitest_media_" } },
    });
    teacher = await createActor(UserRole.TEACHER, "teacher");
    otherTeacher = await createActor(UserRole.TEACHER, "other");
    student = await createActor(UserRole.STUDENT, "student");
  });

  afterAll(async () => {
    await db.mediaAsset.deleteMany({
      where: { ownerId: { in: createdUserIds } },
    });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await db.$disconnect();
  });

  it("creates a pending record and a short-lived constrained upload URL", async () => {
    const storage = new FakeStorage();
    const result = await requestMediaUpload(teacher, referenceInput, {
      storage,
      bucket: "private-test-bucket",
    });
    const stored = await db.mediaAsset.findUniqueOrThrow({
      where: { id: result.asset.id },
    });

    expect(result.asset.status).toBe(MediaAssetStatus.PENDING_UPLOAD);
    expect(result.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      300_000,
    );
    expect(result.headers).toEqual({ "Content-Type": "video/webm" });
    expect(storage.uploadRequests).toEqual([
      expect.objectContaining({
        key: stored.objectKey,
        contentType: "video/webm",
        contentLength: 4096,
        expiresInSeconds: 300,
      }),
    ]);
    expect(stored.bucket).toBe("private-test-bucket");
    expect(stored.objectKey).toContain(`/` + teacher.id + `/`);
    expect(stored.objectKey).not.toContain(referenceInput.filename);
    expect(stored.byteSize).toBe(BigInt(4096));
  });

  it("enforces role-specific media kinds and removes records when signing fails", async () => {
    const storage = new FakeStorage();
    await expect(
      requestMediaUpload(student, referenceInput, {
        storage,
        bucket: "private-test-bucket",
      }),
    ).rejects.toBeInstanceOf(MediaAuthorizationError);
    await expect(
      requestMediaUpload(
        teacher,
        {
          ...referenceInput,
          kind: MediaAssetKind.SUBMISSION_VIDEO,
        },
        {
          storage,
          bucket: "private-test-bucket",
        },
      ),
    ).rejects.toBeInstanceOf(MediaAuthorizationError);

    storage.failUploadSigning = true;
    const before = await db.mediaAsset.count({
      where: { ownerId: teacher.id },
    });
    await expect(
      requestMediaUpload(teacher, referenceInput, {
        storage,
        bucket: "private-test-bucket",
      }),
    ).rejects.toThrow("signing failed");
    expect(await db.mediaAsset.count({ where: { ownerId: teacher.id } })).toBe(
      before,
    );
  });

  it("verifies object metadata before marking an upload ready", async () => {
    const storage = new FakeStorage();
    const upload = await requestMediaUpload(teacher, referenceInput, {
      storage,
      bucket: "private-test-bucket",
    });
    const key = storage.uploadRequests.at(-1)?.key;
    expect(key).toBeDefined();

    await expect(
      completeMediaUpload(otherTeacher, upload.asset.id, { storage }),
    ).rejects.toBeInstanceOf(MediaAssetUnavailableError);
    await expect(
      completeMediaUpload(teacher, upload.asset.id, { storage }),
    ).rejects.toBeInstanceOf(MediaUploadVerificationError);
    storage.metadata.set(key!, {
      key: key!,
      contentType: "video/mp4",
      contentLength: referenceInput.byteSize,
    });
    await expect(
      completeMediaUpload(teacher, upload.asset.id, { storage }),
    ).rejects.toBeInstanceOf(MediaUploadVerificationError);
    storage.metadata.set(key!, {
      key: key!,
      contentType: referenceInput.contentType,
      contentLength: referenceInput.byteSize + 1,
    });
    await expect(
      completeMediaUpload(teacher, upload.asset.id, { storage }),
    ).rejects.toBeInstanceOf(MediaUploadVerificationError);

    storage.metadata.set(key!, {
      key: key!,
      contentType: referenceInput.contentType,
      contentLength: referenceInput.byteSize,
      etag: '"test-etag"',
    });
    storage.invalidSignatureKeys.add(key!);
    await expect(
      completeMediaUpload(teacher, upload.asset.id, { storage }),
    ).rejects.toThrow("contents do not match");
    storage.invalidSignatureKeys.delete(key!);
    const ready = await completeMediaUpload(teacher, upload.asset.id, {
      storage,
    });
    const stored = await db.mediaAsset.findUniqueOrThrow({
      where: { id: upload.asset.id },
    });
    expect(ready.status).toBe(MediaAssetStatus.READY);
    expect(stored.status).toBe(MediaAssetStatus.READY);
    expect(stored.uploadedAt).toBeInstanceOf(Date);
    expect(stored.etag).toBe('"test-etag"');
  });

  it("issues read URLs only to the owner of a ready asset", async () => {
    const storage = new FakeStorage();
    const upload = await requestMediaUpload(teacher, referenceInput, {
      storage,
      bucket: "private-test-bucket",
    });
    const key = storage.uploadRequests.at(-1)!.key;

    await expect(
      createAuthorizedMediaRead(teacher, upload.asset.id, { storage }),
    ).rejects.toBeInstanceOf(MediaAssetUnavailableError);
    storage.metadata.set(key, {
      key,
      contentType: referenceInput.contentType,
      contentLength: referenceInput.byteSize,
    });
    await completeMediaUpload(teacher, upload.asset.id, { storage });
    await expect(
      createAuthorizedMediaRead(otherTeacher, upload.asset.id, { storage }),
    ).rejects.toBeInstanceOf(MediaAssetUnavailableError);

    const read = await createAuthorizedMediaRead(teacher, upload.asset.id, {
      storage,
    });
    expect(read.readUrl).toContain("https://storage.test/read/");
    expect(read.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    expect(storage.readRequests).toEqual([{ key, expiresInSeconds: 300 }]);
  });

  it("cleans only claimed abandoned uploads and restores failed deletions", async () => {
    const storage = new FakeStorage();
    const oldUpload = await requestMediaUpload(teacher, referenceInput, {
      storage,
      bucket: "private-test-bucket",
    });
    const failedUpload = await requestMediaUpload(teacher, referenceInput, {
      storage,
      bucket: "private-test-bucket",
    });
    const recentUpload = await requestMediaUpload(teacher, referenceInput, {
      storage,
      bucket: "private-test-bucket",
    });
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await db.mediaAsset.updateMany({
      where: { id: { in: [oldUpload.asset.id, failedUpload.asset.id] } },
      data: { createdAt: old },
    });
    const failedKey = storage.uploadRequests.at(-2)!.key;
    storage.failDeleteKeys.add(failedKey);

    const result = await cleanupAbandonedMediaUploads({
      storage,
      olderThan: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    const assets = await db.mediaAsset.findMany({
      where: {
        id: {
          in: [
            oldUpload.asset.id,
            failedUpload.asset.id,
            recentUpload.asset.id,
          ],
        },
      },
      select: { id: true, status: true, deletedAt: true },
    });
    const byId = new Map(assets.map((asset) => [asset.id, asset]));

    expect(result).toEqual({ claimed: 2, deleted: 1, failed: 1 });
    expect(byId.get(oldUpload.asset.id)?.status).toBe(MediaAssetStatus.DELETED);
    expect(byId.get(oldUpload.asset.id)?.deletedAt).toBeInstanceOf(Date);
    expect(byId.get(failedUpload.asset.id)?.status).toBe(
      MediaAssetStatus.PENDING_UPLOAD,
    );
    expect(byId.get(failedUpload.asset.id)?.deletedAt).toBeNull();
    expect(byId.get(recentUpload.asset.id)?.status).toBe(
      MediaAssetStatus.PENDING_UPLOAD,
    );
  });
});
