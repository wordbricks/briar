import { create, type JsonObject } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  AgentProvider,
  IssueAttachmentSchema,
  OrganizationMemberSchema,
  ProjectRole,
  RelatedMessageReferenceSchema,
  ResultReviewSchema,
  RunStatus,
  IssueDifficulty,
  IssueSubscriberSchema,
  MessageAuthorSchema,
  NotificationReason,
  StructuredRunResult_Impact,
  StructuredRunResult_Importance,
  StructuredRunResult_Outcome,
  StructuredRunResultSchema,
  StructuredRunResult_Urgency,
  UserSchema,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/common_pb";
import {
  InboxChannelMessageSchema,
  InboxConversationMessageSchema,
  InboxFeedMessageSchema,
  InboxIssueMessageSchema,
  InboxMessageIdentitySchema,
  InboxSessionMessage_Status,
  InboxSessionMessageSchema,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/inbox_pb";
import {
  AgentExecutionMetricsSchema,
  AutoHuntWorkflowSchema,
  ChannelNotificationSchema,
  CheckpointBoundarySchema,
  CheckpointPolicySchema,
  ConversationNotificationSchema,
  DashboardRun_DispatchMode,
  DashboardRun_ExecutionReadiness,
  DashboardRun_QaStatus,
  DashboardRun_Source,
  DashboardRunSchema,
  DashboardWorker_Readiness,
  DashboardWorker_State,
  DashboardWorkerSchema,
  IssueDependencyReferenceSchema,
  LinearSettingsSchema,
  ProjectExecutionWorkerPolicy_SelectionMode,
  ProjectExecutionWorkerPolicySchema,
  ProjectSettingsSchema,
  RunEventSchema,
  TrackerReferenceSchema,
  WaitingCheckpointSchema,
  WorkflowCheckpoint_Position,
  WorkflowCheckpointSchema,
  WorkflowCheckpointSpecSchema,
  WorkflowCompletionSchema,
  WorkflowExecutionSchema,
  WorkflowRequirementSchema,
  WorkflowStageSchema,
  WorkerIcon_Kind,
  WorkerIconSchema,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/dashboard_pb";
import { ProjectSchema } from "@briar/mobile-contracts/gen/briar/mobile/v1/project_pb";
import type {
  AutoHuntWorkflow,
  AutoHuntWorkflowCheckpoint,
} from "../../src/lib/auto-hunt-contract";
import type { AgentProvider as AgentProviderName } from "../../src/lib/agent-provider";
import type { StructuredAgentResult } from "../../src/lib/agent-result";
import type { dashboardEventJson, dashboardRunJson } from "./dashboard-json";
import type { InboxFeedMessage } from "./inbox-feed";
import type {
  channelConversationNotificationJson,
  issueConversationNotificationJson,
} from "./issue-conversation-json";
import type {
  OrganizationMemberRow,
  OrganizationRole,
} from "./organization-repository";
import type { ProjectRow } from "./project-repository";
import type { settingsJson } from "./project-settings-json";
import type { checkpointPolicyJson } from "./workflow-policy";
import type { workerJson } from "./worker-json";

const projectRole = {
  owner: ProjectRole.OWNER,
  "co-owner": ProjectRole.CO_OWNER,
  developer: ProjectRole.DEVELOPER,
  editor: ProjectRole.EDITOR,
  viewer: ProjectRole.VIEWER,
} as const satisfies Record<OrganizationRole, ProjectRole>;

const runStatus = {
  backlog: RunStatus.BACKLOG,
  queued: RunStatus.QUEUED,
  running: RunStatus.RUNNING,
  paused: RunStatus.PAUSED,
  blocked: RunStatus.BLOCKED,
  failed: RunStatus.FAILED,
  completed: RunStatus.COMPLETED,
  cancelled: RunStatus.CANCELLED,
} as const;

const structuredOutcome = {
  completed: StructuredRunResult_Outcome.COMPLETED,
  partial: StructuredRunResult_Outcome.PARTIAL,
  blocked: StructuredRunResult_Outcome.BLOCKED,
  failed: StructuredRunResult_Outcome.FAILED,
} as const;

const structuredImportance = {
  routine: StructuredRunResult_Importance.ROUTINE,
  important: StructuredRunResult_Importance.IMPORTANT,
  critical: StructuredRunResult_Importance.CRITICAL,
} as const;

const structuredUrgency = {
  normal: StructuredRunResult_Urgency.NORMAL,
  time_sensitive: StructuredRunResult_Urgency.TIME_SENSITIVE,
  immediate: StructuredRunResult_Urgency.IMMEDIATE,
} as const;

const structuredImpact = {
  issue: StructuredRunResult_Impact.ISSUE,
  project: StructuredRunResult_Impact.PROJECT,
  organization: StructuredRunResult_Impact.ORGANIZATION,
} as const;

const sessionStatus = {
  completed: InboxSessionMessage_Status.COMPLETED,
  failed: InboxSessionMessage_Status.FAILED,
} as const;

const notificationReason = {
  mention: NotificationReason.MENTION,
  thread_reply: NotificationReason.THREAD_REPLY,
  subscription: NotificationReason.SUBSCRIPTION,
} as const;

const timestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid timestamp in mobile response");
  }
  return timestampFromDate(date);
};

