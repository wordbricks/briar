import { contentDisposition } from "./attachment-storage";
import { hydrateAgentSkills } from "./agent-skills";
import {
  channelReplySessionRetentionUntil,
  completeChannelReply,
  failChannelReply,
  getClaimedChannelReply,
  getOrganizationProject,
  listChannelAgents,
} from "./channels";
import { sha256, sha256Bytes } from "./crypto-digest";
import { completeIssueAgentReplyOutput } from "./issue-agent-reply-completion-repository";
import {
  failIssueAgentReply,
  getClaimedIssueAgentReply,
} from "./issue-agent-reply-repository";
import { issueAttachmentMarkdown } from "../../src/lib/issue-markdown";
import { getOrganizationAgent } from "./organization-agents";
import {
  enqueueExpiredReplyAttachmentUploadCleanup,
  enqueueReplyUploadObjectCleanup,
  findReplyCompletionReceipt,
  getScopedReplyAttachmentUpload,
  markReplyAttachmentUploaded,
  prepareReplyAttachmentUploadRows,
  processReplyUploadCleanupQueue,
  replyAttachmentMetadataHash,
  resolveReplyCompletionAttachments,
  type ReplyClaimScope,
  type ReplyCompletionCommit,
  type ReplyCompletionDisposition,
  type ReplyCompletionReceiptRow,
  type ScopedReplyAttachmentUploadRow,
} from "./reply-completion-repository";
import {
  createReplyUploadTicket,
  REPLY_UPLOAD_TICKET_MAX_TTL_MS,
  verifyReplyUploadTicket,
} from "./reply-upload-ticket";
import {
  scheduleChannelActivityClear,
  scheduleChannelRealtimePublish,
  scheduleIssueActivityClear,
  scheduleProjectRealtimePublish,
} from "./realtime-scheduling";
import type {
  ChannelReplyCompletionInput,
  IssueReplyCompletionInput,
  PreparedReplyAttachmentUploadsInput,
} from "./worker-reply-completion-mappers";

export class ReplyCompletionApplicationError extends Error {
  constructor(
    readonly reason:
      | "invalid_request"
      | "invalid_capability"
      | "claim_conflict"
      | "replay_conflict",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ReplyCompletionApplicationError";
  }
}

export type ReplyCompletionWorker = {
  principal: { organizationId: string; deviceId: string };
  binding: { id: string; project_id: string };
};

export type ReplyCompletionApplicationServices = {
  readonly sha256: typeof sha256;
  readonly sha256Bytes: typeof sha256Bytes;
  readonly getClaimedIssueAgentReply: typeof getClaimedIssueAgentReply;
  readonly getClaimedChannelReply: typeof getClaimedChannelReply;
  readonly prepareReplyAttachmentUploadRows:
    typeof prepareReplyAttachmentUploadRows;
  readonly replyAttachmentMetadataHash: typeof replyAttachmentMetadataHash;
  readonly createReplyUploadTicket: typeof createReplyUploadTicket;
  readonly verifyReplyUploadTicket: typeof verifyReplyUploadTicket;
  readonly getScopedReplyAttachmentUpload: typeof getScopedReplyAttachmentUpload;
  readonly markReplyAttachmentUploaded: typeof markReplyAttachmentUploaded;
  readonly resolveReplyCompletionAttachments:
    typeof resolveReplyCompletionAttachments;
  readonly findReplyCompletionReceipt: typeof findReplyCompletionReceipt;
  readonly completeIssueAgentReplyOutput: typeof completeIssueAgentReplyOutput;
  readonly failIssueAgentReply: typeof failIssueAgentReply;
  readonly completeChannelReply: typeof completeChannelReply;
  readonly failChannelReply: typeof failChannelReply;
  readonly getOrganizationAgent: typeof getOrganizationAgent;
  readonly listChannelAgents: typeof listChannelAgents;
  readonly hydrateAgentSkills: typeof hydrateAgentSkills;
  readonly getOrganizationProject: typeof getOrganizationProject;
  readonly enqueueExpiredReplyAttachmentUploadCleanup:
    typeof enqueueExpiredReplyAttachmentUploadCleanup;
  readonly enqueueReplyUploadObjectCleanup: typeof enqueueReplyUploadObjectCleanup;
  readonly processReplyUploadCleanupQueue: typeof processReplyUploadCleanupQueue;
  readonly scheduleProjectRealtimePublish: typeof scheduleProjectRealtimePublish;
  readonly scheduleIssueActivityClear: typeof scheduleIssueActivityClear;
  readonly scheduleChannelRealtimePublish: typeof scheduleChannelRealtimePublish;
  readonly scheduleChannelActivityClear: typeof scheduleChannelActivityClear;
};

