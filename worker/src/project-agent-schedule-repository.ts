import type { StructuredAgentResult } from "../../src/lib/agent-result";
import {
  nextProjectAgentScheduleRunAt,
  parseProjectAgentScheduleDays,
  serializeProjectAgentScheduleDays,
  type ProjectAgentScheduleIntervalUnit,
  type ProjectAgentScheduleNotificationLevel,
  type ProjectAgentScheduleRecurrence,
} from "../../src/lib/project-agent-schedule";
import {
  listAgentSkills,
  type AgentSkillRow,
} from "./agent-skills";

import { stableJson } from "./hunt-run-codec";
import {
  type ProjectAgentScheduleRow,
  type ProjectAgentScheduleRunRow,
  type ProjectAgentScheduleRunStatus,
} from "./project-agent-model";

type ProjectAgentScheduleInput = {
  agentId: string;
  name: string;
  recurrence: ProjectAgentScheduleRecurrence;
  timeOfDay: string;
  dayOfWeek: number | null;
  intervalValue?: number;
  intervalUnit?: ProjectAgentScheduleIntervalUnit;
  daysOfWeek?: number[];
  notificationLevel?: ProjectAgentScheduleNotificationLevel;
  timeZone: string;
  createdByUserId?: string | null;
};

function persistedProjectAgentScheduleRecurrence(
  input: ProjectAgentScheduleInput,
): "daily" | "weekdays" | "weekly" {
  if (input.recurrence === "interval") return "daily";
  if (input.recurrence === "custom") return "daily";
  return input.recurrence;
}

