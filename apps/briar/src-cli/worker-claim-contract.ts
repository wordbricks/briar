import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import {
  agentResponsibilityMaxLength,
  agentSkillDescriptionMaxLength,
  agentSkillsMaxCount,
} from "../src/lib/agent-limits";
import { ModelEffort } from "../src/lib/agent-provider-contract";
import { agentProviders } from "../src/lib/agent-provider";
import { autoHuntSources } from "../src/lib/auto-hunt-contract";
import { IsoDateTimeWithOffset } from "../src/lib/date-time-schema";
import { OrganizationAgentContextDescriptor } from "../src/lib/organization-agent-context-contract";
import { MERGE_GROUP_CI_CONTEXTS } from "../src/lib/merge-group-validation-contract";
import { WorkflowConfig, WorkflowStageId } from "./config-contract";

const rejectExcessProperties = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const strict = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: rejectExcessProperties });
const mutableArray = <S extends Schema.Top>(item: S) =>
  Schema.mutable(Schema.Array(item));
const defaulted = <S extends Schema.Constraint>(
  schema: S,
  value: S["Type"],
): Schema.withDecodingDefaultType<S> =>
  Schema.withDecodingDefaultType<S>(Effect.succeed(value))(schema);
const defaultedWith = <S extends Schema.Constraint>(
  schema: S,
  value: () => S["Type"],
): Schema.withDecodingDefaultType<S> =>
  Schema.withDecodingDefaultType<S>(Effect.sync(value))(schema);

const Uuid = Schema.String.check(Schema.isUUID());
// Merge-batch candidates are durable, opaque database identifiers. They are
// currently 32 lowercase hexadecimal characters, rather than UUIDs.
const MergeBatchCandidateId = Schema.NonEmptyString.check(
  Schema.isLengthBetween(1, 128),
);
const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
const NonNegativeInteger = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
);
const StringRecord = Schema.Record(Schema.String, Schema.Unknown);
const AgentProviderSchema = Schema.Literals(agentProviders);

const ClaimedHandoffContext = strict(Schema.Struct({
  requestId: Uuid,
  workType: Schema.Literals([
    "issue",
    "projectAgentTask",
    "issueReply",
    "channelReply",
  ]),
  workId: Uuid,
  runId: Schema.NullOr(Uuid),
  conversationId: Schema.NullOr(Schema.String),
  workspacePath: Schema.NullOr(Schema.String),
  createdAt: IsoDateTimeWithOffset,
}));

export const QueuedAttachment = Schema.Struct({
  id: Uuid,
  filename: Schema.String.check(Schema.isLengthBetween(1, 255)),
  contentType: Schema.String.check(
    Schema.isPattern(/^(?:image|video)\//u),
  ),
  byteSize: Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(20 * 1024 * 1024),
  ),
  url: Schema.String.check(Schema.isStartsWith("/")),
});
export type QueuedAttachment = typeof QueuedAttachment.Type;

export const QueuedIssueMessage = Schema.Struct({
  id: Uuid,
  runId: Uuid,
  parentMessageId: Schema.NullOr(Uuid),
  body: Schema.NonEmptyString,
  attachments: defaultedWith(
    mutableArray(QueuedAttachment).check(Schema.isMaxLength(5)),
    () => [],
  ),
  author: Schema.Struct({
    id: Schema.NullOr(Schema.String),
    name: Schema.NonEmptyString,
    image: Schema.NullOr(Schema.String),
    provider: Schema.NullOr(AgentProviderSchema),
  }),
  replyCount: NonNegativeInteger,
  createdAt: IsoDateTimeWithOffset,
  updatedAt: IsoDateTimeWithOffset,
});
export type QueuedIssueMessage = typeof QueuedIssueMessage.Type;

const ResumeContext = Schema.Struct({
  checkpointKey: WorkflowStageId,
  position: Schema.Literals(["before", "after"]),
  revision: PositiveInteger,
  terminalReviewOnly: Schema.Boolean,
});

