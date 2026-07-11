export type CreateUploadUrlInput = {
  key: string;
  contentType: string;
  contentLength?: number;
  expiresInSeconds?: number;
};

export type CreateReadUrlInput = {
  key: string;
  expiresInSeconds?: number;
};

export type StoredObjectMetadata = {
  key: string;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: Date;
};

export interface ObjectStorage {
  createUploadUrl(input: CreateUploadUrlInput): Promise<string>;
  createReadUrl(input: CreateReadUrlInput): Promise<string>;
  getMetadata(key: string): Promise<StoredObjectMetadata | null>;
  readPrefix(key: string, length: number): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}
