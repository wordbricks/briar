import type { OrganizationRole } from "./organization-repository";
import type { PlanningProjectStatus } from "./hierarchy-request-contract";

export type TeamHierarchyRow = {
  id: string;
  workspace_id: string;
  workspace_name: string;
  name: string;
  issue_key_prefix: string;
  icon: string | null;
  role: OrganizationRole;
  github_repository_id: number | null;
  github_repository: string | null;
  workflow_json: string | null;
  schedule_tab_enabled: number;
  created_at: string;
  updated_at: string;
};

export type PlanningProjectRow = {
  id: string;
  team_id: string;
  team_name: string;
  workspace_id: string;
  workspace_name: string;
  name: string;
  description: string;
  status: PlanningProjectStatus;
  lead_user_id: string | null;
  lead_name: string | null;
  start_date: string | null;
  target_date: string | null;
  icon: string | null;
  color: string | null;
  sort_order: number;
  is_default: number;
  role: OrganizationRole;
  created_at: string;
  updated_at: string;
};

export type ProjectIssueRow = {
  id: string;
  run_number: number;
  workspace_id: string;
  team_id: string;
  team_name: string;
  project_id: string;
  project_name: string;
  issue_key_prefix: string;
  source: string;
  source_key: string;
  title: string;
  status: string;
  workflow_stage: string | null;
  priority: number | null;
  assignee_user_id: string | null;
  repository: string;
  created_at: string;
  updated_at: string;
};

const teamAccessSelect = `
  select team.id, team.organization_id as workspace_id,
         workspace.name as workspace_name, team.name,
         team.issue_key_prefix,
         coalesce(team.icon_data_url_browser, team.icon_data_url) as icon,
         membership.role,
         settings.github_repository_id, settings.github_repository,
         settings.workflow_json, team.schedule_tab_enabled,
         team.created_at, team.updated_at
  from briar_teams team
  join briar_organizations workspace on workspace.id = team.organization_id
  join briar_organization_members membership
    on membership.organization_id = team.organization_id
  left join briar_project_members team_membership
    on team_membership.project_id = team.id
   and team_membership.organization_id = team.organization_id
   and team_membership.user_id = membership.user_id
  left join briar_project_settings settings on settings.project_id = team.id
`;

export async function listWorkspaceTeams(
  db: D1Database,
  workspaceId: string,
  userId: string,
) {
  const rows = await db.prepare(
    `${teamAccessSelect}
     where team.organization_id = ? and membership.user_id = ?
       and (
         membership.role in ('owner', 'co-owner')
         or team_membership.user_id is not null
       )
     order by team.created_at, team.id`,
  ).bind(workspaceId, userId).all<TeamHierarchyRow>();
  return rows.results;
}

export async function listTeams(db: D1Database, userId: string) {
  const rows = await db.prepare(
    `${teamAccessSelect}
     where membership.user_id = ?
       and (
         membership.role in ('owner', 'co-owner')
         or team_membership.user_id is not null
       )
     order by workspace.created_at, team.created_at, team.id`,
  ).bind(userId).all<TeamHierarchyRow>();
  return rows.results;
}

export async function getTeamForUser(
  db: D1Database,
  teamId: string,
  userId: string,
) {
  return await db.prepare(
    `${teamAccessSelect}
     where team.id = ? and membership.user_id = ?
       and (
         membership.role in ('owner', 'co-owner')
         or team_membership.user_id is not null
       )`,
  ).bind(teamId, userId).first<TeamHierarchyRow>();
}

const projectAccessSelect = `
  select project.id, project.team_id, team.name as team_name,
         team.organization_id as workspace_id,
         workspace.name as workspace_name,
         project.name, project.description, project.status,
         project.lead_user_id, lead.name as lead_name,
         project.start_date, project.target_date, project.icon, project.color,
         project.sort_order, project.is_default, membership.role,
         project.created_at, project.updated_at
  from briar_planning_projects project
  join briar_teams team on team.id = project.team_id
  join briar_organizations workspace on workspace.id = team.organization_id
  join briar_organization_members membership
    on membership.organization_id = team.organization_id
  left join briar_project_members team_membership
    on team_membership.project_id = team.id
   and team_membership.organization_id = team.organization_id
   and team_membership.user_id = membership.user_id
  left join "user" lead on lead.id = project.lead_user_id
`;

export async function listTeamProjects(
  db: D1Database,
  teamId: string,
  userId: string,
) {
  const rows = await db.prepare(
    `${projectAccessSelect}
     where project.team_id = ? and membership.user_id = ?
       and (
         membership.role in ('owner', 'co-owner')
         or team_membership.user_id is not null
       )
     order by project.sort_order, project.created_at, project.id`,
  ).bind(teamId, userId).all<PlanningProjectRow>();
  return rows.results;
}