export const QueuedIssue = Schema.Struct({
  executionId: Schema.optional(Uuid),
  runId: Uuid,
  runNumber: PositiveInteger,
  currentAttempt: PositiveInteger,
  currentRevision: PositiveInteger,
  source: Schema.Literals(autoHuntSources),
  sourceKey: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.String),
  priority: Schema.NullOr(
    Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(4),
    ),
  ),
  repository: Schema.NonEmptyString,
  sourceCreatedAt: Schema.NullOr(IsoDateTimeWithOffset),
  createdByUserId: defaulted(Schema.NullOr(Schema.String), null),
  context: Schema.NullOr(StringRecord),
  reviewFeedback: defaulted(Schema.NullOr(Schema.String), null),
  workflow: WorkflowConfig,
  workflowStage: Schema.NullOr(Schema.String),
  startStage: Schema.NullOr(Schema.String),
  resumeContext: Schema.NullOr(ResumeContext),
  attachments: defaultedWith(
    mutableArray(QueuedAttachment).check(Schema.isMaxLength(5)),
    () => [],
  ),
  messages: defaultedWith(mutableArray(QueuedIssueMessage), () => []),
  claimToken: Schema.String.check(Schema.isStartsWith("briar_claim_")),
  claimedBy: Schema.NonEmptyString,
  claimedAt: IsoDateTimeWithOffset,
  leaseExpiresAt: IsoDateTimeWithOffset,
  claimAttempts: PositiveInteger,
  handoffContext: defaulted(Schema.NullOr(ClaimedHandoffContext), null),
});
export type QueuedIssue = typeof QueuedIssue.Type;
export const decodeQueuedIssue = Schema.decodeUnknownSync(QueuedIssue);

export const WorkerRegistration = Schema.Struct({
  organizationId: Uuid,
  deviceId: Uuid,
  worker: Schema.Struct({
    id: Schema.NonEmptyString,
    label: Schema.NonEmptyString,
    state: Schema.Literals(["online", "stale", "disabled"]),
    maxConcurrentSessions: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(16),
    ),
    lastHeartbeatAt: Schema.String,
  }),
  workerToken: Schema.String.check(Schema.isStartsWith("briar_worker_")),
});
export type WorkerRegistration = typeof WorkerRegistration.Type;
export const decodeWorkerRegistration = Schema.decodeUnknownSync(
  WorkerRegistration,
);

export const WorkerBinding = Schema.Struct({
  organizationId: WorkerRegistration.fields.organizationId,
  deviceId: WorkerRegistration.fields.deviceId,
  worker: WorkerRegistration.fields.worker,
});
export type WorkerBinding = typeof WorkerBinding.Type;
export const decodeWorkerBinding = Schema.decodeUnknownSync(WorkerBinding);

const DetachedAgentSkillSource = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  description: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
  provider: AgentProviderSchema,
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(ModelEffort),
  kind: Schema.Literals(["issue_processing", "custom"]),
  position: NonNegativeInteger,
});

const DetachedAgentSkillType = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  description: Schema.String,
  body: Schema.String,
  provider: AgentProviderSchema,
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(ModelEffort),
  kind: Schema.Literals(["issue_processing", "custom"]),
  position: NonNegativeInteger,
});

export const DetachedAgentSkill = DetachedAgentSkillSource.pipe(
  Schema.decodeTo(
    DetachedAgentSkillType,
    SchemaTransformation.transform({
      decode: ({ body, description, instructions, ...skill }) => {
        const normalizedBody = body ?? instructions ?? "";
        return {
          ...skill,
          description: description ||
            normalizedBody.replace(/\s+/gu, " ").trim().slice(
              0,
              agentSkillDescriptionMaxLength,
            ) || skill.name,
          body: normalizedBody,
        };
      },
      encode: (skill) => ({
        ...skill,
        instructions: undefined,
      }),
    }),
  ),
);
export type DetachedAgentSkill = typeof DetachedAgentSkill.Type;
export const decodeDetachedAgentSkillsOption = Schema.decodeUnknownOption(
  mutableArray(DetachedAgentSkill),
);
export const decodeDetachedAgentEffortOption = Schema.decodeUnknownOption(
  ModelEffort,
);

export const DetachedAgentSkillExecutionTarget = strict(Schema.Struct({
  projectId: Uuid,
  agentId: Uuid,
  skillId: Uuid,
  skillName: Schema.Trim.check(Schema.isLengthBetween(1, 100)),
  request: Schema.Trim.check(Schema.isLengthBetween(1, 10_000)),
}));

export const DetachedAgentClaim = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  provider: AgentProviderSchema,
  model: Schema.NullOr(Schema.String),
  effort: defaulted(Schema.NullOr(ModelEffort), null),
  responsibility: Schema.String,
  skill: defaulted(Schema.String, ""),
  skills: defaultedWith(mutableArray(DetachedAgentSkill), () => []),
});
export type DetachedAgentClaim = typeof DetachedAgentClaim.Type;