const applicationServices: ReplyCompletionApplicationServices = {
  sha256,
  sha256Bytes,
  getClaimedIssueAgentReply,
  getClaimedChannelReply,
  prepareReplyAttachmentUploadRows,
  replyAttachmentMetadataHash,
  createReplyUploadTicket,
  verifyReplyUploadTicket,
  getScopedReplyAttachmentUpload,
  markReplyAttachmentUploaded,
  resolveReplyCompletionAttachments,
  findReplyCompletionReceipt,
  completeIssueAgentReplyOutput,
  failIssueAgentReply,
  completeChannelReply,
  failChannelReply,
  getOrganizationAgent,
  listChannelAgents,
  hydrateAgentSkills,
  getOrganizationProject,
  enqueueExpiredReplyAttachmentUploadCleanup,
  enqueueReplyUploadObjectCleanup,
  processReplyUploadCleanupQueue,
  scheduleProjectRealtimePublish,
  scheduleIssueActivityClear,
  scheduleChannelRealtimePublish,
  scheduleChannelActivityClear,
};

const servicesWith = (overrides: Partial<ReplyCompletionApplicationServices>) =>
  ({ ...applicationServices, ...overrides });

const scopeFor = async (
  input: {
    projectId: string;
    workerId: string;
    claim: PreparedReplyAttachmentUploadsInput["claim"];
  },
  worker: ReplyCompletionWorker,
  services: ReplyCompletionApplicationServices,
): Promise<ReplyClaimScope> => {
  if (input.workerId !== worker.binding.id) {
    throw new ReplyCompletionApplicationError(
      "claim_conflict",
      "Reply claim belongs to another worker",
    );
  }
  if (input.projectId !== worker.binding.project_id) {
    throw new ReplyCompletionApplicationError(
      "claim_conflict",
      "Reply claim belongs to another project",
    );
  }
  if (
    input.claim.organizationId !== null &&
    input.claim.organizationId !== worker.principal.organizationId
  ) {
    throw new ReplyCompletionApplicationError(
      "claim_conflict",
      "Reply claim belongs to another organization",
    );
  }
  return {
    replyKind: input.claim.replyKind,
    organizationId: worker.principal.organizationId,
    projectId: input.projectId,
    workId: input.claim.workId,
    runId: input.claim.runId,
    workerId: worker.binding.id,
    deviceId: worker.principal.deviceId,
    claimTokenHash: await services.sha256(input.claim.claimToken),
  };
};

const activeClaim = async (
  db: D1Database,
  scope: ReplyClaimScope,
  observedAt: string,
  services: ReplyCompletionApplicationServices,
) => {
  if (scope.replyKind === "issue") {
    const job = await services.getClaimedIssueAgentReply(
      db,
      scope.projectId,
      scope.workId,
      {
        workerId: scope.workerId,
        claimTokenHash: scope.claimTokenHash,
        observedAt,
      },
    );
    return job && job.run_id === scope.runId ? job : null;
  }
  const job = await services.getClaimedChannelReply(db, {
    jobId: scope.workId,
    deviceId: scope.deviceId,
    workerId: scope.workerId,
    claimTokenHash: scope.claimTokenHash,
    observedAt,
  });
  return job && job.organization_id === scope.organizationId &&
      job.channel_id === scope.runId &&
      (job.project_id === null || job.project_id === scope.projectId)
    ? job
    : null;
};

const claimConflict = () => new ReplyCompletionApplicationError(
  "claim_conflict",
  "Reply claim is no longer active",
);

