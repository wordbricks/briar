import {
  type AutoHuntRunStatus,
  type AutoHuntSource,
} from "../../src/lib/auto-hunt-contract";
import type {
  PlanningProjectId,
  TeamId,
} from "../../src/lib/entity-ids";
import { type HuntRunRow } from "./hunt-run-model";
import {
  runDifficultyJoinSql,
  runDifficultySelectSql,
} from "./run-difficulty-repository";

export type DashboardRunListCursor = {
  readonly snapshotAt: string;
  readonly statusRank: number;
  readonly updatedAt: string;
  readonly id: string;
};

export type DashboardRunListFilters = {
  readonly pageSize: number;
  readonly cursor?: DashboardRunListCursor | null;
  readonly sources?: readonly AutoHuntSource[];
  readonly statuses?: readonly AutoHuntRunStatus[];
  readonly query?: string | null;
  readonly planningProjectId?: PlanningProjectId | null;
};

export type DashboardRunSummaryRow = Pick<
  HuntRunRow,
  | "id"
  | "project_id"
  | "workspace_id"
  | "team_id"
  | "planning_project_id"
  | "planning_project_name"
  | "run_number"
  | "current_attempt"
  | "current_revision"
  | "source"
  | "source_key"
  | "source_created_at"
  | "title"
  | "status"
  | "workflow_stage"
  | "workflow_snapshot_json"
  | "detail"
  | "priority"
  | "issue_difficulty"
  | "assignee_user_id"
  | "issue_description"
  | "result_summary"
  | "full_auto"
  | "pull_request_urls"
  | "claimed_by"
  | "claimed_at"
  | "lease_expires_at"
  | "preferred_agent_provider"
  | "preferred_agent_model"
  | "preferred_agent_effort"
  | "requested_agent_provider"
  | "requested_agent_model"
  | "requested_agent_effort"
  | "requested_worker_id"
  | "worker_id"
  | "started_at"
  | "updated_at"
  | "completed_at"
  | "last_event_at"
  | "event_count"
  | "paused_at"
  | "repository"
> & {
  readonly waiting_on_prerequisite_count: number;
  readonly has_result_review: number;
};

export type DashboardRunListPage = {
  readonly rows: readonly DashboardRunSummaryRow[];
  readonly nextCursor: DashboardRunListCursor | null;
};

const listPageSize = (pageSize: number) =>
  Math.max(30, Math.min(50, Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 40));

export const encodeDashboardRunListCursor = (value: DashboardRunListCursor) =>
  btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

export const decodeDashboardRunListCursor = (
  encoded: string,
): DashboardRunListCursor => {
  try {
    const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded)) as Partial<DashboardRunListCursor>;
    if (
      typeof parsed.snapshotAt !== "string" ||
      typeof parsed.statusRank !== "number" ||
      !Number.isInteger(parsed.statusRank) ||
      typeof parsed.updatedAt !== "string" ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0
    ) {
      throw new Error("invalid cursor shape");
    }
    return {
      snapshotAt: parsed.snapshotAt,
      statusRank: parsed.statusRank,
      updatedAt: parsed.updatedAt,
      id: parsed.id,
    };
  } catch {
    throw new Error("Invalid dashboard list cursor");
  }
};

const dashboardStatusRank = (status: string) =>
  status === "completed" || status === "cancelled" ? 1 : 0;

const dashboardSummarySelect = `
  select run.id, run.project_id, team.organization_id as workspace_id,
         run.project_id as team_id, run.planning_project_id,
         planning_project.name as planning_project_name,
         run.run_number, run.current_attempt, run.current_revision,
         run.source, run.source_key, run.source_created_at, run.title,
         run.status, run.workflow_stage, run.workflow_snapshot_json,
         run.detail, run.priority, ${runDifficultySelectSql},
         run.assignee_user_id,
         run.issue_description, run.result_summary, run.full_auto,
         run.pull_request_urls, run.claimed_by, run.claimed_at,
         run.lease_expires_at, run.preferred_agent_provider,
         run.preferred_agent_model, run.preferred_agent_effort,
         run.requested_agent_provider, run.requested_agent_model,
         run.requested_agent_effort, run.requested_worker_id, run.worker_id,
         run.started_at, run.updated_at, run.completed_at, run.last_event_at,
         run.paused_at, run.repository,
         run.event_count + coalesce((
           select sum(archive.row_count)
           from briar_log_archives archive
           where archive.run_id = run.id
             and archive.archive_kind = 'run_events'
             and archive.status = 'complete'
         ), 0) as event_count,
         (
           select count(*)
           from briar_issue_dependencies dependency
           join briar_hunt_runs prerequisite
             on prerequisite.id = dependency.prerequisite_run_id
           where dependency.project_id = run.project_id
             and dependency.dependent_run_id = run.id
             and prerequisite.status <> 'completed'
         ) as waiting_on_prerequisite_count,
         exists(
           select 1
           from briar_issue_result_reviews review
           where review.run_id = run.id
         ) as has_result_review
    from briar_hunt_runs run
    join briar_teams team on team.id = run.project_id
    join briar_planning_projects planning_project
      on planning_project.id = run.planning_project_id
     and planning_project.team_id = team.id
    ${runDifficultyJoinSql("run")}`;

