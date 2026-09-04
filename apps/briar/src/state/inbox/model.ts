import { collapseLinkedAutoHuntSessions } from "../agent-sessions/model";
import type { StructuredAgentResult } from "../../lib/agent-result";
import {
  autoHuntWorkflowStageCatalog,
  type AutoHuntWorkflowStageId,
} from "../../lib/auto-hunt-contract";
import { inboxSessionMessageVersion } from "../../lib/inbox-session-version";
import type {
  AutoHuntSession,
  DashboardPayload,
  HuntRun,
  HuntStatus,
  Project,
} from "../../types";

/*
  The inbox, as arithmetic.

  Everything here is a pure function of what the store already holds: a team's
  board, this device's agent sessions, the account's read versions. The atoms in
  `atoms.ts` compose them, the sync hooks feed them and the actions write their
  results — none of which needs to know how a run becomes a message.

  They were the top half of `hooks/useInbox.ts`, which is why the merge rules
  read like storage rules: a message the local feed has already seen keeps its
  richer copy, and the account's read versions outlive the message they belong
  to.
*/

const builtInWorkflowStageIds = new Set<string>(
  autoHuntWorkflowStageCatalog.map((stage) => stage.id),
);

/**
 * What the inbox reads of a team's board.
 *
 * Named so the store publishes exactly these four projections rather than a
 * whole `DashboardPayload` — a `loadDashboard` response still satisfies it.
 */
export type InboxSource = Pick<
  DashboardPayload,
  "team" | "runs" | "conversationNotifications" | "channelNotifications"
>;

/** Run states that surface a message in the Inbox. Other transitions are too noisy. */
export const inboxIssueNotifyingStatuses = new Set<HuntStatus>([
  "paused",
  "completed",
  "failed",
  "blocked",
]);

const occurredAtOrAfter = (occurredAt: string, subscribedAt: string) => {
  const occurredTime = Date.parse(occurredAt);
  const subscribedTime = Date.parse(subscribedAt);
  return Number.isFinite(occurredTime) &&
    Number.isFinite(subscribedTime) &&
    occurredTime >= subscribedTime;
};

export type InboxIssueMessage = {
  id: string;
  kind: "issue";
  projectId: string;
  projectName: string;
  targetId: string;
  title: string;
  occurredAt: string;
  version: string;
  runNumber: number;
  status: HuntStatus;
  workflowStage: AutoHuntWorkflowStageId | null;
  /** Configured label for custom workflow stages; absent in older stored messages. */
  workflowStageLabel?: string | null;
  priority: number | null;
  structuredResult: StructuredAgentResult | null;
};

export type InboxSessionMessage = {
  id: string;
  kind: "session";
  projectId: string;
  projectName: string;
  targetId: string;
  title: string;
  occurredAt: string;
  version: string;
  status: "completed" | "failed";
  agentName: string | null;
  issueCount: number;
  error: string | null;
  summary: string | null;
  requiresAttention: boolean;
};

export type InboxConversationMessage = {
  id: string;
  kind: "conversation";
  projectId: string;
  projectName: string;
  targetId: string;
  messageId: string;
  rootMessageId: string;
  title: string;
  occurredAt: string;
  version: string;
  body: string;
  authorName: string;
  /** Sender photo URL or data URL. Absent on older stored messages. */
  authorImage?: string | null;
  /** Human-readable project issue key used by reply notifications. */
  issueKey?: string;
  reason: "mention" | "thread_reply" | "subscription";
};

export type InboxChannelMessage = {
  id: string;
  kind: "channel";
  projectId: string;
  projectName: string;
  targetId: string;
  channelId: string;
  channelName: string;
  messageId: string;
  rootMessageId: string;
  title: string;
  occurredAt: string;
  version: string;
  body: string;
  authorName: string;
  /** Sender photo URL or data URL. Absent on older stored messages. */
  authorImage?: string | null;
  reason: "mention" | "thread_reply" | "subscription";
};

export type InboxMessage =
  | InboxIssueMessage
  | InboxSessionMessage
  | InboxConversationMessage
  | InboxChannelMessage;
export type InboxMessageWithReadState = InboxMessage & {
  isUnread: boolean;
  /** Stable identity used to replace an existing system alert for this thread. */
  notificationGroupId?: string;
  /** Raw feed rows represented by this thread alert and their read versions. */
  groupedReadVersions?: Record<string, string>;
  /** Total and unread reply counts represented by this thread alert. */
  threadMessageCount?: number;
  threadUnreadCount?: number;
  /** True when any currently relevant reply needs attention. */
  threadRequiresAction?: boolean;
};
export type InboxCategory =
  | "urgent"
  | "action_required"
  | "important"
  | "activity";

