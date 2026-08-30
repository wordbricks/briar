import { createClient } from "@connectrpc/connect";
import {
  DashboardRun_DispatchMode,
  DashboardRun_ExecutionReadiness,
  DashboardRun_QaStatus,
  DashboardRun_Source,
  DashboardService,
  DashboardWorker_Readiness,
  DashboardWorker_State,
  ProjectExecutionWorkerPolicy_SelectionMode,
  WorkerIcon_Kind,
  WorkflowCheckpoint_Position,
  type AutoHuntWorkflow as AutoHuntWorkflowMessage,
  type ChannelNotification as ChannelNotificationMessage,
  type ConversationNotification as ConversationNotificationMessage,
  type DashboardRun as DashboardRunMessage,
  type DashboardWorker as DashboardWorkerMessage,
  type ProjectExecutionWorkerPolicy as ProjectExecutionWorkerPolicyMessage,
  type ProjectSettings as ProjectSettingsMessage,
  type RunEvent as RunEventMessage,
  type WorkflowCheckpointSpec,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/dashboard_pb";
import {
  autoHuntRequirementKinds,
  normalizeAutoHuntWorkflow,
  type AutoHuntQaStatus,
  type AutoHuntSource,
  type AutoHuntWorkflow,
  type AutoHuntWorkflowCheckpoint,
  type AutoHuntWorkflowRequirement,
} from "../auto-hunt-contract";
import type {
  ChannelConversationNotification,
  DashboardDeltaPayload,
  DashboardPayload,
  ExecutionWorker,
  HuntEvent,
  HuntRun,
  IssueConversationNotification,
  ProjectExecutionWorkerPolicy,
  ProjectSettings,
} from "../../types";
import {
  mobileCallOptions,
  mobileRpc,
  mobileTransport,
} from "./core";
import {
  agentProviderFromProto,
  issueAttachmentFromProto,
  issueDifficultyFromProto,
  messageAuthorFromProto,
  notificationReasonFromProto,
  optionalAgentProviderFromProto,
  optionalTimestamp,
  organizationMemberFromProto,
  relatedMessageFromProto,
  requiredMessage,
  requiredTimestamp,
  resultReviewFromProto,
  runStatusFromProto,
  safeNumber,
  structuredResultFromProto,
} from "./mappers";
import { projectFromMessage } from "./project";

const dashboardClient = mobileTransport
  ? createClient(DashboardService, mobileTransport)
  : undefined;

const requireDashboardClient = () => {
  if (!dashboardClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return dashboardClient;
};

const checkpointPosition = (
  value: WorkflowCheckpoint_Position,
): "before" | "after" => {
  switch (value) {
    case WorkflowCheckpoint_Position.BEFORE:
      return "before";
    case WorkflowCheckpoint_Position.AFTER:
      return "after";
    default:
      throw new Error(`Unknown checkpoint position: ${value}`);
  }
};

const workflowCheckpointFromProto = (
  value: WorkflowCheckpointSpec,
): AutoHuntWorkflowCheckpoint => ({
  key: value.key,
  stage: value.stage,
  position: checkpointPosition(value.position),
});

const workflowRequirementFromProto = (
  value: AutoHuntWorkflowMessage["requirements"][number],
): AutoHuntWorkflowRequirement => {
  if (!autoHuntRequirementKinds.includes(
    value.kind as AutoHuntWorkflowRequirement["kind"],
  )) {
    throw new Error(`Unknown workflow requirement kind: ${value.kind}`);
  }
  return {
    id: value.id,
    label: value.label,
    kind: value.kind as AutoHuntWorkflowRequirement["kind"],
    tool: value.tool,
    reason: value.reason,
  };
};

const workflowFromProto = (value: AutoHuntWorkflowMessage): AutoHuntWorkflow => {
  if (value.version !== 2) {
    throw new Error(`Unsupported workflow version: ${value.version}`);
  }
  const execution = requiredMessage(value.execution, "workflow.execution");
  const completion = requiredMessage(value.completion, "workflow.completion");
  return normalizeAutoHuntWorkflow({
    version: 2,
    requirements: value.requirements.map(workflowRequirementFromProto),
    stages: value.stages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      required: stage.required,
      evidence: stage.evidence.length === 0 ? undefined : stage.evidence,
      checks: stage.checks.length === 0 ? undefined : stage.checks,
    })),
    execution: {
      checkpoints: execution.checkpoints.map(workflowCheckpointFromProto),
    },
    completion: { requiredStages: completion.requiredStages },
  });
};

