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
  loadInboxReadStates,
  saveInboxReadStates,
} from "../lib/api";

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
  /** Human-readable project issue key used by reply notifications. */
  issueKey?: string;
  reason: "mention" | "thread_reply";
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
  reason: "mention" | "thread_reply";
};

export type InboxMessage =
  | InboxIssueMessage
  | InboxSessionMessage
  | InboxConversationMessage
  | InboxChannelMessage;
export type InboxMessageWithReadState = InboxMessage & { isUnread: boolean };
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

const emptyStorage = (): InboxStorage => ({ messages: [], readVersions: {} });

export function buildCurrentInboxMessages(
  dashboard: DashboardPayload | null,
  sessions: AutoHuntSession[],
  projects: Project[],
): InboxMessage[] {
  const projectNames = new Map(
    projects.map((project) => [project.id, project.name]),
  );
  const messages: InboxMessage[] = [];

  if (dashboard) {
    const issueKeyPrefix = dashboard.project.issueKeyPrefix?.trim() || "AH";
    for (const run of dashboard.runs) {
      if (!inboxIssueNotifyingStatuses.has(run.status)) continue;
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
      const runNumber = dashboard.runs.find(
        (run) => run.id === notification.runId,
      )?.runNumber;
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
        reason: notification.reason,
      });
    }
  }

  for (const session of collapseLinkedAutoHuntSessions(sessions)) {
    if (session.status !== "completed" && session.status !== "failed") continue;
    const finalEvent = [...session.events].reverse().find(
      (event) => event.type === session.status,
    );
    messages.push({
      id: `session:${session.id}`,
      kind: "session",
      projectId: session.projectId,
      projectName: projectNames.get(session.projectId) ?? "",
      targetId: session.id,
      title:
        session.request ??
        session.issues.map((issue) => issue.title).join(" · "),
      occurredAt:
        finalEvent?.occurredAt ??
        session.completedAt ??
        session.startedAt,
      version:
        finalEvent?.id ??
        `${session.status}:${session.completedAt ?? session.startedAt}`,
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
    (left, right) =>
      new Date(right.occurredAt).getTime() -
      new Date(left.occurredAt).getTime(),
  );
}

export function isInboxMessageUnread(
  message: InboxMessage,
  readVersions: Record<string, string>,
) {
  return readVersions[message.id] !== message.version;
}

export function mergeInboxReadVersions(
  local: Record<string, string>,
  remote: Record<string, string>,
): Record<string, string> {
  return {
    ...local,
    ...remote,
  };
}

export function inboxReadVersionsToPush(
  local: Record<string, string>,
  remote: Record<string, string>,
): Record<string, string> {
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
  if (message.kind === "conversation" || message.kind === "channel") {
    return "action_required";
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
    return {
      messages: Array.isArray(value.messages)
        ? value.messages.filter(
            (message: unknown) =>
              Boolean(message) &&
              typeof message === "object" &&
              typeof (message as { id?: unknown }).id === "string",
          )
        : [],
      readVersions:
        value.readVersions &&
        typeof value.readVersions === "object" &&
        !Array.isArray(value.readVersions)
          ? value.readVersions
          : {},
    };
  } catch {
    return emptyStorage();
  }
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
) {
  const storageKey = `${storagePrefix}:${userId ?? "signed-out"}`;
  const currentMessages = useMemo(
    () => buildCurrentInboxMessages(dashboard, sessions, projects),
    [
      dashboard?.conversationNotifications,
      dashboard?.channelNotifications,
      dashboard?.project.id,
      dashboard?.project.name,
      dashboard?.runs,
      projects,
      sessions,
    ],
  );
  const [state, setState] = useState<InboxState>(() => ({
    storageKey,
    ...readInboxStorage(storageKey),
  }));
  const readSyncGenerationRef = useRef<InboxReadSyncGeneration | null>(null);
  const nextReadSyncGenerationIdRef = useRef(0);

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
      generation.remoteReadVersions = remote;
      setState((current) => {
        if (current.storageKey !== generation.storageKey) return current;
        const readVersions = mergeInboxReadVersions(
          mergeInboxReadVersions(current.readVersions, remote),
          protectedLocal,
        );
        const next = { messages: current.messages, readVersions };
        writeInboxStorage(generation.storageKey, next);
        return { storageKey: generation.storageKey, ...next };
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

        void saveInboxReadStates(generation.token, payload)
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
    [applyRemoteReadVersions],
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

        void loadInboxReadStates(generation.token)
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
      // Keep account-synced read versions even when a message temporarily
      // leaves the local feed, so another device's read state is not lost.
      const next = { messages, readVersions: current.readVersions };
      writeInboxStorage(storageKey, next);
      return { storageKey, ...next };
    });
  }, [currentMessages, projects, storageKey, userId]);

  const messages = useMemo<InboxMessageWithReadState[]>(
    () =>
      state.storageKey === storageKey
        ? filterInboxMessagesByOrganization(
            state.messages,
            projects,
            organizationId,
          ).map((message) => ({
              ...message,
              isUnread: isInboxMessageUnread(message, state.readVersions),
            }))
        : [],
    [organizationId, projects, state, storageKey],
  );

  const markRead = useCallback(
    (messageId: string) => {
      setState((current) => {
        if (current.storageKey !== storageKey) return current;
        const message = current.messages.find(
          (candidate) => candidate.id === messageId,
        );
        if (!message || current.readVersions[messageId] === message.version) {
          return current;
        }
        const next = {
          messages: current.messages,
          readVersions: {
            ...current.readVersions,
            [messageId]: message.version,
          },
        };
        writeInboxStorage(storageKey, next);
        queueReadStatePush({ [messageId]: message.version });
        return { storageKey, ...next };
      });
    },
    [queueReadStatePush, storageKey],
  );

  const markIssueRead = useCallback(
    (runId: string) => {
      setState((current) => {
        if (current.storageKey !== storageKey) return current;
        const issueReadVersions = Object.fromEntries(
          current.messages
            .filter(
              (message) =>
                message.targetId === runId &&
                (message.kind === "issue" || message.kind === "conversation") &&
                current.readVersions[message.id] !== message.version,
            )
            .map((message) => [message.id, message.version]),
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
    [queueReadStatePush, storageKey],
  );

  const markAllRead = useCallback(() => {
    setState((current) => {
      if (current.storageKey !== storageKey) return current;
      const organizationMessages = filterInboxMessagesByOrganization(
        current.messages,
        projects,
        organizationId,
      );
      const organizationReadVersions = Object.fromEntries(
        organizationMessages.map((message) => [message.id, message.version]),
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
  }, [organizationId, projects, queueReadStatePush, storageKey]);

  return {
    messages,
    markAllRead,
    markIssueRead,
    markRead,
    unreadCount: messages.filter(
      (message) =>
        message.isUnread && classifyInboxMessage(message) !== "activity",
    ).length,
  };
}