const DetachedExecution = Schema.Struct({
  provider: AgentProviderSchema,
  model: Schema.NullOr(Schema.String),
  effort: defaulted(Schema.NullOr(ModelEffort), null),
});

export const ClaimedRun = Schema.Struct({
  ...QueuedIssue.fields,
  execution: Schema.optional(Schema.NullOr(DetachedExecution)),
  agent: Schema.NullOr(DetachedAgentClaim),
  activeSkill: Schema.optional(Schema.NullOr(DetachedAgentSkill)),
  handoffContext: defaulted(Schema.NullOr(ClaimedHandoffContext), null),
});
export type ClaimedRun = typeof ClaimedRun.Type;
export const decodeClaimedRun = Schema.decodeUnknownSync(ClaimedRun);

export const ClaimedProjectAgentTask = Schema.Struct({
  workType: Schema.Literal("projectAgentTask"),
  workId: Uuid,
  runId: Uuid,
  sourceKey: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  claimToken: Schema.String.check(
    Schema.isStartsWith("briar_agent_task_claim_"),
  ),
  claimAttempts: PositiveInteger,
  claimedAt: IsoDateTimeWithOffset,
  leaseExpiresAt: IsoDateTimeWithOffset,
  request: Schema.NonEmptyString,
  agent: DetachedAgentClaim,
  activeSkill: Schema.optional(Schema.NullOr(DetachedAgentSkill)),
  handoffContext: defaulted(Schema.NullOr(ClaimedHandoffContext), null),
});
export type ClaimedProjectAgentTask = typeof ClaimedProjectAgentTask.Type;
export const decodeClaimedProjectAgentTask = Schema.decodeUnknownSync(
  ClaimedProjectAgentTask,
);

const GitObjectId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}$/u),
);
const GithubRepositoryName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u),
);
const MergeGroupRef = Schema.String.check(
  Schema.isPattern(
    new RegExp(
      "^refs/heads/(?:gh-readonly-queue/main/[A-Za-z0-9._/-]+|" +
        "briar/merge-queue/[0-9a-f-]{36})$",
      "u",
    ),
  ),
);
const MergeGroupContext = Schema.Literals(MERGE_GROUP_CI_CONTEXTS);
const MergeBatchValidationResult = strict(Schema.Struct({
  context: MergeGroupContext,
  passed: Schema.Boolean,
  exitCode: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(255),
  ),
  failureCode: Schema.NullOr(
    Schema.Literals(["ci_failed", "output_limit"]),
  ),
  log: Schema.String.check(Schema.isMaxLength(64 * 1_024)),
  logSha256: Schema.String.check(
    Schema.isPattern(/^[0-9a-f]{64}$/u),
  ),
  logTruncated: Schema.Boolean,
}));

const MergeBatchMember = strict(Schema.Struct({
  id: MergeBatchCandidateId,
  ordinal: PositiveInteger,
  runId: Uuid,
  attempt: PositiveInteger,
  revision: PositiveInteger,
  pullRequestId: PositiveInteger,
  pullRequestNodeId: Schema.NonEmptyString,
  pullRequestNumber: PositiveInteger,
  pullRequestUrl: Schema.NonEmptyString,
  headSha: GitObjectId,
  baseSha: GitObjectId,
  queueEntryId: Schema.NullOr(Schema.NonEmptyString),
  state: Schema.Literals([
    "ready",
    "frozen",
    "enqueued",
    "merged",
    "dequeued",
    "failed",
  ]),
}));

const PendingMergeGroupHead = strict(Schema.Struct({
  deliveryId: Schema.NonEmptyString,
  headRef: MergeGroupRef,
  headSha: GitObjectId,
  baseSha: GitObjectId,
  tailPullRequestNumber: PositiveInteger,
  receivedAt: IsoDateTimeWithOffset,
}));

