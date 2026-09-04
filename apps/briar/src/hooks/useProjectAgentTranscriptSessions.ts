import { useEffect, useState } from "react";
import type {
  ProjectAgentTranscriptSessionSummary,
} from "@briar/contracts/gen/briar/app/v1/agent_transcript_pb";
import { loadProjectAgentTranscriptSessions } from "../lib/app-rpc/agent";
import {
  optionalAgentProviderFromProto,
  requiredTimestamp,
} from "../lib/app-rpc/mappers";
import type { AgentProvider } from "../lib/agent-provider";

/**
 * Every claim of a run records its own transcript session, so a run that was
 * reclaimed keeps the earlier work logs under their own session ids.
 */
export type ProjectAgentTranscriptSession = {
  sessionId: string;
  workerId: string | null;
  provider: AgentProvider | null;
  startedAtMs: number;
  lastEventAtMs: number;
  archived: boolean;
};

const sessionPollIntervalMs = 15_000;

export function useProjectAgentTranscriptSessions(
  token: string | null,
  projectId: string,
  runId: string | null,
  live: boolean,
) {
  const [sessions, setSessions] = useState<ProjectAgentTranscriptSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    setSessions([]);
    setError(null);
    setIsLoading(Boolean(token && runId));
    if (!token || !runId) return;

    const refresh = async () => {
      try {
        const response = await loadProjectAgentTranscriptSessions(
          token,
          projectId,
          runId,
        );
        if (!active) return;
        setSessions(response.sessions.map(projectAgentTranscriptSession));
        setError(null);
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (active) {
          setIsLoading(false);
          if (live) timer = window.setTimeout(refresh, sessionPollIntervalMs);
        }
      }
    };

    void refresh();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [live, projectId, runId, token]);

  return { sessions, isLoading, error };
}

export function projectAgentTranscriptSession(
  session: ProjectAgentTranscriptSessionSummary,
): ProjectAgentTranscriptSession {
  return {
    sessionId: session.sessionId,
    workerId: session.workerId ?? null,
    // Archived sessions no longer carry their provider, so the list keeps them
    // provider-less instead of guessing one.
    provider: optionalAgentProviderFromProto(session.agentProvider),
    startedAtMs: Date.parse(
      requiredTimestamp(session.startedAt, "transcriptSession.startedAt"),
    ),
    lastEventAtMs: Date.parse(
      requiredTimestamp(session.lastEventAt, "transcriptSession.lastEventAt"),
    ),
    archived: session.archived,
  };
}
