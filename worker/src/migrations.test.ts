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
    "0074_channel_delta_sync.sql",
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
      for (const statement of unstable_splitSqlQuery(sql)) {
        await db.prepare(statement).run();
      }

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