const ClaimedMergeBatchInput = strict(Schema.Struct({
  workType: Schema.Literal("mergeBatch"),
  workId: Uuid,
  runId: Uuid,
  sourceKey: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  projectId: Uuid,
  repositoryId: PositiveInteger,
  repository: GithubRepositoryName,
  baseBranch: Schema.Literal("main"),
  phase: Schema.Literals([
    "enqueue",
    "tail_authority",
    "validate",
    "publish",
    "drain",
  ]),
  claimToken: Schema.String.check(
    Schema.isPattern(/^briar_merge_claim_[0-9a-f]{64}$/u),
  ),
  claimedAt: IsoDateTimeWithOffset,
  leaseExpiresAt: IsoDateTimeWithOffset,
  claimAttempts: PositiveInteger,
  batch: strict(Schema.Struct({
    id: Uuid,
    state: Schema.Literals([
      "frozen",
      "enqueueing",
      "waiting_tail",
      "validating",
      "publishing",
      "draining",
    ]),
    finalDeliveryId: Schema.NullOr(Schema.String),
    mergeGroupRef: Schema.NullOr(MergeGroupRef),
    mergeGroupSha: Schema.NullOr(GitObjectId),
    mergeGroupBaseSha: Schema.NullOr(GitObjectId),
    validationResults: Schema.NullOr(mutableArray(MergeBatchValidationResult)),
    validatedAt: Schema.NullOr(IsoDateTimeWithOffset),
    publishedAt: Schema.NullOr(IsoDateTimeWithOffset),
    failureCode: Schema.NullOr(Schema.String),
    failureDetail: Schema.NullOr(Schema.String),
  })),
  members: mutableArray(MergeBatchMember).check(
    Schema.isLengthBetween(1, 5),
  ),
  pendingHeads: mutableArray(PendingMergeGroupHead),
})).check(
  Schema.makeFilter((claim) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (claim.workId !== claim.runId || claim.workId !== claim.batch.id) {
      issues.push({
        path: ["workId"],
        issue: "Merge batch work, run, and batch identities must match",
      });
    }
    const expectedState = {
      enqueue: "enqueueing",
      tail_authority: "waiting_tail",
      validate: "validating",
      publish: "publishing",
      drain: "draining",
    } as const;
    if (claim.batch.state !== expectedState[claim.phase]) {
      issues.push({
        path: ["batch", "state"],
        issue: "Merge batch state does not match its claimed phase",
      });
    }
    if (
      ["validate", "publish", "drain"].includes(claim.phase) &&
      (!claim.batch.finalDeliveryId || !claim.batch.mergeGroupRef ||
        !claim.batch.mergeGroupSha || !claim.batch.mergeGroupBaseSha)
    ) {
      issues.push({
        path: ["batch", "mergeGroupSha"],
        issue: "Merge batch phase requires complete integration authority",
      });
    }
    if (
      ["publish", "drain"].includes(claim.phase) &&
      claim.batch.validationResults === null
    ) {
      issues.push({
        path: ["batch", "validationResults"],
        issue: "Merge batch phase requires a durable validation proof",
      });
    }
    const memberIds = new Set<string>();
    const pullRequestNumbers = new Set<number>();
    for (const [index, member] of claim.members.entries()) {
      if (member.ordinal !== index + 1) {
        issues.push({
          path: ["members", index, "ordinal"],
          issue: "Merge batch members must have exact consecutive ordinals",
        });
      }
      if (memberIds.has(member.id)) {
        issues.push({
          path: ["members", index, "id"],
          issue: "Merge batch member identities must be unique",
        });
      }
      if (pullRequestNumbers.has(member.pullRequestNumber)) {
        issues.push({
          path: ["members", index, "pullRequestNumber"],
          issue: "Merge batch pull request numbers must be unique",
        });
      }
      memberIds.add(member.id);
      pullRequestNumbers.add(member.pullRequestNumber);
    }
    if (claim.batch.validationResults !== null) {
      const contexts = new Set(
        claim.batch.validationResults.map((result) => result.context),
      );
      if (
        claim.batch.validationResults.length !== MERGE_GROUP_CI_CONTEXTS.length ||
        contexts.size !== MERGE_GROUP_CI_CONTEXTS.length ||
        !MERGE_GROUP_CI_CONTEXTS.every((context) => contexts.has(context))
      ) {
        issues.push({
          path: ["batch", "validationResults"],
          issue: "Merge batch validation proof must contain every context exactly once",
        });
      }
    }
    return issues;
  }),
);

export const ClaimedMergeBatch = ClaimedMergeBatchInput;
export type ClaimedMergeBatch = typeof ClaimedMergeBatch.Type;
export const decodeClaimedMergeBatch = Schema.decodeUnknownSync(
  ClaimedMergeBatch,
);

