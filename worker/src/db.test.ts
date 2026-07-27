import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  normalizeAutoHuntWorkflow,
  repositoryWorkflowBootstrap,
} from "../../src/lib/auto-hunt-contract";
import type { HuntEventInput } from "./db";
import {
  assertQueuedHuntClaim,
  claimNextQueuedHuntRun,
  claimDueProjectAgentScheduleRun,
  addOrganizationMember,
  completeProjectAgentScheduleRun,
  createOrganization,
  createIssueMessage,
  createProjectAgent,
  createProjectAgentSchedule,
  createProject,
  createIssueAttachments,
  deleteProjectAgentSchedule,
  deleteProject,
  getProject,
  getProjectSettings,
  getHuntRunForProject,
  getIssueAttachment,
  getNextQueuedHuntRun,
  HuntClaimError,
  HuntTransitionError,
  listIssueAttachments,
  listIssueMessages,
  listOrganizationMembers,
  isOrganizationHandleAvailable,
  listProjects,
  listProjectAgents,
  listProjectAgentScheduleRuns,
  listProjectAgentSchedules,
  moveHuntRun,
  recoverHuntRun,
  recordHuntEvent,
  recordRunEvidence,
  recordQaResult,
  renewProjectAgentScheduleRunLease,
  updateProjectSettings,
  updateProjectAgent,
  updateProjectAgentSchedule,
  updateOrganization,
} from "./db";

const releaseWorkflow = normalizeAutoHuntWorkflow({
  version: 1,
  stages: [
    { id: "analyzing", label: "Analyze", required: true },
    { id: "implementing", label: "Implement", required: true },
    { id: "pr_open", label: "Pull request", required: true },
    { id: "staging_qa", label: "Staging QA", required: true },
    { id: "production_qa", label: "Production QA", required: true },
  ],
});
const localWorkflow = normalizeAutoHuntWorkflow({
  version: 1,
  stages: [
    { id: "analyzing", label: "Analyze", required: true },
    { id: "implementing", label: "Implement", required: true },
    { id: "local_qa", label: "Local validation", required: true },
  ],
});

const projectId = "11111111-1111-4111-8111-111111111111";
const baseTime = Date.parse("2026-07-21T00:00:00Z");
const atMinute = (minute: number) =>
  new Date(baseTime + minute * 60_000).toISOString();
const executeSql = async (db: D1Database, sql: string) => {
  for (const statement of sql.split(/;\s*(?:\n|$)/u)) {
    if (statement.trim()) await db.prepare(statement).run();
  }
};

const event = (
  stage: HuntEventInput["stage"],
  minute: number,
  overrides: Partial<HuntEventInput> = {},
): HuntEventInput => ({
  source: "issue",
  sourceKey: "integration-run",
  title: "D1 lifecycle integration",
  stage,
  eventKey: `integration:${stage}:${minute}`,
  occurredAt: atMinute(minute),
  actor: "vitest",
  repository: "example/repository",
  detail: `${stage} detail`,
  priority: null,
  branch: "codex/integration",
  commitSha: "abcdef1",
  tracker: null,
  issueDescription: null,
  resultSummary: null,
  pullRequestUrls: [],
  targetSha: null,
  sourceCreatedAt: null,
  qaStatus: null,
  stagingQaDetail: null,
  productionQaDetail: null,
  context: null,
  ...overrides,
});

