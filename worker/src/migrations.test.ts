import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { describe, expect, it } from "vitest";
import { applyD1Migrations, executeD1Sql } from "./test-helpers/d1";

async function withPreWorkflowMigrationDatabase(
  name: string,
  test: (db: D1Database) => Promise<void>,
) {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: name },
  });
  try {
    const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
    await applyD1Migrations(db, {
      through: "0058_workflow_pause_after_stage.sql",
    });
    await test(db);
  } finally {
    await miniflare.dispose();
  }
}

const migrationFixture = {
  userId: "migration-owner",
  organizationId: "migration-organization",
  projectId: "migration-project",
  runId: "migration-run",
  now: "2026-08-10T00:00:00.000Z",
  pausedAt: "2026-08-10T00:05:00.000Z",
  workflow: JSON.stringify({
    version: 1,
    stages: [{ id: "implementing", label: "Implement", required: true }],
    completion: { requiredStages: ["implementing"] },
    release: { enabled: false },
  }),
} as const;

async function seedPreWorkflowProjectRun(db: D1Database) {
  const fixture = migrationFixture;
  await db.prepare(
    `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
     values (?, 'Migration Owner', 'migration@example.com', 1, ?, ?)`,
  ).bind(fixture.userId, fixture.now, fixture.now).run();
  await db.prepare(
    `insert into briar_organizations (id, name, handle, created_at, updated_at)
     values (?, 'Migration Organization', 'migration-organization', ?, ?)`,
  ).bind(fixture.organizationId, fixture.now, fixture.now).run();
  await db.prepare(
    `insert into briar_projects (
       id, owner_user_id, organization_id, name, agent_token_hash,
       created_at, updated_at
     ) values (?, ?, ?, 'Migration Project', ?, ?, ?)`,
  ).bind(
    fixture.projectId,
    fixture.userId,
    fixture.organizationId,
    "a".repeat(64),
    fixture.now,
    fixture.now,
  ).run();
  await db.prepare(
    `insert into briar_project_settings (
       project_id, workflow_json, created_at, updated_at
     ) values (?, ?, ?, ?)`,
  ).bind(fixture.projectId, fixture.workflow, fixture.now, fixture.now).run();
  await db.prepare(
    `insert into briar_hunt_runs (
       id, project_id, source, source_key, title, stage, repository,
       started_at, last_event_at, created_at, updated_at,
       workflow_snapshot_json, status, paused_at
     ) values (?, ?, 'issue', 'migration-issue', 'Migration run',
               'implementing', 'example/repository', ?, ?, ?, ?, ?, 'running', ?)`,
  ).bind(
    fixture.runId,
    fixture.projectId,
    fixture.now,
    fixture.now,
    fixture.now,
    fixture.now,
    fixture.workflow,
    fixture.pausedAt,
  ).run();
}

