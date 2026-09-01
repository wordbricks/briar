import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  applyD1Migrations,
  executeD1Sql,
} from "./test-helpers/d1";

describe("project Agent schedule recurrence migration", () => {
  it("canonicalizes flexible recurrence without breaking schedule runs", async () => {
    const db = env.DB;
    const now = "2026-08-31T00:00:00.000Z";
    await applyD1Migrations(db, {
      through: "0159_issue_attachment_uploads.sql",
    });
    await executeD1Sql(db, `
      insert into "user" (
        id, name, email, emailVerified, createdAt, updatedAt
      ) values
        ('schedule-owner', 'Schedule Owner', 'schedule@example.com', 1,
         '${now}', '${now}'),
        ('schedule-other', 'Schedule Other', 'other@example.com', 1,
         '${now}', '${now}');
      insert into briar_organizations (
        id, name, handle, created_at, updated_at
      ) values (
        'schedule-org', 'Schedule Org', 'schedule-org', '${now}', '${now}'
      );
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values (
        'schedule-project', 'schedule-owner', 'schedule-org',
        'Schedule Project', '${"a".repeat(64)}', '${now}', '${now}'
      );
      insert into briar_project_agents (
        id, organization_id, project_id, name, provider, responsibility,
        created_at, updated_at
      ) values (
        'schedule-agent', 'schedule-org', 'schedule-project',
        'Schedule Agent', 'codex', 'Run scheduled work', '${now}', '${now}'
      );
      insert into briar_project_agent_schedules (
        id, project_id, agent_id, name, recurrence, frequency, time_of_day,
        day_of_week, time_zone, enabled, created_at, updated_at, next_run_at,
        interval_value, interval_unit, days_of_week, notification_level,
        created_by_user_id
      ) values (
        'flexible-schedule', 'schedule-project', 'schedule-agent',
        'Flexible schedule', 'daily', 'custom', '09:30', null, 'Asia/Seoul',
        1, '${now}', '${now}', '2026-09-01T00:30:00.000Z', 2, 'week',
        '1,3,5', 'none', 'schedule-owner'
      );
      insert into briar_project_agent_schedule_runs (
        id, project_id, schedule_id, agent_id, status, scheduled_for,
        started_at, created_at, updated_at
      ) values (
        'schedule-run', 'schedule-project', 'flexible-schedule',
        'schedule-agent', 'completed', '2026-08-25T00:30:00.000Z',
        '${now}', '${now}', '${now}'
      );
    `);

    await applyD1Migrations(db, {
      files: ["0160_canonical_project_agent_schedule_recurrence.sql"],
    });

    expect(await db.prepare(
      `select recurrence, time_of_day, interval_value, interval_unit,
              days_of_week, notification_level, created_by_user_id
       from briar_project_agent_schedules where id = 'flexible-schedule'`,
    ).first()).toEqual({
      recurrence: "custom",
      time_of_day: "09:30",
      interval_value: 2,
      interval_unit: "week",
      days_of_week: "1,3,5",
      notification_level: "none",
      created_by_user_id: "schedule-owner",
    });
    expect(await db.prepare(
      `select schedule_id from briar_project_agent_schedule_runs
       where id = 'schedule-run'`,
    ).first()).toEqual({ schedule_id: "flexible-schedule" });
    await expect(db.prepare(
      `update briar_project_agent_schedules
       set created_by_user_id = 'schedule-other'
       where id = 'flexible-schedule'`,
    ).run()).rejects.toThrow(/creator is immutable/iu);
    expect((await db.prepare(`pragma foreign_key_check`).all()).results)
      .toEqual([]);
  });
});
