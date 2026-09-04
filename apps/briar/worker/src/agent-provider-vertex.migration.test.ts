import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { agentProviders } from "../../src/lib/agent-provider";
import { agentProviderConstraints } from "../../../../scripts/agent-provider-sql-constraints";
import { applyD1Migrations } from "./test-helpers/d1";

/**
 * The persisted provider catalog lives in `check (… in (…))` lists spread over
 * every provider column, so "the provider exists" is only true once each of
 * those lists accepts it. These tests read the constraints back out of the
 * migrated database rather than the checked-in snapshot, which is what proves
 * the migration itself applied.
 */
describe("agent provider vertex migration", () => {
  it("lists every catalog provider in every persisted constraint", async () => {
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
    const catalog = [...agentProviders].sort().join(",");
    const drifted = constraints
      .filter(({ providers }) => [...providers].sort().join(",") !== catalog)
      .map(({ table, column, providers }) =>
        `${table}.${column}: ${providers.join(", ")}`
      );
    expect(drifted).toEqual([]);
  });

  it("repairs the reply-job columns that fell behind OpenRouter", async () => {
    // `0116_issue_project_agent_replies.sql` sorts after
    // `0116_agent_provider_openrouter.sql` and rebuilt this table with the
    // pre-OpenRouter list, so these two columns rejected `openrouter` in
    // production until this migration rewrote them. Pinned by name because a
    // future table rebuild could reintroduce exactly this drift.
    const db = env.DB;
    await applyD1Migrations(db);
    const row = await db
      .prepare(
        `select sql from sqlite_schema
         where type = 'table' and name = 'briar_issue_agent_reply_jobs'`,
      )
      .first<{ sql: string }>();
    const constraints = agentProviderConstraints(row?.sql ?? "");
    const columns = Object.fromEntries(
      constraints.map(({ column, providers }) => [column, [...providers].sort()]),
    );
    const catalog = [...agentProviders].sort();
    expect(columns.preferred_provider).toEqual(catalog);
    expect(columns.agent_provider).toEqual(catalog);
    expect(catalog).toContain("openrouter");
    expect(catalog).toContain("vertex");
  });
});