const projectSettingsFromProto = (
  value: ProjectSettingsMessage,
): ProjectSettings => {
  const linear = requiredMessage(value.linear, "projectSettings.linear");
  const checkpointPolicy = value.checkpointPolicy;
  return {
    velenOrg: value.velenOrg ?? null,
    dataSource: value.dataSource ?? null,
    linear: {
      enabled: linear.enabled,
      source: linear.source ?? null,
      teamKey: linear.teamKey ?? null,
    },
    githubRepositoryId: value.githubRepositoryId === undefined
      ? null
      : safeNumber(value.githubRepositoryId, "settings.githubRepositoryId"),
    githubRepository: value.githubRepository ?? null,
    workflow: workflowFromProto(
      requiredMessage(value.workflow, "projectSettings.workflow"),
    ),
    checkpointPolicy: checkpointPolicy === undefined
      ? undefined
      : {
          availableBoundaries: checkpointPolicy.availableBoundaries.map(
            (boundary) => ({
              stage: boundary.stage,
              stageLabel: boundary.stageLabel,
              position: checkpointPosition(boundary.position),
            }),
          ),
          projectMandatory: checkpointPolicy.projectMandatory.map(
            workflowCheckpointFromProto,
          ),
          userDefaults: checkpointPolicy.userDefaults.map(
            workflowCheckpointFromProto,
          ),
          effective: checkpointPolicy.effective.map(
            workflowCheckpointFromProto,
          ),
          projectRevision: safeNumber(
            checkpointPolicy.projectRevision,
            "checkpointPolicy.projectRevision",
          ),
          userRevision: safeNumber(
            checkpointPolicy.userRevision,
            "checkpointPolicy.userRevision",
          ),
        },
  };
};

const runSource = (value: DashboardRun_Source): AutoHuntSource => {
  switch (value) {
    case DashboardRun_Source.ISSUE:
      return "issue";
    case DashboardRun_Source.ERROR:
      return "error";
    case DashboardRun_Source.FEEDBACK:
      return "feedback";
    default:
      throw new Error(`Unknown run source: ${value}`);
  }
};

const qaStatus = (
  value: DashboardRun_QaStatus | undefined,
): AutoHuntQaStatus | null => {
  switch (value) {
    case undefined:
      return null;
    case DashboardRun_QaStatus.PENDING:
      return "pending";
    case DashboardRun_QaStatus.PASSED:
      return "passed";
    case DashboardRun_QaStatus.SKIPPED:
      return "skipped";
    default:
      throw new Error(`Unknown QA status: ${value}`);
  }
};

const executionReadiness = (
  value: DashboardRun_ExecutionReadiness | undefined,
): HuntRun["executionReadiness"] => {
  switch (value) {
    case undefined:
      return undefined;
    case DashboardRun_ExecutionReadiness.READY:
      return "ready";
    case DashboardRun_ExecutionReadiness.WAITING:
      return "waiting";
    default:
      throw new Error(`Unknown execution readiness: ${value}`);
  }
};

const dispatchMode = (
  value: DashboardRun_DispatchMode | undefined,
): HuntRun["dispatchMode"] => {
  switch (value) {
    case undefined:
      return null;
    case DashboardRun_DispatchMode.ANY:
      return "any";
    case DashboardRun_DispatchMode.SPECIFIC:
      return "specific";
    default:
      throw new Error(`Unknown dispatch mode: ${value}`);
  }
};

const nullableTokenCount = (
  value: bigint | undefined,
  field: string,
): number | null => value === undefined ? null : safeNumber(value, field);

