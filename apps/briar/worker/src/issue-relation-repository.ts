import { type AutoHuntRunStatus } from "../../src/lib/auto-hunt-contract";

type JoinedRunFields = {
  run_number: number;
  title: string;
  status: AutoHuntRunStatus;
  paused_at: string | null;
};

export type IssueHierarchyRow = {
  project_id: string;
  parent_run_id: string;
  child_run_id: string;
  created_by_user_id: string | null;
  created_at: string;
  parent_run_number: number;
  parent_title: string;
  parent_status: AutoHuntRunStatus;
  parent_paused_at: string | null;
  child_run_number: number;
  child_title: string;
  child_status: AutoHuntRunStatus;
  child_paused_at: string | null;
};

export type IssueRelationRow = {
  project_id: string;
  first_run_id: string;
  second_run_id: string;
  relation_type: "related";
  created_by_user_id: string | null;
  created_at: string;
  first_run_number: number;
  first_title: string;
  first_status: AutoHuntRunStatus;
  first_paused_at: string | null;
  second_run_number: number;
  second_title: string;
  second_status: AutoHuntRunStatus;
  second_paused_at: string | null;
};

export type IssueHierarchyMutationOutcome =
  | "created"
  | "updated"
  | "already_exists"
  | "cycle"
  | "not_found";

export type IssueRelationMutationOutcome =
  | "created"
  | "already_exists"
  | "ineligible"
  | "not_found";

const hierarchySelect = `
  select hierarchy.project_id, hierarchy.parent_run_id,
         hierarchy.child_run_id, hierarchy.created_by_user_id,
         hierarchy.created_at,
         parent.run_number as parent_run_number,
         parent.title as parent_title,
         parent.status as parent_status,
         parent.paused_at as parent_paused_at,
         child.run_number as child_run_number,
         child.title as child_title,
         child.status as child_status,
         child.paused_at as child_paused_at
  from briar_issue_parent_links hierarchy
  join briar_hunt_runs parent on parent.id = hierarchy.parent_run_id
  join briar_hunt_runs child on child.id = hierarchy.child_run_id`;

const relationSelect = `
  select relation.project_id, relation.first_run_id,
         relation.second_run_id, relation.relation_type,
         relation.created_by_user_id, relation.created_at,
         first_run.run_number as first_run_number,
         first_run.title as first_title,
         first_run.status as first_status,
         first_run.paused_at as first_paused_at,
         second_run.run_number as second_run_number,
         second_run.title as second_title,
         second_run.status as second_status,
         second_run.paused_at as second_paused_at
  from briar_issue_relations relation
  join briar_hunt_runs first_run on first_run.id = relation.first_run_id
  join briar_hunt_runs second_run on second_run.id = relation.second_run_id`;

export async function listIssueHierarchy(
  db: D1Database,
  projectId: string,
) {
  const result = await db.prepare(
    `${hierarchySelect}
     where hierarchy.project_id = ?
     order by hierarchy.created_at, hierarchy.parent_run_id,
              hierarchy.child_run_id`,
  ).bind(projectId).all<IssueHierarchyRow>();
  return result.results;
}

export async function listIssueHierarchyByRunIds(
  db: D1Database,
  projectId: string,
  runIds: readonly string[],
) {
  if (runIds.length === 0) return [];
  const serialized = JSON.stringify([...new Set(runIds)]);
  const result = await db.prepare(
    `${hierarchySelect}
     where hierarchy.project_id = ?
       and (
         hierarchy.parent_run_id in (select value from json_each(?))
         or hierarchy.child_run_id in (select value from json_each(?))
       )
     order by hierarchy.created_at, hierarchy.parent_run_id,
              hierarchy.child_run_id`,
  ).bind(projectId, serialized, serialized).all<IssueHierarchyRow>();
  return result.results;
}

export async function listIssueRelations(
  db: D1Database,
  projectId: string,
) {
  const result = await db.prepare(
    `${relationSelect}
     where relation.project_id = ?
     order by relation.created_at, relation.first_run_id,
              relation.second_run_id`,
  ).bind(projectId).all<IssueRelationRow>();
  return result.results;
}

export async function listIssueRelationsByRunIds(
  db: D1Database,
  projectId: string,
  runIds: readonly string[],
) {
  if (runIds.length === 0) return [];
  const serialized = JSON.stringify([...new Set(runIds)]);
  const result = await db.prepare(
    `${relationSelect}
     where relation.project_id = ?
       and (
         relation.first_run_id in (select value from json_each(?))
         or relation.second_run_id in (select value from json_each(?))
       )
     order by relation.created_at, relation.first_run_id,
              relation.second_run_id`,
  ).bind(projectId, serialized, serialized).all<IssueRelationRow>();
  return result.results;
}

