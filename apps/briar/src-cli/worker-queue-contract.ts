import type { JsonObject } from "@bufbuild/protobuf";
import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { AgentProvider as ProtoAgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import {
  WorkflowCheckpoint_Position,
  type AutoHuntWorkflow as ProtoAutoHuntWorkflow,
} from "@briar/contracts/gen/briar/types/v1/workflow_pb";
import {
  AgentSkillApprovalPolicy,
  AgentSkillExecutionMode,
  AgentSkillKind,
  AutoHuntSource as ProtoAutoHuntSource,
  ChannelReplySessionClaimReason,
  ClaimedHandoffContext_WorkKind,
  MergeBatchMemberState,
  MergeBatchPhase,
  MergeBatchState,
  MergeBatchValidationFailureCode,
  type ChannelActivityCredential as ProtoChannelActivityCredential,
  type ClaimedChannelReply as ProtoClaimedChannelReply,
  type ClaimedHandoffContext as ProtoClaimedHandoffContext,
  type ClaimedIssue as ProtoClaimedIssue,
  type ClaimedIssueReply as ProtoClaimedIssueReply,
  type ClaimedMergeBatch as ProtoClaimedMergeBatch,
  type ClaimedProjectAgentTask as ProtoClaimedProjectAgentTask,
  type ClaimedWork as ProtoClaimedWork,
  type DetachedAgentClaim as ProtoDetachedAgentClaim,
  type DetachedAgentSkill as ProtoDetachedAgentSkill,
  type DetachedAgentSkillExecutionTarget as ProtoDetachedAgentSkillExecutionTarget,
  type QueuedAttachment as ProtoQueuedAttachment,
  type QueuedIssueMessage as ProtoQueuedIssueMessage,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import {
  autoHuntRequirementKinds,
  normalizeAutoHuntWorkflow,
  type AutoHuntSource,
  type AutoHuntWorkflow,
} from "../src/lib/auto-hunt-contract";
import type { AgentProvider } from "../src/lib/agent-provider";
import { MERGE_QUEUE_VALIDATION_CONTEXT } from "../src/lib/merge-queue-validation-contract";

type JsonRecord = Record<string, unknown>;

const required = <T>(value: T | undefined, field: string): T => {
  if (value === undefined) throw new Error(`Worker claim omitted ${field}`);
  return value;
};

const isoTimestamp = (value: Timestamp | undefined, field: string): string => {
  const date = timestampDate(required(value, field));
  if (Number.isNaN(date.getTime())) throw new Error(`Worker claim has invalid ${field}`);
  return date.toISOString();
};

const optionalTimestamp = (value: Timestamp | undefined): string | null =>
  value === undefined ? null : isoTimestamp(value, "timestamp");

const safeNumber = (value: bigint, field: string): number => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`Worker claim ${field} exceeds JavaScript's safe integer range`);
  }
  return number;
};

const agentProvider = (value: ProtoAgentProvider): AgentProvider => {
  switch (value) {
    case ProtoAgentProvider.CODEX:
      return "codex";
    case ProtoAgentProvider.CLAUDE:
      return "claude";
    case ProtoAgentProvider.CURSOR:
      return "cursor";
    case ProtoAgentProvider.GROK:
      return "grok";
    case ProtoAgentProvider.AGY:
      return "agy";
    case ProtoAgentProvider.OPENCODE:
      return "opencode";
    case ProtoAgentProvider.OPENROUTER:
      return "openrouter";
    default:
      throw new Error("Worker claim omitted Agent provider");
  }
};

export const agentProviderToProto = (
  value: AgentProvider,
): ProtoAgentProvider => {
  switch (value) {
    case "codex":
      return ProtoAgentProvider.CODEX;
    case "claude":
      return ProtoAgentProvider.CLAUDE;
    case "cursor":
      return ProtoAgentProvider.CURSOR;
    case "grok":
      return ProtoAgentProvider.GROK;
    case "agy":
      return ProtoAgentProvider.AGY;
    case "opencode":
      return ProtoAgentProvider.OPENCODE;
    case "openrouter":
      return ProtoAgentProvider.OPENROUTER;
  }
};

