import { readLatestArchivedWorkLogForRun } from "./archive";
import { readLatestAgentWorkLogForRun } from "./agent-worklog";

export async function readLatestWorkLogForRunWithArchive(
  db: D1Database,
  archivesBucket: R2Bucket,
  projectId: string,
  runId: string,
  limit = 200,
) {
  const hot = await readLatestAgentWorkLogForRun(db, projectId, runId);
  const workLog = hot && hot.entries.length > 0
    ? hot
    : await readLatestArchivedWorkLogForRun(
        db,
        archivesBucket,
        projectId,
        runId,
      );
  return workLog
    ? { ...workLog, entries: workLog.entries.slice(-Math.min(limit, 1_000)) }
    : null;
}
