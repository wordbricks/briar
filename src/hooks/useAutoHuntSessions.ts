import { useCallback, useEffect, useRef, useState } from "react";
import {
  listenToAutoHuntDispatchEvents,
  loadAutoHuntDispatch,
  type AutoHuntDispatchEvent,
  type AutoHuntDispatchGroup,
  type AutoHuntWorkerResult,
} from "../lib/auto-hunt-agent";
import { stopProjectAgentSession } from "../lib/project-llm";
import {
  cancelHuntRun,
  loadProjectAgentSessions,
  upsertProjectAgentSession,
} from "../lib/api";
import { DASHBOARD_POLL_INTERVAL_MS } from "../lib/dashboard-polling";
import type { HuntRun, ProjectAgent } from "../types";

const storageKey = "briar.auto-hunt-sessions.v1";

export type AutoHuntSessionStatus =
  | "running"
  | "completed"
  | "failed"
  | "skipped"
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
  | "skipped"
  | "interrupted"
  | "stopped";

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

export type AutoHuntSessionFollowUp = {
  id: string;
  message: string;
  sentAt: string;
};

export type AutoHuntSession = {
  id: string;
  dispatchGroupId: string;
  projectId: string;
  agentId?: string;
  agentName?: string | null;
  skillId?: string | null;
  sessionType?: "task" | "dispatch";
  trigger?: "manual" | "scheduled";
  scheduleId?: string;
  scheduleRunId?: string;
  parentSessionId?: string;
  request?: string;
  followUps?: AutoHuntSessionFollowUp[];
  status: AutoHuntSessionStatus;
  issues: AutoHuntSessionIssue[];
  startedAt: string;
  completedAt: string | null;
  conversationId: string | null;
  workspaceRoot: string | null;
  requestedWorkerId?: string | null;
  workerId?: string | null;
  summary: string | null;
  error: string | null;
  events: AutoHuntSessionEvent[];
  dispatchEvents: AutoHuntDispatchEvent[];
  workers: AutoHuntWorkerResult[];
  updatedAt?: string;
  localOwner?: boolean;
};

export function collapseLinkedAutoHuntSessions(
  sessions: readonly AutoHuntSession[],
) {
  const parentSessionIds = new Set(
    sessions.flatMap((session) =>
      session.parentSessionId ? [session.parentSessionId] : [],
    ),
  );
  return sessions.filter((session) => !parentSessionIds.has(session.id));
}

type AutoHuntStopper = typeof stopProjectAgentSession;

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
        sessionType: storedSession.sessionType ?? "dispatch",
        workers: storedSession.workers ?? [],
        dispatchEvents: storedSession.dispatchEvents ?? [],
        updatedAt:
          storedSession.updatedAt ??
          storedSession.completedAt ??
          storedSession.startedAt,
        localOwner: storedSession.localOwner ?? true,
        followUps: storedSession.followUps ?? [],
      };
      return session.status === "running" && session.localOwner
        ? {
            ...session,
            status: "interrupted",
            completedAt: interruptedAt,
            updatedAt: interruptedAt,
            error: null,
            events: [...session.events, event("interrupted", interruptedAt)],
          }
        : session;
    });
  } catch {
    return [];
  }
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
    updatedAt: new Date().toISOString(),
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

function issueOutcomeForRun(
  status: HuntRun["status"],
): AutoHuntSessionIssueOutcome {
  if (status === "completed" || status === "blocked" || status === "failed") {
    return status;
  }
  if (status === "cancelled") return "skipped";
  return "pending";
}

export function reconcileWorkerDispatchSession(
  session: AutoHuntSession,
  runs: readonly HuntRun[],
  now = new Date().toISOString(),
): AutoHuntSession {
  if (session.sessionType !== "dispatch" || session.issues.length === 0) {
    return session;
  }
  const runsById = new Map(runs.map((run) => [run.id, run]));
  if (session.issues.some((issue) => !runsById.has(issue.runId))) {
    return session;
  }
  const issues = session.issues.map((issue) => {
    const run = runsById.get(issue.runId)!;
    return {
      ...issue,
      outcome: issueOutcomeForRun(run.status),
      summary: run.status === "completed"
        ? run.resultSummary
        : run.status === "blocked" || run.status === "failed"
        ? run.resultSummary ?? run.detail
        : issue.summary,
    };
  });
  const changed = issues.some((issue, index) =>
    issue.outcome !== session.issues[index]?.outcome ||
    issue.summary !== session.issues[index]?.summary
  );
  const isTerminal = issues.every((issue) => issue.outcome !== "pending");
  if (!changed && (!isTerminal || session.status !== "running")) return session;

  if (!isTerminal || session.status !== "running") {
    return { ...session, issues, updatedAt: now };
  }
  const summaries = issues.flatMap((issue) =>
    issue.summary ? [`${issue.sourceKey}: ${issue.summary}`] : []
  );
  return {
    ...session,
    issues,
    status: "completed",
    completedAt: now,
    summary: summaries.length > 0 ? summaries.join("\n\n") : null,
    error: null,
    updatedAt: now,
    events: [...session.events, event("completed", now)],
  };
}

