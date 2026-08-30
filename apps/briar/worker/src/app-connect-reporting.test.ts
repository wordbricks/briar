import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { RunStatus } from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  ProjectUsagePeriod,
  ReportingService,
} from "@briar/contracts/gen/briar/app/v1/reporting_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import worker from "./index";
import {
  createIsolatedTestDatabase,
  type IsolatedTestDatabase,
} from "./test-helpers/d1";

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const hiddenProjectId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const hiddenRunId = "55555555-5555-4555-8555-555555555555";
const ownerId = "reporting-owner";
const developerId = "reporting-developer";
const outsiderId = "reporting-outsider";
const observedAt = "2026-08-15T12:00:00.000Z";
const tokens = {
  developer: "reporting-developer-token",
  outsider: "reporting-outsider-token",
} as const;

describe("ReportingService", () => {
  let database: IsolatedTestDatabase;
  let db: D1Database;
  const workflowStage = {
    id: "implementing",
    label: "Implement",
    required: true,
  } as const;
  const workflow = {
    version: 2,
    requirements: [],
    stages: [workflowStage],
    completion: { requiredStages: [workflowStage.id] },
    execution: { checkpoints: [] },
  } as const;

  beforeAll(async () => {
    database = await createIsolatedTestDatabase({
      suite: "app-connect-reporting",
    });
    db = database.db;
    await db.batch([
      ...[
        [ownerId, "Owner", "reporting-owner@example.com"],
        [developerId, "Developer", "reporting-developer@example.com"],
        [outsiderId, "Outsider", "reporting-outsider@example.com"],
      ].map(([id, name, email]) =>
        db.prepare(
          `insert into "user" (
             id, name, email, emailVerified, createdAt, updatedAt
           ) values (?, ?, ?, 1, ?, ?)`,
        ).bind(id, name, email, observedAt, observedAt)
      ),
      db.prepare(
        `insert into "session" (
           id, expiresAt, token, createdAt, updatedAt, userId
         ) values (
           'reporting-developer-session', '2099-01-01T00:00:00.000Z',
           ?, ?, ?, ?
         )`,
      ).bind(tokens.developer, observedAt, observedAt, developerId),
      db.prepare(
        `insert into "session" (
           id, expiresAt, token, createdAt, updatedAt, userId
         ) values (
           'reporting-outsider-session', '2099-01-01T00:00:00.000Z',
           ?, ?, ?, ?
         )`,
      ).bind(tokens.outsider, observedAt, observedAt, outsiderId),
      db.prepare(
        `insert into briar_organizations (
           id, name, handle, created_at, updated_at
         ) values (?, 'Reporting', 'reporting', ?, ?)`,
      ).bind(organizationId, observedAt, observedAt),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(organizationId, ownerId, observedAt, observedAt),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'developer', ?, ?)`,
      ).bind(organizationId, developerId, observedAt, observedAt),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Visible Project', ?, ?, ?)`,
      ).bind(
        projectId,
        ownerId,
        organizationId,
        "a".repeat(64),
        observedAt,
        observedAt,
      ),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Hidden Project', ?, ?, ?)`,
      ).bind(
        hiddenProjectId,
        ownerId,
        organizationId,
        "b".repeat(64),
        observedAt,
        observedAt,
      ),
      db.prepare(
        `insert into briar_project_members (
           project_id, organization_id, user_id, created_at, updated_at
         ) values (?, ?, ?, ?, ?)`,
      ).bind(
        projectId,
        organizationId,
        developerId,
        observedAt,
        observedAt,
      ),
    ]);
    const runInsert = `insert into briar_hunt_runs (
      id, project_id, source, source_key, title, stage, status,
      workflow_stage, workflow_snapshot_json, repository,
      requested_agent_provider, requested_agent_model,
      execution_metrics_json, started_at, last_event_at, created_at, updated_at
    ) values (?, ?, 'issue', ?, ?, 'implementing', 'running', ?, ?,
      'briar/reporting', 'codex', 'gpt-5.6-sol', ?, ?, ?, ?, ?)`;
    await db.batch([
      db.prepare(runInsert).bind(
        runId,
        projectId,
        "visible-reporting-run",
        "Visible reporting run",
        workflowStage.id,
        JSON.stringify(workflow),
        JSON.stringify({
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 20,
          cacheWriteTokens: 2,
          reasoningOutputTokens: null,
          totalTokens: 37,
          durationMs: 1_000,
        }),
        observedAt,
        observedAt,
        observedAt,
        observedAt,
      ),
      db.prepare(runInsert).bind(
        hiddenRunId,
        hiddenProjectId,
        "hidden-reporting-run",
        "Hidden reporting run",
        workflowStage.id,
        JSON.stringify(workflow),
        null,
        observedAt,
        observedAt,
        observedAt,
        observedAt,
      ),
    ]);
  }, 60_000);

  afterAll(async () => database.dispose());

  const client = (token: string) => createClient(
    ReportingService,
    createConnectTransport({
      baseUrl: "https://briar.example",
      fetch: async (input, init) =>
        worker.fetch(new Request(input, init), {
          DB: db,
          ATTACHMENTS: {},
          ARCHIVES: {},
          BETTER_AUTH_SECRET: "briar-test-secret-that-is-at-least-32-characters",
          GOOGLE_CLIENT_ID: "google-client",
          GOOGLE_CLIENT_SECRET: "google-secret",
        } as never),
    }),
  );

  const options = (token: string) => ({
    headers: { authorization: `Bearer ${token}` },
  });

  const errorCode = async (operation: Promise<unknown>) => {
    const error = await operation.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConnectError);
    return (error as ConnectError).code;
  };

  it("reports only project-scoped status and usage through generated messages", async () => {
    const reporting = client(tokens.developer);
    const status = await reporting.listStatusTrayRuns(
      { organizationId },
      options(tokens.developer),
    );
    expect(status.runs).toEqual([
      expect.objectContaining({
        id: runId,
        projectId,
        status: RunStatus.RUNNING,
        workflowStage: workflowStage.id,
        workflowStageLabel: workflowStage.label,
      }),
    ]);

    const summary = await reporting.getProjectUsageSummary(
      {
        projectId,
        period: ProjectUsagePeriod.DAY,
        fromDate: "2026-08-15",
        toDate: "2026-08-15",
      },
      options(tokens.developer),
    );
    expect(summary).toMatchObject({
      period: ProjectUsagePeriod.DAY,
      totalTokens: 37n,
      trackedDurationMs: 1_000n,
      observedRuns: 1,
      reportedRuns: 1,
    });
    expect(summary.timeline).toEqual([
      expect.objectContaining({ totalTokens: 37n }),
    ]);
    expect(await errorCode(reporting.getProjectUsageSummary(
      { projectId: hiddenProjectId, period: ProjectUsagePeriod.DAY },
      options(tokens.developer),
    ))).toBe(Code.NotFound);
  });

  it("rejects invalid date invariants and missing organization capability", async () => {
    const reporting = client(tokens.developer);
    expect(await errorCode(reporting.getProjectUsageSummary(
      {
        projectId,
        period: ProjectUsagePeriod.DAY,
        fromDate: "2026-08-15",
      },
      options(tokens.developer),
    ))).toBe(Code.InvalidArgument);
    expect(await errorCode(reporting.getProjectUsageSummary(
      {
        projectId,
        period: ProjectUsagePeriod.DAY,
        fromDate: "2026-02-30",
        toDate: "2026-02-30",
      },
      options(tokens.developer),
    ))).toBe(Code.InvalidArgument);
    expect(await errorCode(reporting.getProjectUsageSummary(
      {
        projectId,
        period: ProjectUsagePeriod.DAY,
        fromDate: "2025-01-01",
        toDate: "2026-08-31",
      },
      options(tokens.developer),
    ))).toBe(Code.InvalidArgument);
    expect(await errorCode(client(tokens.outsider).listStatusTrayRuns(
      { organizationId },
      options(tokens.outsider),
    ))).toBe(Code.NotFound);
  });
});
