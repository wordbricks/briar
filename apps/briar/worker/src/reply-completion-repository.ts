import { sha256 } from "./crypto-digest";

export type ReplyKind = "issue" | "channel";

export type ReplyClaimScope = {
  replyKind: ReplyKind;
  organizationId: string;
  projectId: string;
  workId: string;
  runId: string;
  workerId: string;
  deviceId: string;
  claimTokenHash: string;
};

export type ReplyAttachmentMetadata = {
  clientId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: Uint8Array;
};

export type ReplyAttachmentUploadBatchRow = {
  request_id: string;
  reply_kind: ReplyKind;
  organization_id: string;
  project_id: string;
  work_id: string;
  run_id: string;
  worker_id: string;
  device_id: string;
  claim_token_hash: string;
  metadata_hash: string;
  attachment_count: number;
  creation_nonce: string;
  expires_at: string;
  created_at: string;
};

export type ReplyAttachmentUploadRow = {
  attachment_id: string;
  batch_request_id: string;
  client_id: string;
  filename: string;
  content_type: string;
  byte_size: number;
  sha256: ArrayBuffer;
  object_key: string;
  uploaded_at: string | null;
  consumed_at: string | null;
  completion_request_id: string | null;
};

export type ScopedReplyAttachmentUploadRow = ReplyAttachmentUploadRow & {
  reply_kind: ReplyKind;
  organization_id: string;
  project_id: string;
  work_id: string;
  run_id: string;
  worker_id: string;
  device_id: string;
  claim_token_hash: string;
  expires_at: string;
};

export type ReplyCompletionDisposition = "completed" | "requeued" | "failed";

export type ReplyCompletionReceiptRow = {
  request_id: string;
  reply_kind: ReplyKind;
  organization_id: string;
  project_id: string;
  work_id: string;
  run_id: string;
  worker_id: string;
  device_id: string;
  claim_token_hash: string;
  payload_hash: string;
  outcome_kind: "success" | "failure";
  disposition: ReplyCompletionDisposition;
  retained_until: string | null;
  created_at: string;
};

export type ReplyCompletionCommit = ReplyClaimScope & {
  requestId: string;
  payloadHash: string;
  outcomeKind: "success" | "failure";
  disposition: ReplyCompletionDisposition;
  retainedUntil?: string | null;
  completedAt: string;
  attachmentIds: readonly string[];
};

const bytesToHex = (value: Uint8Array) =>
  [...value]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export async function replyAttachmentMetadataHash(
  attachments: readonly ReplyAttachmentMetadata[],
) {
  return sha256(JSON.stringify(attachments.map((attachment) => ({
    clientId: attachment.clientId,
    filename: attachment.filename,
    contentType: attachment.contentType,
    byteSize: attachment.byteSize,
    sha256: bytesToHex(attachment.sha256),
  }))));
}

const batchMatches = (
  row: ReplyAttachmentUploadBatchRow,
  input: ReplyClaimScope & {
    requestId: string;
    metadataHash: string;
    attachmentCount: number;
  },
) =>
  row.request_id === input.requestId &&
  row.reply_kind === input.replyKind &&
  row.organization_id === input.organizationId &&
  row.project_id === input.projectId &&
  row.work_id === input.workId &&
  row.run_id === input.runId &&
  row.worker_id === input.workerId &&
  row.device_id === input.deviceId &&
  row.claim_token_hash === input.claimTokenHash &&
  row.metadata_hash === input.metadataHash &&
  row.attachment_count === input.attachmentCount;

