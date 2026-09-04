import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { executeD1Sql } from "./test-helpers/d1-sql";
import { workerRuntimeProtoJsonFixture } from "./test-helpers/worker-runtime";

/**
 * Guards D1's trigger nesting limit from the database side.
 *
 * workerd sets `SQLITE_LIMIT_TRIGGER_DEPTH` to 10 and current SQLite enforces
 * it while *compiling* a statement, so a cascade that reaches an eleven-deep
 * chain of trigger programs fails with "triggers nested too deep" before a
 * single row is touched. That is what made `delete from briar_teams` and
 * `delete from briar_projects` unusable when a provider migration reordered
 * `sqlite_schema`, and because the failure is at prepare time it reproduces on
 * an empty database.
 *
 * `cascade-trigger-depth.test.ts` computes the same number statically from the
 * schema snapshot; this file proves it against the real binding.
 */
describe("cascade erasure", () => {
  const db = env.DB;

  it("prepares a delete against every table", async () => {
    const tables = (await db.prepare(
      `select name from sqlite_schema
       where type = 'table' and name not like 'sqlite_%' and name not like 'd1_%'
         and name not like '\\_cf\\_%' escape '\\'
       order by name`,
    ).all<{ name: string }>()).results;
    expect(tables.length).toBeGreaterThan(100);
    const rejected: { table: string; error: string }[] = [];
    for (const { name } of tables) {
      try {
        // `1 = ?` rather than a literal so the planner cannot fold the WHERE
        // away and skip generating the cascade it is being asked about.
        await db.prepare(`delete from "${name}" where 1 = ?`).bind(0).run();
      } catch (error) {
        rejected.push({ table: name, error: String(error) });
      }
    }
    expect(rejected).toEqual([]);
  });

  it("erases a channel, a team, an organization and its owner", async () => {
    const now = "2026-09-05T00:00:00.000Z";
    const runtimeProtoJson = workerRuntimeProtoJsonFixture().replaceAll(
      "'",
      "''",
    );
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values (
        'erase-owner', 'Erase Owner', 'erase@example.com', 1, '${now}', '${now}'
      );
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('erase-org', 'Erase Org', 'erase-org', '${now}', '${now}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values ('erase-org', 'erase-owner', 'owner', '${now}', '${now}');
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values (
        'erase-project', 'erase-owner', 'erase-org', 'Erase Project',
        '${"a".repeat(64)}', '${now}', '${now}'
      );
      insert into briar_project_members (
        project_id, organization_id, user_id, created_at, updated_at
      ) values (
        'erase-project', 'erase-org', 'erase-owner', '${now}', '${now}'
      );
      insert into briar_project_agents (
        id, organization_id, project_id, name, provider, responsibility,
        created_at, updated_at
      ) values (
        'erase-agent', 'erase-org', 'erase-project', 'Erase Agent', 'codex',
        'Exercise the erasure cascade.', '${now}', '${now}'
      );
      insert into briar_execution_worker_devices (
        id, organization_id, owner_user_id, label, device_identity_hash,
        state, last_heartbeat_at, created_at, updated_at
      ) values (
        'erase-device', 'erase-org', 'erase-owner', 'Erase Device',
        '${"b".repeat(64)}', 'online', '${now}', '${now}', '${now}'
      );
      insert into briar_execution_workers (
        id, project_id, device_id, label, host_fingerprint, state,
        last_heartbeat_at, created_at, updated_at, runtime_proto_json
      ) values (
        'erase-worker', 'erase-project', 'erase-device', 'Erase Worker',
        '${"c".repeat(64)}', 'online', '${now}', '${now}', '${now}',
        '${runtimeProtoJson}'
      );
      insert into briar_channels (
        id, organization_id, slug, name, default_project_id,
        created_by_user_id, created_at, updated_at
      ) values (
        'erase-channel', 'erase-org', 'erase', 'Erase', 'erase-project',
        'erase-owner', '${now}', '${now}'
      );
      insert into briar_channel_members (
        channel_id, user_id, role, created_at
      ) values ('erase-channel', 'erase-owner', 'member', '${now}');
      insert into briar_channel_agents (
        channel_id, agent_id, added_by_user_id, created_at
      ) values ('erase-channel', 'erase-agent', 'erase-owner', '${now}');
      insert into briar_channel_messages (
        id, channel_id, author_user_id, body, created_at, updated_at
      ) values (
        'erase-message', 'erase-channel', 'erase-owner', 'Erase thread',
        '${now}', '${now}'
      );
    `);

    const count = async (sql: string) =>
      (await db.prepare(sql).first<number>("count")) ?? -1;

    await expect(
      db.prepare(`delete from briar_channels where id = ?`)
        .bind("erase-channel").run(),
    ).resolves.toBeDefined();
    expect(
      await count(
        `select count(*) as count from briar_channel_messages
         where channel_id = 'erase-channel'`,
      ),
    ).toBe(0);

    await expect(
      db.prepare(`delete from briar_teams where id = ?`)
        .bind("erase-project").run(),
    ).resolves.toBeDefined();
    expect(
      await count(
        `select count(*) as count from briar_projects where id = 'erase-project'`,
      ),
    ).toBe(0);
    expect(
      await count(
        `select count(*) as count from briar_project_agents
         where id = 'erase-agent'`,
      ),
    ).toBe(0);

    await expect(
      db.prepare(`delete from briar_organizations where id = ?`)
        .bind("erase-org").run(),
    ).resolves.toBeDefined();
    expect(
      await count(
        `select count(*) as count from briar_organizations where id = 'erase-org'`,
      ),
    ).toBe(0);

    await expect(
      db.prepare(`delete from "user" where id = ?`).bind("erase-owner").run(),
    ).resolves.toBeDefined();
    expect(
      await count(`select count(*) as count from "user" where id = 'erase-owner'`),
    ).toBe(0);
    expect((await db.prepare(`pragma foreign_key_check`).all()).results)
      .toEqual([]);
  });
});
