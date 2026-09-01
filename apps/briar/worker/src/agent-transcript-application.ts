import {
  readAgentWorkLog,
  readLatestAgentWorkLogForRun,
} from "./agent-worklog";
import {
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
