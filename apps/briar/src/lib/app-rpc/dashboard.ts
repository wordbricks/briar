import { createClient } from "@connectrpc/connect";
import {
  DashboardRun_DispatchMode,
  DashboardRun_ExecutionReadiness,
  DashboardRun_QaStatus,
  DashboardRun_Source,
  DashboardService,
  type ChannelNotification as ChannelNotificationMessage,
  type ConversationNotification as ConversationNotificationMessage,
  type DashboardRun as DashboardRunMessage,
  type RunEvent as RunEventMessage,
} from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import type {
  AutoHuntQaStatus,
  AutoHuntSource,
} from "../auto-hunt-contract";
import type {
  ChannelConversationNotification,
  DashboardDeltaPayload,
  DashboardPayload,
  HuntEvent,
  HuntRun,
  IssueConversationNotification,
} from "../../types";
import {
  appCallOptions,
  appTransport,
} from "./core";
import { dashboardWorkerFromProto } from "./fleet-mappers";
import {
  agentExecutionMetricsFromProto,
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
import {
  checkpointPositionFromProto as checkpointPosition,
  executionPolicyFromProto,
  projectSettingsFromProto,
  workflowCheckpointFromProto,
  workflowFromProto,
} from "./project-configuration-mappers";

const dashboardClient = appTransport
  ? createClient(DashboardService, appTransport)
  : undefined;

const requireDashboardClient = () => {
  if (!dashboardClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return dashboardClient;
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
  parent: run.parent === undefined
    ? null
    : {
        id: run.parent.id,
        runNumber: run.parent.runNumber,
        title: run.parent.title,
        status: runStatusFromProto(run.parent.status),
      },
  subIssues: run.subIssues.map((relation) => ({
    id: relation.id,
    runNumber: relation.runNumber,
    title: relation.title,
    status: runStatusFromProto(relation.status),
  })),
  relatedIssues: run.relatedIssues.map((relation) => ({
    id: relation.id,
    runNumber: relation.runNumber,
    title: relation.title,
    status: runStatusFromProto(relation.status),
  })),
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
  executionMetrics: agentExecutionMetricsFromProto(run.executionMetrics),
  resultReviews: run.resultReviews.map(resultReviewFromProto),
  pullRequestUrls: run.pullRequestUrls,
  targetSha: run.targetSha ?? null,
  sourceCreatedAt: optionalTimestamp(run.sourceCreatedAt),
  stagingQaStatus: qaStatus(run.stagingQaStatus),
  productionQaStatus: qaStatus(run.productionQaStatus),
  stagingQaDetail: run.stagingQaDetail ?? null,
  productionQaDetail: run.productionQaDetail ?? null,
  context: null,
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
  const response = await client.getDashboard(
    { projectId },
    appCallOptions(token, signal),
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
}

export async function syncDashboard(
  token: string,
  projectId: string,
  cursor: number,
  signal?: AbortSignal,
): Promise<DashboardDeltaPayload> {
  const client = requireDashboardClient();
  const response = await client.syncDashboard(
    { projectId, cursor: BigInt(cursor) },
    appCallOptions(token, signal),
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
    members: response.members?.values.map(organizationMemberFromProto),
    conversationNotifications: response.conversationNotifications?.values.map(
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
}

export async function listRunEventsRpc(
  token: string,
  projectId: string,
  runId: string,
): Promise<HuntEvent[]> {
  const client = requireDashboardClient();
  return (await client.listRunEvents(
    { projectId, runId },
    appCallOptions(token),
  )).events.map(runEventFromProto);
}