export async function getPlanningProjectForUser(
  db: D1Database,
  projectId: string,
  userId: string,
) {
  return await db.prepare(
    `${projectAccessSelect}
     where project.id = ? and membership.user_id = ?
       and (
         membership.role in ('owner', 'co-owner')
         or team_membership.user_id is not null
       )`,
  ).bind(projectId, userId).first<PlanningProjectRow>();
}

export async function getPlanningProject(db: D1Database, projectId: string) {
  return await db.prepare(
    `select project.id, project.team_id, team.name as team_name,
            team.organization_id as workspace_id,
            workspace.name as workspace_name,
            project.name, project.description, project.status,
            project.lead_user_id, lead.name as lead_name,
            project.start_date, project.target_date, project.icon, project.color,
            project.sort_order, project.is_default,
            'viewer' as role, project.created_at, project.updated_at
     from briar_planning_projects project
     join briar_teams team on team.id = project.team_id
     join briar_organizations workspace on workspace.id = team.organization_id
     left join "user" lead on lead.id = project.lead_user_id
     where project.id = ?`,
  ).bind(projectId).first<PlanningProjectRow>();
}

export async function getDefaultProjectForTeam(
  db: D1Database,
  teamId: string,
) {
  return await db.prepare(
    `select id from briar_planning_projects
     where team_id = ? and is_default = 1`,
  ).bind(teamId).first<{ id: string }>();
}

