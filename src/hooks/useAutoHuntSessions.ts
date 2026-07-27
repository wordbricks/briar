import { useCallback, useEffect, useRef, useState } from "react";
import {
  listenToAutoHuntDispatchEvents,
  loadAutoHuntDispatch,
  startProjectAutoHunt,
  type AutoHuntAgentResponse,
  type AutoHuntDispatchEvent,
  type AutoHuntDispatchGroup,
  type AutoHuntWorkerResult,
} from "../lib/auto-hunt-agent";
import {
  defaultAutoHuntMaxIssues,
  selectAutoHuntCandidates,
  type AutoHuntAutomaticTrigger,
} from "../lib/auto-hunt-automation";
import type { HuntRun, ProjectAgent } from "../types";

const storageKey = "briar.auto-hunt-sessions.v1";

export type AutoHuntSessionStatus =
  | "running"
  | "completed"
  | "failed"
  | "interrupted";
export type AutoHuntSessionIssueOutcome =
  | "pending"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";
export type AutoHuntSessionEventType =
  | "started"
  | "completed"
  | "failed"
  | "interrupted";

export type AutoHuntSessionIssue = {
  runId: string;
  runNumber: number;
  sourceKey: string;
  title: string;
  outcome: AutoHuntSessionIssueOutcome;
  summary: string | null;
};

export type AutoHuntSessionEvent = {
  id: string;
  type: AutoHuntSessionEventType;
  occurredAt: string;
};

export type AutoHuntSession = {
  id: string;
  dispatchGroupId: string;
  projectId: string;
  agentId?: string;
  status: AutoHuntSessionStatus;
  issues: AutoHuntSessionIssue[];
  startedAt: string;
  completedAt: string | null;
  conversationId: string | null;
  workspaceRoot: string | null;
  summary: string | null;
  error: string | null;
  events: AutoHuntSessionEvent[];
  dispatchEvents: AutoHuntDispatchEvent[];
  workers: AutoHuntWorkerResult[];
  trigger?: {
    type: "manual" | "automatic";
    reasons: AutoHuntAutomaticTrigger[];
  };
};

type AutoHuntRunner = typeof startProjectAutoHunt;

function event(type: AutoHuntSessionEventType, occurredAt: string) {
  return { id: crypto.randomUUID(), type, occurredAt };
}

function readSessions(): AutoHuntSession[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    if (!Array.isArray(value)) return [];
    const restored = value.filter((session) =>
      session && typeof session === "object" && typeof session.id === "string"
    ) as AutoHuntSession[];
    const interruptedAt = new Date().toISOString();
    return restored.map((storedSession) => {
      const session = {
        ...storedSession,
        dispatchGroupId: storedSession.dispatchGroupId ?? storedSession.id,
        workers: storedSession.workers ?? [],
        dispatchEvents: storedSession.dispatchEvents ?? [],
        trigger: storedSession.trigger ?? { type: "manual" as const, reasons: [] },
      };
      return session.status === "running"
        ? {
            ...session,
            status: "interrupted",
            completedAt: interruptedAt,
            error: null,
            events: [...session.events, event("interrupted", interruptedAt)],
          }
        : session;
    });
  } catch {
    return [];
  }
}

function completedSession(
  session: AutoHuntSession,
  response: AutoHuntAgentResponse,
  completedAt: string,
): AutoHuntSession {
  return {
    ...session,
    dispatchGroupId: response.dispatchGroupId,
    status: "completed",
    completedAt,
    conversationId: response.conversationId,
    workspaceRoot: response.workspaceRoot,
    summary: response.result.summary,
    error: null,
    workers: response.workers,
    issues: session.issues.map((issue) => {
      const result = response.result.issues.find(
        (candidate) => candidate.sourceKey === issue.sourceKey,
      );
      return result
        ? { ...issue, outcome: result.outcome, summary: result.summary }
        : { ...issue, outcome: "skipped", summary: null };
    }),
    events: [...session.events, event("completed", completedAt)],
  };
}

function outcomeForWorker(
  status: AutoHuntDispatchGroup["workers"][number]["status"],
): AutoHuntSessionIssueOutcome {
  if (status === "completed" || status === "blocked" || status === "failed") {
    return status;
  }
  if (status === "cancelled") return "skipped";
  return "pending";
}

function reconcileDispatch(
  session: AutoHuntSession,
  dispatch: AutoHuntDispatchGroup,
): AutoHuntSession {
  const workers: AutoHuntWorkerResult[] = dispatch.workers.map((worker) => ({
    sessionId: worker.sessionId,
    runId: worker.runId,
    sourceKey: worker.sourceKey,
    conversationId: worker.conversationId,
    workspaceRoot: worker.workspaceRoot,
    outcome: worker.status === "cancelled"
      ? "cancelled"
      : outcomeForWorker(worker.status),
    summary: worker.summary ?? "",
    evidence: dispatch.events
      .filter((event) =>
        event.runId === worker.runId &&
        event.type === "worker_evidence" &&
        event.data
      )
      .map((event) => event.data!),
  }));
  return {
    ...session,
    dispatchGroupId: dispatch.dispatchGroupId,
    status: dispatch.status,
    completedAt: dispatch.completedAt,
    error: dispatch.error,
    workers,
    dispatchEvents: dispatch.events,
    issues: session.issues.map((issue) => {
      const worker = dispatch.workers.find(
        (candidate) => candidate.runId === issue.runId,
      );
      return worker
        ? {
            ...issue,
            outcome: outcomeForWorker(worker.status),
            summary: worker.summary,
          }
        : issue;
    }),
  };
}