async function runInProject(
  db: D1Database,
  projectId: string,
  runId: string,
): Promise<JoinedRunFields | null> {
  return db.prepare(
    `select run_number, title, status, paused_at
     from briar_hunt_runs where project_id = ? and id = ?`,
  ).bind(projectId, runId).first<JoinedRunFields>();
}

export async function setIssueParent(
  db: D1Database,
  projectId: string,
  input: {
    childRunId: string;
    parentRunId: string;
    createdByUserId: string | null;
    createdAt: string;
  },
): Promise<IssueHierarchyMutationOutcome> {
  if (input.childRunId === input.parentRunId) return "cycle";
  const [child, parent, existing] = await Promise.all([
    runInProject(db, projectId, input.childRunId),
    runInProject(db, projectId, input.parentRunId),
    db.prepare(
      `select parent_run_id from briar_issue_parent_links
       where project_id = ? and child_run_id = ?`,
    ).bind(projectId, input.childRunId).first<{ parent_run_id: string }>(),
  ]);
  if (!child || !parent) return "not_found";
  if (existing?.parent_run_id === input.parentRunId) return "already_exists";

  const cycle = await db.prepare(
    `with recursive descendants(run_id) as (
       values (?)
       union
       select hierarchy.child_run_id
       from briar_issue_parent_links hierarchy
       join descendants on descendants.run_id = hierarchy.parent_run_id
       where hierarchy.project_id = ?
     )
     select 1 as present from descendants where run_id = ?`,
  ).bind(input.childRunId, projectId, input.parentRunId)
    .first<{ present: number }>();
  if (cycle) return "cycle";

  await db.prepare(
    `insert into briar_issue_parent_links (
       project_id, parent_run_id, child_run_id, created_by_user_id, created_at
     ) values (?, ?, ?, ?, ?)
     on conflict (child_run_id) do update set
       project_id = excluded.project_id,
       parent_run_id = excluded.parent_run_id,
       created_by_user_id = excluded.created_by_user_id,
       created_at = excluded.created_at`,
  ).bind(
    projectId,
    input.parentRunId,
    input.childRunId,
    input.createdByUserId,
    input.createdAt,
  ).run();
  return existing ? "updated" : "created";
}

export async function deleteIssueParent(
  db: D1Database,
  projectId: string,
  childRunId: string,
) {
  const result = await db.prepare(
    `delete from briar_issue_parent_links
     where project_id = ? and child_run_id = ?`,
  ).bind(projectId, childRunId).run();
  return result.meta.changes > 0;
}

const normalizedPair = (left: string, right: string) =>
  left < right ? [left, right] as const : [right, left] as const;

export async function createIssueRelation(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    relatedRunId: string;
    createdByUserId: string | null;
    createdAt: string;
  },
): Promise<IssueRelationMutationOutcome> {
  if (input.runId === input.relatedRunId) return "ineligible";
  const [run, related] = await Promise.all([
    runInProject(db, projectId, input.runId),
    runInProject(db, projectId, input.relatedRunId),
  ]);
  if (!run || !related) return "not_found";
  const [firstRunId, secondRunId] = normalizedPair(
    input.runId,
    input.relatedRunId,
  );
  const result = await db.prepare(
    `insert into briar_issue_relations (
       project_id, first_run_id, second_run_id, relation_type,
       created_by_user_id, created_at
     ) values (?, ?, ?, 'related', ?, ?)
     on conflict (first_run_id, second_run_id) do nothing`,
  ).bind(
    projectId,
    firstRunId,
    secondRunId,
    input.createdByUserId,
    input.createdAt,
  ).run();
  return result.meta.changes > 0 ? "created" : "already_exists";
}

export async function deleteIssueRelation(
  db: D1Database,
  projectId: string,
  runId: string,
  relatedRunId: string,
) {
  if (runId === relatedRunId) return false;
  const [firstRunId, secondRunId] = normalizedPair(runId, relatedRunId);
  const result = await db.prepare(
    `delete from briar_issue_relations
     where project_id = ? and first_run_id = ? and second_run_id = ?`,
  ).bind(projectId, firstRunId, secondRunId).run();
  return result.meta.changes > 0;
}
