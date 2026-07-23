import { useCallback, useEffect, useMemo, useState } from "react";
import type { AutoHuntSession } from "./useAutoHuntSessions";
import type {
  DashboardPayload,
  HuntRun,
  HuntStatus,
  Project,
} from "../types";
import type { AutoHuntWorkflowStageId } from "../lib/auto-hunt-contract";

const storagePrefix = "briar.inbox.v1";

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
};

export type InboxMessage = InboxIssueMessage | InboxSessionMessage;
export type InboxMessageWithReadState = InboxMessage & { isUnread: boolean };

type InboxStorage = {
  messages: InboxMessage[];
  readVersions: Record<string, string>;
};

type InboxState = InboxStorage & {
  storageKey: string;
};

const emptyStorage = (): InboxStorage => ({ messages: [], readVersions: {} });

function latestMatchingEvent(run: HuntRun) {
  return [...run.events].reverse().find(
    (event) =>
      event.status === run.status &&
      event.workflowStage === run.workflowStage &&
      event.attempt === run.currentAttempt,
  );
}

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
      const latestEvent = latestMatchingEvent(run);
      messages.push({
        id: `issue:${run.id}`,
        kind: "issue",
        projectId: dashboard.project.id,
        projectName: dashboard.project.name,
        targetId: run.id,
        title: run.title,
        occurredAt: latestEvent?.occurredAt ?? run.updatedAt,
        version:
          latestEvent?.id ??
          `${run.currentAttempt}:${run.status}:${run.workflowStage ?? "none"}`,
        runNumber: run.runNumber,
        status: run.status,
        workflowStage: run.workflowStage,
      });
    }
  }

  for (const session of sessions) {
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
      title: session.issues.map((issue) => issue.title).join(" · "),
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
  dashboard: DashboardPayload | null,
  sessions: AutoHuntSession[],
  projects: Project[],
) {
  const storageKey = `${storagePrefix}:${userId ?? "signed-out"}`;
  const currentMessages = useMemo(
    () => buildCurrentInboxMessages(dashboard, sessions, projects),
    [dashboard, projects, sessions],
  );
  const [state, setState] = useState<InboxState>(() => ({
    storageKey,
    ...readInboxStorage(storageKey),
  }));

  useEffect(() => {
    setState({
      storageKey,
      ...readInboxStorage(storageKey),
    });
  }, [storageKey]);

  useEffect(() => {
    if (!userId) return;
    setState((current) => {
      if (current.storageKey !== storageKey) return current;
      const messages = mergeInboxMessages(
        current.messages,
        currentMessages,
        projects,
      );
      const validIds = new Set(messages.map((message) => message.id));
      const readVersions = Object.fromEntries(
        Object.entries(current.readVersions).filter(([id]) => validIds.has(id)),
      );
      const next = { messages, readVersions };
      writeInboxStorage(storageKey, next);
      return { storageKey, ...next };
    });
  }, [currentMessages, projects, storageKey, userId]);

  const messages = useMemo<InboxMessageWithReadState[]>(
    () =>
      state.storageKey === storageKey
        ? state.messages.map((message) => ({
            ...message,
            isUnread: isInboxMessageUnread(message, state.readVersions),
          }))
        : [],
    [state, storageKey],
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
        return { storageKey, ...next };
      });
    },
    [storageKey],
  );

  const markAllRead = useCallback(() => {
    setState((current) => {
      if (current.storageKey !== storageKey) return current;
      const next = {
        messages: current.messages,
        readVersions: Object.fromEntries(
          current.messages.map((message) => [message.id, message.version]),
        ),
      };
      writeInboxStorage(storageKey, next);
      return { storageKey, ...next };
    });
  }, [storageKey]);

  return {
    messages,
    markAllRead,
    markRead,
    unreadCount: messages.filter((message) => message.isUnread).length,
  };
}
