import {
  autoHuntWorkflowStageCatalog,
  normalizeAutoHuntWorkflow,
} from "../../src/lib/auto-hunt-contract";
import type { StructuredAgentResult } from "../../src/lib/agent-result";
import { inboxSessionMessageVersion } from "../../src/lib/inbox-session-version";
import { parseStructuredResult } from "./agent-result-json";
import { decodeStoredProjectAgentSessionSummary } from "./project-request-contract";
import type {
  ChannelConversationNotificationRow,
  HuntRunRow,
  IssueConversationNotificationRow,
  ProjectAgentSessionSummaryRow,
} from "./db";
import type { ProjectRow } from "./project-repository";

const notifyingRunStatuses = new Set([
  "paused",
  "completed",
  "failed",
  "blocked",
]);
const builtInWorkflowStageIds = new Set<string>(
  autoHuntWorkflowStageCatalog.map((stage) => stage.id),
);
const inboxFeedMessageLimit = 2_000;

type InboxFeedProject = Pick<
  ProjectRow,
  "id" | "name" | "issue_key_prefix"
>;

type InboxFeedRun = Pick<
  HuntRunRow,
  | "id"
  | "run_number"
  | "title"
  | "status"
  | "paused_at"
  | "workflow_stage"
  | "workflow_snapshot_json"
  | "priority"
  | "structured_result_json"
  | "current_attempt"
  | "current_revision"
  | "last_event_at"
  | "event_count"
>;

type InboxFeedIssueNotification = Pick<
  IssueConversationNotificationRow,
  | "id"
  | "run_id"
  | "run_title"
  | "root_message_id"
  | "body"
  | "author_agent_provider"
  | "author_name"
  | "author_image"
  | "author_agent_image"
  | "notification_reason"
  | "created_at"
>;

type InboxFeedChannelNotification = Pick<
  ChannelConversationNotificationRow,
  | "id"
  | "channel_id"
  | "channel_name"
  | "root_message_id"
  | "body"
  | "author_agent_id"
  | "author_name"
  | "author_image"
  | "author_agent_image"
  | "notification_reason"
  | "created_at"
>;

type InboxFeedSessionSummary = Pick<
  ProjectAgentSessionSummaryRow,
  "session_id" | "summary_json" | "updated_at"
>;

export type InboxFeedProjectData = {
  project: InboxFeedProject;
  runs: readonly InboxFeedRun[];
  conversationNotifications: readonly InboxFeedIssueNotification[];
  sessionSummaries: readonly InboxFeedSessionSummary[];
};

export type InboxFeedMessage = {
  id: string;
  kind: "issue" | "conversation" | "channel" | "session";
  projectId: string;
  projectName: string;
  targetId: string;
  title: string;
  occurredAt: string;
  version: string;
  runNumber?: number;
  status?: "paused" | "completed" | "failed" | "blocked";
  workflowStage?: string | null;
  workflowStageLabel?: string | null;
  priority?: number | null;
  structuredResult?: StructuredAgentResult | null;
  messageId?: string;
  rootMessageId?: string;
  body?: string;
  authorName?: string;
  authorImage?: string | null;
  issueKey?: string;
  reason?: "mention" | "thread_reply" | "subscription";
  channelId?: string;
  channelName?: string;
  agentName?: string | null;
  issueCount?: number;
  error?: string | null;
  summary?: string | null;
  requiresAttention?: boolean;
};

type ParsedSession = {
  project: InboxFeedProject;
  id: string;
  agentName: string | null;
  parentSessionId: string | null;
  requestedByUserId: string | null;
  request: string | null;
  status: "completed" | "failed";
  issues: Array<{ title: string; outcome: string }>;
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  error: string | null;
  updatedAt: string;
  version: string;
};

function parseSession(
  project: InboxFeedProject,
  row: InboxFeedSessionSummary,
): ParsedSession | null {
  const payload = decodeStoredProjectAgentSessionSummary(row.summary_json);
  const status = payload.status;
  if (status !== "completed" && status !== "failed") return null;
  return {
    project,
    id: row.session_id,
    agentName: payload.agentName,
    parentSessionId: payload.parentSessionId,
    requestedByUserId: payload.requestedByUserId,
    request: payload.request,
    status,
    issues: payload.issues,
    startedAt: payload.startedAt,
    completedAt: payload.completedAt,
    summary: payload.summary,
    error: payload.error,
    updatedAt: payload.updatedAt,
    version: inboxSessionMessageVersion(
      status,
      payload.completedAt ?? payload.startedAt,
    ),
  };
}

function workflowStageLabel(run: InboxFeedRun) {
  if (!run.workflow_stage || builtInWorkflowStageIds.has(run.workflow_stage)) {
    return null;
  }
  try {
    return normalizeAutoHuntWorkflow(
      JSON.parse(run.workflow_snapshot_json),
    ).stages.find((stage) => stage.id === run.workflow_stage)?.label ??
      run.workflow_stage;
  } catch {
    return run.workflow_stage;
  }
}