export async function listProjectAgentSchedules(
  db: D1Database,
  projectId: string,
) {
  const result = await db
    .prepare(
      `select schedule.id, schedule.project_id, schedule.agent_id,
              agent.name as agent_name, agent.provider as agent_provider,
              schedule.name, schedule.recurrence, schedule.frequency,
              schedule.time_of_day, schedule.day_of_week,
              schedule.interval_value, schedule.interval_unit,
              schedule.days_of_week, schedule.notification_level,
              schedule.time_zone, schedule.enabled,
              schedule.next_run_at, schedule.created_by_user_id,
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

export async function getProjectAgentScheduleCreatorId(
  db: D1Database,
  projectId: string,
  scheduleId: string,
) {
  const schedule = await db
    .prepare(
      `select created_by_user_id
       from briar_project_agent_schedules
       where project_id = ? and id = ?`,
    )
    .bind(projectId, scheduleId)
    .first<{ created_by_user_id: string | null }>();
  return schedule?.created_by_user_id ?? null;
}

export async function createProjectAgentSchedule(
  db: D1Database,
  projectId: string,
  input: ProjectAgentScheduleInput,
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
      intervalValue: input.intervalValue,
      intervalUnit: input.intervalUnit,
      daysOfWeek: input.daysOfWeek,
      anchorAt: createdAt,
      timeZone: input.timeZone,
    },
    new Date(
      Date.parse(createdAt) -
        (input.recurrence === "interval" ? 0 : 60_000),
    ),
  );
  const persistedRecurrence = persistedProjectAgentScheduleRecurrence(input);
  await db
    .prepare(
      `insert into briar_project_agent_schedules (
         id, project_id, agent_id, name, recurrence, frequency, time_of_day,
         day_of_week, interval_value, interval_unit, days_of_week,
         notification_level, time_zone, enabled, next_run_at, created_at,
         updated_at, created_by_user_id
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      projectId,
      input.agentId,
      input.name,
      persistedRecurrence,
      input.recurrence,
      input.timeOfDay,
      input.dayOfWeek,
      input.intervalValue ?? 1,
      input.intervalUnit ??
        (input.recurrence === "interval" ? "hour" : "day"),
      serializeProjectAgentScheduleDays(input.daysOfWeek),
      input.notificationLevel ?? "important_updates",
      input.timeZone,
      nextRunAt,
      createdAt,
      createdAt,
      input.createdByUserId ?? null,
    )
    .run();

  return await db
    .prepare(
      `select schedule.id, schedule.project_id, schedule.agent_id,
              agent.name as agent_name, agent.provider as agent_provider,
              schedule.name, schedule.recurrence, schedule.frequency,
              schedule.time_of_day, schedule.day_of_week,
              schedule.interval_value, schedule.interval_unit,
              schedule.days_of_week, schedule.notification_level,
              schedule.time_zone, schedule.enabled,
              schedule.next_run_at, schedule.created_by_user_id,
              schedule.created_at, schedule.updated_at
       from briar_project_agent_schedules schedule
       join briar_project_agents agent on agent.id = schedule.agent_id
       where schedule.id = ? and schedule.project_id = ?`,
    )
    .bind(id, projectId)
    .first<ProjectAgentScheduleRow>();
}

export async function updateProjectAgentSchedule(
  db: D1Database,
  projectId: string,
  scheduleId: string,
  input: ProjectAgentScheduleInput,
) {
  const observedAt = new Date().toISOString();
  const existing = await db
    .prepare(
      `select created_at
       from briar_project_agent_schedules
       where id = ? and project_id = ?`,
    )
    .bind(scheduleId, projectId)
    .first<{ created_at: string }>();
  const nextRunAt = nextProjectAgentScheduleRunAt(
    {
      recurrence: input.recurrence,
      timeOfDay: input.timeOfDay,
      dayOfWeek: input.dayOfWeek,
      intervalValue: input.intervalValue,
      intervalUnit: input.intervalUnit,
      daysOfWeek: input.daysOfWeek,
      anchorAt: existing?.created_at ?? observedAt,
      timeZone: input.timeZone,
    },
    new Date(
      Date.parse(observedAt) -
        (input.recurrence === "interval" ? 0 : 60_000),
    ),
  );
  const persistedRecurrence = persistedProjectAgentScheduleRecurrence(input);
  const updated = await db
    .prepare(
      `update briar_project_agent_schedules
       set agent_id = ?, name = ?, recurrence = ?, frequency = ?,
           time_of_day = ?, day_of_week = ?, interval_value = ?,
           interval_unit = ?, days_of_week = ?, notification_level = ?,
           time_zone = ?, next_run_at = ?, updated_at = ?
       where id = ? and project_id = ?
         and exists (
           select 1 from briar_project_agents agent
           where agent.id = ? and agent.project_id = ?
         )
       returning id`,
    )
    .bind(
      input.agentId,
      input.name,
      persistedRecurrence,
      input.recurrence,
      input.timeOfDay,
      input.dayOfWeek,
      input.intervalValue ?? 1,
      input.intervalUnit ??
        (input.recurrence === "interval" ? "hour" : "day"),
      serializeProjectAgentScheduleDays(input.daysOfWeek),
      input.notificationLevel ?? "important_updates",
      input.timeZone,
      nextRunAt,
      observedAt,
      scheduleId,
      projectId,
      input.agentId,
      projectId,
    )
    .first<{ id: string }>();
  if (!updated) return null;
  return db
    .prepare(
      `select schedule.id, schedule.project_id, schedule.agent_id,
              agent.name as agent_name, agent.provider as agent_provider,
              schedule.name, schedule.recurrence, schedule.frequency,
              schedule.time_of_day, schedule.day_of_week,
              schedule.interval_value, schedule.interval_unit,
              schedule.days_of_week, schedule.notification_level,
              schedule.time_zone, schedule.enabled,
              schedule.next_run_at, schedule.created_by_user_id,
              schedule.created_at, schedule.updated_at
       from briar_project_agent_schedules schedule
       join briar_project_agents agent on agent.id = schedule.agent_id
       where schedule.id = ? and schedule.project_id = ?`,
    )
    .bind(scheduleId, projectId)
    .first<ProjectAgentScheduleRow>();
}

export async function deleteProjectAgentSchedule(
  db: D1Database,
  projectId: string,
  scheduleId: string,
): Promise<"deleted" | "running" | "not_found"> {
  const result = await db
    .prepare(
      `delete from briar_project_agent_schedules
       where id = ? and project_id = ?
         and not exists (
           select 1 from briar_project_agent_schedule_runs run
           where run.schedule_id = briar_project_agent_schedules.id
             and run.project_id = briar_project_agent_schedules.project_id
             and run.status = 'running'
         )`,
    )
    .bind(scheduleId, projectId)
    .run();
  if (result.meta.changes === 1) return "deleted";
  const schedule = await db
    .prepare(
      `select id from briar_project_agent_schedules
       where id = ? and project_id = ?`,
    )
    .bind(scheduleId, projectId)
    .first<{ id: string }>();
  return schedule ? "running" : "not_found";
}

const scheduleRunSelect = `
  select run.id, run.project_id, run.schedule_id,
         schedule.name as schedule_name,
         run.agent_id, agent.name as agent_name,
         agent.provider as agent_provider,
         agent.model as agent_model,
         agent.effort as agent_effort,
         agent.description as agent_description,
         agent.responsibility as agent_responsibility,
         agent.skill_markdown as agent_skill_markdown,
         settings.workflow_json,
         run.status, run.scheduled_for, run.lease_expires_at,
         run.started_at, run.completed_at, run.result_summary,
         run.structured_result_json, run.error,
         run.created_at, run.updated_at
  from briar_project_agent_schedule_runs run
  join briar_project_agent_schedules schedule on schedule.id = run.schedule_id
  join briar_project_agents agent on agent.id = run.agent_id
  join briar_project_settings settings on settings.project_id = run.project_id`;

type UnhydratedProjectAgentScheduleRunRow = Omit<
  ProjectAgentScheduleRunRow,
  "agent_skills"
>;

async function hydrateScheduleRunAgentSkills(
  db: D1Database,
  rows: readonly UnhydratedProjectAgentScheduleRunRow[],
): Promise<ProjectAgentScheduleRunRow[]> {
  const skills = await listAgentSkills(
    db,
    [...new Set(rows.map((row) => row.agent_id))],
  );
  const byAgent = new Map<string, AgentSkillRow[]>();
  for (const skill of skills) {
    const current = byAgent.get(skill.agent_id) ?? [];
    current.push(skill);
    byAgent.set(skill.agent_id, current);
  }
  return rows.map((row) => ({
    ...row,
    agent_skills: byAgent.get(row.agent_id) ?? [],
  }));
}

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
    .all<UnhydratedProjectAgentScheduleRunRow>();
  return hydrateScheduleRunAgentSkills(db, result.results);
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
      `select id, coalesce(frequency, recurrence) as frequency,
              time_of_day, day_of_week, interval_value, interval_unit,
              days_of_week, time_zone, created_at
       from briar_project_agent_schedules
       where project_id = ? and enabled = 1 and next_run_at is null`,
    )
    .bind(projectId)
    .all<{
      id: string;
      frequency: ProjectAgentScheduleRecurrence;
      time_of_day: string;
      day_of_week: number | null;
      interval_value: number;
      interval_unit: ProjectAgentScheduleIntervalUnit;
      days_of_week: string | null;
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
        recurrence: schedule.frequency,
        timeOfDay: schedule.time_of_day,
        dayOfWeek: schedule.day_of_week,
        intervalValue: schedule.interval_value,
        intervalUnit: schedule.interval_unit,
        daysOfWeek: parseProjectAgentScheduleDays(schedule.days_of_week),
        anchorAt: schedule.created_at,
        timeZone: schedule.time_zone,
      },
      new Date(
        startAt - (schedule.frequency === "interval" ? 0 : 60_000),
      ),
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
  const selected = await db
    .prepare(`${scheduleRunSelect} where run.id = ? and run.project_id = ?`)
    .bind(run.id, projectId)
    .first<UnhydratedProjectAgentScheduleRunRow>();
  if (!selected) return null;
  return (await hydrateScheduleRunAgentSkills(db, [selected]))[0];
}