export async function prepareReplyAttachmentUploadsApplication(
  input: {
    db: D1Database;
    env: Env;
    context?: ExecutionContext;
    worker: ReplyCompletionWorker;
    request: PreparedReplyAttachmentUploadsInput;
    observedAt?: string;
  },
  overrides: Partial<ReplyCompletionApplicationServices> = {},
) {
  const services = servicesWith(overrides);
  const observedAt = input.observedAt ?? new Date().toISOString();
  const scope = await scopeFor(input.request, input.worker, services);
  const job = await activeClaim(input.db, scope, observedAt, services);
  if (!job) throw claimConflict();
  const leaseExpiresAt = Date.parse(job.lease_expires_at ?? "");
  const expiresAtMs = Math.min(
    leaseExpiresAt,
    Date.parse(observedAt) + REPLY_UPLOAD_TICKET_MAX_TTL_MS,
  );
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.parse(observedAt)) {
    throw claimConflict();
  }
  const metadataHash = await services.replyAttachmentMetadataHash(
    input.request.attachments,
  );
  let prepared;
  try {
    prepared = await services.prepareReplyAttachmentUploadRows(input.db, {
      ...scope,
      requestId: input.request.requestId,
      metadataHash,
      attachments: input.request.attachments,
      createdAt: observedAt,
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
  } catch (cause) {
    throw new ReplyCompletionApplicationError(
      "claim_conflict",
      "Reply attachment prepare no longer owns the claim",
      { cause },
    );
  }
  if (!prepared) {
    throw new ReplyCompletionApplicationError(
      "replay_conflict",
      "Reply attachment prepare request was reused with different metadata",
    );
  }
  if (prepared.batch.expires_at <= observedAt) {
    throw new ReplyCompletionApplicationError(
      "replay_conflict",
      "Reply attachment prepare request has expired; use a new request ID",
    );
  }
  const ticketExpiresAt = Date.parse(prepared.batch.expires_at);
  const uploads = await Promise.all(prepared.uploads.map(async (upload) => ({
    clientId: upload.client_id,
    attachmentId: upload.attachment_id,
    uploadCapability: await services.createReplyUploadTicket(
      input.env.BETTER_AUTH_SECRET,
      { attachmentId: upload.attachment_id, expiresAt: ticketExpiresAt },
    ),
    expiresAt: prepared.batch.expires_at,
  })));
  const enqueueCleanup = async () => {
    await services.enqueueExpiredReplyAttachmentUploadCleanup(
      input.db,
      observedAt,
    );
    await services.processReplyUploadCleanupQueue(
      input.db,
      input.env.ATTACHMENTS,
      observedAt,
    );
  };
  if (input.context) input.context.waitUntil(enqueueCleanup());
  else await enqueueCleanup();
  return { replayed: prepared.replayed, uploads };
}

const equalHexDigest = (stored: ArrayBuffer, actualHex: string) => {
  const storedBytes = new Uint8Array(stored);
  if (storedBytes.byteLength !== 32 || actualHex.length !== 64) return false;
  let difference = 0;
  for (let index = 0; index < storedBytes.length; index += 1) {
    const actual = Number.parseInt(actualHex.slice(index * 2, index * 2 + 2), 16);
    difference |= storedBytes[index]! ^ actual;
  }
  return difference === 0;
};

export async function uploadReplyAttachmentApplication(
  input: {
    db: D1Database;
    bucket: R2Bucket;
    signingSecret: string;
    attachmentId: string;
    capability: string;
    contentType: string;
    body: ArrayBuffer;
    observedAt?: string;
  },
  overrides: Partial<ReplyCompletionApplicationServices> = {},
) {
  const services = servicesWith(overrides);
  const observedAt = input.observedAt ?? new Date().toISOString();
  const ticket = await services.verifyReplyUploadTicket(
    input.signingSecret,
    input.capability,
    input.attachmentId,
    Date.parse(observedAt),
  );
  if (!ticket) {
    throw new ReplyCompletionApplicationError(
      "invalid_capability",
      "Reply attachment upload capability is invalid or expired",
    );
  }
  const upload = await services.getScopedReplyAttachmentUpload(
    input.db,
    input.attachmentId,
  );
  if (
    !upload || upload.expires_at <= observedAt || upload.consumed_at ||
    upload.uploaded_at
  ) {
    throw new ReplyCompletionApplicationError(
      "claim_conflict",
      "Reply attachment upload is no longer available",
    );
  }
  const contentType = input.contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== upload.content_type || input.body.byteLength !== upload.byte_size) {
    throw new ReplyCompletionApplicationError(
      "invalid_request",
      "Reply attachment content metadata does not match its reservation",
    );
  }
  const digest = await services.sha256Bytes(input.body);
  if (!equalHexDigest(upload.sha256, digest)) {
    throw new ReplyCompletionApplicationError(
      "invalid_request",
      "Reply attachment content digest does not match its reservation",
    );
  }
  await input.bucket.put(upload.object_key, input.body, {
    httpMetadata: {
      contentType: upload.content_type,
      contentDisposition: contentDisposition(upload.filename),
    },
    customMetadata: {
      attachmentId: upload.attachment_id,
      replyKind: upload.reply_kind,
      organizationId: upload.organization_id,
      projectId: upload.project_id,
      workId: upload.work_id,
      runId: upload.run_id,
    },
  });
  const stored = await services.markReplyAttachmentUploaded(
    input.db,
    input.attachmentId,
    observedAt,
  );
  if (!stored) {
    const current = await services.getScopedReplyAttachmentUpload(
      input.db,
      input.attachmentId,
    );
    if (!current?.uploaded_at) {
      await services.enqueueReplyUploadObjectCleanup(input.db, {
        objectKey: upload.object_key,
        batchRequestId: upload.batch_request_id,
        observedAt,
      });
    }
    throw new ReplyCompletionApplicationError(
      "claim_conflict",
      "Reply attachment upload lost its reservation",
    );
  }
  return { objectKey: upload.object_key };
}

