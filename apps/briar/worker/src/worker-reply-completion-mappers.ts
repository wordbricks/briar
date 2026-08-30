import { RunStatus } from "@briar/contracts/gen/briar/app/v1/common_pb";
import type {
  CompleteChannelReplyRequest,
  CompleteIssueReplyRequest,
  PrepareReplyAttachmentUploadsRequest,
  ReplyIssueDraft,
  WorkClaimIdentity,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { channelReplyCompletionSchema } from "../../src/lib/channels-contract";
import {
  agentReplyAttachmentMimeTypeFromName,
  htmlArtifactMimeType,
  validateAgentReplyAttachments,
} from "../../src/lib/agent-reply-attachments";
import { issueAttachmentMimeTypes } from "../../src/lib/issue-attachments";
import { decodeIssueAgentReplyResult } from "./issue-request-contract";
import { decodeRequestSync } from "./request-schema";
import type {
  ReplyAttachmentMetadata,
  ReplyKind,
} from "./reply-completion-repository";
import { UuidString } from "./schema-codecs";

const canonicalUuid = decodeRequestSync(UuidString);
const decodeChannelReplyCompletion = decodeRequestSync(
  channelReplyCompletionSchema,
);
const imageMimeTypes = new Set<string>(
  issueAttachmentMimeTypes.filter((type) => type.startsWith("image/")),
);

export class ReplyCompletionMappingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReplyCompletionMappingError";
  }
}

const mapping = <Value>(operation: () => Value, message: string) => {
  try {
    return operation();
  } catch (cause) {
    throw new ReplyCompletionMappingError(message, { cause });
  }
};

const requiredText = (value: string, field: string, maximum: number) => {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maximum) {
    throw new ReplyCompletionMappingError(
      `${field} must contain 1-${maximum} characters`,
    );
  }
  return normalized;
};

const optionalText = (
  value: string | undefined,
  field: string,
  maximum: number,
) => value === undefined ? null : requiredText(value, field, maximum);

const requestId = (value: string) =>
  mapping(() => canonicalUuid(value).toLowerCase(), "Request ID is invalid");

const projectId = (value: string) =>
  mapping(() => canonicalUuid(value).toLowerCase(), "Project ID is invalid");

export type ReplyWireClaim = {
  replyKind: ReplyKind;
  organizationId: string | null;
  workId: string;
  runId: string;
  claimToken: string;
};

export function replyWireClaim(
  value: WorkClaimIdentity | undefined,
  expectedKind?: ReplyKind,
): ReplyWireClaim {
  if (!value) {
    throw new ReplyCompletionMappingError("Reply claim identity is required");
  }
  const workId = mapping(
    () => canonicalUuid(value.workId).toLowerCase(),
    "Reply work ID is invalid",
  );
  const runId = mapping(
    () => canonicalUuid(value.runId).toLowerCase(),
    "Reply run ID is invalid",
  );
  const variant = value.work;
  if (variant.case === "issueReply") {
    if (expectedKind && expectedKind !== "issue") {
      throw new ReplyCompletionMappingError("Channel reply claim is required");
    }
    if (
      !value.claimToken.startsWith("briar_reply_claim_") ||
      value.claimToken.length > 200
    ) {
      throw new ReplyCompletionMappingError("Issue reply claim token is invalid");
    }
    return {
      replyKind: "issue",
      organizationId: null,
      workId,
      runId,
      claimToken: value.claimToken,
    };
  }
  if (variant.case === "channelReply") {
    if (expectedKind && expectedKind !== "channel") {
      throw new ReplyCompletionMappingError("Issue reply claim is required");
    }
    if (
      !value.claimToken.startsWith("briar_channel_claim_") ||
      value.claimToken.length > 200
    ) {
      throw new ReplyCompletionMappingError("Channel reply claim token is invalid");
    }
    const organizationId = mapping(
      () => canonicalUuid(variant.value.organizationId).toLowerCase(),
      "Reply organization ID is invalid",
    );
    return {
      replyKind: "channel",
      organizationId,
      workId,
      runId,
      claimToken: value.claimToken,
    };
  }
  throw new ReplyCompletionMappingError("Reply claim variant is required");
}