export async function prepareReplyAttachmentUploadRows(
  db: D1Database,
  input: ReplyClaimScope & {
    requestId: string;
    metadataHash: string;
    attachments: readonly ReplyAttachmentMetadata[];
    createdAt: string;
    expiresAt: string;
  },
) {
  const prepared = input.attachments.map((attachment) => {
    const attachmentId = crypto.randomUUID();
    return {
      ...attachment,
      attachmentId,
      objectKey:
        `reply-attachments/${input.organizationId}/${input.workId}/${attachmentId}`,
    };
  });
  const creationNonce = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(
      `insert into briar_reply_attachment_upload_batches (
         request_id, reply_kind, organization_id, project_id,
         work_id, run_id, worker_id, device_id, claim_token_hash,
         metadata_hash, attachment_count, creation_nonce, expires_at, created_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (request_id) do nothing
       returning *`,
    ).bind(
      input.requestId,
      input.replyKind,
      input.organizationId,
      input.projectId,
      input.workId,
      input.runId,
      input.workerId,
      input.deviceId,
      input.claimTokenHash,
      input.metadataHash,
      prepared.length,
      creationNonce,
      input.expiresAt,
      input.createdAt,
    ),
    ...prepared.map((attachment) =>
      db.prepare(
        `insert into briar_reply_attachment_uploads (
           attachment_id, batch_request_id, client_id, filename,
           content_type, byte_size, sha256, object_key
         )
         select ?, batch.request_id, ?, ?, ?, ?, ?, ?
         from briar_reply_attachment_upload_batches batch
         where batch.request_id = ? and batch.creation_nonce = ?
         on conflict do nothing
         returning *`,
      ).bind(
        attachment.attachmentId,
        attachment.clientId,
        attachment.filename,
        attachment.contentType,
        attachment.byteSize,
        attachment.sha256,
        attachment.objectKey,
        input.requestId,
        creationNonce,
      )
    ),
  ]);
  const insertedBatch = results[0]?.results[0] as
    | ReplyAttachmentUploadBatchRow
    | undefined;
  const batch = insertedBatch ?? await db.prepare(
    `select * from briar_reply_attachment_upload_batches
     where request_id = ?`,
  ).bind(input.requestId).first<ReplyAttachmentUploadBatchRow>();
  if (!batch || !batchMatches(batch, {
    ...input,
    attachmentCount: prepared.length,
  })) {
    return null;
  }
  const uploads = await db.prepare(
    `select * from briar_reply_attachment_uploads
     where batch_request_id = ? order by rowid`,
  ).bind(input.requestId).all<ReplyAttachmentUploadRow>();
  if (uploads.results.length !== prepared.length) {
    throw new Error("Reply attachment upload batch was not stored atomically");
  }
  const byClientId = new Map(
    uploads.results.map((upload) => [upload.client_id, upload]),
  );
  const ordered = input.attachments.map((attachment) =>
    byClientId.get(attachment.clientId)
  );
  if (ordered.some((upload) => upload === undefined)) return null;
  return {
    replayed: insertedBatch === undefined,
    batch,
    uploads: ordered as ReplyAttachmentUploadRow[],
  };
}

export async function getScopedReplyAttachmentUpload(
  db: D1Database,
  attachmentId: string,
) {
  return db.prepare(
    `select upload.*, batch.reply_kind, batch.organization_id,
            batch.project_id, batch.work_id, batch.run_id, batch.worker_id,
            batch.device_id, batch.claim_token_hash, batch.expires_at
     from briar_reply_attachment_uploads upload
     join briar_reply_attachment_upload_batches batch
       on batch.request_id = upload.batch_request_id
     where upload.attachment_id = ?`,
  ).bind(attachmentId).first<ScopedReplyAttachmentUploadRow>();
}

export async function markReplyAttachmentUploaded(
  db: D1Database,
  attachmentId: string,
  observedAt: string,
) {
  const uploaded = await db.prepare(
    `update briar_reply_attachment_uploads as upload
     set uploaded_at = ?
     where upload.attachment_id = ? and upload.uploaded_at is null
       and upload.consumed_at is null
       and exists (
         select 1 from briar_reply_attachment_upload_batches batch
         where batch.request_id = upload.batch_request_id
           and batch.expires_at > ?
       )
     returning *`,
  ).bind(observedAt, attachmentId, observedAt)
    .first<ReplyAttachmentUploadRow>();
  return uploaded;
}

export async function resolveReplyCompletionAttachments(
  db: D1Database,
  input: ReplyClaimScope & {
    attachmentIds: readonly string[];
    observedAt: string;
  },
) {
  if (input.attachmentIds.length === 0) return [];
  if (new Set(input.attachmentIds).size !== input.attachmentIds.length) {
    return null;
  }
  const placeholders = input.attachmentIds.map(() => "?").join(", ");
  const result = await db.prepare(
    `select upload.*, batch.reply_kind, batch.organization_id,
            batch.project_id, batch.work_id, batch.run_id, batch.worker_id,
            batch.device_id, batch.claim_token_hash, batch.expires_at
     from briar_reply_attachment_uploads upload
     join briar_reply_attachment_upload_batches batch
       on batch.request_id = upload.batch_request_id
     where upload.attachment_id in (${placeholders})
       and batch.reply_kind = ? and batch.organization_id = ?
       and batch.project_id = ? and batch.work_id = ? and batch.run_id = ?
       and batch.worker_id = ? and batch.device_id = ?
       and batch.claim_token_hash = ? and batch.expires_at > ?
       and upload.uploaded_at is not null and upload.consumed_at is null`,
  ).bind(
    ...input.attachmentIds,
    input.replyKind,
    input.organizationId,
    input.projectId,
    input.workId,
    input.runId,
    input.workerId,
    input.deviceId,
    input.claimTokenHash,
    input.observedAt,
  ).all<ScopedReplyAttachmentUploadRow>();
  const byId = new Map(
    result.results.map((attachment) => [attachment.attachment_id, attachment]),
  );
  const ordered = input.attachmentIds.map((id) => byId.get(id));
  return ordered.some((attachment) => attachment === undefined)
    ? null
    : ordered as ScopedReplyAttachmentUploadRow[];
}