const ChannelActivityCredential = strict(Schema.Struct({
  token: Schema.NonEmptyString,
  expiresAt: IsoDateTimeWithOffset,
}));

export const ClaimedIssueReply = Schema.Struct({
  workType: Schema.Literal("issueReply"),
  workId: Uuid,
  runId: Uuid,
  sourceKey: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  triggerMessageId: Uuid,
  parentMessageId: Uuid,
  provider: AgentProviderSchema,
  model: Schema.NullOr(Schema.String),
  effort: Schema.optional(Schema.NullOr(ModelEffort)),
  agent: Schema.optional(Schema.NullOr(DetachedAgentClaim)),
  activeSkill: Schema.optional(Schema.NullOr(DetachedAgentSkill)),
  skillExecutionTarget: defaulted(
    Schema.NullOr(DetachedAgentSkillExecutionTarget),
    null,
  ),
  branch: Schema.NullOr(Schema.String),
  requiresPreferredWorker: Schema.optional(Schema.Boolean),
  claimToken: Schema.String.check(
    Schema.isStartsWith("briar_reply_claim_"),
  ),
  claimedAt: IsoDateTimeWithOffset,
  leaseExpiresAt: IsoDateTimeWithOffset,
  activity: defaulted(Schema.NullOr(ChannelActivityCredential), null),
  handoffContext: defaulted(Schema.NullOr(ClaimedHandoffContext), null),
  snapshot: Schema.Struct({
    run: StringRecord,
    messages: mutableArray(QueuedIssueMessage),
    agentTranscript: defaultedWith(mutableArray(StringRecord), () => []),
    evidence: mutableArray(StringRecord),
  }),
});
export type ClaimedIssueReply = typeof ClaimedIssueReply.Type;
export const decodeClaimedIssueReply = Schema.decodeUnknownSync(
  ClaimedIssueReply,
);

const ChannelDelegationTarget = strict(Schema.Struct({
  agentId: Uuid,
  agentName: Schema.Trim.check(Schema.isLengthBetween(1, 100)),
  projectId: Uuid,
  projectName: Schema.Trim.check(Schema.isLengthBetween(1, 300)),
  responsibility: Schema.Trim.check(
    Schema.isLengthBetween(1, agentResponsibilityMaxLength),
  ),
  skills: mutableArray(strict(Schema.Struct({
    id: Uuid,
    name: Schema.Trim.check(Schema.isLengthBetween(1, 100)),
  }))).check(Schema.isMaxLength(agentSkillsMaxCount)),
}));

const ClaimedChannelDelegation = strict(Schema.Struct({
  delegatedByReplyId: Uuid,
  delegatedByAgentId: Uuid,
  delegatedByAgentName: Schema.Trim.check(Schema.isLengthBetween(1, 100)),
  request: Schema.Trim.check(Schema.isLengthBetween(1, 10_000)),
}));

const OrganizationScope = Schema.Struct({
  kind: Schema.Literal("organization"),
  organizationId: Uuid,
});
const ProjectScope = Schema.Struct({
  kind: Schema.Literal("project"),
  organizationId: Uuid,
  projectId: Uuid,
});
const ChannelReplyScope = Schema.Union([OrganizationScope, ProjectScope]);

