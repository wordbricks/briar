import {
  consumeUploadStatements,
  prepareUploadRows,
  resolveAvailableUploads,
  uploadAvailabilityGuard,
  type UploadMetadata,
  type UploadScope,
} from "./upload-repository";

export type IssueAttachmentUploadPurpose =
  | "issue_create"
  | "issue_update"
  | "issue_message";

export type IssueAttachmentUploadScope = {
  purpose: IssueAttachmentUploadPurpose;
  organizationId: string;
  projectId: string;
  userId: string;
  mutationId: string;
  runId: string | null;
};

const uploadScope = (scope: IssueAttachmentUploadScope): UploadScope => ({
  purpose: scope.purpose,
  organizationId: scope.organizationId,
  projectId: scope.projectId,
  channelId: null,
  userId: scope.userId,
  workId: scope.mutationId,
  runId: scope.runId,
  workerId: null,
  deviceId: null,
  claimTokenHash: null,
});

export function prepareIssueAttachmentUploadRows(
  db: D1Database,
  input: IssueAttachmentUploadScope & {
    preparationRequestId: string;
    attachments: readonly UploadMetadata[];
    createdAt: string;
    expiresAt: string;
  },
) {
  return prepareUploadRows(db, {
    ...uploadScope(input),
    requestId: input.preparationRequestId,
    files: input.attachments,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  });
}

export async function resolveIssueAttachmentUploads(
  db: D1Database,
  input: IssueAttachmentUploadScope & {
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
  return new Set(uploads.map((upload) => upload.batch_request_id)).size === 1
    ? uploads
    : null;
}

export function issueAttachmentUploadAvailabilityGuard(
  input: IssueAttachmentUploadScope & {
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

export function issueAttachmentUploadConsumeStatements(
  db: D1Database,
  input: IssueAttachmentUploadScope & {
    uploadIds: readonly string[];
    consumedAt: string;
  },
) {
  return consumeUploadStatements(db, {
    ...uploadScope(input),
    uploadIds: input.uploadIds,
    consumerKind: input.purpose,
    consumerId: input.mutationId,
    consumedAt: input.consumedAt,
  });
}
