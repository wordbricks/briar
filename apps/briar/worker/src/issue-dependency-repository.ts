import { type AutoHuntRunStatus } from "../../src/lib/auto-hunt-contract";

export type IssueDependencyRow = {
  project_id: string;
  prerequisite_run_id: string;
  dependent_run_id: string;
  created_by_user_id: string | null;
  created_at: string;
  prerequisite_run_number: number;
  prerequisite_title: string;
  prerequisite_status: AutoHuntRunStatus;
  prerequisite_paused_at: string | null;
  dependent_run_number: number;
  dependent_title: string;
  dependent_status: AutoHuntRunStatus;
  dependent_paused_at: string | null;
};

export type IssueDependencyMutationOutcome =
  | "created"
  | "already_exists"
  | "cycle"
  | "ineligible"
  | "not_found";

export async function listIssueDependencies(
  db: D1Database,
  projectId: string,
) {
  const result = await db
    .prepare(
      `select dependency.project_id, dependency.prerequisite_run_id,
              dependency.dependent_run_id, dependency.created_by_user_id,
              dependency.created_at,
              prerequisite.run_number as prerequisite_run_number,
              prerequisite.title as prerequisite_title,
              prerequisite.status as prerequisite_status,
              prerequisite.paused_at as prerequisite_paused_at,
              dependent.run_number as dependent_run_number,
              dependent.title as dependent_title,
              dependent.status as dependent_status,
              dependent.paused_at as dependent_paused_at
       from briar_issue_dependencies dependency
       join briar_hunt_runs prerequisite
         on prerequisite.id = dependency.prerequisite_run_id
       join briar_hunt_runs dependent
         on dependent.id = dependency.dependent_run_id
       where dependency.project_id = ?
       order by dependency.created_at, dependency.prerequisite_run_id,
                dependency.dependent_run_id`,
    )
    .bind(projectId)
    .all<IssueDependencyRow>();
  return result.results;
}

export async function listIssueDependenciesByRunIds(
  db: D1Database,
  projectId: string,
  runIds: readonly string[],
) {
  if (runIds.length === 0) return [];
  const serializedRunIds = JSON.stringify([...new Set(runIds)]);
  const result = await db
    .prepare(
      `select dependency.project_id, dependency.prerequisite_run_id,
              dependency.dependent_run_id, dependency.created_by_user_id,
              dependency.created_at,
              prerequisite.run_number as prerequisite_run_number,
              prerequisite.title as prerequisite_title,
              prerequisite.status as prerequisite_status,
              prerequisite.paused_at as prerequisite_paused_at,
              dependent.run_number as dependent_run_number,
              dependent.title as dependent_title,
              dependent.status as dependent_status,
              dependent.paused_at as dependent_paused_at
       from briar_issue_dependencies dependency
       join briar_hunt_runs prerequisite
         on prerequisite.id = dependency.prerequisite_run_id
       join briar_hunt_runs dependent
         on dependent.id = dependency.dependent_run_id
       where dependency.project_id = ?
         and (
           dependency.prerequisite_run_id in (select value from json_each(?))
           or dependency.dependent_run_id in (select value from json_each(?))
         )
       order by dependency.created_at, dependency.prerequisite_run_id,
                dependency.dependent_run_id`,
    )
    .bind(projectId, serializedRunIds, serializedRunIds)
    .all<IssueDependencyRow>();
  return result.results;
}

export async function createIssueDependency(
  db: D1Database,
  projectId: string,
  input: {
    prerequisiteRunId: string;
    dependentRunId: string;
    createdByUserId: string | null;
    createdAt: string;
  },
  options: { allowStartedDependent?: boolean } = {},
): Promise<IssueDependencyMutationOutcome> {
  const inserted = await db
    .prepare(
      `with recursive reachable(run_id) as (
         values (?)
         union
         select dependency.dependent_run_id
         from briar_issue_dependencies dependency
         join reachable
           on reachable.run_id = dependency.prerequisite_run_id
         where dependency.project_id = ?
       )
       insert into briar_issue_dependencies (
         project_id, prerequisite_run_id, dependent_run_id,
         created_by_user_id, created_at
       )
       select ?, ?, ?, ?, ?
       where exists (
         select 1 from briar_hunt_runs
         where id = ? and project_id = ?
       )
         and exists (
           select 1 from briar_hunt_runs
           where id = ? and project_id = ?
             and (
               ? = 1
               or status in ('backlog', 'queued', 'blocked', 'failed')
             )
         )
         and not exists (
           select 1 from reachable where run_id = ?
         )
       on conflict (prerequisite_run_id, dependent_run_id) do nothing
       returning prerequisite_run_id`,
    )
    .bind(
      input.dependentRunId,
      projectId,
      projectId,
      input.prerequisiteRunId,
      input.dependentRunId,
      input.createdByUserId,
      input.createdAt,
      input.prerequisiteRunId,
      projectId,
      input.dependentRunId,
      projectId,
      options.allowStartedDependent ? 1 : 0,
      input.prerequisiteRunId,
    )
    .first<{ prerequisite_run_id: string }>();
  if (inserted) return "created";

  const runs = await db
    .prepare(
      `select
         exists(
           select 1 from briar_hunt_runs
           where project_id = ? and id = ?
         ) as prerequisite_exists,
         exists(
           select 1 from briar_hunt_runs
           where project_id = ? and id = ?
         ) as dependent_exists,
         (select status from briar_hunt_runs
          where project_id = ? and id = ?) as dependent_status`,
    )
    .bind(
      projectId,
      input.prerequisiteRunId,
      projectId,
      input.dependentRunId,
      projectId,
      input.dependentRunId,
    )
    .first<{
      prerequisite_exists: number;
      dependent_exists: number;
      dependent_status: AutoHuntRunStatus | null;
    }>();
  if (!runs?.prerequisite_exists || !runs.dependent_exists) return "not_found";

  const existing = await db
    .prepare(
      `select 1 as present from briar_issue_dependencies
       where project_id = ? and prerequisite_run_id = ?
         and dependent_run_id = ?`,
    )
    .bind(projectId, input.prerequisiteRunId, input.dependentRunId)
    .first<{ present: number }>();
  if (existing) return "already_exists";
  if (
    !options.allowStartedDependent &&
    !["backlog", "queued", "blocked", "failed"].includes(
      runs.dependent_status ?? "",
    )
  ) {
    return "ineligible";
  }
  return "cycle";
}

export async function deleteIssueDependency(
  db: D1Database,
  projectId: string,
  prerequisiteRunId: string,
  dependentRunId: string,
) {
  const result = await db
    .prepare(
      `delete from briar_issue_dependencies
       where project_id = ? and prerequisite_run_id = ?
         and dependent_run_id = ?`,
    )
    .bind(projectId, prerequisiteRunId, dependentRunId)
    .run();
  return result.meta.changes > 0;
}