export const mobileUser = (user: {
  readonly id: string;
  readonly username?: string | null;
  readonly name: string;
  readonly email: string;
  readonly image?: string | null;
}) => create(UserSchema, {
  id: user.id,
  username: user.username ?? undefined,
  name: user.name,
  email: user.email,
  image: user.image ?? undefined,
});

export const mobileOrganizationMember = (
  member: OrganizationMemberRow,
  projectIds: readonly string[] = [],
) =>
  create(OrganizationMemberSchema, {
    userId: member.user_id,
    name: member.name,
    email: member.email,
    image: member.image ?? undefined,
    role: projectRole[member.role],
    createdAt: timestamp(member.created_at),
    projectIds: [...projectIds],
  });

const mobileStructuredResult = (result: StructuredAgentResult) =>
  create(StructuredRunResultSchema, {
    summary: result.summary,
    outcome: structuredOutcome[result.outcome],
    importance: structuredImportance[result.importance],
    urgency: structuredUrgency[result.urgency],
    impact: structuredImpact[result.impact],
    humanActionRequired: result.humanActionRequired,
    nextAction: result.nextAction ?? undefined,
    dueAt: result.dueAt ? timestamp(result.dueAt) : undefined,
  });

const mobileInboxIdentity = (message: InboxFeedMessage) =>
  create(InboxMessageIdentitySchema, {
    id: message.id,
    projectId: message.projectId,
    projectName: message.projectName,
    targetId: message.targetId,
    title: message.title,
    occurredAt: timestamp(message.occurredAt),
    version: message.version,
  });

export const mobileInboxFeedMessage = (message: InboxFeedMessage) => {
  const identity = mobileInboxIdentity(message);
  switch (message.kind) {
    case "issue": {
      if (message.runNumber === undefined || message.status === undefined) {
        throw new Error("Issue Inbox message is incomplete");
      }
      return create(InboxFeedMessageSchema, {
        identity,
        content: {
          case: "issue",
          value: create(InboxIssueMessageSchema, {
            runNumber: message.runNumber,
            status: runStatus[message.status],
            workflowStage: message.workflowStage ?? undefined,
            workflowStageLabel: message.workflowStageLabel ?? undefined,
            priority: message.priority ?? undefined,
            structuredResult: message.structuredResult
              ? mobileStructuredResult(message.structuredResult)
              : undefined,
          }),
        },
      });
    }
    case "conversation": {
      if (
        message.messageId === undefined ||
        message.rootMessageId === undefined ||
        message.body === undefined ||
        message.authorName === undefined ||
        message.reason === undefined
      ) {
        throw new Error("Conversation Inbox message is incomplete");
      }
      return create(InboxFeedMessageSchema, {
        identity,
        content: {
          case: "conversation",
          value: create(InboxConversationMessageSchema, {
            messageId: message.messageId,
            rootMessageId: message.rootMessageId,
            body: message.body,
            authorName: message.authorName,
            authorImage: message.authorImage ?? undefined,
            issueKey: message.issueKey,
            reason: notificationReason[message.reason],
          }),
        },
      });
    }
    case "channel": {
      if (
        message.channelId === undefined ||
        message.channelName === undefined ||
        message.messageId === undefined ||
        message.rootMessageId === undefined ||
        message.body === undefined ||
        message.authorName === undefined ||
        message.reason === undefined
      ) {
        throw new Error("Channel Inbox message is incomplete");
      }
      return create(InboxFeedMessageSchema, {
        identity,
        content: {
          case: "channel",
          value: create(InboxChannelMessageSchema, {
            channelId: message.channelId,
            channelName: message.channelName,
            messageId: message.messageId,
            rootMessageId: message.rootMessageId,
            body: message.body,
            authorName: message.authorName,
            authorImage: message.authorImage ?? undefined,
            reason: notificationReason[message.reason],
          }),
        },
      });
    }
    case "session": {
      if (
        (message.status !== "completed" && message.status !== "failed") ||
        message.issueCount === undefined ||
        message.requiresAttention === undefined
      ) {
        throw new Error("Session Inbox message is incomplete");
      }
      return create(InboxFeedMessageSchema, {
        identity,
        content: {
          case: "session",
          value: create(InboxSessionMessageSchema, {
            status: sessionStatus[message.status],
            agentName: message.agentName ?? undefined,
            issueCount: message.issueCount,
            error: message.error ?? undefined,
            summary: message.summary ?? undefined,
            requiresAttention: message.requiresAttention,
          }),
        },
      });
    }
  }
};