export function inboxIssueMessageVersion(
  run: Pick<
    HuntRun,
    | "currentAttempt"
    | "currentRevision"
    | "status"
    | "workflowStage"
    | "lastEventAt"
    | "eventCount"
  >,
) {
  return `${run.currentAttempt}:${run.currentRevision}:${run.status}:${run.workflowStage ?? "none"}:${run.lastEventAt}:${run.eventCount}`;
}

export function buildCurrentInboxMessages(
  dashboard: InboxSource | null,
  sessions: readonly AutoHuntSession[],
  projects: readonly Project[],
  currentUserId?: string | null,
): InboxMessage[] {
  const projectNames = new Map(
    projects.map((project) => [project.id, project.name]),
  );
  const messages: InboxMessage[] = [];

  if (dashboard) {
    const issueKeyPrefix = dashboard.team.issueKeyPrefix;
    for (const run of dashboard.runs) {
      if (!inboxIssueNotifyingStatuses.has(run.status)) continue;
      if (currentUserId !== undefined) {
        const subscription = run.subscribers.find(
          (subscriber) => subscriber.userId === currentUserId,
        );
        if (
          !subscription ||
          !occurredAtOrAfter(run.lastEventAt, subscription.subscribedAt)
        ) continue;
      }
      messages.push({
        id: `issue:${run.id}`,
        kind: "issue",
        projectId: dashboard.team.id,
        projectName: dashboard.team.name,
        targetId: run.id,
        title: run.title,
        occurredAt: run.lastEventAt,
        version: inboxIssueMessageVersion(run),
        runNumber: run.runNumber,
        status: run.status,
        workflowStage: run.workflowStage,
        ...(run.workflowStage &&
        !builtInWorkflowStageIds.has(run.workflowStage)
          ? {
              workflowStageLabel:
                run.workflow.stages.find(
                  (stage) => stage.id === run.workflowStage,
                )?.label ?? run.workflowStage,
            }
          : {}),
        priority: run.priority,
        structuredResult: run.structuredResult,
      });
    }

    for (const notification of dashboard.conversationNotifications ?? []) {
      const notificationRun = dashboard.runs.find(
        (run) => run.id === notification.runId,
      );
      if (
        currentUserId !== undefined &&
        notificationRun !== undefined
      ) {
        const subscription = notificationRun.subscribers.find(
          (subscriber) => subscriber.userId === currentUserId,
        );
        if (
          !subscription ||
          !occurredAtOrAfter(notification.createdAt, subscription.subscribedAt)
        ) {
          continue;
        }
      }
      const runNumber = notificationRun?.runNumber;
      messages.push({
        id: `conversation:${notification.id}`,
        kind: "conversation",
        projectId: dashboard.team.id,
        projectName: dashboard.team.name,
        targetId: notification.runId,
        messageId: notification.id,
        rootMessageId: notification.rootMessageId,
        title: notification.runTitle,
        occurredAt: notification.createdAt,
        version: notification.id,
        body: notification.body,
        authorName: notification.author.name,
        authorImage: notification.author.image,
        ...(runNumber
          ? {
              issueKey: `${issueKeyPrefix}-${runNumber}`,
            }
          : {}),
        reason: notification.reason,
      });
    }

    for (const notification of dashboard.channelNotifications ?? []) {
      messages.push({
        id: `channel:${notification.id}`,
        kind: "channel",
        // Dashboard loading already scopes this projection to the active
        // project's organization. Retaining the active project keeps the
        // existing persisted Inbox/project filtering contract compatible.
        projectId: dashboard.team.id,
        projectName: dashboard.team.name,
        targetId: notification.channelId,
        channelId: notification.channelId,
        channelName: notification.channelName,
        messageId: notification.id,
        rootMessageId: notification.rootMessageId,
        title: notification.channelName,
        occurredAt: notification.createdAt,
        version: notification.id,
        body: notification.body,
        authorName: notification.author.name,
        authorImage: notification.author.image,
        reason: notification.reason,
      });
    }
  }

  for (const session of collapseLinkedAutoHuntSessions(sessions)) {
    if (session.status !== "completed" && session.status !== "failed") continue;
    if (!currentUserId || session.requestedByUserId !== currentUserId) continue;
    const finalEvent = [...session.events].reverse().find(
      (event) => event.type === session.status,
    );
    const occurredAt =
      session.completedAt ??
      finalEvent?.occurredAt ??
      session.startedAt;
    messages.push({
      id: `session:${session.id}`,
      kind: "session",
      projectId: session.projectId,
      projectName: projectNames.get(session.projectId) ?? "",
      targetId: session.id,
      title:
        session.request ??
        session.issues.map((issue) => issue.title).join(" · "),
      occurredAt,
      version: inboxSessionMessageVersion(session.status, occurredAt),
      status: session.status,
      agentName: session.agentName?.trim() || null,
      issueCount: session.issues.length,
      error: session.error,
      summary: session.summary,
      requiresAttention:
        session.status === "failed" ||
        session.issues.some((issue) =>
          ["blocked", "failed"].includes(issue.outcome),
        ),
    });
  }

  return messages;
}

