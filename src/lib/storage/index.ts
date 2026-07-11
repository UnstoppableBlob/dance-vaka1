import "server-only";

import { S3Client } from "@aws-sdk/client-s3";

import { getStorageConfig } from "@/lib/env";
import { S3ObjectStorage } from "@/lib/storage/s3-storage";
import type { ObjectStorage } from "@/lib/storage/types";

let storage: ObjectStorage | undefined;

export function getObjectStorage(): ObjectStorage {
  if (storage) {
    return storage;
  }

  const config = getStorageConfig();
  const client = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });

  storage = new S3ObjectStorage({ bucket: config.S3_BUCKET, client });
  return storage;
}

export type { ObjectStorage } from "@/lib/storage/types";
export { createMediaObjectKey } from "@/lib/storage/object-key";