function sessionSyncKey(session: Pick<AutoHuntSession, "projectId" | "id">) {
  return `${session.projectId}:${session.id}`;
}

function sessionVersion(
  session: Pick<AutoHuntSession, "updatedAt" | "completedAt" | "startedAt">,
) {
  return session.updatedAt ?? session.completedAt ?? session.startedAt;
}

export function mergeSynchronizedSessions(
  localSessions: readonly AutoHuntSession[],
  remoteSessions: readonly AutoHuntSession[],
) {
  const merged = new Map(
    localSessions.map((session) => [sessionSyncKey(session), session]),
  );
  for (const remote of remoteSessions) {
    const key = sessionSyncKey(remote);
    const local = merged.get(key);
    if (local && sessionVersion(local) >= sessionVersion(remote)) continue;
    merged.set(key, {
      ...remote,
      localOwner: local?.localOwner ?? false,
      workspaceRoot: local?.workspaceRoot ?? null,
      dispatchEvents: local?.dispatchEvents ?? [],
      workers: local?.workers ?? [],
    });
  }
  return [...merged.values()].sort(
      (left, right) =>
        new Date(right.startedAt).getTime() -
        new Date(left.startedAt).getTime(),
  );
}

export function useAutoHuntSessions(
  stopper: AutoHuntStopper = stopProjectAgentSession,
) {
  const [sessions, setSessions] = useState<AutoHuntSession[]>(readSessions);
  const sessionsRef = useRef(sessions);
  const [syncContext, setSyncContext] = useState<{
    token: string;
    projectIds: string[];
  } | null>(null);
  const [synchronizedProjects, setSynchronizedProjects] = useState<Set<string>>(
    () => new Set(),
  );
  const uploadedVersionsRef = useRef(new Map<string, string>());

  useEffect(() => {
    sessionsRef.current = sessions;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(sessions));
    } catch {
      // Session tracking remains available in memory when storage is unavailable.
    }
  }, [sessions]);

  const configureSync = useCallback((
    token: string | null,
    projectIds: readonly string[],
  ) => {
    const normalizedProjectIds = [...new Set(projectIds)].sort();
    setSyncContext((current) => {
      if (!token) return current === null ? current : null;
      if (
        current?.token === token &&
        current.projectIds.length === normalizedProjectIds.length &&
        current.projectIds.every(
          (projectId, index) => projectId === normalizedProjectIds[index],
        )
      ) {
        return current;
      }
      return { token, projectIds: normalizedProjectIds };
    });
  }, []);

  useEffect(() => {
    uploadedVersionsRef.current.clear();
    setSynchronizedProjects(new Set());
    if (!syncContext || syncContext.projectIds.length === 0) return;
    let active = true;

    const refreshRemoteSessions = async () => {
      const loaded = await Promise.allSettled(
        syncContext.projectIds.map(async (projectId) => ({
          projectId,
          sessions: await loadProjectAgentSessions(syncContext.token, projectId),
        })),
      );
      if (!active) return;
      const successfulProjectIds = new Set<string>();
      setSessions((current) => {
        let next = current;
        for (const result of loaded) {
          if (result.status !== "fulfilled") continue;
          successfulProjectIds.add(result.value.projectId);
          for (const session of result.value.sessions) {
            uploadedVersionsRef.current.set(
              sessionSyncKey(session),
              sessionVersion(session),
            );
          }
          next = mergeSynchronizedSessions(
            next,
            result.value.sessions,
          );
        }
        return next;
      });
      setSynchronizedProjects(successfulProjectIds);
    };

    void refreshRemoteSessions();
    const timer = window.setInterval(
      () => void refreshRemoteSessions(),
      DASHBOARD_POLL_INTERVAL_MS,
    );
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [syncContext]);

  useEffect(() => {
    if (!syncContext || synchronizedProjects.size === 0) return;
    for (const session of sessions) {
      if (session.localOwner === false) continue;
      if (!synchronizedProjects.has(session.projectId)) continue;
      const key = sessionSyncKey(session);
      const version = sessionVersion(session);
      if (uploadedVersionsRef.current.get(key) === version) continue;
      uploadedVersionsRef.current.set(key, version);
      void upsertProjectAgentSession(syncContext.token, session)
        .then((remote) => {
          uploadedVersionsRef.current.set(
            sessionSyncKey(remote),
            sessionVersion(remote),
          );
          setSessions((current) =>
            mergeSynchronizedSessions(current, [remote])
          );
        })
        .catch(() => {
          if (uploadedVersionsRef.current.get(key) === version) {
            uploadedVersionsRef.current.delete(key);
          }
        });
    }
  }, [sessions, syncContext, synchronizedProjects]);

  useEffect(() => {
    const recoverable = sessionsRef.current.filter(
      (session) =>
        session.sessionType !== "task" &&
        (session.status === "running" || session.status === "interrupted"),
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

  const startTaskSession = useCallback((
    projectId: string,
    agentId: string,
    input: {
      sessionId?: string;
      request: string;
      agentName?: string | null;
      skillId?: string | null;
      startedAt: string;
      trigger?: "manual" | "scheduled";
      scheduleId?: string;
      scheduleRunId?: string;
      isFollowUp?: boolean;
    },
  ) => {
    const existing = sessionsRef.current.find(
      (session) =>
        (input.scheduleRunId &&
          session.scheduleRunId === input.scheduleRunId) ||
        (input.sessionId && session.id === input.sessionId),
    );
    if (existing) {
      if (existing.status !== "running") {
        const restarted = sessionsRef.current.map((session) =>
          session.id === existing.id
            ? {
                ...session,
                request: input.isFollowUp
                  ? session.request
                  : input.request,
                ...(input.agentName !== undefined
                  ? { agentName: input.agentName }
                  : {}),
                ...(input.skillId !== undefined
                  ? { skillId: input.skillId }
                  : {}),
                followUps: input.isFollowUp
                  ? [
                      ...(session.followUps ?? []),
                      {
                        id: crypto.randomUUID(),
                        message: input.request,
                        sentAt: input.startedAt,
                      },
                    ]
                  : session.followUps ?? [],
                status: "running" as const,
                startedAt: input.isFollowUp
                  ? session.startedAt
                  : input.startedAt,
                completedAt: null,
                conversationId: input.isFollowUp
                  ? session.conversationId
                  : null,
                workspaceRoot: input.isFollowUp
                  ? session.workspaceRoot
                  : null,
                summary: null,
                error: null,
                updatedAt: input.startedAt,
                localOwner: true,
                events: [...session.events, event("started", input.startedAt)],
              }
            : session
        );
        sessionsRef.current = restarted;
        setSessions(restarted);
      }
      return existing.id;
    }
    const session: AutoHuntSession = {
      id: input.sessionId ?? crypto.randomUUID(),
      dispatchGroupId: "",
      projectId,
      agentId,
      agentName: input.agentName ?? null,
      ...(input.skillId !== undefined ? { skillId: input.skillId } : {}),
      sessionType: "task",
      trigger: input.trigger ?? "manual",
      scheduleId: input.scheduleId,
      scheduleRunId: input.scheduleRunId,
      request: input.request,
      followUps: [],
      status: "running",
      issues: [],
      startedAt: input.startedAt,
      completedAt: null,
      conversationId: null,
      workspaceRoot: null,
      summary: null,
      error: null,
      events: [event("started", input.startedAt)],
      workers: [],
      dispatchEvents: [],
      updatedAt: input.startedAt,
      localOwner: true,
    };
    sessionsRef.current = [session, ...sessionsRef.current];
    setSessions(sessionsRef.current);
    return session.id;
  }, []);

  const startWorkerDispatchSession = useCallback((
    projectId: string,
    agent: Pick<ProjectAgent, "id" | "name">,
    runs: readonly HuntRun[],
    input: {
      dispatchId: string;
      runIds: readonly string[];
      parentSessionId?: string;
      coordinatorConversationId?: string | null;
      startedAt?: string;
    },
  ) => {
    const existing = sessionsRef.current.find(
      (session) => session.id === input.dispatchId,
    );
    if (existing) return existing.id;
    const selectedRunIds = new Set(input.runIds);
    const selectedRuns = runs.filter((run) => selectedRunIds.has(run.id));
    if (selectedRuns.length !== selectedRunIds.size) {
      throw new Error("전송한 이슈를 처리 세션에 연결하지 못했습니다.");
    }
    const startedAt = input.startedAt ?? new Date().toISOString();
    const parent = input.parentSessionId
      ? sessionsRef.current.find(
          (session) => session.id === input.parentSessionId,
        )
      : undefined;
    const session: AutoHuntSession = {
      id: input.dispatchId,
      dispatchGroupId: input.dispatchId,
      projectId,
      agentId: agent.id,
      agentName: agent.name,
      sessionType: "dispatch",
      trigger: parent?.trigger ?? "manual",
      parentSessionId: parent?.id,
      request: parent?.request,
      status: "running",
      issues: selectedRuns.map((run) => ({
        runId: run.id,
        runNumber: run.runNumber,
        sourceKey: run.sourceKey,
        title: run.title,
        outcome: "pending",
        summary: null,
      })),
      startedAt,
      completedAt: null,
      conversationId:
        input.coordinatorConversationId ?? parent?.conversationId ?? null,
      workspaceRoot: null,
      summary: null,
      error: null,
      events: [event("started", startedAt)],
      workers: [],
      dispatchEvents: [],
      updatedAt: startedAt,
      localOwner: true,
    };
    sessionsRef.current = [session, ...sessionsRef.current];
    setSessions(sessionsRef.current);
    return session.id;
  }, []);

  const adoptRemoteSession = useCallback((remote: AutoHuntSession) => {
    const next = mergeSynchronizedSessions(sessionsRef.current, [
      { ...remote, localOwner: false },
    ]);
    sessionsRef.current = next;
    setSessions(next);
    return remote.id;
  }, []);

  const reconcileWorkerDispatches = useCallback((
    projectId: string,
    runs: readonly HuntRun[],
  ) => {
    const now = new Date().toISOString();
    let changed = false;
    const next = sessionsRef.current.map((session) => {
      if (session.projectId !== projectId) return session;
      const reconciled = reconcileWorkerDispatchSession(session, runs, now);
      if (reconciled !== session) changed = true;
      return reconciled;
    });
    if (!changed) return;
    sessionsRef.current = next;
    setSessions(next);
  }, []);

  const settleTaskSession = useCallback((
    sessionId: string,
    input: {
      status: "completed" | "failed" | "skipped";
      conversationId: string | null;
      workspaceRoot: string | null;
      summary: string | null;
      error: string | null;
    },
  ) => {
    const completedAt = new Date().toISOString();
    const next = sessionsRef.current.map((session) =>
      session.id === sessionId && session.status === "running"
        ? {
            ...session,
            status: input.status,
            completedAt,
            conversationId: input.conversationId,
            workspaceRoot: input.workspaceRoot,
            summary: input.summary,
            error: input.error,
            updatedAt: completedAt,
            events: [...session.events, event(input.status, completedAt)],
          }
        : session
    );
    sessionsRef.current = next;
    setSessions(next);
  }, []);

  const stopSession = useCallback(async (sessionId: string) => {
    const session = sessionsRef.current.find(
      (candidate) => candidate.id === sessionId,
    );
    if (!session || session.status !== "running") return false;
    const pendingRunIds = session.sessionType === "dispatch"
      ? session.issues
          .filter((issue) => issue.outcome === "pending")
          .map((issue) => issue.runId)
      : [];
    let stopped: boolean;
    if (pendingRunIds.length > 0 && syncContext) {
      await Promise.all(
        pendingRunIds.map((runId) =>
          cancelHuntRun(
            syncContext.token,
            session.projectId,
            runId,
            "Agent 세션에서 실행을 중지했습니다.",
          )
        ),
      );
      stopped = true;
    } else {
      stopped = await stopper(sessionId);
    }
    if (!stopped) return false;
    const completedAt = new Date().toISOString();
    const next = sessionsRef.current.map((candidate) =>
      candidate.id === sessionId && candidate.status === "running"
        ? {
            ...candidate,
            status: "interrupted" as const,
            completedAt,
            error: null,
            updatedAt: completedAt,
            events: [...candidate.events, event("stopped", completedAt)],
          }
        : candidate
    );
    sessionsRef.current = next;
    setSessions(next);
    return true;
  }, [stopper, syncContext]);

  const recordTaskSession = useCallback((
    projectId: string,
    agentId: string,
    input: {
      sessionId: string;
      request: string;
      agentName?: string | null;
      startedAt: string;
      status: "completed" | "failed" | "skipped";
      conversationId: string | null;
      workspaceRoot: string | null;
      summary: string | null;
      error: string | null;
    },
  ) => {
    const sessionId = startTaskSession(projectId, agentId, {
      sessionId: input.sessionId,
      request: input.request,
      agentName: input.agentName,
      startedAt: input.startedAt,
    });
    settleTaskSession(sessionId, input);
    return sessionId;
  }, [settleTaskSession, startTaskSession]);

  return {
    sessions,
    adoptRemoteSession,
    startTaskSession,
    startWorkerDispatchSession,
    reconcileWorkerDispatches,
    settleTaskSession,
    stopSession,
    recordTaskSession,
    removeProjectSessions,
    configureSync,
  };
}