const optionalAgentProvider = (
  value: ProtoAgentProvider | undefined,
): AgentProvider | null => value === undefined ? null : agentProvider(value);

const checkpointPosition = (
  value: WorkflowCheckpoint_Position,
): "before" | "after" => {
  switch (value) {
    case WorkflowCheckpoint_Position.BEFORE:
      return "before";
    case WorkflowCheckpoint_Position.AFTER:
      return "after";
    default:
      throw new Error("Worker claim has invalid checkpoint position");
  }
};

const workflow = (value: ProtoAutoHuntWorkflow | undefined): AutoHuntWorkflow => {
  const message = required(value, "workflow");
  const execution = required(message.execution, "workflow.execution");
  const completion = required(message.completion, "workflow.completion");
  if (message.version !== 2) {
    throw new Error(`Unsupported Worker workflow version: ${message.version}`);
  }
  return normalizeAutoHuntWorkflow({
    version: 2,
    requirements: message.requirements.map((item) => {
      if (!autoHuntRequirementKinds.includes(
        item.kind as (typeof autoHuntRequirementKinds)[number],
      )) {
        throw new Error(`Unknown Worker workflow requirement: ${item.kind}`);
      }
      return {
        id: item.id,
        label: item.label,
        kind: item.kind as (typeof autoHuntRequirementKinds)[number],
        tool: item.tool,
        reason: item.reason,
      };
    }),
    stages: message.stages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      required: stage.required,
      evidence: stage.evidence.length === 0 ? undefined : stage.evidence,
      checks: stage.checks.length === 0 ? undefined : stage.checks,
    })),
    execution: {
      checkpoints: execution.checkpoints.map((checkpoint) => ({
        key: checkpoint.key,
        stage: checkpoint.stage,
        position: checkpointPosition(checkpoint.position),
      })),
    },
    completion: { requiredStages: completion.requiredStages },
  });
};

const autoHuntSource = (value: ProtoAutoHuntSource): AutoHuntSource => {
  switch (value) {
    case ProtoAutoHuntSource.ISSUE:
      return "issue";
    case ProtoAutoHuntSource.ERROR:
      return "error";
    case ProtoAutoHuntSource.FEEDBACK:
      return "feedback";
    default:
      throw new Error("Worker claim omitted Auto Hunt source");
  }
};

const skillKind = (value: AgentSkillKind): "issue_processing" | "custom" => {
  switch (value) {
    case AgentSkillKind.ISSUE_PROCESSING:
      return "issue_processing";
    case AgentSkillKind.CUSTOM:
      return "custom";
    default:
      throw new Error("Worker claim omitted Agent Skill kind");
  }
};

const executionMode = (
  value: AgentSkillExecutionMode,
): "conversation" | "task" => {
  switch (value) {
    case AgentSkillExecutionMode.CONVERSATION:
      return "conversation";
    case AgentSkillExecutionMode.TASK:
      return "task";
    default:
      throw new Error("Worker claim omitted Agent Skill execution mode");
  }
};

const approvalPolicy = (
  value: AgentSkillApprovalPolicy,
): "invoke_is_consent" | "explicit" => {
  switch (value) {
    case AgentSkillApprovalPolicy.INVOKE_IS_CONSENT:
      return "invoke_is_consent";
    case AgentSkillApprovalPolicy.EXPLICIT:
      return "explicit";
    default:
      throw new Error("Worker claim omitted Agent Skill approval policy");
  }
};

const attachment = (value: ProtoQueuedAttachment) => ({
  id: value.id,
  filename: value.filename,
  contentType: value.contentType,
  byteSize: value.byteSize,
  url: value.url,
});

const issueMessage = (value: ProtoQueuedIssueMessage) => {
  const author = required(value.author, "message.author");
  return {
    id: value.id,
    runId: value.runId,
    parentMessageId: value.parentMessageId ?? null,
    body: value.body,
    attachments: value.attachments.map(attachment),
    author: {
      id: author.id ?? null,
      name: author.name,
      image: author.image ?? null,
      provider: optionalAgentProvider(author.provider),
    },
    replyCount: value.replyCount,
    createdAt: isoTimestamp(value.createdAt, "message.createdAt"),
    updatedAt: isoTimestamp(value.updatedAt, "message.updatedAt"),
  };
};

