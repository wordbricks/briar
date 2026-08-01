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
) {
  const [events, setEvents] = useState<AutoHuntAppServerEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runKey = runIds.join(":");

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    let hasLoadedEvents = false;
    const sequences = new Map<string, number>();
    setEvents([]);
    setError(null);
    setIsLoading(Boolean(token && runIds.length));
    if (!token || runIds.length === 0) return;

    const refresh = async () => {
      const loaded = await Promise.allSettled(
        runIds.map(async (runId) => {
          const sessionId = `detached-${runId}`;
          const transcript = await loadProjectAgentTranscript(
            token,
            projectId,
            sessionId,
            sequences.get(sessionId) ?? 0,
          );
          return {
            events: transcriptEvents(transcript),
            hasMore: transcript.events.at(-1)?.sequence !== undefined &&
              transcript.events.at(-1)!.sequence <
                transcript.session.eventCount,
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
  }, [live, projectId, runKey, token]);

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
  if (
    candidate.type === "turnCompleted" &&
    typeof candidate.status === "string"
  ) {
    return { type: candidate.type, status: candidate.status };
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
