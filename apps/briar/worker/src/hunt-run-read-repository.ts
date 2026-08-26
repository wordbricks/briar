import { type HuntRunRow } from "./hunt-run-model";

export type OrganizationStatusTrayRunRow = Pick<
  HuntRunRow,
  | "id"
  | "title"
  | "status"
  | "workflow_stage"
  | "workflow_snapshot_json"
  | "started_at"
  | "updated_at"
  | "last_event_at"
> & {
  project_id: string;
  project_name: string;
};

export async function listDashboardRuns(db: D1Database, projectId: string) {
  const runs = await db
    .prepare(
      `select run.*,
              coalesce((
                select json_group_array(json_object(
                  'userId', subscriber.user_id,
                  'subscribedAt', subscriber.created_at
                ))
                from (
                  select subscription.user_id, subscription.created_at
                  from briar_issue_subscriptions subscription
                  where subscription.run_id = run.id
                  order by subscription.created_at, subscription.user_id
                ) subscriber
              ), '[]') as subscribers_json,
              run.event_count + coalesce((
                select sum(archive.row_count)
                from briar_log_archives archive
                where archive.run_id = run.id
                  and archive.archive_kind = 'run_events'
                  and archive.status = 'complete'
              ), 0) as event_count
       from briar_hunt_runs run
       where run.project_id = ?
       order by
         case when run.status in ('completed', 'cancelled') then 1 else 0 end,
         run.updated_at desc
       limit 200`,
    )
    .bind(projectId)
    .all<HuntRunRow>();

  return runs.results;
}

export async function listDashboardRunsByIds(
  db: D1Database,
  projectId: string,
  runIds: readonly string[],
) {
  if (runIds.length === 0) return [];
  const runs = await db
    .prepare(
      `select run.*,
              coalesce((
                select json_group_array(json_object(
                  'userId', subscriber.user_id,
                  'subscribedAt', subscriber.created_at
                ))
                from (
                  select subscription.user_id, subscription.created_at
                  from briar_issue_subscriptions subscription
                  where subscription.run_id = run.id
                  order by subscription.created_at, subscription.user_id
                ) subscriber
              ), '[]') as subscribers_json,
              run.event_count + coalesce((
                select sum(archive.row_count)
                from briar_log_archives archive
                where archive.run_id = run.id
                  and archive.archive_kind = 'run_events'
                  and archive.status = 'complete'
              ), 0) as event_count
       from briar_hunt_runs run
       where run.project_id = ?
         and run.id in (select value from json_each(?))
       order by run.updated_at desc`,
    )
    .bind(projectId, JSON.stringify([...new Set(runIds)]))
    .all<HuntRunRow>();

  return runs.results;
}

export async function listOrganizationStatusTrayRuns(
  db: D1Database,
  organizationId: string,
  userId: string,
) {
  const runs = await db
    .prepare(
      `select project.id as project_id, project.name as project_name,
              run.id, run.title, run.status, run.workflow_stage,
              run.workflow_snapshot_json, run.started_at, run.updated_at,
              run.last_event_at
       from briar_hunt_runs run
       join briar_projects project on project.id = run.project_id
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = ?
       left join briar_project_members project_membership
         on project_membership.project_id = project.id
        and project_membership.organization_id = project.organization_id
        and project_membership.user_id = membership.user_id
       where project.organization_id = ?
         and (
           membership.role in ('owner', 'admin')
           or project_membership.user_id is not null
         )
         and run.status = 'running'
         and run.paused_at is null
       order by run.updated_at desc, run.id
       limit 200`,
    )
    .bind(userId, organizationId)
    .all<OrganizationStatusTrayRunRow>();

  return runs.results;
}