const agentProvider = {
  codex: AgentProvider.CODEX,
  claude: AgentProvider.CLAUDE,
  cursor: AgentProvider.CURSOR,
  grok: AgentProvider.GROK,
  agy: AgentProvider.AGY,
  opencode: AgentProvider.OPENCODE,
  openrouter: AgentProvider.OPENROUTER,
} as const satisfies Record<AgentProviderName, AgentProvider>;

const issueDifficulty = {
  easy: IssueDifficulty.EASY,
  normal: IssueDifficulty.NORMAL,
  hard: IssueDifficulty.HARD,
} as const;

const checkpointPosition = {
  before: WorkflowCheckpoint_Position.BEFORE,
  after: WorkflowCheckpoint_Position.AFTER,
} as const;

const qaStatus = {
  pending: DashboardRun_QaStatus.PENDING,
  passed: DashboardRun_QaStatus.PASSED,
  skipped: DashboardRun_QaStatus.SKIPPED,
} as const;

const mobileCheckpointSpec = (checkpoint: AutoHuntWorkflowCheckpoint) =>
  create(WorkflowCheckpointSpecSchema, {
    key: checkpoint.key,
    stage: checkpoint.stage,
    position: checkpointPosition[checkpoint.position],
  });

const mobileWorkflow = (workflow: AutoHuntWorkflow) =>
  create(AutoHuntWorkflowSchema, {
    version: workflow.version,
    stages: workflow.stages.map((stage) => create(WorkflowStageSchema, {
      id: stage.id,
      label: stage.label,
      required: stage.required,
      evidence: [...(stage.evidence ?? [])],
      checks: [...(stage.checks ?? [])],
    })),
    requirements: workflow.requirements.map((requirement) =>
      create(WorkflowRequirementSchema, requirement)
    ),
    execution: create(WorkflowExecutionSchema, {
      checkpoints: workflow.execution.checkpoints.map(mobileCheckpointSpec),
    }),
    completion: create(WorkflowCompletionSchema, {
      requiredStages: [...workflow.completion.requiredStages],
    }),
  });

type ProjectSettingsJson = ReturnType<typeof settingsJson> & {
  readonly checkpointPolicy?: ReturnType<typeof checkpointPolicyJson>;
};

export const mobileProjectSettings = (
  settings: ProjectSettingsJson,
) => create(ProjectSettingsSchema, {
  velenOrg: settings.velenOrg ?? undefined,
  dataSource: settings.dataSource ?? undefined,
  linear: create(LinearSettingsSchema, {
    enabled: settings.linear.enabled,
    source: settings.linear.source ?? undefined,
    teamKey: settings.linear.teamKey ?? undefined,
  }),
  githubRepositoryId: settings.githubRepositoryId === null
    ? undefined
    : BigInt(settings.githubRepositoryId),
  githubRepository: settings.githubRepository ?? undefined,
  workflow: mobileWorkflow(settings.workflow),
  checkpointPolicy: settings.checkpointPolicy
    ? create(CheckpointPolicySchema, {
        availableBoundaries: settings.checkpointPolicy.availableBoundaries.map(
          (boundary) => create(CheckpointBoundarySchema, {
            stage: boundary.stage,
            stageLabel: boundary.stageLabel,
            position: checkpointPosition[boundary.position],
          }),
        ),
        projectMandatory: settings.checkpointPolicy.projectMandatory.map(
          mobileCheckpointSpec,
        ),
        userDefaults: settings.checkpointPolicy.userDefaults.map(
          mobileCheckpointSpec,
        ),
        effective: settings.checkpointPolicy.effective.map(
          mobileCheckpointSpec,
        ),
        projectRevision: BigInt(settings.checkpointPolicy.projectRevision),
        userRevision: BigInt(settings.checkpointPolicy.userRevision),
      })
    : undefined,
});

