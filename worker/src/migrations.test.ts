import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { describe, expect, it } from "vitest";

describe("D1 migrations", () => {
  it.each([
    "0049_dashboard_delta_sync.sql",
    "0050_hunt_run_event_count.sql",
    "0053_issue_result_reviews.sql",
    "0055_agent_provider_opencode.sql",
    "0073_channel_delta_sync.sql",
  ])("keeps each trigger in a separate Wrangler statement: %s", async (name) => {
    const sql = await readFile(resolve("migrations", name), "utf8");
    const statements = unstable_splitSqlQuery(sql);
    const triggerCounts = statements.map(
      (statement) => statement.match(/\bcreate\s+trigger\b/giu)?.length ?? 0,
    );

    expect(Math.max(...triggerCounts)).toBeLessThanOrEqual(1);
    expect(triggerCounts.filter((count) => count === 1)).not.toHaveLength(0);
  });

  it.each([
    "0055_agent_provider_opencode.sql",
    "0070_organization_agents.sql",
    "0071_organization_ideas.sql",
    "0072_organization_channels.sql",
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
      resolve("migrations", "0070_organization_agents.sql"),
      "utf8",
    );
    const ideas = await readFile(
      resolve("migrations", "0071_organization_ideas.sql"),
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

  it("adds workflow v2 progress without rewriting stored snapshots", async () => {
    const sql = await readFile(
      resolve("migrations", "0059_workflow_v2_progress.sql"),
      "utf8",
    );

    expect(sql).toMatch(/alter\s+table\s+briar_hunt_runs\s+add\s+column\s+waiting_checkpoint_key/iu);
    expect(sql).toMatch(/create\s+table\s+briar_run_stage_progress/iu);
    expect(sql).toMatch(/create\s+table\s+briar_run_checkpoint_progress/iu);
    expect(sql).toMatch(/create\s+unique\s+index\s+briar_run_checkpoint_waiting_unique_idx[\s\S]*where\s+state\s*=\s*'waiting'/iu);
    expect(sql).not.toMatch(/\bupdate\s+briar_(project_settings|hunt_runs)\b/iu);
  });

  it("adds checkpoint policy storage without rewriting workflow snapshots", async () => {
    const sql = await readFile(
      resolve("migrations", "0060_workflow_checkpoint_policies.sql"),
      "utf8",
    );

    expect(sql).toMatch(/add\s+column\s+mandatory_checkpoints_json/iu);
    expect(sql).toMatch(/add\s+column\s+checkpoint_policy_revision/iu);
    expect(sql).toMatch(/create\s+table\s+briar_user_workflow_checkpoint_defaults/iu);
    expect(sql).not.toMatch(/\bupdate\s+briar_(project_settings|hunt_runs)\b/iu);
  });

  it("adds per-issue checkpoint storage without rewriting existing runs", async () => {
    const sql = await readFile(
      resolve("migrations", "0067_issue_checkpoints.sql"),
      "utf8",
    );

    expect(sql).toMatch(
      /alter\s+table\s+briar_hunt_runs\s+add\s+column\s+issue_checkpoints_json/iu,
    );
    expect(sql).toMatch(/default\s+'\[\]'/iu);
    expect(sql).not.toMatch(/\bupdate\s+briar_hunt_runs\b/iu);
  });

  it("stores conversation issue writes as approval proposals", async () => {
    const sql = await readFile(
      resolve("migrations", "0068_issue_action_proposals.sql"),
      "utf8",
    );

    expect(sql).toMatch(/create\s+table\s+briar_issue_action_proposals/iu);
    expect(sql).toMatch(/request_issue_update/iu);
    expect(sql).toMatch(/request_issue_create/iu);
    expect(sql).not.toMatch(/\bupdate\s+briar_hunt_runs\b/iu);
  });

  it("canonicalizes every stored v1 workflow before runtime v1 support is removed", async () => {
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
      const workflow = (pauseAfterStage?: string) => JSON.stringify({
        version: 1,
        stages: [
          { id: "implementing", label: "Implement", required: true },
          { id: "merged", label: "Merge", required: true },
        ],
        ...(pauseAfterStage ? { execution: { pauseAfterStage } } : {}),
        completion: { requiredStages: ["implementing", "merged"] },
      });
      const explicitCheckpoint = JSON.stringify([
        { key: "team-before-merge", stage: "merged", position: "before" },
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
        ["stop-only", JSON.stringify({
          ...JSON.parse(workflow()),
          execution: { stopAfterStage: "implementing" },
        }), null],
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
        ["run-pause", workflow("implementing")],
        ["run-fallback", workflow()],
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
      for (const statement of unstable_splitSqlQuery(sql)) {
        await db.prepare(statement).run();
      }
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
            key: "legacy-after-merged",
            stage: "merged",
            position: "after",
          }],
        },
      });
      expect(byProject.get("explicit-empty")?.execution.checkpoints).toEqual([]);
      expect(byProject.get("explicit-checkpoint")?.execution.checkpoints).toEqual(
        JSON.parse(explicitCheckpoint),
      );
      expect(byProject.get("fallback")?.execution.checkpoints).toEqual([{
        key: "legacy-after-merged",
        stage: "merged",
        position: "after",
      }]);
      expect(byProject.get("stop-only")?.execution.checkpoints).toEqual([{
        key: "legacy-after-implementing",
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
      expect(byRun.get("run-pause")).toMatchObject({
        version: 2,
        requirements: [],
        execution: {
          checkpoints: [{
            key: "legacy-after-implementing",
            stage: "implementing",
            position: "after",
          }],
        },
      });
      expect(byRun.get("run-fallback")?.execution.checkpoints).toEqual([{
        key: "legacy-after-merged",
        stage: "merged",
        position: "after",
      }]);
      expect(
        firstRunPass.results.find((row) => row.id === "run-v2")
          ?.workflow_snapshot_json,
      ).toBe(alreadyV2);
      expect(firstRunPass.results.every(
        (row) => row.updated_at === "2026-08-06T00:00:00.000Z",
      )).toBe(true);

      for (const statement of unstable_splitSqlQuery(sql)) {
        await db.prepare(statement).run();
      }
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

  it("tracks resume requests without rewriting paused runs", async () => {
    const sql = await readFile(
      resolve("migrations", "0061_resume_requested_state.sql"),
      "utf8",
    );

    expect(sql).toMatch(/add\s+column\s+resume_requested_at/iu);
    expect(sql).not.toMatch(/\bupdate\s+briar_hunt_runs\b/iu);
  });

  it("adds optional issue assignees without rewriting existing runs", async () => {
    const sql = await readFile(
      resolve("migrations", "0062_issue_assignees.sql"),
      "utf8",
    );

    expect(sql).toMatch(
      /add\s+column\s+assignee_user_id\s+text\s+references\s+"user"\s*\(id\)\s+on\s+delete\s+set\s+null/iu,
    );
    expect(sql).toMatch(/briar_hunt_runs_assignee_idx/iu);
    expect(sql).not.toMatch(/\bupdate\s+briar_hunt_runs\b/iu);
  });

  it("adds account-scoped inbox read state storage", async () => {
    const sql = await readFile(
      resolve("migrations", "0063_inbox_read_states.sql"),
      "utf8",
    );

    expect(sql).toMatch(/create\s+table\s+briar_inbox_read_states/iu);
    expect(sql).toMatch(/primary\s+key\s*\(\s*user_id\s*,\s*message_id\s*\)/iu);
    expect(sql).toMatch(/briar_inbox_read_states_user_updated_idx/iu);
    expect(sql).not.toMatch(/\bupdate\s+briar_/iu);
  });

  it("adds idempotent GitHub delivery and revision-scoped PR state", async () => {
    const sql = await readFile(
      resolve("migrations", "0063_github_pull_request_sync.sql"),
      "utf8",
    );

    expect(sql).toMatch(/create\s+table\s+briar_github_deliveries/iu);
    expect(sql).toMatch(
      /alter\s+table\s+briar_run_evidence\s+add\s+column\s+github_association_started_at\s+text/iu,
    );
    expect(sql).toMatch(/delivery_id\s+text\s+primary\s+key/iu);
    expect(sql).toMatch(/create\s+table\s+briar_github_pull_requests/iu);
    expect(sql).not.toMatch(/url\s+text\s+not\s+null\s+unique/iu);
    expect(sql).toMatch(/briar_github_pull_requests_url_idx/iu);
    expect(sql).toMatch(/create\s+table\s+briar_run_pull_requests/iu);
    expect(sql).toMatch(
      /primary\s+key\s*\(\s*run_id,\s*attempt,\s*revision,\s*repository_id,\s*pull_request_number\s*\)/iu,
    );
    expect(sql).toMatch(/revision_started_at\s+text\s+not\s+null/iu);
    expect(sql).not.toMatch(/insert\s+into\s+briar_run_pull_requests/iu);
    expect(sql).not.toMatch(/\bupdate\s+briar_hunt_runs\b/iu);
  });

  it("stores verified GitHub connections without persisting OAuth tokens", async () => {
    const sql = await readFile(
      resolve("migrations", "0064_github_integration.sql"),
      "utf8",
    );

    expect(sql).toMatch(/create\s+table\s+briar_github_connections/iu);
    expect(sql).toMatch(/status\s+text\s+not\s+null[\s\S]*'disconnected'/iu);
    expect(sql).toMatch(/create\s+table\s+briar_github_oauth_states/iu);
    expect(sql).toMatch(/pkce_verifier\s+text\s+not\s+null/iu);
    expect(sql).not.toMatch(/(?:access|refresh)_token/iu);
  });
});