const agentSkill = (value: ProtoDetachedAgentSkill) => ({
  id: value.id,
  name: value.name,
  description: value.description,
  body: value.body,
  provider: agentProvider(value.provider),
  model: value.model ?? null,
  effort: value.effort ?? null,
  kind: skillKind(value.kind),
  executionMode: executionMode(value.executionMode),
  approvalPolicy: approvalPolicy(value.approvalPolicy),
  position: value.position,
});

const agent = (value: ProtoDetachedAgentClaim) => ({
  id: value.id,
  name: value.name,
  provider: agentProvider(value.provider),
  model: value.model ?? null,
  effort: value.effort ?? null,
  responsibility: value.responsibility,
  skills: value.skills.map(agentSkill),
});

const skillExecutionTarget = (
  value: ProtoDetachedAgentSkillExecutionTarget,
) => ({
  projectId: value.projectId,
  agentId: value.agentId,
  skillId: value.skillId,
  skillName: value.skillName,
  request: value.request,
  executionMode: executionMode(value.executionMode),
  approvalPolicy: approvalPolicy(value.approvalPolicy),
  approved: value.approved,
});

const activity = (
  value: ProtoChannelActivityCredential | undefined,
) => value === undefined
  ? null
  : {
      token: value.token,
      expiresAt: isoTimestamp(value.expiresAt, "activity.expiresAt"),
    };

const handoffWorkType = (
  value: ClaimedHandoffContext_WorkKind,
): "issue" | "issueReply" | "channelReply" | "projectAgentTask" => {
  switch (value) {
    case ClaimedHandoffContext_WorkKind.ISSUE:
      return "issue";
    case ClaimedHandoffContext_WorkKind.ISSUE_REPLY:
      return "issueReply";
    case ClaimedHandoffContext_WorkKind.CHANNEL_REPLY:
      return "channelReply";
    case ClaimedHandoffContext_WorkKind.PROJECT_AGENT_TASK:
      return "projectAgentTask";
    default:
      throw new Error("Worker claim has invalid handoff work kind");
  }
};

const handoffContext = (
  value: ProtoClaimedHandoffContext | undefined,
) => value === undefined
  ? null
  : {
      requestId: value.requestId,
      workType: handoffWorkType(value.workKind),
      workId: value.workId,
      runId: value.runId ?? null,
      conversationId: value.conversationId ?? null,
      workspacePath: value.workspacePath ?? null,
      createdAt: isoTimestamp(value.createdAt, "handoff.createdAt"),
    };

const common = (
  value: {
    workId: string;
    runId: string;
    sourceKey: string;
    title: string;
    claimToken: string;
    claimedAt?: Timestamp;
    leaseExpiresAt?: Timestamp;
    claimAttempts: number;
    handoffContext?: ProtoClaimedHandoffContext;
  },
) => ({
  workId: value.workId,
  runId: value.runId,
  sourceKey: value.sourceKey,
  title: value.title,
  claimToken: value.claimToken,
  claimedAt: isoTimestamp(value.claimedAt, "claimedAt"),
  leaseExpiresAt: isoTimestamp(value.leaseExpiresAt, "leaseExpiresAt"),
  claimAttempts: value.claimAttempts,
  handoffContext: handoffContext(value.handoffContext),
});