export function useAutoHuntSessions(
  runner: AutoHuntRunner = startProjectAutoHunt,
) {
  const [sessions, setSessions] = useState<AutoHuntSession[]>(readSessions);
  const sessionsRef = useRef(sessions);

  useEffect(() => {
    sessionsRef.current = sessions;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(sessions));
    } catch {
      // Session tracking remains available in memory when storage is unavailable.
    }
  }, [sessions]);

  useEffect(() => {
    const recoverable = sessionsRef.current.filter(
      (session) =>
        session.status === "running" || session.status === "interrupted",
    );
    if (recoverable.length === 0) return;
    let active = true;
    void Promise.all(recoverable.map(async (session) => ({
      sessionId: session.id,
      dispatch: await loadAutoHuntDispatch(
        session.dispatchGroupId || session.id,
      ),
    }))).then((loaded) => {
      if (!active) return;
      const dispatches = new Map(
        loaded
          .filter((entry) => entry.dispatch !== null)
          .map((entry) => [entry.sessionId, entry.dispatch!]),
      );
      if (dispatches.size === 0) return;
      setSessions((current) => current.map((session) => {
        const dispatch = dispatches.get(session.id);
        return dispatch ? reconcileDispatch(session, dispatch) : session;
      }));
    }).catch(() => {
      // The interrupted local snapshot remains visible when native recovery
      // state is unavailable; starting a new session is never inferred here.
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let unlisten: () => void = () => undefined;
    void listenToAutoHuntDispatchEvents((event) => {
      if (!active) return;
      const session = sessionsRef.current.find(
        (candidate) => candidate.dispatchGroupId === event.dispatchGroupId,
      );
      if (!session) return;
      void loadAutoHuntDispatch(event.dispatchGroupId, 0).then((dispatch) => {
        if (!active || !dispatch) return;
        setSessions((current) => current.map((candidate) =>
          candidate.dispatchGroupId === event.dispatchGroupId
            ? reconcileDispatch(candidate, dispatch)
            : candidate));
      });
    }).then((stop) => {
      if (!active) {
        stop();
        return;
      }
      unlisten = stop;
    });
    return () => {
      active = false;
      unlisten();
    };
  }, []);

  const removeProjectSessions = useCallback((projectId: string) => {
    const remaining = sessionsRef.current.filter(
      (session) => session.projectId !== projectId,
    );
    sessionsRef.current = remaining;
    setSessions(remaining);
  }, []);

  const startSession = useCallback((
    projectId: string,
    runs: HuntRun[],
    onSettled: (() => void) | undefined,
    options: {
      agent: ProjectAgent;
      maxIssues?: number;
      trigger?: AutoHuntSession["trigger"];
    },
  ) => {
    if (sessionsRef.current.some(
      (session) => session.projectId === projectId && session.status === "running",
    )) {
      throw new Error("이 프로젝트에서 이미 자동사냥 세션이 진행 중입니다.");
    }
    const candidates = selectAutoHuntCandidates(
      runs,
      options.maxIssues ?? defaultAutoHuntMaxIssues,
    );
    if (candidates.length === 0) {
      throw new Error("대기 상태인 이슈가 없습니다.");
    }
    const startedAt = new Date().toISOString();
    const session: AutoHuntSession = {
      id: crypto.randomUUID(),
      dispatchGroupId: "",
      projectId,
      agentId: options.agent.id,
      status: "running",
      issues: candidates.map((run) => ({
        runId: run.id,
        runNumber: run.runNumber,
        sourceKey: run.sourceKey,
        title: run.title,
        outcome: "pending",
        summary: null,
      })),
      startedAt,
      completedAt: null,
      conversationId: null,
      workspaceRoot: null,
      summary: null,
      error: null,
      events: [event("started", startedAt)],
      workers: [],
      dispatchEvents: [],
      trigger: options.trigger ?? { type: "manual", reasons: [] },
    };
    session.dispatchGroupId = session.id;
    sessionsRef.current = [session, ...sessionsRef.current];
    setSessions(sessionsRef.current);

    void runner(projectId, candidates, session.id, options.agent)
      .then((response) => {
        const completedAt = new Date().toISOString();
        setSessions((current) => current.map((candidate) =>
          candidate.id === session.id
            ? completedSession(candidate, response, completedAt)
            : candidate));
      })
      .catch((caught) => {
        const completedAt = new Date().toISOString();
        const error = caught instanceof Error ? caught.message : String(caught);
        setSessions((current) => current.map((candidate) => candidate.id === session.id
          ? {
              ...candidate,
              status: "failed",
              completedAt,
              error,
              events: [...candidate.events, event("failed", completedAt)],
            }
          : candidate));
      })
      .finally(onSettled);
    return session.id;
  }, [runner]);

  return { sessions, startSession, removeProjectSessions };
}
