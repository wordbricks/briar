import { useCallback, useEffect, useRef, useState } from "react";
import {
  maxAutoHuntSessionIssues,
  startProjectAutoHunt,
  type AutoHuntAgentResponse,
} from "../lib/auto-hunt-agent";
import type { HuntRun } from "../types";

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
  projectId: string;
  status: AutoHuntSessionStatus;
  issues: AutoHuntSessionIssue[];
  startedAt: string;
  completedAt: string | null;
  conversationId: string | null;
  workspaceRoot: string | null;
  summary: string | null;
  error: string | null;
  events: AutoHuntSessionEvent[];
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
    return restored.map((session) => session.status === "running"
      ? {
          ...session,
          status: "interrupted",
          completedAt: interruptedAt,
          error: null,
          events: [...session.events, event("interrupted", interruptedAt)],
        }
      : session);
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
    status: "completed",
    completedAt,
    conversationId: response.conversationId,
    workspaceRoot: response.workspaceRoot,
    summary: response.result.summary,
    error: null,
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
    onSettled?: () => void,
  ) => {
    if (sessionsRef.current.some(
      (session) => session.projectId === projectId && session.status === "running",
    )) {
      throw new Error("이 프로젝트에서 이미 자동사냥 세션이 진행 중입니다.");
    }
    const candidates = runs
      .filter((run) => run.status === "queued")
      .slice(0, maxAutoHuntSessionIssues);
    if (candidates.length === 0) {
      throw new Error("대기 상태인 이슈가 없습니다.");
    }
    const startedAt = new Date().toISOString();
    const session: AutoHuntSession = {
      id: crypto.randomUUID(),
      projectId,
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
    };
    sessionsRef.current = [session, ...sessionsRef.current];
    setSessions(sessionsRef.current);

    void runner(projectId, candidates, session.id)
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