const issueFromProto = (value: ProtoClaimedIssue) => {
  const payload = required(value.payload, "issue.payload");
  return {
    ...common({
      workId: payload.runId,
      runId: payload.runId,
      sourceKey: payload.sourceKey,
      title: payload.title,
      claimToken: value.claimToken,
      claimedAt: payload.claimedAt,
      leaseExpiresAt: payload.leaseExpiresAt,
      claimAttempts: payload.claimAttempts,
      handoffContext: value.handoffContext,
    }),
    workType: "issue" as const,
    executionId: payload.executionId,
    runNumber: payload.runNumber,
    currentAttempt: payload.currentAttempt,
    currentRevision: payload.currentRevision,
    source: autoHuntSource(payload.source),
    description: payload.description ?? null,
    priority: payload.priority ?? null,
    repository: payload.repository,
    sourceCreatedAt: optionalTimestamp(payload.sourceCreatedAt),
    createdByUserId: payload.createdByUserId ?? null,
    context: payload.context ?? null,
    reviewFeedback: payload.reviewFeedback ?? null,
    workflow: workflow(payload.workflow),
    workflowStage: payload.workflowStage ?? null,
    startStage: payload.startStage ?? null,
    resumeContext: payload.resumeContext
      ? {
          checkpointKey: payload.resumeContext.checkpointKey,
          position: checkpointPosition(payload.resumeContext.position),
          revision: payload.resumeContext.revision,
          terminalReviewOnly: payload.resumeContext.terminalReviewOnly,
        }
      : null,
    attachments: value.attachments.map(attachment),
    messages: payload.messages.map(issueMessage),
    claimedBy: payload.claimedBy,
    execution: payload.execution
      ? {
          provider: agentProvider(payload.execution.provider),
          model: payload.execution.model ?? null,
          effort: payload.execution.effort ?? null,
        }
      : null,
    agent: value.agent ? agent(value.agent) : null,
    activeSkill: value.activeSkill ? agentSkill(value.activeSkill) : null,
  };
};

const projectAgentTaskFromProto = (
  value: ProtoClaimedProjectAgentTask,
) => ({
  ...common(value),
  workType: "projectAgentTask" as const,
  request: value.request,
  agent: agent(required(value.agent, "projectAgentTask.agent")),
  activeSkill: value.activeSkill ? agentSkill(value.activeSkill) : null,
});

const issueReplyFromProto = (
  value: ProtoClaimedIssueReply,
) => {
  const snapshot = required(value.snapshot, "issueReply.snapshot");
  return {
    ...common({ ...value, claimAttempts: 1 }),
    workType: "issueReply" as const,
    triggerMessageId: value.triggerMessageId,
    parentMessageId: value.parentMessageId,
    provider: agentProvider(value.provider),
    model: value.model ?? null,
    effort: value.effort ?? null,
    agent: value.agent ? agent(value.agent) : null,
    activeSkill: value.activeSkill ? agentSkill(value.activeSkill) : null,
    skillExecutionTarget: value.skillExecutionTarget
      ? skillExecutionTarget(value.skillExecutionTarget)
      : null,
    branch: value.branch ?? null,
    requiresPreferredWorker: value.requiresPreferredWorker,
    activity: activity(value.activity),
    snapshot: {
      run: required(snapshot.run, "issueReply.snapshot.run"),
      messages: snapshot.messages.map(issueMessage),
      agentTranscript: snapshot.agentTranscript,
      evidence: snapshot.evidence,
    },
  };
};

const channelScope = (
  value: ProtoClaimedChannelReply,
) => {
  const scope = required(value.scope, "channelReply.scope").scope;
  switch (scope.case) {
    case "organization":
      return {
        kind: "organization" as const,
        organizationId: scope.value.organizationId,
      };
    case "project":
      return {
        kind: "project" as const,
        organizationId: scope.value.organizationId,
        projectId: scope.value.projectId,
      };
    default:
      throw new Error("Worker channel reply omitted scope variant");
  }
};

const sessionClaimReason = (
  value: ChannelReplySessionClaimReason,
): "session_created" | "worker_reused" | "worker_reused_runtime_changed" |
  "worker_failover_lease_expired" |
  "worker_failover_unavailable_or_incompatible" |
  "ttl_expired_reactivated" => {
  switch (value) {
    case ChannelReplySessionClaimReason.SESSION_CREATED:
      return "session_created";
    case ChannelReplySessionClaimReason.WORKER_REUSED:
      return "worker_reused";
    case ChannelReplySessionClaimReason.WORKER_REUSED_RUNTIME_CHANGED:
      return "worker_reused_runtime_changed";
    case ChannelReplySessionClaimReason.WORKER_FAILOVER_LEASE_EXPIRED:
      return "worker_failover_lease_expired";
    case ChannelReplySessionClaimReason.WORKER_FAILOVER_UNAVAILABLE_OR_INCOMPATIBLE:
      return "worker_failover_unavailable_or_incompatible";
    case ChannelReplySessionClaimReason.TTL_EXPIRED_REACTIVATED:
      return "ttl_expired_reactivated";
    default:
      throw new Error("Worker channel reply omitted session claim reason");
  }
};

