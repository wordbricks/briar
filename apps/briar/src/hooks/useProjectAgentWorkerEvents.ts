import { useEffect, useState } from "react";
import type {
  GetProjectAgentTranscriptRequest,
  GetProjectAgentTranscriptResponse,
} from "@briar/contracts/gen/briar/app/v1/agent_transcript_pb";
import { ProjectAgentWorkLogEntryStatus } from "@briar/contracts/gen/briar/app/v1/agent_transcript_pb";
import { AgentActivityKind } from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import { loadProjectAgentTranscript } from "../lib/app-rpc/agent";
import { isApiErrorStatus } from "../lib/api/errors";
import {
  agentProviderFromProto,
  requiredMessage,
  requiredTimestamp,
  safeNumber,
} from "../lib/app-rpc/mappers";
import {
  mergeAutoHuntAppServerEvents,
  type AutoHuntAppServerEvent,
} from "../lib/auto-hunt-agent";
import type { AgentEvent } from "../generated/tauri";

const workerEventPollIntervalMs = 3_000;

type TranscriptTarget = {
  key: string;
  selector: GetProjectAgentTranscriptRequest["selector"];
};

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
  const transcriptTargets = [...new Map<string, TranscriptTarget>([
    ...runIds.map((runId): [string, TranscriptTarget] => [
      `run:${runId}`,
      {
        key: `run:${runId}`,
        selector: { case: "latestForRunId", value: runId },
      },
    ]),
    ...sessionIds.map((sessionId): [string, TranscriptTarget] => [
      `session:${sessionId}`,
      {
        key: `session:${sessionId}`,
        selector: { case: "sessionId", value: sessionId },
      },
    ]),
  ]).values()];
  const transcriptKey = transcriptTargets.map((target) => target.key).join(":");

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    let hasLoadedEvents = false;
    setEvents([]);
    setError(null);
    setIsLoading(Boolean(token && transcriptTargets.length));
    if (!token || transcriptTargets.length === 0) return;

    const refresh = async () => {
      const loaded = await Promise.allSettled(
        transcriptTargets.map(async (target) => {
          const transcript = await loadProjectAgentTranscript(
            token,
            projectId,
            target.selector,
          );
          return projectAgentTranscriptEvents(transcript);
        }),
      );
      if (!active) return;
      const incoming = loaded.flatMap((result) =>
        result.status === "fulfilled" ? result.value : []
      );
      if (incoming.length > 0) {
        hasLoadedEvents = true;
        setEvents((current) =>
          mergeAutoHuntAppServerEvents(current, incoming)
        );
      }
      // A session that has recorded nothing yet answers 404. That is an empty
      // work log, not a failure, so it must not hide the session picker behind
      // an error state.
      const failures = loaded.filter((result) =>
        result.status === "rejected" && !isApiErrorStatus(result.reason, 404)
      );
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
      if (live) {
        timer = window.setTimeout(refresh, workerEventPollIntervalMs);
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

export function projectAgentTranscriptEvents(
  transcript: GetProjectAgentTranscriptResponse,
): AutoHuntAppServerEvent[] {
  const session = requiredMessage(transcript.session, "agentTranscript.session");
  const provider = agentProviderFromProto(session.agentProvider);
  return transcript.entries.map((entry) => {
    const event = workLogEvent(entry, session.sessionId);
    return {
      sessionId: session.sessionId,
      sequence: safeNumber(entry.sequence, "agentTranscript.entry.sequence"),
      occurredAtMs: Date.parse(
        requiredTimestamp(entry.updatedAt, "agentTranscript.entry.updatedAt"),
      ),
      direction: "server" as const,
      message: {
        type: "worklog",
        entryId: entry.entryId,
        status: entry.status,
      },
      provider,
      event,
    };
  });
}

function workLogEvent(
  entry: GetProjectAgentTranscriptResponse["entries"][number],
  sessionId: string,
): AgentEvent {
  const id = `${sessionId}:${entry.entryId}`;
  switch (entry.entry.case) {
    case "message":
      return {
        type: workLogEntryIsWriting(entry.status)
          ? "messageStarted"
          : "messageCompleted",
        id,
        phase: entry.entry.value.phase ?? null,
        text: entry.entry.value.text,
      };
    case "activity": {
      const kind = activityKind(entry.entry.value.kind);
      if (entry.status === ProjectAgentWorkLogEntryStatus.WRITING) {
        return {
          type: "activityStarted",
          id,
          kind,
          title: entry.entry.value.title,
          text: entry.entry.value.text,
        };
      }
      return {
        type: "activityCompleted",
        id,
        kind,
        title: entry.entry.value.title,
        text: entry.entry.value.text,
        status: activityStatus(entry.status),
      };
    }
    default:
      throw new Error("Agent transcript entry is missing its payload");
  }
}

function workLogEntryIsWriting(
  value: ProjectAgentWorkLogEntryStatus,
): boolean {
  switch (value) {
    case ProjectAgentWorkLogEntryStatus.WRITING:
      return true;
    case ProjectAgentWorkLogEntryStatus.COMPLETED:
    case ProjectAgentWorkLogEntryStatus.FAILED:
    case ProjectAgentWorkLogEntryStatus.CANCELLED:
    case ProjectAgentWorkLogEntryStatus.INTERRUPTED:
      return false;
    default:
      throw new Error(`Unknown Agent transcript entry status: ${value}`);
  }
}

function activityKind(
  value: AgentActivityKind,
): Extract<AgentEvent, { type: "activityStarted" }>["kind"] {
  switch (value) {
    case AgentActivityKind.COMMAND:
      return "command";
    case AgentActivityKind.FILE_CHANGE:
      return "fileChange";
    case AgentActivityKind.WEB_SEARCH:
      return "webSearch";
    case AgentActivityKind.TOOL:
      return "tool";
    default:
      throw new Error(`Unknown Agent transcript activity kind: ${value}`);
  }
}

function activityStatus(
  value: ProjectAgentWorkLogEntryStatus,
): Extract<AgentEvent, { type: "activityCompleted" }>["status"] {
  switch (value) {
    case ProjectAgentWorkLogEntryStatus.COMPLETED:
      return "completed";
    case ProjectAgentWorkLogEntryStatus.FAILED:
      return "failed";
    case ProjectAgentWorkLogEntryStatus.CANCELLED:
    case ProjectAgentWorkLogEntryStatus.INTERRUPTED:
      return "cancelled";
    default:
      throw new Error(`Unknown terminal Agent transcript status: ${value}`);
  }
}
