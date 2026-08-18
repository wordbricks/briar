import { useEffect, useState } from "react";
import {
  loadProjectAgentTranscript,
  type ProjectAgentTranscript,
} from "../lib/api";
import {
  mergeAutoHuntAppServerEvents,
  type AutoHuntAgentEvent,
  type AutoHuntAppServerEvent,
} from "../lib/auto-hunt-agent";

const workerEventPollIntervalMs = 3_000;

export function useProjectAgentWorkerEvents(
  token: string | null,
  projectId: string,
  runIds: readonly string[],
  live: boolean,
  sessionIds: readonly string[] = [],
) {
  const [events, setEvents] = useState<AutoHuntAppServerEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcriptIds = [...new Set([
    ...runIds.map((runId) => `detached-${runId}`),
    ...sessionIds,
  ])];
  const transcriptKey = transcriptIds.join(":");

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    let hasLoadedEvents = false;
    const sequences = new Map<string, number>();
    const receivedEventCounts = new Map<string, number>();
    const activeSessionIds = new Map<string, string>();
    setEvents([]);
    setError(null);
    setIsLoading(Boolean(token && transcriptIds.length));
    if (!token || transcriptIds.length === 0) return;

    const refresh = async () => {
      const loaded = await Promise.allSettled(
        transcriptIds.map(async (requestedSessionId) => {
          const previousSessionId = activeSessionIds.get(requestedSessionId);
          let transcript = await loadProjectAgentTranscript(
            token,
            projectId,
            requestedSessionId,
            previousSessionId
              ? (sequences.get(previousSessionId) ?? 0)
              : 0,
          );
          // The alias resolves to the newest execution-scoped session. When a
          // retry or transfer creates a new session, its sequence starts over;
          // reload from zero instead of applying the previous session cursor.
          if (
            previousSessionId &&
            transcript.session.sessionId !== previousSessionId
          ) {
            transcript = await loadProjectAgentTranscript(
              token,
              projectId,
              requestedSessionId,
              0,
            );
          }
          const sessionId = transcript.session.sessionId;
          activeSessionIds.set(requestedSessionId, sessionId);
          const receivedEventCount =
            (receivedEventCounts.get(sessionId) ?? 0) + transcript.events.length;
          receivedEventCounts.set(sessionId, receivedEventCount);
          return {
            events: transcriptEvents(transcript),
            // Retry/resume claims deliberately use non-contiguous sequence
            // ranges. Compare counts instead of the last sequence cursor when
            // deciding whether another page remains.
            hasMore: receivedEventCount < transcript.session.eventCount,
          };
        }),
      );
      if (!active) return;
      const incoming = loaded.flatMap((result) =>
        result.status === "fulfilled" ? result.value.events : []
      );
      for (const event of incoming) {
        sequences.set(
          event.sessionId,
          Math.max(sequences.get(event.sessionId) ?? 0, event.sequence),
        );
      }
      if (incoming.length > 0) {
        hasLoadedEvents = true;
        setEvents((current) =>
          mergeAutoHuntAppServerEvents(current, incoming)
        );
      }
      const failures = loaded.filter((result) => result.status === "rejected");
      if (failures.length === loaded.length && !live && !hasLoadedEvents) {
        const reason = failures[0];
        setError(
          reason?.status === "rejected"
            ? reason.reason instanceof Error
              ? reason.reason.message
              : String(reason.reason)
            : null,
        );
      } else {
        setError(null);
      }
      setIsLoading(false);
      const hasMore = loaded.some((result) =>
        result.status === "fulfilled" && result.value.hasMore
      );
      if (hasMore || live) {
        timer = window.setTimeout(
          refresh,
          hasMore ? 0 : workerEventPollIntervalMs,
        );
      }
    };

    void refresh();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [live, projectId, transcriptKey, token]);

  return { events, isLoading, error };
}

function transcriptEvents(
  transcript: ProjectAgentTranscript,
): AutoHuntAppServerEvent[] {
  return transcript.events.map((event) => {
    const message = record(event.message) ?? { value: event.message };
    return {
      sessionId: transcript.session.sessionId,
      sequence: event.sequence,
      occurredAtMs: Date.parse(event.recordedAt),
      direction: event.direction,
      message,
      provider: transcript.session.agentProvider,
      event: normalizedAgentEvent(message.event, transcript.session.sessionId),
    };
  });
}

function normalizedAgentEvent(
  value: unknown,
  sessionId: string,
): AutoHuntAgentEvent | undefined {
  const candidate = record(value);
  if (!candidate || typeof candidate.type !== "string") return undefined;
  if (
    (candidate.type === "messageStarted" ||
      candidate.type === "messageCompleted") &&
    typeof candidate.id === "string" &&
    typeof candidate.text === "string"
  ) {
    return {
      type: candidate.type,
      id: `${sessionId}:${candidate.id}`,
      phase: typeof candidate.phase === "string" ? candidate.phase : null,
      text: candidate.text,
    };
  }
  if (
    candidate.type === "messageDelta" &&
    typeof candidate.id === "string" &&
    typeof candidate.delta === "string"
  ) {
    return {
      type: candidate.type,
      id: `${sessionId}:${candidate.id}`,
      delta: candidate.delta,
    };
  }
  const normalizedActivityKind = activityKind(candidate.kind);
  if (
    (candidate.type === "activityStarted" ||
      candidate.type === "activityCompleted") &&
    typeof candidate.id === "string" &&
    normalizedActivityKind &&
    typeof candidate.title === "string" &&
    typeof candidate.text === "string"
  ) {
    if (candidate.type === "activityStarted") {
      return {
        type: candidate.type,
        id: `${sessionId}:${candidate.id}`,
        kind: normalizedActivityKind,
        title: candidate.title,
        text: candidate.text,
      };
    }
    const status = activityStatus(candidate.status);
    if (!status) return undefined;
    return {
      type: candidate.type,
      id: `${sessionId}:${candidate.id}`,
      kind: normalizedActivityKind,
      title: candidate.title,
      text: candidate.text,
      status,
    };
  }
  if (
    candidate.type === "activityDelta" &&
    typeof candidate.id === "string" &&
    typeof candidate.delta === "string"
  ) {
    return {
      type: candidate.type,
      id: `${sessionId}:${candidate.id}`,
      delta: candidate.delta,
    };
  }
  if (
    candidate.type === "turnCompleted" &&
    typeof candidate.status === "string"
  ) {
    return { type: candidate.type, status: candidate.status };
  }
  return undefined;
}

function activityKind(
  value: unknown,
): "command" | "fileChange" | "webSearch" | "tool" | null {
  return value === "command" ||
      value === "fileChange" ||
      value === "webSearch" ||
      value === "tool"
    ? value
    : null;
}

function activityStatus(
  value: unknown,
): "completed" | "failed" | "cancelled" | null {
  return value === "completed" || value === "failed" || value === "cancelled"
    ? value
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