const channelReplyFromProto = (
  value: ProtoClaimedChannelReply,
) => {
  const scope = channelScope(value);
  const mapped = {
    ...common({ ...value, claimAttempts: 1 }),
    workType: "channelReply" as const,
    organizationId: scope.organizationId,
    channelId: value.channelId,
    projectId: scope.kind === "project" ? scope.projectId : null,
    scope,
    triggerMessageId: value.triggerMessageId,
    parentMessageId: value.parentMessageId,
    provider: agentProvider(value.provider),
    model: value.model ?? null,
    effort: value.effort ?? null,
    agent: agent(required(value.agent, "channelReply.agent")),
    activeSkill: value.activeSkill ? agentSkill(value.activeSkill) : null,
    skillExecutionTarget: value.skillExecutionTarget
      ? skillExecutionTarget(value.skillExecutionTarget)
      : null,
    activity: activity(value.activity),
    organizationContext: value.organizationContext
      ? {
          schemaVersion: value.organizationContext.schemaVersion as 1,
          snapshotAt: isoTimestamp(
            value.organizationContext.snapshotAt,
            "organizationContext.snapshotAt",
          ),
        }
      : null,
    delegation: value.delegation
      ? {
          delegatedByReplyId: value.delegation.delegatedByReplyId,
          delegatedByAgentId: value.delegation.delegatedByAgentId,
          delegatedByAgentName: value.delegation.delegatedByAgentName,
          request: value.delegation.request,
        }
      : null,
    delegationTargets: value.delegationTargets.map((target) => ({
      agentId: target.agentId,
      agentName: target.agentName,
      projectId: target.projectId,
      projectName: target.projectName,
      responsibility: target.responsibility,
      skills: target.skills.map((skill) => ({ id: skill.id, name: skill.name })),
    })),
    session: value.session
      ? {
          id: value.session.id,
          threadId: value.session.threadId,
          conversationId: value.session.conversationId ?? null,
          retainedUntil: isoTimestamp(
            value.session.retainedUntil,
            "channelReply.session.retainedUntil",
          ),
          claimReason: sessionClaimReason(value.session.claimReason),
        }
      : null,
    snapshot: required(value.snapshot, "channelReply.snapshot"),
  };
  if (scope.kind === "organization") {
    if (!mapped.organizationContext || mapped.delegation || mapped.skillExecutionTarget) {
      throw new Error("Worker organization reply has inconsistent scope data");
    }
  } else if (mapped.organizationContext || mapped.delegationTargets.length > 0) {
    throw new Error("Worker project reply has inconsistent scope data");
  }
  if (
    mapped.skillExecutionTarget &&
    (mapped.skillExecutionTarget.projectId !== mapped.projectId ||
      mapped.skillExecutionTarget.agentId !== mapped.agent?.id ||
      mapped.skillExecutionTarget.skillId !== mapped.activeSkill?.id)
  ) {
    throw new Error("Worker reply Skill target does not match its Agent");
  }
  return mapped;
};

const mergeBatchPhase = (
  value: MergeBatchPhase,
): "enqueue" | "tail_authority" | "validate" | "publish" | "drain" => {
  switch (value) {
    case MergeBatchPhase.ENQUEUE:
      return "enqueue";
    case MergeBatchPhase.TAIL_AUTHORITY:
      return "tail_authority";
    case MergeBatchPhase.VALIDATE:
      return "validate";
    case MergeBatchPhase.PUBLISH:
      return "publish";
    case MergeBatchPhase.DRAIN:
      return "drain";
    default:
      throw new Error("Worker merge batch omitted phase");
  }
};