const ClaimedChannelReplyInput = Schema.Struct({
  workType: Schema.Literal("channelReply"),
  workId: Uuid,
  organizationId: Uuid,
  channelId: Uuid,
  /** Null for an organization Agent: there is no repository to open. */
  projectId: Schema.NullOr(Uuid),
  scope: Schema.optional(ChannelReplyScope),
  runId: Uuid,
  sourceKey: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  triggerMessageId: Uuid,
  parentMessageId: Uuid,
  provider: AgentProviderSchema,
  model: Schema.NullOr(Schema.String),
  effort: Schema.optional(Schema.NullOr(ModelEffort)),
  agent: Schema.optional(Schema.NullOr(DetachedAgentClaim)),
  activeSkill: Schema.optional(Schema.NullOr(DetachedAgentSkill)),
  skillExecutionTarget: defaulted(
    Schema.NullOr(DetachedAgentSkillExecutionTarget),
    null,
  ),
  claimToken: Schema.String.check(
    Schema.isStartsWith("briar_channel_claim_"),
  ),
  claimedAt: IsoDateTimeWithOffset,
  leaseExpiresAt: IsoDateTimeWithOffset,
  activity: defaulted(Schema.NullOr(ChannelActivityCredential), null),
  organizationContext: Schema.optional(
    Schema.NullOr(OrganizationAgentContextDescriptor),
  ),
  delegation: defaulted(Schema.NullOr(ClaimedChannelDelegation), null),
  delegationTargets: defaultedWith(
    mutableArray(ChannelDelegationTarget),
    () => [],
  ),
  handoffContext: defaulted(Schema.NullOr(ClaimedHandoffContext), null),
  snapshot: StringRecord,
}).check(
  Schema.makeFilter((reply) => {
    const issues: Array<Schema.FilterIssue> = [];
    const scope = reply.scope ?? (reply.projectId === null
      ? {
          kind: "organization" as const,
          organizationId: reply.organizationId,
        }
      : {
          kind: "project" as const,
          organizationId: reply.organizationId,
          projectId: reply.projectId,
        });
    if (scope.organizationId !== reply.organizationId) {
      issues.push({
        path: ["scope", "organizationId"],
        issue: "Channel reply organization scope does not match its claim",
      });
    }
    if (scope.kind === "organization") {
      if (reply.projectId !== null) {
        issues.push({
          path: ["projectId"],
          issue: "Organization reply cannot carry a project",
        });
      }
      if (!reply.organizationContext) {
        issues.push({
          path: ["organizationContext"],
          issue: "Organization reply requires complete context protocol metadata",
        });
      } else if (reply.organizationContext.snapshotAt !== reply.claimedAt) {
        issues.push({
          path: ["organizationContext", "snapshotAt"],
          issue: "Organization context snapshot does not match its claim",
        });
      }
      if (reply.delegation) {
        issues.push({
          path: ["delegation"],
          issue: "Organization reply cannot itself be delegated",
        });
      }
      if (reply.skillExecutionTarget) {
        issues.push({
          path: ["skillExecutionTarget"],
          issue: "Organization reply cannot receive a Skill execution target",
        });
      }
      return issues;
    }
    if (reply.organizationContext) {
      issues.push({
        path: ["organizationContext"],
        issue: "Project reply cannot carry organization context",
      });
    }
    if (reply.projectId !== scope.projectId) {
      issues.push({
        path: ["scope", "projectId"],
        issue: "Project reply scope does not match its project",
      });
    }
    if (reply.delegationTargets.length > 0) {
      issues.push({
        path: ["delegationTargets"],
        issue: "Project reply cannot receive delegation targets",
      });
    }
    if (
      reply.skillExecutionTarget &&
      (reply.skillExecutionTarget.projectId !== scope.projectId ||
        reply.skillExecutionTarget.agentId !== reply.agent?.id ||
        reply.skillExecutionTarget.skillId !== reply.activeSkill?.id ||
        reply.skillExecutionTarget.skillName !== reply.activeSkill?.name)
    ) {
      issues.push({
        path: ["skillExecutionTarget"],
        issue: "Skill execution target does not match the claimed Agent Skill",
      });
    }
    return issues;
  }),
);

const ClaimedChannelReplyOutput = Schema.toType(Schema.Struct({
  ...ClaimedChannelReplyInput.fields,
  scope: ChannelReplyScope,
}));

type ClaimedChannelReplyInput = typeof ClaimedChannelReplyInput.Type;
type ClaimedChannelReplyOutput = typeof ClaimedChannelReplyOutput.Type;

export const ClaimedChannelReply = ClaimedChannelReplyInput.pipe(
  Schema.decodeTo(
    ClaimedChannelReplyOutput,
    SchemaTransformation.transform<
      ClaimedChannelReplyOutput,
      ClaimedChannelReplyInput
    >({
      decode: (reply) => ({
        ...reply,
        scope: reply.scope ?? (reply.projectId === null
          ? {
              kind: "organization" as const,
              organizationId: reply.organizationId,
            }
          : {
              kind: "project" as const,
              organizationId: reply.organizationId,
              projectId: reply.projectId,
            }),
      }),
      encode: (reply) => reply,
    }),
  ),
);
export type ClaimedChannelReply = typeof ClaimedChannelReply.Type;
export const decodeClaimedChannelReply = Schema.decodeUnknownSync(
  ClaimedChannelReply,
);