export const mobileProject = (project: ProjectRow) => create(ProjectSchema, {
  id: project.id,
  name: project.name,
  issueKeyPrefix: project.issue_key_prefix,
  scheduleTabEnabled: project.schedule_tab_enabled !== 0,
  icon: project.icon ?? undefined,
  organizationId: project.organization_id,
  organizationName: project.organization_name,
  role: projectRole[project.member_role],
  createdAt: timestamp(project.created_at),
});

const mobileMessageAuthor = (author: {
  readonly id: string | null;
  readonly agentId?: string | null;
  readonly name: string;
  readonly image: string | null;
  readonly provider: AgentProviderName | null;
}) => create(MessageAuthorSchema, {
  id: author.id ?? undefined,
  agentId: author.agentId ?? undefined,
  name: author.name,
  image: author.image ?? undefined,
  provider: author.provider ?? undefined,
});

export const mobileConversationNotification = (
  notification: ReturnType<typeof issueConversationNotificationJson>,
) => create(ConversationNotificationSchema, {
  id: notification.id,
  runId: notification.runId,
  runTitle: notification.runTitle,
  rootMessageId: notification.rootMessageId,
  body: notification.body,
  author: mobileMessageAuthor(notification.author),
  reason: notificationReason[notification.reason],
  createdAt: timestamp(notification.createdAt),
});

export const mobileChannelNotification = (
  notification: ReturnType<typeof channelConversationNotificationJson>,
) => create(ChannelNotificationSchema, {
  id: notification.id,
  channelId: notification.channelId,
  channelName: notification.channelName,
  rootMessageId: notification.rootMessageId,
  body: notification.body,
  author: mobileMessageAuthor(notification.author),
  reason: notificationReason[notification.reason],
  createdAt: timestamp(notification.createdAt),
});

type DashboardRunJson = ReturnType<typeof dashboardRunJson>;

