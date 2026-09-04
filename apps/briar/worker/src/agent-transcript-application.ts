import {
  listAgentTranscriptSessionsForRun,
  readAgentWorkLog,
  readLatestAgentWorkLogForRun,
  type AgentTranscriptSessionSummary,
} from "./agent-worklog";
import {
  listArchivedTranscriptSessionsForRun,
  readArchivedWorkLog,
  readLatestArchivedWorkLogForRun,
} from "./archive";
import { HttpError } from "./http-response";

export type AgentTranscriptSelector =
  | { readonly sessionId: string }
  | { readonly latestForRunId: string };

export async function getProjectAgentTranscriptApplication(input: {
  readonly db: D1Database;
  readonly archives: R2Bucket;
  readonly projectId: string;
  readonly selector: AgentTranscriptSelector;
}) {
  const hot = "sessionId" in input.selector
    ? await readAgentWorkLog(
      input.db,
      input.projectId,
      input.selector.sessionId,
    )
    : await readLatestAgentWorkLogForRun(
      input.db,
      input.projectId,
      input.selector.latestForRunId,
    );
  const workLog = hot && hot.entries.length > 0
    ? hot
    : "sessionId" in input.selector
      ? await readArchivedWorkLog(
        input.db,
        input.archives,
        input.projectId,
        input.selector.sessionId,
      )
      : await readLatestArchivedWorkLogForRun(
        input.db,
        input.archives,
        input.projectId,
        input.selector.latestForRunId,
      );
  if (!workLog || workLog.entries.length === 0) {
    throw new HttpError(404, "Transcript not found");
  }
  return workLog;
}

/**
 * Sessions for one run, newest first. A session that is still hot wins over its
 * archive metadata so the live worker and provider stay visible.
 */
export async function listProjectAgentTranscriptSessionsApplication(input: {
  readonly db: D1Database;
  readonly projectId: string;
  readonly runId: string;
}): Promise<AgentTranscriptSessionSummary[]> {
  const [hot, archived] = await Promise.all([
    listAgentTranscriptSessionsForRun(input.db, input.projectId, input.runId),
    listArchivedTranscriptSessionsForRun(
      input.db,
      input.projectId,
      input.runId,
    ),
  ]);
  const sessions = new Map(
    [...archived, ...hot].map((session) => [session.session_id, session]),
  );
  return [...sessions.values()].sort((left, right) =>
    right.last_event_at.localeCompare(left.last_event_at) ||
    right.started_at.localeCompare(left.started_at) ||
    right.session_id.localeCompare(left.session_id)
  );
}