const normalizedContentType = (value: string, filename: string) => {
  const declared = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (declared === htmlArtifactMimeType || imageMimeTypes.has(declared)) {
    return declared;
  }
  const inferred = agentReplyAttachmentMimeTypeFromName(filename);
  if (!inferred) {
    throw new ReplyCompletionMappingError(
      "Reply attachments must be images or HTML files",
    );
  }
  return inferred;
};

export type PreparedReplyAttachmentUploadsInput = {
  requestId: string;
  projectId: string;
  workerId: string;
  claim: ReplyWireClaim;
  attachments: ReplyAttachmentMetadata[];
};

export function prepareReplyAttachmentUploadsInputFromProto(
  request: PrepareReplyAttachmentUploadsRequest,
): PreparedReplyAttachmentUploadsInput {
  if (request.attachments.length < 1 || request.attachments.length > 5) {
    throw new ReplyCompletionMappingError(
      "Reply attachment prepare requires 1-5 files",
    );
  }
  const seenClientIds = new Set<string>();
  const attachments = request.attachments.map((attachment) => {
    const clientId = requiredText(attachment.clientId, "Attachment client ID", 128);
    if (seenClientIds.has(clientId)) {
      throw new ReplyCompletionMappingError("Attachment client IDs must be unique");
    }
    seenClientIds.add(clientId);
    const filename = requiredText(
      attachment.filename.normalize("NFC"),
      "Attachment filename",
      255,
    );
    if (filename.includes("\0")) {
      throw new ReplyCompletionMappingError("Attachment filename is invalid");
    }
    if (
      attachment.byteSize < 1n ||
      attachment.byteSize > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new ReplyCompletionMappingError("Attachment byte size is invalid");
    }
    if (attachment.sha256.byteLength !== 32) {
      throw new ReplyCompletionMappingError(
        "Attachment SHA-256 digest must contain exactly 32 bytes",
      );
    }
    return {
      clientId,
      filename,
      contentType: normalizedContentType(attachment.contentType, filename),
      byteSize: Number(attachment.byteSize),
      sha256: Uint8Array.from(attachment.sha256),
    };
  });
  const attachmentIssue = validateAgentReplyAttachments(
    attachments.map((attachment) => ({
      name: attachment.filename,
      type: attachment.contentType,
      size: attachment.byteSize,
    })),
  );
  if (attachmentIssue) throw new ReplyCompletionMappingError(attachmentIssue);
  return {
    requestId: requestId(request.requestId),
    projectId: projectId(request.projectId),
    workerId: requiredText(request.workerId, "Worker ID", 128),
    claim: replyWireClaim(request.work),
    attachments,
  };
}

const issueStatus = (status: RunStatus, channel: boolean) => {
  if (status === RunStatus.BACKLOG) return "backlog" as const;
  if (!channel && status === RunStatus.QUEUED) return "queued" as const;
  throw new ReplyCompletionMappingError(
    channel
      ? "Channel reply issue status must be backlog"
      : "Issue reply issue status must be backlog or queued",
  );
};

const issueDraft = (draft: ReplyIssueDraft | undefined) => {
  if (!draft) throw new ReplyCompletionMappingError("Issue draft is required");
  return {
    title: draft.title,
    description: draft.description ?? null,
    priority: draft.priority ?? null,
    status: issueStatus(draft.status, false),
  };
};

const channelIssueDraft = (draft: ReplyIssueDraft | undefined) => {
  if (!draft) throw new ReplyCompletionMappingError("Issue draft is required");
  issueStatus(draft.status, true);
  return {
    title: draft.title,
    description: draft.description ?? null,
    priority: draft.priority ?? null,
    status: "backlog" as const,
  };
};