export const mobileDashboardRun = (run: DashboardRunJson) =>
  create(DashboardRunSchema, {
    id: run.id,
    runNumber: run.runNumber,
    currentAttempt: run.currentAttempt,
    currentRevision: run.currentRevision,
    sourceKey: run.sourceKey,
    sourceCreatedAt: run.sourceCreatedAt
      ? timestamp(run.sourceCreatedAt)
      : undefined,
    title: run.title,
    status: runStatus[run.status],
    workflowStage: run.workflowStage ?? undefined,
    workflow: mobileWorkflow(run.workflow),
    pausedAt: run.pausedAt ? timestamp(run.pausedAt) : undefined,
    resumeRequestedAt: run.resumeRequestedAt
      ? timestamp(run.resumeRequestedAt)
      : undefined,
    checkpoint: run.checkpoint
      ? create(WorkflowCheckpointSchema, {
          key: run.checkpoint.key,
          stage: run.checkpoint.stage,
          stageLabel: run.checkpoint.stageLabel,
          position: checkpointPosition[run.checkpoint.position],
          attempt: run.checkpoint.attempt,
          revision: run.checkpoint.revision,
          reachedAt: run.checkpoint.reachedAt
            ? timestamp(run.checkpoint.reachedAt)
            : undefined,
          nextStage: run.checkpoint.nextStage ?? undefined,
          nextStageLabel: run.checkpoint.nextStageLabel ?? undefined,
          terminalReviewOnly: run.checkpoint.terminalReviewOnly,
        })
      : undefined,
    progress: run.progress,
    detail: run.detail ?? undefined,
    priority: run.priority ?? undefined,
    difficulty: run.difficulty
      ? issueDifficulty[run.difficulty]
      : undefined,
    assigneeUserId: run.assigneeUserId ?? undefined,
    createdByUserId: run.createdByUserId ?? undefined,
    subscribers: run.subscribers.map((subscriber) =>
      create(IssueSubscriberSchema, {
        userId: subscriber.userId,
        subscribedAt: timestamp(subscriber.subscribedAt),
      })
    ),
    issueDescription: run.issueDescription ?? undefined,
    relatedMessage: run.relatedMessage
      ? create(RelatedMessageReferenceSchema, run.relatedMessage)
      : undefined,
    attachments: run.attachments.map((attachment) =>
      create(IssueAttachmentSchema, {
        id: attachment.id,
        filename: attachment.filename,
        contentType: attachment.contentType,
        byteSize: BigInt(attachment.byteSize),
        url: attachment.url,
      })
    ),
    prerequisites: run.prerequisites.map((dependency) =>
      create(IssueDependencyReferenceSchema, {
        ...dependency,
        status: runStatus[dependency.status],
      })
    ),
    dependents: run.dependents.map((dependency) =>
      create(IssueDependencyReferenceSchema, {
        ...dependency,
        status: runStatus[dependency.status],
      })
    ),
    executionReadiness: run.executionReadiness === "ready"
      ? DashboardRun_ExecutionReadiness.READY
      : DashboardRun_ExecutionReadiness.WAITING,
    waitingOnPrerequisiteCount: run.waitingOnPrerequisiteCount,
    resultSummary: run.resultSummary ?? undefined,
    structuredResult: run.structuredResult
      ? mobileStructuredResult(run.structuredResult)
      : undefined,
    resultReviews: run.resultReviews.map((review) =>
      create(ResultReviewSchema, {
        userId: review.userId,
        name: review.name,
        username: review.username ?? undefined,
        image: review.image ?? undefined,
        completedAt: timestamp(review.completedAt),
      })
    ),
    pullRequestUrls: run.pullRequestUrls as string[],
    branch: run.branch ?? undefined,
    commitSha: run.commitSha ?? undefined,
    preferredProvider: run.preferredProvider
      ? agentProvider[run.preferredProvider]
      : undefined,
    preferredModel: run.preferredModel ?? undefined,
    preferredEffort: run.preferredEffort ?? undefined,
    fullAuto: run.fullAuto,
    requestedProvider: run.requestedProvider
      ? agentProvider[run.requestedProvider]
      : undefined,
    requestedModel: run.requestedModel ?? undefined,
    requestedEffort: run.requestedEffort ?? undefined,
    requestedWorkerId: run.requestedWorkerId ?? undefined,
    requestedByUserId: run.requestedByUserId ?? undefined,
    dispatchMode: run.dispatchMode === null
      ? undefined
      : run.dispatchMode === "any"
        ? DashboardRun_DispatchMode.ANY
        : DashboardRun_DispatchMode.SPECIFIC,
    dispatchedAt: run.dispatchedAt ? timestamp(run.dispatchedAt) : undefined,
    claimedBy: run.claimedBy ?? undefined,
    claimedAt: run.claimedAt ? timestamp(run.claimedAt) : undefined,
    workerId: run.workerId ?? undefined,
    startedAt: timestamp(run.startedAt),
    updatedAt: timestamp(run.updatedAt),
    completedAt: run.completedAt ? timestamp(run.completedAt) : undefined,
    lastEventAt: timestamp(run.lastEventAt),
    eventCount: run.eventCount,
    source: {
      issue: DashboardRun_Source.ISSUE,
      error: DashboardRun_Source.ERROR,
      feedback: DashboardRun_Source.FEEDBACK,
    }[run.source],
    repository: run.repository,
    tracker: run.tracker
      ? create(TrackerReferenceSchema, {
          provider: run.tracker.provider,
          issueId: run.tracker.issueId ?? undefined,
          identifier: run.tracker.identifier ?? undefined,
          url: run.tracker.url ?? undefined,
          state: run.tracker.state ?? undefined,
        })
      : undefined,
    waitingCheckpoint: run.waitingCheckpoint
      ? create(WaitingCheckpointSchema, run.waitingCheckpoint)
      : undefined,
    issueCheckpoints: run.issueCheckpoints.map(mobileCheckpointSpec),
    executionMetrics: run.executionMetrics
      ? create(AgentExecutionMetricsSchema, {
          inputTokens: run.executionMetrics.inputTokens === null
            ? undefined
            : BigInt(run.executionMetrics.inputTokens),
          outputTokens: run.executionMetrics.outputTokens === null
            ? undefined
            : BigInt(run.executionMetrics.outputTokens),
          cacheReadTokens: run.executionMetrics.cacheReadTokens === null
            ? undefined
            : BigInt(run.executionMetrics.cacheReadTokens),
          cacheWriteTokens: run.executionMetrics.cacheWriteTokens === null
            ? undefined
            : BigInt(run.executionMetrics.cacheWriteTokens),
          reasoningOutputTokens:
            run.executionMetrics.reasoningOutputTokens === null
              ? undefined
              : BigInt(run.executionMetrics.reasoningOutputTokens),
          totalTokens: run.executionMetrics.totalTokens === null
            ? undefined
            : BigInt(run.executionMetrics.totalTokens),
          durationMs: BigInt(run.executionMetrics.durationMs),
        })
      : undefined,
    targetSha: run.targetSha ?? undefined,
    stagingQaStatus: run.stagingQaStatus
      ? qaStatus[run.stagingQaStatus]
      : undefined,
    productionQaStatus: run.productionQaStatus
      ? qaStatus[run.productionQaStatus]
      : undefined,
    stagingQaDetail: run.stagingQaDetail ?? undefined,
    productionQaDetail: run.productionQaDetail ?? undefined,
    context: run.context as JsonObject | null ?? undefined,
    leaseExpiresAt: run.leaseExpiresAt
      ? timestamp(run.leaseExpiresAt)
      : undefined,
    claimAttempts: run.claimAttempts,
    agentId: run.agentId ?? undefined,
  });