const completionPayloadHash = (
  input: IssueReplyCompletionInput | ChannelReplyCompletionInput,
  services: ReplyCompletionApplicationServices,
) => services.sha256(JSON.stringify({
  replyKind: input.claim.replyKind,
  projectId: input.projectId,
  workerId: input.workerId,
  workId: input.claim.workId,
  runId: input.claim.runId,
  attachmentIds: input.attachmentIds,
  outcome: input.outcome,
  ...(input.claim.replyKind === "channel"
    ? { conversationId: (input as ChannelReplyCompletionInput).conversationId }
    : {}),
}));

const receiptMatches = (
  receipt: ReplyCompletionReceiptRow,
  input: ReplyClaimScope & { requestId: string; payloadHash: string },
) =>
  receipt.request_id === input.requestId &&
  receipt.reply_kind === input.replyKind &&
  receipt.organization_id === input.organizationId &&
  receipt.project_id === input.projectId &&
  receipt.work_id === input.workId &&
  receipt.run_id === input.runId &&
  receipt.worker_id === input.workerId &&
  receipt.device_id === input.deviceId &&
  receipt.claim_token_hash === input.claimTokenHash &&
  receipt.payload_hash === input.payloadHash;

const preflightReceipt = async (
  db: D1Database,
  input: ReplyClaimScope & { requestId: string; payloadHash: string },
  services: ReplyCompletionApplicationServices,
) => {
  const receipt = await services.findReplyCompletionReceipt(db, input);
  if (!receipt) return null;
  if (!receiptMatches(receipt, input)) {
    throw new ReplyCompletionApplicationError(
      "replay_conflict",
      "Reply claim was already completed with a different request",
    );
  }
  return receipt;
};

const completionResult = (receipt: ReplyCompletionReceiptRow, replayed: boolean) => ({
  replayed,
  disposition: receipt.disposition,
  retainedUntil: receipt.retained_until,
});

const completionCommit = (
  scope: ReplyClaimScope,
  input: {
    requestId: string;
    payloadHash: string;
    outcomeKind: "success" | "failure";
    disposition: ReplyCompletionDisposition;
    retainedUntil?: string | null;
    completedAt: string;
    attachmentIds: readonly string[];
  },
): ReplyCompletionCommit => ({ ...scope, ...input });

const recoverConcurrentReceipt = async (
  db: D1Database,
  input: ReplyClaimScope & { requestId: string; payloadHash: string },
  services: ReplyCompletionApplicationServices,
  originalCause: unknown,
) => {
  const receipt = await services.findReplyCompletionReceipt(db, input);
  if (!receipt) throw originalCause;
  if (!receiptMatches(receipt, input)) {
    throw new ReplyCompletionApplicationError(
      "replay_conflict",
      "Reply claim was concurrently completed with a different request",
      { cause: originalCause },
    );
  }
  return completionResult(receipt, true);
};