export async function listClaimableProjectAgentScheduleProjectIds(
  db: D1Database,
  userId: string,
  projectIds: readonly string[],
  observedAt: string,
) {
  const uniqueProjectIds = [...new Set(projectIds)].slice(0, 100);
  if (uniqueProjectIds.length === 0) return [];
  const placeholders = uniqueProjectIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `select project.id
       from briar_projects project
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = ?
       where project.id in (${placeholders})
         and (
           exists (
             select 1 from briar_project_agent_schedule_runs run
             where run.project_id = project.id and run.status = 'running'
               and run.lease_expires_at is not null
               and run.lease_expires_at <= ?
           )
           or exists (
             select 1 from briar_project_agent_schedules schedule
             where schedule.project_id = project.id and schedule.enabled = 1
               and (
                 schedule.next_run_at is null or schedule.next_run_at <= ?
               )
               and not exists (
                 select 1 from briar_project_agent_schedule_runs active
                 where active.schedule_id = schedule.id
                   and active.status = 'running'
                   and active.lease_expires_at > ?
               )
           )
         )
       order by project.id`,
    )
    .bind(
      userId,
      ...uniqueProjectIds,
      observedAt,
      observedAt,
      observedAt,
    )
    .all<{ id: string }>();
  return result.results.map((row) => row.id);
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
              coalesce(schedule.frequency, schedule.recurrence) as frequency,
              schedule.time_of_day, schedule.day_of_week,
              schedule.interval_value, schedule.interval_unit,
              schedule.days_of_week, schedule.time_zone, schedule.created_at
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
      frequency: ProjectAgentScheduleRecurrence;
      time_of_day: string;
      day_of_week: number | null;
      interval_value: number;
      interval_unit: ProjectAgentScheduleIntervalUnit;
      days_of_week: string | null;
      time_zone: string;
      created_at: string;
    }>();
  if (!schedule) return null;

  const nextRunAt = nextProjectAgentScheduleRunAt(
    {
      recurrence: schedule.frequency,
      timeOfDay: schedule.time_of_day,
      dayOfWeek: schedule.day_of_week,
      intervalValue: schedule.interval_value,
      intervalUnit: schedule.interval_unit,
      daysOfWeek: parseProjectAgentScheduleDays(schedule.days_of_week),
      anchorAt: schedule.created_at,
      timeZone: schedule.time_zone,
    },
    new Date(
      Math.max(Date.parse(schedule.next_run_at), Date.parse(input.observedAt)),
    ),
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
  const selected = await db
    .prepare(`${scheduleRunSelect} where run.id = ? and run.project_id = ?`)
    .bind(runId, projectId)
    .first<UnhydratedProjectAgentScheduleRunRow>();
  if (!selected) return null;
  return (await hydrateScheduleRunAgentSkills(db, [selected]))[0];
}

