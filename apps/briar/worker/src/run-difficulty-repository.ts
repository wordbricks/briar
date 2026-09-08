import type { IssueDifficulty } from "../../src/lib/issue-difficulty";

/*
  An issue's difficulty lives in `briar_run_difficulties`: one row per run, no
  row when the difficulty is unset, and a foreign key into the
  `briar_issue_difficulties` catalog rather than a CHECK list, so adding a
  difficulty is one insert instead of a rebuild of `briar_hunt_runs` and its
  foreign-key closure (see migration 0214 and
  docs/operations/d1-schema-changes.md).

  `briar_hunt_runs.difficulty` is still there -- SQLite refuses to drop a column
  named in a CHECK constraint -- but 0214 copied it into the side table and
  nothing writes it again. Everything below is what reads and writes it instead.
*/

/**
 * Joins the side table onto a `briar_hunt_runs` row already aliased `alias`.
 * Left, because "no row" is how an unset difficulty is spelled.
 */
export const runDifficultyJoinSql = (alias: string) =>
  `left join briar_run_difficulties run_difficulty
     on run_difficulty.run_id = ${alias}.id`;

/**
 * Projects the joined difficulty as `issue_difficulty`. Deliberately not
 * aliased back to `difficulty`: `select run.*` already carries the legacy
 * column under that name, and one name for two columns resolves by position.
 */
export const runDifficultySelectSql =
  "run_difficulty.difficulty as issue_difficulty";

/** The same value as a scalar subquery, for guards that cannot add a join. */
export const runDifficultyScalarSql = (alias: string) =>
  `(select side.difficulty from briar_run_difficulties side
     where side.run_id = ${alias}.id)`;

export const readRunDifficulty = (db: D1Database, runId: string) =>
  db
    .prepare(
      "select difficulty from briar_run_difficulties where run_id = ?",
    )
    .bind(runId)
    .first<IssueDifficulty>("difficulty");

/**
 * Sets a run's difficulty, or clears it when `difficulty` is null. Two
 * statements rather than an upsert with a conditional delete, because the
 * clear and the set then share one guard.
 *
 * `guardSql` is an extra predicate on a `briar_hunt_runs` row aliased `run`.
 * Callers that write the difficulty inside the same `db.batch` as a guarded
 * update of the run pass the guard that update established -- typically its new
 * `updated_at` -- so the difficulty only moves if the run update committed.
 */
export const runDifficultyWriteStatements = (
  db: D1Database,
  input: {
    runId: string;
    difficulty: IssueDifficulty | null;
    guardSql?: string;
    guardBindings?: readonly (string | number | null)[];
  },
) => {
  const guard = input.guardSql ? ` and ${input.guardSql}` : "";
  const guardBindings = input.guardBindings ?? [];
  return [
    db
      .prepare(
        `delete from briar_run_difficulties
         where run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = briar_run_difficulties.run_id${guard}
           )`,
      )
      .bind(input.runId, ...guardBindings),
    // A no-op when the difficulty is null: the delete above has already left
    // the run without a row, which is what "unset" means.
    db
      .prepare(
        `insert into briar_run_difficulties (run_id, difficulty)
         select run.id, ?
         from briar_hunt_runs run
         where run.id = ? and ? is not null${guard}`,
      )
      .bind(input.difficulty, input.runId, input.difficulty, ...guardBindings),
  ];
};

/**
 * The event-intake merge. Mirrors what the legacy column's
 * `difficulty = case when ? >= last_event_at then coalesce(?, difficulty) end`
 * did: a null difficulty never clears one that is already set, and an event
 * that arrives out of order never overwrites a newer one.
 *
 * Runs after the statement that advances `last_event_at`, which is harmless:
 * a fresh event has just set `last_event_at` to its own `occurredAt`, so the
 * comparison still holds, and a stale one left it alone, so it still fails.
 */
export const mergeRunDifficultyStatement = (
  db: D1Database,
  input: {
    runId: string;
    difficulty: IssueDifficulty | null;
    occurredAt: string;
  },
) =>
  db
    .prepare(
      `insert into briar_run_difficulties (run_id, difficulty)
       select run.id, ?
       from briar_hunt_runs run
       where run.id = ? and ? is not null and ? >= run.last_event_at
       on conflict (run_id) do update
         set difficulty = excluded.difficulty`,
    )
    .bind(
      input.difficulty,
      input.runId,
      input.difficulty,
      input.occurredAt,
    );