const isReplyCompletionGuardAbort = (cause: unknown) =>
  cause instanceof Error && [
    "invalid reply completion receipt",
    "invalid reply attachment upload state transition",
  ].some((message) => cause.message.includes(message));

const recoverReceiptOrGuardConflict = async (
  db: D1Database,
  input: ReplyClaimScope & {
    requestId: string;
    payloadHash: string;
    observedAt: string;
  },
  services: ReplyCompletionApplicationServices,
  originalCause: unknown,
) => {
  try {
    return await recoverConcurrentReceipt(
      db,
      input,
      services,
      originalCause,
    );
  } catch (recoveredCause) {
    if (recoveredCause !== originalCause) throw recoveredCause;
    if (isReplyCompletionGuardAbort(originalCause)) throw claimConflict();
    let claim;
    try {
      claim = await activeClaim(db, input, input.observedAt, services);
    } catch {
      throw originalCause;
    }
    if (!claim) throw claimConflict();
    throw originalCause;
  }
};

const issueAttachments = (attachments: ScopedReplyAttachmentUploadRow[]) =>
  attachments.map((attachment) => ({
    id: attachment.attachment_id,
    object_key: attachment.object_key,
    filename: attachment.filename,
    content_type: attachment.content_type,
    byte_size: attachment.byte_size,
  }));

const channelExecutionTargetInSnapshot = (
  claimed: { project_id: string | null; execution_target_ids_json?: string },
  target: { projectId: string; runId: string },
) => {
  if (claimed.project_id !== target.projectId) return false;
  try {
    const values: unknown = JSON.parse(claimed.execution_target_ids_json ?? "");
    return Array.isArray(values) &&
      values.every((value) => typeof value === "string") &&
      values.includes(target.runId);
  } catch {
    return false;
  }
};

export async function completeIssueReplyApplication(
  input: {
    db: D1Database;
    env: Env;
    context?: ExecutionContext;
    worker: ReplyCompletionWorker;
    request: IssueReplyCompletionInput;
    observedAt?: string;
  },
  overrides: Partial<ReplyCompletionApplicationServices> = {},
) {
  const services = servicesWith(overrides);
  const observedAt = input.observedAt ?? new Date().toISOString();
  const scope = await scopeFor(input.request, input.worker, services);
  const payloadHash = await completionPayloadHash(input.request, services);
  const replay = await preflightReceipt(input.db, {
    ...scope,
    requestId: input.request.requestId,
    payloadHash,
  }, services);
  if (replay) {
    services.scheduleProjectRealtimePublish(
      input.env,
      input.db,
      scope.projectId,
      input.context,
    );
    return completionResult(replay, true);
  }
  const job = await activeClaim(input.db, scope, observedAt, services);
  if (!job || !("run_id" in job)) throw claimConflict();
  const attachments = await services.resolveReplyCompletionAttachments(
    input.db,
    { ...scope, attachmentIds: input.request.attachmentIds, observedAt },
  );
  if (!attachments) {
    throw new ReplyCompletionApplicationError(
      "claim_conflict",
      "Reply attachment reference is unavailable or outside the claim",
    );
  }
  const disposition: ReplyCompletionDisposition =
    input.request.outcome.case === "success"
      ? "completed"
      : job.attempts >= 3
      ? "failed"
      : "requeued";
  const commit = completionCommit(scope, {
    requestId: input.request.requestId,
    payloadHash,
    outcomeKind: input.request.outcome.case,
    disposition,
    completedAt: observedAt,
    attachmentIds: input.request.attachmentIds,
  });
  try {
    let completed;
    if (input.request.outcome.case === "failure") {
      completed = await services.failIssueAgentReply(
        input.db,
        scope.projectId,
        scope.workId,
        {
          workerId: scope.workerId,
          claimTokenHash: scope.claimTokenHash,
          error: input.request.outcome.error,
          updatedAt: observedAt,
          commit,
        },
      );
    } else {
      const replyBody = [
        input.request.outcome.completion.body!,
        ...attachments.map((attachment) => issueAttachmentMarkdown(
          attachment.attachment_id,
          attachment.filename,
        )),
      ].filter(Boolean).join("\n\n");
      completed = await services.completeIssueAgentReplyOutput(
        input.db,
        scope.projectId,
        scope.workId,
        {
          workerId: scope.workerId,
          claimTokenHash: scope.claimTokenHash,
          completedAt: observedAt,
          output: {
            body: replyBody,
            proposedAction:
              input.request.outcome.completion.proposedAction ?? null,
            executionProposal: Boolean(
              input.request.outcome.completion.executionProposal,
            ),
            skillExecutionProposal: Boolean(
              input.request.outcome.completion.skillExecutionProposal,
            ),
            attachments: issueAttachments(attachments),
          },
          commit,
        },
      );
    }
    if (!completed) throw claimConflict();
    services.scheduleProjectRealtimePublish(
      input.env,
      input.db,
      scope.projectId,
      input.context,
    );
    services.scheduleIssueActivityClear(
      input.env,
      scope.organizationId,
      completed,
      input.context,
    );
    return { replayed: false, disposition, retainedUntil: null };
  } catch (cause) {
    if (cause instanceof ReplyCompletionApplicationError) throw cause;
    return recoverReceiptOrGuardConflict(input.db, {
      ...scope,
      requestId: input.request.requestId,
      payloadHash,
      observedAt,
    }, services, cause);
  }
}

