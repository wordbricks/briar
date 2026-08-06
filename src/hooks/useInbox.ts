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
  | InboxConversationMessage;
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
    for (const run of dashboard.runs) {
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
      messages.push({
        id: `conversation:${notification.id}`,
        kind: "conversation",
        projectId: dashboard.project.id,
        projectName: dashboard.project.name,
        targetId: notification.runId,
        rootMessageId: notification.rootMessageId,
        title: notification.runTitle,
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
  if (message.kind === "conversation") return "action_required";
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

export function groupInboxMessages(
  messages: InboxMessageWithReadState[],
): Record<InboxCategory, InboxMessageWithReadState[]> {
  return {
    urgent: messages.filter(
      (message) => classifyInboxMessage(message) === "urgent",
    ),
    action_required: messages.filter(
      (message) => classifyInboxMessage(message) === "action_required",
    ),
    important: messages.filter(
      (message) => classifyInboxMessage(message) === "important",
    ),
    activity: messages.filter(
      (message) => classifyInboxMessage(message) === "activity",
    ),
  };
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
  const remoteReadVersionsRef = useRef<Record<string, string>>({});
  const pushQueueRef = useRef<Record<string, string>>({});
  const pushInFlightRef = useRef(false);

  useEffect(() => {
    remoteReadVersionsRef.current = {};
    pushQueueRef.current = {};
    setState({
      storageKey,
      ...readInboxStorage(storageKey),
    });
  }, [storageKey]);

  const flushReadStatePush = useCallback(async () => {
    if (!token || !userId || pushInFlightRef.current) return;
    const pending = pushQueueRef.current;
    const entries = Object.entries(pending);
    if (entries.length === 0) return;
    pushInFlightRef.current = true;
    pushQueueRef.current = {};
    try {
      const remote = await saveInboxReadStates(
        token,
        Object.fromEntries(entries),
      );
      remoteReadVersionsRef.current = mergeInboxReadVersions(
        remoteReadVersionsRef.current,
        remote,
      );
      setState((current) => {
        if (current.storageKey !== storageKey) return current;
        const readVersions = mergeInboxReadVersions(
          current.readVersions,
          remote,
        );
        const next = { messages: current.messages, readVersions };
        writeInboxStorage(storageKey, next);
        return { storageKey, ...next };
      });
    } catch {
      // Keep local optimistic state and retry on the next mark/sync.
      pushQueueRef.current = mergeInboxReadVersions(
        Object.fromEntries(entries),
        pushQueueRef.current,
      );
    } finally {
      pushInFlightRef.current = false;
      if (Object.keys(pushQueueRef.current).length > 0) {
        void flushReadStatePush();
      }
    }
  }, [storageKey, token, userId]);

  const queueReadStatePush = useCallback(
    (readVersions: Record<string, string>) => {
      if (!token || !userId) return;
      const pending = inboxReadVersionsToPush(
        readVersions,
        remoteReadVersionsRef.current,
      );
      if (Object.keys(pending).length === 0) return;
      pushQueueRef.current = mergeInboxReadVersions(
        pushQueueRef.current,
        pending,
      );
      void flushReadStatePush();
    },
    [flushReadStatePush, token, userId],
  );

  useEffect(() => {
    if (!userId || !token) return;
    let cancelled = false;
    void (async () => {
      try {
        const remote = await loadInboxReadStates(token);
        if (cancelled) return;
        remoteReadVersionsRef.current = remote;
        setState((current) => {
          if (current.storageKey !== storageKey) return current;
          const readVersions = mergeInboxReadVersions(
            current.readVersions,
            remote,
          );
          const next = { messages: current.messages, readVersions };
          writeInboxStorage(storageKey, next);
          return { storageKey, ...next };
        });
        const local = readInboxStorage(storageKey).readVersions;
        const pending = inboxReadVersionsToPush(local, remote);
        if (Object.keys(pending).length > 0) {
          pushQueueRef.current = mergeInboxReadVersions(
            pushQueueRef.current,
            pending,
          );
          void flushReadStatePush();
        }
      } catch {
        // Offline or auth race: keep local cache until the next successful sync.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flushReadStatePush, storageKey, token, userId]);

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
    markRead,
    unreadCount: messages.filter(
      (message) =>
        message.isUnread && classifyInboxMessage(message) !== "activity",
    ).length,
  };
}