const attachmentReferences = (
  values: readonly { attachmentId: string }[],
) => {
  const references = values.map((value) => mapping(
    () => canonicalUuid(value.attachmentId).toLowerCase(),
    "Attachment reference is invalid",
  ));
  if (new Set(references).size !== references.length) {
    throw new ReplyCompletionMappingError("Attachment references must be unique");
  }
  return references;
};

export type IssueReplyCompletionInput = {
  requestId: string;
  projectId: string;
  workerId: string;
  claim: ReplyWireClaim & { replyKind: "issue" };
  attachmentIds: string[];
  outcome:
    | { case: "failure"; error: string }
    | {
        case: "success";
        completion: ReturnType<typeof decodeIssueAgentReplyResult>;
      };
};

export function completeIssueReplyInputFromProto(
  request: CompleteIssueReplyRequest,
): IssueReplyCompletionInput {
  const claim = replyWireClaim(request.work, "issue") as
    IssueReplyCompletionInput["claim"];
  const normalizedProjectId = projectId(request.projectId);
  const workerId = requiredText(request.workerId, "Worker ID", 128);
  if (request.outcome.case === "failure") {
    const failure = request.outcome.value;
    return {
      requestId: requestId(request.requestId),
      projectId: normalizedProjectId,
      workerId,
      claim,
      attachmentIds: [],
      outcome: {
        case: "failure",
        error: requiredText(failure.error, "Issue reply error", 4_000),
      },
    };
  }
  if (request.outcome.case !== "success") {
    throw new ReplyCompletionMappingError("Issue reply outcome is required");
  }
  const success = request.outcome.value;
  let proposedAction: Record<string, unknown> | null = null;
  let executionProposal: { type: "request_issue_execute" } | null = null;
  let skillExecutionProposal: { type: "request_agent_skill_execute" } | null = null;
  switch (success.action.case) {
    case undefined:
      break;
    case "rework":
      proposedAction = {
        type: "request_issue_rework",
        workflowStage: success.action.value.workflowStage,
        reason: success.action.value.reason,
      };
      break;
    case "update": {
      const update = success.action.value;
      const changes: Record<string, unknown> = {};
      if (update.title !== undefined) changes.title = update.title;
      if (update.description.case === "setDescription") {
        changes.description = update.description.value;
      } else if (update.description.case === "clearDescription") {
        changes.description = null;
      }
      if (update.priority.case === "setPriority") {
        changes.priority = update.priority.value;
      } else if (update.priority.case === "clearPriority") {
        changes.priority = null;
      }
      proposedAction = { type: "request_issue_update", changes };
      break;
    }
    case "create":
      proposedAction = {
        type: "request_issue_create",
        issue: issueDraft(success.action.value.issue),
        executeAfterCreate: success.action.value.executeAfterCreate,
      };
      break;
    case "execution":
      executionProposal = { type: "request_issue_execute" };
      break;
    case "skillExecution":
      skillExecutionProposal = { type: "request_agent_skill_execute" };
      break;
    default:
      throw new ReplyCompletionMappingError("Issue reply action is unknown");
  }
  const completion = mapping(() => decodeIssueAgentReplyResult({
    body: success.body,
    proposedAction,
    executionProposal,
    skillExecutionProposal,
  }), "Issue reply result is invalid");
  return {
    requestId: requestId(request.requestId),
    projectId: normalizedProjectId,
    workerId,
    claim,
    attachmentIds: attachmentReferences(success.attachments),
    outcome: { case: "success", completion },
  };
}

type ChannelReplyCompletion = typeof channelReplyCompletionSchema.Type;

export type ChannelReplyCompletionInput = {
  requestId: string;
  projectId: string;
  workerId: string;
  claim: ReplyWireClaim & { replyKind: "channel"; organizationId: string };
  attachmentIds: string[];
  conversationId: string | null;
  outcome:
    | { case: "failure"; error: string }
    | { case: "success"; completion: ChannelReplyCompletion };
};