const mergeBatchState = (
  value: MergeBatchState,
): "frozen" | "enqueueing" | "waiting_tail" | "validating" |
  "publishing" | "draining" => {
  switch (value) {
    case MergeBatchState.FROZEN:
      return "frozen";
    case MergeBatchState.ENQUEUEING:
      return "enqueueing";
    case MergeBatchState.WAITING_TAIL:
      return "waiting_tail";
    case MergeBatchState.VALIDATING:
      return "validating";
    case MergeBatchState.PUBLISHING:
      return "publishing";
    case MergeBatchState.DRAINING:
      return "draining";
    default:
      throw new Error("Worker merge batch omitted state");
  }
};

const mergeMemberState = (
  value: MergeBatchMemberState,
): "ready" | "frozen" | "enqueued" | "merged" | "dequeued" | "failed" => {
  switch (value) {
    case MergeBatchMemberState.READY:
      return "ready";
    case MergeBatchMemberState.FROZEN:
      return "frozen";
    case MergeBatchMemberState.ENQUEUED:
      return "enqueued";
    case MergeBatchMemberState.MERGED:
      return "merged";
    case MergeBatchMemberState.DEQUEUED:
      return "dequeued";
    case MergeBatchMemberState.FAILED:
      return "failed";
    default:
      throw new Error("Worker merge batch member omitted state");
  }
};

const mergeFailureCode = (
  value: MergeBatchValidationFailureCode | undefined,
): "ci_failed" | "output_limit" | null => {
  switch (value) {
    case undefined:
      return null;
    case MergeBatchValidationFailureCode.CI_FAILED:
      return "ci_failed";
    case MergeBatchValidationFailureCode.OUTPUT_LIMIT:
      return "output_limit";
    default:
      throw new Error("Worker merge batch has invalid failure code");
  }
};

const mergeBatchDomain = (
  value: ProtoClaimedMergeBatch,
) => {
  const batch = required(value.batch, "mergeBatch.batch");
  return {
    ...common({ ...value, handoffContext: undefined }),
    handoffContext: null,
    workType: "mergeBatch" as const,
    projectId: value.projectId,
    repositoryId: safeNumber(value.repositoryId, "repositoryId"),
    repository: value.repository,
    baseBranch: value.baseBranch === "main"
      ? "main"
      : (() => {
          throw new Error(`Unsupported merge base branch: ${value.baseBranch}`);
        })(),
    validationCommands: value.validationCommands,
    phase: mergeBatchPhase(value.phase),
    batch: {
      id: batch.id,
      state: mergeBatchState(batch.state),
      finalDeliveryId: batch.finalDeliveryId ?? null,
      mergeGroupRef: batch.mergeGroupRef ?? null,
      mergeGroupSha: batch.mergeGroupSha ?? null,
      mergeGroupBaseSha: batch.mergeGroupBaseSha ?? null,
      validationResults: batch.validationResults
        ? batch.validationResults.results.map((result) => ({
            context: result.context,
            passed: result.passed,
            exitCode: result.exitCode,
            failureCode: mergeFailureCode(result.failureCode),
            log: result.log,
            logSha256: result.logSha256,
            logTruncated: result.logTruncated,
          }))
        : null,
      validatedAt: optionalTimestamp(batch.validatedAt),
      publishedAt: optionalTimestamp(batch.publishedAt),
      failureCode: batch.failureCode ?? null,
      failureDetail: batch.failureDetail ?? null,
    },
    members: value.members.map((member) => ({
      id: member.id,
      ordinal: member.ordinal,
      runId: member.runId,
      attempt: member.attempt,
      revision: member.revision,
      pullRequestId: safeNumber(member.pullRequestId, "pullRequestId"),
      pullRequestNodeId: member.pullRequestNodeId,
      pullRequestNumber: member.pullRequestNumber,
      pullRequestUrl: member.pullRequestUrl,
      headSha: member.headSha,
      baseSha: member.baseSha,
      queueEntryId: member.queueEntryId ?? null,
      state: mergeMemberState(member.state),
    })),
    pendingHeads: value.pendingHeads.map((head) => ({
      deliveryId: head.deliveryId,
      headRef: head.headRef,
      headSha: head.headSha,
      baseSha: head.baseSha,
      tailPullRequestNumber: head.tailPullRequestNumber,
      receivedAt: isoTimestamp(head.receivedAt, "pendingHead.receivedAt"),
    })),
  };
};

