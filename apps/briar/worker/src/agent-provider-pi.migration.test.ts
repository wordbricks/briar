import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { agentProviders } from "../../src/lib/agent-provider";
import { agentProviderConstraints } from "../../../../scripts/agent-provider-sql-constraints";
import { applyD1Migrations } from "./test-helpers/d1";

/**
 * Adding a provider to the proto only reaches the database through a migration
 * that rewrites every `check (… in (…))` list. These tests read the migrated
 * schema back, and then actually store a `pi` row, because a constraint list
 * that merely mentions the provider still fails if some column was rebuilt
 * from an older list afterwards.
 */
describe("agent provider pi migration", () => {
  it("accepts pi in every persisted provider constraint", async () => {
    const db = env.DB;
    await applyD1Migrations(db);
    const rows = await db
      .prepare(
        `select sql from sqlite_schema where type = 'table' and sql is not null`,
      )
      .all<{ sql: string }>();
    const schema = rows.results.map((row) => row.sql).join(";\n");
    const constraints = agentProviderConstraints(schema);
    expect(constraints.length).toBeGreaterThan(10);
    expect(agentProviders).toContain("pi");
    const missing = constraints
      .filter(({ providers }) => !providers.includes("pi"))
      .map(({ table, column }) => `${table}.${column}`);
    expect(missing).toEqual([]);
  });

  it("stores a project agent that runs on pi", async () => {
    const db = env.DB;
    const now = "2026-09-05T00:00:00.000Z";
    await applyD1Migrations(db);
    await db
      .prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values ('pi-owner', 'Pi Owner', 'pi@example.com', 1, ?, ?)`,
      )
      .bind(now, now)
      .run();
    await db
      .prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values ('pi-org', 'Pi Org', 'pi-org', ?, ?)`,
      )
      .bind(now, now)
      .run();
    await db
      .prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values ('pi-project', 'pi-owner', 'pi-org', 'Pi Project', ?, ?, ?)`,
      )
      .bind("a".repeat(64), now, now)
      .run();
    await db
      .prepare(
        `insert into briar_project_agents (
           id, organization_id, project_id, name, provider, responsibility,
           created_at, updated_at
         ) values (
           'pi-agent', 'pi-org', 'pi-project', 'Pi Agent', 'pi',
           'Run a turn on the Pi coding agent', ?, ?
         )`,
      )
      .bind(now, now)
      .run();

    expect(
      await db
        .prepare(`select provider from briar_project_agents where id = 'pi-agent'`)
        .first<string>("provider"),
    ).toBe("pi");

    // The same column still rejects a provider the catalog does not name, so
    // the migration widened the list rather than dropping the constraint.
    await expect(
      db
        .prepare(
          `insert into briar_project_agents (
             id, organization_id, project_id, name, provider, responsibility,
             created_at, updated_at
           ) values (
             'unknown-agent', 'pi-org', 'pi-project', 'Unknown Agent',
             'not-a-provider', 'Rejected', ?, ?
           )`,
        )
        .bind(now, now)
        .run(),
    ).rejects.toThrow();
  });
});
