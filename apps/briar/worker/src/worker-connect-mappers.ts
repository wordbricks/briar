import {
  create,
  type JsonObject,
  type JsonValue,
} from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  DmMemoryBriefState,
  DmMemoryDescriptorSchema,
} from "@briar/contracts/gen/briar/app/v1/dm_memory_pb";
import {
  AgentSkillApprovalPolicy,
  AgentSkillExecutionMode,
  AgentSkillKind,
  AutoHuntSource,
  ChannelReplySessionClaimReason,
  ClaimedHandoffContext_WorkKind,
  ClaimedHandoffContextSchema,
  ClaimedChannelReplySchema,
  ClaimedChannelDelegationSchema,
  ClaimedIssueReplySchema,
  ClaimedIssueReply_SnapshotSchema,
  ClaimedIssuePayloadSchema,
  ClaimedIssueSchema,
  ClaimedDmMemoryLearningSchema,
  ClaimedMergeBatchSchema,
  ClaimedProjectAgentTaskSchema,
  ClaimedWorkSchema,
  ChannelActivityCredentialSchema,
  ChannelDelegationTargetSchema,
  ChannelDelegationTarget_SkillSchema,
  ChannelReplyScopeSchema,
  ChannelReplyScope_OrganizationSchema,
  ChannelReplyScope_ProjectSchema,
  ChannelReplySessionSchema,
  DetachedAgentClaimSchema,
  DetachedAgentSkillExecutionTargetSchema,
  DetachedAgentSkillSchema,
  DetachedExecutionSchema,
  MergeBatchMemberSchema,
  MergeBatchSchema,
  MergeBatchValidationResultSchema,
  MergeBatchValidationResultsSchema,
  PendingMergeGroupHeadSchema,
  QueuedAttachmentSchema,
  QueuedIssueMessageSchema,
  QueuedIssueMessage_AuthorSchema,
  ResumeContextSchema,
  MergeBatchMemberState,
  MergeBatchPhase,
  MergeBatchState,
  MergeBatchValidationFailureCode,
  type ClaimedIssue,
  type ClaimedWork,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { ComputerUsePolicy } from "@briar/contracts/gen/briar/types/v1/computer_use_pb";
import {
  AutoHuntWorkflowSchema,
  WorkflowCheckpoint_Position,
  WorkflowCheckpointSpecSchema,
  WorkflowCompletionSchema,
  WorkflowExecutionSchema,
  WorkflowRequirementSchema,
  WorkflowStageSchema,
} from "@briar/contracts/gen/briar/types/v1/workflow_pb";
import type { claimNextChannelReplyWork } from "./channel-reply-claim-routes";
import type { claimNextIssueReplyWork } from "./issue-reply-worker-routes";
import type { claimNextMergeBatchWork } from "./merge-batch-worker";
import type { claimNextTeamAgentTaskWork } from "./team-agent-task-worker";
import type { claimNextQueueWork } from "./queue-claim-routes";
import type { claimDmLearningJob } from "./dm-memory-learning-claims";
import { dmMemoryCanonicalJson } from "../../src/lib/dm-memory-canonical-json";

type AwaitedClaim<Fn extends (...args: never[]) => unknown> = NonNullable<
  Awaited<ReturnType<Fn>>
>;

export type WorkerQueueClaim =
  | AwaitedClaim<typeof claimNextQueueWork>
  | AwaitedClaim<typeof claimNextIssueReplyWork>
  | AwaitedClaim<typeof claimNextChannelReplyWork>
  | AwaitedClaim<typeof claimNextTeamAgentTaskWork>
  | AwaitedClaim<typeof claimNextMergeBatchWork>
  | AwaitedClaim<typeof claimDmLearningJob>;

const requiredTimestamp = (value: string | null, field: string) => {
  if (value === null) throw new Error(`Worker claim omitted ${field}`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Worker claim has invalid ${field}`);
  }
  return timestampFromDate(date);
};

const jsonValue = (value: unknown, field: string): JsonValue => {
  if (
    value === null || typeof value === "string" ||
    typeof value === "boolean"
  ) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => jsonValue(item, `${field}[${index}]`));
  }
  if (typeof value === "object" && value !== null) {
    const output: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) output[key] = jsonValue(item, `${field}.${key}`);
    }
    return output;
  }
  throw new Error(`Worker claim has non-JSON ${field}`);
};

const jsonObject = (value: unknown, field: string): JsonObject => {
  const mapped = jsonValue(value, field);
  if (mapped === null || Array.isArray(mapped) || typeof mapped !== "object") {
    throw new Error(`Worker claim expected an object for ${field}`);
  }
  return mapped;
};

const optionalTimestamp = (value: string | null | undefined) => value == null
  ? undefined
  : requiredTimestamp(value, "timestamp");

const requiredString = (value: string | null, field: string) => {
  if (value === null || value.length === 0) {
    throw new Error(`Worker claim omitted ${field}`);
  }
  return value;
};

const requiredNumber = (value: number | null, field: string) => {
  if (value === null) throw new Error(`Worker claim omitted ${field}`);
  return value;
};

const provider = (value: string): AgentProvider => {
  switch (value) {
    case "codex": return AgentProvider.CODEX;
    case "claude": return AgentProvider.CLAUDE;
    case "cursor": return AgentProvider.CURSOR;
    case "grok": return AgentProvider.GROK;
    case "agy": return AgentProvider.AGY;
    case "opencode": return AgentProvider.OPENCODE;
    case "openrouter": return AgentProvider.OPENROUTER;
    case "vertex": return AgentProvider.VERTEX;
    case "pi": return AgentProvider.PI;
    default: throw new Error(`Worker claim has unknown Agent provider: ${value}`);
  }
};

const source = (value: string): AutoHuntSource => {
  switch (value) {
    case "issue": return AutoHuntSource.ISSUE;
    case "error": return AutoHuntSource.ERROR;
    case "feedback": return AutoHuntSource.FEEDBACK;
    default: throw new Error(`Worker claim has unknown issue source: ${value}`);
  }
};

const skillKind = (value: string): AgentSkillKind => {
  switch (value) {
    case "issue_processing": return AgentSkillKind.ISSUE_PROCESSING;
    case "custom": return AgentSkillKind.CUSTOM;
    default: throw new Error(`Worker claim has unknown Agent Skill kind: ${value}`);
  }
};

const executionMode = (value: string): AgentSkillExecutionMode => {
  switch (value) {
    case "conversation": return AgentSkillExecutionMode.CONVERSATION;
    case "task": return AgentSkillExecutionMode.TASK;
    default: throw new Error(`Worker claim has unknown Skill execution mode: ${value}`);
  }
};

const approvalPolicy = (value: string): AgentSkillApprovalPolicy => {
  switch (value) {
    case "invoke_is_consent": return AgentSkillApprovalPolicy.INVOKE_IS_CONSENT;
    case "explicit": return AgentSkillApprovalPolicy.EXPLICIT;
    default: throw new Error(`Worker claim has unknown Skill approval policy: ${value}`);
  }
};

const checkpointPosition = (value: string): WorkflowCheckpoint_Position => {
  switch (value) {
    case "before": return WorkflowCheckpoint_Position.BEFORE;
    case "after": return WorkflowCheckpoint_Position.AFTER;
    default: throw new Error(`Worker claim has unknown checkpoint position: ${value}`);
  }
};

const handoffKind = (value: string): ClaimedHandoffContext_WorkKind => {
  switch (value) {
    case "issue": return ClaimedHandoffContext_WorkKind.ISSUE;
    case "issueReply": return ClaimedHandoffContext_WorkKind.ISSUE_REPLY;
    case "channelReply": return ClaimedHandoffContext_WorkKind.CHANNEL_REPLY;
    case "projectAgentTask": return ClaimedHandoffContext_WorkKind.PROJECT_AGENT_TASK;
    default: throw new Error(`Worker claim has unknown handoff kind: ${value}`);
  }
};

const handoff = (value: {
  requestId: string;
  workType: string;
  workId: string;
  runId: string | null;
  conversationId: string | null;
  workspacePath: string | null;
  createdAt: string;
} | null | undefined) => value == null
  ? undefined
  : create(ClaimedHandoffContextSchema, {
      requestId: value.requestId,
      workKind: handoffKind(value.workType),
      workId: value.workId,
      runId: value.runId ?? undefined,
      conversationId: value.conversationId ?? undefined,
      workspacePath: value.workspacePath ?? undefined,
      createdAt: requiredTimestamp(value.createdAt, "handoff.createdAt"),
    });

type AppSkill = {
  id: string;
  name: string;
  description: string;
  body: string;
  provider: string;
  model: string | null;
  effort: string | null;
  kind: string;
  executionMode: string;
  approvalPolicy: string;
  position: number;
};

const skill = (value: AppSkill) => create(DetachedAgentSkillSchema, {
  id: value.id,
  name: value.name,
  description: value.description,
  body: value.body,
  provider: provider(value.provider),
  model: value.model ?? undefined,
  effort: value.effort ?? undefined,
  kind: skillKind(value.kind),
  executionMode: executionMode(value.executionMode),
  approvalPolicy: approvalPolicy(value.approvalPolicy),
  position: value.position,
});

type AppAgent = {
  id: string;
  name: string;
  provider: string;
  model: string | null;
  effort: string | null;
  computerUsePolicy?: "disabled" | "unattended";
  responsibility: string;
  skills: AppSkill[];
};

const agent = (value: AppAgent) => create(DetachedAgentClaimSchema, {
  id: value.id,
  name: value.name,
  provider: provider(value.provider),
  model: value.model ?? undefined,
  effort: value.effort ?? undefined,
  computerUsePolicy: value.computerUsePolicy === "unattended"
    ? ComputerUsePolicy.UNATTENDED
    : ComputerUsePolicy.DISABLED,
  responsibility: value.responsibility,
  skills: value.skills.map(skill),
});

const skillTarget = (value: {
  projectId: string;
  agentId: string;
  skillId: string;
  skillName: string;
  request: string;
  executionMode: string;
  approvalPolicy: string;
  approved: boolean;
}) => create(DetachedAgentSkillExecutionTargetSchema, {
  projectId: value.projectId,
  agentId: value.agentId,
  skillId: value.skillId,
  skillName: value.skillName,
  request: value.request,
  executionMode: executionMode(value.executionMode),
  approvalPolicy: approvalPolicy(value.approvalPolicy),
  approved: value.approved,
});

const attachment = (value: {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  url: string;
}) => create(QueuedAttachmentSchema, {
  id: value.id,
  filename: value.filename,
  contentType: value.contentType,
  byteSize: value.byteSize,
  url: value.url,
});

const issueMessage = (value: {
  id: string;
  runId: string;
  parentMessageId: string | null;
  body: string;
  attachments: Array<Parameters<typeof attachment>[0]>;
  author: {
    id: string | null;
    name: string;
    image: string | null;
    provider: string | null;
  };
  replyCount: number;
  createdAt: string;
  updatedAt: string;
}) => create(QueuedIssueMessageSchema, {
  id: value.id,
  runId: value.runId,
  parentMessageId: value.parentMessageId ?? undefined,
  body: value.body,
  attachments: value.attachments.map(attachment),
  author: create(QueuedIssueMessage_AuthorSchema, {
    id: value.author.id ?? undefined,
    name: value.author.name,
    image: value.author.image ?? undefined,
    provider: value.author.provider ? provider(value.author.provider) : undefined,
  }),
  replyCount: value.replyCount,
  createdAt: requiredTimestamp(value.createdAt, "message.createdAt"),
  updatedAt: requiredTimestamp(value.updatedAt, "message.updatedAt"),
});

const activity = (value: { token: string; expiresAt: string } | null) =>
  value === null
    ? undefined
    : create(ChannelActivityCredentialSchema, {
        token: value.token,
        expiresAt: requiredTimestamp(value.expiresAt, "activity.expiresAt"),
      });

export const workerIssueClaimMessage = (
  value: AwaitedClaim<typeof claimNextQueueWork>,
): ClaimedIssue => create(ClaimedIssueSchema, {
      payload: create(ClaimedIssuePayloadSchema, {
        executionId: requiredString(value.executionId, "issue.executionId"),
        runId: value.runId,
        runNumber: value.runNumber,
        currentAttempt: value.currentAttempt,
        currentRevision: value.currentRevision,
        source: source(value.source),
        sourceKey: value.sourceKey,
        title: value.title,
        description: value.description ?? undefined,
        priority: value.priority ?? undefined,
        repository: value.repository,
        sourceCreatedAt: optionalTimestamp(value.sourceCreatedAt),
        createdByUserId: value.createdByUserId ?? undefined,
        context: value.context == null
          ? undefined
          : jsonObject(value.context, "issue.context"),
        reviewFeedback: value.reviewFeedback ?? undefined,
        workflow: create(AutoHuntWorkflowSchema, {
          version: value.workflow.version,
          requirements: value.workflow.requirements?.map((item) =>
            create(WorkflowRequirementSchema, {
            id: item.id,
            label: item.label,
            kind: item.kind,
            tool: item.tool,
            reason: item.reason,
            })) ?? [],
          stages: value.workflow.stages.map((stage) =>
            create(WorkflowStageSchema, {
            id: stage.id,
            label: stage.label,
            required: stage.required,
            evidence: stage.evidence ?? [],
            checks: stage.checks ?? [],
            })),
          execution: create(WorkflowExecutionSchema, {
            checkpoints: value.workflow.execution.checkpoints.map((checkpoint) =>
              create(WorkflowCheckpointSpecSchema, {
                key: checkpoint.key,
                stage: checkpoint.stage,
                position: checkpointPosition(checkpoint.position),
              })
            ),
          }),
          completion: create(WorkflowCompletionSchema, {
            requiredStages: value.workflow.completion.requiredStages,
          }),
        }),
        resumeContext: value.resumeContext
          ? create(ResumeContextSchema, {
              checkpointKey: value.resumeContext.checkpointKey,
              position: checkpointPosition(value.resumeContext.position),
              revision: value.resumeContext.revision,
              terminalReviewOnly: value.resumeContext.terminalReviewOnly,
            })
          : undefined,
        workflowStage: value.workflowStage ?? undefined,
        startStage: value.startStage ?? undefined,
        messages: value.messages.map(issueMessage),
        claimedBy: requiredString(value.claimedBy, "claimedBy"),
        claimedAt: requiredTimestamp(value.claimedAt, "claimedAt"),
        leaseExpiresAt: requiredTimestamp(value.leaseExpiresAt, "leaseExpiresAt"),
        claimAttempts: value.claimAttempts,
        execution: value.execution?.provider
          ? create(DetachedExecutionSchema, {
              provider: provider(value.execution.provider),
              model: value.execution.model ?? undefined,
              effort: value.execution.effort ?? undefined,
            })
          : undefined,
      }),
      attachments: value.attachments.map(attachment),
      claimToken: requiredString(value.claimToken, "claimToken"),
      handoffContext: handoff(value.handoffContext),
      agent: value.agent ? agent(value.agent) : undefined,
      activeSkill: value.activeSkill ? skill(value.activeSkill) : undefined,
});

const issue = (
  value: AwaitedClaim<typeof claimNextQueueWork>,
): ClaimedWork => create(ClaimedWorkSchema, {
  work: {
    case: "issue",
    value: workerIssueClaimMessage(value),
  },
});

const projectAgentTask = (
  value: AwaitedClaim<typeof claimNextTeamAgentTaskWork>,
): ClaimedWork => create(ClaimedWorkSchema, {
  work: {
    case: "projectAgentTask",
    value: create(ClaimedProjectAgentTaskSchema, {
      workId: value.workId,
      runId: value.runId,
      sourceKey: value.sourceKey,
      title: value.title,
      claimToken: value.claimToken,
      claimAttempts: value.claimAttempts,
      resumeCount: value.resumeCount,
      claimedAt: requiredTimestamp(value.claimedAt, "claimedAt"),
      leaseExpiresAt: requiredTimestamp(value.leaseExpiresAt, "leaseExpiresAt"),
      request: value.request,
      agent: agent(value.agent),
      activeSkill: value.activeSkill ? skill(value.activeSkill) : undefined,
      handoffContext: handoff(value.handoffContext),
    }),
  },
});

const issueReply = (
  value: AwaitedClaim<typeof claimNextIssueReplyWork>,
): ClaimedWork => create(ClaimedWorkSchema, {
  work: {
    case: "issueReply",
    value: create(ClaimedIssueReplySchema, {
      workId: value.workId,
      runId: value.runId,
      sourceKey: value.sourceKey,
      title: value.title,
      triggerMessageId: value.triggerMessageId,
      parentMessageId: value.parentMessageId,
      provider: provider(value.provider),
      model: value.model ?? undefined,
      effort: value.effort ?? undefined,
      agent: value.agent ? agent(value.agent) : undefined,
      activeSkill: value.activeSkill ? skill(value.activeSkill) : undefined,
      skillExecutionTarget: value.skillExecutionTarget
        ? skillTarget(value.skillExecutionTarget)
        : undefined,
      branch: value.branch ?? undefined,
      requiresPreferredWorker: value.requiresPreferredWorker,
      claimToken: value.claimToken,
      claimedAt: requiredTimestamp(value.claimedAt, "claimedAt"),
      leaseExpiresAt: requiredTimestamp(value.leaseExpiresAt, "leaseExpiresAt"),
      activity: activity(value.activity),
      handoffContext: handoff(value.handoffContext),
      snapshot: create(ClaimedIssueReply_SnapshotSchema, {
        run: jsonObject(value.snapshot.run, "issueReply.snapshot.run"),
        messages: value.snapshot.messages.map(issueMessage),
        agentTranscript: value.snapshot.agentTranscript.map((item, index) =>
          jsonObject(item, `issueReply.snapshot.agentTranscript[${index}]`)
        ),
        evidence: value.snapshot.evidence.map((item, index) =>
          jsonObject(item, `issueReply.snapshot.evidence[${index}]`)
        ),
      }),
    }),
  },
});

const sessionReason = (value: string): ChannelReplySessionClaimReason => {
  switch (value) {
    case "session_created": return ChannelReplySessionClaimReason.SESSION_CREATED;
    case "worker_reused": return ChannelReplySessionClaimReason.WORKER_REUSED;
    case "worker_reused_runtime_changed":
      return ChannelReplySessionClaimReason.WORKER_REUSED_RUNTIME_CHANGED;
    case "worker_failover_lease_expired":
      return ChannelReplySessionClaimReason.WORKER_FAILOVER_LEASE_EXPIRED;
    case "worker_failover_unavailable_or_incompatible":
      return ChannelReplySessionClaimReason.WORKER_FAILOVER_UNAVAILABLE_OR_INCOMPATIBLE;
    case "ttl_expired_reactivated":
      return ChannelReplySessionClaimReason.TTL_EXPIRED_REACTIVATED;
    default: throw new Error(`Worker claim has unknown session reason: ${value}`);
  }
};

const channelReply = (
  value: AwaitedClaim<typeof claimNextChannelReplyWork>,
): ClaimedWork => create(ClaimedWorkSchema, {
  work: {
    case: "channelReply",
    value: create(ClaimedChannelReplySchema, {
      workId: value.workId,
      channelId: value.channelId,
      scope: create(ChannelReplyScopeSchema, {
        scope: value.scope.kind === "organization"
          ? {
              case: "organization",
              value: create(ChannelReplyScope_OrganizationSchema, {
                organizationId: value.scope.organizationId,
              }),
            }
          : {
              case: "project",
              value: create(ChannelReplyScope_ProjectSchema, {
                organizationId: value.scope.organizationId,
                projectId: value.scope.projectId,
              }),
            },
      }),
      runId: value.runId,
      sourceKey: value.sourceKey,
      title: value.title,
      triggerMessageId: value.triggerMessageId,
      parentMessageId: value.parentMessageId,
      provider: provider(value.provider),
      model: value.model ?? undefined,
      effort: value.effort ?? undefined,
      agent: agent(value.agent),
      activeSkill: value.activeSkill ? skill(value.activeSkill) : undefined,
      skillExecutionTarget: value.skillExecutionTarget
        ? skillTarget(value.skillExecutionTarget)
        : undefined,
      claimToken: value.claimToken,
      claimedAt: requiredTimestamp(value.claimedAt, "claimedAt"),
      leaseExpiresAt: requiredTimestamp(value.leaseExpiresAt, "leaseExpiresAt"),
      activity: activity(value.activity),
      organizationContextSnapshotAt: value.organizationContext
        ? requiredTimestamp(
            value.organizationContext.snapshotAt,
            "organizationContext.snapshotAt",
          )
        : undefined,
      delegation: value.delegation
        ? create(ClaimedChannelDelegationSchema, value.delegation)
        : undefined,
      delegationTargets: value.delegationTargets.map((target) =>
        create(ChannelDelegationTargetSchema, {
        agentId: target.agentId,
        agentName: target.agentName,
        projectId: target.projectId,
        projectName: target.projectName,
        responsibility: target.responsibility,
        skills: target.skills.map((item) =>
          create(ChannelDelegationTarget_SkillSchema, {
            id: item.id,
            name: item.name,
          })
        ),
      })),
      session: value.session
        ? create(ChannelReplySessionSchema, {
            id: value.session.id,
            threadId: value.session.threadId,
            conversationId: value.session.conversationId ?? undefined,
            retainedUntil: requiredTimestamp(
              value.session.retainedUntil,
              "session.retainedUntil",
            ),
            claimReason: sessionReason(value.session.claimReason),
          })
        : undefined,
      handoffContext: handoff(value.handoffContext),
      snapshot: jsonObject(value.snapshot, "channelReply.snapshot"),
      triggerAttachments: value.triggerAttachments.map(attachment),
      memory: value.memory
        ? create(DmMemoryDescriptorSchema, {
            protocol: value.memory.protocol,
            memorySpaceId: value.memory.memorySpaceId,
            memoryRevision: BigInt(value.memory.memoryRevision),
            revocationEpoch: BigInt(value.memory.revocationEpoch),
            searchEnabled: value.memory.searchEnabled,
            briefState: value.memory.briefState === "available"
              ? DmMemoryBriefState.AVAILABLE
              : DmMemoryBriefState.DISABLED,
          })
        : undefined,
      memoryLearningEnabled: value.memoryLearningEnabled,
    }),
  },
});

const mergePhase = (value: string): MergeBatchPhase => {
  switch (value) {
    case "enqueue": return MergeBatchPhase.ENQUEUE;
    case "tail_authority": return MergeBatchPhase.TAIL_AUTHORITY;
    case "validate": return MergeBatchPhase.VALIDATE;
    case "publish": return MergeBatchPhase.PUBLISH;
    case "drain": return MergeBatchPhase.DRAIN;
    default: throw new Error(`Worker claim has unknown merge phase: ${value}`);
  }
};

const mergeState = (value: string): MergeBatchState => {
  switch (value) {
    case "frozen": return MergeBatchState.FROZEN;
    case "enqueueing": return MergeBatchState.ENQUEUEING;
    case "waiting_tail": return MergeBatchState.WAITING_TAIL;
    case "validating": return MergeBatchState.VALIDATING;
    case "publishing": return MergeBatchState.PUBLISHING;
    case "draining": return MergeBatchState.DRAINING;
    default: throw new Error(`Worker claim has unknown merge state: ${value}`);
  }
};

const memberState = (value: string): MergeBatchMemberState => {
  switch (value) {
    case "ready": return MergeBatchMemberState.READY;
    case "frozen": return MergeBatchMemberState.FROZEN;
    case "enqueued": return MergeBatchMemberState.ENQUEUED;
    case "merged": return MergeBatchMemberState.MERGED;
    case "dequeued": return MergeBatchMemberState.DEQUEUED;
    case "failed": return MergeBatchMemberState.FAILED;
    default: throw new Error(`Worker claim has unknown merge member state: ${value}`);
  }
};

const validationFailure = (value: string | null) => {
  switch (value) {
    case null: return undefined;
    case "ci_failed": return MergeBatchValidationFailureCode.CI_FAILED;
    case "output_limit": return MergeBatchValidationFailureCode.OUTPUT_LIMIT;
    default: throw new Error(`Worker claim has unknown validation failure: ${value}`);
  }
};

const mergeBatch = (
  value: AwaitedClaim<typeof claimNextMergeBatchWork>,
): ClaimedWork => create(ClaimedWorkSchema, {
  work: {
    case: "mergeBatch",
    value: create(ClaimedMergeBatchSchema, {
      workId: value.workId,
      runId: value.runId,
      sourceKey: value.sourceKey,
      title: value.title,
      projectId: value.projectId,
      repositoryId: BigInt(value.repositoryId),
      repository: value.repository,
      baseBranch: value.baseBranch,
      validationCommands: value.validationCommands,
      phase: mergePhase(value.phase),
      claimToken: value.claimToken,
      claimedAt: requiredTimestamp(value.claimedAt, "claimedAt"),
      leaseExpiresAt: requiredTimestamp(value.leaseExpiresAt, "leaseExpiresAt"),
      claimAttempts: value.claimAttempts,
      batch: create(MergeBatchSchema, {
        id: value.batch.id,
        state: mergeState(value.batch.state),
        finalDeliveryId: value.batch.finalDeliveryId ?? undefined,
        mergeGroupRef: value.batch.mergeGroupRef ?? undefined,
        mergeGroupSha: value.batch.mergeGroupSha ?? undefined,
        mergeGroupBaseSha: value.batch.mergeGroupBaseSha ?? undefined,
        validationResults: value.batch.validationResults
          ? create(MergeBatchValidationResultsSchema, {
              results: value.batch.validationResults.map((result) =>
                create(MergeBatchValidationResultSchema, {
                context: result.context,
                passed: result.passed,
                exitCode: result.exitCode,
                failureCode: validationFailure(result.failureCode),
                log: result.log,
                logSha256: result.logSha256,
                logTruncated: result.logTruncated,
                })
              ),
            })
          : undefined,
        validatedAt: optionalTimestamp(value.batch.validatedAt),
        publishedAt: optionalTimestamp(value.batch.publishedAt),
        failureCode: value.batch.failureCode ?? undefined,
        failureDetail: value.batch.failureDetail ?? undefined,
      }),
      members: value.members.map((member) =>
        create(MergeBatchMemberSchema, {
        id: member.id,
        ordinal: requiredNumber(member.ordinal, "merge member ordinal"),
        runId: member.runId,
        attempt: member.attempt,
        revision: member.revision,
        pullRequestId: BigInt(member.pullRequestId),
        pullRequestNodeId: member.pullRequestNodeId,
        pullRequestNumber: member.pullRequestNumber,
        pullRequestUrl: member.pullRequestUrl,
        headSha: member.headSha,
        baseSha: member.baseSha,
        queueEntryId: member.queueEntryId ?? undefined,
        state: memberState(member.state),
      })),
      pendingHeads: value.pendingHeads.map((head) =>
        create(PendingMergeGroupHeadSchema, {
        deliveryId: head.deliveryId,
        headRef: head.headRef,
        headSha: head.headSha,
        baseSha: head.baseSha,
        tailPullRequestNumber: head.tailPullRequestNumber,
        receivedAt: requiredTimestamp(head.receivedAt, "pendingHead.receivedAt"),
      })),
    }),
  },
});

const dmMemoryLearning = (
  value: AwaitedClaim<typeof claimDmLearningJob>,
): ClaimedWork => create(ClaimedWorkSchema, {
  work: {
    case: "dmMemory",
    value: create(ClaimedDmMemoryLearningSchema, {
      workId: value.workId,
      runId: value.runId,
      organizationId: value.organizationId,
      workerId: value.workerId,
      sourceKey: value.sourceKey,
      title: value.title,
      claimToken: value.claimToken,
      claimedAt: requiredTimestamp(value.claimedAt, "claimedAt"),
      leaseExpiresAt: requiredTimestamp(value.leaseExpiresAt, "leaseExpiresAt"),
      inputHash: value.inputHash,
      snapshotJson: new TextEncoder().encode(
        dmMemoryCanonicalJson(value.snapshot),
      ),
    }),
  },
});

/** The sole application-model to generated protobuf mapping for Worker claims. */
export function workerClaimMessage(value: WorkerQueueClaim): ClaimedWork {
  switch (value.workType) {
    case "issue": return issue(value);
    case "issueReply": return issueReply(value);
    case "channelReply": return channelReply(value);
    case "projectAgentTask": return projectAgentTask(value);
    case "mergeBatch": return mergeBatch(value);
    case "dmMemory": return dmMemoryLearning(value);
  }
}