function structuredResult(run: InboxFeedRun) {
  return parseStructuredResult(run.structured_result_json);
}

/**
 * Builds one organization-scoped feed without depending on whichever project a
 * client currently has selected. Message IDs and versions deliberately match
 * the existing desktop and iOS builders so account read state stays portable.
 */
export function buildInboxFeedMessages(
  projectData: readonly InboxFeedProjectData[],
  channelNotifications: readonly InboxFeedChannelNotification[],
  currentUserId: string,
): InboxFeedMessage[] {
  const messages: InboxFeedMessage[] = [];
  const parsedSessions: ParsedSession[] = [];

  for (
    const {
      project,
      runs,
      conversationNotifications,
      sessionSummaries,
    } of projectData
  ) {
    const runNumbers = new Map(runs.map((run) => [run.id, run.run_number]));
    for (const run of runs) {
      const status = run.paused_at ? "paused" : run.status;
      if (!notifyingRunStatuses.has(status)) continue;
      const stageLabel = workflowStageLabel(run);
      const message = {
        id: `issue:${run.id}`,
        kind: "issue" as const,
        projectId: project.id,
        projectName: project.name,
        targetId: run.id,
        title: run.title,
        occurredAt: run.last_event_at,
        version: `${run.current_attempt}:${run.current_revision}:${status}:${run.workflow_stage ?? "none"}:${run.last_event_at}:${run.event_count}`,
        runNumber: run.run_number,
        status: status as InboxFeedMessage["status"],
        workflowStage: run.workflow_stage,
      };
      if (stageLabel) Object.assign(message, { workflowStageLabel: stageLabel });
      Object.assign(message, {
        priority: run.priority,
        structuredResult: structuredResult(run),
      });
      messages.push(message);
    }

    for (const notification of conversationNotifications) {
      const runNumber = runNumbers.get(notification.run_id);
      const message = {
        id: `conversation:${notification.id}`,
        kind: "conversation" as const,
        projectId: project.id,
        projectName: project.name,
        targetId: notification.run_id,
        messageId: notification.id,
        rootMessageId: notification.root_message_id,
        title: notification.run_title,
        occurredAt: notification.created_at,
        version: notification.id,
        body: notification.body,
        authorName: notification.author_name ?? "",
        authorImage: notification.author_agent_provider
          ? notification.author_agent_image ?? null
          : notification.author_image ?? null,
      };
      if (runNumber) {
        Object.assign(message, {
          issueKey: `${project.issue_key_prefix.trim() || "AH"}-${runNumber}`,
        });
      }
      Object.assign(message, {
        reason: notification.notification_reason,
      });
      messages.push(message);
    }

    for (const row of sessionSummaries) {
      const session = parseSession(project, row);
      if (session?.requestedByUserId === currentUserId) {
        parsedSessions.push(session);
      }
    }
  }

  const linkedParentSessionIds = new Set(
    parsedSessions.flatMap((session) =>
      session.parentSessionId ? [session.parentSessionId] : [],
    ),
  );
  for (const session of parsedSessions) {
    if (linkedParentSessionIds.has(session.id)) continue;
    const occurredAt = session.completedAt ?? session.updatedAt;
    messages.push({
      id: `session:${session.id}`,
      kind: "session",
      projectId: session.project.id,
      projectName: session.project.name,
      targetId: session.id,
      title:
        session.request?.trim() ||
        session.issues.map((issue) => issue.title).join(" · ") ||
        "Agent session",
      occurredAt,
      version: session.version,
      status: session.status,
      agentName: session.agentName,
      issueCount: session.issues.length,
      error: session.error,
      summary: session.summary,
      requiresAttention:
        session.status === "failed" ||
        session.issues.some((issue) =>
          issue.outcome === "blocked" || issue.outcome === "failed"
        ),
    });
  }

  // Channel messages belong to an organization rather than a project. A
  // stable first-project association preserves the existing navigation and
  // project-filter contract while the feed itself remains organization scoped.
  const channelProject = projectData[0]?.project;
  if (channelProject) {
    for (const notification of channelNotifications) {
      messages.push({
        id: `channel:${notification.id}`,
        kind: "channel",
        projectId: channelProject.id,
        projectName: channelProject.name,
        targetId: notification.channel_id,
        channelId: notification.channel_id,
        channelName: notification.channel_name,
        messageId: notification.id,
        rootMessageId: notification.root_message_id,
        title: notification.channel_name,
        occurredAt: notification.created_at,
        version: notification.id,
        body: notification.body,
        authorName: notification.author_name ?? "",
        authorImage: notification.author_agent_id
          ? notification.author_agent_image ?? null
          : notification.author_image ?? null,
        reason: notification.notification_reason,
      });
    }
  }

  return messages
    .sort(
      (left, right) => {
        const occurredAtDifference =
          new Date(right.occurredAt).getTime() -
          new Date(left.occurredAt).getTime();
        return occurredAtDifference || left.id.localeCompare(right.id);
      },
    )
    .slice(0, inboxFeedMessageLimit);
}