describe("Briar Auto Hunt D1 lifecycle", () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "briar-test" },
  });
  let db: D1Database;

  beforeAll(async () => {
    db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
    for (const migration of [
      "migrations/0001_briar.sql",
      "migrations/0002_remove_repository_path.sql",
      "migrations/0003_generalize_auto_hunt.sql",
      "migrations/0004_auto_hunt_claims.sql",
      "migrations/0005_auto_hunt_recovery.sql",
      "migrations/0006_issue_attachments.sql",
      "migrations/0007_configurable_workflows.sql",
      "migrations/0008_organizations.sql",
      "migrations/0009_auto_hunt_automation.sql",
      "migrations/0010_issue_messages.sql",
      "migrations/0011_issue_message_agents.sql",
      "migrations/0012_organization_handles.sql",
      "migrations/0013_execution_workers.sql",
      "migrations/0014_agent_provider_grok.sql",
    ]) {
      await executeSql(db, await readFile(resolve(migration), "utf8"));
    }
    await executeSql(
      db,
      `
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('owner', 'Owner', 'owner@example.com', 1, '${atMinute(0)}', '${atMinute(0)}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values (
        '${projectId}', 'Example Org', 'example-org',
        '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values (
        '${projectId}', 'owner', 'owner', '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash, created_at, updated_at
      ) values (
        '${projectId}', 'owner', '${projectId}', 'Example',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_project_settings (
        project_id, velen_org, linear_enabled, workflow_json, created_at, updated_at
      ) values (
        '${projectId}', 'example', 0,
        '{"version":1,"preset":"release","stages":[{"id":"analyzing","label":"분석","required":true},{"id":"implementing","label":"구현","required":true},{"id":"pr_open","label":"PR 검증","required":true},{"id":"staging_qa","label":"Stage QA","required":true},{"id":"production_qa","label":"Production QA","required":true}]}',
        '${atMinute(0)}', '${atMinute(0)}'
      );
    `,
    );
    const migrationRunId = await recordHuntEvent(
      db,
      projectId,
      event("cancelled", 1, {
        sourceKey: "pre-backlog-migration",
        eventKey: "pre-backlog-migration:cancelled",
        title: "Pre-backlog migration sentinel",
      }),
    );
    await createIssueAttachments(db, projectId, migrationRunId, [
      {
        id: "11111111-2222-4333-8444-555555555555",
        object_key: "issue-attachments/pre-backlog-migration/sentinel",
        filename: "sentinel.png",
        content_type: "image/png",
        byte_size: 8,
      },
    ]);
    await createIssueMessage(db, {
      id: "66666666-7777-4888-8999-000000000000",
      projectId,
      runId: migrationRunId,
      parentMessageId: null,
      authorUserId: "owner",
      authorAgentProvider: null,
      body: "Preserve this message through the backlog migration.",
      createdAt: atMinute(1),
    });
    await executeSql(
      db,
      await readFile(resolve("migrations/0015_backlog_status.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0016_project_agents.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0017_default_auto_hunt_agent.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0018_project_agent_schedules.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0019_project_agent_schedule_runs.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0020_project_agent_calendar_color.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0021_run_evidence.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0022_remove_workflow_presets.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0023_project_agent_skills.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0024_project_agent_avatars.sql"), "utf8"),
    );
  });

  afterAll(async () => {
    await miniflare.dispose();
  });

  it("preserves existing run data and child foreign keys in the backlog migration", async () => {
    const run = await db
      .prepare(
        `select id, stage, status from briar_hunt_runs
         where source_key = 'pre-backlog-migration'`,
      )
      .first<{ id: string; stage: string; status: string }>();

    expect(run).toMatchObject({ stage: "cancelled", status: "cancelled" });
    expect(
      JSON.parse((await getProjectSettings(db, projectId))!.workflow_json),
    ).toEqual(repositoryWorkflowBootstrap);
    expect(
      JSON.parse(
        (await getHuntRunForProject(db, projectId, run!.id))!
          .workflow_snapshot_json,
      ),
    ).not.toHaveProperty("preset");
    expect(
      await db
        .prepare(
          "select count(*) as count from briar_hunt_events where run_id = ?",
        )
        .bind(run!.id)
        .first<number>("count"),
    ).toBe(1);
    expect(
      await db
        .prepare(
          "select count(*) as count from briar_issue_attachments where run_id = ?",
        )
        .bind(run!.id)
        .first<number>("count"),
    ).toBe(1);
    expect(
      await db
        .prepare(
          "select count(*) as count from briar_issue_messages where run_id = ?",
        )
        .bind(run!.id)
        .first<number>("count"),
    ).toBe(1);
    expect(await db.prepare("pragma foreign_key_check").all()).toMatchObject({
      results: [],
    });
  });

  it("backfills one default Auto Hunt agent for an existing project", async () => {
    await expect(listProjectAgents(db, projectId)).resolves.toEqual([
      expect.objectContaining({
        project_id: projectId,
        name: "Auto Hunt agent",
        avatar: null,
        provider: "codex",
        model: null,
        responsibility: "Perform Auto Hunt for every queued issue.",
        skill_markdown: expect.stringContaining(
          "briar skills get briar-workflow",
        ),
        calendar_color: "#3275d5",
        kind: "auto_hunt",
      }),
    ]);
  });

  it("creates and lists custom agents scoped to a project", async () => {
    const agent = await createProjectAgent(db, projectId, {
      name: "Sentry 오류 탐지 에이전트",
      provider: "claude",
      model: "opus",
      responsibility:
        "Sentry 오류를 분석해 이슈를 만들고 담당자에게 배정합니다.",
      calendarColor: "#8b5cf6",
    });

    expect(agent).toMatchObject({
      project_id: projectId,
      name: "Sentry 오류 탐지 에이전트",
      provider: "claude",
      model: "opus",
      skill_markdown: expect.stringContaining(
        "Sentry 오류를 분석해 이슈를 만들고 담당자에게 배정합니다.",
      ),
      calendar_color: "#8b5cf6",
    });
    await expect(listProjectAgents(db, projectId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "auto_hunt" }),
        agent,
      ]),
    );
    await expect(
      listProjectAgents(db, "22222222-2222-4222-8222-222222222222"),
    ).resolves.toEqual([]);
  });

  it("creates recurring schedules for an agent in the same project", async () => {
    const agent = (await listProjectAgents(db, projectId))[0];
    const schedule = await createProjectAgentSchedule(db, projectId, {
      agentId: agent.id,
      name: "Weekday repository audit",
      recurrence: "weekdays",
      timeOfDay: "09:00",
      dayOfWeek: null,
      timeZone: "Asia/Seoul",
    });

    expect(schedule).toMatchObject({
      project_id: projectId,
      agent_id: agent.id,
      agent_name: "Auto Hunt agent",
      agent_provider: "codex",
      name: "Weekday repository audit",
      recurrence: "weekdays",
      time_of_day: "09:00",
      day_of_week: null,
      time_zone: "Asia/Seoul",
      enabled: 1,
    });
    await expect(listProjectAgentSchedules(db, projectId)).resolves.toEqual([
      schedule,
    ]);
    await expect(
      createProjectAgentSchedule(db, projectId, {
        agentId: "22222222-2222-4222-8222-222222222222",
        name: "Missing agent",
        recurrence: "daily",
        timeOfDay: "12:00",
        dayOfWeek: null,
        timeZone: "Etc/UTC",
      }),
    ).resolves.toBeNull();
  });

  it("updates and deletes a recurring schedule within its project", async () => {
    const agent = (await listProjectAgents(db, projectId))[0];
    const schedule = await createProjectAgentSchedule(db, projectId, {
      agentId: agent.id,
      name: "Original schedule",
      recurrence: "daily",
      timeOfDay: "08:00",
      dayOfWeek: null,
      timeZone: "Etc/UTC",
    });

    await expect(
      updateProjectAgentSchedule(db, projectId, schedule!.id, {
        agentId: agent.id,
        name: "Weekly release review",
        recurrence: "weekly",
        timeOfDay: "16:30",
        dayOfWeek: 5,
        timeZone: "Asia/Seoul",
      }),
    ).resolves.toMatchObject({
      id: schedule!.id,
      name: "Weekly release review",
      recurrence: "weekly",
      time_of_day: "16:30",
      day_of_week: 5,
      time_zone: "Asia/Seoul",
    });
    await expect(
      updateProjectAgentSchedule(
        db,
        "22222222-2222-4222-8222-222222222222",
        schedule!.id,
        {
          agentId: agent.id,
          name: "Wrong project",
          recurrence: "daily",
          timeOfDay: "09:00",
          dayOfWeek: null,
          timeZone: "Etc/UTC",
        },
      ),
    ).resolves.toBeNull();
    await expect(
      deleteProjectAgentSchedule(
        db,
        "22222222-2222-4222-8222-222222222222",
        schedule!.id,
      ),
    ).resolves.toBe("not_found");
    await expect(
      deleteProjectAgentSchedule(db, projectId, schedule!.id),
    ).resolves.toBe("deleted");
    await expect(
      deleteProjectAgentSchedule(db, projectId, schedule!.id),
    ).resolves.toBe("not_found");
  });

  it("claims a due schedule once and advances its next occurrence", async () => {
    const agent = (await listProjectAgents(db, projectId))[0];
    const schedule = await createProjectAgentSchedule(db, projectId, {
      agentId: agent.id,
      name: "Daily project audit",
      recurrence: "daily",
      timeOfDay: "09:00",
      dayOfWeek: null,
      timeZone: "Etc/UTC",
    });
    expect(schedule).not.toBeNull();
    await db
      .prepare(
        `update briar_project_agent_schedules
         set next_run_at = '2026-07-27T09:00:00.000Z'
         where id = ?`,
      )
      .bind(schedule!.id)
      .run();

    const claimed = await claimDueProjectAgentScheduleRun(db, projectId, {
      claimTokenHash: "a".repeat(64),
      observedAt: "2026-07-27T09:00:10.000Z",
    });
    expect(claimed).toMatchObject({
      schedule_id: schedule!.id,
      schedule_name: "Daily project audit",
      agent_provider: "codex",
      agent_responsibility: "Perform Auto Hunt for every queued issue.",
      agent_skill_markdown: expect.stringContaining(
        "briar skills get briar-workflow",
      ),
      workflow_json: JSON.stringify(repositoryWorkflowBootstrap),
      status: "running",
      scheduled_for: "2026-07-27T09:00:00.000Z",
    });
    await expect(
      claimDueProjectAgentScheduleRun(db, projectId, {
        claimTokenHash: "b".repeat(64),
        observedAt: "2026-07-27T09:00:10.000Z",
      }),
    ).resolves.toBeNull();
    await expect(
      deleteProjectAgentSchedule(db, projectId, schedule!.id),
    ).resolves.toBe("running");
    await expect(
      db
        .prepare(
          `select next_run_at from briar_project_agent_schedules where id = ?`,
        )
        .bind(schedule!.id)
        .first<string>("next_run_at"),
    ).resolves.toBe("2026-07-28T09:00:00.000Z");
    await expect(
      completeProjectAgentScheduleRun(db, projectId, claimed!.id, {
        claimTokenHash: "a".repeat(64),
        status: "completed",
        resultSummary: "Daily audit completed.",
        error: null,
        observedAt: "2026-07-27T09:01:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "completed" });
    await expect(listProjectAgentScheduleRuns(db, projectId)).resolves.toEqual([
      expect.objectContaining({
        id: claimed!.id,
        agent_id: agent.id,
        agent_name: "Auto Hunt agent",
        schedule_name: "Daily project audit",
        status: "completed",
        result_summary: "Daily audit completed.",
      }),
    ]);
    await expect(
      listProjectAgentScheduleRuns(
        db,
        "22222222-2222-4222-8222-222222222222",
      ),
    ).resolves.toEqual([]);
  });

  it("requires the active claim token to complete a scheduled run", async () => {
    const agent = (await listProjectAgents(db, projectId))[0];
    const schedule = await createProjectAgentSchedule(db, projectId, {
      agentId: agent.id,
      name: "Result reporter",
      recurrence: "daily",
      timeOfDay: "10:00",
      dayOfWeek: null,
      timeZone: "Etc/UTC",
    });
    await db
      .prepare(
        `update briar_project_agent_schedules
         set next_run_at = '2026-07-27T10:00:00.000Z'
         where id = ?`,
      )
      .bind(schedule!.id)
      .run();
    const tokenHash = "c".repeat(64);
    const claimed = await claimDueProjectAgentScheduleRun(db, projectId, {
      claimTokenHash: tokenHash,
      observedAt: "2026-07-27T10:00:05.000Z",
    });

    await expect(
      completeProjectAgentScheduleRun(db, projectId, claimed!.id, {
        claimTokenHash: "d".repeat(64),
        status: "completed",
        resultSummary: "must not persist",
        error: null,
        observedAt: "2026-07-27T10:01:00.000Z",
      }),
    ).resolves.toBeNull();
    await expect(
      completeProjectAgentScheduleRun(db, projectId, claimed!.id, {
        claimTokenHash: tokenHash,
        status: "completed",
        resultSummary: "Repository audit completed.",
        error: null,
        observedAt: "2026-07-27T10:01:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "completed",
      result_summary: "Repository audit completed.",
      completed_at: "2026-07-27T10:01:00.000Z",
    });
  });

  it("renews and safely reclaims an expired schedule execution", async () => {
    const agent = (await listProjectAgents(db, projectId))[0];
    const schedule = await createProjectAgentSchedule(db, projectId, {
      agentId: agent.id,
      name: "Lease recovery",
      recurrence: "daily",
      timeOfDay: "11:00",
      dayOfWeek: null,
      timeZone: "Etc/UTC",
    });
    await db
      .prepare(
        `update briar_project_agent_schedules
         set next_run_at = '2026-07-27T11:00:00.000Z'
         where id = ?`,
      )
      .bind(schedule!.id)
      .run();
    const originalHash = "e".repeat(64);
    const claimed = await claimDueProjectAgentScheduleRun(db, projectId, {
      claimTokenHash: originalHash,
      observedAt: "2026-07-27T11:00:00.000Z",
    });
    await expect(
      renewProjectAgentScheduleRunLease(db, projectId, claimed!.id, {
        claimTokenHash: originalHash,
        observedAt: "2026-07-27T12:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      id: claimed!.id,
      lease_expires_at: "2026-07-27T14:00:00.000Z",
    });

    await expect(
      claimDueProjectAgentScheduleRun(db, projectId, {
        claimTokenHash: "f".repeat(64),
        observedAt: "2026-07-27T13:00:00.000Z",
      }),
    ).resolves.toBeNull();
    await expect(
      claimDueProjectAgentScheduleRun(db, projectId, {
        claimTokenHash: "f".repeat(64),
        observedAt: "2026-07-27T14:00:01.000Z",
      }),
    ).resolves.toMatchObject({
      id: claimed!.id,
      schedule_id: schedule!.id,
      started_at: "2026-07-27T14:00:01.000Z",
    });
  });

  it("updates a project agent only within its project", async () => {
    const current = (await listProjectAgents(db, projectId))[0];
    const avatar = "data:image/png;base64,aA==";
    const updated = await updateProjectAgent(db, projectId, current.id, {
      name: "Release coordinator",
      avatar,
      provider: "claude",
      model: "sonnet",
      responsibility: "Coordinates release checks and reports the result.",
      calendarColor: "#0f9f76",
    });

    expect(updated).toMatchObject({
      id: current.id,
      project_id: projectId,
      name: "Release coordinator",
      avatar,
      provider: "claude",
      model: "sonnet",
      responsibility: "Coordinates release checks and reports the result.",
      skill_markdown: expect.stringContaining(
        "Coordinates release checks and reports the result.",
      ),
      calendar_color: "#0f9f76",
      kind: "auto_hunt",
    });
    await expect(
      updateProjectAgent(
        db,
        "22222222-2222-4222-8222-222222222222",
        current.id,
        {
          name: "Wrong project",
          provider: "grok",
          model: null,
          responsibility: "Must not update another project.",
          calendarColor: "#d97706",
        },
      ),
    ).resolves.toBeNull();
  });

  it("stores automation settings and preserves them for older settings clients", async () => {
    const baseSettings = {
      velenOrg: "example",
      dataSource: null,
      linear: { enabled: false, source: null, teamKey: null },
      githubRepository: "example/repository",
      workflow: releaseWorkflow,
    };
    await updateProjectSettings(db, projectId, {
      ...baseSettings,
      automation: {
        enabled: true,
        maxIssuesPerSession: 7,
        schedule: { enabled: true, intervalHours: 3 },
        queueThreshold: { enabled: true, minimumIssues: 5 },
        urgentIssue: { enabled: true },
      },
    });
    await updateProjectSettings(db, projectId, baseSettings);

    const settings = await getProjectSettings(db, projectId);
    expect(JSON.parse(settings?.auto_hunt_automation_json ?? "{}")).toEqual({
      enabled: true,
      maxIssuesPerSession: 7,
      schedule: { enabled: true, intervalHours: 3 },
      queueThreshold: { enabled: true, minimumIssues: 5 },
      urgentIssue: { enabled: true },
    });
  });

  it("allows duplicate organization names but enforces unique handles", async () => {
    await expect(
      isOrganizationHandleAvailable(db, "another-example"),
    ).resolves.toBe(true);
    const organization = await createOrganization(db, {
      name: "Example Org",
      handle: "another-example",
      ownerUserId: "owner",
    });

    expect(organization.name).toBe("Example Org");
    expect(organization.handle).toBe("another-example");
    await expect(
      isOrganizationHandleAvailable(db, "another-example"),
    ).resolves.toBe(false);
    await expect(
      createOrganization(db, {
        name: "A different name",
        handle: "another-example",
        ownerUserId: "owner",
      }),
    ).rejects.toThrow();
  });

  it("enforces forward stages, QA gates, and a completion summary", async () => {
    const runId = await recordHuntEvent(db, projectId, event("queued", 1));
    expect(runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    await recordHuntEvent(db, projectId, event("analyzing", 2));
    await recordHuntEvent(db, projectId, event("implementing", 3));
    await expect(
      recordHuntEvent(db, projectId, event("analyzing", 4)),
    ).rejects.toBeInstanceOf(HuntTransitionError);

    await recordHuntEvent(db, projectId, event("pr_open", 5));

    await recordHuntEvent(
      db,
      projectId,
      event("staging_qa", 6, { qaStatus: "pending", targetSha: "abcdef1" }),
    );
    for (const [stage, type, minute] of [
      ["analyzing", "velen", 6.1],
      ["analyzing", "repository", 6.2],
      ["implementing", "diff", 6.3],
      ["pr_open", "pull_request", 6.4],
      ["staging_qa", "staging", 6.5],
    ] as const) {
      await recordRunEvidence(db, projectId, {
        runId,
        evidenceKey: `${stage}:${type}`,
        stage,
        type,
        status: "passed",
        detail: `${type} verified`,
        command: null,
        url: null,
        metadata: null,
        actor: "vitest",
        observedAt: atMinute(minute),
      });
    }
    expect(
      await recordQaResult(db, projectId, {
        runId,
        environment: "staging",
        result: "passed",
        actor: "vitest",
        observedAt: atMinute(7),
        detail: "staging verified",
      }),
    ).toBe("passed");
    await recordHuntEvent(
      db,
      projectId,
      event("production_qa", 8, { qaStatus: "pending", targetSha: "abcdef1" }),
    );
    await expect(
      recordHuntEvent(
        db,
        projectId,
        event("completed", 9, { resultSummary: "too early" }),
      ),
    ).rejects.toThrow("production_qa:production");
    expect(
      await recordQaResult(db, projectId, {
        runId,
        environment: "production",
        result: "passed",
        actor: "vitest",
        observedAt: atMinute(10),
        detail: "production verified",
      }),
    ).toBe("passed");
    await recordRunEvidence(db, projectId, {
      runId,
      evidenceKey: "production_qa:production",
      stage: "production_qa",
      type: "production",
      status: "passed",
      detail: "production verified",
      command: null,
      url: null,
      metadata: null,
      actor: "vitest",
      observedAt: atMinute(10.5),
    });
    await expect(
      recordHuntEvent(db, projectId, event("completed", 11)),
    ).rejects.toThrow("result summary");
    const completion = event("completed", 12, {
      resultSummary: "Production verified",
    });
    await recordHuntEvent(db, projectId, completion);
    await expect(recordHuntEvent(db, projectId, completion)).resolves.toBe(
      runId,
    );

    const run = await db
      .prepare(
        `select stage, staging_qa_status, production_qa_status, result_summary
         from briar_hunt_runs where id = ?`,
      )
      .bind(runId)
      .first<{
        stage: string;
        staging_qa_status: string;
        production_qa_status: string;
        result_summary: string;
      }>();
    expect(run).toEqual({
      stage: "completed",
      staging_qa_status: "passed",
      production_qa_status: "passed",
      result_summary: "Production verified",
    });
  });

  it("deletes only a project owned by the requesting user", async () => {
    const project = await createProject(db, {
      ownerUserId: "owner",
      organizationId: projectId,
      name: "Disposable",
      agentTokenHash: "d".repeat(64),
    });

    await expect(listProjectAgents(db, project.id)).resolves.toEqual([
      expect.objectContaining({
        project_id: project.id,
        provider: "codex",
        kind: "auto_hunt",
      }),
    ]);
    const settings = await getProjectSettings(db, project.id);
    expect(JSON.parse(settings!.workflow_json)).toEqual(
      repositoryWorkflowBootstrap,
    );
    await expect(
      recordHuntEvent(
        db,
        project.id,
        event("queued", 12, { sourceKey: "workflow-pending" }),
      ),
    ).rejects.toThrow("Repository workflow has not been generated");
    await expect(deleteProject(db, project.id, "someone-else")).resolves.toBe(
      false,
    );
    await expect(getProject(db, project.id, "owner")).resolves.not.toBeNull();
    await expect(deleteProject(db, project.id, "owner")).resolves.toBe(true);
    await expect(getProject(db, project.id, "owner")).resolves.toBeNull();
    await expect(getProjectSettings(db, project.id)).resolves.toBeNull();
  });

  it("shares organization projects with members without granting owner deletion", async () => {
    await executeSql(
      db,
      `
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('member', 'Member', 'member@example.com', 1, '${atMinute(0)}', '${atMinute(0)}');
    `,
    );
    await expect(
      addOrganizationMember(db, projectId, "member@example.com", "member"),
    ).resolves.toBe("member");

    const projects = await listProjects(db, "member");
    expect(projects.map((project) => project.id)).toContain(projectId);
    expect(projects[0]?.member_role).toBe("member");
    expect(await getProject(db, projectId, "member")).not.toBeNull();
    await expect(deleteProject(db, projectId, "member")).resolves.toBe(false);

    const members = await listOrganizationMembers(db, projectId);
    expect(members.map((member) => member.email)).toEqual([
      "owner@example.com",
      "member@example.com",
    ]);
  });

  it("updates an organization name while preserving its membership role", async () => {
    await expect(
      updateOrganization(db, projectId, "Renamed Org", "owner"),
    ).resolves.toMatchObject({
      id: projectId,
      name: "Renamed Org",
      role: "owner",
    });
    expect((await listProjects(db, "owner"))[0]?.organization_name).toBe(
      "Renamed Org",
    );
  });

  it("stores an app-created issue as a queued Auto Hunt run", async () => {
    await db
      .prepare(
        `update briar_project_settings set workflow_json = ? where project_id = ?`,
      )
      .bind(
        JSON.stringify(localWorkflow),
        projectId,
      )
      .run();
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 20, {
        sourceKey: "briar-issue:22222222-2222-4222-8222-222222222222",
        eventKey:
          "briar-issue:22222222-2222-4222-8222-222222222222:queued:intake",
        title: "App-created issue",
        actor: "briar-app",
        priority: 2,
        branch: null,
        commitSha: null,
        issueDescription: "Created directly in Briar",
        sourceCreatedAt: atMinute(20),
        context: {
          origin: "briar-app",
          issueId: "22222222-2222-4222-8222-222222222222",
        },
      }),
    );

    const run = await db
      .prepare(
        `select stage, source, title, priority, issue_description, context_json
         from briar_hunt_runs where id = ?`,
      )
      .bind(runId)
      .first<{
        stage: string;
        source: string;
        title: string;
        priority: number;
        issue_description: string;
        context_json: string;
      }>();

    expect(run).toEqual({
      stage: "queued",
      source: "issue",
      title: "App-created issue",
      priority: 2,
      issue_description: "Created directly in Briar",
      context_json:
        '{"origin":"briar-app","issueId":"22222222-2222-4222-8222-222222222222"}',
    });
  });

  it("stores issue conversations with one-level threaded replies", async () => {
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 25, {
        sourceKey: "issue-message-run",
        eventKey: "issue-message-run:queued",
      }),
    );
    const rootId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const replyId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const agentReplyId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    expect(
      await createIssueMessage(db, {
        id: rootId,
        projectId,
        runId,
        parentMessageId: null,
        authorUserId: "owner",
        authorAgentProvider: null,
        body: "Please verify the edge case.",
        createdAt: atMinute(26),
      }),
    ).toEqual(
      expect.objectContaining({
        id: rootId,
        author_name: "Owner",
        reply_count: 0,
      }),
    );
    expect(
      await createIssueMessage(db, {
        id: replyId,
        projectId,
        runId,
        parentMessageId: rootId,
        authorUserId: "owner",
        authorAgentProvider: null,
        body: "The edge case is covered.",
        createdAt: atMinute(27),
      }),
    ).toEqual(
      expect.objectContaining({
        id: replyId,
        parent_message_id: rootId,
      }),
    );
    expect(
      await createIssueMessage(db, {
        id: agentReplyId,
        projectId,
        runId,
        parentMessageId: rootId,
        authorUserId: null,
        authorAgentProvider: "claude",
        body: "The original provider checked the follow-up.",
        createdAt: atMinute(28),
      }),
    ).toEqual(
      expect.objectContaining({
        id: agentReplyId,
        author_user_id: null,
        author_agent_provider: "claude",
      }),
    );

    const messages = await listIssueMessages(db, projectId, runId);
    expect(messages).toEqual([
      expect.objectContaining({ id: rootId, reply_count: 2 }),
      expect.objectContaining({
        id: replyId,
        parent_message_id: rootId,
        reply_count: 0,
      }),
      expect.objectContaining({
        id: agentReplyId,
        parent_message_id: rootId,
        author_agent_provider: "claude",
        reply_count: 0,
      }),
    ]);
    await expect(
      createIssueMessage(db, {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        projectId,
        runId,
        parentMessageId: replyId,
        authorUserId: "owner",
        authorAgentProvider: null,
        body: "Nested replies are not supported.",
        createdAt: atMinute(29),
      }),
    ).resolves.toBeNull();
  });

  it("completes a local workflow without staging or production", async () => {
    const common = { sourceKey: "local-only-run" };
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 30, common),
    );
    await recordHuntEvent(db, projectId, event("analyzing", 31, common));
    await recordHuntEvent(db, projectId, event("implementing", 32, common));
    await recordHuntEvent(
      db,
      projectId,
      event("implementing", 33, {
        ...common,
        status: "running",
        workflowStage: "local_qa",
      }),
    );
    for (const [stage, type, minute] of [
      ["analyzing", "velen", 33.1],
      ["analyzing", "repository", 33.2],
      ["implementing", "diff", 33.3],
      ["local_qa", "test", 33.4],
    ] as const) {
      await recordRunEvidence(db, projectId, {
        runId,
        evidenceKey: `${stage}:${type}`,
        stage,
        type,
        status: "passed",
        detail: `${type} verified`,
        command: type === "test" ? "bun run test" : null,
        url: null,
        metadata: null,
        actor: "vitest",
        observedAt: atMinute(minute),
      });
    }
    await recordHuntEvent(
      db,
      projectId,
      event("completed", 34, {
        ...common,
        resultSummary: "Local checks passed",
      }),
    );
    const run = await getHuntRunForProject(db, projectId, runId);
    expect(run).toEqual(
      expect.objectContaining({
        status: "completed",
        workflow_stage: "local_qa",
        production_qa_status: null,
      }),
    );
  });

  it("stores issue attachment metadata scoped to its project and run", async () => {
    const run = await getNextQueuedHuntRun(db, projectId);
    expect(run).not.toBeNull();
    const attachmentId = "66666666-6666-4666-8666-666666666666";
    await createIssueAttachments(db, projectId, run!.id, [
      {
        id: attachmentId,
        object_key: `issue-attachments/${projectId}/${run!.id}/${attachmentId}`,
        filename: "screen.png",
        content_type: "image/png",
        byte_size: 2048,
      },
    ]);

    expect(await listIssueAttachments(db, projectId, run!.id)).toEqual([
      expect.objectContaining({
        id: attachmentId,
        run_id: run!.id,
        project_id: projectId,
        filename: "screen.png",
        content_type: "image/png",
        byte_size: 2048,
      }),
    ]);
    expect(
      await getIssueAttachment(db, projectId, run!.id, attachmentId),
    ).toEqual(
      expect.objectContaining({
        object_key: expect.stringContaining(attachmentId),
      }),
    );
    expect(
      await getIssueAttachment(
        db,
        "99999999-9999-4999-8999-999999999999",
        run!.id,
        attachmentId,
      ),
    ).toBeNull();
  });

  it("returns the highest-priority oldest queued run", async () => {
    await recordHuntEvent(
      db,
      projectId,
      event("queued", 20, {
        sourceKey: "backlog-issue",
        eventKey: "backlog-issue:backlog:intake",
        title: "Backlog issue",
        status: "backlog",
        priority: 1,
        branch: null,
        commitSha: null,
      }),
    );
    const urgentId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 21, {
        sourceKey: "briar-issue:33333333-3333-4333-8333-333333333333",
        eventKey:
          "briar-issue:33333333-3333-4333-8333-333333333333:queued:intake",
        title: "Urgent queued issue",
        priority: 1,
        branch: null,
        commitSha: null,
      }),
    );

    const next = await getNextQueuedHuntRun(db, projectId);

    expect(next?.id).toBe(urgentId);
    expect(next?.title).toBe("Urgent queued issue");
    expect(next?.stage).toBe("queued");
    expect(next?.source_key).not.toBe("backlog-issue");
  });

  it("claims queued runs atomically and safely reassigns expired leases", async () => {
    const firstHash = "a".repeat(64);
    const secondHash = "b".repeat(64);
    const replacementHash = "c".repeat(64);
    await expect(
      assertQueuedHuntClaim(
        db,
        projectId,
        {
          source: "issue",
          sourceKey: "briar-issue:22222222-2222-4222-8222-222222222222",
        },
        null,
        atMinute(21),
      ),
    ).rejects.toBeInstanceOf(HuntClaimError);

    const [first, second] = await Promise.all([
      claimNextQueuedHuntRun(db, projectId, {
        claimTokenHash: firstHash,
        claimedBy: "agent-one",
        claimedAt: atMinute(22),
        leaseExpiresAt: atMinute(32),
      }),
      claimNextQueuedHuntRun(db, projectId, {
        claimTokenHash: secondHash,
        claimedBy: "agent-two",
        claimedAt: atMinute(22),
        leaseExpiresAt: atMinute(32),
      }),
    ]);

    expect(new Set([first?.title, second?.title])).toEqual(
      new Set(["Urgent queued issue", "App-created issue"]),
    );
    expect(second?.id).not.toBe(first?.id);

    const replacement = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: replacementHash,
      claimedBy: "agent-three",
      claimedAt: atMinute(40),
      leaseExpiresAt: atMinute(50),
    });
    expect(replacement?.title).toBe("Urgent queued issue");
    expect(replacement?.claim_attempts).toBe(2);

    await expect(
      assertQueuedHuntClaim(
        db,
        projectId,
        { source: "issue", sourceKey: replacement!.source_key },
        firstHash,
        atMinute(41),
      ),
    ).rejects.toBeInstanceOf(HuntClaimError);
    await expect(
      assertQueuedHuntClaim(
        db,
        projectId,
        { source: "issue", sourceKey: replacement!.source_key },
        replacementHash,
        atMinute(41),
      ),
    ).resolves.toBeUndefined();
  });

  it("retries failed runs as a new attempt while preserving prior evidence", async () => {
    const sourceKey = "recovery-run";
    const sharedAnalyzingKey = "recovery:analyzing:stable";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 51, { sourceKey, eventKey: "recovery:queued:1" }),
    );
    await recordHuntEvent(
      db,
      projectId,
      event("analyzing", 52, { sourceKey, eventKey: sharedAnalyzingKey }),
    );
    await recordHuntEvent(
      db,
      projectId,
      event("failed", 53, { sourceKey, eventKey: "recovery:failed:1" }),
    );

    const requestId = "44444444-4444-4444-8444-444444444444";
    expect(
      await recoverHuntRun(db, projectId, {
        runId,
        action: "retry",
        requestId,
        actor: "vitest",
        reason: "Retry after a transient failure",
        occurredAt: atMinute(54),
      }),
    ).toEqual({ outcome: "retried", attempt: 2, stage: "queued" });
    expect(
      await recoverHuntRun(db, projectId, {
        runId,
        action: "retry",
        requestId,
        actor: "vitest",
        reason: "Retry after a transient failure",
        occurredAt: atMinute(54),
      }),
    ).toEqual({ outcome: "already_retried", attempt: 2, stage: "queued" });

    await expect(
      recordHuntEvent(
        db,
        projectId,
        event("analyzing", 55, {
          sourceKey,
          eventKey: sharedAnalyzingKey,
          detail: "Second attempt analysis",
        }),
      ),
    ).resolves.toBe(runId);

    const run = await db
      .prepare(
        `select stage, current_attempt, branch, commit_sha, completed_at
         from briar_hunt_runs where id = ?`,
      )
      .bind(runId)
      .first<{
        stage: string;
        current_attempt: number;
        branch: string | null;
        commit_sha: string | null;
        completed_at: string | null;
      }>();
    expect(run).toEqual({
      stage: "analyzing",
      current_attempt: 2,
      branch: "codex/integration",
      commit_sha: "abcdef1",
      completed_at: null,
    });
    const events = await db
      .prepare(
        `select attempt, stage from briar_hunt_events
         where run_id = ? order by occurred_at`,
      )
      .bind(runId)
      .all<{ attempt: number; stage: string }>();
    expect(events.results).toEqual([
      { attempt: 1, stage: "queued" },
      { attempt: 1, stage: "analyzing" },
      { attempt: 1, stage: "failed" },
      { attempt: 2, stage: "queued" },
      { attempt: 2, stage: "analyzing" },
    ]);
  });

  it("cancels blocked runs idempotently without deleting evidence", async () => {
    const sourceKey = "cancel-run";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 60, { sourceKey, eventKey: "cancel:queued" }),
    );
    await recordHuntEvent(
      db,
      projectId,
      event("blocked", 61, { sourceKey, eventKey: "cancel:blocked" }),
    );
    const input = {
      runId,
      action: "cancel" as const,
      requestId: "55555555-5555-4555-8555-555555555555",
      actor: "vitest",
      reason: null,
      occurredAt: atMinute(62),
    };
    expect(await recoverHuntRun(db, projectId, input)).toEqual({
      outcome: "cancelled",
      attempt: 1,
      stage: "cancelled",
    });
    expect(await recoverHuntRun(db, projectId, input)).toEqual({
      outcome: "already_cancelled",
      attempt: 1,
      stage: "cancelled",
    });
    expect(
      await db
        .prepare(
          "select count(*) as count from briar_hunt_events where run_id = ?",
        )
        .bind(runId)
        .first<number>("count"),
    ).toBe(3);
  });

  it("moves a run freely across workflow and terminal states with an audit trail", async () => {
    const sourceKey = "manual-move-run";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 70, { sourceKey, eventKey: "move:queued" }),
    );
    await recordHuntEvent(
      db,
      projectId,
      event("analyzing", 71, { sourceKey, eventKey: "move:analyzing" }),
    );
    await recordHuntEvent(
      db,
      projectId,
      event("implementing", 72, { sourceKey, eventKey: "move:implementing" }),
    );
    await db
      .prepare(
        `update briar_hunt_runs
         set claim_token_hash = ?, claimed_by = 'vitest-agent',
             claimed_at = ?, lease_expires_at = ?
         where id = ?`,
      )
      .bind("a".repeat(64), atMinute(72), atMinute(90), runId)
      .run();

    const regressInput = {
      runId,
      status: "running" as const,
      workflowStage: "analyzing",
      requestId: "66666666-6666-4666-8666-666666666666",
      actor: "briar-app:test-user",
      occurredAt: atMinute(73),
    };
    expect(await moveHuntRun(db, projectId, regressInput)).toEqual({
      outcome: "moved",
      status: "running",
      workflowStage: "analyzing",
    });
    expect(await moveHuntRun(db, projectId, regressInput)).toEqual({
      outcome: "already_moved",
      status: "running",
      workflowStage: "analyzing",
    });

    const regressed = await db
      .prepare(
        `select status, workflow_stage, current_attempt, branch, commit_sha,
                claim_token_hash, claimed_by, lease_expires_at
         from briar_hunt_runs where id = ?`,
      )
      .bind(runId)
      .first<{
        status: string;
        workflow_stage: string | null;
        current_attempt: number;
        branch: string | null;
        commit_sha: string | null;
        claim_token_hash: string | null;
        claimed_by: string | null;
        lease_expires_at: string | null;
      }>();
    expect(regressed).toEqual({
      status: "running",
      workflow_stage: "analyzing",
      current_attempt: 1,
      branch: "codex/integration",
      commit_sha: "abcdef1",
      claim_token_hash: null,
      claimed_by: null,
      lease_expires_at: null,
    });
    await expect(
      assertQueuedHuntClaim(
        db,
        projectId,
        { source: "issue", sourceKey },
        "a".repeat(64),
        atMinute(74),
      ),
    ).rejects.toBeInstanceOf(HuntClaimError);

    expect(
      await moveHuntRun(db, projectId, {
        ...regressInput,
        status: "completed",
        workflowStage: null,
        requestId: "77777777-7777-4777-8777-777777777777",
        occurredAt: atMinute(74),
      }),
    ).toEqual({
      outcome: "moved",
      status: "completed",
      workflowStage: "analyzing",
    });
    expect(
      await moveHuntRun(db, projectId, {
        ...regressInput,
        status: "queued",
        workflowStage: null,
        requestId: "88888888-8888-4888-8888-888888888888",
        occurredAt: atMinute(75),
      }),
    ).toEqual({
      outcome: "moved",
      status: "queued",
      workflowStage: null,
    });

    const requeued = await db
      .prepare(
        `select current_attempt, workflow_stage, branch, commit_sha
         from briar_hunt_runs where id = ?`,
      )
      .bind(runId)
      .first<{
        current_attempt: number;
        workflow_stage: string | null;
        branch: string | null;
        commit_sha: string | null;
      }>();
    expect(requeued).toEqual({
      current_attempt: 2,
      workflow_stage: null,
      branch: "codex/integration",
      commit_sha: "abcdef1",
    });

    const events = await db
      .prepare(
        `select status, workflow_stage, actor
         from briar_hunt_events
         where run_id = ? and event_key like 'admin:move:%'
         order by occurred_at`,
      )
      .bind(runId)
      .all<{
        status: string;
        workflow_stage: string | null;
        actor: string;
      }>();
    expect(events.results).toEqual([
      {
        status: "running",
        workflow_stage: "analyzing",
        actor: "briar-app:test-user",
      },
      {
        status: "completed",
        workflow_stage: "analyzing",
        actor: "briar-app:test-user",
      },
      {
        status: "queued",
        workflow_stage: null,
        actor: "briar-app:test-user",
      },
    ]);
  });

  it("rejects a manual running state outside the run workflow", async () => {
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 80, {
        sourceKey: "manual-invalid-stage",
        eventKey: "move-invalid:queued",
      }),
    );
    await expect(
      moveHuntRun(db, projectId, {
        runId,
        status: "running",
        workflowStage: "not_configured",
        requestId: "99999999-9999-4999-8999-999999999999",
        actor: "briar-app:test-user",
        occurredAt: atMinute(81),
      }),
    ).rejects.toBeInstanceOf(HuntTransitionError);
  });
});
