import {
  defaultAutoHuntWorkflow,
  isTerminalTrackerState,
  normalizeAutoHuntWorkflow,
  type AutoHuntQaEnvironment,
  type AutoHuntQaStatus,
  type AutoHuntRunStatus,
  type AutoHuntSource,
  type AutoHuntStage,
  type AutoHuntWorkflow,
  type AutoHuntWorkflowStageId,
} from "../../src/lib/auto-hunt-contract";
import {
  defaultAutoHuntAutomation,
  normalizeAutoHuntAutomation,
  type AutoHuntAutomation,
} from "../../src/lib/auto-hunt-automation";
import {
  defaultProjectAgentCalendarColor,
  defaultProjectAgentCopy,
} from "../../src/lib/project-agent";
import {
  nextProjectAgentScheduleRunAt,
  type ProjectAgentScheduleRecurrence,
} from "../../src/lib/project-agent-schedule";

type ProjectAgentProvider = "codex" | "claude" | "grok";
type ProjectAgentKind = "auto_hunt" | "custom";

export type ProjectRow = {
  id: string;
  name: string;
  organization_id: string;
  organization_name: string;
  member_role: OrganizationRole;
  created_at: string;
};

export type OrganizationRole = "owner" | "admin" | "member";
export type OrganizationRow = {
  id: string;
  name: string;
  handle: string;
  role: OrganizationRole;
  created_at: string;
};
export type OrganizationMemberRow = {
  user_id: string;
  name: string;
  email: string;
  image: string | null;
  role: OrganizationRole;
  created_at: string;
};

export type ProjectSettingsRow = {
  project_id: string;
  velen_org: string | null;
  data_source: string | null;
  linear_enabled: number;
  linear_source: string | null;
  linear_team_key: string | null;
  github_repository: string | null;
  workflow_json: string;
  auto_hunt_automation_json: string;
  created_at: string;
  updated_at: string;
};

export type ProjectAgentRow = {
  id: string;
  project_id: string;
  name: string;
  provider: ProjectAgentProvider;
  model: string | null;
  responsibility: string;
  calendar_color: string;
  kind: ProjectAgentKind;
  created_at: string;
  updated_at: string;
};

