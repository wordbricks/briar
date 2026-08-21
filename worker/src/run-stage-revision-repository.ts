import { type HuntRunRow } from "./hunt-run-model";
import { getHuntRunForProject } from "./hunt-run-repository";


export const loadStageRevisionRequirements = async (
  db: D1Database,
  run: HuntRunRow,
) => {
  const result = await db
    .prepare(
      `select workflow_stage, required_revision
       from briar_run_stage_revisions
       where run_id = ? and attempt = ?`,
    )
    .bind(run.id, run.current_attempt)
    .all<{ workflow_stage: string; required_revision: number }>();
  return new Map(
    result.results.map((item) => [
      item.workflow_stage,
      item.required_revision,
    ]),
  );
};

export async function listRunStageRevisions(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return null;
  const requirements = await loadStageRevisionRequirements(db, run);
  return {
    attempt: run.current_attempt,
    revision: run.current_revision,
    requirements,
  };
}