export const mobileDashboardWorker = (
  worker: ReturnType<typeof workerJson>,
) => create(DashboardWorkerSchema, {
  id: worker.id,
  label: worker.label,
  icon: worker.icon
    ? create(WorkerIconSchema, {
        kind: worker.icon.type === "emoji"
          ? WorkerIcon_Kind.EMOJI
          : WorkerIcon_Kind.IMAGE,
        value: worker.icon.value,
      })
    : undefined,
  agentProvider: agentProvider[worker.agentProvider],
  providers: worker.providers.map((provider) => agentProvider[provider]),
  capabilities: worker.capabilities as JsonObject,
  readiness: {
    available: DashboardWorker_Readiness.AVAILABLE,
    busy: DashboardWorker_Readiness.BUSY,
    offline: DashboardWorker_Readiness.OFFLINE,
    needs_attention: DashboardWorker_Readiness.NEEDS_ATTENTION,
    disabled: DashboardWorker_Readiness.DISABLED,
  }[worker.readiness],
  acceptingWork: worker.acceptingWork,
  readinessDetail: worker.readinessDetail ?? undefined,
  activeSessions: worker.activeSessions,
  availableSessions: worker.availableSessions,
  deviceId: worker.deviceId,
  ownerUserId: worker.ownerUserId,
  versions: worker.versions as Record<string, string>,
  state: {
    online: DashboardWorker_State.ONLINE,
    stale: DashboardWorker_State.STALE,
    disabled: DashboardWorker_State.DISABLED,
  }[worker.state],
  maxConcurrentSessions: worker.maxConcurrentSessions,
  lastHeartbeatAt: timestamp(worker.lastHeartbeatAt),
  createdAt: timestamp(worker.createdAt),
});

export const mobileExecutionPolicy = (policy: {
  readonly selectionMode: "any" | "allowlist";
  readonly defaultWorkerId: string | null;
  readonly allowedWorkerIds: readonly string[];
  readonly updatedAt: string | null;
}) => create(ProjectExecutionWorkerPolicySchema, {
  selectionMode: policy.selectionMode === "any"
    ? ProjectExecutionWorkerPolicy_SelectionMode.ANY
    : ProjectExecutionWorkerPolicy_SelectionMode.ALLOWLIST,
  defaultWorkerId: policy.defaultWorkerId ?? undefined,
  allowedWorkerIds: [...policy.allowedWorkerIds],
  updatedAt: policy.updatedAt ? timestamp(policy.updatedAt) : undefined,
});

export const mobileRunEvent = (
  event: ReturnType<typeof dashboardEventJson>,
) => create(RunEventSchema, {
  id: event.id,
  status: runStatus[event.status],
  workflowStage: event.workflowStage ?? undefined,
  detail: event.detail ?? undefined,
  actor: event.actor,
  actorName: event.actorName ?? undefined,
  occurredAt: timestamp(event.occurredAt),
  attempt: event.attempt,
  revision: event.revision,
  qaStatus: event.qaStatus ? qaStatus[event.qaStatus] : undefined,
  trackerState: event.trackerState ?? undefined,
  pullRequestUrls: event.pullRequestUrls as string[],
  targetSha: event.targetSha ?? undefined,
  recordedAt: timestamp(event.recordedAt),
});

export { agentProvider as mobileAgentProvider };
