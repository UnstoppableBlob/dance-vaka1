import type {
  MediaAssetKind,
  MediaAssetStatus,
} from "@/generated/prisma/enums";

export type MediaAssetSummary = {
  id: string;
  kind: MediaAssetKind;
  status: MediaAssetStatus;
  contentType: string;
  byteSize: number;
  originalFilename: string;
  createdAt: Date;
  uploadedAt: Date | null;
};

export type AuthorizedMediaUpload = {
  asset: MediaAssetSummary;
  uploadUrl: string;
  expiresAt: Date;
  headers: {
    "Content-Type": string;
  };
};

export type AuthorizedMediaRead = {
  assetId: string;
  readUrl: string;
  expiresAt: Date;
  contentType: string;
  byteSize: number;
};

export type CleanupResult = {
  claimed: number;
  deleted: number;
  failed: number;
};
