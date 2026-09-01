import {
  consumeUploadStatements,
  prepareUploadRows,
  resolveAvailableUploads,
  uploadAvailabilityGuard,
  type UploadMetadata,
  type UploadScope,
} from "./upload-repository";

export type ChannelMessageUploadScope = {
  organizationId: string;
  channelId: string;
  userId: string;
  messageId: string;
};

export type ChannelMessageMutationReceiptRow = {
  message_id: string;
  organization_id: string;
  channel_id: string;
  user_id: string;
  request_hash: string;
  created_at: string;
};

const uploadScope = (scope: ChannelMessageUploadScope): UploadScope => ({
  purpose: "channel_message",
  organizationId: scope.organizationId,
  projectId: null,
  channelId: scope.channelId,
  userId: scope.userId,
  workId: scope.messageId,
  runId: null,
  workerId: null,
  deviceId: null,
  claimTokenHash: null,
});

export function prepareChannelMessageUploadRows(
  db: D1Database,
  input: ChannelMessageUploadScope & {
    requestId: string;
    attachments: readonly UploadMetadata[];
    createdAt: string;
    expiresAt: string;
  },
) {
  return prepareUploadRows(db, {
    ...uploadScope(input),
    requestId: input.requestId,
    files: input.attachments,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  });
}

export async function resolveChannelMessageUploads(
  db: D1Database,
  input: ChannelMessageUploadScope & {
    uploadIds: readonly string[];
    observedAt: string;
  },
) {
  const uploads = await resolveAvailableUploads(db, {
    ...uploadScope(input),
    uploadIds: input.uploadIds,
    observedAt: input.observedAt,
  });
  if (!uploads || uploads.length === 0) return uploads;
  const batchIds = new Set(uploads.map((upload) => upload.batch_request_id));
  return batchIds.size === 1 ? uploads : null;
}

export function channelMessageUploadAvailabilityGuard(
  input: ChannelMessageUploadScope & {
    uploadIds: readonly string[];
    observedAt: string;
  },
) {
  return uploadAvailabilityGuard({
    ...uploadScope(input),
    uploadIds: input.uploadIds,
    observedAt: input.observedAt,
  });
}

export function channelMessageUploadConsumeStatements(
  db: D1Database,
  input: ChannelMessageUploadScope & {
    uploadIds: readonly string[];
    consumedAt: string;
  },
) {
  return consumeUploadStatements(db, {
    ...uploadScope(input),
    uploadIds: input.uploadIds,
    consumerKind: "channel_message",
    consumerId: input.messageId,
    consumedAt: input.consumedAt,
  });
}

export function channelMessageMutationReceiptStatement(
  db: D1Database,
  input: ChannelMessageUploadScope & {
    requestHash: string;
    createdAt: string;
  },
) {
  return db
    .prepare(
      `insert into briar_channel_message_mutation_receipts (
       message_id, organization_id, channel_id, user_id, request_hash,
       created_at
     ) values (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.messageId,
      input.organizationId,
      input.channelId,
      input.userId,
      input.requestHash,
      input.createdAt,
    );
}

export function findChannelMessageMutationReceipt(db: D1Database, messageId: string) {
  return db
    .prepare(
      `select message_id, organization_id, channel_id, user_id, request_hash,
            created_at
     from briar_channel_message_mutation_receipts
     where message_id = ?`,
    )
    .bind(messageId)
    .first<ChannelMessageMutationReceiptRow>();
}