const dashboardRunFromProto = (run: DashboardRunMessage): HuntRun => ({
  id: run.id,
  runNumber: run.runNumber,
  currentAttempt: run.currentAttempt,
  currentRevision: run.currentRevision,
  source: runSource(run.source),
  sourceKey: run.sourceKey,
  title: run.title,
  status: runStatusFromProto(run.status),
  workflowStage: run.workflowStage ?? null,
  workflow: workflowFromProto(requiredMessage(run.workflow, "run.workflow")),
  progress: run.progress,
  pausedAt: optionalTimestamp(run.pausedAt),
  resumeRequestedAt: optionalTimestamp(run.resumeRequestedAt),
  waitingCheckpoint: run.waitingCheckpoint === undefined
    ? null
    : {
        key: run.waitingCheckpoint.key,
        revision: run.waitingCheckpoint.revision,
      },
  checkpoint: run.checkpoint === undefined
    ? null
    : {
        key: run.checkpoint.key,
        stage: run.checkpoint.stage,
        stageLabel: run.checkpoint.stageLabel,
        position: checkpointPosition(run.checkpoint.position),
        attempt: run.checkpoint.attempt,
        revision: run.checkpoint.revision,
        reachedAt: optionalTimestamp(run.checkpoint.reachedAt),
        nextStage: run.checkpoint.nextStage ?? null,
        nextStageLabel: run.checkpoint.nextStageLabel ?? null,
        terminalReviewOnly: run.checkpoint.terminalReviewOnly,
      },
  issueCheckpoints: run.issueCheckpoints.map(workflowCheckpointFromProto),
  fullAuto: run.fullAuto,
  detail: run.detail ?? null,
  priority: run.priority ?? null,
  difficulty: issueDifficultyFromProto(run.difficulty),
  assigneeUserId: run.assigneeUserId ?? null,
  createdByUserId: run.createdByUserId ?? null,
  subscribers: run.subscribers.map((subscriber) => ({
    userId: subscriber.userId,
    subscribedAt: requiredTimestamp(
      subscriber.subscribedAt,
      "subscriber.subscribedAt",
    ),
  })),
  repository: run.repository,
  branch: run.branch ?? null,
  commitSha: run.commitSha ?? null,
  tracker: run.tracker === undefined
    ? null
    : {
        provider: run.tracker.provider,
        issueId: run.tracker.issueId ?? null,
        identifier: run.tracker.identifier ?? null,
        url: run.tracker.url ?? null,
        state: run.tracker.state ?? null,
      },
  issueDescription: run.issueDescription ?? null,
  relatedMessage: run.relatedMessage === undefined
    ? null
    : relatedMessageFromProto(run.relatedMessage),
  attachments: run.attachments.map(issueAttachmentFromProto),
  prerequisites: run.prerequisites.map((dependency) => ({
    id: dependency.id,
    runNumber: dependency.runNumber,
    title: dependency.title,
    status: runStatusFromProto(dependency.status),
  })),
  dependents: run.dependents.map((dependency) => ({
    id: dependency.id,
    runNumber: dependency.runNumber,
    title: dependency.title,
    status: runStatusFromProto(dependency.status),
  })),
  executionReadiness: executionReadiness(run.executionReadiness),
  waitingOnPrerequisiteCount: run.waitingOnPrerequisiteCount,
  resultSummary: run.resultSummary ?? null,
  structuredResult: structuredResultFromProto(run.structuredResult),
  executionMetrics: run.executionMetrics === undefined
    ? null
    : {
        inputTokens: nullableTokenCount(
          run.executionMetrics.inputTokens,
          "executionMetrics.inputTokens",
        ),
        outputTokens: nullableTokenCount(
          run.executionMetrics.outputTokens,
          "executionMetrics.outputTokens",
        ),
        cacheReadTokens: nullableTokenCount(
          run.executionMetrics.cacheReadTokens,
          "executionMetrics.cacheReadTokens",
        ),
        cacheWriteTokens: nullableTokenCount(
          run.executionMetrics.cacheWriteTokens,
          "executionMetrics.cacheWriteTokens",
        ),
        reasoningOutputTokens: nullableTokenCount(
          run.executionMetrics.reasoningOutputTokens,
          "executionMetrics.reasoningOutputTokens",
        ),
        totalTokens: nullableTokenCount(
          run.executionMetrics.totalTokens,
          "executionMetrics.totalTokens",
        ),
        durationMs: safeNumber(
          run.executionMetrics.durationMs,
          "executionMetrics.durationMs",
        ),
      },
  resultReviews: run.resultReviews.map(resultReviewFromProto),
  pullRequestUrls: run.pullRequestUrls,
  targetSha: run.targetSha ?? null,
  sourceCreatedAt: optionalTimestamp(run.sourceCreatedAt),
  stagingQaStatus: qaStatus(run.stagingQaStatus),
  productionQaStatus: qaStatus(run.productionQaStatus),
  stagingQaDetail: run.stagingQaDetail ?? null,
  productionQaDetail: run.productionQaDetail ?? null,
  context: run.context ?? null,
  claimedBy: run.claimedBy ?? null,
  claimedAt: optionalTimestamp(run.claimedAt),
  leaseExpiresAt: optionalTimestamp(run.leaseExpiresAt),
  claimAttempts: run.claimAttempts,
  agentId: run.agentId ?? null,
  preferredProvider: optionalAgentProviderFromProto(run.preferredProvider),
  preferredModel: run.preferredModel ?? null,
  preferredEffort: run.preferredEffort ?? null,
  requestedProvider: optionalAgentProviderFromProto(run.requestedProvider),
  requestedModel: run.requestedModel ?? null,
  requestedEffort: run.requestedEffort ?? null,
  requestedWorkerId: run.requestedWorkerId ?? null,
  requestedByUserId: run.requestedByUserId ?? null,
  dispatchMode: dispatchMode(run.dispatchMode),
  dispatchedAt: optionalTimestamp(run.dispatchedAt),
  workerId: run.workerId ?? null,
  startedAt: requiredTimestamp(run.startedAt, "run.startedAt"),
  updatedAt: requiredTimestamp(run.updatedAt, "run.updatedAt"),
  completedAt: optionalTimestamp(run.completedAt),
  lastEventAt: requiredTimestamp(run.lastEventAt, "run.lastEventAt"),
  eventCount: run.eventCount,
});