const buildDashboardRunListQuery = (
  projectId: TeamId,
  filters: DashboardRunListFilters,
  snapshotAt: string,
) => {
  const conditions = ["run.project_id = ?", "run.updated_at <= ?"];
  const bindings: Array<string | number> = [projectId, snapshotAt];
  const sources = [...new Set(filters.sources ?? [])];
  if (sources.length > 0) {
    conditions.push(`run.source in (${sources.map(() => "?").join(", ")})`);
    bindings.push(...sources);
  }
  const statuses = [...new Set(filters.statuses ?? [])];
  if (statuses.length > 0) {
    const statusParts: string[] = [];
    for (const status of statuses) {
      if (status === "paused") {
        statusParts.push("run.paused_at is not null");
      } else {
        statusParts.push("(run.paused_at is null and run.status = ?)");
        bindings.push(status);
      }
    }
    conditions.push(`(${statusParts.join(" or ")})`);
  }
  const query = filters.query?.trim();
  if (query) {
    conditions.push(
      `(lower(run.title) like lower(?) or lower(run.source_key) like lower(?) or lower(coalesce(run.detail, '')) like lower(?) or lower(coalesce(run.issue_description, '')) like lower(?))`,
    );
    const pattern = `%${query}%`;
    bindings.push(pattern, pattern, pattern, pattern);
  }
  if (filters.planningProjectId) {
    conditions.push("run.planning_project_id = ?");
    bindings.push(filters.planningProjectId);
  }
  const cursor = filters.cursor;
  if (cursor) {
    conditions.push(
      `(case when run.status in ('completed', 'cancelled') then 1 else 0 end > ? or (case when run.status in ('completed', 'cancelled') then 1 else 0 end = ? and (run.updated_at < ? or (run.updated_at = ? and run.id < ?))))`,
    );
    bindings.push(
      cursor.statusRank,
      cursor.statusRank,
      cursor.updatedAt,
      cursor.updatedAt,
      cursor.id,
    );
  }
  return {
    sql: `${dashboardSummarySelect}
    where ${conditions.join(" and ")}
    order by
      case when run.status in ('completed', 'cancelled') then 1 else 0 end,
      run.updated_at desc,
      run.id desc
    limit ?`,
    bindings,
  };
};

export async function listDashboardRunSummaries(
  db: D1Database,
  projectId: TeamId,
  filters: DashboardRunListFilters,
  observedAt = new Date().toISOString(),
): Promise<DashboardRunListPage> {
  const pageSize = listPageSize(filters.pageSize);
  const snapshotAt = filters.cursor?.snapshotAt ?? observedAt;
  const query = buildDashboardRunListQuery(projectId, filters, snapshotAt);
  const result = await db
    .prepare(query.sql)
    .bind(...query.bindings, pageSize + 1)
    .all<DashboardRunSummaryRow>();
  const rows = result.results.slice(0, pageSize);
  const last = rows.at(-1);
  return {
    rows,
    nextCursor: result.results.length > pageSize && last
      ? {
          snapshotAt: filters.cursor?.snapshotAt ?? observedAt,
          statusRank: dashboardStatusRank(last.status),
          updatedAt: last.updated_at,
          id: last.id,
        }
      : null,
  };
}

export type WorkspaceStatusTrayRunRow = Pick<
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
  /** `team.id` — the Team that owns the run, not a planning project. */
  project_id: TeamId;
  project_name: string;
};

export async function listDashboardRuns(db: D1Database, projectId: TeamId) {
  const runs = await db
    .prepare(
      `select run.*, ${runDifficultySelectSql},
              team.organization_id as workspace_id,
              run.project_id as team_id,
              planning_project.name as planning_project_name,
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
       join briar_teams team on team.id = run.project_id
       join briar_planning_projects planning_project
         on planning_project.id = run.planning_project_id
        and planning_project.team_id = team.id
       ${runDifficultyJoinSql("run")}
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
  projectId: TeamId,
  runIds: readonly string[],
) {
  if (runIds.length === 0) return [];
  const runs = await db
    .prepare(
      `select run.*, ${runDifficultySelectSql},
              team.organization_id as workspace_id,
              run.project_id as team_id,
              planning_project.name as planning_project_name,
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
       join briar_teams team on team.id = run.project_id
       join briar_planning_projects planning_project
         on planning_project.id = run.planning_project_id
        and planning_project.team_id = team.id
       ${runDifficultyJoinSql("run")}
       where run.project_id = ?
         and run.id in (select value from json_each(?))
       order by run.updated_at desc`,
    )
    .bind(projectId, JSON.stringify([...new Set(runIds)]))
    .all<HuntRunRow>();

  return runs.results;
}

export async function listWorkspaceStatusTrayRuns(
  db: D1Database,
  workspaceId: string,
  userId: string,
) {
  const runs = await db
    .prepare(
      `select team.id as project_id, team.name as project_name,
              run.id, run.title, run.status, run.workflow_stage,
              run.workflow_snapshot_json, run.started_at, run.updated_at,
              run.last_event_at
       from briar_hunt_runs run
       join briar_teams team on team.id = run.project_id
       join briar_organization_members membership
         on membership.organization_id = team.organization_id
        and membership.user_id = ?
       left join briar_project_members project_membership
         on project_membership.project_id = team.id
        and project_membership.organization_id = team.organization_id
        and project_membership.user_id = membership.user_id
       where team.organization_id = ?
         and (
           membership.role in ('owner', 'co-owner')
           or project_membership.user_id is not null
         )
         and run.status = 'running'
         and run.paused_at is null
       order by run.updated_at desc, run.id
       limit 200`,
    )
    .bind(userId, workspaceId)
    .all<WorkspaceStatusTrayRunRow>();

  return runs.results;
}
