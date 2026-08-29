import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collapseLinkedAutoHuntSessions,
  type AutoHuntSession,
} from "./useAutoHuntSessions";
import type { DashboardPayload, HuntRun, HuntStatus, Project } from "../types";
import {
  autoHuntWorkflowStageCatalog,
  type AutoHuntWorkflowStageId,
} from "../lib/auto-hunt-contract";
import type { StructuredAgentResult } from "../lib/agent-result";
import {
  inboxSessionMessageVersion,
  isCanonicalInboxSessionVersion,
} from "../lib/inbox-session-version";
import {
  deleteInboxReadState,
  loadInboxFeed,
  loadInboxReadStates,
  saveInboxReadStates,
  type InboxFeedSyncState,
} from "../lib/api";
import { startDashboardPolling } from "../lib/dashboard-polling";
import {
  INBOX_REALTIME_DEBOUNCE_MS,
  INBOX_REALTIME_FALLBACK_MS,
} from "../lib/channel-realtime";
import type { RealtimeTransport } from "../lib/realtime-transport";

const storagePrefix = "briar.inbox.v1";
const builtInWorkflowStageIds = new Set<string>(
  autoHuntWorkflowStageCatalog.map((stage) => stage.id),
);

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

type InboxStorage = {
  messages: InboxMessage[];
  readVersions: Record<string, string>;
};

type InboxState = InboxStorage & {
  storageKey: string;
};

type InboxReadSyncGeneration = {
  id: number;
  active: boolean;
  storageKey: string;
  token: string;
  userId: string;
  remoteReadVersions: Record<string, string>;
  pendingPush: Record<string, string>;
  inFlightPush: Record<string, string>;
  pushInFlight: boolean;
  pushQueueRevision: number;
  remoteMutationGeneration: number;
  syncInFlight: boolean;
  syncRequested: boolean;
};

type InboxReadSyncIdentity = Pick<
  InboxReadSyncGeneration,
  "storageKey" | "token" | "userId"
>;

type InboxFeedSyncIdentity = {
  scope: string;
  token: string;
};

export type InboxSyncDependencies = {
  deleteReadState?: typeof deleteInboxReadState;
  loadFeed: typeof loadInboxFeed;
  loadReadStates: typeof loadInboxReadStates;
  saveReadStates: typeof saveInboxReadStates;
  startPolling: typeof startDashboardPolling;
};

export const defaultInboxSyncDependencies = {
  deleteReadState: deleteInboxReadState,
  loadFeed: loadInboxFeed,
  loadReadStates: loadInboxReadStates,
  saveReadStates: saveInboxReadStates,
  startPolling: startDashboardPolling,
} satisfies InboxSyncDependencies;

const emptyStorage = (): InboxStorage => ({ messages: [], readVersions: {} });