export function completeChannelReplyInputFromProto(
  request: CompleteChannelReplyRequest,
): ChannelReplyCompletionInput {
  const claim = replyWireClaim(request.work, "channel") as
    ChannelReplyCompletionInput["claim"];
  const normalizedProjectId = projectId(request.projectId);
  const workerId = requiredText(request.workerId, "Worker ID", 128);
  if (request.outcome.case === "failure") {
    const failure = request.outcome.value;
    return {
      requestId: requestId(request.requestId),
      projectId: normalizedProjectId,
      workerId,
      claim,
      attachmentIds: [],
      conversationId: null,
      outcome: {
        case: "failure",
        error: requiredText(failure.error, "Channel reply error", 4_000),
      },
    };
  }
  if (request.outcome.case !== "success") {
    throw new ReplyCompletionMappingError("Channel reply outcome is required");
  }
  const success = request.outcome.value;
  let document: ChannelReplyCompletion["document"] = null;
  let issueProposal: ChannelReplyCompletion["issueProposal"] = null;
  let issueBatchProposal: ChannelReplyCompletion["issueBatchProposal"] = null;
  let executionProposal: ChannelReplyCompletion["executionProposal"] = null;
  let skillExecutionProposal: ChannelReplyCompletion["skillExecutionProposal"] = null;
  let delegation: ChannelReplyCompletion["delegation"] = null;
  switch (success.action.case) {
    case undefined:
      break;
    case "artifacts": {
      const artifacts = success.action.value;
      document = artifacts.document
        ? {
            title: artifacts.document.title,
            markdown: artifacts.document.markdown,
            projectId: artifacts.document.projectId ?? null,
          }
        : null;
      switch (artifacts.proposal.case) {
        case undefined:
          break;
        case "issue":
          issueProposal = {
            projectId: artifacts.proposal.value.projectId ?? null,
            issue: channelIssueDraft(artifacts.proposal.value.issue),
            executeAfterCreate: artifacts.proposal.value.executeAfterCreate,
          };
          break;
        case "issueBatch":
          issueBatchProposal = {
            projectId: artifacts.proposal.value.projectId ?? null,
            batch: {
              items: artifacts.proposal.value.items.map((item) => ({
                key: item.key,
                issue: channelIssueDraft(item.issue),
              })),
              dependencies: artifacts.proposal.value.dependencies.map(
                (dependency) => ({
                  prerequisiteKey: dependency.prerequisiteKey,
                  dependentKey: dependency.dependentKey,
                }),
              ),
            },
          };
          break;
        case "execution":
          executionProposal = {
            projectId: artifacts.proposal.value.projectId,
            runId: artifacts.proposal.value.runId,
          };
          break;
        default:
          throw new ReplyCompletionMappingError(
            "Channel reply artifact proposal is unknown",
          );
      }
      break;
    }
    case "skillExecution":
      skillExecutionProposal = { type: "request_agent_skill_execute" };
      break;
    case "delegation":
      delegation = {
        projectId: success.action.value.projectId,
        agentId: success.action.value.agentId,
        request: success.action.value.request,
      };
      break;
    default:
      throw new ReplyCompletionMappingError("Channel reply action is unknown");
  }
  const completion = mapping(() => decodeChannelReplyCompletion({
    body: success.body,
    document,
    issueProposal,
    issueBatchProposal,
    executionProposal,
    skillExecutionProposal,
    delegation,
  }), "Channel reply result is invalid");
  return {
    requestId: requestId(request.requestId),
    projectId: normalizedProjectId,
    workerId,
    claim,
    attachmentIds: attachmentReferences(success.attachments),
    conversationId: optionalText(
      success.conversationId,
      "Channel reply conversation ID",
      1_024,
    ),
    outcome: { case: "success", completion },
  };
}