export async function assignIssueToPlanningProject(
  db: D1Database,
  input: { runId: string; teamId: string; projectId: string },
) {
  const result = await db.prepare(
    `update briar_hunt_runs
     set planning_project_id = ?
     where id = ? and project_id = ?
       and exists (
         select 1 from briar_planning_projects project
         where project.id = ? and project.team_id = ?
       )`,
  ).bind(
    input.projectId,
    input.runId,
    input.teamId,
    input.projectId,
    input.teamId,
  ).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function createPlanningProject(
  db: D1Database,
  input: {
    teamId: string;
    name: string;
    description?: string;
    status?: PlanningProjectStatus;
    leadUserId?: string | null;
    startDate?: string | null;
    targetDate?: string | null;
    icon?: string | null;
    color?: string | null;
    sortOrder?: number;
  },
) {
  const id = crypto.randomUUID();
  const observedAt = new Date().toISOString();
  await db.prepare(
    `insert into briar_planning_projects (
       id, team_id, name, description, status, lead_user_id,
       start_date, target_date, icon, color, sort_order, is_default,
       created_at, updated_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).bind(
    id,
    input.teamId,
    input.name,
    input.description ?? "",
    input.status ?? "planned",
    input.leadUserId ?? null,
    input.startDate ?? null,
    input.targetDate ?? null,
    input.icon ?? null,
    input.color ?? null,
    input.sortOrder ?? 0,
    observedAt,
    observedAt,
  ).run();
  return id;
}

export async function updatePlanningProject(
  db: D1Database,
  projectId: string,
  input: {
    name?: string;
    description?: string;
    status?: PlanningProjectStatus;
    leadUserId?: string | null;
    startDate?: string | null;
    targetDate?: string | null;
    icon?: string | null;
    color?: string | null;
    sortOrder?: number;
  },
) {
  const existing = await db.prepare(
    `select name, description, status, lead_user_id, start_date, target_date,
            icon, color, sort_order, is_default
     from briar_planning_projects where id = ?`,
  ).bind(projectId).first<{
    name: string;
    description: string;
    status: PlanningProjectStatus;
    lead_user_id: string | null;
    start_date: string | null;
    target_date: string | null;
    icon: string | null;
    color: string | null;
    sort_order: number;
    is_default: number;
  }>();
  if (!existing) return false;
  if (existing.is_default === 1 && input.status === "cancelled") return false;
  const result = await db.prepare(
    `update briar_planning_projects
     set name = ?, description = ?, status = ?, lead_user_id = ?,
         start_date = ?, target_date = ?, icon = ?, color = ?,
         sort_order = ?, updated_at = ?
     where id = ?`,
  ).bind(
    input.name ?? existing.name,
    input.description ?? existing.description,
    input.status ?? existing.status,
    input.leadUserId === undefined ? existing.lead_user_id : input.leadUserId,
    input.startDate === undefined ? existing.start_date : input.startDate,
    input.targetDate === undefined ? existing.target_date : input.targetDate,
    input.icon === undefined ? existing.icon : input.icon,
    input.color === undefined ? existing.color : input.color,
    input.sortOrder ?? existing.sort_order,
    new Date().toISOString(),
    projectId,
  ).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function archivePlanningProject(
  db: D1Database,
  projectId: string,
) {
  const result = await db.prepare(
    `update briar_planning_projects
     set status = 'cancelled', updated_at = ?
     where id = ? and is_default = 0`,
  ).bind(new Date().toISOString(), projectId).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function deletePlanningProject(
  db: D1Database,
  input: {
    projectId: string;
    teamId: string;
    defaultProjectId: string;
  },
) {
  const observedAt = new Date().toISOString();
  const [movedIssues, deletedProject] = await db.batch([
    db.prepare(
      `update briar_hunt_runs
       set planning_project_id = ?, updated_at = ?
       where planning_project_id = ? and project_id = ?
       returning id`,
    ).bind(
      input.defaultProjectId,
      observedAt,
      input.projectId,
      input.teamId,
    ),
    db.prepare(
      `delete from briar_planning_projects
       where id = ? and team_id = ? and is_default = 0
       returning id`,
    ).bind(input.projectId, input.teamId),
  ]);
  return {
    deleted: deletedProject.results.length > 0,
    movedIssueCount: movedIssues.results.length,
  };
}

export async function listProjectIssues(
  db: D1Database,
  projectId: string,
  userId: string,
) {
  const rows = await db.prepare(
    `select run.id, run.run_number, team.organization_id as workspace_id,
            team.id as team_id, team.name as team_name,
            project.id as project_id, project.name as project_name,
            team.issue_key_prefix, run.source, run.source_key, run.title,
            run.status, run.workflow_stage, run.priority,
            run.assignee_user_id, run.repository, run.created_at, run.updated_at
     from briar_hunt_runs run
     join briar_planning_projects project
       on project.id = run.planning_project_id
     join briar_teams team
       on team.id = run.project_id and team.id = project.team_id
     join briar_organization_members membership
       on membership.organization_id = team.organization_id
      and membership.user_id = ?
     left join briar_project_members team_membership
       on team_membership.project_id = team.id
      and team_membership.organization_id = team.organization_id
      and team_membership.user_id = membership.user_id
     where project.id = ?
       and (
         membership.role in ('owner', 'co-owner')
         or team_membership.user_id is not null
       )
     order by run.run_number desc`,
  ).bind(userId, projectId).all<ProjectIssueRow>();
  return rows.results;
}

export async function moveIssueWithinTeam(
  db: D1Database,
  input: {
    runId: string;
    sourceProjectId: string;
    targetProjectId: string;
    userId: string;
  },
) {
  const target = await getPlanningProjectForUser(
    db,
    input.targetProjectId,
    input.userId,
  );
  if (!target) return "not_found" as const;
  const source = await getPlanningProjectForUser(
    db,
    input.sourceProjectId,
    input.userId,
  );
  if (!source) return "not_found" as const;
  if (source.team_id !== target.team_id) return "different_team" as const;
  if (source.id === target.id) return "same_project" as const;
  const result = await db.prepare(
    `update briar_hunt_runs
     set planning_project_id = ?, updated_at = ?
     where id = ? and planning_project_id = ? and project_id = ?`,
  ).bind(
    target.id,
    new Date().toISOString(),
    input.runId,
    source.id,
    source.team_id,
  ).run();
  return (result.meta.changes ?? 0) > 0
    ? "moved" as const
    : "not_found" as const;
}

export async function listTeamAgentsAndSchedules(
  db: D1Database,
  teamId: string,
) {
  const [agents, schedules] = await Promise.all([
    db.prepare(
      `select id, name, provider, designated_worker_id, created_at, updated_at
       from briar_project_agents where project_id = ?
       order by created_at, id`,
    ).bind(teamId).all<{
      id: string;
      name: string;
      provider: string;
      designated_worker_id: string | null;
      created_at: string;
      updated_at: string;
    }>(),
    db.prepare(
      `select id, agent_id, name, enabled, recurrence, time_of_day,
              time_zone, created_at, updated_at
       from briar_project_agent_schedules where project_id = ?
       order by created_at, id`,
    ).bind(teamId).all<{
      id: string;
      agent_id: string;
      name: string;
      enabled: number;
      recurrence: string;
      time_of_day: string;
      time_zone: string;
      created_at: string;
      updated_at: string;
    }>(),
  ]);
  return { agents: agents.results, schedules: schedules.results };
}

export async function resolveIssueHierarchyLocation(
  db: D1Database,
  input: { sourceTeamId: string; runId: string; userId: string },
) {
  return db.prepare(
    `select team.organization_id as workspace_id, team.id as team_id,
            project.id as project_id, project.name as project_name
     from briar_hunt_runs run
     join briar_teams team on team.id = run.team_id
     join briar_planning_projects project
       on project.id = run.planning_project_id
      and project.team_id = team.id
     join briar_organization_members membership
       on membership.organization_id = team.organization_id
      and membership.user_id = ?
     left join briar_project_members team_membership
       on team_membership.project_id = team.id
      and team_membership.organization_id = team.organization_id
      and team_membership.user_id = membership.user_id
     where run.id = ?
       and (
         run.team_id = ?
         or exists (
           select 1 from briar_issue_key_aliases alias
           where alias.run_id = run.id and alias.team_id = ?
         )
       )
       and (
         membership.role in ('owner', 'co-owner')
         or team_membership.user_id is not null
       )`,
  ).bind(
    input.userId,
    input.runId,
    input.sourceTeamId,
    input.sourceTeamId,
  ).first<{
    workspace_id: string;
    team_id: string;
    project_id: string;
    project_name: string;
  }>();
}