export async function completeChannelReplyApplication(
  input: {
    db: D1Database;
    env: Env;
    context?: ExecutionContext;
    worker: ReplyCompletionWorker;
    request: ChannelReplyCompletionInput;
    observedAt?: string;
  },
  overrides: Partial<ReplyCompletionApplicationServices> = {},
) {
  const services = servicesWith(overrides);
  const observedAt = input.observedAt ?? new Date().toISOString();
  const scope = await scopeFor(input.request, input.worker, services);
  const payloadHash = await completionPayloadHash(input.request, services);
  const replay = await preflightReceipt(input.db, {
    ...scope,
    requestId: input.request.requestId,
    payloadHash,
  }, services);
  if (replay) {
    services.scheduleChannelRealtimePublish(
      input.env,
      input.db,
      scope.organizationId,
      input.context,
    );
    return completionResult(replay, true);
  }
  const claimed = await activeClaim(input.db, scope, observedAt, services);
  if (!claimed || !("channel_id" in claimed)) throw claimConflict();
  const attachments = await services.resolveReplyCompletionAttachments(
    input.db,
    { ...scope, attachmentIds: input.request.attachmentIds, observedAt },
  );
  if (!attachments) {
    throw new ReplyCompletionApplicationError(
      "claim_conflict",
      "Reply attachment reference is unavailable or outside the claim",
    );
  }
  const retainedUntil = channelReplySessionRetentionUntil(observedAt);
  const disposition: ReplyCompletionDisposition =
    input.request.outcome.case === "success"
      ? "completed"
      : claimed.attempts >= 3
      ? "failed"
      : "requeued";
  const commit = completionCommit(scope, {
    requestId: input.request.requestId,
    payloadHash,
    outcomeKind: input.request.outcome.case,
    disposition,
    retainedUntil,
    completedAt: observedAt,
    attachmentIds: input.request.attachmentIds,
  });
  try {
    let completed;
    if (input.request.outcome.case === "failure") {
      completed = await services.failChannelReply(input.db, {
        jobId: scope.workId,
        deviceId: scope.deviceId,
        workerId: scope.workerId,
        claimTokenHash: scope.claimTokenHash,
        error: input.request.outcome.error,
        updatedAt: observedAt,
        commit,
      });
    } else {
      const agent = await services.getOrganizationAgent(
        input.db,
        scope.organizationId,
        claimed.agent_id,
      );
      if (!agent) {
        throw new ReplyCompletionApplicationError(
          "claim_conflict",
          "Reply job lost its Agent",
        );
      }
      const result = input.request.outcome.completion;
      if (
        result.delegation &&
        (agent.project_id !== null || claimed.delegated_by_reply_job_id !== null)
      ) {
        throw new ReplyCompletionApplicationError(
          "invalid_request",
          "Only an Organization Agent can delegate",
        );
      }
      const defaultProject = (value: string | null) => value ?? agent.project_id;
      const document = result.document
        ? { ...result.document, projectId: defaultProject(result.document.projectId) }
        : null;
      const issueProposal = result.issueProposal
        ? {
            ...result.issueProposal,
            projectId: defaultProject(result.issueProposal.projectId),
          }
        : null;
      const issueBatchProposal = result.issueBatchProposal
        ? {
            ...result.issueBatchProposal,
            projectId: defaultProject(result.issueBatchProposal.projectId),
          }
        : null;
      const executionProposal = result.executionProposal;
      if (
        agent.project_id === null &&
        (executionProposal || issueProposal?.executeAfterCreate ||
          result.skillExecutionProposal)
      ) {
        throw new ReplyCompletionApplicationError(
          "invalid_request",
          "Organization Agents must delegate execution requests",
        );
      }
      if (
        executionProposal &&
        !channelExecutionTargetInSnapshot(claimed, executionProposal)
      ) {
        throw new ReplyCompletionApplicationError(
          "claim_conflict",
          "Issue execution target is outside the reply claim snapshot",
        );
      }
      if (
        result.skillExecutionProposal &&
        (!claimed.skill_id ||
          claimed.selected_skill_id_snapshot !== claimed.skill_id ||
          !agent.skills.some((skill) =>
            skill.id === claimed.skill_id && skill.provider === claimed.agent_provider
          ))
      ) {
        throw new ReplyCompletionApplicationError(
          "claim_conflict",
          "Agent Skill execution requires the server-selected Skill",
        );
      }
      let delegation: Parameters<typeof completeChannelReply>[2]["delegation"] = null;
      if (result.delegation) {
        const roster = await services.hydrateAgentSkills(
          input.db,
          await services.listChannelAgents(input.db, claimed.channel_id),
        );
        const target = roster.find((candidate) =>
          candidate.id === result.delegation?.agentId
        );
        if (
          !target?.project_id ||
          target.organization_id !== scope.organizationId ||
          target.project_id !== result.delegation.projectId
        ) {
          throw new ReplyCompletionApplicationError(
            "invalid_request",
            "Delegation target is not eligible in this channel",
          );
        }
        delegation = {
          projectId: target.project_id,
          agentId: target.id,
          skillId: null,
          provider: target.provider,
          request: result.delegation.request,
        };
      }
      for (const targetProjectId of [
        document?.projectId,
        issueProposal?.projectId,
        issueBatchProposal?.projectId,
        executionProposal?.projectId,
      ]) {
        if (
          targetProjectId &&
          !(await services.getOrganizationProject(
            input.db,
            scope.organizationId,
            targetProjectId,
          ))
        ) {
          throw new ReplyCompletionApplicationError(
            "invalid_request",
            "Reply target project is outside the organization",
          );
        }
      }
      completed = await services.completeChannelReply(input.db, claimed, {
        jobId: scope.workId,
        deviceId: scope.deviceId,
        workerId: scope.workerId,
        claimTokenHash: scope.claimTokenHash,
        body: result.body,
        document,
        issueProposal,
        issueBatchProposal,
        executionProposal,
        skillExecutionProposal: Boolean(result.skillExecutionProposal),
        delegation,
        agentName: agent.name,
        agentProvider: claimed.agent_provider ?? agent.provider,
        completedAt: observedAt,
        conversationId: input.request.conversationId,
        attachments: attachments.map((attachment) => ({
          id: attachment.attachment_id,
          organization_id: scope.organizationId,
          object_key: attachment.object_key,
          filename: attachment.filename,
          content_type: attachment.content_type,
          byte_size: attachment.byte_size,
        })),
        commit,
      });
    }
    if (!completed) throw claimConflict();
    services.scheduleChannelRealtimePublish(
      input.env,
      input.db,
      scope.organizationId,
      input.context,
    );
    services.scheduleChannelActivityClear(input.env, completed, input.context);
    return { replayed: false, disposition, retainedUntil };
  } catch (cause) {
    if (cause instanceof ReplyCompletionApplicationError) throw cause;
    return recoverReceiptOrGuardConflict(input.db, {
      ...scope,
      requestId: input.request.requestId,
      payloadHash,
      observedAt,
    }, services, cause);
  }
}