export type ProjectAgentScheduleRow = {
  id: string;
  project_id: string;
  agent_id: string;
  agent_name: string;
  agent_provider: ProjectAgentProvider;
  name: string;
  recurrence: ProjectAgentScheduleRecurrence;
  time_of_day: string;
  day_of_week: number | null;
  time_zone: string;
  enabled: number;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectAgentScheduleRunStatus =
  | "running"
  | "completed"
  | "failed";

export type ProjectAgentScheduleRunRow = {
  id: string;
  project_id: string;
  schedule_id: string;
  schedule_name: string;
  agent_id: string;
  agent_name: string;
  agent_provider: ProjectAgentProvider;
  agent_model: string | null;
  agent_responsibility: string;
  status: ProjectAgentScheduleRunStatus;
  scheduled_for: string;
  lease_expires_at: string | null;
  started_at: string;
  completed_at: string | null;
  result_summary: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type HuntRunRow = {
  id: string;
  run_number: number;
  source: AutoHuntSource;
  source_key: string;
  title: string;
  stage: AutoHuntStage;
  status: AutoHuntRunStatus;
  workflow_stage: AutoHuntWorkflowStageId | null;
  workflow_snapshot_json: string;
  detail: string | null;
  priority: number | null;
  repository: string;
  branch: string | null;
  commit_sha: string | null;
  tracker_provider: string | null;
  tracker_issue_id: string | null;
  tracker_issue_identifier: string | null;
  tracker_issue_url: string | null;
  tracker_issue_state: string | null;
  issue_description: string | null;
  result_summary: string | null;
  pull_request_urls: string;
  target_sha: string | null;
  source_created_at: string | null;
  staging_qa_status: AutoHuntQaStatus | null;
  production_qa_status: AutoHuntQaStatus | null;
  staging_qa_detail: string | null;
  production_qa_detail: string | null;
  context_json: string | null;
  current_attempt: number;
  claim_token_hash: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  claim_attempts: number;
  started_at: string;
  completed_at: string | null;
  last_event_at: string;
  event_count: number;
};

export type HuntEventRow = {
  id: string;
  run_id: string;
  event_key: string;
  attempt: number;
  stage: AutoHuntStage;
  status: AutoHuntRunStatus;
  workflow_stage: AutoHuntWorkflowStageId | null;
  detail: string | null;
  actor: string;
  branch: string | null;
  commit_sha: string | null;
  qa_status: AutoHuntQaStatus | null;
  tracker_issue_state: string | null;
  pull_request_urls: string;
  target_sha: string | null;
  occurred_at: string;
  recorded_at: string;
};

export type IssueMessageRow = {
  id: string;
  run_id: string;
  parent_message_id: string | null;
  author_user_id: string | null;
  author_agent_provider: "codex" | "claude" | "grok" | null;
  author_name: string | null;
  author_image: string | null;
  body: string;
  reply_count: number;
  created_at: string;
  updated_at: string;
};

export type IssueAttachmentRow = {
  id: string;
  run_id: string;
  project_id: string;
  object_key: string;
  filename: string;
  content_type: string;
  byte_size: number;
  created_at: string;
};

export type IssueAttachmentInput = Omit<
  IssueAttachmentRow,
  "run_id" | "project_id" | "created_at"
>;

export type TrackerInput = {
  provider: string;
  issueId: string | null;
  identifier: string | null;
  url: string | null;
  state: string | null;
} | null;

export type HuntEventInput = {
  source: AutoHuntSource;
  sourceKey: string;
  title: string;
  stage: AutoHuntStage;
  status?: AutoHuntRunStatus;
  workflowStage?: AutoHuntWorkflowStageId | null;
  eventKey: string;
  occurredAt: string;
  actor: string;
  repository: string;
  detail: string | null;
  priority: number | null;
  branch: string | null;
  commitSha: string | null;
  tracker: TrackerInput;
  issueDescription: string | null;
  resultSummary: string | null;
  pullRequestUrls: string[];
  targetSha: string | null;
  sourceCreatedAt: string | null;
  qaStatus: "pending" | null;
  stagingQaDetail: string | null;
  productionQaDetail: string | null;
  context: Record<string, unknown> | null;
};

export type ProjectSettingsInput = {
  velenOrg: string | null;
  dataSource: string | null;
  linear: {
    enabled: boolean;
    source: string | null;
    teamKey: string | null;
  };
  githubRepository: string | null;
  workflow: AutoHuntWorkflow;
  automation?: AutoHuntAutomation;
};

export class EventKeyConflictError extends Error {
  constructor() {
    super("Event key was reused with different Auto Hunt data");
  }
}
export class HuntTransitionError extends Error {}
export class HuntClaimError extends Error {}

const stableJson = (value: unknown) => JSON.stringify(value);
const parseWorkflow = (value: string | null | undefined) => {
  if (!value) return structuredClone(defaultAutoHuntWorkflow);
  return normalizeAutoHuntWorkflow(JSON.parse(value) as AutoHuntWorkflow);
};
const normalizedUrls = (urls: string[]) => [...new Set(urls)].sort();
const parseUrls = (value: string | null | undefined) => {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
};

export async function listOrganizations(db: D1Database, userId: string) {
  const result = await db
    .prepare(
      `select organization.id, organization.name, organization.handle,
              membership.role,
              organization.created_at
       from briar_organizations organization
       join briar_organization_members membership
         on membership.organization_id = organization.id
       where membership.user_id = ?
       order by organization.created_at, organization.id`,
    )
    .bind(userId)
    .all<OrganizationRow>();
  return result.results;
}

export async function createOrganization(
  db: D1Database,
  input: { name: string; handle: string; ownerUserId: string },
) {
  const createdAt = new Date().toISOString();
  const organization: OrganizationRow = {
    id: crypto.randomUUID(),
    name: input.name,
    handle: input.handle,
    role: "owner",
    created_at: createdAt,
  };
  await db.batch([
    db
      .prepare(
        `insert into briar_organizations
         (id, name, handle, created_at, updated_at)
       values (?, ?, ?, ?, ?)`,
      )
      .bind(
        organization.id,
        organization.name,
        organization.handle,
        createdAt,
        createdAt,
      ),
    db
      .prepare(
        `insert into briar_organization_members
         (organization_id, user_id, role, created_at, updated_at)
       values (?, ?, 'owner', ?, ?)`,
      )
      .bind(organization.id, input.ownerUserId, createdAt, createdAt),
  ]);
  return organization;
}

export async function updateOrganization(
  db: D1Database,
  organizationId: string,
  name: string,
  role: OrganizationRole,
) {
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `update briar_organizations
       set name = ?, updated_at = ?
       where id = ?`,
    )
    .bind(name, updatedAt, organizationId)
    .run();
  if (result.meta.changes === 0) return null;
  return db
    .prepare(
      `select id, name, handle, created_at
       from briar_organizations
       where id = ?`,
    )
    .bind(organizationId)
    .first<Omit<OrganizationRow, "role">>()
    .then((organization) => (organization ? { ...organization, role } : null));
}

export async function isOrganizationHandleAvailable(
  db: D1Database,
  handle: string,
) {
  const organization = await db
    .prepare(`select 1 as found from briar_organizations where handle = ?`)
    .bind(handle)
    .first<{ found: number }>();
  return organization === null;
}

export async function getOrganizationRole(
  db: D1Database,
  organizationId: string,
  userId: string,
) {
  const row = await db
    .prepare(
      `select role from briar_organization_members
     where organization_id = ? and user_id = ?`,
    )
    .bind(organizationId, userId)
    .first<{ role: OrganizationRole }>();
  return row?.role ?? null;
}

export async function listOrganizationMembers(
  db: D1Database,
  organizationId: string,
) {
  const result = await db
    .prepare(
      `select member.user_id, user.name, user.email, user.image,
            member.role, member.created_at
     from briar_organization_members member
     join "user" on user.id = member.user_id
     where member.organization_id = ?
     order by case member.role when 'owner' then 0 when 'admin' then 1 else 2 end,
              lower(user.name), lower(user.email)`,
    )
    .bind(organizationId)
    .all<OrganizationMemberRow>();
  return result.results;
}

export async function addOrganizationMember(
  db: D1Database,
  organizationId: string,
  email: string,
  role: Exclude<OrganizationRole, "owner">,
) {
  const user = await db
    .prepare(`select id from "user" where lower(email) = lower(?)`)
    .bind(email)
    .first<{ id: string }>();
  if (!user) return null;
  const now = new Date().toISOString();
  await db
    .prepare(
      `insert into briar_organization_members
       (organization_id, user_id, role, created_at, updated_at)
     values (?, ?, ?, ?, ?)
     on conflict(organization_id, user_id) do update set
       role = excluded.role, updated_at = excluded.updated_at
     where briar_organization_members.role != 'owner'`,
    )
    .bind(organizationId, user.id, role, now, now)
    .run();
  return user.id;
}

export async function removeOrganizationMember(
  db: D1Database,
  organizationId: string,
  userId: string,
) {
  const result = await db
    .prepare(
      `delete from briar_organization_members
     where organization_id = ? and user_id = ? and role != 'owner'`,
    )
    .bind(organizationId, userId)
    .run();
  return result.meta.changes > 0;
}

export async function listProjects(db: D1Database, userId: string) {
  const result = await db
    .prepare(
      `select project.id, project.name, project.organization_id,
              organization.name as organization_name,
              membership.role as member_role, project.created_at
       from briar_projects project
       join briar_organizations organization on organization.id = project.organization_id
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = ?
       order by organization.created_at, project.created_at`,
    )
    .bind(userId)
    .all<ProjectRow>();
  return result.results;
}

export async function createProject(
  db: D1Database,
  input: {
    ownerUserId: string;
    organizationId: string;
    name: string;
    agentTokenHash: string;
  },
) {
  const createdAt = new Date().toISOString();
  const project: ProjectRow = {
    id: crypto.randomUUID(),
    name: input.name,
    organization_id: input.organizationId,
    organization_name: "",
    member_role: "owner",
    created_at: createdAt,
  };
  const defaultAgentCopy = defaultProjectAgentCopy("en");
  const defaultAgent: ProjectAgentRow = {
    id: crypto.randomUUID(),
    project_id: project.id,
    name: defaultAgentCopy.name,
    provider: "codex",
    model: null,
    responsibility: defaultAgentCopy.responsibility,
    calendar_color: defaultProjectAgentCalendarColor,
    kind: "auto_hunt",
    created_at: createdAt,
    updated_at: createdAt,
  };
  await db.batch([
    db
      .prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        project.id,
        input.ownerUserId,
        input.organizationId,
        project.name,
        input.agentTokenHash,
        createdAt,
        createdAt,
      ),
    db
      .prepare(
        `insert into briar_project_settings (
           project_id, created_at, updated_at
         ) values (?, ?, ?)`,
      )
      .bind(project.id, createdAt, createdAt),
    db
      .prepare(
        `insert into briar_project_agents (
           id, project_id, name, provider, model, responsibility,
           calendar_color, created_at, updated_at, kind
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        defaultAgent.id,
        defaultAgent.project_id,
        defaultAgent.name,
        defaultAgent.provider,
        defaultAgent.model,
        defaultAgent.responsibility,
        defaultAgent.calendar_color,
        defaultAgent.created_at,
        defaultAgent.updated_at,
        defaultAgent.kind,
      ),
  ]);
  return project;
}

export async function getProject(
  db: D1Database,
  projectId: string,
  userId: string,
) {
  return await db
    .prepare(
      `select project.id, project.name, project.organization_id,
              organization.name as organization_name,
              membership.role as member_role, project.created_at
       from briar_projects project
       join briar_organizations organization on organization.id = project.organization_id
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = ?
       where project.id = ?`,
    )
    .bind(userId, projectId)
    .first<ProjectRow>();
}

export async function deleteProject(
  db: D1Database,
  projectId: string,
  userId: string,
) {
  const result = await db
    .prepare(
      `delete from briar_projects
       where id = ? and organization_id in (
         select organization_id from briar_organization_members
         where user_id = ? and role = 'owner'
       )`,
    )
    .bind(projectId, userId)
    .run();
  return result.meta.changes > 0;
}

export async function listProjectAgents(db: D1Database, projectId: string) {
  const result = await db
    .prepare(
      `select id, project_id, name, provider, model, responsibility, calendar_color,
              kind, created_at, updated_at
       from briar_project_agents
       where project_id = ?
       order by created_at, id`,
    )
    .bind(projectId)
    .all<ProjectAgentRow>();
  return result.results;
}

export async function createProjectAgent(
  db: D1Database,
  projectId: string,
  input: {
    name: string;
    provider: ProjectAgentProvider;
    model: string | null;
    responsibility: string;
    calendarColor: string;
  },
) {
  const createdAt = new Date().toISOString();
  const agent: ProjectAgentRow = {
    id: crypto.randomUUID(),
    project_id: projectId,
    name: input.name,
    provider: input.provider,
    model: input.model,
    responsibility: input.responsibility,
    calendar_color: input.calendarColor,
    kind: "custom",
    created_at: createdAt,
    updated_at: createdAt,
  };
  await db
    .prepare(
      `insert into briar_project_agents (
         id, project_id, name, provider, model, responsibility,
         calendar_color, created_at, updated_at, kind
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      agent.id,
      agent.project_id,
      agent.name,
      agent.provider,
      agent.model,
      agent.responsibility,
      agent.calendar_color,
      agent.created_at,
      agent.updated_at,
      agent.kind,
    )
    .run();
  return agent;
}

export async function listProjectAgentSchedules(
  db: D1Database,
  projectId: string,
) {
  const result = await db
    .prepare(
      `select schedule.id, schedule.project_id, schedule.agent_id,
              agent.name as agent_name, agent.provider as agent_provider,
              schedule.name, schedule.recurrence, schedule.time_of_day,
              schedule.day_of_week, schedule.time_zone, schedule.enabled,
              schedule.next_run_at,
              schedule.created_at, schedule.updated_at
       from briar_project_agent_schedules schedule
       join briar_project_agents agent on agent.id = schedule.agent_id
       where schedule.project_id = ?
       order by schedule.created_at, schedule.id`,
    )
    .bind(projectId)
    .all<ProjectAgentScheduleRow>();
  return result.results;
}

export async function createProjectAgentSchedule(
  db: D1Database,
  projectId: string,
  input: {
    agentId: string;
    name: string;
    recurrence: ProjectAgentScheduleRecurrence;
    timeOfDay: string;
    dayOfWeek: number | null;
    timeZone: string;
  },
) {
  const agent = await db
    .prepare(
      `select id
       from briar_project_agents
       where id = ? and project_id = ?`,
    )
    .bind(input.agentId, projectId)
    .first<{ id: string }>();
  if (!agent) return null;

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const nextRunAt = nextProjectAgentScheduleRunAt(
    {
      recurrence: input.recurrence,
      timeOfDay: input.timeOfDay,
      dayOfWeek: input.dayOfWeek,
      timeZone: input.timeZone,
    },
    new Date(Date.parse(createdAt) - 60_000),
  );
  await db
    .prepare(
      `insert into briar_project_agent_schedules (
         id, project_id, agent_id, name, recurrence, time_of_day,
         day_of_week, time_zone, enabled, next_run_at, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .bind(
      id,
      projectId,
      input.agentId,
      input.name,
      input.recurrence,
      input.timeOfDay,
      input.dayOfWeek,
      input.timeZone,
      nextRunAt,
      createdAt,
      createdAt,
    )
    .run();

  return await db
    .prepare(
      `select schedule.id, schedule.project_id, schedule.agent_id,
              agent.name as agent_name, agent.provider as agent_provider,
              schedule.name, schedule.recurrence, schedule.time_of_day,
              schedule.day_of_week, schedule.time_zone, schedule.enabled,
              schedule.next_run_at,
              schedule.created_at, schedule.updated_at
       from briar_project_agent_schedules schedule
       join briar_project_agents agent on agent.id = schedule.agent_id
       where schedule.id = ? and schedule.project_id = ?`,
    )
    .bind(id, projectId)
    .first<ProjectAgentScheduleRow>();
}

const scheduleRunSelect = `
  select run.id, run.project_id, run.schedule_id,
         schedule.name as schedule_name,
         run.agent_id, agent.name as agent_name,
         agent.provider as agent_provider, agent.model as agent_model,
         agent.responsibility as agent_responsibility,
         run.status, run.scheduled_for, run.lease_expires_at,
         run.started_at, run.completed_at, run.result_summary, run.error,
         run.created_at, run.updated_at
  from briar_project_agent_schedule_runs run
  join briar_project_agent_schedules schedule on schedule.id = run.schedule_id
  join briar_project_agents agent on agent.id = run.agent_id`;

export async function listProjectAgentScheduleRuns(
  db: D1Database,
  projectId: string,
) {
  const result = await db
    .prepare(
      `${scheduleRunSelect}
       where run.project_id = ?
       order by run.started_at desc, run.id`,
    )
    .bind(projectId)
    .all<ProjectAgentScheduleRunRow>();
  return result.results;
}

export const PROJECT_AGENT_SCHEDULE_LEASE_MS = 2 * 60 * 60_000;

const scheduleLeaseExpiresAt = (observedAt: string) =>
  new Date(
    Date.parse(observedAt) + PROJECT_AGENT_SCHEDULE_LEASE_MS,
  ).toISOString();

async function initializeProjectAgentScheduleNextRuns(
  db: D1Database,
  projectId: string,
  observedAt: string,
) {
  const schedules = await db
    .prepare(
      `select id, recurrence, time_of_day, day_of_week, time_zone, created_at
       from briar_project_agent_schedules
       where project_id = ? and enabled = 1 and next_run_at is null`,
    )
    .bind(projectId)
    .all<{
      id: string;
      recurrence: ProjectAgentScheduleRecurrence;
      time_of_day: string;
      day_of_week: number | null;
      time_zone: string;
      created_at: string;
    }>();
  for (const schedule of schedules.results ?? []) {
    const startAt = Math.min(
      Date.parse(observedAt),
      Date.parse(schedule.created_at),
    );
    const nextRunAt = nextProjectAgentScheduleRunAt(
      {
        recurrence: schedule.recurrence,
        timeOfDay: schedule.time_of_day,
        dayOfWeek: schedule.day_of_week,
        timeZone: schedule.time_zone,
      },
      new Date(startAt - 60_000),
    );
    await db
      .prepare(
        `update briar_project_agent_schedules
         set next_run_at = ?, updated_at = ?
         where id = ? and project_id = ? and next_run_at is null`,
      )
      .bind(nextRunAt, observedAt, schedule.id, projectId)
      .run();
  }
}

async function reclaimExpiredProjectAgentScheduleRun(
  db: D1Database,
  projectId: string,
  input: {
    claimTokenHash: string;
    observedAt: string;
  },
) {
  const expired = await db
    .prepare(
      `select id
       from briar_project_agent_schedule_runs
       where project_id = ? and status = 'running'
         and lease_expires_at is not null and lease_expires_at <= ?
       order by scheduled_for, id
       limit 1`,
    )
    .bind(projectId, input.observedAt)
    .first<{ id: string }>();
  if (!expired) return null;
  const run = await db
    .prepare(
      `update briar_project_agent_schedule_runs
       set claim_token_hash = ?, lease_expires_at = ?,
           started_at = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and lease_expires_at is not null and lease_expires_at <= ?
       returning id`,
    )
    .bind(
      input.claimTokenHash,
      scheduleLeaseExpiresAt(input.observedAt),
      input.observedAt,
      input.observedAt,
      expired.id,
      projectId,
      input.observedAt,
    )
    .first<{ id: string }>();
  if (!run) return null;
  return db
    .prepare(`${scheduleRunSelect} where run.id = ? and run.project_id = ?`)
    .bind(run.id, projectId)
    .first<ProjectAgentScheduleRunRow>();
}

export async function claimDueProjectAgentScheduleRun(
  db: D1Database,
  projectId: string,
  input: {
    claimTokenHash: string;
    observedAt: string;
  },
) {
  const reclaimed = await reclaimExpiredProjectAgentScheduleRun(
    db,
    projectId,
    input,
  );
  if (reclaimed) return reclaimed;

  await initializeProjectAgentScheduleNextRuns(db, projectId, input.observedAt);
  const schedule = await db
    .prepare(
      `select schedule.id, schedule.agent_id, schedule.next_run_at,
              schedule.recurrence, schedule.time_of_day,
              schedule.day_of_week, schedule.time_zone
       from briar_project_agent_schedules schedule
       where schedule.project_id = ? and schedule.enabled = 1
         and schedule.next_run_at is not null
         and schedule.next_run_at <= ?
         and not exists (
           select 1 from briar_project_agent_schedule_runs active
           where active.schedule_id = schedule.id and active.status = 'running'
             and active.lease_expires_at > ?
         )
       order by schedule.next_run_at, schedule.id
       limit 1`,
    )
    .bind(projectId, input.observedAt, input.observedAt)
    .first<{
      id: string;
      agent_id: string;
      next_run_at: string;
      recurrence: ProjectAgentScheduleRecurrence;
      time_of_day: string;
      day_of_week: number | null;
      time_zone: string;
    }>();
  if (!schedule) return null;

  const nextRunAt = nextProjectAgentScheduleRunAt(
    {
      recurrence: schedule.recurrence,
      timeOfDay: schedule.time_of_day,
      dayOfWeek: schedule.day_of_week,
      timeZone: schedule.time_zone,
    },
    new Date(Math.max(Date.parse(schedule.next_run_at), Date.parse(input.observedAt))),
  );
  const runId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `insert or ignore into briar_project_agent_schedule_runs (
           id, project_id, schedule_id, agent_id, status, scheduled_for,
           claim_token_hash, lease_expires_at, started_at, created_at, updated_at
         )
         select ?, ?, schedule.id, schedule.agent_id, 'running',
                schedule.next_run_at, ?, ?, ?, ?, ?
         from briar_project_agent_schedules schedule
         where schedule.id = ? and schedule.project_id = ?
           and schedule.enabled = 1 and schedule.next_run_at = ?
           and not exists (
             select 1 from briar_project_agent_schedule_runs active
             where active.schedule_id = schedule.id and active.status = 'running'
               and active.lease_expires_at > ?
           )`,
      )
      .bind(
        runId,
        projectId,
        input.claimTokenHash,
        scheduleLeaseExpiresAt(input.observedAt),
        input.observedAt,
        input.observedAt,
        input.observedAt,
        schedule.id,
        projectId,
        schedule.next_run_at,
        input.observedAt,
      ),
    db
      .prepare(
        `update briar_project_agent_schedules
         set next_run_at = ?, updated_at = ?
         where id = ? and project_id = ? and next_run_at = ?
           and exists (
             select 1 from briar_project_agent_schedule_runs run
             where run.id = ? and run.claim_token_hash = ?
           )`,
      )
      .bind(
        nextRunAt,
        input.observedAt,
        schedule.id,
        projectId,
        schedule.next_run_at,
        runId,
        input.claimTokenHash,
      ),
  ]);
  return db
    .prepare(`${scheduleRunSelect} where run.id = ? and run.project_id = ?`)
    .bind(runId, projectId)
    .first<ProjectAgentScheduleRunRow>();
}

export async function completeProjectAgentScheduleRun(
  db: D1Database,
  projectId: string,
  runId: string,
  input: {
    claimTokenHash: string;
    status: Exclude<ProjectAgentScheduleRunStatus, "running">;
    resultSummary: string | null;
    error: string | null;
    observedAt: string;
  },
) {
  const row = await db
    .prepare(
      `update briar_project_agent_schedule_runs
       set status = ?, claim_token_hash = null, lease_expires_at = null,
           completed_at = ?, result_summary = ?, error = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claim_token_hash = ?
       returning id`,
    )
    .bind(
      input.status,
      input.observedAt,
      input.resultSummary,
      input.error,
      input.observedAt,
      runId,
      projectId,
      input.claimTokenHash,
    )
    .first<{ id: string }>();
  if (!row) return null;
  return db
    .prepare(`${scheduleRunSelect} where run.id = ? and run.project_id = ?`)
    .bind(runId, projectId)
    .first<ProjectAgentScheduleRunRow>();
}

export async function renewProjectAgentScheduleRunLease(
  db: D1Database,
  projectId: string,
  runId: string,
  input: {
    claimTokenHash: string;
    observedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_project_agent_schedule_runs
       set lease_expires_at = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claim_token_hash = ?
       returning id, lease_expires_at`,
    )
    .bind(
      scheduleLeaseExpiresAt(input.observedAt),
      input.observedAt,
      runId,
      projectId,
      input.claimTokenHash,
    )
    .first<{ id: string; lease_expires_at: string }>();
}

export async function updateProjectAgent(
  db: D1Database,
  projectId: string,
  agentId: string,
  input: {
    name: string;
    provider: ProjectAgentProvider;
    model: string | null;
    responsibility: string;
    calendarColor: string;
  },
) {
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `update briar_project_agents
       set name = ?, provider = ?, model = ?, responsibility = ?,
           calendar_color = ?, updated_at = ?
       where id = ? and project_id = ?`,
    )
    .bind(
      input.name,
      input.provider,
      input.model,
      input.responsibility,
      input.calendarColor,
      updatedAt,
      agentId,
      projectId,
    )
    .run();
  if (result.meta.changes === 0) return null;
  return db
    .prepare(
      `select id, project_id, name, provider, model, responsibility, calendar_color,
              kind, created_at, updated_at
       from briar_project_agents
       where id = ? and project_id = ?`,
    )
    .bind(agentId, projectId)
    .first<ProjectAgentRow>();
}

export async function getProjectSettings(db: D1Database, projectId: string) {
  return await db
    .prepare(
      `select project_id, velen_org, data_source, linear_enabled,
              linear_source, linear_team_key, github_repository, workflow_json,
              auto_hunt_automation_json, created_at, updated_at
       from briar_project_settings
       where project_id = ?`,
    )
    .bind(projectId)
    .first<ProjectSettingsRow>();
}

export async function updateProjectSettings(
  db: D1Database,
  projectId: string,
  input: ProjectSettingsInput,
) {
  const updatedAt = new Date().toISOString();
  const automation = stableJson(
    normalizeAutoHuntAutomation(input.automation ?? defaultAutoHuntAutomation),
  );
  await db
    .prepare(
      `insert into briar_project_settings (
         project_id, velen_org, data_source, linear_enabled, linear_source,
         linear_team_key, github_repository, workflow_json,
         auto_hunt_automation_json, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(project_id) do update set
         velen_org = excluded.velen_org,
         data_source = excluded.data_source,
         linear_enabled = excluded.linear_enabled,
         linear_source = excluded.linear_source,
         linear_team_key = excluded.linear_team_key,
         github_repository = excluded.github_repository,
         workflow_json = excluded.workflow_json,
         auto_hunt_automation_json = case
           when ? = 1 then excluded.auto_hunt_automation_json
           else briar_project_settings.auto_hunt_automation_json
         end,
         updated_at = excluded.updated_at`,
    )
    .bind(
      projectId,
      input.velenOrg,
      input.dataSource,
      input.linear.enabled ? 1 : 0,
      input.linear.enabled ? input.linear.source : null,
      input.linear.enabled ? input.linear.teamKey : null,
      input.githubRepository,
      stableJson(normalizeAutoHuntWorkflow(input.workflow)),
      automation,
      updatedAt,
      updatedAt,
      input.automation ? 1 : 0,
    )
    .run();
  return await getProjectSettings(db, projectId);
}

export async function listDashboardRuns(db: D1Database, projectId: string) {
  const runs = await db
    .prepare(
      `select run.id, run.run_number, run.source, run.source_key, run.title,
              run.stage, run.status, run.workflow_stage,
              run.workflow_snapshot_json, run.detail, run.priority,
              run.repository, run.branch,
              run.commit_sha, run.tracker_provider, run.tracker_issue_id,
              run.tracker_issue_identifier, run.tracker_issue_url,
              run.tracker_issue_state, run.issue_description,
              run.result_summary, run.pull_request_urls, run.target_sha,
              run.source_created_at, run.staging_qa_status,
              run.production_qa_status, run.staging_qa_detail,
              run.production_qa_detail, run.context_json,
              run.current_attempt, run.claimed_by, run.claimed_at,
              run.lease_expires_at, run.claim_attempts, run.started_at,
              run.completed_at, run.last_event_at,
              (select count(*) from briar_hunt_events event
               where event.run_id = run.id) as event_count
       from briar_hunt_runs run
       where run.project_id = ?
       order by
         case when run.status in ('completed', 'cancelled') then 1 else 0 end,
         run.last_event_at desc
       limit 200`,
    )
    .bind(projectId)
    .all<HuntRunRow>();

  const events = await db
    .prepare(
      `select ranked.id, ranked.run_id, ranked.event_key, ranked.attempt,
              ranked.stage, ranked.status, ranked.workflow_stage,
              ranked.detail, ranked.actor, ranked.branch, ranked.commit_sha,
              ranked.qa_status, ranked.tracker_issue_state,
              ranked.pull_request_urls, ranked.target_sha,
              ranked.occurred_at, ranked.recorded_at
       from (
         select event.*,
                row_number() over (
                  partition by event.run_id
                  order by event.occurred_at desc, event.id desc
                ) as event_rank
         from briar_hunt_events event
         join briar_hunt_runs run on run.id = event.run_id
         where run.project_id = ?
       ) ranked
       where ranked.event_rank <= 20
       order by ranked.occurred_at desc, ranked.id desc`,
    )
    .bind(projectId)
    .all<HuntEventRow>();

  return { runs: runs.results, events: events.results };
}

export async function listIssueMessages(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const result = await db
    .prepare(
      `select message.id, message.run_id, message.parent_message_id,
              message.author_user_id, message.author_agent_provider,
              author.name as author_name,
              author.image as author_image, message.body,
              (select count(*) from briar_issue_messages reply
               where reply.parent_message_id = message.id) as reply_count,
              message.created_at, message.updated_at
       from briar_issue_messages message
       left join "user" author on author.id = message.author_user_id
       where message.project_id = ? and message.run_id = ?
       order by message.created_at, message.id
       limit 1000`,
    )
    .bind(projectId, runId)
    .all<IssueMessageRow>();
  return result.results;
}

export async function createIssueMessage(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    runId: string;
    parentMessageId: string | null;
    authorUserId: string | null;
    authorAgentProvider: "codex" | "claude" | "grok" | null;
    body: string;
    createdAt: string;
  },
) {
  const result = await db
    .prepare(
      `insert into briar_issue_messages (
         id, project_id, run_id, parent_message_id, author_user_id,
         author_agent_provider, body, created_at, updated_at
       )
       select ?, run.project_id, run.id, parent.id, ?, ?, ?, ?, ?
       from briar_hunt_runs run
       left join briar_issue_messages parent
         on parent.id = ?
        and parent.project_id = run.project_id
        and parent.run_id = run.id
        and parent.parent_message_id is null
       where run.id = ? and run.project_id = ?
         and (? is null or parent.id is not null)`,
    )
    .bind(
      input.id,
      input.authorUserId,
      input.authorAgentProvider,
      input.body,
      input.createdAt,
      input.createdAt,
      input.parentMessageId,
      input.runId,
      input.projectId,
      input.parentMessageId,
    )
    .run();
  if (result.meta.changes !== 1) return null;
  const messages = await listIssueMessages(db, input.projectId, input.runId);
  return messages.find((message) => message.id === input.id) ?? null;
}

export async function createIssueAttachments(
  db: D1Database,
  projectId: string,
  runId: string,
  attachments: IssueAttachmentInput[],
) {
  if (attachments.length === 0) return;
  const createdAt = new Date().toISOString();
  const results = await db.batch(
    attachments.map((attachment) =>
      db
        .prepare(
          `insert into briar_issue_attachments (
             id, run_id, project_id, object_key, filename, content_type,
             byte_size, created_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          attachment.id,
          runId,
          projectId,
          attachment.object_key,
          attachment.filename,
          attachment.content_type,
          attachment.byte_size,
          createdAt,
        ),
    ),
  );
  if (results.some((result) => !result.success)) {
    throw new Error("Issue attachment metadata could not be stored");
  }
}

export async function listIssueAttachments(
  db: D1Database,
  projectId: string,
  runId?: string,
) {
  const query = runId
    ? `select id, run_id, project_id, object_key, filename, content_type,
              byte_size, created_at
       from briar_issue_attachments
       where project_id = ? and run_id = ?
       order by created_at, id`
    : `select id, run_id, project_id, object_key, filename, content_type,
              byte_size, created_at
       from briar_issue_attachments attachment
       where attachment.project_id = ?
         and attachment.run_id in (
           select run.id from briar_hunt_runs run
           where run.project_id = ?
           order by
             case when run.status in ('completed', 'cancelled') then 1 else 0 end,
             run.last_event_at desc
           limit 200
         )
       order by created_at, id`;
  const statement = db.prepare(query);
  const result = runId
    ? await statement.bind(projectId, runId).all<IssueAttachmentRow>()
    : await statement.bind(projectId, projectId).all<IssueAttachmentRow>();
  return result.results;
}

export async function getIssueAttachment(
  db: D1Database,
  projectId: string,
  runId: string,
  attachmentId: string,
) {
  return db
    .prepare(
      `select id, run_id, project_id, object_key, filename, content_type,
              byte_size, created_at
       from briar_issue_attachments
       where project_id = ? and run_id = ? and id = ?`,
    )
    .bind(projectId, runId, attachmentId)
    .first<IssueAttachmentRow>();
}

export async function rollbackNewAppIssue(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const result = await db
    .prepare(
      `delete from briar_hunt_runs
       where id = ? and project_id = ? and source = 'issue'
         and status = 'queued' and claim_attempts = 0
         and (select count(*) from briar_hunt_events where run_id = ?) = 1`,
    )
    .bind(runId, projectId, runId)
    .run();
  return result.meta.changes === 1;
}

export async function getNextQueuedHuntRun(db: D1Database, projectId: string) {
  return await db
    .prepare(
      `select run.*,
              (select count(*) from briar_hunt_events event
               where event.run_id = run.id) as event_count
       from briar_hunt_runs run
       where run.project_id = ? and run.status = 'queued'
       order by
         case when run.priority is null then 1 else 0 end,
         run.priority asc,
         coalesce(run.source_created_at, run.started_at) asc,
         run.run_number asc
       limit 1`,
    )
    .bind(projectId)
    .first<HuntRunRow>();
}

export async function claimNextQueuedHuntRun(
  db: D1Database,
  projectId: string,
  input: {
    claimTokenHash: string;
    claimedBy: string;
    claimedAt: string;
    leaseExpiresAt: string;
  },
) {
  return await db
    .prepare(
      `update briar_hunt_runs
       set claim_token_hash = ?, claimed_by = ?, claimed_at = ?,
           lease_expires_at = ?, claim_attempts = claim_attempts + 1,
           updated_at = ?
       where id = (
         select id from briar_hunt_runs
         where project_id = ? and status = 'queued'
           and (lease_expires_at is null or lease_expires_at <= ?)
         order by
           case when priority is null then 1 else 0 end,
           priority asc,
           coalesce(source_created_at, started_at) asc,
           run_number asc
         limit 1
       )
       returning *`,
    )
    .bind(
      input.claimTokenHash,
      input.claimedBy,
      input.claimedAt,
      input.leaseExpiresAt,
      input.claimedAt,
      projectId,
      input.claimedAt,
    )
    .first<HuntRunRow>();
}

export async function assertQueuedHuntClaim(
  db: D1Database,
  projectId: string,
  input: Pick<HuntEventInput, "source" | "sourceKey">,
  claimTokenHash: string | null,
  observedAt: string,
) {
  const run = await db
    .prepare(
      `select stage, status, claim_token_hash, lease_expires_at, context_json,
              case when claim_token_hash = ? then 1 else 0 end as claim_token_valid
       from briar_hunt_runs
       where project_id = ? and source = ? and source_key = ?
       limit 1`,
    )
    .bind(claimTokenHash ?? "", projectId, input.source, input.sourceKey)
    .first<{
      stage: AutoHuntStage;
      status: AutoHuntRunStatus;
      claim_token_hash: string | null;
      lease_expires_at: string | null;
      context_json: string | null;
      claim_token_valid: number;
    }>();
  if (!run) return;
  if (run.status !== "queued") {
    if (claimTokenHash && run.claim_token_valid !== 1) {
      throw new HuntClaimError("Auto Hunt claim token is no longer active");
    }
    return;
  }
  const context: unknown = run.context_json
    ? JSON.parse(run.context_json)
    : null;
  const appCreated =
    context !== null &&
    typeof context === "object" &&
    !Array.isArray(context) &&
    (context as Record<string, unknown>).origin === "briar-app";
  if (!run.claim_token_hash) {
    if (claimTokenHash) {
      throw new HuntClaimError("Auto Hunt claim token is no longer active");
    }
    if (!appCreated) return;
  }
  if (
    run.claim_token_valid !== 1 ||
    !run.lease_expires_at ||
    run.lease_expires_at <= observedAt
  ) {
    throw new HuntClaimError(
      "Queued Auto Hunt run requires its active claim token",
    );
  }
}

export async function findProjectIdByAgentTokenHash(
  db: D1Database,
  agentTokenHash: string,
) {
  return await db
    .prepare("select id from briar_projects where agent_token_hash = ?")
    .bind(agentTokenHash)
    .first<string>("id");
}

export async function replaceProjectAgentToken(
  db: D1Database,
  projectId: string,
  userId: string,
  agentTokenHash: string,
) {
  const result = await db
    .prepare(
      `update briar_projects
       set agent_token_hash = ?, updated_at = ?
       where id = ? and organization_id in (
         select organization_id from briar_organization_members
         where user_id = ? and role in ('owner', 'admin')
       )`,
    )
    .bind(agentTokenHash, new Date().toISOString(), projectId, userId)
    .run();
  return result.meta.changes > 0;
}

const digestRunId = async (
  projectId: string,
  source: AutoHuntSource,
  sourceKey: string,
) => {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${projectId}\u0000${source}\u0000${sourceKey}`),
    ),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const scopedEventKey = async (eventKey: string, attempt: number) => {
  if (attempt === 1) return eventKey;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(eventKey)),
  );
  const fingerprint = [...digest.slice(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const suffix = `:attempt-${attempt}:${fingerprint}`;
  return `${eventKey.slice(0, 300 - suffix.length)}${suffix}`;
};

const sameEvent = (row: HuntEventRow, input: HuntEventInput) =>
  row.stage === input.stage &&
  row.status === input.status &&
  row.workflow_stage === input.workflowStage &&
  row.detail === input.detail &&
  row.actor === input.actor &&
  row.branch === input.branch &&
  row.commit_sha === input.commitSha &&
  row.qa_status === input.qaStatus &&
  row.tracker_issue_state === (input.tracker?.state ?? null) &&
  row.pull_request_urls === stableJson(input.pullRequestUrls) &&
  row.target_sha === input.targetSha &&
  row.occurred_at === input.occurredAt;

const loadRunForIdentity = async (
  db: D1Database,
  projectId: string,
  input: HuntEventInput,
) => {
  if (input.tracker?.issueId) {
    const byTracker = await db
      .prepare(
        `select * from briar_hunt_runs
         where project_id = ? and tracker_provider = ? and tracker_issue_id = ?
         limit 1`,
      )
      .bind(projectId, input.tracker.provider, input.tracker.issueId)
      .first<HuntRunRow>();
    if (byTracker) return byTracker;
  }
  return await db
    .prepare(
      `select * from briar_hunt_runs
       where project_id = ? and source = ? and source_key = ?
       limit 1`,
    )
    .bind(projectId, input.source, input.sourceKey)
    .first<HuntRunRow>();
};

const assertCompletionEligible = async (
  db: D1Database,
  projectId: string,
  run: HuntRunRow | null,
  input: HuntEventInput,
) => {
  if (input.status !== "completed") return;
  if (!run) throw new HuntTransitionError("Auto Hunt run does not exist");
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  const requiredStages = workflow.completion.requiredStages;
  const completedStages = await db
    .prepare(
      `select distinct workflow_stage from briar_hunt_events
       where run_id = ? and attempt = ? and workflow_stage is not null`,
    )
    .bind(run.id, run.current_attempt)
    .all<{ workflow_stage: AutoHuntWorkflowStageId }>();
  const completedStageIds = new Set(
    completedStages.results.map((event) => event.workflow_stage),
  );
  const missingStages = requiredStages.filter(
    (stage) => !completedStageIds.has(stage),
  );
  if (missingStages.length > 0) {
    throw new HuntTransitionError(
      `Auto Hunt completion requires workflow stages: ${missingStages.join(", ")}`,
    );
  }
  if (
    requiredStages.includes("staging_qa") &&
    !["passed", "skipped"].includes(run.staging_qa_status ?? "")
  ) {
    throw new HuntTransitionError("Auto Hunt completion requires Stage QA");
  }
  if (
    requiredStages.includes("production_qa") &&
    !["passed", "skipped"].includes(run.production_qa_status ?? "")
  ) {
    throw new HuntTransitionError(
      "Auto Hunt completion requires Production QA",
    );
  }
  const resultSummary = input.resultSummary ?? run.result_summary;
  if (!resultSummary?.trim()) {
    throw new HuntTransitionError(
      "Auto Hunt completion requires a result summary",
    );
  }
  const settings = await getProjectSettings(db, projectId);
  const trackerProvider = input.tracker?.provider ?? run.tracker_provider;
  const trackerState = input.tracker?.state ?? run.tracker_issue_state;
  if (
    settings?.linear_enabled === 1 &&
    trackerProvider === "linear" &&
    !isTerminalTrackerState(trackerState)
  ) {
    throw new HuntTransitionError(
      "Auto Hunt completion requires a terminal Linear issue",
    );
  }
};

const assertStageTransition = async (
  _db: D1Database,
  run: HuntRunRow | null,
  input: HuntEventInput,
) => {
  if (!run || input.occurredAt < run.last_event_at) {
    return;
  }
  if (
    input.status === run.status &&
    (input.status !== "running" || input.workflowStage === run.workflow_stage)
  ) {
    return;
  }
  if (run.status === "completed" || run.status === "cancelled") {
    throw new HuntTransitionError(`Auto Hunt run is already ${run.status}`);
  }
  if (["blocked", "failed", "cancelled"].includes(input.status ?? "")) return;
  if (input.status !== "running" || !input.workflowStage) return;
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  const nextRank = workflow.stages.findIndex(
    (stage) => stage.id === input.workflowStage,
  );
  if (nextRank < 0) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${input.workflowStage}`,
    );
  }
  const floorRank = run.workflow_stage
    ? workflow.stages.findIndex((stage) => stage.id === run.workflow_stage)
    : -1;
  if (nextRank < floorRank) {
    throw new HuntTransitionError(
      `Auto Hunt workflow cannot regress from rank ${floorRank} to ${nextRank}`,
    );
  }
};

const legacyStatusForStage = (stage: AutoHuntStage): AutoHuntRunStatus => {
  if (stage === "queued") return "queued";
  if (["blocked", "failed", "completed", "cancelled"].includes(stage)) {
    return stage as AutoHuntRunStatus;
  }
  return "running";
};

const legacyWorkflowStage = (
  stage: AutoHuntStage,
): AutoHuntWorkflowStageId | null => {
  if (
    [
      "analyzing",
      "implementing",
      "pr_open",
      "staging_qa",
      "production_qa",
    ].includes(stage)
  ) {
    return stage as AutoHuntWorkflowStageId;
  }
  return null;
};

const legacyStageFor = (
  status: AutoHuntRunStatus,
  workflowStage: AutoHuntWorkflowStageId | null,
): AutoHuntStage => {
  if (status === "backlog") return "queued";
  if (status !== "running") return status;
  return workflowStage &&
    [
      "analyzing",
      "implementing",
      "pr_open",
      "staging_qa",
      "production_qa",
    ].includes(workflowStage)
    ? (workflowStage as AutoHuntStage)
    : "implementing";
};

export async function recordHuntEvent(
  db: D1Database,
  projectId: string,
  input: HuntEventInput,
) {
  const normalizedInput = {
    ...input,
    status: input.status ?? legacyStatusForStage(input.stage),
    workflowStage:
      input.workflowStage === undefined
        ? legacyWorkflowStage(input.stage)
        : input.workflowStage,
    pullRequestUrls: normalizedUrls(input.pullRequestUrls),
  };
  normalizedInput.stage = legacyStageFor(
    normalizedInput.status,
    normalizedInput.workflowStage,
  );
  const existingRun = await loadRunForIdentity(db, projectId, normalizedInput);
  const workflowSnapshot = existingRun
    ? parseWorkflow(existingRun.workflow_snapshot_json)
    : parseWorkflow((await getProjectSettings(db, projectId))?.workflow_json);
  if (
    normalizedInput.status === "running" &&
    (!normalizedInput.workflowStage ||
      !workflowSnapshot.stages.some(
        (stage) => stage.id === normalizedInput.workflowStage,
      ))
  ) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${normalizedInput.workflowStage ?? "none"}`,
    );
  }
  const eventAttempt = existingRun?.current_attempt ?? 1;
  const storedEventKey = await scopedEventKey(
    normalizedInput.eventKey,
    eventAttempt,
  );
  await assertStageTransition(db, existingRun, normalizedInput);
  await assertCompletionEligible(db, projectId, existingRun, normalizedInput);

  if (existingRun) {
    const existingEvent = await db
      .prepare(
        `select id, run_id, event_key, attempt, stage, status, workflow_stage,
                detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
                pull_request_urls, target_sha, occurred_at, recorded_at
         from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(existingRun.id, storedEventKey)
      .first<HuntEventRow>();
    if (existingEvent) {
      if (!sameEvent(existingEvent, normalizedInput)) {
        throw new EventKeyConflictError();
      }
      return existingRun.id;
    }
  }

  const runId =
    existingRun?.id ??
    (await digestRunId(
      projectId,
      normalizedInput.source,
      normalizedInput.sourceKey,
    ));
  const eventId = crypto.randomUUID();
  const recordedAt = new Date().toISOString();
  const completedAt = ["completed", "cancelled"].includes(
    normalizedInput.status,
  )
    ? normalizedInput.occurredAt
    : null;
  const mergedPullRequestUrls = normalizedUrls([
    ...parseUrls(existingRun?.pull_request_urls),
    ...normalizedInput.pullRequestUrls,
  ]);
  const qaStatus = normalizedInput.qaStatus;
  const stagingQaStatus =
    normalizedInput.stage === "staging_qa" && qaStatus === "pending"
      ? "pending"
      : null;
  const productionQaStatus =
    normalizedInput.stage === "production_qa" && qaStatus === "pending"
      ? "pending"
      : null;
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_hunt_runs (
           id, project_id, source, source_key, title, stage, status,
           workflow_stage, workflow_snapshot_json, detail, priority,
           repository, branch, commit_sha, tracker_provider,
           tracker_issue_id, tracker_issue_identifier, tracker_issue_url,
           tracker_issue_state, issue_description, result_summary,
           pull_request_urls, target_sha, source_created_at,
           staging_qa_status, production_qa_status, staging_qa_detail,
           production_qa_detail, context_json, started_at, completed_at,
           last_event_at, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(project_id, source, source_key) do nothing`,
      )
      .bind(
        runId,
        projectId,
        normalizedInput.source,
        normalizedInput.sourceKey,
        normalizedInput.title,
        normalizedInput.stage,
        normalizedInput.status,
        normalizedInput.workflowStage,
        stableJson(workflowSnapshot),
        normalizedInput.detail,
        normalizedInput.priority,
        normalizedInput.repository,
        normalizedInput.branch,
        normalizedInput.commitSha,
        normalizedInput.tracker?.provider ?? null,
        normalizedInput.tracker?.issueId ?? null,
        normalizedInput.tracker?.identifier ?? null,
        normalizedInput.tracker?.url ?? null,
        normalizedInput.tracker?.state ?? null,
        normalizedInput.issueDescription,
        normalizedInput.resultSummary,
        stableJson(mergedPullRequestUrls),
        normalizedInput.targetSha,
        normalizedInput.sourceCreatedAt,
        stagingQaStatus,
        productionQaStatus,
        normalizedInput.stagingQaDetail,
        normalizedInput.productionQaDetail,
        normalizedInput.context ? stableJson(normalizedInput.context) : null,
        normalizedInput.occurredAt,
        completedAt,
        normalizedInput.occurredAt,
        recordedAt,
        recordedAt,
      ),
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, stage, status, workflow_stage,
           detail, actor, branch, commit_sha,
           qa_status, tracker_issue_state, pull_request_urls, target_sha,
           occurred_at, recorded_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        runId,
        storedEventKey,
        eventAttempt,
        normalizedInput.stage,
        normalizedInput.status,
        normalizedInput.workflowStage,
        normalizedInput.detail,
        normalizedInput.actor,
        normalizedInput.branch,
        normalizedInput.commitSha,
        qaStatus,
        normalizedInput.tracker?.state ?? null,
        stableJson(normalizedInput.pullRequestUrls),
        normalizedInput.targetSha,
        normalizedInput.occurredAt,
        recordedAt,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set title = case when ? >= last_event_at then ? else title end,
             stage = case
               when ? < last_event_at then stage
               when status = 'completed' and ? <> 'completed' then stage
               else ?
             end,
             status = case
               when ? < last_event_at then status
               when status = 'completed' and ? <> 'completed' then status
               else ?
             end,
             workflow_stage = case
               when ? >= last_event_at then coalesce(?, workflow_stage)
               else workflow_stage
             end,
             detail = case when ? >= last_event_at then ? else detail end,
             priority = case when ? >= last_event_at then coalesce(?, priority) else priority end,
             repository = case when ? >= last_event_at then ? else repository end,
             branch = case when ? >= last_event_at then coalesce(?, branch) else branch end,
             commit_sha = case when ? >= last_event_at then coalesce(?, commit_sha) else commit_sha end,
             tracker_provider = coalesce(?, tracker_provider),
             tracker_issue_id = coalesce(?, tracker_issue_id),
             tracker_issue_identifier = coalesce(?, tracker_issue_identifier),
             tracker_issue_url = coalesce(?, tracker_issue_url),
             tracker_issue_state = case when ? >= last_event_at then coalesce(?, tracker_issue_state) else tracker_issue_state end,
             issue_description = case when ? >= last_event_at then coalesce(?, issue_description) else issue_description end,
             result_summary = case when ? >= last_event_at then coalesce(?, result_summary) else result_summary end,
             pull_request_urls = ?,
             target_sha = case when ? >= last_event_at then coalesce(?, target_sha) else target_sha end,
             source_created_at = coalesce(source_created_at, ?),
             staging_qa_status = case
               when ? >= last_event_at and ? = 'staging_qa' and ? = 'pending' then 'pending'
               else staging_qa_status
             end,
             production_qa_status = case
               when ? >= last_event_at and ? = 'production_qa' and ? = 'pending' then 'pending'
               else production_qa_status
             end,
             staging_qa_detail = case when ? >= last_event_at then coalesce(?, staging_qa_detail) else staging_qa_detail end,
             production_qa_detail = case when ? >= last_event_at then coalesce(?, production_qa_detail) else production_qa_detail end,
             context_json = case when ? >= last_event_at then coalesce(?, context_json) else context_json end,
             completed_at = case
               when ? < last_event_at then completed_at
               when ? in ('completed', 'cancelled') then ?
               when status = 'completed' and ? <> 'completed' then completed_at
               else null
             end,
             last_event_at = max(last_event_at, ?),
             updated_at = ?
         where id = ?
           and current_attempt = ?
           and exists (
             select 1 from briar_hunt_events
             where id = ? and run_id = briar_hunt_runs.id
           )`,
      )
      .bind(
        normalizedInput.occurredAt,
        normalizedInput.title,
        normalizedInput.occurredAt,
        normalizedInput.status,
        normalizedInput.stage,
        normalizedInput.occurredAt,
        normalizedInput.status,
        normalizedInput.status,
        normalizedInput.occurredAt,
        normalizedInput.workflowStage,
        normalizedInput.occurredAt,
        normalizedInput.detail,
        normalizedInput.occurredAt,
        normalizedInput.priority,
        normalizedInput.occurredAt,
        normalizedInput.repository,
        normalizedInput.occurredAt,
        normalizedInput.branch,
        normalizedInput.occurredAt,
        normalizedInput.commitSha,
        normalizedInput.tracker?.provider ?? null,
        normalizedInput.tracker?.issueId ?? null,
        normalizedInput.tracker?.identifier ?? null,
        normalizedInput.tracker?.url ?? null,
        normalizedInput.occurredAt,
        normalizedInput.tracker?.state ?? null,
        normalizedInput.occurredAt,
        normalizedInput.issueDescription,
        normalizedInput.occurredAt,
        normalizedInput.resultSummary,
        stableJson(mergedPullRequestUrls),
        normalizedInput.occurredAt,
        normalizedInput.targetSha,
        normalizedInput.sourceCreatedAt,
        normalizedInput.occurredAt,
        normalizedInput.stage,
        qaStatus,
        normalizedInput.occurredAt,
        normalizedInput.stage,
        qaStatus,
        normalizedInput.occurredAt,
        normalizedInput.stagingQaDetail,
        normalizedInput.occurredAt,
        normalizedInput.productionQaDetail,
        normalizedInput.occurredAt,
        normalizedInput.context ? stableJson(normalizedInput.context) : null,
        normalizedInput.occurredAt,
        normalizedInput.status,
        normalizedInput.occurredAt,
        normalizedInput.status,
        normalizedInput.occurredAt,
        recordedAt,
        runId,
        eventAttempt,
        eventId,
      ),
  ]);

  if ((results[1]?.meta.changes ?? 0) === 0) {
    const existingEvent = await db
      .prepare(
        `select id, run_id, event_key, attempt, stage, status, workflow_stage,
                detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
                pull_request_urls, target_sha, occurred_at, recorded_at
         from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(runId, storedEventKey)
      .first<HuntEventRow>();
    if (!existingEvent || !sameEvent(existingEvent, normalizedInput)) {
      throw new EventKeyConflictError();
    }
  }

  return runId;
}

export type HuntRecoveryAction = "retry" | "cancel";
export type HuntRecoveryOutcome =
  | "retried"
  | "cancelled"
  | "already_retried"
  | "already_cancelled"
  | "ineligible"
  | "not_found";

export async function recoverHuntRun(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    action: HuntRecoveryAction;
    requestId: string;
    actor: string;
    reason: string | null;
    occurredAt: string;
  },
): Promise<{
  outcome: HuntRecoveryOutcome;
  attempt: number | null;
  stage: AutoHuntStage | null;
}> {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) return { outcome: "not_found", attempt: null, stage: null };

  const eventKey = `admin:${input.action}:${input.requestId}`;
  const existingEvent = await db
    .prepare(
      `select attempt, stage from briar_hunt_events
       where run_id = ? and event_key = ?`,
    )
    .bind(run.id, eventKey)
    .first<Pick<HuntEventRow, "attempt" | "stage">>();
  if (existingEvent) {
    return {
      outcome:
        input.action === "retry" ? "already_retried" : "already_cancelled",
      attempt: existingEvent.attempt,
      stage: existingEvent.stage,
    };
  }

  if (!(["blocked", "failed"] as AutoHuntRunStatus[]).includes(run.status)) {
    return {
      outcome: "ineligible",
      attempt: run.current_attempt,
      stage: run.stage,
    };
  }

  const eventId = crypto.randomUUID();
  const recordedAt = new Date().toISOString();
  const nextAttempt =
    input.action === "retry" ? run.current_attempt + 1 : run.current_attempt;
  const nextStage: AutoHuntStage =
    input.action === "retry" ? "queued" : "cancelled";
  const detail =
    input.reason ??
    (input.action === "retry"
      ? `Auto Hunt ${nextAttempt}차 시도를 요청했습니다.`
      : "사용자가 Auto Hunt 작업을 취소했습니다.");

  const update =
    input.action === "retry"
      ? db
          .prepare(
            `update briar_hunt_runs
             set stage = 'queued', status = 'queued', workflow_stage = null,
                 detail = ?, current_attempt = ?,
                 branch = null, commit_sha = null, result_summary = null,
                 pull_request_urls = '[]',
                 target_sha = null, staging_qa_status = null,
                 production_qa_status = null, staging_qa_detail = null,
                 production_qa_detail = null, claim_token_hash = null,
                 claimed_by = null, claimed_at = null, lease_expires_at = null,
                 completed_at = null, last_event_at = ?, updated_at = ?
             where id = ? and project_id = ? and status in ('blocked', 'failed')
               and current_attempt = ? and last_event_at = ?`,
          )
          .bind(
            detail,
            nextAttempt,
            input.occurredAt,
            recordedAt,
            run.id,
            projectId,
            run.current_attempt,
            run.last_event_at,
          )
      : db
          .prepare(
            `update briar_hunt_runs
             set stage = 'cancelled', status = 'cancelled', detail = ?,
                 claim_token_hash = null,
                 claimed_by = null, claimed_at = null, lease_expires_at = null,
                 completed_at = ?, last_event_at = ?, updated_at = ?
             where id = ? and project_id = ? and status in ('blocked', 'failed')
               and current_attempt = ? and last_event_at = ?`,
          )
          .bind(
            detail,
            input.occurredAt,
            input.occurredAt,
            recordedAt,
            run.id,
            projectId,
            run.current_attempt,
            run.last_event_at,
          );

  const results = await db.batch([
    update,
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, stage, status, workflow_stage,
           detail, actor, branch,
           commit_sha, qa_status, tracker_issue_state, pull_request_urls,
           target_sha, occurred_at, recorded_at
         )
         select ?, id, ?, ?, ?, ?, null, ?, ?, null, null, null,
                tracker_issue_state, '[]', null, ?, ?
         from briar_hunt_runs
         where id = ? and project_id = ? and current_attempt = ?
           and status = ? and last_event_at = ?
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        eventKey,
        nextAttempt,
        nextStage,
        nextStage,
        detail,
        input.actor,
        input.occurredAt,
        recordedAt,
        run.id,
        projectId,
        nextAttempt,
        nextStage,
        input.occurredAt,
      ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    const duplicate = await db
      .prepare(
        `select attempt, stage from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(run.id, eventKey)
      .first<Pick<HuntEventRow, "attempt" | "stage">>();
    if (duplicate) {
      return {
        outcome:
          input.action === "retry" ? "already_retried" : "already_cancelled",
        attempt: duplicate.attempt,
        stage: duplicate.stage,
      };
    }
    const current = await getHuntRunForProject(db, projectId, run.id);
    return {
      outcome: "ineligible",
      attempt: current?.current_attempt ?? null,
      stage: current?.stage ?? null,
    };
  }

  return {
    outcome: input.action === "retry" ? "retried" : "cancelled",
    attempt: nextAttempt,
    stage: nextStage,
  };
}

export type HuntMoveOutcome =
  "moved" | "unchanged" | "already_moved" | "not_found";

export async function moveHuntRun(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    status: AutoHuntRunStatus;
    workflowStage: AutoHuntWorkflowStageId | null;
    requestId: string;
    actor: string;
    occurredAt: string;
  },
): Promise<{
  outcome: HuntMoveOutcome;
  status: AutoHuntRunStatus | null;
  workflowStage: AutoHuntWorkflowStageId | null;
}> {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) {
    return { outcome: "not_found", status: null, workflowStage: null };
  }

  const workflow = parseWorkflow(run.workflow_snapshot_json);
  if (input.status === "running") {
    if (
      !input.workflowStage ||
      !workflow.stages.some((stage) => stage.id === input.workflowStage)
    ) {
      throw new HuntTransitionError(
        `Workflow stage is not configured for this run: ${input.workflowStage ?? "none"}`,
      );
    }
  } else if (input.workflowStage !== null) {
    throw new HuntTransitionError(
      "Only running status can select a workflow stage",
    );
  }

  const targetWorkflowStage =
    input.status === "backlog" || input.status === "queued"
      ? null
      : input.status === "running"
        ? input.workflowStage
        : run.workflow_stage;
  const eventKey = `admin:move:${input.requestId}`;
  const existingEvent = await db
    .prepare(
      `select status, workflow_stage from briar_hunt_events
       where run_id = ? and event_key = ?`,
    )
    .bind(run.id, eventKey)
    .first<Pick<HuntEventRow, "status" | "workflow_stage">>();
  if (existingEvent) {
    return {
      outcome: "already_moved",
      status: existingEvent.status,
      workflowStage: existingEvent.workflow_stage,
    };
  }
  if (
    run.status === input.status &&
    (input.status !== "running" || run.workflow_stage === targetWorkflowStage)
  ) {
    return {
      outcome: "unchanged",
      status: run.status,
      workflowStage: run.workflow_stage,
    };
  }

  const targetStage = legacyStageFor(input.status, targetWorkflowStage);
  const targetLabel =
    input.status === "running"
      ? workflow.stages.find((stage) => stage.id === targetWorkflowStage)?.label
      : {
          backlog: "백로그",
          queued: "대기",
          blocked: "차단",
          failed: "실패",
          completed: "완료",
          cancelled: "취소",
        }[input.status];
  const detail = `사용자가 작업을 ${targetLabel ?? input.status} 상태로 이동했습니다.`;
  const eventId = crypto.randomUUID();
  const recordedAt = new Date().toISOString();
  const targetAttempt =
    input.status === "queued" ? run.current_attempt + 1 : run.current_attempt;
  const completedAt = ["completed", "cancelled"].includes(input.status)
    ? input.occurredAt
    : null;

  const results = await db.batch([
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, stage, status, workflow_stage,
           detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
           pull_request_urls, target_sha, occurred_at, recorded_at
         )
         select ?, id, ?, ?, ?, ?, ?, ?, ?, branch, commit_sha,
                null, tracker_issue_state, pull_request_urls, target_sha, ?, ?
         from briar_hunt_runs
         where id = ? and project_id = ? and current_attempt = ?
           and last_event_at = ?
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        eventKey,
        targetAttempt,
        targetStage,
        input.status,
        targetWorkflowStage,
        detail,
        input.actor,
        input.occurredAt,
        recordedAt,
        run.id,
        projectId,
        run.current_attempt,
        run.last_event_at,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set stage = ?, status = ?, workflow_stage = ?, detail = ?,
             current_attempt = ?,
             claim_token_hash = null, claimed_by = null, claimed_at = null,
             lease_expires_at = null, completed_at = ?, last_event_at = ?,
             updated_at = ?
         where id = ? and project_id = ? and current_attempt = ?
           and last_event_at = ?
           and exists (
             select 1 from briar_hunt_events
             where id = ? and run_id = briar_hunt_runs.id
           )`,
      )
      .bind(
        targetStage,
        input.status,
        targetWorkflowStage,
        detail,
        targetAttempt,
        completedAt,
        input.occurredAt,
        recordedAt,
        run.id,
        projectId,
        run.current_attempt,
        run.last_event_at,
        eventId,
      ),
  ]);

  if ((results[1]?.meta.changes ?? 0) === 0) {
    const duplicate = await db
      .prepare(
        `select status, workflow_stage from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(run.id, eventKey)
      .first<Pick<HuntEventRow, "status" | "workflow_stage">>();
    if (duplicate) {
      return {
        outcome: "already_moved",
        status: duplicate.status,
        workflowStage: duplicate.workflow_stage,
      };
    }
    throw new HuntTransitionError(
      "Auto Hunt run changed while its status was being moved",
    );
  }

  return {
    outcome: "moved",
    status: input.status,
    workflowStage: targetWorkflowStage,
  };
}

export type LinearImportRunInput = {
  sourceKey: string;
  title: string;
  description: string | null;
  priority: number | null;
  status: AutoHuntRunStatus;
  workflowStage: AutoHuntWorkflowStageId | null;
  tracker: {
    provider: string;
    issueId: string;
    identifier: string | null;
    url: string | null;
    state: string | null;
  };
  sourceCreatedAt: string | null;
};

/**
 * One-time admin import of external tracker issues. Bypasses completion
 * eligibility so historical Linear issues can land directly as completed.
 */
export async function importLinearHuntRuns(
  db: D1Database,
  projectId: string,
  repository: string,
  inputs: LinearImportRunInput[],
): Promise<{ imported: number; skipped: number; failed: number }> {
  const settings = await getProjectSettings(db, projectId);
  const workflowSnapshot = parseWorkflow(settings?.workflow_json);
  const workflowStageIds = new Set(
    workflowSnapshot.stages.map((stage) => stage.id),
  );

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const raw of inputs) {
    try {
      const title = raw.title.trim().slice(0, 300);
      if (!title) {
        failed += 1;
        continue;
      }
      const sourceKey = raw.sourceKey.trim().slice(0, 200);
      if (!sourceKey) {
        failed += 1;
        continue;
      }

      const existingBySource = await db
        .prepare(
          `select id from briar_hunt_runs
           where project_id = ? and source = 'issue' and source_key = ?
           limit 1`,
        )
        .bind(projectId, sourceKey)
        .first<{ id: string }>();
      if (existingBySource) {
        skipped += 1;
        continue;
      }

      const existingByTracker = await db
        .prepare(
          `select id from briar_hunt_runs
           where project_id = ? and tracker_provider = ? and tracker_issue_id = ?
           limit 1`,
        )
        .bind(projectId, raw.tracker.provider, raw.tracker.issueId)
        .first<{ id: string }>();
      if (existingByTracker) {
        skipped += 1;
        continue;
      }

      let status = raw.status;
      let workflowStage = status === "running" ? raw.workflowStage : null;
      if (
        status === "running" &&
        (!workflowStage || !workflowStageIds.has(workflowStage))
      ) {
        workflowStage = workflowSnapshot.stages[0]?.id ?? null;
        if (!workflowStage) {
          status = "queued";
          workflowStage = null;
        }
      }

      const stage = legacyStageFor(status, workflowStage);
      const runId = await digestRunId(projectId, "issue", sourceKey);
      const eventId = crypto.randomUUID();
      const recordedAt = new Date().toISOString();
      const occurredAt = raw.sourceCreatedAt ?? recordedAt;
      const completedAt = ["completed", "cancelled"].includes(status)
        ? occurredAt
        : null;
      const detail =
        status === "queued"
          ? "Linear에서 가져온 이슈가 Auto Hunt 처리를 기다리고 있습니다."
          : `Linear에서 가져왔으며 ${status} 상태로 설정되었습니다.`;
      const resultSummary =
        status === "completed" ? "Imported from Linear as completed." : null;
      const priority =
        raw.priority != null && raw.priority >= 1 && raw.priority <= 4
          ? raw.priority
          : null;

      const results = await db.batch([
        db
          .prepare(
            `insert into briar_hunt_runs (
               id, project_id, source, source_key, title, stage, status,
               workflow_stage, workflow_snapshot_json, detail, priority,
               repository, branch, commit_sha, tracker_provider,
               tracker_issue_id, tracker_issue_identifier, tracker_issue_url,
               tracker_issue_state, issue_description, result_summary,
               pull_request_urls, target_sha, source_created_at,
               staging_qa_status, production_qa_status, staging_qa_detail,
               production_qa_detail, context_json, started_at, completed_at,
               last_event_at, created_at, updated_at
             ) values (?, ?, 'issue', ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null, ?, ?, ?, ?, ?, ?, ?, '[]', null, ?, null, null, null, null, ?, ?, ?, ?, ?, ?)
             on conflict(project_id, source, source_key) do nothing`,
          )
          .bind(
            runId,
            projectId,
            sourceKey,
            title,
            stage,
            status,
            workflowStage,
            stableJson(workflowSnapshot),
            detail,
            priority,
            repository,
            raw.tracker.provider,
            raw.tracker.issueId,
            raw.tracker.identifier,
            raw.tracker.url,
            raw.tracker.state,
            raw.description?.slice(0, 100_000) ?? null,
            resultSummary,
            raw.sourceCreatedAt,
            stableJson({
              origin: "linear-import",
              linearIssueId: raw.tracker.issueId,
            }),
            occurredAt,
            completedAt,
            occurredAt,
            recordedAt,
            recordedAt,
          ),
        db
          .prepare(
            `insert into briar_hunt_events (
               id, run_id, event_key, attempt, stage, status, workflow_stage,
               detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
               pull_request_urls, target_sha, occurred_at, recorded_at
             ) values (?, ?, ?, 1, ?, ?, ?, ?, 'briar-linear-import', null, null, null, ?, '[]', null, ?, ?)
             on conflict(run_id, event_key) do nothing`,
          )
          .bind(
            eventId,
            runId,
            `${sourceKey}:import`,
            stage,
            status,
            workflowStage,
            detail,
            raw.tracker.state,
            occurredAt,
            recordedAt,
          ),
      ]);

      if ((results[0]?.meta.changes ?? 0) === 0) {
        skipped += 1;
      } else {
        imported += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return { imported, skipped, failed };
}

export type QaActionOutcome =
  | "passed"
  | "already_passed"
  | "skipped"
  | "already_skipped"
  | "ineligible"
  | "not_found";

export async function recordQaResult(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    environment: AutoHuntQaEnvironment;
    result: "passed" | "skipped";
    actor: string;
    observedAt: string;
    detail: string | null;
  },
): Promise<QaActionOutcome> {
  const run = await db
    .prepare(`select * from briar_hunt_runs where id = ? and project_id = ?`)
    .bind(input.runId, projectId)
    .first<HuntRunRow>();
  if (!run) return "not_found";

  const statusColumn =
    input.environment === "staging"
      ? "staging_qa_status"
      : "production_qa_status";
  const expectedStage =
    input.environment === "staging" ? "staging_qa" : "production_qa";
  const currentStatus = run[statusColumn];
  if (currentStatus === input.result) return `already_${input.result}`;
  const eligible =
    input.result === "passed"
      ? run.stage === expectedStage && currentStatus === "pending"
      : currentStatus === "pending" &&
        [expectedStage, "blocked", "failed"].includes(run.stage);
  if (!eligible) return "ineligible";

  const eventId = crypto.randomUUID();
  const eventKey = `admin:qa-${input.result === "passed" ? "pass" : "skip"}:${input.environment}:attempt-${run.current_attempt}`;
  const detail =
    input.detail ??
    (input.result === "passed"
      ? `${input.environment === "staging" ? "Stage" : "Production"} QA를 완료했습니다.`
      : `${input.environment === "staging" ? "Stage" : "Production"} QA를 건너뛰었습니다.`);
  const recordedAt = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, stage, status, workflow_stage,
           detail, actor, branch, commit_sha,
           qa_status, tracker_issue_state, pull_request_urls, target_sha,
           occurred_at, recorded_at
         ) values (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        run.id,
        eventKey,
        run.current_attempt,
        expectedStage,
        expectedStage,
        detail,
        input.actor,
        run.branch,
        run.commit_sha,
        input.result,
        run.tracker_issue_state,
        run.pull_request_urls,
        run.target_sha,
        input.observedAt,
        recordedAt,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set ${statusColumn} = ?, detail = ?, last_event_at = max(last_event_at, ?),
             updated_at = ?
         where id = ? and project_id = ? and current_attempt = ?
           and exists (
             select 1 from briar_hunt_events
             where id = ? and run_id = briar_hunt_runs.id
           )`,
      )
      .bind(
        input.result,
        detail,
        input.observedAt,
        recordedAt,
        run.id,
        projectId,
        run.current_attempt,
        eventId,
      ),
  ]);

  if ((results[1]?.meta.changes ?? 0) === 0) return "ineligible";

  if ((results[0]?.meta.changes ?? 0) === 0) {
    const existing = await db
      .prepare(
        `select qa_status from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(run.id, eventKey)
      .first<AutoHuntQaStatus>("qa_status");
    if (existing !== input.result) throw new EventKeyConflictError();
    return `already_${input.result}`;
  }
  return input.result;
}

export async function getHuntRunForProject(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  return db
    .prepare(`select * from briar_hunt_runs where id = ? and project_id = ?`)
    .bind(runId, projectId)
    .first<HuntRunRow>();
}
