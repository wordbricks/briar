import type { UploadFileMetadata } from "@briar/contracts/gen/briar/types/v1/upload_pb";
import { isIssueAttachmentReference } from "../../src/lib/issue-markdown";
import {
  channelAttachmentMimeTypeFromName,
  isChannelAttachmentTypeSupported,
  validateChannelAttachments,
} from "../../src/lib/channel-attachments";
import { prepareChannelMessageUploadRows } from "./channel-message-upload-repository";
import { HttpError } from "./http-response";
import { requireChannelWriteAccess } from "./channel-route-access";
import { createUploadCapability, UPLOAD_CAPABILITY_MAX_TTL_MS } from "./upload-capability";
import type { UploadMetadata } from "./upload-repository";

export type ChannelMessageUploadApplicationServices = {
  readonly requireChannelWriteAccess: typeof requireChannelWriteAccess;
  readonly prepareChannelMessageUploadRows: typeof prepareChannelMessageUploadRows;
  readonly createUploadCapability: typeof createUploadCapability;
};

const applicationServices: ChannelMessageUploadApplicationServices = {
  requireChannelWriteAccess,
  prepareChannelMessageUploadRows,
  createUploadCapability,
};

const normalizedContentType = (value: string, filename: string) => {
  const declared = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const contentType = declared === "" || declared === "application/octet-stream"
    ? channelAttachmentMimeTypeFromName(filename)
    : declared;
  if (!contentType || !isChannelAttachmentTypeSupported(contentType)) {
    throw new HttpError(400, "Channel attachments must be images or PDFs");
  }
  return contentType;
};

export function channelMessageUploadMetadata(
  attachments: readonly UploadFileMetadata[],
): UploadMetadata[] {
  if (attachments.length === 0) {
    throw new HttpError(400, "At least one channel attachment is required");
  }
  const files = attachments.map((attachment) => {
    const clientId = attachment.clientId.trim();
    const filename = attachment.filename.normalize("NFC").trim();
    if (
      !isIssueAttachmentReference(clientId) ||
      clientId.length > 128 ||
      attachment.sha256.byteLength !== 32 ||
      attachment.byteSize > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new HttpError(400, "Channel attachment metadata is invalid");
    }
    return {
      clientId,
      filename,
      contentType: normalizedContentType(attachment.contentType, filename),
      byteSize: Number(attachment.byteSize),
      sha256: attachment.sha256,
    };
  });
  if (new Set(files.map((file) => file.clientId)).size !== files.length) {
    throw new HttpError(400, "Channel attachment client IDs must be unique");
  }
  const validationError = validateChannelAttachments(
    files.map((file) => ({
      name: file.filename,
      type: file.contentType,
      size: file.byteSize,
    })),
  );
  if (validationError) throw new HttpError(400, validationError);
  return files;
}

export async function prepareChannelMessageAttachmentsApplication(
  input: {
    db: D1Database;
    signingSecret: string;
    organizationId: string;
    channelId: string;
    userId: string;
    messageId: string;
    requestId: string;
    attachments: readonly UploadFileMetadata[];
    observedAt?: string;
  },
  overrides: Partial<ChannelMessageUploadApplicationServices> = {},
) {
  const services = { ...applicationServices, ...overrides };
  const channel = await services.requireChannelWriteAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  if (channel.archived_at) throw new HttpError(409, "Channel is archived");
  const attachments = channelMessageUploadMetadata(input.attachments);
  const observedAt = input.observedAt ?? new Date().toISOString();
  const expiresAt = new Date(Date.parse(observedAt) + UPLOAD_CAPABILITY_MAX_TTL_MS).toISOString();
  let prepared;
  try {
    prepared = await services.prepareChannelMessageUploadRows(input.db, {
      organizationId: input.organizationId,
      channelId: input.channelId,
      userId: input.userId,
      messageId: input.messageId,
      requestId: input.requestId,
      attachments,
      createdAt: observedAt,
      expiresAt,
    });
  } catch {
    throw new HttpError(409, "Channel attachment reservation is no longer authorized");
  }
  if (!prepared) {
    throw new HttpError(
      409,
      "Channel attachment prepare request was reused with different metadata",
    );
  }
  if (prepared.batch.expires_at <= observedAt) {
    throw new HttpError(409, "Channel attachment prepare request expired; use a new request ID");
  }
  const capabilityExpiresAt = Date.parse(prepared.batch.expires_at);
  return {
    replayed: prepared.replayed,
    uploads: await Promise.all(
      prepared.uploads.map(async (upload) => ({
        clientId: upload.client_id,
        uploadId: upload.upload_id,
        uploadCapability: await services.createUploadCapability(input.signingSecret, {
          uploadId: upload.upload_id,
          expiresAt: capabilityExpiresAt,
        }),
        expiresAt: prepared.batch.expires_at,
      })),
    ),
  };
}