export function mergeInboxMessages(
  stored: readonly InboxMessage[],
  current: readonly InboxMessage[],
  projects: readonly Project[],
) {
  const projectNames = new Map(
    projects.map((project) => [project.id, project.name]),
  );
  const merged = new Map(
    stored
      .filter((message) => projectNames.has(message.projectId))
      .map((message) => [
        message.id,
        {
          ...message,
          projectName: projectNames.get(message.projectId) ?? message.projectName,
        },
      ]),
  );

  for (const message of current) {
    if (!projectNames.has(message.projectId)) continue;
    merged.set(message.id, {
      ...message,
      projectName: projectNames.get(message.projectId) ?? message.projectName,
    });
  }

  return [...merged.values()].sort(
    (left, right) => {
      const occurredAtDifference =
        new Date(right.occurredAt).getTime() -
        new Date(left.occurredAt).getTime();
      return occurredAtDifference || left.id.localeCompare(right.id);
    },
  );
}

/**
 * Whether two feed snapshots say the same thing. It is the store's own change
 * detector: a merge that produced an equal list is not written, so a polling
 * tick that changed nothing notifies nobody and writes no storage record.
 */
export function inboxMessageSnapshotsEqual(
  left: readonly InboxMessage[],
  right: readonly InboxMessage[],
) {
  return left.length === right.length && left.every((message, index) => {
    const candidate = right[index];
    if (
      candidate === undefined ||
      message.kind !== candidate.kind ||
      message.id !== candidate.id ||
      message.version !== candidate.version ||
      message.projectId !== candidate.projectId ||
      message.projectName !== candidate.projectName ||
      message.targetId !== candidate.targetId ||
      message.title !== candidate.title ||
      message.occurredAt !== candidate.occurredAt
    ) {
      return false;
    }
    if (message.kind === "issue" && candidate.kind === "issue") {
      return message.runNumber === candidate.runNumber &&
        message.status === candidate.status &&
        message.workflowStage === candidate.workflowStage &&
        message.workflowStageLabel === candidate.workflowStageLabel &&
        message.priority === candidate.priority &&
        JSON.stringify(message.structuredResult) ===
          JSON.stringify(candidate.structuredResult);
    }
    if (message.kind === "session" && candidate.kind === "session") {
      return message.status === candidate.status &&
        message.agentName === candidate.agentName &&
        message.issueCount === candidate.issueCount &&
        message.error === candidate.error &&
        message.summary === candidate.summary &&
        message.requiresAttention === candidate.requiresAttention;
    }
    if (
      message.kind === "conversation" &&
      candidate.kind === "conversation"
    ) {
      return message.messageId === candidate.messageId &&
        message.rootMessageId === candidate.rootMessageId &&
        message.body === candidate.body &&
        message.authorName === candidate.authorName &&
        (message.authorImage ?? null) === (candidate.authorImage ?? null) &&
        message.issueKey === candidate.issueKey &&
        message.reason === candidate.reason;
    }
    if (message.kind === "channel" && candidate.kind === "channel") {
      return message.channelId === candidate.channelId &&
        message.channelName === candidate.channelName &&
        message.messageId === candidate.messageId &&
        message.rootMessageId === candidate.rootMessageId &&
        message.body === candidate.body &&
        message.authorName === candidate.authorName &&
        (message.authorImage ?? null) === (candidate.authorImage ?? null) &&
        message.reason === candidate.reason;
    }
    return false;
  });
}