const workerState = (
  value: DashboardWorker_State,
): ExecutionWorker["state"] => {
  switch (value) {
    case DashboardWorker_State.ONLINE:
      return "online";
    case DashboardWorker_State.STALE:
      return "stale";
    case DashboardWorker_State.DISABLED:
      return "disabled";
    default:
      throw new Error(`Unknown worker state: ${value}`);
  }
};

const workerReadiness = (
  value: DashboardWorker_Readiness,
): ExecutionWorker["readiness"] => {
  switch (value) {
    case DashboardWorker_Readiness.AVAILABLE:
      return "available";
    case DashboardWorker_Readiness.BUSY:
      return "busy";
    case DashboardWorker_Readiness.OFFLINE:
      return "offline";
    case DashboardWorker_Readiness.NEEDS_ATTENTION:
      return "needs_attention";
    case DashboardWorker_Readiness.DISABLED:
      return "disabled";
    default:
      throw new Error(`Unknown worker readiness: ${value}`);
  }
};

const dashboardWorkerFromProto = (
  worker: DashboardWorkerMessage,
): ExecutionWorker => ({
  id: worker.id,
  deviceId: worker.deviceId,
  ownerUserId: worker.ownerUserId,
  label: worker.label,
  icon: worker.icon === undefined
    ? null
    : {
        type: worker.icon.kind === WorkerIcon_Kind.EMOJI
          ? "emoji"
          : worker.icon.kind === WorkerIcon_Kind.IMAGE
            ? "image"
            : (() => {
                throw new Error(`Unknown worker icon kind: ${worker.icon.kind}`);
              })(),
        value: worker.icon.value,
      },
  agentProvider: agentProviderFromProto(worker.agentProvider),
  providers: worker.providers.map(agentProviderFromProto),
  versions: worker.versions,
  state: workerState(worker.state),
  readiness: workerReadiness(worker.readiness),
  acceptingWork: worker.acceptingWork,
  readinessDetail: worker.readinessDetail ?? null,
  capabilities: requiredMessage(worker.capabilities, "worker.capabilities"),
  maxConcurrentSessions: worker.maxConcurrentSessions,
  activeSessions: worker.activeSessions,
  availableSessions: worker.availableSessions,
  lastHeartbeatAt: requiredTimestamp(
    worker.lastHeartbeatAt,
    "worker.lastHeartbeatAt",
  ),
  createdAt: requiredTimestamp(worker.createdAt, "worker.createdAt"),
});

const executionPolicyFromProto = (
  value: ProjectExecutionWorkerPolicyMessage | undefined,
): ProjectExecutionWorkerPolicy | undefined => {
  if (value === undefined) return undefined;
  const selectionMode = (() => {
    switch (value.selectionMode) {
      case ProjectExecutionWorkerPolicy_SelectionMode.ANY:
        return "any" as const;
      case ProjectExecutionWorkerPolicy_SelectionMode.ALLOWLIST:
        return "allowlist" as const;
      default:
        throw new Error(`Unknown worker selection mode: ${value.selectionMode}`);
    }
  })();
  return {
    selectionMode,
    defaultWorkerId: value.defaultWorkerId ?? null,
    allowedWorkerIds: value.allowedWorkerIds,
    updatedAt: optionalTimestamp(value.updatedAt),
  };
};

const conversationNotificationFromProto = (
  value: ConversationNotificationMessage,
): IssueConversationNotification => ({
  id: value.id,
  runId: value.runId,
  runTitle: value.runTitle,
  rootMessageId: value.rootMessageId,
  body: value.body,
  author: messageAuthorFromProto(
    requiredMessage(value.author, "conversationNotification.author"),
  ),
  reason: notificationReasonFromProto(value.reason),
  createdAt: requiredTimestamp(value.createdAt, "notification.createdAt"),
});

