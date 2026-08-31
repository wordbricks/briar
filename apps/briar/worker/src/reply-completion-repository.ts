import {
  consumeUploadStatements,
  prepareUploadRows,
  resolveAvailableUploads,
  uploadAvailabilityGuard,
  type ScopedUploadRow,
  type UploadMetadata,
  type UploadScope,
} from "./upload-repository";

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

export type ReplyAttachmentMetadata = UploadMetadata;
export type ScopedReplyAttachmentUploadRow = ScopedUploadRow;

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

const replyUploadScope = (scope: ReplyClaimScope): UploadScope => ({
  purpose: scope.replyKind === "issue" ? "issue_reply" : "channel_reply",
  organizationId: scope.organizationId,
  projectId: scope.projectId,
  workId: scope.workId,
  runId: scope.runId,
  workerId: scope.workerId,
  deviceId: scope.deviceId,
  claimTokenHash: scope.claimTokenHash,
});

export async function prepareReplyAttachmentUploadRows(
  db: D1Database,
  input: ReplyClaimScope & {
    requestId: string;
    attachments: readonly ReplyAttachmentMetadata[];
    createdAt: string;
    expiresAt: string;
  },
) {
  return prepareUploadRows(db, {
    ...replyUploadScope(input),
    requestId: input.requestId,
    files: input.attachments,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  });
}

export async function resolveReplyCompletionAttachments(
  db: D1Database,
  input: ReplyClaimScope & {
    attachmentIds: readonly string[];
    observedAt: string;
  },
) {
  return resolveAvailableUploads(db, {
    ...replyUploadScope(input),
    uploadIds: input.attachmentIds,
    observedAt: input.observedAt,
  });
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
  return consumeUploadStatements(db, {
    ...replyUploadScope(input),
    uploadIds: input.attachmentIds,
    consumerKind: "reply_completion",
    consumerId: input.requestId,
    consumedAt: input.consumedAt,
  });
}

export function replyAttachmentAvailabilityGuard(
  input: ReplyCompletionCommit,
) {
  return uploadAvailabilityGuard({
    ...replyUploadScope(input),
    uploadIds: input.attachmentIds,
    observedAt: input.completedAt,
  });
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