export type QueuedAttachment = ReturnType<typeof attachment>;
export type QueuedIssueMessage = ReturnType<typeof issueMessage>;
export type DetachedAgentSkill = ReturnType<typeof agentSkill>;
export type DetachedAgentClaim = ReturnType<typeof agent>;
export type DetachedAgentSkillExecutionTarget = ReturnType<
  typeof skillExecutionTarget
>;
export type ChannelActivityCredential = NonNullable<ReturnType<typeof activity>>;
export type ClaimedRun = ReturnType<typeof issueFromProto>;
export type ClaimedProjectAgentTask = ReturnType<
  typeof projectAgentTaskFromProto
>;
export type ClaimedIssueReply = ReturnType<typeof issueReplyFromProto>;
export type ClaimedChannelReply = ReturnType<typeof channelReplyFromProto>;
export type ClaimedMergeBatch = ReturnType<typeof mergeBatchDomain>;
export type ClaimedWork =
  | ClaimedRun
  | ClaimedIssueReply
  | ClaimedChannelReply
  | ClaimedProjectAgentTask
  | ClaimedMergeBatch;

const assertMergeBatch = (claim: ClaimedMergeBatch): ClaimedMergeBatch => {
  const expectedState = {
    enqueue: "enqueueing",
    tail_authority: "waiting_tail",
    validate: "validating",
    publish: "publishing",
    drain: "draining",
  } as const;
  if (
    claim.workId !== claim.runId || claim.workId !== claim.batch.id ||
    claim.batch.state !== expectedState[claim.phase]
  ) {
    throw new Error("Worker merge batch identity or phase is inconsistent");
  }
  if (
    ["validate", "publish", "drain"].includes(claim.phase) &&
    (!claim.batch.finalDeliveryId || !claim.batch.mergeGroupRef ||
      !claim.batch.mergeGroupSha || !claim.batch.mergeGroupBaseSha)
  ) {
    throw new Error("Worker merge batch omitted integration authority");
  }
  if (
    ["publish", "drain"].includes(claim.phase) &&
    claim.batch.validationResults === null
  ) {
    throw new Error("Worker merge batch omitted validation proof");
  }
  const memberIds = new Set<string>();
  const pullRequests = new Set<number>();
  claim.members.forEach((member, index) => {
    if (
      member.ordinal !== index + 1 || memberIds.has(member.id) ||
      pullRequests.has(member.pullRequestNumber)
    ) {
      throw new Error("Worker merge batch members are inconsistent");
    }
    memberIds.add(member.id);
    pullRequests.add(member.pullRequestNumber);
  });
  if (
    claim.batch.validationResults !== null &&
    (claim.batch.validationResults.length !== 1 ||
      claim.batch.validationResults[0]?.context !== MERGE_QUEUE_VALIDATION_CONTEXT)
  ) {
    throw new Error("Worker merge batch validation proof is incomplete");
  }
  return claim;
};

const mergeBatchFromProto = (value: ProtoClaimedMergeBatch) =>
  assertMergeBatch(mergeBatchDomain(value));

/** Decode the generated oneof into the CLI's execution-domain representation. */
export function claimedWorkFromProto(value: ProtoClaimedWork): ClaimedWork {
  switch (value.work.case) {
    case "issue":
      return issueFromProto(value.work.value);
    case "issueReply":
      return issueReplyFromProto(value.work.value);
    case "channelReply":
      return channelReplyFromProto(value.work.value);
    case "projectAgentTask":
      return projectAgentTaskFromProto(value.work.value);
    case "mergeBatch":
      return mergeBatchFromProto(value.work.value);
    default:
      throw new Error("Worker claim omitted work variant");
  }
}

export type WorkerLeaseRenewal = {
  leaseExpiresAt: string;
  retainedUntil: string | null;
  activity: ChannelActivityCredential | null;
};

export const jsonRecord = (value: JsonObject): JsonRecord => value;
