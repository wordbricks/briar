import type { TeamIdLike } from "../../src/lib/entity-ids";
import { type HuntRunRow } from "./hunt-run-model";
import {
  runDifficultyJoinSql,
  runDifficultySelectSql,
} from "./run-difficulty-repository";

// TODO(team-id-brand): tighten to `projectId: TeamId`. Roughly 25 repository
// and application entry points still hand this an unbranded string; until they
// are threaded through, `TeamIdLike` at least rejects a PlanningProjectId.
export async function getHuntRunForProject(
  db: D1Database,
  projectId: TeamIdLike,
  runId: string,
) {
  return db
    .prepare(
      `select run.*, ${runDifficultySelectSql}
       from briar_hunt_runs run
       ${runDifficultyJoinSql("run")}
       where run.id = ? and run.project_id = ?`,
    )
    .bind(runId, projectId)
    .first<HuntRunRow>();
}