export function replyCompletionReceiptStatement(
  db: D1Database,
  input: ReplyClaimScope & {
    requestId: string;
    payloadHash: string;
    outcomeKind: "success" | "failure";
    disposition: ReplyCompletionDisposition;
    retainedUntil?: string | null;
    createdAt: string;
  },
) {
  return db.prepare(
    `insert into briar_reply_completion_receipts (
       request_id, reply_kind, organization_id, project_id,
       work_id, run_id, worker_id, device_id, claim_token_hash,
       payload_hash, outcome_kind, disposition, retained_until, created_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     returning *`,
  ).bind(
    input.requestId,
    input.replyKind,
    input.organizationId,
    input.projectId,
    input.workId,
    input.runId,
    input.workerId,
    input.deviceId,
    input.claimTokenHash,
    input.payloadHash,
    input.outcomeKind,
    input.disposition,
    input.retainedUntil ?? null,
    input.createdAt,
  );
}

export function consumeReplyAttachmentStatements(
  db: D1Database,
  input: ReplyClaimScope & {
    requestId: string;
    attachmentIds: readonly string[];
    consumedAt: string;
  },
) {
  return input.attachmentIds.map((attachmentId) => db.prepare(
    `update briar_reply_attachment_uploads as upload
     set consumed_at = ?, completion_request_id = ?
     where upload.attachment_id = ? and upload.uploaded_at is not null
       and upload.consumed_at is null
       and exists (
         select 1
         from briar_reply_attachment_upload_batches batch
         join briar_reply_completion_receipts receipt
           on receipt.request_id = ?
         where batch.request_id = upload.batch_request_id
           and batch.reply_kind = ? and batch.organization_id = ?
           and batch.project_id = ? and batch.work_id = ? and batch.run_id = ?
           and batch.worker_id = ? and batch.device_id = ?
           and batch.claim_token_hash = ? and batch.expires_at > ?
           and receipt.reply_kind = batch.reply_kind
           and receipt.work_id = batch.work_id
           and receipt.claim_token_hash = batch.claim_token_hash
       )
     returning attachment_id`,
  ).bind(
    input.consumedAt,
    input.requestId,
    attachmentId,
    input.requestId,
    input.replyKind,
    input.organizationId,
    input.projectId,
    input.workId,
    input.runId,
    input.workerId,
    input.deviceId,
    input.claimTokenHash,
    input.consumedAt,
  ));
}

export function replyAttachmentAvailabilityGuard(
  input: ReplyCompletionCommit,
) {
  if (input.attachmentIds.length === 0) {
    return { sql: "", bindings: [] as unknown[] };
  }
  const placeholders = input.attachmentIds.map(() => "?").join(", ");
  return {
    sql: `and (
      select count(*)
      from briar_reply_attachment_uploads upload
      join briar_reply_attachment_upload_batches batch
        on batch.request_id = upload.batch_request_id
      where upload.attachment_id in (${placeholders})
        and batch.reply_kind = ? and batch.organization_id = ?
        and batch.project_id = ? and batch.work_id = ? and batch.run_id = ?
        and batch.worker_id = ? and batch.device_id = ?
        and batch.claim_token_hash = ? and batch.expires_at > ?
        and upload.uploaded_at is not null and upload.consumed_at is null
    ) = ?`,
    bindings: [
      ...input.attachmentIds,
      input.replyKind,
      input.organizationId,
      input.projectId,
      input.workId,
      input.runId,
      input.workerId,
      input.deviceId,
      input.claimTokenHash,
      input.completedAt,
      input.attachmentIds.length,
    ],
  };
}

export async function findReplyCompletionReceipt(
  db: D1Database,
  input: ReplyClaimScope & { requestId: string },
) {
  return db.prepare(
    `select * from briar_reply_completion_receipts
     where request_id = ?
        or (reply_kind = ? and work_id = ? and worker_id = ?
          and claim_token_hash = ?)
     order by case when request_id = ? then 0 else 1 end
     limit 1`,
  ).bind(
    input.requestId,
    input.replyKind,
    input.workId,
    input.workerId,
    input.claimTokenHash,
    input.requestId,
  ).first<ReplyCompletionReceiptRow>();
}