export function buildCurrentInboxMessages(
  dashboard: DashboardPayload | null,
  sessions: AutoHuntSession[],
  projects: Project[],
  currentUserId?: string | null,
): InboxMessage[] {
  const projectNames = new Map(
    projects.map((project) => [project.id, project.name]),
  );
  const messages: InboxMessage[] = [];

  if (dashboard) {
    const issueKeyPrefix = dashboard.project.issueKeyPrefix?.trim() || "AH";
    for (const run of dashboard.runs) {
      if (!inboxIssueNotifyingStatuses.has(run.status)) continue;
      if (currentUserId !== undefined && run.subscribers !== undefined) {
        const subscription = run.subscribers?.find(
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
        projectId: dashboard.project.id,
        projectName: dashboard.project.name,
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
        notificationRun?.subscribers !== undefined
      ) {
        const subscription = notificationRun?.subscribers?.find(
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
        projectId: dashboard.project.id,
        projectName: dashboard.project.name,
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
        projectId: dashboard.project.id,
        projectName: dashboard.project.name,
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
  stored: InboxMessage[],
  current: InboxMessage[],
  projects: Project[],
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

function inboxMessageSnapshotsEqual(
  left: InboxMessage[],
  right: InboxMessage[],
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

function keepStoredInboxFeedMessage(
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
  messages: InboxMessageWithReadState[],
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

function inboxMessageReadVersions(message: InboxMessageWithReadState) {
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
  messages: T[],
  projects: Project[],
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

function readInboxStorage(storageKey: string): InboxStorage {
  if (typeof window === "undefined") return emptyStorage();
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
    const messages = (Array.isArray(value.messages)
      ? value.messages.filter(
          (message: unknown) =>
            Boolean(message) &&
            typeof message === "object" &&
            typeof (message as { id?: unknown }).id === "string",
        )
      : []) as InboxMessage[];
    const readVersions: Record<string, string> =
      value.readVersions &&
        typeof value.readVersions === "object" &&
        !Array.isArray(value.readVersions)
        ? { ...value.readVersions }
        : {};

    const normalizedMessages = messages.map((message) => {
      if (message.kind !== "session") return message;
      const version = inboxSessionMessageVersion(
        message.status,
        message.occurredAt,
      );
      return message.version === version ? message : { ...message, version };
    });

    return {
      messages: normalizedMessages,
      readVersions: normalizeInboxReadVersions(
        normalizedMessages,
        readVersions,
      ),
    };
  } catch {
    return emptyStorage();
  }
}

function normalizeInboxReadVersions(
  messages: InboxMessage[],
  readVersions: Record<string, string>,
) {
  const normalized = { ...readVersions };
  for (const message of messages) {
    const readVersion = normalized[message.id];
    if (
      message.kind === "session" &&
      readVersion &&
      !isCanonicalInboxSessionVersion(readVersion)
    ) {
      normalized[message.id] = inboxSessionMessageVersion(
        message.status,
        message.occurredAt,
      );
    }
  }
  return normalized;
}

function writeInboxStorage(storageKey: string, storage: InboxStorage) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(storage));
  } catch {
    // Inbox remains available in memory when local storage is unavailable.
  }
}

export function useInbox(
  userId: string | null,
  organizationId: string | null,
  dashboard: DashboardPayload | null,
  sessions: AutoHuntSession[],
  projects: Project[],
  token: string | null = null,
  realtime: RealtimeTransport | null = null,
  dependencies: InboxSyncDependencies = defaultInboxSyncDependencies,
) {
  const storageKey = `${storagePrefix}:${userId ?? "signed-out"}`;
  const currentMessages = useMemo(
    () => buildCurrentInboxMessages(dashboard, sessions, projects, userId),
    [
      dashboard?.conversationNotifications,
      dashboard?.channelNotifications,
      dashboard?.project.id,
      dashboard?.project.name,
      dashboard?.runs,
      projects,
      sessions,
      userId,
    ],
  );
  const [state, setState] = useState<InboxState>(() => ({
    storageKey,
    ...readInboxStorage(storageKey),
  }));
  const [readSyncIdentity, setReadSyncIdentity] = useState<
    InboxReadSyncIdentity | null
  >(null);
  const [notificationFeedIdentity, setNotificationFeedIdentity] = useState<
    InboxFeedSyncIdentity | null
  >(null);
  const readSyncGenerationRef = useRef<InboxReadSyncGeneration | null>(null);
  const nextReadSyncGenerationIdRef = useRef(0);
  const feedSyncStateRef = useRef<{
    scope: string;
    state: InboxFeedSyncState | null;
  } | null>(null);

  const applyRemoteReadVersions = useCallback(
    (
      generation: InboxReadSyncGeneration,
      remote: Record<string, string>,
      protectedLocal: Record<string, string>,
    ) => {
      if (
        !generation.active ||
        readSyncGenerationRef.current !== generation
      ) {
        return;
      }
      setState((current) => {
        if (current.storageKey !== generation.storageKey) return current;
        const normalizedRemote = normalizeInboxReadVersions(
          current.messages,
          remote,
        );
        generation.remoteReadVersions = normalizedRemote;
        const readVersions = mergeInboxReadVersions(
          mergeInboxReadVersions(current.readVersions, normalizedRemote),
          protectedLocal,
        );
        const next = { messages: current.messages, readVersions };
        writeInboxStorage(generation.storageKey, next);
        return { storageKey: generation.storageKey, ...next };
      });
      setReadSyncIdentity({
        storageKey: generation.storageKey,
        token: generation.token,
        userId: generation.userId,
      });
    },
    [],
  );

  const flushReadStatePush = useCallback(
    (generation: InboxReadSyncGeneration) => {
      const drain = () => {
        if (
          !generation.active ||
          readSyncGenerationRef.current !== generation ||
          generation.pushInFlight
        ) {
          return;
        }
        const payload = generation.pendingPush;
        if (Object.keys(payload).length === 0) return;

        generation.pendingPush = {};
        generation.inFlightPush = payload;
        generation.pushInFlight = true;
        let failed = false;
        let failedAtQueueRevision = generation.pushQueueRevision;

        void dependencies.saveReadStates(generation.token, payload)
          .then((remote) => {
            if (
              !generation.active ||
              readSyncGenerationRef.current !== generation
            ) {
              return;
            }
            // A completed PUT is newer than any GET that was already waiting.
            generation.remoteMutationGeneration += 1;
            generation.inFlightPush = {};
            applyRemoteReadVersions(
              generation,
              remote,
              generation.pendingPush,
            );
          })
          .catch(() => {
            if (
              !generation.active ||
              readSyncGenerationRef.current !== generation
            ) {
              return;
            }
            // Keep the failed payload underneath any newer local intent. A
            // later mark, focus, or visibility sync retries it; a permanent
            // 4xx must not create an immediate recursive request loop.
            generation.pendingPush = mergeInboxReadVersions(
              payload,
              generation.pendingPush,
            );
            generation.inFlightPush = {};
            failed = true;
            failedAtQueueRevision = generation.pushQueueRevision;
          })
          .finally(() => {
            if (
              !generation.active ||
              readSyncGenerationRef.current !== generation
            ) {
              return;
            }
            generation.pushInFlight = false;
            const hasPending =
              Object.keys(generation.pendingPush).length > 0;
            if (
              hasPending &&
              (!failed ||
                generation.pushQueueRevision > failedAtQueueRevision)
            ) {
              drain();
            }
          });
      };

      drain();
    },
    [applyRemoteReadVersions, dependencies],
  );

  const queueReadStatePushForGeneration = useCallback(
    (
      generation: InboxReadSyncGeneration,
      readVersions: Record<string, string>,
    ) => {
      if (
        !generation.active ||
        readSyncGenerationRef.current !== generation
      ) {
        return;
      }
      const pending = inboxReadVersionsToPush(readVersions, {
        ...generation.remoteReadVersions,
        ...generation.inFlightPush,
      });
      let changed = false;
      for (const [messageId, version] of Object.entries(pending)) {
        if (generation.pendingPush[messageId] === version) continue;
        generation.pendingPush[messageId] = version;
        changed = true;
      }
      if (!changed) return;

      // Invalidates GET responses that began before this explicit local read.
      generation.remoteMutationGeneration += 1;
      generation.pushQueueRevision += 1;
      flushReadStatePush(generation);
    },
    [flushReadStatePush],
  );

  const synchronizeReadStates = useCallback(
    (generation: InboxReadSyncGeneration) => {
      const run = () => {
        if (
          !generation.active ||
          readSyncGenerationRef.current !== generation
        ) {
          return;
        }

        // A focus/visibility sync is also the retry boundary for a failed PUT.
        flushReadStatePush(generation);
        if (generation.syncInFlight) {
          generation.syncRequested = true;
          return;
        }

        generation.syncInFlight = true;
        const responseGeneration = generation.remoteMutationGeneration;
        const localAtRequestStart = readInboxStorage(
          generation.storageKey,
        ).readVersions;

        void dependencies.loadReadStates(generation.token)
          .then((remote) => {
            if (
              !generation.active ||
              readSyncGenerationRef.current !== generation ||
              generation.remoteMutationGeneration !== responseGeneration
            ) {
              return;
            }

            // The server wins conflicts from an older persisted cache. Entries
            // that have never reached the server, plus explicit pending or
            // in-flight reads, remain local until their serial PUT succeeds.
            const localOnly = Object.fromEntries(
              Object.entries(localAtRequestStart).filter(
                ([messageId]) =>
                  !Object.prototype.hasOwnProperty.call(remote, messageId),
              ),
            );
            const protectedLocal = mergeInboxReadVersions(
              mergeInboxReadVersions(
                localOnly,
                generation.inFlightPush,
              ),
              generation.pendingPush,
            );
            applyRemoteReadVersions(generation, remote, protectedLocal);
            if (Object.keys(localOnly).length > 0) {
              queueReadStatePushForGeneration(generation, localOnly);
            }
          })
          .catch(() => {
            // Offline or auth race: keep local cache until the next sync.
          })
          .finally(() => {
            if (
              !generation.active ||
              readSyncGenerationRef.current !== generation
            ) {
              return;
            }
            generation.syncInFlight = false;
            if (generation.syncRequested) {
              generation.syncRequested = false;
              run();
            }
          });
      };

      run();
    },
    [
      applyRemoteReadVersions,
      dependencies,
      flushReadStatePush,
      queueReadStatePushForGeneration,
    ],
  );

  useEffect(() => {
    const previous = readSyncGenerationRef.current;
    if (previous) previous.active = false;
    readSyncGenerationRef.current = null;
    setState({
      storageKey,
      ...readInboxStorage(storageKey),
    });
    setReadSyncIdentity((current) =>
      current?.storageKey === storageKey &&
        current.token === token &&
        current.userId === userId
        ? current
        : null
    );

    if (!token || !userId) return;
    const generation: InboxReadSyncGeneration = {
      id: ++nextReadSyncGenerationIdRef.current,
      active: true,
      storageKey,
      token,
      userId,
      remoteReadVersions: {},
      pendingPush: {},
      inFlightPush: {},
      pushInFlight: false,
      pushQueueRevision: 0,
      remoteMutationGeneration: 0,
      syncInFlight: false,
      syncRequested: false,
    };
    readSyncGenerationRef.current = generation;
    synchronizeReadStates(generation);

    const handleFocus = () => synchronizeReadStates(generation);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        synchronizeReadStates(generation);
      }
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      generation.active = false;
      if (readSyncGenerationRef.current === generation) {
        readSyncGenerationRef.current = null;
      }
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [storageKey, synchronizeReadStates, token, userId]);

  const queueReadStatePush = useCallback(
    (readVersions: Record<string, string>) => {
      const generation = readSyncGenerationRef.current;
      if (
        !generation ||
        !generation.active ||
        generation.storageKey !== storageKey ||
        generation.token !== token ||
        generation.userId !== userId
      ) {
        return;
      }
      queueReadStatePushForGeneration(generation, readVersions);
    },
    [queueReadStatePushForGeneration, storageKey, token, userId],
  );

  useEffect(() => {
    if (!userId) return;
    setState((current) => {
      if (current.storageKey !== storageKey) return current;
      const messages = mergeInboxMessages(
        current.messages,
        currentMessages,
        projects,
      );
      if (inboxMessageSnapshotsEqual(current.messages, messages)) {
        return current;
      }
      // Keep account-synced read versions even when a message temporarily
      // leaves the local feed, so another device's read state is not lost.
      const next = { messages, readVersions: current.readVersions };
      writeInboxStorage(storageKey, next);
      return { storageKey, ...next };
    });
  }, [currentMessages, projects, storageKey, userId]);

  useEffect(() => {
    if (!token || !userId || !organizationId) {
      setNotificationFeedIdentity(null);
      return;
    }

    const feedScope = `${userId}:${organizationId}`;
    if (feedSyncStateRef.current?.scope !== feedScope) {
      feedSyncStateRef.current = { scope: feedScope, state: null };
    }
    setNotificationFeedIdentity((current) =>
      current?.scope === feedScope && current.token === token ? current : null,
    );
    const abort = new AbortController();
    let disposed = false;
    let refreshInFlight = false;
    let refreshRequested = false;
    let latestRealtimeVersion = -1;
    let realtimeDebounce: number | null = null;

    const refresh = async () => {
      if (refreshInFlight) {
        refreshRequested = true;
        return;
      }
      refreshInFlight = true;
      try {
        const result = await dependencies.loadFeed(
          token,
          organizationId,
          feedSyncStateRef.current?.scope === feedScope
            ? feedSyncStateRef.current.state
            : null,
          abort.signal,
        );
        if (disposed) return;
        feedSyncStateRef.current = { scope: feedScope, state: result.state };
        if (!result.notModified) {
          setState((current) => {
            if (current.storageKey !== storageKey) return current;
            const subscribedIssueIds = result.subscribedIssueIds
              ? new Set(result.subscribedIssueIds)
              : null;
            const authorizedSessionMessageIds = new Set(
              result.messages.flatMap((message) =>
                message.kind === "session" ? [message.id] : []
              ),
            );
            const retainedMessages = current.messages.filter((message) => {
              if (message.kind === "session") {
                return authorizedSessionMessageIds.has(message.id);
              }
              if (
                subscribedIssueIds &&
                (message.kind === "issue" || message.kind === "conversation")
              ) {
                return subscribedIssueIds.has(message.targetId);
              }
              return true;
            });
            const storedById = new Map(
              retainedMessages.map((message) => [message.id, message]),
            );
            const feedSnapshot = result.messages.map((message) => {
              const stored = storedById.get(message.id);
              // The organization feed intentionally uses compact summaries.
              // Preserve richer selected-project/session details and the active
              // channel association when the canonical read version is equal.
              return keepStoredInboxFeedMessage(stored, message);
            });
            const messages = mergeInboxMessages(
              retainedMessages,
              feedSnapshot,
              projects,
            );
            if (inboxMessageSnapshotsEqual(current.messages, messages)) {
              return current;
            }
            const next = { messages, readVersions: current.readVersions };
            writeInboxStorage(storageKey, next);
            return { storageKey, ...next };
          });
        }
        // The first authoritative feed and account read-state response jointly
        // unlock unread markers, app badges, and OS notification change
        // detection. Later feed refreshes keep the same scoped baseline.
        setNotificationFeedIdentity({ scope: feedScope, token });
      } catch {
        // Preserve the local Inbox cache while offline; reconnect and resume
        // events from startDashboardPolling retry the authoritative feed.
      } finally {
        refreshInFlight = false;
        if (!disposed && refreshRequested) {
          refreshRequested = false;
          void refresh();
        }
      }
    };

    const unsubscribe = realtime?.subscribe((notification) => {
      if (
        notification.topic !== "inbox" ||
        notification.version <= latestRealtimeVersion
      ) {
        return;
      }
      latestRealtimeVersion = notification.version;
      if (realtimeDebounce !== null) {
        window.clearTimeout(realtimeDebounce);
      }
      realtimeDebounce = window.setTimeout(() => {
        realtimeDebounce = null;
        void refresh();
      }, INBOX_REALTIME_DEBOUNCE_MS);
    });
    // Inbox realtime is what lets system notifications arrive while the app
    // window is hidden. Other organization consumers may pause in the
    // background, but this consumer deliberately keeps the shared socket
    // alive until the authenticated Inbox scope is disposed.
    realtime?.start();
    const stopPolling = dependencies.startPolling(
      () => void refresh(),
      undefined,
      realtime ? INBOX_REALTIME_FALLBACK_MS : undefined,
    );
    return () => {
      disposed = true;
      abort.abort();
      stopPolling();
      unsubscribe?.();
      realtime?.stop();
      if (realtimeDebounce !== null) {
        window.clearTimeout(realtimeDebounce);
      }
    };
  }, [
    dependencies,
    organizationId,
    projects,
    realtime,
    storageKey,
    token,
    userId,
  ]);

  const feedScope = userId && organizationId
    ? `${userId}:${organizationId}`
    : null;
  const initialSyncComplete = Boolean(
    token &&
      userId &&
      organizationId &&
      readSyncIdentity?.storageKey === storageKey &&
      readSyncIdentity.token === token &&
      readSyncIdentity.userId === userId &&
      notificationFeedIdentity?.scope === feedScope &&
      notificationFeedIdentity.token === token,
  );

  const messages = useMemo<InboxMessageWithReadState[]>(
    () =>
      state.storageKey === storageKey
        ? collapseInboxThreadMessages(
            filterInboxMessagesByOrganization(
              state.messages,
              projects,
              organizationId,
            ).map((message) => ({
                ...message,
                isUnread:
                  initialSyncComplete &&
                  isInboxMessageUnread(message, state.readVersions),
              })),
          )
        : [],
    [initialSyncComplete, organizationId, projects, state, storageKey],
  );

  const markRead = useCallback(
    (messageId: string) => {
      const displayMessage = messages.find(
        (message) =>
          message.id === messageId ||
          Object.prototype.hasOwnProperty.call(
            message.groupedReadVersions ?? {},
            messageId,
          ),
      );
      if (!displayMessage) return;
      const versions = inboxMessageReadVersions(displayMessage);
      setState((current) => {
        if (current.storageKey !== storageKey) return current;
        if (
          Object.entries(versions).every(
            ([id, version]) => current.readVersions[id] === version,
          )
        ) {
          return current;
        }
        const next = {
          messages: current.messages,
          readVersions: {
            ...current.readVersions,
            ...versions,
          },
        };
        writeInboxStorage(storageKey, next);
        queueReadStatePush(versions);
        return { storageKey, ...next };
      });
    },
    [messages, queueReadStatePush, storageKey],
  );

  const markUnread = useCallback(
    (messageId: string) => {
      if (!token) return;
      const displayMessage = messages.find(
        (message) =>
          message.id === messageId ||
          Object.prototype.hasOwnProperty.call(
            message.groupedReadVersions ?? {},
            messageId,
          ),
      );
      if (!displayMessage) return;
      const messageIds = Object.keys(inboxMessageReadVersions(displayMessage));
      setState((current) => {
        if (
          current.storageKey !== storageKey ||
          !messageIds.some((id) =>
            Object.prototype.hasOwnProperty.call(current.readVersions, id)
          )
        ) {
          return current;
        }
        const previousVersions = Object.fromEntries(
          messageIds.flatMap((id) => {
            const version = current.readVersions[id];
            return version === undefined ? [] : [[id, version]];
          }),
        );
        const readVersions = { ...current.readVersions };
        for (const id of messageIds) delete readVersions[id];
        const next = { messages: current.messages, readVersions };
        writeInboxStorage(storageKey, next);
        const generation = readSyncGenerationRef.current;
        if (generation) {
          generation.remoteMutationGeneration += 1;
          for (const id of messageIds) delete generation.remoteReadVersions[id];
        }
        void Promise.all(
          messageIds.map((id) =>
            (dependencies.deleteReadState ?? deleteInboxReadState)(token, id)
          ),
        ).catch(() => {
          setState((latest) => {
            if (latest.storageKey !== storageKey) {
              return latest;
            }
            const restored = {
              messages: latest.messages,
              readVersions: {
                ...latest.readVersions,
                ...previousVersions,
              },
            };
            writeInboxStorage(storageKey, restored);
            return { storageKey, ...restored };
          });
        });
        return { storageKey, ...next };
      });
    },
    [dependencies, messages, storageKey, token],
  );

  const markIssueRead = useCallback(
    (runId: string) => {
      setState((current) => {
        if (current.storageKey !== storageKey) return current;
        const issueReadVersions = Object.fromEntries(
          messages
            .filter(
              (message) =>
                message.targetId === runId &&
                (message.kind === "issue" || message.kind === "conversation"),
            )
            .flatMap((message) =>
              Object.entries(inboxMessageReadVersions(message)),
            )
            .filter(
              ([id, version]) => current.readVersions[id] !== version,
            ),
        );
        if (Object.keys(issueReadVersions).length === 0) return current;
        const next = {
          messages: current.messages,
          readVersions: {
            ...current.readVersions,
            ...issueReadVersions,
          },
        };
        writeInboxStorage(storageKey, next);
        queueReadStatePush(issueReadVersions);
        return { storageKey, ...next };
      });
    },
    [messages, queueReadStatePush, storageKey],
  );

  const markAllRead = useCallback(() => {
    setState((current) => {
      if (current.storageKey !== storageKey) return current;
      const organizationReadVersions = Object.fromEntries(
        messages.flatMap((message) =>
          Object.entries(inboxMessageReadVersions(message)),
        ),
      );
      const next = {
        messages: current.messages,
        readVersions: {
          ...current.readVersions,
          ...organizationReadVersions,
        },
      };
      writeInboxStorage(storageKey, next);
      queueReadStatePush(organizationReadVersions);
      return { storageKey, ...next };
    });
  }, [messages, queueReadStatePush, storageKey]);

  return {
    initialSyncComplete,
    messages,
    markAllRead,
    markIssueRead,
    markRead,
    markUnread,
    notificationBaselineId:
      notificationFeedIdentity?.scope === feedScope
        ? notificationFeedIdentity.scope
        : `${userId ?? "signed-out"}:local`,
    unreadCount: messages.filter(
      (message) =>
        message.isUnread && classifyInboxMessage(message) !== "activity",
    ).length,
  };
}