/**
 * The organization feed intentionally sends compact summaries. A row whose
 * canonical read version is unchanged therefore keeps the richer copy the
 * selected team or the session log already produced, along with the active
 * channel association.
 */
export function keepStoredInboxFeedMessage(
  stored: InboxMessage | undefined,
  incoming: InboxMessage,
): InboxMessage {
  if (stored?.version !== incoming.version) return incoming;
  if (
    (stored.kind === "conversation" && incoming.kind === "conversation") ||
    (stored.kind === "channel" && incoming.kind === "channel")
  ) {
    return {
      ...stored,
      authorImage: stored.authorImage ?? incoming.authorImage ?? null,
    };
  }
  return stored;
}

export function isInboxMessageUnread(
  message: InboxMessage,
  readVersions: Record<string, string>,
) {
  return readVersions[message.id] !== message.version;
}

function inboxThreadGroupId(message: InboxMessageWithReadState) {
  if (message.kind === "conversation") {
    return `conversation-thread:${message.projectId}:${message.targetId}:${message.rootMessageId}`;
  }
  if (message.kind === "channel") {
    return `channel-thread:${message.targetId}:${message.rootMessageId}`;
  }
  return null;
}

function compareInboxMessagesNewestFirst(
  left: InboxMessageWithReadState,
  right: InboxMessageWithReadState,
) {
  const occurredAtDifference =
    new Date(right.occurredAt).getTime() -
    new Date(left.occurredAt).getTime();
  return occurredAtDifference || left.id.localeCompare(right.id);
}

/**
 * Collapses all notifications from one issue/channel thread into one row.
 * The row opens the oldest unread reply, while its timestamp and version track
 * the newest reply so subsequent updates replace the same system alert.
 */
export function collapseInboxThreadMessages(
  messages: readonly InboxMessageWithReadState[],
): InboxMessageWithReadState[] {
  const standalone: InboxMessageWithReadState[] = [];
  const threads = new Map<string, InboxMessageWithReadState[]>();

  for (const message of messages) {
    const groupId = inboxThreadGroupId(message);
    if (!groupId) {
      standalone.push(message);
      continue;
    }
    const group = threads.get(groupId) ?? [];
    group.push(message);
    threads.set(groupId, group);
  }

  const collapsed = [...threads].map(([notificationGroupId, group]) => {
    const chronological = [...group].sort((left, right) =>
      compareInboxMessagesNewestFirst(right, left)
    );
    const latest = chronological.at(-1)!;
    const unread = chronological.filter((message) => message.isUnread);
    const representative = unread[0] ?? latest;
    const relevant = unread.length > 0 ? unread : chronological;

    return {
      ...representative,
      occurredAt: latest.occurredAt,
      version: latest.version,
      isUnread: unread.length > 0,
      notificationGroupId,
      groupedReadVersions: Object.fromEntries(
        chronological.map((message) => [message.id, message.version]),
      ),
      threadMessageCount: chronological.length,
      threadUnreadCount: unread.length,
      threadRequiresAction: relevant.some(
        (message) =>
          (message.kind === "conversation" || message.kind === "channel") &&
          message.reason !== "subscription",
      ),
    } as InboxMessageWithReadState;
  });

  return [...standalone, ...collapsed].sort(compareInboxMessagesNewestFirst);
}

export function inboxNotificationIdentity(
  message: InboxMessage & { notificationGroupId?: string },
) {
  return message.notificationGroupId ?? message.id;
}

/** The stored rows one displayed message stands for, and their read versions. */
export function inboxMessageReadVersions(message: InboxMessageWithReadState) {
  return message.groupedReadVersions ?? { [message.id]: message.version };
}

export function mergeInboxReadVersions(
  local: Record<string, string>,
  remote: Record<string, string>,
) {
  return {
    ...local,
    ...remote,
  };
}

export function inboxReadVersionsToPush(
  local: Record<string, string>,
  remote: Record<string, string>,
) {
  const pending: Record<string, string> = {};
  for (const [messageId, version] of Object.entries(local)) {
    if (remote[messageId] !== version) {
      pending[messageId] = version;
    }
  }
  return pending;
}