export async function completeProjectAgentScheduleRun(
  db: D1Database,
  projectId: string,
  runId: string,
  input: {
    claimTokenHash: string;
    status: Exclude<ProjectAgentScheduleRunStatus, "running">;
    resultSummary: string | null;
    structuredResult: StructuredAgentResult;
    error: string | null;
    observedAt: string;
  },
) {
  const row = await db
    .prepare(
      `update briar_project_agent_schedule_runs
       set status = ?, claim_token_hash = null, lease_expires_at = null,
           completed_at = ?, result_summary = ?, structured_result_json = ?,
           error = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claim_token_hash = ?
       returning id`,
    )
    .bind(
      input.status,
      input.observedAt,
      input.resultSummary,
      stableJson(input.structuredResult),
      input.error,
      input.observedAt,
      runId,
      projectId,
      input.claimTokenHash,
    )
    .first<{ id: string }>();
  if (!row) return null;
  const selected = await db
    .prepare(`${scheduleRunSelect} where run.id = ? and run.project_id = ?`)
    .bind(runId, projectId)
    .first<UnhydratedProjectAgentScheduleRunRow>();
  if (!selected) return null;
  return (await hydrateScheduleRunAgentSkills(db, [selected]))[0];
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
       set lease_expires_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claim_token_hash = ?
       returning id, lease_expires_at`,
    )
    .bind(
      scheduleLeaseExpiresAt(input.observedAt),
      runId,
      projectId,
      input.claimTokenHash,
    )
    .first<{ id: string; lease_expires_at: string }>();
}