describe("D1 migrations", () => {
  it.each([
    "0049_dashboard_delta_sync.sql",
    "0050_hunt_run_event_count.sql",
    "0053_issue_result_reviews.sql",
    "0055_agent_provider_opencode.sql",
    "0074_channel_delta_sync.sql",
    "0081_optimize_dashboard_worker_device_sync.sql",
    "0083_suppress_heartbeat_dashboard_changes.sql",
  ])("keeps each trigger in a separate Wrangler statement: %s", async (name) => {
    const sql = await readFile(resolve("migrations", name), "utf8");
    const statements = unstable_splitSqlQuery(sql);
    const triggerCounts = statements.map(
      (statement) => statement.match(/\bcreate\s+trigger\b/giu)?.length ?? 0,
    );

    expect(Math.max(...triggerCounts)).toBeLessThanOrEqual(1);
    expect(triggerCounts.filter((count) => count === 1)).not.toHaveLength(0);
  });

  it("updates device fan-out cursors with indexed project lookups", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-dashboard-device-sync-migration-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      for (const statement of [
        `create table briar_execution_worker_devices (
           id text primary key not null,
           updated_at text not null
         )`,
        `create table briar_execution_workers (
           id text primary key not null,
           project_id text not null,
           device_id text not null
         )`,
        `create unique index briar_execution_workers_project_device_idx
           on briar_execution_workers (project_id, device_id)`,
        `create index briar_execution_workers_device_idx
           on briar_execution_workers (device_id, project_id)`,
        `create table briar_dashboard_changes (
           version integer primary key autoincrement,
           project_id text not null,
           entity_type text not null,
           entity_id text,
           operation text not null,
           created_at text not null
         )`,
        `create index briar_dashboard_changes_project_version_idx
           on briar_dashboard_changes (project_id, version)`,
        `create table briar_dashboard_sync_state (
           project_id text primary key not null,
           current_version integer not null
         )`,
        `create trigger briar_dashboard_worker_devices_update_sync
         after update on briar_execution_worker_devices BEGIN
           select new.id;
         END`,
      ]) {
        await db.prepare(statement).run();
      }
      await db.prepare(
        `insert into briar_execution_worker_devices (id, updated_at)
         values ('device-1', '2026-08-10T00:00:00.000Z')`,
      ).run();
      await db.prepare(
        `insert into briar_execution_workers (id, project_id, device_id)
         values ('worker-1', 'project-1', 'device-1'),
                ('worker-2', 'project-2', 'device-1')`,
      ).run();
      await db.prepare(
        `insert into briar_dashboard_changes (
           project_id, entity_type, entity_id, operation, created_at
         ) values
           ('project-1', 'run', 'run-1', 'upsert', '2026-08-10 00:00:00'),
           ('project-2', 'run', 'run-2', 'upsert', '2026-08-10 00:00:00'),
           ('project-3', 'run', 'run-3', 'upsert', '2026-08-10 00:00:00')`,
      ).run();
      await db.prepare(
        `with recursive sequence(value) as (
           select 1
           union all
           select value + 1 from sequence where value < 1000
         )
         insert into briar_dashboard_changes (
           project_id, entity_type, entity_id, operation, created_at
         )
         select 'project-history', 'run', 'history-' || value, 'upsert',
                '2026-08-10 00:00:00'
         from sequence`,
      ).run();
      await db.prepare(
        `insert into briar_dashboard_sync_state (project_id, current_version)
         values ('project-1', 1), ('project-2', 2), ('project-3', 3)`,
      ).run();

      const sql = await readFile(
        resolve(
          "migrations",
          "0081_optimize_dashboard_worker_device_sync.sql",
        ),
        "utf8",
      );
      for (const statement of unstable_splitSqlQuery(sql)) {
        await db.prepare(statement).run();
      }
      const update = await db.prepare(
        `update briar_execution_worker_devices
         set updated_at = '2026-08-10T00:01:00.000Z'
         where id = 'device-1'`,
      ).run();
      expect(update.meta.rows_read).toBeLessThan(50);

      const changes = await db.prepare(
        `select project_id, entity_id
         from briar_dashboard_changes
         where entity_type = 'worker'
         order by project_id`,
      ).all<{ project_id: string; entity_id: string }>();
      expect(changes.results).toEqual([
        { project_id: "project-1", entity_id: "worker-1" },
        { project_id: "project-2", entity_id: "worker-2" },
      ]);

      const cursors = await db.prepare(
        `select state.project_id, state.current_version,
                max(change.version) as latest_version
         from briar_dashboard_sync_state state
         join briar_dashboard_changes change
           on change.project_id = state.project_id
         group by state.project_id, state.current_version
         order by state.project_id`,
      ).all<{
        project_id: string;
        current_version: number;
        latest_version: number;
      }>();
      expect(cursors.results).toHaveLength(3);
      expect(cursors.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            project_id: "project-1",
            current_version: expect.any(Number),
          }),
          expect.objectContaining({
            project_id: "project-2",
            current_version: expect.any(Number),
          }),
          { project_id: "project-3", current_version: 3, latest_version: 3 },
        ]),
      );
      expect(
        cursors.results
          .filter((row) => row.project_id !== "project-3")
          .every((row) => row.current_version === row.latest_version),
      ).toBe(true);

      const plan = await db.prepare(
        `explain query plan
         select worker.project_id, (
           select change.version
             from briar_dashboard_changes change
            where change.project_id = worker.project_id
            order by change.version desc
            limit 1
         )
         from briar_execution_workers worker
         where worker.device_id = 'device-1'`,
      ).all<{ detail: string }>();
      const details = plan.results.map((row) => row.detail).join("\n");
      expect(details).toContain("briar_execution_workers_device_idx");
      expect(details).toContain("briar_dashboard_changes_project_version_idx");
      expect(details).not.toMatch(/scan briar_dashboard_changes/iu);
    } finally {
      await miniflare.dispose();
    }
  });

  it("suppresses heartbeat-only dashboard changes without hiding semantic updates", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-dashboard-heartbeat-suppression-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await executeD1Sql(
        db,
        `create table briar_execution_worker_devices (
           id text primary key not null,
           organization_id text not null,
           owner_user_id text not null,
           label text not null,
           device_identity_hash text not null,
           state text not null,
           max_concurrent_sessions integer not null,
           icon_type text,
           icon_value text,
           last_heartbeat_at text not null,
           created_at text not null,
           updated_at text not null
         );
         create table briar_execution_workers (
           id text primary key not null,
           project_id text not null,
           device_id text not null,
           label text not null,
           host_fingerprint text not null,
           agent_provider text not null,
           versions_json text not null,
           capabilities_json text not null,
           state text not null,
           accepting_work integer not null,
           readiness_state text not null,
           readiness_detail text,
           last_heartbeat_at text not null,
           created_at text not null,
           updated_at text not null
         );
         create unique index briar_execution_workers_project_device_idx
           on briar_execution_workers (project_id, device_id);
         create index briar_execution_workers_device_idx
           on briar_execution_workers (device_id, project_id);
         create table briar_dashboard_changes (
           version integer primary key autoincrement,
           project_id text not null,
           entity_type text not null,
           entity_id text,
           operation text not null,
           created_at text not null
         );
         create index briar_dashboard_changes_project_version_idx
           on briar_dashboard_changes (project_id, version);
         create table briar_dashboard_sync_state (
           project_id text primary key not null,
           current_version integer not null
         );
         create trigger briar_dashboard_workers_update_sync
         after update on briar_execution_workers BEGIN
           insert into briar_dashboard_changes (
             project_id, entity_type, entity_id, operation, created_at
           ) values (new.project_id, 'worker', new.id, 'upsert', datetime('now'));
           insert into briar_dashboard_sync_state (project_id, current_version)
           values (new.project_id, last_insert_rowid())
           on conflict (project_id) do update set
             current_version = excluded.current_version;
         END;
         create trigger briar_dashboard_worker_devices_update_sync
         after update on briar_execution_worker_devices BEGIN
           select new.id;
         END;`,
      );
      await db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, max_concurrent_sessions, icon_type, icon_value,
           last_heartbeat_at, created_at, updated_at
         ) values (
           'device-1', 'organization-1', 'owner-1', 'Worker one',
           'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
           'online', 2, 'emoji', '🌿',
           '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z',
           '2026-08-10T00:00:00.000Z'
         )`,
      ).run();
      await db.prepare(
        `insert into briar_execution_workers (
           id, project_id, device_id, label, host_fingerprint,
           agent_provider, versions_json, capabilities_json, state,
           accepting_work, readiness_state, readiness_detail,
           last_heartbeat_at, created_at, updated_at
         ) values
           (
             'worker-1', 'project-1', 'device-1', 'Worker one',
             'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
             'codex', '{"briar":"1.2.94"}',
             '{"providerHealth":{"codex":{"healthy":true}}}',
             'online', 1, 'ready', null,
             '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z',
             '2026-08-10T00:00:00.000Z'
           ),
           (
             'worker-2', 'project-2', 'device-1', 'Worker one',
             'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
             'codex', '{"briar":"1.2.94"}',
             '{"providerHealth":{"codex":{"healthy":true}}}',
             'online', 1, 'ready', null,
             '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z',
             '2026-08-10T00:00:00.000Z'
           )`,
      ).run();
      await db.prepare(
        `insert into briar_dashboard_changes (
           project_id, entity_type, entity_id, operation, created_at
         ) values
           ('project-1', 'run', 'run-1', 'upsert', '2026-08-10 00:00:00'),
           ('project-2', 'run', 'run-2', 'upsert', '2026-08-10 00:00:00')`,
      ).run();
      await db.prepare(
        `insert into briar_dashboard_sync_state (project_id, current_version)
         values ('project-1', 1), ('project-2', 2)`,
      ).run();
      await db.prepare(
        `with recursive sequence(value) as (
           select 1
           union all
           select value + 1 from sequence where value < 1000
         )
         insert into briar_dashboard_changes (
           project_id, entity_type, entity_id, operation, created_at
         )
         select 'project-history', 'run', 'history-' || value, 'upsert',
                '2026-08-10 00:00:00'
         from sequence`,
      ).run();

      for (const name of [
        "0081_optimize_dashboard_worker_device_sync.sql",
        "0083_suppress_heartbeat_dashboard_changes.sql",
      ]) {
        await executeD1Sql(
          db,
          await readFile(resolve("migrations", name), "utf8"),
        );
      }

      const triggerDefinitions = await db.prepare(
        `select name, sql from sqlite_master
         where type = 'trigger' and name in (
           'briar_dashboard_workers_update_sync',
           'briar_dashboard_worker_devices_update_sync'
         )`,
      ).all<{ name: string; sql: string }>();
      const definitions = new Map(
        triggerDefinitions.results.map((trigger) => [trigger.name, trigger.sql]),
      );
      const workerTrigger = definitions.get("briar_dashboard_workers_update_sync") ?? "";
      for (const field of [
        "project_id",
        "device_id",
        "label",
        "host_fingerprint",
        "agent_provider",
        "versions_json",
        "capabilities_json",
        "state",
        "accepting_work",
        "readiness_state",
        "readiness_detail",
      ]) {
        expect(workerTrigger).toMatch(
          new RegExp(`old\\.${field}\\s+is\\s+not\\s+new\\.${field}`, "iu"),
        );
      }
      const deviceTrigger =
        definitions.get("briar_dashboard_worker_devices_update_sync") ?? "";
      for (const field of [
        "organization_id",
        "owner_user_id",
        "label",
        "device_identity_hash",
        "state",
        "max_concurrent_sessions",
        "icon_type",
        "icon_value",
      ]) {
        expect(deviceTrigger).toMatch(
          new RegExp(`old\\.${field}\\s+is\\s+not\\s+new\\.${field}`, "iu"),
        );
      }
      expect(`${workerTrigger}\n${deviceTrigger}`).not.toMatch(
        /old\.(last_heartbeat_at|updated_at)\s+is\s+not/iu,
      );
      expect(deviceTrigger).toMatch(
        /order\s+by\s+change\.version\s+desc\s+limit\s+1/iu,
      );
      expect(deviceTrigger).toMatch(
        /max\(briar_dashboard_sync_state\.current_version,\s*excluded\.current_version\)/iu,
      );

      const readState = async () => {
        const changes = await db.prepare(
          `select count(*) as count from briar_dashboard_changes
           where entity_type = 'worker'`,
        ).first<{ count: number }>();
        const cursors = await db.prepare(
          `select project_id, current_version from briar_dashboard_sync_state
           order by project_id`,
        ).all<{ project_id: string; current_version: number }>();
        return {
          changes: changes?.count ?? 0,
          cursors: cursors.results,
        };
      };
      const beforeHeartbeat = await readState();
      await db.prepare(
        `update briar_execution_worker_devices
         set last_heartbeat_at = '2026-08-10T00:01:00.000Z',
             updated_at = '2026-08-10T00:01:00.000Z',
             state = case when state = 'disabled' then 'disabled' else 'online' end
         where id = 'device-1'`,
      ).run();
      await db.prepare(
        `update briar_execution_workers
         set last_heartbeat_at = '2026-08-10T00:01:00.000Z',
             updated_at = '2026-08-10T00:01:00.000Z',
             versions_json = coalesce('{"briar":"1.2.94"}', versions_json),
             accepting_work = coalesce(1, accepting_work),
             readiness_state = coalesce('ready', readiness_state),
             readiness_detail = case when 1 is null
               then readiness_detail else null end,
             capabilities_json = coalesce(
               '{"providerHealth":{"codex":{"healthy":true}}}',
               capabilities_json
             ),
             state = case when state = 'disabled' then 'disabled' else 'online' end
         where id = 'worker-1' and project_id = 'project-1'`,
      ).run();
      expect(await readState()).toEqual(beforeHeartbeat);

      const liveness = await db.prepare(
        `select device.last_heartbeat_at as device_heartbeat_at,
                device.updated_at as device_updated_at,
                device.state as device_state,
                worker.last_heartbeat_at as worker_heartbeat_at,
                worker.updated_at as worker_updated_at,
                worker.state as worker_state
         from briar_execution_worker_devices device
         join briar_execution_workers worker on worker.device_id = device.id
         where device.id = 'device-1' and worker.id = 'worker-1'`,
      ).first<{
        device_heartbeat_at: string;
        device_updated_at: string;
        device_state: string;
        worker_heartbeat_at: string;
        worker_updated_at: string;
        worker_state: string;
      }>();
      expect(liveness).toEqual({
        device_heartbeat_at: "2026-08-10T00:01:00.000Z",
        device_updated_at: "2026-08-10T00:01:00.000Z",
        device_state: "online",
        worker_heartbeat_at: "2026-08-10T00:01:00.000Z",
        worker_updated_at: "2026-08-10T00:01:00.000Z",
        worker_state: "online",
      });

      await db.prepare(
        `update briar_execution_workers
         set capabilities_json =
               '{"providerHealth":{"codex":{"healthy":true},"claude":{"healthy":true}}}',
             updated_at = '2026-08-10T00:02:00.000Z'
         where id = 'worker-1'`,
      ).run();
      const afterCapabilities = await readState();
      expect(afterCapabilities.changes).toBe(beforeHeartbeat.changes + 1);
      expect(afterCapabilities.cursors[0].current_version).toBeGreaterThan(
        beforeHeartbeat.cursors[0].current_version,
      );
      expect(afterCapabilities.cursors[1]).toEqual(beforeHeartbeat.cursors[1]);

      await db.prepare(
        `update briar_execution_workers
         set accepting_work = 0, readiness_state = 'busy',
             updated_at = '2026-08-10T00:03:00.000Z'
         where id = 'worker-1'`,
      ).run();
      const afterReadiness = await readState();
      expect(afterReadiness.changes).toBe(afterCapabilities.changes + 1);
      expect(afterReadiness.cursors[0].current_version).toBeGreaterThan(
        afterCapabilities.cursors[0].current_version,
      );
      expect(afterReadiness.cursors[1]).toEqual(afterCapabilities.cursors[1]);

      const labelUpdate = await db.prepare(
        `update briar_execution_worker_devices
         set label = 'Renamed worker',
             updated_at = '2026-08-10T00:04:00.000Z'
         where id = 'device-1'`,
      ).run();
      expect(labelUpdate.meta.rows_read).toBeLessThan(50);
      const afterLabel = await readState();
      expect(afterLabel.changes).toBe(afterReadiness.changes + 2);
      expect(
        afterLabel.cursors.every((cursor, index) =>
          cursor.current_version > afterReadiness.cursors[index].current_version
        ),
      ).toBe(true);
      const published = await db.prepare(
        `select project_id, entity_id from briar_dashboard_changes
         where entity_type = 'worker' order by version`,
      ).all<{ project_id: string; entity_id: string }>();
      expect(published.results).toEqual([
        { project_id: "project-1", entity_id: "worker-1" },
        { project_id: "project-1", entity_id: "worker-1" },
        { project_id: "project-1", entity_id: "worker-1" },
        { project_id: "project-2", entity_id: "worker-2" },
      ]);
    } finally {
      await miniflare.dispose();
    }
  });

  it.each([
    "0055_agent_provider_opencode.sql",
    "0071_organization_agents.sql",
    "0072_organization_ideas.sql",
    "0073_organization_channels.sql",
  ])(
    "uses D1 transaction-safe foreign-key deferral for table rebuilds: %s",
    async (name) => {
      const sql = await readFile(resolve("migrations", name), "utf8");

      expect(sql).toMatch(/pragma\s+defer_foreign_keys\s*=\s*on\s*;/iu);
      expect(sql).toMatch(/pragma\s+defer_foreign_keys\s*=\s*off\s*;/iu);
      expect(sql).not.toMatch(/pragma\s+foreign_keys\s*=/iu);
    },
  );

  it("keeps Agent and idea ownership organization-scoped with an optional project", async () => {
    const agents = await readFile(
      resolve("migrations", "0071_organization_agents.sql"),
      "utf8",
    );
    const ideas = await readFile(
      resolve("migrations", "0072_organization_ideas.sql"),
      "utf8",
    );

    // A null project_id is what marks an organization Agent or idea, so the
    // column must not carry NOT NULL while organization_id must.
    expect(agents).toMatch(
      /organization_id text not null\s+references briar_organizations/iu,
    );
    expect(agents).toMatch(
      /project_id text references briar_projects \(id\) on delete cascade/iu,
    );
    expect(ideas).toMatch(
      /organization_id text not null\s+references briar_organizations/iu,
    );
    expect(ideas).toMatch(
      /project_id text references briar_projects \(id\) on delete cascade/iu,
    );
    expect(agents).toMatch(
      /create unique index briar_project_agents_handle_idx[\s\S]*where handle is not null/iu,
    );
  });

  it("migrates every localized default Agent to a Developer Agent with an issue Skill", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-agent-skills-locale-migration-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await db.prepare(
        `create table briar_project_agents (
           id text primary key not null,
           name text not null,
           responsibility text not null,
           provider text not null,
           model text,
           effort text,
           skill_markdown text not null,
           created_at text not null,
           updated_at text not null
         )`,
      ).run();
      const rows = [
        ["en", "Issue processing agent", "Process every queued issue."],
        ["ko", "이슈 처리 에이전트", "대기 중인 모든 이슈를 처리합니다."],
        [
          "ko-legacy",
          "자동 사냥 에이전트",
          "모든 대기중인 이슈에 대해서 자동사냥을 수행하는것",
        ],
        ["zh", "问题处理智能体", "处理所有排队中的问题。"],
        ["zh-legacy", "自动狩猎智能体", "对所有排队中的问题执行自动狩猎。"],
        ["custom", "iOS release agent", "Release the iOS app."],
      ] as const;
      for (const [id, name, responsibility] of rows) {
        await db.prepare(
          `insert into briar_project_agents (
             id, name, responsibility, provider, model, effort,
             skill_markdown, created_at, updated_at
           ) values (?, ?, ?, 'codex', null, null, ?, ?, ?)`,
        ).bind(
          id,
          name,
          responsibility,
          `# ${name}\n\n## Responsibility\n\n${responsibility}\n`,
          "2026-08-01T00:00:00.000Z",
          "2026-08-01T00:00:00.000Z",
        ).run();
      }

      const sql = await readFile(
        resolve("migrations", "0079_agent_skills.sql"),
        "utf8",
      );
      await executeD1Sql(db, sql);

      const result = await db.prepare(
        `select agent.id, agent.name as agent_name, agent.responsibility,
                agent.skill_markdown, skill.name as skill_name, skill.kind
         from briar_project_agents agent
         join briar_agent_skills skill on skill.agent_id = agent.id
         order by agent.id`,
      ).all<{
        id: string;
        agent_name: string;
        responsibility: string;
        skill_markdown: string;
        skill_name: string;
        kind: string;
      }>();
      expect(result.results).toEqual([
        expect.objectContaining({
          id: "custom",
          agent_name: "iOS release agent",
          skill_name: "iOS release agent",
          kind: "custom",
        }),
        expect.objectContaining({
          id: "en",
          agent_name: "Developer agent",
          responsibility: "Process every queued issue.",
          skill_markdown: expect.stringContaining("# Developer agent\n"),
          skill_name: "Issue processing",
          kind: "issue_processing",
        }),
        expect.objectContaining({
          id: "ko",
          agent_name: "개발자 에이전트",
          responsibility: "대기 중인 모든 이슈를 처리합니다.",
          skill_markdown: expect.stringContaining("# 개발자 에이전트\n"),
          skill_name: "이슈 처리",
          kind: "issue_processing",
        }),
        expect.objectContaining({
          id: "ko-legacy",
          agent_name: "개발자 에이전트",
          responsibility: "모든 대기중인 이슈에 대해서 자동사냥을 수행하는것",
          skill_markdown: expect.stringContaining("# 개발자 에이전트\n"),
          skill_name: "이슈 처리",
          kind: "issue_processing",
        }),
        expect.objectContaining({
          id: "zh",
          agent_name: "开发者智能体",
          responsibility: "处理所有排队中的问题。",
          skill_markdown: expect.stringContaining("# 开发者智能体\n"),
          skill_name: "问题处理",
          kind: "issue_processing",
        }),
        expect.objectContaining({
          id: "zh-legacy",
          agent_name: "开发者智能体",
          responsibility: "对所有排队中的问题执行自动狩猎。",
          skill_markdown: expect.stringContaining("# 开发者智能体\n"),
          skill_name: "问题处理",
          kind: "issue_processing",
        }),
      ]);
    } finally {
      await miniflare.dispose();
    }
  });

  it("backfills claimable work before retiring implicit Skill selection", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-explicit-agent-skill-migration-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await db.prepare(
         `create table briar_agent_skills (
           id text primary key not null,
           agent_id text not null,
           is_default integer not null default 0,
           position integer not null default 0,
           created_at text not null
         )`,
      ).run();
      await db.prepare(
        `create unique index briar_agent_skills_default_idx
         on briar_agent_skills (agent_id) where is_default = 1`,
      ).run();
      await db.prepare(
        `create table briar_project_agent_task_jobs (
           id text primary key not null,
           agent_id text not null,
           skill_id text,
           status text not null
         )`,
      ).run();
      await db.prepare(
        `create table briar_channel_agent_reply_jobs (
           id text primary key not null,
           agent_id text not null,
           skill_id text,
           status text not null
         )`,
      ).run();
      await db.batch([
        db.prepare(
          `insert into briar_agent_skills
             (id, agent_id, is_default, position, created_at)
           values ('skill-issue', 'agent-1', 1, 0, '2026-08-09T00:00:00.000Z')`,
        ),
        db.prepare(
          `insert into briar_agent_skills
             (id, agent_id, is_default, position, created_at)
           values ('skill-release', 'agent-1', 0, 1, '2026-08-09T00:00:00.000Z')`,
        ),
        db.prepare(
          `insert into briar_project_agent_task_jobs
             (id, agent_id, skill_id, status)
           values ('task-queued', 'agent-1', null, 'queued')`,
        ),
        db.prepare(
          `insert into briar_project_agent_task_jobs
             (id, agent_id, skill_id, status)
           values ('task-completed', 'agent-1', null, 'completed')`,
        ),
        db.prepare(
          `insert into briar_channel_agent_reply_jobs
             (id, agent_id, skill_id, status)
           values ('reply-running', 'agent-1', null, 'running')`,
        ),
        db.prepare(
          `insert into briar_channel_agent_reply_jobs
             (id, agent_id, skill_id, status)
           values ('reply-explicit', 'agent-1', 'skill-release', 'queued')`,
        ),
      ]);

      const sql = await readFile(
        resolve("migrations", "0082_explicit_agent_skill_selection.sql"),
        "utf8",
      );
      for (const statement of unstable_splitSqlQuery(sql)) {
        await db.prepare(statement).run();
      }

      const taskJobs = await db.prepare(
        `select id, skill_id from briar_project_agent_task_jobs order by id`,
      ).all<{ id: string; skill_id: string | null }>();
      expect(taskJobs.results).toEqual([
        { id: "task-completed", skill_id: null },
        { id: "task-queued", skill_id: "skill-issue" },
      ]);
      const replyJobs = await db.prepare(
        `select id, skill_id from briar_channel_agent_reply_jobs order by id`,
      ).all<{ id: string; skill_id: string | null }>();
      expect(replyJobs.results).toEqual([
        { id: "reply-explicit", skill_id: "skill-release" },
        { id: "reply-running", skill_id: "skill-issue" },
      ]);
      const skillFlags = await db.prepare(
        `select id, is_default from briar_agent_skills order by id`,
      ).all<{ id: string; is_default: number }>();
      expect(skillFlags.results.every((skill) => skill.is_default === 0)).toBe(true);
      const retiredIndex = await db.prepare(
        `select name from sqlite_master
         where type = 'index' and name = 'briar_agent_skills_default_idx'`,
      ).first<{ name: string }>();
      expect(retiredIndex).toBeNull();
    } finally {
      await miniflare.dispose();
    }
  });

  it("adds workflow progress and policy state while preserving legacy rows", async () => {
    await withPreWorkflowMigrationDatabase(
      "briar-additive-workflow-migrations-test",
      async (db) => {
        await seedPreWorkflowProjectRun(db);
        await db.prepare(
          `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
           values ('migration-assignee', 'Assignee', 'assignee@example.com', 1, ?, ?)`,
        ).bind(migrationFixture.now, migrationFixture.now).run();

        await applyD1Migrations(db, {
          files: [
            "0059_workflow_v2_progress.sql",
            "0060_workflow_checkpoint_policies.sql",
            "0061_resume_requested_state.sql",
            "0062_issue_assignees.sql",
            "0067_issue_checkpoints.sql",
          ],
        });

        const settings = await db.prepare(
          `select workflow_json, updated_at, mandatory_checkpoints_json,
                  checkpoint_policy_revision
           from briar_project_settings where project_id = ?`,
        ).bind(migrationFixture.projectId).first<{
          workflow_json: string;
          updated_at: string;
          mandatory_checkpoints_json: string | null;
          checkpoint_policy_revision: number;
        }>();
        expect(settings).toEqual({
          workflow_json: migrationFixture.workflow,
          updated_at: migrationFixture.now,
          mandatory_checkpoints_json: null,
          checkpoint_policy_revision: 1,
        });

        const run = await db.prepare(
          `select workflow_snapshot_json, updated_at, paused_at,
                  waiting_checkpoint_key, waiting_checkpoint_revision,
                  resume_requested_at, assignee_user_id, issue_checkpoints_json
           from briar_hunt_runs where id = ?`,
        ).bind(migrationFixture.runId).first<{
          workflow_snapshot_json: string;
          updated_at: string;
          paused_at: string;
          waiting_checkpoint_key: string | null;
          waiting_checkpoint_revision: number | null;
          resume_requested_at: string | null;
          assignee_user_id: string | null;
          issue_checkpoints_json: string;
        }>();
        expect(run).toEqual({
          workflow_snapshot_json: migrationFixture.workflow,
          updated_at: migrationFixture.now,
          paused_at: migrationFixture.pausedAt,
          waiting_checkpoint_key: null,
          waiting_checkpoint_revision: null,
          resume_requested_at: null,
          assignee_user_id: null,
          issue_checkpoints_json: "[]",
        });

        const schemaObjects = await db.prepare(
          `select name from sqlite_master
           where name in (
             'briar_run_stage_progress',
             'briar_run_checkpoint_progress',
             'briar_run_checkpoint_waiting_unique_idx',
             'briar_user_workflow_checkpoint_defaults',
             'briar_hunt_runs_resume_requested_idx',
             'briar_hunt_runs_assignee_idx'
           ) order by name`,
        ).all<{ name: string }>();
        expect(schemaObjects.results.map((row) => row.name)).toEqual([
          "briar_hunt_runs_assignee_idx",
          "briar_hunt_runs_resume_requested_idx",
          "briar_run_checkpoint_progress",
          "briar_run_checkpoint_waiting_unique_idx",
          "briar_run_stage_progress",
          "briar_user_workflow_checkpoint_defaults",
        ]);

        await db.prepare(
          `insert into briar_run_stage_progress (
             run_id, attempt, revision, stage_id, state, started_at, finished_at
           ) values (?, 1, 1, 'implementing', 'completed', ?, ?)`,
        ).bind(migrationFixture.runId, migrationFixture.now, migrationFixture.now).run();
        await db.prepare(
          `insert into briar_run_checkpoint_progress (
             run_id, attempt, revision, checkpoint_key, stage_id,
             position, state, reached_at
           ) values (?, 1, 1, 'before-merge', 'implementing',
                     'after', 'waiting', ?)`,
        ).bind(migrationFixture.runId, migrationFixture.now).run();
        await expect(db.prepare(
          `insert into briar_run_checkpoint_progress (
             run_id, attempt, revision, checkpoint_key, stage_id,
             position, state, reached_at
           ) values (?, 1, 1, 'before-release', 'implementing',
                     'after', 'waiting', ?)`,
        ).bind(migrationFixture.runId, migrationFixture.now).run()).rejects.toThrow();
        await db.prepare(
          `insert into briar_run_checkpoint_progress (
             run_id, attempt, revision, checkpoint_key, stage_id,
             position, state
           ) values (?, 1, 1, 'before-release', 'implementing',
                     'after', 'pending')`,
        ).bind(migrationFixture.runId).run();

        await db.prepare(
          `insert into briar_user_workflow_checkpoint_defaults (
             project_id, user_id, created_at, updated_at
           ) values (?, ?, ?, ?)`,
        ).bind(
          migrationFixture.projectId,
          migrationFixture.userId,
          migrationFixture.now,
          migrationFixture.now,
        ).run();
        expect(await db.prepare(
          `select checkpoints_json, revision
           from briar_user_workflow_checkpoint_defaults
           where project_id = ? and user_id = ?`,
        ).bind(
          migrationFixture.projectId,
          migrationFixture.userId,
        ).first()).toEqual({ checkpoints_json: "[]", revision: 1 });

        await db.prepare(
          `update briar_hunt_runs
           set resume_requested_at = ?, assignee_user_id = 'migration-assignee'
           where id = ?`,
        ).bind("2026-08-10T00:10:00.000Z", migrationFixture.runId).run();
        await db.prepare(`delete from "user" where id = 'migration-assignee'`).run();
        expect(await db.prepare(
          `select paused_at, resume_requested_at, assignee_user_id
           from briar_hunt_runs where id = ?`,
        ).bind(migrationFixture.runId).first()).toEqual({
          paused_at: migrationFixture.pausedAt,
          resume_requested_at: "2026-08-10T00:10:00.000Z",
          assignee_user_id: null,
        });
        await expect(db.prepare(
          `update briar_hunt_runs set issue_checkpoints_json = '{}' where id = ?`,
        ).bind(migrationFixture.runId).run()).rejects.toThrow();
      },
    );
  }, 30_000);

  it("stores valid issue proposals without changing their source run", async () => {
    await withPreWorkflowMigrationDatabase(
      "briar-issue-proposal-migration-test",
      async (db) => {
        await seedPreWorkflowProjectRun(db);
        await applyD1Migrations(db, {
          files: ["0068_issue_action_proposals.sql"],
        });

        for (const [id, actionType, triggerId, replyId] of [
          ["proposal-update", "request_issue_update", "trigger-update", "reply-update"],
          ["proposal-create", "request_issue_create", "trigger-create", "reply-create"],
        ] as const) {
          await db.prepare(
            `insert into briar_issue_action_proposals (
               id, project_id, conversation_run_id, trigger_message_id,
               reply_message_id, action_type, payload_json,
               expected_run_updated_at, created_at, updated_at
             ) values (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
          ).bind(
            id,
            migrationFixture.projectId,
            migrationFixture.runId,
            triggerId,
            replyId,
            actionType,
            migrationFixture.now,
            migrationFixture.now,
            migrationFixture.now,
          ).run();
        }

        const proposals = await db.prepare(
          `select id, action_type, status from briar_issue_action_proposals
           order by id`,
        ).all<{ id: string; action_type: string; status: string }>();
        expect(proposals.results).toEqual([
          {
            id: "proposal-create",
            action_type: "request_issue_create",
            status: "pending",
          },
          {
            id: "proposal-update",
            action_type: "request_issue_update",
            status: "pending",
          },
        ]);
        await expect(db.prepare(
          `insert into briar_issue_action_proposals (
             id, project_id, conversation_run_id, trigger_message_id,
             reply_message_id, action_type, payload_json, created_at, updated_at
           ) values ('proposal-invalid', ?, ?, 'trigger-invalid', 'reply-invalid',
                     'delete_issue', '{}', ?, ?)`,
        ).bind(
          migrationFixture.projectId,
          migrationFixture.runId,
          migrationFixture.now,
          migrationFixture.now,
        ).run()).rejects.toThrow();
        expect(await db.prepare(
          `select workflow_snapshot_json, updated_at
           from briar_hunt_runs where id = ?`,
        ).bind(migrationFixture.runId).first()).toEqual({
          workflow_snapshot_json: migrationFixture.workflow,
          updated_at: migrationFixture.now,
        });
      },
    );
  }, 30_000);

  it("leaves already-canonical workflow snapshots stable", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-workflow-v2-migration-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await db
        .prepare(
          `create table briar_project_settings (
             project_id text primary key,
             workflow_json text not null,
             mandatory_checkpoints_json text,
             updated_at text not null
           )`,
        )
        .run();
      await db
        .prepare(
          `create table briar_hunt_runs (
             id text primary key,
             workflow_snapshot_json text not null,
             updated_at text not null
           )`,
        )
        .run();
      const workflow = (checkpointStage?: string) => JSON.stringify({
        version: 2,
        requirements: [],
        stages: [
          { id: "implementing", label: "Implement", required: true },
          { id: "merged", label: "Merge", required: true },
        ],
        execution: {
          checkpoints: checkpointStage
            ? [{
                key: `project-after-${checkpointStage}`,
                stage: checkpointStage,
                position: "after",
              }]
            : [],
        },
        completion: { requiredStages: ["implementing", "merged"] },
      });
      const explicitCheckpoint = JSON.stringify([
        { key: "project-before-merged", stage: "merged", position: "before" },
      ]);
      const alreadyV2 = JSON.stringify({
        version: 2,
        requirements: [],
        stages: [{ id: "implementing", label: "Implement", required: true }],
        execution: { checkpoints: [] },
        completion: { requiredStages: ["implementing"] },
      });
      for (const row of [
        ["lazy", workflow("merged"), null],
        ["explicit-empty", workflow("merged"), "[]"],
        ["explicit-checkpoint", workflow("implementing"), explicitCheckpoint],
        ["fallback", workflow(), null],
        ["implementing-checkpoint", workflow("implementing"), null],
        ["already-v2", alreadyV2, "[]"],
      ] as const) {
        await db
          .prepare(
            `insert into briar_project_settings (
               project_id, workflow_json, mandatory_checkpoints_json, updated_at
             ) values (?, ?, ?, '2026-08-06T00:00:00.000Z')`,
          )
          .bind(...row)
          .run();
      }
      for (const row of [
        ["run-checkpoint", workflow("implementing")],
        ["run-empty", workflow()],
        ["run-v2", alreadyV2],
      ] as const) {
        await db
          .prepare(
            `insert into briar_hunt_runs (
               id, workflow_snapshot_json, updated_at
             ) values (?, ?, '2026-08-06T00:00:00.000Z')`,
          )
          .bind(...row)
          .run();
      }

      const sql = await readFile(
        resolve("migrations", "0066_normalize_project_workflows_v2.sql"),
        "utf8",
      );
      await executeD1Sql(db, sql);
      const firstPass = await db
        .prepare(
          `select project_id, workflow_json, updated_at
           from briar_project_settings order by project_id`,
        )
        .all<{ project_id: string; workflow_json: string; updated_at: string }>();
      const byProject = new Map(
        firstPass.results.map((row) => [row.project_id, JSON.parse(row.workflow_json)]),
      );

      expect(byProject.get("lazy")).toMatchObject({
        version: 2,
        requirements: [],
        execution: {
          checkpoints: [{
            key: "project-after-merged",
            stage: "merged",
            position: "after",
          }],
        },
      });
      expect(byProject.get("explicit-empty")?.execution.checkpoints).toEqual([{
        key: "project-after-merged",
        stage: "merged",
        position: "after",
      }]);
      expect(byProject.get("explicit-checkpoint")?.execution.checkpoints).toEqual(
        [{
          key: "project-after-implementing",
          stage: "implementing",
          position: "after",
        }],
      );
      expect(byProject.get("fallback")?.execution.checkpoints).toEqual([]);
      expect(byProject.get("implementing-checkpoint")?.execution.checkpoints).toEqual([{
        key: "project-after-implementing",
        stage: "implementing",
        position: "after",
      }]);
      expect(
        firstPass.results.find((row) => row.project_id === "already-v2")?.workflow_json,
      ).toBe(alreadyV2);
      expect(firstPass.results.every(
        (row) => row.updated_at === "2026-08-06T00:00:00.000Z",
      )).toBe(true);
      const firstRunPass = await db
        .prepare(
          `select id, workflow_snapshot_json, updated_at
           from briar_hunt_runs order by id`,
        )
        .all<{ id: string; workflow_snapshot_json: string; updated_at: string }>();
      const byRun = new Map(
        firstRunPass.results.map((row) => [
          row.id,
          JSON.parse(row.workflow_snapshot_json),
        ]),
      );
      expect(byRun.get("run-checkpoint")).toMatchObject({
        version: 2,
        requirements: [],
        execution: {
          checkpoints: [{
            key: "project-after-implementing",
            stage: "implementing",
            position: "after",
          }],
        },
      });
      expect(byRun.get("run-empty")?.execution.checkpoints).toEqual([]);
      expect(
        firstRunPass.results.find((row) => row.id === "run-v2")
          ?.workflow_snapshot_json,
      ).toBe(alreadyV2);
      expect(firstRunPass.results.every(
        (row) => row.updated_at === "2026-08-06T00:00:00.000Z",
      )).toBe(true);

      await executeD1Sql(db, sql);
      const secondPass = await db
        .prepare(
          `select project_id, workflow_json, updated_at
           from briar_project_settings order by project_id`,
        )
        .all<{ project_id: string; workflow_json: string; updated_at: string }>();
      expect(secondPass.results).toEqual(firstPass.results);
      const secondRunPass = await db
        .prepare(
          `select id, workflow_snapshot_json, updated_at
           from briar_hunt_runs order by id`,
        )
        .all<{ id: string; workflow_snapshot_json: string; updated_at: string }>();
      expect(secondRunPass.results).toEqual(firstRunPass.results);
    } finally {
      await miniflare.dispose();
    }
  });

  it("scopes inbox read state by account and cascades deleted accounts", async () => {
    await withPreWorkflowMigrationDatabase(
      "briar-inbox-read-state-migration-test",
      async (db) => {
        await seedPreWorkflowProjectRun(db);
        await db.prepare(
          `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
           values ('migration-reader', 'Reader', 'reader@example.com', 1, ?, ?)`,
        ).bind(migrationFixture.now, migrationFixture.now).run();
        await applyD1Migrations(db, {
          files: ["0063_inbox_read_states.sql"],
        });

        for (const row of [
          [migrationFixture.userId, "message-1", "version-owner"],
          [migrationFixture.userId, "message-2", "version-owner-2"],
          ["migration-reader", "message-1", "version-reader"],
        ] as const) {
          await db.prepare(
            `insert into briar_inbox_read_states (
               user_id, message_id, version, updated_at
             ) values (?, ?, ?, ?)`,
          ).bind(...row, migrationFixture.now).run();
        }
        await expect(db.prepare(
          `insert into briar_inbox_read_states (
             user_id, message_id, version, updated_at
           ) values (?, 'message-1', 'duplicate', ?)`,
        ).bind(migrationFixture.userId, migrationFixture.now).run()).rejects.toThrow();

        expect(await db.prepare(
          `select name from sqlite_master
           where type = 'index'
             and name = 'briar_inbox_read_states_user_updated_idx'`,
        ).first("name")).toBe("briar_inbox_read_states_user_updated_idx");
        await db.prepare(`delete from "user" where id = ?`)
          .bind(migrationFixture.userId).run();
        const remaining = await db.prepare(
          `select user_id, message_id, version from briar_inbox_read_states`,
        ).all();
        expect(remaining.results).toEqual([{
          user_id: "migration-reader",
          message_id: "message-1",
          version: "version-reader",
        }]);
      },
    );
  }, 30_000);

  it("migrates GitHub identity storage without backfilling URL-only evidence", async () => {
    await withPreWorkflowMigrationDatabase(
      "briar-github-storage-migration-test",
      async (db) => {
        await seedPreWorkflowProjectRun(db);
        await db.prepare(
          `insert into briar_run_evidence (
             id, project_id, run_id, attempt, revision, evidence_key,
             workflow_stage, evidence_type, status, url, actor,
             observed_at, recorded_at
           ) values ('migration-evidence', ?, ?, 1, 1, 'legacy-pr',
                     'pr_open', 'pull_request', 'passed',
                     'https://github.com/example/repository/pull/1',
                     'migration', ?, ?)`,
        ).bind(
          migrationFixture.projectId,
          migrationFixture.runId,
          migrationFixture.now,
          migrationFixture.now,
        ).run();
        await applyD1Migrations(db, {
          files: [
            "0063_github_pull_request_sync.sql",
            "0064_github_integration.sql",
          ],
        });

        expect(await db.prepare(
          `select id, url, github_association_started_at
           from briar_run_evidence where id = 'migration-evidence'`,
        ).first()).toEqual({
          id: "migration-evidence",
          url: "https://github.com/example/repository/pull/1",
          github_association_started_at: null,
        });
        expect(await db.prepare(
          `select count(*) as count from briar_run_pull_requests`,
        ).first<number>("count")).toBe(0);

        await db.prepare(
          `insert into briar_github_deliveries (
             delivery_id, event_name, action, status, claimed_at
           ) values ('delivery-1', 'pull_request', 'opened', 'processing', ?)`,
        ).bind(migrationFixture.now).run();
        await expect(db.prepare(
          `insert into briar_github_deliveries (
             delivery_id, event_name, status, claimed_at
           ) values ('delivery-1', 'pull_request', 'processing', ?)`,
        ).bind(migrationFixture.now).run()).rejects.toThrow();
        await db.prepare(
          `update briar_github_deliveries
           set status = 'completed', completed_at = ?
           where delivery_id = 'delivery-1'`,
        ).bind(migrationFixture.now).run();

        const sharedUrl = "https://github.com/example/repository/pull/1";
        for (const [repositoryId, pullRequestId, repository] of [
          [101, 1001, "example/repository"],
          [102, 1002, "example/recreated-repository"],
        ] as const) {
          await db.prepare(
            `insert into briar_github_pull_requests (
               repository_id, pull_request_number, repository,
               pull_request_id, pull_request_node_id, url, state, draft,
               head_sha, base_sha, opened_at, provider_updated_at,
               last_delivery_id, briar_issue_links_json, created_at, updated_at
             ) values (?, 1, ?, ?, ?, ?, 'open', 0,
                       'abcdef1', '1234567', ?, ?, 'delivery-1', '[]', ?, ?)`,
          ).bind(
            repositoryId,
            repository,
            pullRequestId,
            `PR_${pullRequestId}`,
            sharedUrl,
            migrationFixture.now,
            migrationFixture.now,
            migrationFixture.now,
            migrationFixture.now,
          ).run();
        }
        expect(await db.prepare(
          `select count(*) as count from briar_github_pull_requests
           where url = ?`,
        ).bind(sharedUrl).first<number>("count")).toBe(2);

        for (const revision of [1, 2]) {
          await db.prepare(
            `insert into briar_run_pull_requests (
               project_id, run_id, attempt, revision, revision_started_at,
               url, repository_id, repository, pull_request_id,
               pull_request_node_id, pull_request_number, created_at, updated_at
             ) values (?, ?, 1, ?, ?, ?, 101, 'example/repository',
                       1001, 'PR_1001', 1, ?, ?)`,
          ).bind(
            migrationFixture.projectId,
            migrationFixture.runId,
            revision,
            migrationFixture.now,
            sharedUrl,
            migrationFixture.now,
            migrationFixture.now,
          ).run();
        }
        await expect(db.prepare(
          `insert into briar_run_pull_requests (
             project_id, run_id, attempt, revision, revision_started_at,
             url, repository_id, repository, pull_request_id,
             pull_request_node_id, pull_request_number, created_at, updated_at
           ) values (?, ?, 1, 2, ?, ?, 101, 'example/repository',
                     1001, 'PR_1001', 1, ?, ?)`,
        ).bind(
          migrationFixture.projectId,
          migrationFixture.runId,
          migrationFixture.now,
          sharedUrl,
          migrationFixture.now,
          migrationFixture.now,
        ).run()).rejects.toThrow();

        await db.prepare(
          `insert into briar_github_connections (
             installation_id, organization_id, installation_account_id,
             account_login, account_avatar_url, authorized_github_user_id,
             authorized_github_user_login, connected_by_user_id, status,
             connected_at, updated_at
           ) values (501, ?, 601, 'example', 'https://example.com/avatar.png',
                     701, 'migration-user', ?, 'connected', ?, ?)`,
        ).bind(
          migrationFixture.organizationId,
          migrationFixture.userId,
          migrationFixture.now,
          migrationFixture.now,
        ).run();
        await db.prepare(
          `insert into briar_github_oauth_states (
             state_hash, organization_id, user_id, pkce_verifier,
             installation_id, expires_at, created_at, updated_at
           ) values (?, ?, ?, ?, 501, ?, ?, ?)`,
        ).bind(
          "b".repeat(64),
          migrationFixture.organizationId,
          migrationFixture.userId,
          "c".repeat(43),
          "2026-08-10T01:00:00.000Z",
          migrationFixture.now,
          migrationFixture.now,
        ).run();
        await expect(db.prepare(
          `insert into briar_github_connections (
             installation_id, organization_id, installation_account_id,
             account_login, account_avatar_url, authorized_github_user_id,
             authorized_github_user_login, status, connected_at, updated_at
           ) values (502, ?, 602, 'other', 'https://example.com/other.png',
                     702, 'other-user', 'connected', ?, ?)`,
        ).bind(
          migrationFixture.organizationId,
          migrationFixture.now,
          migrationFixture.now,
        ).run()).rejects.toThrow();

        const connectionColumns = await db.prepare(
          `pragma table_info(briar_github_connections)`,
        ).all<{ name: string }>();
        const oauthColumns = await db.prepare(
          `pragma table_info(briar_github_oauth_states)`,
        ).all<{ name: string }>();
        const persistedColumnNames = [
          ...connectionColumns.results,
          ...oauthColumns.results,
        ].map((column) => column.name);
        expect(persistedColumnNames).toContain("pkce_verifier");
        expect(persistedColumnNames.join("\n")).not.toMatch(
          /(?:access|refresh)_?token/iu,
        );
      },
    );
  }, 30_000);
});
