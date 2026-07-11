import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type {
  CreateReadUrlInput,
  CreateUploadUrlInput,
  ObjectStorage,
} from "@/lib/storage/types";

type S3ObjectStorageOptions = {
  bucket: string;
  client: S3Client;
};

const defaultUrlLifetimeSeconds = 15 * 60;

export class S3ObjectStorage implements ObjectStorage {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor({ bucket, client }: S3ObjectStorageOptions) {
    this.bucket = bucket;
    this.client = client;
  }

  async createUploadUrl(input: CreateUploadUrlInput) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds ?? defaultUrlLifetimeSeconds,
    });
  }

  async createReadUrl(input: CreateReadUrlInput) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds ?? defaultUrlLifetimeSeconds,
    });
  }

  async getMetadata(key: string) {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      return {
        key,
        contentType: result.ContentType,
        contentLength: result.ContentLength,
        etag: result.ETag,
        lastModified: result.LastModified,
      };
    } catch (error) {
      if (error instanceof NotFound) {
        return null;
      }

      throw error;
    }
  }

  async readPrefix(key: string, length: number) {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: `bytes=0-${Math.max(0, length - 1)}`,
      }),
    );
    if (!result.Body) return new Uint8Array();
    return result.Body.transformToByteArray();
  }

  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
