import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { repositoryWorkflowBootstrap } from "../../src/lib/auto-hunt-contract";
import {
  assertQueuedHuntClaim,
  HuntClaimError,
} from "./db";
import { runIsFullAuto } from "./hunt-run-codec";
import {
  applyD1Migrations,
  executeD1Sql,
} from "./test-helpers/d1";

describe("hunt run execution policy storage cutover", () => {
  it("backfills policy once and keeps claim authorization independent of context", async () => {
    const db = env.DB;
    const now = "2026-09-01T00:00:00.000Z";
    await applyD1Migrations(db, {
      through: "0164_canonical_agent_execution_metrics_storage.sql",
    });
    await executeD1Sql(db, `
      insert into "user" (
        id, name, email, emailVerified, createdAt, updatedAt
      ) values (
        'policy-owner', 'Policy Owner', 'policy@example.com', 1,
        '${now}', '${now}'
      );
      insert into briar_organizations (
        id, name, handle, created_at, updated_at
      ) values (
        'policy-org', 'Policy Org', 'policy-org', '${now}', '${now}'
      );
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values (
        'policy-project', 'policy-owner', 'policy-org', 'Policy Project',
        '${"a".repeat(64)}', '${now}', '${now}'
      );
    `);
    const insertRun = db.prepare(
      `insert into briar_hunt_runs (
         id, project_id, source, source_key, title, stage, status,
         workflow_snapshot_json, repository, context_json,
         started_at, last_event_at, created_at, updated_at
       ) values (?, 'policy-project', 'issue', ?, ?, 'queued', 'queued',
         ?, 'briar/policy', ?, ?, ?, ?, ?)`,
    );
    await db.batch([
      insertRun.bind(
        "app-full-auto",
        "app-full-auto",
        "App full auto",
        JSON.stringify(repositoryWorkflowBootstrap),
        JSON.stringify({
          origin: "briar-app",
          fullAuto: true,
          requestKind: "interactive",
        }),
        now,
        now,
        now,
        now,
      ),
      insertRun.bind(
        "external-manual",
        "external-manual",
        "External manual",
        JSON.stringify(repositoryWorkflowBootstrap),
        JSON.stringify({ origin: "slack", fullAuto: false }),
        now,
        now,
        now,
        now,
      ),
    ]);

    await applyD1Migrations(db, {
      files: ["0166_canonical_hunt_run_execution_policy.sql"],
    });

    const rows = (await db.prepare(
      `select id, context_json, full_auto, requires_claim_token
       from briar_hunt_runs order by id`,
    ).all<{
      id: string;
      context_json: string;
      full_auto: 0 | 1;
      requires_claim_token: 0 | 1;
    }>()).results;
    expect(rows.map((row) => ({
      ...row,
      context_json: JSON.parse(row.context_json) as unknown,
    }))).toEqual([
      {
        id: "app-full-auto",
        context_json: {
          origin: "briar-app",
          requestKind: "interactive",
        },
        full_auto: 1,
        requires_claim_token: 1,
      },
      {
        id: "external-manual",
        context_json: { origin: "slack" },
        full_auto: 0,
        requires_claim_token: 0,
      },
    ]);
    expect(runIsFullAuto(rows[0]!)).toBe(true);
    expect(runIsFullAuto(rows[1]!)).toBe(false);

    await expect(assertQueuedHuntClaim(
      db,
      "policy-project",
      { source: "issue", sourceKey: "app-full-auto" },
      null,
      now,
    )).rejects.toBeInstanceOf(HuntClaimError);
    await db.prepare(
      `update briar_hunt_runs
       set context_json = '{"origin":"tampered"}'
       where id = 'app-full-auto'`,
    ).run();
    await expect(assertQueuedHuntClaim(
      db,
      "policy-project",
      { source: "issue", sourceKey: "app-full-auto" },
      null,
      now,
    )).rejects.toBeInstanceOf(HuntClaimError);
    await expect(assertQueuedHuntClaim(
      db,
      "policy-project",
      { source: "issue", sourceKey: "external-manual" },
      null,
      now,
    )).resolves.toBeUndefined();

    await expect(db.prepare(
      `update briar_hunt_runs
       set context_json = '{"origin":"future","fullAuto":true}'
       where id = 'external-manual'`,
    ).run()).rejects.toThrow(/execution policy/iu);
    await expect(db.prepare(
      `update briar_hunt_runs set full_auto = 2
       where id = 'external-manual'`,
    ).run()).rejects.toThrow();
  });
});