const channelNotificationFromProto = (
  value: ChannelNotificationMessage,
): ChannelConversationNotification => ({
  id: value.id,
  channelId: value.channelId,
  channelName: value.channelName,
  rootMessageId: value.rootMessageId,
  body: value.body,
  author: messageAuthorFromProto(
    requiredMessage(value.author, "channelNotification.author"),
  ),
  reason: notificationReasonFromProto(value.reason),
  createdAt: requiredTimestamp(value.createdAt, "notification.createdAt"),
});

const runEventFromProto = (event: RunEventMessage): HuntEvent => ({
  id: event.id,
  attempt: event.attempt,
  revision: event.revision,
  status: runStatusFromProto(event.status),
  workflowStage: event.workflowStage ?? null,
  detail: event.detail ?? null,
  actor: event.actor,
  actorName: event.actorName ?? null,
  qaStatus: qaStatus(event.qaStatus),
  trackerState: event.trackerState ?? null,
  pullRequestUrls: event.pullRequestUrls,
  targetSha: event.targetSha ?? null,
  occurredAt: requiredTimestamp(event.occurredAt, "runEvent.occurredAt"),
  recordedAt: requiredTimestamp(event.recordedAt, "runEvent.recordedAt"),
});

export async function getDashboard(
  token: string,
  projectId: string,
  signal?: AbortSignal,
): Promise<DashboardPayload> {
  const client = requireDashboardClient();
  return mobileRpc(async () => {
    const response = await client.getDashboard(
      { projectId },
      mobileCallOptions(token, signal),
    );
    return {
      project: projectFromMessage(
        requiredMessage(response.project, "dashboard.project"),
      ),
      settings: projectSettingsFromProto(
        requiredMessage(response.settings, "dashboard.settings"),
      ),
      runs: response.runs.map(dashboardRunFromProto),
      workers: response.workers.map(dashboardWorkerFromProto),
      organizationProviders: response.organizationProviders.map(
        agentProviderFromProto,
      ),
      executionPolicy: executionPolicyFromProto(response.executionPolicy),
      members: response.members.map(organizationMemberFromProto),
      conversationNotifications: response.conversationNotifications.map(
        conversationNotificationFromProto,
      ),
      channelNotifications: response.channelNotifications.map(
        channelNotificationFromProto,
      ),
      cursor: safeNumber(response.cursor, "dashboard.cursor"),
      generatedAt: requiredTimestamp(
        response.generatedAt,
        "dashboard.generatedAt",
      ),
    };
  });
}

export async function syncDashboard(
  token: string,
  projectId: string,
  cursor: number,
  signal?: AbortSignal,
): Promise<DashboardDeltaPayload> {
  const client = requireDashboardClient();
  return mobileRpc(async () => {
    const response = await client.syncDashboard(
      { projectId, cursor: BigInt(cursor) },
      mobileCallOptions(token, signal),
    );
    return {
      cursor: safeNumber(response.cursor, "dashboard.cursor"),
      hasMore: response.hasMore,
      reset: response.reset,
      runs: response.runs.map(dashboardRunFromProto),
      deletedRunIds: response.deletedRunIds,
      project: response.project === undefined
        ? undefined
        : projectFromMessage(response.project),
      settings: response.settings === undefined
        ? undefined
        : projectSettingsFromProto(response.settings),
      workers: response.workers.map(dashboardWorkerFromProto),
      organizationProviders: response.organizationProviders.map(
        agentProviderFromProto,
      ),
      executionPolicy: executionPolicyFromProto(response.executionPolicy),
      members: response.members.map(organizationMemberFromProto),
      conversationNotifications: response.conversationNotifications.map(
        conversationNotificationFromProto,
      ),
      channelNotifications: response.channelNotifications.map(
        channelNotificationFromProto,
      ),
      generatedAt: requiredTimestamp(
        response.generatedAt,
        "dashboard.generatedAt",
      ),
    };
  });
}

export async function listRunEventsRpc(
  token: string,
  projectId: string,
  runId: string,
): Promise<HuntEvent[]> {
  const client = requireDashboardClient();
  return mobileRpc(async () =>
    (await client.listRunEvents(
      { projectId, runId },
      mobileCallOptions(token),
    )).events.map(runEventFromProto)
  );
}
