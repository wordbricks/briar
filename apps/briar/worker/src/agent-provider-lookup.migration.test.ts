import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { agentProviders } from "../../src/lib/agent-provider";
import { agentProviderConstraints } from "../../../../scripts/agent-provider-sql-constraints";
import { applyD1Migrations } from "./test-helpers/d1";
import { executeD1Sql } from "./test-helpers/d1-sql";
import { workerRuntimeProtoJsonFixture } from "./test-helpers/worker-runtime";

/**
 * The persisted provider catalog is rows in `briar_agent_providers`, and every
 * provider column is a foreign key into it. Before that it was a
 * `check (… in (…))` list repeated on each column, which SQLite can only widen
 * by rebuilding the table — and rebuilding a table drags in its foreign-key
 * descendants, so one provider rewrote the whole database.
 *
 * These tests read the migrated database rather than the checked-in snapshot,
 * which is what proves the cutover migration itself applied.
 */
describe("agent provider lookup migration", () => {
  const now = "2026-09-06T00:00:00.000Z";
  const tableSchema = async (db: D1Database) => {
    const rows = await db
      .prepare(
        `select sql from sqlite_schema where type = 'table' and sql is not null`,
      )
      .all<{ sql: string }>();
    return rows.results.map((row) => row.sql).join(";\n");
  };

  it("seeds the catalog the platform advertises", async () => {
    const db = env.DB;
    await applyD1Migrations(db);
    const rows = await db
      .prepare(
        `select provider, proto_name from briar_agent_providers order by provider`,
      )
      .all<{ provider: string; proto_name: string }>();
    expect(rows.results.map((row) => row.provider)).toEqual(
      [...agentProviders].sort(),
    );
    expect(rows.results.map((row) => row.proto_name)).toEqual(
      [...agentProviders].sort().map((provider) =>
        `AGENT_PROVIDER_${provider.toUpperCase()}`
      ),
    );
  });

  it("leaves no column spelling the provider list out", async () => {
    const db = env.DB;
    await applyD1Migrations(db);
    const spelledOut = agentProviderConstraints(await tableSchema(db))
      .map(({ table, column }) => `${table}.${column}`);
    expect(spelledOut).toEqual([]);
  });

  it("keys the reply-job columns that once fell behind OpenRouter", async () => {
    // `0116_issue_project_agent_replies.sql` sorts after
    // `0116_agent_provider_openrouter.sql` and rebuilt this table with the
    // pre-OpenRouter list, so these two columns rejected `openrouter` in
    // production until a later rebuild rewrote them. A foreign key cannot fall
    // behind that way, and these columns are pinned by name because they are
    // the ones that did.
    const db = env.DB;
    await applyD1Migrations(db);
    const row = await db
      .prepare(
        `select sql from sqlite_schema
         where type = 'table' and name = 'briar_issue_agent_reply_jobs'`,
      )
      .first<{ sql: string }>();
    for (const column of ["preferred_provider", "agent_provider"]) {
      expect(row?.sql).toContain(
        `foreign key ("${column}") references briar_agent_providers (provider)`,
      );
    }
  });

  it("stores every catalog provider and still rejects an unknown one", async () => {
    const db = env.DB;
    await applyD1Migrations(db);
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values ('lookup-owner', 'Lookup Owner', 'lookup@example.com', 1,
              '${now}', '${now}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('lookup-org', 'Lookup Org', 'lookup-org', '${now}', '${now}');
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values (
        'lookup-project', 'lookup-owner', 'lookup-org', 'Lookup Project',
        '${"a".repeat(64)}', '${now}', '${now}'
      );
    `);
    for (const provider of agentProviders) {
      await db
        .prepare(
          `insert into briar_project_agents (
             id, organization_id, project_id, name, provider, responsibility,
             created_at, updated_at
           ) values (?, 'lookup-org', 'lookup-project', ?, ?, ?, ?, ?)`,
        )
        .bind(
          `lookup-agent-${provider}`,
          `${provider} Agent`,
          provider,
          `Run a turn on ${provider}`,
          now,
          now,
        )
        .run();
    }
    expect(
      await db
        .prepare(
          `select count(*) as count from briar_project_agents
           where project_id = 'lookup-project'`,
        )
        .first<number>("count"),
    ).toBe(agentProviders.length);

    // The foreign key now carries what the CHECK list used to: a provider the
    // catalog does not name cannot be stored.
    await expect(
      db
        .prepare(
          `insert into briar_project_agents (
             id, organization_id, project_id, name, provider, responsibility,
             created_at, updated_at
           ) values (
             'lookup-unknown', 'lookup-org', 'lookup-project', 'Unknown Agent',
             'not-a-provider', 'Rejected', ?, ?
           )`,
        )
        .bind(now, now)
        .run(),
    ).rejects.toThrow();

    // And the catalog cannot drop a provider rows still point at, which the
    // CHECK lists could never express.
    await expect(
      db
        .prepare(`delete from briar_agent_providers where provider = 'codex'`)
        .run(),
    ).rejects.toThrow();
  });

  it("reads the provider views out of the lookup table", async () => {
    const db = env.DB;
    await applyD1Migrations(db);
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values ('view-owner', 'View Owner', 'view@example.com', 1,
              '${now}', '${now}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('view-org', 'View Org', 'view-org', '${now}', '${now}');
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values (
        'view-project', 'view-owner', 'view-org', 'View Project',
        '${"a".repeat(64)}', '${now}', '${now}'
      );
      insert into briar_execution_worker_devices (
        id, organization_id, owner_user_id, label, device_identity_hash,
        state, last_heartbeat_at, created_at, updated_at
      ) values (
        'view-device', 'view-org', 'view-owner', 'View Device',
        '${"b".repeat(64)}', 'online', '${now}', '${now}', '${now}'
      );
    `);
    await db
      .prepare(
        `insert into briar_execution_workers (
           id, project_id, device_id, label, host_fingerprint, state,
           runtime_proto_json, last_heartbeat_at, created_at, updated_at
         ) values (
           'view-worker', 'view-project', 'view-device', 'View Worker', ?,
           'online', ?, ?, ?, ?
         )`,
      )
      .bind(
        "c".repeat(64),
        workerRuntimeProtoJsonFixture({ providers: ["codex", "claude"] }),
        now,
        now,
        now,
      )
      .run();

    // A full-catalog advertisement is valid, which is the cardinality the view
    // now counts out of briar_agent_providers instead of a literal.
    expect(
      await db
        .prepare(
          `select count(*) as count from briar_invalid_execution_worker_runtime`,
        )
        .first<number>("count"),
    ).toBe(0);
    const healthy = await db
      .prepare(
        `select provider, agent_provider
         from briar_execution_worker_healthy_providers
         where worker_id = 'view-worker'
         order by provider`,
      )
      .all<{ provider: string; agent_provider: string }>();
    expect(healthy.results).toEqual([
      { provider: "claude", agent_provider: "codex" },
      { provider: "codex", agent_provider: "codex" },
    ]);
  });
});