export async function enqueueExpiredReplyAttachmentUploadCleanup(
  db: D1Database,
  observedAt: string,
  limit = 100,
) {
  const uploads = await db.prepare(
    `select upload.attachment_id, upload.batch_request_id
     from briar_reply_attachment_uploads upload
     join briar_reply_attachment_upload_batches batch
       on batch.request_id = upload.batch_request_id
     where batch.expires_at <= ? and upload.consumed_at is null
     order by batch.expires_at, batch.request_id, upload.attachment_id
     limit ?`,
  ).bind(observedAt, limit).all<{
    attachment_id: string;
    batch_request_id: string;
  }>();
  if (uploads.results.length === 0) return 0;
  const statements: D1PreparedStatement[] = [];
  for (const upload of uploads.results) {
    statements.push(
      db.prepare(
        `insert into briar_reply_upload_cleanup_queue (
           object_key, batch_request_id, queued_at, next_attempt_at
         )
         select upload.object_key, upload.batch_request_id, ?, ?
         from briar_reply_attachment_uploads upload
         join briar_reply_attachment_upload_batches batch
           on batch.request_id = upload.batch_request_id
         where upload.attachment_id = ? and upload.consumed_at is null
           and batch.expires_at <= ?
         on conflict (object_key) do nothing`,
      ).bind(observedAt, observedAt, upload.attachment_id, observedAt),
      db.prepare(
        `delete from briar_reply_attachment_uploads
         where attachment_id = ? and consumed_at is null
           and exists (
             select 1 from briar_reply_attachment_upload_batches batch
             where batch.request_id =
                   briar_reply_attachment_uploads.batch_request_id
               and batch.expires_at <= ?
           )
         returning attachment_id`,
      ).bind(upload.attachment_id, observedAt),
      db.prepare(
        `delete from briar_reply_attachment_upload_batches
         where request_id = ?
           and not exists (
             select 1 from briar_reply_attachment_uploads upload
             where upload.batch_request_id =
                   briar_reply_attachment_upload_batches.request_id
           )`,
      ).bind(upload.batch_request_id),
    );
  }
  const results = await db.batch(statements);
  return results.filter((_, index) => index % 3 === 1)
    .reduce((total, result) => total + result.results.length, 0);
}

export type ReplyUploadCleanupRow = {
  object_key: string;
  batch_request_id: string;
  attempts: number;
  generation: number;
  queued_at: string;
  next_attempt_at: string;
  last_error: string | null;
};

export async function enqueueReplyUploadObjectCleanup(
  db: D1Database,
  input: { objectKey: string; batchRequestId: string; observedAt: string },
) {
  return db.prepare(
    `insert into briar_reply_upload_cleanup_queue (
       object_key, batch_request_id, queued_at, next_attempt_at
     ) values (?, ?, ?, ?)
     on conflict (object_key) do nothing
     returning object_key`,
  ).bind(
    input.objectKey,
    input.batchRequestId,
    input.observedAt,
    input.observedAt,
  ).first<{ object_key: string }>();
}

const cleanupRetryAt = (observedAt: string, attempts: number) => {
  const base = Math.min(60 * 60_000, 2 ** Math.min(attempts, 10) * 1_000);
  return new Date(Date.parse(observedAt) + base).toISOString();
};

export async function processReplyUploadCleanupQueue(
  db: D1Database,
  bucket: Pick<R2Bucket, "delete">,
  observedAt: string,
  limit = 100,
) {
  const due = await db.prepare(
    `select * from briar_reply_upload_cleanup_queue
     where next_attempt_at <= ?
     order by next_attempt_at, attempts, queued_at, object_key
     limit ?`,
  ).bind(observedAt, limit).all<ReplyUploadCleanupRow>();
  let deleted = 0;
  let failed = 0;
  for (const item of due.results) {
    try {
      await bucket.delete(item.object_key);
      const removed = await db.prepare(
        `delete from briar_reply_upload_cleanup_queue
         where object_key = ? and generation = ?
         returning object_key`,
      ).bind(item.object_key, item.generation).first<{ object_key: string }>();
      if (removed) deleted += 1;
    } catch (error) {
      const nextAttempts = item.attempts + 1;
      await db.prepare(
        `update briar_reply_upload_cleanup_queue
         set attempts = ?, generation = generation + 1,
             next_attempt_at = ?, last_error = ?
         where object_key = ? and generation = ?`,
      ).bind(
        nextAttempts,
        cleanupRetryAt(observedAt, nextAttempts),
        (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
        item.object_key,
        item.generation,
      ).run();
      failed += 1;
    }
  }
  return { processed: due.results.length, deleted, failed };
}

export async function maintainReplyUploadCleanup(
  db: D1Database,
  bucket: Pick<R2Bucket, "delete">,
  observedAt: string,
) {
  const enqueuedUploads = await enqueueExpiredReplyAttachmentUploadCleanup(
    db,
    observedAt,
  );
  return {
    enqueuedUploads,
    ...await processReplyUploadCleanupQueue(db, bucket, observedAt),
  };
}