export function classifyInboxMessage(
  message: InboxMessage,
): InboxCategory {
  if (message.kind === "channel") {
    // A channel subscription is scoped to one thread, so every later reply is
    // actionable for that subscriber just like a direct thread reply.
    return "action_required";
  }
  if (message.kind === "conversation") {
    return "threadRequiresAction" in message && message.threadRequiresAction
      ? "action_required"
      : message.reason === "subscription"
        ? "activity"
        : "action_required";
  }
  if (message.kind === "session") {
    return message.requiresAttention || message.status === "failed"
      ? "action_required"
      : "activity";
  }

  const result = message.structuredResult;
  if (
    result?.urgency === "immediate" ||
    result?.importance === "critical" ||
    (message.priority === 1 &&
      (message.status === "blocked" || message.status === "failed"))
  ) {
    return "urgent";
  }
  if (
    result?.humanActionRequired ||
    message.status === "blocked" ||
    message.status === "failed"
  ) {
    return "action_required";
  }
  if (
    result?.importance === "important" ||
    result?.impact === "project" ||
    result?.impact === "organization" ||
    (message.status === "completed" &&
      message.priority !== null &&
      message.priority <= 2)
  ) {
    return "important";
  }
  return "activity";
}

export function filterInboxMessagesByOrganization<T extends InboxMessage>(
  messages: readonly T[],
  projects: readonly Project[],
  organizationId: string | null,
): T[] {
  if (!organizationId) return [];
  const projectIds = new Set(
    projects
      .filter((project) => project.organizationId === organizationId)
      .map((project) => project.id),
  );
  return messages.filter((message) => projectIds.has(message.projectId));
}

/*
  What the system notifications and the conversation views read of a message
  list. They were `hooks/useInboxNotifications.ts`, whose hooks now sit beside
  this file; the arithmetic is here because the atoms need it too, and an atom
  module may not import a hook.
*/

export function findChangedInboxMessages(
  previousVersions: Record<string, string>,
  messages: readonly InboxMessageWithReadState[],
) {
  return messages.filter(
    (message) =>
      previousVersions[inboxNotificationIdentity(message)] !==
      message.version,
  );
}

export function inboxConversationSyncSignal(
  messages: readonly InboxMessageWithReadState[],
  kind: "channel" | "conversation",
) {
  return messages
    .filter((message) => message.kind === kind)
    .map((message) => `${message.id}:${message.version}`)
    .sort()
    .join("\n");
}

export function shouldSuppressInboxNotification(
  message: InboxMessageWithReadState,
  viewingChannelId: string | null,
  viewingChannelThreadRootMessageId: string | null,
  viewingIssueConversationRunId: string | null,
  appIsFocused: boolean,
) {
  if (!appIsFocused) return false;
  if (message.kind === "channel") {
    if (message.channelId !== viewingChannelId) return false;
    // Root messages are visible in the open channel. Thread replies are only
    // visible when that exact thread is open, so another thread in the same
    // channel must not suppress its notification.
    return message.rootMessageId === message.messageId ||
      message.rootMessageId === viewingChannelThreadRootMessageId;
  }
  return message.kind === "conversation" &&
    message.targetId === viewingIssueConversationRunId;
}

const sameReadVersions = (
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
) => {
  if (left === right) return true;
  if (!left || !right) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key]);
};

/** Whether two displayed rows would render identically. */
export function sameDisplayedInboxMessage(
  left: InboxMessageWithReadState,
  right: InboxMessageWithReadState,
) {
  return left.isUnread === right.isUnread &&
    left.notificationGroupId === right.notificationGroupId &&
    left.threadMessageCount === right.threadMessageCount &&
    left.threadUnreadCount === right.threadUnreadCount &&
    left.threadRequiresAction === right.threadRequiresAction &&
    sameReadVersions(left.groupedReadVersions, right.groupedReadVersions) &&
    inboxMessageSnapshotsEqual([left], [right]);
}

/**
 * The displayed list, reusing the object a message already had when nothing
 * about it changed. Row atoms compare by reference, so this is what makes a
 * tick that moved one run render one row.
 */
export function reuseInboxMessageIdentities(
  previous: readonly InboxMessageWithReadState[],
  next: readonly InboxMessageWithReadState[],
): InboxMessageWithReadState[] {
  if (previous.length === 0) return [...next];
  const previousById = new Map(
    previous.map((message) => [message.id, message]),
  );
  return next.map((message) => {
    const stored = previousById.get(message.id);
    return stored && sameDisplayedInboxMessage(stored, message)
      ? stored
      : message;
  });
}
