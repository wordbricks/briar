import { createHash } from "node:crypto";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  DashboardWorker_Readiness,
} from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import { ExecutionWorkerHandoffState } from "@briar/contracts/gen/briar/app/v1/fleet_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import {
  WorkerControlService,
  WorkerReadinessState,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentProviderCapabilityCatalog } from "../../src/lib/agent-provider-contract";
import {
  claimNextIssueAgentReply,
  claimNextQueuedHuntRun,
  createIssueDependency,
  createIssueMessage,
  enqueueIssueAgentReply,
  failIssueAgentReply,
  listIssueThreadMessages,
  listOrganizationUsageExecutionAttempts,
  listOrganizationUsageCostRecords,
  listOrganizationUsageRecords,
  listOrganizationUsageRuns,
  recordHuntEvent,
  recordRunCostRecords,
  transferIssue,
  updateHuntRunExecutionMetrics,
  type HuntEventInput,
} from "./db";
import apiWorker from "./index";
import { executeD1Sql } from "./test-helpers/d1";
import { workerRuntimeFixture } from "./test-helpers/worker-runtime";
import {
  workerRuntimeMetadataFromProto,
  workerRuntimeMetadataFromStoredProtoJson,
} from "./worker-runtime-mappers";
import {
  latestExecutionWorkerUpdateHandoff,
  pendingExecutionWorkerUpdate,
} from "./worker-update-repository";
import {
  authenticateExecutionWorker,
  bindExecutionWorkerProject,
  channelReplyWorkerAvailability,
  countExecutionWorkerDeviceSessions,
  completeExecutionWorkerUpdates,
  countLeasedRuns,
  deleteExecutionWorker,
  disableExecutionWorker,
  dispatchHuntRun,
  executionWorkerBindingForProject,
  failExecutionWorkerUpdateHandoff,
  getProjectExecutionWorkerPolicy,
  handoffExecutionWorkerClaim,
  hasAvailableChannelReplyWorker,
  hasExecutionWorkerReadinessChanged,
  leaseExpiryFrom,
  listExecutionWorkers,
  listOrganizationExecutionProviders,
  listOrganizationExecutionWorkers,
  MAX_CLAIM_ATTEMPTS,
  reapStalledHuntRuns,
  recordWorkerHeartbeat,
  registerExecutionWorker,
  projectExecutionWorkerCapabilityCatalog,
  requestExecutionWorkerUpdate,
  renewHuntRunLease,
  unbindExecutionWorker,
  updateExecutionWorkerConcurrency,
  updateExecutionWorkerLabel,
  updateProjectExecutionWorkerPolicy,
  WorkerConflictError,
  workerStateAt,
  WORKER_CREDENTIAL_TOUCH_INTERVAL_MS,
} from "./workers";

const projectId = "11111111-1111-4111-8111-111111111111";
const secondProjectId = "22222222-2222-4222-8222-222222222222";
const baseTime = Date.parse("2026-07-25T00:00:00Z");
const atMinute = (minute: number) =>
  new Date(baseTime + minute * 60_000).toISOString();
const fingerprint = (seed: string) =>
  seed
    .split("")
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .padEnd(64, "0");

const workerControlClient = (env: Env, credential: string) => ({
  client: createClient(
    WorkerControlService,
    createConnectTransport({
      baseUrl: "https://briar-api.example",
      fetch: (input, init) =>
        apiWorker.fetch(
          new Request(input, { ...init, redirect: "manual" }),
          env,
        ),
    }),
  ),
  options: { headers: { authorization: `Bearer ${credential}` } },
});

const workerRuntime = (version = "1.2.95") => {
  const runtime = workerRuntimeFixture();
  runtime.versions.briar = version;
  return runtime;
};

const instrumentD1 = (database: D1Database) => {
  const cost = { rowsRead: 0, rowsWritten: 0 };
  const statements = new WeakMap<object, D1PreparedStatement>();
  const record = <T>(result: D1Result<T>) => {
    cost.rowsRead += result.meta.rows_read;
    cost.rowsWritten += result.meta.rows_written;
    return result;
  };
  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement(target.bind(...values));
        }
        if (property === "first") {
          return async (column?: string) => {
            const result = record(await target.all<Record<string, unknown>>());
            const first = result.results[0] ?? null;
            return column && first ? first[column] ?? null : first;
          };
        }
        if (property === "all" || property === "run") {
          return async () => record(await target[property]());
        }
        if (property === "raw") return target.raw.bind(target);
        return undefined;
      },
    });
    statements.set(wrapped, statement);
    return wrapped;
  };
  const tracked = new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => wrapStatement(target.prepare(query));
      }
      if (property === "batch") {
        return async <T>(batch: D1PreparedStatement[]) => {
          const results = await target.batch<T>(
            batch.map((statement) => statements.get(statement) ?? statement),
          );
          return results.map(record);
        };
      }
      if (property === "exec") return target.exec.bind(target);
      if (property === "withSession") return target.withSession.bind(target);
      if (property === "dump") return target.dump.bind(target);
      return undefined;
    },
  });
  return { database: tracked, cost };
};

const queuedEvent = (sourceKey: string, minute: number): HuntEventInput => ({
  source: "issue",
  sourceKey,
  title: `Queued ${sourceKey}`,
  stage: "queued",
  eventKey: `${sourceKey}:queued`,
  occurredAt: atMinute(minute),
  actor: "vitest",
  repository: "example/repository",
  detail: null,
  priority: null,
  branch: null,
  commitSha: null,
  tracker: null,
  issueDescription: null,
  resultSummary: null,
  structuredResult: null,
  pullRequestUrls: [],
  targetSha: null,
  sourceCreatedAt: atMinute(minute),
  qaStatus: null,
  stagingQaDetail: null,
  productionQaDetail: null,
  context: null,
});

describe("detached execution workers", () => {
  const db = cloudflareEnv.DB;
  const archives = cloudflareEnv.ARCHIVES;

  beforeAll(async () => {
    await executeD1Sql(
      db,
      `drop trigger briar_issue_execution_org_member_remove_invalidate;`,
    );
    await executeD1Sql(
      db,
      `
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('owner', 'Owner', 'owner@example.com', 1, '${atMinute(0)}', '${atMinute(0)}');
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('member', 'Member', 'member@example.com', 1, '${atMinute(0)}', '${atMinute(0)}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('${projectId}', 'Example Org', 'example-org', '${atMinute(0)}', '${atMinute(0)}');
      insert into briar_organization_members (organization_id, user_id, role, created_at, updated_at)
      values ('${projectId}', 'owner', 'owner', '${atMinute(0)}', '${atMinute(0)}');
      insert into briar_organization_members (organization_id, user_id, role, created_at, updated_at)
      values ('${projectId}', 'member', 'developer', '${atMinute(0)}', '${atMinute(0)}');
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash, created_at, updated_at
      ) values (
        '${projectId}', 'owner', '${projectId}', 'Example',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash, created_at, updated_at
      ) values (
        '${secondProjectId}', 'owner', '${projectId}', 'Second',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_project_settings (
        project_id, velen_org, linear_enabled, workflow_json,
        mandatory_checkpoints_json, created_at, updated_at
      ) values (
        '${projectId}', 'example', 0,
        '{"version":2,"requirements":[],"stages":[{"id":"analyzing","label":"분석","required":true},{"id":"implementing","label":"구현","required":true}],"execution":{"checkpoints":[]},"completion":{"requiredStages":["analyzing","implementing"]}}',
        '[]', '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_project_settings (
        project_id, velen_org, linear_enabled, workflow_json,
        mandatory_checkpoints_json, created_at, updated_at
      ) values (
        '${secondProjectId}', 'example', 0,
        '{"version":2,"requirements":[],"stages":[{"id":"analyzing","label":"분석","required":true},{"id":"implementing","label":"구현","required":true}],"execution":{"checkpoints":[]},"completion":{"requiredStages":["analyzing","implementing"]}}',
        '[]', '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_project_agents (
        id, project_id, organization_id, name, provider, model, responsibility,
        skill_markdown, created_at, updated_at
      ) values (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${projectId}', '${projectId}',
        'Codex Agent', 'codex', null, 'Perform the assigned issue.',
        '# Codex Agent', '${atMinute(0)}', '${atMinute(0)}'
      );
    `,
    );
  }, 30_000);

  beforeEach(async () => {
    await executeD1Sql(
      db,
      `delete from briar_agent_transcripts;
       delete from briar_agent_transcript_sessions;
       delete from briar_hunt_events;
       delete from briar_hunt_runs;
       delete from briar_channel_agent_reply_jobs;
       delete from briar_channel_reply_session_events;
       delete from briar_channel_reply_sessions;
       delete from briar_project_execution_worker_allowlist;
       delete from briar_project_execution_worker_policies;
       delete from briar_execution_worker_update_requests;
       delete from briar_execution_worker_update_handoffs;
       delete from briar_execution_worker_credentials;
       delete from briar_execution_audit_events;
       delete from briar_execution_worker_lifecycle_events;
       delete from briar_project_agent_task_jobs;
       delete from briar_execution_workers;
       delete from briar_execution_worker_devices;
       insert into briar_organization_members (
         organization_id, user_id, role, created_at, updated_at
       ) values (
         '${projectId}', 'member', 'developer', '${atMinute(0)}', '${atMinute(0)}'
       ) on conflict (organization_id, user_id) do update set role = 'developer';`,
    );
  });

  const providerCapabilities = {
    codex: {
      models: [
        {
          id: "gpt-5.6-sol",
          label: "GPT-5.6 Sol",
          efforts: [
            { id: "high", label: "high" },
            { id: "xhigh", label: "xhigh" },
          ],
        },
      ],
      defaultEfforts: [],
      allowCustomModels: false,
      error: null,
    },
    claude: {
      models: [
        {
          id: "claude-sonnet-4-0",
          label: "Claude Sonnet 4",
          efforts: [{ id: "medium", label: "medium" }],
        },
      ],
      defaultEfforts: [],
      allowCustomModels: true,
      error: null,
    },
    cursor: {
      models: [],
      defaultEfforts: [],
      allowCustomModels: true,
      error: null,
    },
    grok: {
      models: [
        {
          id: "grok-4.6",
          label: "Grok 4.6",
          efforts: [
            { id: "high", label: "high" },
            { id: "xhigh", label: "xhigh" },
          ],
        },
      ],
      defaultEfforts: [],
      allowCustomModels: false,
      error: null,
    },
    agy: {
      models: [],
      defaultEfforts: [],
      allowCustomModels: false,
      error: null,
    },
    opencode: {
      models: [],
      defaultEfforts: [],
      allowCustomModels: true,
      error: null,
    },
    openrouter: {
      models: [],
      defaultEfforts: [],
      allowCustomModels: true,
      error: null,
    },
  } satisfies AgentProviderCapabilityCatalog;

  const runtimeMetadata = (
    input: Parameters<typeof workerRuntimeFixture>[0] = {},
    version = "1.1.1"
  ) => {
    const runtime = workerRuntimeFixture({ providerCapabilities, ...input });
    runtime.versions.briar = version;
    return workerRuntimeMetadataFromProto(runtime);
  };

  const register = (
    seed: string,
    minute = 1,
    credentialTokenHash = fingerprint(`token-${seed}`),
  ) =>
    registerExecutionWorker(db, projectId, {
      id: `worker-${seed}`,
      deviceId: `device-${seed}`,
      organizationId: projectId,
      ownerUserId: "owner",
      label: `worker ${seed}`,
      deviceIdentityHash: fingerprint(seed),
      credentialTokenHash,
      runtime: runtimeMetadata(),
      observedAt: atMinute(minute),
    });

  it("detects only persisted Worker readiness transitions", () => {
    const ready = {
      accepting_work: 1,
      readiness_state: "ready" as const,
      readiness_detail: null,
    };

    expect(hasExecutionWorkerReadinessChanged(ready, { ...ready })).toBe(false);
    expect(
      hasExecutionWorkerReadinessChanged(ready, {
        ...ready,
        accepting_work: 0,
      }),
    ).toBe(true);
    expect(
      hasExecutionWorkerReadinessChanged(ready, {
        ...ready,
        readiness_state: "busy",
      }),
    ).toBe(true);
    expect(
      hasExecutionWorkerReadinessChanged(ready, {
        ...ready,
        readiness_detail: "Checking repository",
      }),
    ).toBe(true);
    expect(
      hasExecutionWorkerReadinessChanged(
        { ...ready, readiness_detail: "Checking repository" },
        ready,
      ),
    ).toBe(true);
  });

  it("audits heartbeat readiness only when its persisted values transition", async () => {
    const credential = "briar_worker_readiness-audit-test";
    const registered = await register(
      "readiness-audit",
      1,
      createHash("sha256").update(credential).digest("hex"),
    );
    const env = {
      DB: db,
      ARCHIVES: archives,
      BETTER_AUTH_SECRET: "readiness-audit-test-secret-readiness-audit-test-secret",
      GOOGLE_CLIENT_ID: "google-client-test",
      GOOGLE_CLIENT_SECRET: "google-secret-test",
    } as unknown as Env;
    const control = workerControlClient(env, credential);
    let acceptingWork = true;
    let readinessState = WorkerReadinessState.READY;
    let readinessDetail: string | undefined;
    const heartbeat = async (
      body: Record<string, unknown>,
      routeDatabase: D1Database = db,
    ) => {
      if (typeof body.acceptingWork === "boolean") {
        acceptingWork = body.acceptingWork;
      }
      if (body.readinessState === "busy") {
        readinessState = WorkerReadinessState.BUSY;
      } else if (body.readinessState === "needs_attention") {
        readinessState = WorkerReadinessState.NEEDS_ATTENTION;
      } else if (body.readinessState === "ready") {
        readinessState = WorkerReadinessState.READY;
      }
      if ("readinessDetail" in body) {
        readinessDetail = typeof body.readinessDetail === "string"
          ? body.readinessDetail
          : undefined;
      }
      const routed = routeDatabase === db
        ? control
        : workerControlClient({ ...env, DB: routeDatabase }, credential);
      return await routed.client.heartbeatWorker({
        workerId: registered.worker.id,
        runtime: workerRuntime(
          typeof (body.versions as { briar?: unknown } | undefined)?.briar ===
              "string"
            ? (body.versions as { briar: string }).briar
            : undefined,
        ),
        refreshMaintenance: body.refreshMaintenance === true,
        acceptingWork,
        readinessState,
        readinessDetail,
      }, routed.options);
    };
    const auditCount = async () => {
      const row = await db
        .prepare(
          `select count(*) as count
           from briar_execution_audit_events
           where worker_id = ? and action = 'worker_readiness_changed'`,
        )
        .bind(registered.worker.id)
        .first<{ count: number }>();
      return row?.count ?? 0;
    };

    await heartbeat({
      versions: { briar: "1.2.95" },
    });
    expect(await auditCount()).toBe(0);

    await heartbeat({
      acceptingWork: true,
      readinessState: "ready",
      readinessDetail: null,
    });
    expect(await auditCount()).toBe(0);

    await heartbeat({ acceptingWork: false });
    expect(await auditCount()).toBe(1);

    await heartbeat({ readinessState: "busy" });
    expect(await auditCount()).toBe(2);

    await heartbeat({ readinessDetail: "Checking repository" });
    expect(await auditCount()).toBe(3);

    await heartbeat({ readinessDetail: null });
    expect(await auditCount()).toBe(4);

    await heartbeat({
      acceptingWork: false,
      readinessState: "busy",
      readinessDetail: null,
    });
    expect(await auditCount()).toBe(4);

    const events = await db
      .prepare(
        `select detail_json
         from briar_execution_audit_events
         where worker_id = ? and action = 'worker_readiness_changed'`,
      )
      .bind(registered.worker.id)
      .all<{ detail_json: string }>();
    expect(events.results.map((event) => JSON.parse(event.detail_json))).toEqual(
      expect.arrayContaining([
        {
          acceptingWork: false,
          readinessState: "ready",
          readinessDetail: null,
        },
        {
          acceptingWork: false,
          readinessState: "busy",
          readinessDetail: null,
        },
        {
          acceptingWork: false,
          readinessState: "busy",
          readinessDetail: "Checking repository",
        },
        {
          acceptingWork: false,
          readinessState: "busy",
          readinessDetail: null,
        },
      ]),
    );
    const lightweightCost = instrumentD1(db);
    const lightweight = await heartbeat(
      { refreshMaintenance: false },
      lightweightCost.database,
    );
    expect(lightweight.workflowRequirements).toEqual([]);
    const maintenanceCost = instrumentD1(db);
    const maintenance = await heartbeat(
      { refreshMaintenance: true },
      maintenanceCost.database,
    );
    expect(maintenance.workflowRequirements).toEqual([]);
    expect(lightweightCost.cost.rowsWritten).toBeGreaterThan(0);
    expect(maintenanceCost.cost.rowsWritten).toBe(
      lightweightCost.cost.rowsWritten,
    );
    expect(lightweightCost.cost.rowsRead).toBeLessThan(
      maintenanceCost.cost.rowsRead,
    );
    await expect(db.prepare(
      `select reason, operation, outcome, hard_delete_rows_written, detail_json
       from briar_execution_worker_lifecycle_events where worker_id = ?`,
    ).bind(registered.worker.id).first()).resolves.toMatchObject({
      reason: "restart",
      operation: "binding_preserved",
      outcome: "preserved",
      hard_delete_rows_written: 0,
      detail_json: expect.not.stringContaining(credential),
    });
  });

  it("keeps a remote update pending until the target Worker version reports", async () => {
    const worker = await register("update");
    const requested = await requestExecutionWorkerUpdate(db, {
      id: "77777777-7777-4777-8777-777777777777",
      organizationId: projectId,
      deviceId: worker.device.id,
      requestedByUserId: "owner",
      targetVersion: "1.2.84",
      requestedAt: atMinute(2),
    });

    expect(await pendingExecutionWorkerUpdate(db, worker.device.id)).toEqual(
      requested,
    );
    await recordWorkerHeartbeat(db, projectId, {
      workerId: worker.worker.id,
      runtime: runtimeMetadata({}, "1.2.69"),
      observedAt: atMinute(2),
    });
    const listed = await listOrganizationExecutionWorkers(
      db,
      projectId,
      atMinute(2),
    );
    expect(listed[0]).toMatchObject({
      versions: { briar: "1.2.69" },
      remoteUpdateSupported: true,
      updateRequest: requested,
    });
    await completeExecutionWorkerUpdates(
      db,
      worker.device.id,
      "1.2.83",
      atMinute(3),
    );
    expect(await pendingExecutionWorkerUpdate(db, worker.device.id)).toEqual(
      requested,
    );
    await completeExecutionWorkerUpdates(
      db,
      worker.device.id,
      "1.2.84",
      atMinute(4),
    );
    expect(await pendingExecutionWorkerUpdate(db, worker.device.id)).toBeNull();
    await expect(db.prepare(
      `select reason, operation, outcome, hard_delete_rows_written, detail_json
       from briar_execution_worker_lifecycle_events where request_id = ?`,
    ).bind(`worker-update:${requested.id}`).first()).resolves.toMatchObject({
      reason: "update",
      operation: "binding_preserved",
      outcome: "preserved",
      hard_delete_rows_written: 0,
      detail_json: expect.stringContaining('"bindingPreserved":true'),
    });
  });

  it("restores availability on the target-version heartbeat after update drain", async () => {
    const credential = "briar_worker_update-reconnect-test";
    const worker = await register(
      "update-reconnect",
      1,
      createHash("sha256").update(credential).digest("hex"),
    );
    await requestExecutionWorkerUpdate(db, {
      id: "77777777-7777-4777-8777-777777777776",
      organizationId: projectId,
      deviceId: worker.device.id,
      requestedByUserId: "owner",
      targetVersion: "2.0.0",
      requestedAt: atMinute(2),
    });
    const env = {
      DB: db,
      ARCHIVES: archives,
      BETTER_AUTH_SECRET: "update-reconnect-secret-update-reconnect-secret",
      GOOGLE_CLIENT_ID: "google-client-test",
      GOOGLE_CLIENT_SECRET: "google-secret-test",
    } as unknown as Env;
    const control = workerControlClient(env, credential);
    const response = await control.client.heartbeatWorker({
      workerId: worker.worker.id,
      runtime: workerRuntime("2.0.0"),
      acceptingWork: true,
      readinessState: WorkerReadinessState.READY,
    }, control.options);

    expect(response.updateDirective).toBeUndefined();
    expect(response.worker).toMatchObject({
      acceptingWork: true,
      readiness: DashboardWorker_Readiness.AVAILABLE,
    });
    expect(await pendingExecutionWorkerUpdate(db, worker.device.id)).toBeNull();
  });

  it("atomically fences multiple active runs and resumes them without retry attempts", async () => {
    const worker = await register("handoff", 1);
    await updateExecutionWorkerConcurrency(
      db,
      worker.device.id,
      2,
      atMinute(1),
    );
    const runIds = await Promise.all([
      recordHuntEvent(db, projectId, queuedEvent("handoff-one", 1)),
      recordHuntEvent(db, projectId, queuedEvent("handoff-two", 1)),
    ]);
    const oldTokens = [fingerprint("handoff-old-one"), fingerprint("handoff-old-two")];
    const claims = await Promise.all(
      runIds.map((runId, index) =>
        claimNextQueuedHuntRun(db, projectId, {
          runId,
          claimTokenHash: oldTokens[index],
          claimedBy: worker.worker.label,
          claimedAt: atMinute(2),
          leaseExpiresAt: leaseExpiryFrom(atMinute(2)),
          workerId: worker.worker.id,
          workerDeviceId: worker.device.id,
        }),
      ),
    );
    expect(claims.every(Boolean)).toBe(true);
    expect(await countExecutionWorkerDeviceSessions(db, worker.device.id, atMinute(3))).toBe(2);

    const request = await requestExecutionWorkerUpdate(db, {
      id: "77777777-7777-4777-8777-777777777778",
      organizationId: projectId,
      deviceId: worker.device.id,
      requestedByUserId: "owner",
      targetVersion: "2.0.0",
      requestedAt: atMinute(3),
    });
    const handoffs = await Promise.all(
      runIds.map((runId, index) =>
        handoffExecutionWorkerClaim(db, {
          requestId: request.id,
          organizationId: projectId,
          deviceId: worker.device.id,
          projectId,
          workerId: worker.worker.id,
          workType: "issue",
          workId: runId,
          runId,
          claimTokenHash: oldTokens[index],
          metadata: {
            conversationId: `conversation-${index}`,
            workspacePath: `/tmp/handoff-${index}`,
          },
          observedAt: atMinute(4),
        }),
      ),
    );
    expect(handoffs.map((handoff) => handoff.outcome)).toEqual([
      "handed_off",
      "handed_off",
    ]);
    expect(await countExecutionWorkerDeviceSessions(db, worker.device.id, atMinute(4))).toBe(0);

    const rows = await db
      .prepare(
        `select id, status, claim_token_hash, worker_id, claim_attempts,
                planned_update_resume
         from briar_hunt_runs where id in (?, ?)
         order by id`,
      )
      .bind(...runIds)
      .all<{
        id: string;
        status: string;
        claim_token_hash: string | null;
        worker_id: string | null;
        claim_attempts: number;
        planned_update_resume: number;
      }>();
    expect(rows.results).toEqual(
      expect.arrayContaining(
        runIds.map((id) => ({
          id,
          status: "queued",
          claim_token_hash: null,
          worker_id: null,
          claim_attempts: 1,
          planned_update_resume: 1,
        })),
      ),
    );
    expect(await latestExecutionWorkerUpdateHandoff(db, {
      deviceId: worker.device.id,
      workType: "issue",
      workId: runIds[0],
    })).toMatchObject({
      requestId: request.id,
      conversationId: "conversation-0",
      workspacePath: "/tmp/handoff-0",
    });
    for (const [index, runId] of runIds.entries()) {
      await expect(
        renewHuntRunLease(db, projectId, {
          runId,
          claimTokenHash: oldTokens[index],
          workerId: worker.worker.id,
          observedAt: atMinute(5),
        }),
      ).rejects.toBeInstanceOf(WorkerConflictError);
    }

    await recordWorkerHeartbeat(db, projectId, {
      workerId: worker.worker.id,
      runtime: runtimeMetadata({}, "2.0.0"),
      acceptingWork: true,
      readinessState: "ready",
      observedAt: atMinute(5),
    });
    await completeExecutionWorkerUpdates(db, worker.device.id, "2.0.0", atMinute(5));
    expect(await pendingExecutionWorkerUpdate(db, worker.device.id)).toBeNull();

    const resumed = await Promise.all(
      runIds.map((runId, index) =>
        claimNextQueuedHuntRun(db, projectId, {
          runId,
          claimTokenHash: fingerprint(`handoff-new-${index}`),
          claimedBy: worker.worker.label,
          claimedAt: atMinute(6),
          leaseExpiresAt: leaseExpiryFrom(atMinute(6)),
          workerId: worker.worker.id,
          workerDeviceId: worker.device.id,
        }),
      ),
    );
    expect(resumed.map((run) => run?.claim_attempts)).toEqual([1, 1]);
  });

  it("records a handoff failure while keeping the update visible for retry", async () => {
    const worker = await register("handoff-failed", 1);
    const request = await requestExecutionWorkerUpdate(db, {
      id: "77777777-7777-4777-8777-777777777779",
      organizationId: projectId,
      deviceId: worker.device.id,
      requestedByUserId: "owner",
      targetVersion: "2.0.0",
      requestedAt: atMinute(2),
    });
    const workId = "88888888-8888-4888-8888-888888888888";
    await failExecutionWorkerUpdateHandoff(db, {
      requestId: request.id,
      organizationId: projectId,
      deviceId: worker.device.id,
      projectId,
      workerId: worker.worker.id,
      workType: "issue",
      workId,
      runId: null,
      claimTokenHash: fingerprint("failed-handoff"),
      metadata: { workspacePath: "/tmp/failed-handoff" },
      error: "provider process did not stop",
      observedAt: atMinute(3),
    });

    expect(await pendingExecutionWorkerUpdate(db, worker.device.id)).toMatchObject({
      id: request.id,
      handoffState: "failed",
      handoffError: "provider process did not stop",
    });
    expect(await db.prepare(
      `select status, metadata_json from briar_execution_worker_update_handoffs
       where update_request_id = ? and work_id = ?`
    ).bind(request.id, workId).first()).toMatchObject({
      status: "failed",
    });
  });

  it("records a managed runtime installation failure for an explicit retry", async () => {
    const credential = "briar_worker_runtime-update-failed-test";
    const worker = await register(
      "runtime-update-failed",
      1,
      createHash("sha256").update(credential).digest("hex"),
    );
    const request = await requestExecutionWorkerUpdate(db, {
      id: "77777777-7777-4777-8777-777777777775",
      organizationId: projectId,
      deviceId: worker.device.id,
      requestedByUserId: "owner",
      targetVersion: "2.0.0",
      requestedAt: atMinute(2),
    });
    const env = {
      DB: db,
      ARCHIVES: archives,
      BETTER_AUTH_SECRET: "runtime-update-failed-secret-runtime-update-failed-secret",
      GOOGLE_CLIENT_ID: "google-client-test",
      GOOGLE_CLIENT_SECRET: "google-secret-test",
    } as unknown as Env;
    const control = workerControlClient(env, credential);
    await control.client.failWorkerUpdateHandoff(
      {
        workerId: worker.worker.id,
        requestId: request.id,
        error: "signed runtime failed its health check",
      },
      control.options,
    );

    expect(await pendingExecutionWorkerUpdate(db, worker.device.id)).toMatchObject({
      id: request.id,
      handoffState: "failed",
      handoffError: "signed runtime failed its health check",
    });
    const heartbeat = await control.client.heartbeatWorker({
      workerId: worker.worker.id,
      runtime: workerRuntime("1.0.0"),
      acceptingWork: true,
      readinessState: WorkerReadinessState.READY,
    }, control.options);
    expect(heartbeat).toMatchObject({
      updateDirective: {
        id: request.id,
        handoffState: ExecutionWorkerHandoffState.FAILED,
      },
      worker: {
        acceptingWork: false,
        readiness: DashboardWorker_Readiness.NEEDS_ATTENTION,
      },
    });
    expect((await listOrganizationExecutionWorkers(
      db,
      projectId,
      atMinute(3),
    ))[0]).toMatchObject({
      bindings: [{
        acceptingWork: false,
        readiness: "needs_attention",
      }],
    });
  });

  it("dispatches a queued issue to a selected Worker without an Agent", async () => {
    const selected = await register("agentless");
    const requestId = "99999999-aaaa-4999-8999-999999999999";
    const runId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("agentless-dispatch", 2),
    );

    await expect(
      dispatchHuntRun(db, projectId, projectId, {
        runId,
        provider: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
        workerId: selected.worker.id,
        requestedByUserId: "member",
        requestId,
        occurredAt: atMinute(2),
      }),
    ).resolves.toMatchObject({
      agentId: null,
      provider: "codex",
      requestedWorkerId: selected.worker.id,
      dispatchMode: "specific",
    });
    await expect(
      db.prepare(
        `select count(*) as count from briar_execution_audit_events
         where project_id = ? and action = 'dispatched' and request_id = ?`,
      ).bind(projectId, requestId).first<number>("count"),
    ).resolves.toBe(1);

    await expect(
      dispatchHuntRun(db, projectId, projectId, {
        runId,
        provider: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
        workerId: selected.worker.id,
        requestedByUserId: "member",
        requestId,
        occurredAt: atMinute(2),
        reassign: true,
      }),
    ).resolves.toMatchObject({ outcome: "already_dispatched" });
    await expect(
      db.prepare(
        `select count(*) as count from briar_execution_audit_events
         where project_id = ? and request_id = ?`,
      ).bind(projectId, requestId).first<number>("count"),
    ).resolves.toBe(1);

    const claimed = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: fingerprint("agentless-claim"),
      claimedBy: selected.worker.label,
      claimedAt: atMinute(3),
      leaseExpiresAt: leaseExpiryFrom(atMinute(3)),
      workerId: selected.worker.id,
      detachedOnly: true,
    });
    expect(claimed).toMatchObject({
      id: runId,
      agent_id: null,
      requested_agent_provider: "codex",
      requested_worker_id: selected.worker.id,
      worker_id: selected.worker.id,
    });
  });

  it("records execution metrics only for the assigned Worker attempt", async () => {
    const selected = await register("metrics");
    const runId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("worker-metrics", 2),
    );
    await dispatchHuntRun(db, projectId, projectId, {
      runId,
      provider: "codex",
      workerId: selected.worker.id,
      requestedByUserId: "member",
      requestId: "88888888-aaaa-4888-8888-888888888888",
      occurredAt: atMinute(2),
    });
    await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: fingerprint("metrics-claim"),
      claimedBy: selected.worker.label,
      claimedAt: atMinute(3),
      leaseExpiresAt: leaseExpiryFrom(atMinute(3)),
      workerId: selected.worker.id,
      detachedOnly: true,
    });
    const metrics = {
      inputTokens: 1_000,
      outputTokens: 250,
      cacheReadTokens: 800,
      cacheWriteTokens: null,
      reasoningOutputTokens: 100,
      totalTokens: 1_250,
      durationMs: 90_000,
    };

    await expect(
      updateHuntRunExecutionMetrics(db, projectId, {
        runId,
        attempt: 2,
        workerId: selected.worker.id,
        metrics,
      }),
    ).resolves.toBe(false);
    await expect(
      updateHuntRunExecutionMetrics(db, projectId, {
        runId,
        attempt: 1,
        workerId: selected.worker.id,
        metrics,
      }),
    ).resolves.toBe(true);
    const stored = await db
      .prepare(`select execution_metrics_json from briar_hunt_runs where id = ?`)
      .bind(runId)
      .first<{ execution_metrics_json: string }>();
    expect(JSON.parse(stored!.execution_metrics_json)).toEqual(metrics);
  });

  it("does not dispatch an issue until all prerequisites are completed", async () => {
    const selected = await register("dependency-aware");
    const prerequisiteRunId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("dispatch-prerequisite", 2),
    );
    const dependentRunId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("dispatch-dependent", 3),
    );
    await createIssueDependency(db, projectId, {
      prerequisiteRunId,
      dependentRunId,
      createdByUserId: "member",
      createdAt: atMinute(3),
    });

    const dispatch = () =>
      dispatchHuntRun(db, projectId, projectId, {
        runId: dependentRunId,
        provider: "codex",
        workerId: selected.worker.id,
        requestedByUserId: "member",
        requestId: "77777777-aaaa-4777-8777-777777777777",
        occurredAt: atMinute(4),
      });

    await expect(dispatch()).rejects.toThrow(
      "Run is waiting for prerequisite issues to complete",
    );

    await db
      .prepare(
        `update briar_hunt_runs
         set status = 'completed', stage = 'completed', completed_at = ?
         where id = ?`,
      )
      .bind(atMinute(5), prerequisiteRunId)
      .run();

    await expect(dispatch()).resolves.toMatchObject({
      runId: dependentRunId,
      requestedWorkerId: selected.worker.id,
    });
  });

  it("gives an issue mention to its previous worker before another worker", async () => {
    const previous = await register("previous", 1);
    const fallback = await register("fallback", 1);
    const runId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("mention-priority", 2),
    );
    await db
      .prepare(
        `update briar_hunt_runs
         set worker_id = ?, requested_agent_provider = 'codex'
         where id = ?`,
      )
      .bind(previous.worker.id, runId)
      .run();
    const triggerMessageId = "11111111-aaaa-4aaa-8aaa-111111111111";
    await createIssueMessage(db, {
      id: triggerMessageId,
      projectId,
      runId,
      parentMessageId: null,
      authorUserId: "owner",
      authorAgentProvider: null,
      body: "@Developer what changed?",
      createdAt: atMinute(3),
    });
    await enqueueIssueAgentReply(db, {
      id: "22222222-bbbb-4bbb-8bbb-222222222222",
      projectId,
      runId,
      triggerMessageId,
      parentMessageId: triggerMessageId,
      replyMessageId: "33333333-cccc-4ccc-8ccc-333333333333",
      createdAt: atMinute(3),
    });

    await expect(
      claimNextIssueAgentReply(db, projectId, {
        workerId: fallback.worker.id,
        agentProvider: "codex",
        claimTokenHash: fingerprint("fallback-claim"),
        claimedAt: atMinute(4),
        leaseExpiresAt: atMinute(19),
        staleBefore: atMinute(1),
      }),
    ).resolves.toBeNull();
    await expect(
      claimNextIssueAgentReply(db, projectId, {
        workerId: previous.worker.id,
        agentProvider: "codex",
        claimTokenHash: fingerprint("previous-claim"),
        claimedAt: atMinute(4),
        leaseExpiresAt: atMinute(19),
        staleBefore: atMinute(1),
      }),
    ).resolves.toMatchObject({
      trigger_message_id: triggerMessageId,
      claimed_worker_id: previous.worker.id,
      agent_provider: "codex",
    });
  });

  it("does not move a reply away from the processing worker's worktree", async () => {
    const previous = await register("offline", 1);
    const fallback = await register("available", 10);
    const runId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("mention-fallback", 11),
    );
    await db
      .prepare(`update briar_hunt_runs set worker_id = ? where id = ?`)
      .bind(previous.worker.id, runId)
      .run();
    const triggerMessageId = "44444444-dddd-4ddd-8ddd-444444444444";
    await createIssueMessage(db, {
      id: triggerMessageId,
      projectId,
      runId,
      parentMessageId: null,
      authorUserId: "owner",
      authorAgentProvider: null,
      body: "@Developer summarize the result",
      createdAt: atMinute(11),
    });
    await enqueueIssueAgentReply(db, {
      id: "55555555-eeee-4eee-8eee-555555555555",
      projectId,
      runId,
      triggerMessageId,
      parentMessageId: triggerMessageId,
      replyMessageId: "66666666-ffff-4fff-8fff-666666666666",
      createdAt: atMinute(11),
    });

    await expect(
      claimNextIssueAgentReply(db, projectId, {
        workerId: fallback.worker.id,
        agentProvider: "codex",
        claimTokenHash: fingerprint("available-claim"),
        claimedAt: atMinute(12),
        leaseExpiresAt: atMinute(27),
        staleBefore: atMinute(9),
      }),
    ).resolves.toBeNull();
  });

  it("keeps a failed reply on the processing worker for retry", async () => {
    const previous = await register("retry-processing", 1);
    const fallback = await register("retry-fallback", 1);
    const runId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("mention-retry", 2),
    );
    await db
      .prepare(`update briar_hunt_runs set worker_id = ? where id = ?`)
      .bind(previous.worker.id, runId)
      .run();
    const triggerMessageId = "aaaaaaa1-dddd-4ddd-8ddd-aaaaaaaaaaaa";
    await createIssueMessage(db, {
      id: triggerMessageId,
      projectId,
      runId,
      parentMessageId: null,
      authorUserId: "owner",
      authorAgentProvider: null,
      body: "@Developer retry this reply",
      createdAt: atMinute(3),
    });
    await enqueueIssueAgentReply(db, {
      id: "bbbbbbb2-eeee-4eee-8eee-bbbbbbbbbbbb",
      projectId,
      runId,
      triggerMessageId,
      parentMessageId: triggerMessageId,
      replyMessageId: "ccccccc3-ffff-4fff-8fff-cccccccccccc",
      createdAt: atMinute(3),
    });

    const claimTokenHash = fingerprint("retry-processing-claim");
    await expect(
      claimNextIssueAgentReply(db, projectId, {
        workerId: previous.worker.id,
        agentProvider: "codex",
        claimTokenHash,
        claimedAt: atMinute(4),
        leaseExpiresAt: atMinute(19),
        staleBefore: atMinute(0),
      }),
    ).resolves.toMatchObject({
      claimed_worker_id: previous.worker.id,
      preferred_worker_id: previous.worker.id,
    });

    await expect(
      failIssueAgentReply(db, projectId, "bbbbbbb2-eeee-4eee-8eee-bbbbbbbbbbbb", {
        workerId: previous.worker.id,
        claimTokenHash,
        error: "temporary reply failure",
        updatedAt: atMinute(5),
      }),
    ).resolves.toMatchObject({
      status: "queued",
      preferred_worker_id: previous.worker.id,
    });

    await expect(
      claimNextIssueAgentReply(db, projectId, {
        workerId: fallback.worker.id,
        agentProvider: "codex",
        claimTokenHash: fingerprint("retry-fallback-claim"),
        claimedAt: atMinute(6),
        leaseExpiresAt: atMinute(21),
        staleBefore: atMinute(0),
      }),
    ).resolves.toBeNull();
    await expect(
      claimNextIssueAgentReply(db, projectId, {
        workerId: previous.worker.id,
        agentProvider: "codex",
        claimTokenHash: fingerprint("retry-processing-claim-2"),
        claimedAt: atMinute(6),
        leaseExpiresAt: atMinute(21),
        staleBefore: atMinute(0),
      }),
    ).resolves.toMatchObject({
      status: "running",
      claimed_worker_id: previous.worker.id,
      attempts: 2,
    });
  });

  it("lets any eligible worker answer an issue that was never assigned", async () => {
    const worker = await register("unassigned", 1);
    const runId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("mention-unassigned", 2),
    );
    const triggerMessageId = "77777777-aaaa-4aaa-8aaa-777777777777";
    await createIssueMessage(db, {
      id: triggerMessageId,
      projectId,
      runId,
      parentMessageId: null,
      authorUserId: "owner",
      authorAgentProvider: null,
      body: "@Developer inspect the server record",
      createdAt: atMinute(3),
    });
    await enqueueIssueAgentReply(db, {
      id: "88888888-bbbb-4bbb-8bbb-888888888888",
      projectId,
      runId,
      triggerMessageId,
      parentMessageId: triggerMessageId,
      replyMessageId: "99999999-cccc-4ccc-8ccc-999999999999",
      createdAt: atMinute(3),
    });

    await expect(
      claimNextIssueAgentReply(db, projectId, {
        workerId: worker.worker.id,
        agentProvider: "codex",
        claimTokenHash: fingerprint("unassigned-claim"),
        claimedAt: atMinute(4),
        leaseExpiresAt: atMinute(19),
        staleBefore: atMinute(1),
      }),
    ).resolves.toMatchObject({
      preferred_worker_id: null,
      claimed_worker_id: worker.worker.id,
    });
  });

  it("lists a thread root, replies, and nested replies for continuation decisions", async () => {
    const runId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("thread-context", 2),
    );
    await createIssueMessage(db, {
      id: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
      projectId,
      runId,
      parentMessageId: null,
      authorUserId: "owner",
      authorAgentProvider: null,
      body: "첫 질문",
      createdAt: atMinute(2),
    });
    await createIssueMessage(db, {
      id: "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb",
      projectId,
      runId,
      parentMessageId: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
      authorUserId: null,
      authorAgentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      authorAgentName: "Codex Agent",
      authorAgentProvider: "codex",
      body: "Developer의 답변",
      createdAt: atMinute(3),
    });
    await createIssueMessage(db, {
      id: "cccccccc-3333-4ccc-8ccc-cccccccccccc",
      projectId,
      runId,
      parentMessageId: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
      authorUserId: "owner",
      authorAgentProvider: null,
      body: "이어서 질문",
      createdAt: atMinute(4),
    });
    await createIssueMessage(db, {
      id: "dddddddd-4444-4ddd-8ddd-dddddddddddd",
      projectId,
      runId,
      parentMessageId: "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb",
      authorUserId: "owner",
      authorAgentProvider: null,
      body: "Developer 답변에 대한 대댓글",
      createdAt: atMinute(5),
    });

    const thread = await listIssueThreadMessages(
      db,
      projectId,
      runId,
      "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
    );

    expect(thread.map((message) => message.id)).toEqual([
      "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-3333-4ccc-8ccc-cccccccccccc",
      "dddddddd-4444-4ddd-8ddd-dddddddddddd",
    ]);
    expect(
      thread.map((message) => message.author_agent_provider),
    ).toContain("codex");
  });

  it("registers a worker and adopts the same machine on restart", async () => {
    const first = await register("a");
    expect(first.worker.state).toBe("online");
    const second = await registerExecutionWorker(db, projectId, {
      id: "worker-different-id",
      deviceId: "device-different-id",
      organizationId: projectId,
      ownerUserId: "owner",
      label: "renamed",
      deviceIdentityHash: fingerprint("a"),
      credentialTokenHash: fingerprint("rotated-token"),
      runtime: runtimeMetadata(
        {
          agentProvider: "claude",
          providers: ["claude"],
        },
        "1.2.0"
      ),
      observedAt: atMinute(5),
    });
    expect(second.device.id).toBe(first.device.id);
    expect(second.worker.id).toBe(first.worker.id);
    expect(second.worker.label).toBe("renamed");
    expect(
      workerRuntimeMetadataFromStoredProtoJson(second.worker.runtime_proto_json)
        .agentProvider
    ).toBe("claude");
    const workers = await listExecutionWorkers(db, projectId, atMinute(5));
    expect(workers).toHaveLength(1);
    expect(workers[0].owner_user_id).toBe("owner");
    expect(
      await authenticateExecutionWorker(
        db,
        fingerprint("rotated-token"),
        atMinute(6),
      ),
    ).toMatchObject({ deviceId: first.device.id, ownerUserId: "owner" });
    await expect(
      authenticateExecutionWorker(db, fingerprint("token-a"), atMinute(6)),
    ).resolves.toBeNull();
  });

  it("coalesces credential usage writes into five-minute buckets", async () => {
    const tokenHash = fingerprint("credential-touch-token");
    const registered = await register("credential-touch", 1, tokenHash);
    const lastUsedAt = async () =>
      (await db.prepare(
        `select last_used_at from briar_execution_worker_credentials
         where device_id = ?`,
      ).bind(registered.device.id).first<{ last_used_at: string | null }>())
        ?.last_used_at ?? null;

    expect(WORKER_CREDENTIAL_TOUCH_INTERVAL_MS).toBe(5 * 60_000);
    expect(await lastUsedAt()).toBeNull();
    await expect(
      authenticateExecutionWorker(db, tokenHash, atMinute(2))
    ).resolves.toMatchObject({
      deviceId: registered.device.id,
    });
    expect(await lastUsedAt()).toBe(atMinute(2));

    await authenticateExecutionWorker(db, tokenHash, atMinute(3));
    await authenticateExecutionWorker(db, tokenHash, atMinute(6));
    expect(await lastUsedAt()).toBe(atMinute(2));

    await authenticateExecutionWorker(db, tokenHash, atMinute(7));
    expect(await lastUsedAt()).toBe(atMinute(7));
  });

  it("binds an enrolled device to another project without rotating its credential", async () => {
    const first = await register("shared");
    const credentialBefore = await db
      .prepare(
        `select token_hash from briar_execution_worker_credentials
         where device_id = ?`,
      )
      .bind(first.device.id)
      .first<{ token_hash: string }>();

    const second = await bindExecutionWorkerProject(db, secondProjectId, {
      id: "worker-shared-second",
      organizationId: projectId,
      ownerUserId: "owner",
      deviceIdentityHash: fingerprint("shared"),
      runtime: runtimeMetadata({}, "1.1.2"),
      observedAt: atMinute(2),
    });
    const credentialAfter = await db
      .prepare(
        `select token_hash from briar_execution_worker_credentials
         where device_id = ?`,
      )
      .bind(first.device.id)
      .first<{ token_hash: string }>();

    expect(second.device.id).toBe(first.device.id);
    expect(credentialAfter).toEqual(credentialBefore);
    const organizationWorkers = await listOrganizationExecutionWorkers(
      db,
      projectId,
      atMinute(2),
    );
    expect(organizationWorkers).toHaveLength(1);
    expect(
      organizationWorkers[0].bindings.map((binding) => binding.projectId),
    ).toEqual([projectId, secondProjectId]);
  });

  it("lists healthy providers from canonical Worker runtimes", async () => {
    const newest = await register("providers-newest", 5);
    const older = await register("providers-older", 2);

    await recordWorkerHeartbeat(db, projectId, {
      workerId: newest.worker.id,
      runtime: runtimeMetadata({ providers: ["grok", "opencode"] }),
      observedAt: atMinute(6),
    });
    await recordWorkerHeartbeat(db, projectId, {
      workerId: older.worker.id,
      runtime: runtimeMetadata({ providers: ["codex", "grok"] }),
      observedAt: atMinute(3),
    });

    await expect(
      listOrganizationExecutionProviders(db, projectId)
    ).resolves.toEqual(["grok", "opencode", "codex"]);
  });

  it("allows a busy compatible Worker to run a channel Agent reply", async () => {
    const worker = await register("channel-reply", 1);
    const projectReply = {
      organizationId: projectId,
      projectId,
      provider: "codex" as const,
      model: "gpt-5.6-sol",
      effort: "high" as const,
      observedAt: atMinute(2),
    };

    await expect(
      hasAvailableChannelReplyWorker(db, projectReply),
    ).resolves.toBe(true);
    await expect(
      hasAvailableChannelReplyWorker(db, {
        ...projectReply,
        projectId: null,
      }),
    ).resolves.toBe(true);

    await recordWorkerHeartbeat(db, projectId, {
      workerId: worker.worker.id,
      runtime: runtimeMetadata(),
      readinessState: "busy",
      observedAt: atMinute(3),
    });
    await expect(
      hasAvailableChannelReplyWorker(db, {
        ...projectReply,
        observedAt: atMinute(3),
      }),
    ).resolves.toBe(true);
  });

  it("distinguishes exhausted Agent usage from an unavailable Worker", async () => {
    const worker = await register("channel-reply-usage", 1);
    const exhaustedRuntime = workerRuntimeFixture({
      providerCapabilities,
      providers: [],
    });
    const exhaustedGrok = exhaustedRuntime.providerHealth.find(
      (health) => health.provider === AgentProvider.GROK
    );
    if (!exhaustedGrok) throw new Error("Grok health fixture is missing");
    Object.assign(exhaustedGrok, {
      installed: true,
      authenticated: true,
      healthy: false,
      reason: "usage_exhausted",
      usageExhausted: true,
      maxUsedPercent: 100,
    });
    const reply = {
      organizationId: projectId,
      projectId,
      provider: "grok" as const,
      model: "grok-4.6",
      effort: "high" as const,
      observedAt: atMinute(2),
    };
    await recordWorkerHeartbeat(db, projectId, {
      workerId: worker.worker.id,
      runtime: workerRuntimeMetadataFromProto(exhaustedRuntime),
      acceptingWork: false,
      readinessState: "needs_attention",
      observedAt: atMinute(2),
    });
    await expect(channelReplyWorkerAvailability(db, reply))
      .resolves.toBe("usage_exhausted");
    await expect(hasAvailableChannelReplyWorker(db, reply))
      .resolves.toBe(false);

    await recordWorkerHeartbeat(db, projectId, {
      workerId: worker.worker.id,
      runtime: runtimeMetadata({ providers: ["grok"] }),
      acceptingWork: true,
      readinessState: "ready",
      observedAt: atMinute(3),
    });
    await expect(channelReplyWorkerAvailability(db, {
      ...reply,
      observedAt: atMinute(3),
    })).resolves.toBe("available");

    await recordWorkerHeartbeat(db, projectId, {
      workerId: worker.worker.id,
      runtime: runtimeMetadata({ providers: [] }),
      acceptingWork: false,
      readinessState: "needs_attention",
      observedAt: atMinute(4),
    });
    await expect(channelReplyWorkerAvailability(db, {
      ...reply,
      observedAt: atMinute(4),
    })).resolves.toBe("unavailable");
  });

  it("renames a device and all of its project bindings together", async () => {
    const first = await register("rename");
    const second = await bindExecutionWorkerProject(db, secondProjectId, {
      id: "worker-rename-second",
      organizationId: projectId,
      ownerUserId: "owner",
      deviceIdentityHash: fingerprint("rename"),
      runtime: runtimeMetadata(),
      observedAt: atMinute(2),
    });

    const renamed = await updateExecutionWorkerLabel(
      db,
      first.device.id,
      "new-hostname",
      atMinute(3),
    );

    expect(renamed?.label).toBe("new-hostname");
    await expect(
      executionWorkerBindingForProject(db, first.device.id, projectId),
    ).resolves.toMatchObject({ label: "new-hostname" });
    await expect(
      executionWorkerBindingForProject(db, first.device.id, secondProjectId),
    ).resolves.toMatchObject({
      id: second.worker.id,
      label: "new-hostname",
    });
  });

  it("binds one organization device to several projects", async () => {
    const first = await register("shared");
    const second = await registerExecutionWorker(db, secondProjectId, {
      id: "worker-shared-second-project",
      deviceId: "unused-device-id",
      organizationId: projectId,
      ownerUserId: "owner",
      label: "shared worker",
      deviceIdentityHash: fingerprint("shared"),
      credentialTokenHash: fingerprint("shared-rotated"),
      runtime: runtimeMetadata(
        {
          agentProvider: "grok",
          providers: ["grok"],
        },
        "1.2.0"
      ),
      observedAt: atMinute(4),
    });
    expect(second.device.id).toBe(first.device.id);
    expect(second.worker.id).not.toBe(first.worker.id);
    expect(second.worker.project_id).toBe(secondProjectId);
    expect(
      await executionWorkerBindingForProject(
        db,
        first.device.id,
        projectId,
      ),
    ).not.toBeNull();
    expect(
      await executionWorkerBindingForProject(
        db,
        first.device.id,
        secondProjectId,
      ),
    ).not.toBeNull();
  });

  it("shares device session slots across every project binding", async () => {
    const first = await register("capacity-shared");
    const second = await registerExecutionWorker(db, secondProjectId, {
      id: "worker-capacity-shared-second",
      deviceId: "ignored",
      organizationId: projectId,
      ownerUserId: "owner",
      label: "capacity shared",
      deviceIdentityHash: fingerprint("capacity-shared"),
      credentialTokenHash: fingerprint("capacity-shared-token"),
      runtime: runtimeMetadata(),
      maxConcurrentSessions: 2,
      observedAt: atMinute(2),
    });
    await recordHuntEvent(db, projectId, queuedEvent("first-project-1", 3));
    await recordHuntEvent(db, projectId, queuedEvent("first-project-2", 4));
    await recordHuntEvent(
      db,
      secondProjectId,
      queuedEvent("second-project-1", 5),
    );

    const claim = (
      targetProjectId: string,
      workerId: string,
      token: string,
    ) =>
      claimNextQueuedHuntRun(db, targetProjectId, {
        claimTokenHash: token.repeat(64),
        claimedBy: "capacity shared",
        claimedAt: atMinute(6),
        leaseExpiresAt: leaseExpiryFrom(atMinute(6)),
        workerId,
        workerDeviceId: first.device.id,
      });
    const claims = await Promise.all([
      claim(projectId, first.worker.id, "a"),
      claim(projectId, first.worker.id, "b"),
      claim(secondProjectId, second.worker.id, "c"),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(2);
    expect(
      await countExecutionWorkerDeviceSessions(
        db,
        first.device.id,
        atMinute(7),
      ),
    ).toBe(2);
    await expect(
      listExecutionWorkers(db, projectId, atMinute(7)),
    ).resolves.toEqual([
      expect.objectContaining({
        max_concurrent_sessions: 2,
        active_sessions: 2,
      }),
    ]);
  });

  it("unshares one project without revoking the device's other bindings", async () => {
    const first = await register("partially-shared");
    await registerExecutionWorker(db, secondProjectId, {
      id: "worker-partially-shared-second",
      deviceId: "ignored",
      organizationId: projectId,
      ownerUserId: "owner",
      label: "partially shared",
      deviceIdentityHash: fingerprint("partially-shared"),
      credentialTokenHash: fingerprint("partially-shared-token"),
      runtime: runtimeMetadata(),
      observedAt: atMinute(2),
    });
    expect(
      await unbindExecutionWorker(
        db,
        first.device.id,
        projectId,
        atMinute(3),
        {
          requestId: "worker-unlink:partially-shared",
          organizationId: projectId,
          workerId: first.worker.id,
          reason: "explicit_user_unlink",
        },
      ),
    ).toBe(true);
    expect(
      await executionWorkerBindingForProject(db, first.device.id, projectId),
    ).toBeNull();
    await expect(db.prepare(
      `select operation from briar_dashboard_changes
       where project_id = ? and entity_type = 'worker' and entity_id = ?
       order by version desc limit 1`,
    ).bind(projectId, first.worker.id).first()).resolves.toEqual({
      operation: "delete",
    });
    expect(
      await executionWorkerBindingForProject(
        db,
        first.device.id,
        secondProjectId,
      ),
    ).not.toBeNull();
    expect(
      await authenticateExecutionWorker(
        db,
        fingerprint("partially-shared-token"),
        atMinute(4),
      ),
    ).not.toBeNull();
    expect(
      await unbindExecutionWorker(
        db,
        first.device.id,
        projectId,
        atMinute(4),
        {
          requestId: "worker-unlink:partially-shared",
          organizationId: projectId,
          workerId: first.worker.id,
          reason: "explicit_user_unlink",
        },
      ),
    ).toBe(true);
    await expect(db.prepare(
      `select reason, outcome, attempt_count, hard_delete_rows_written,
              detail_json
       from briar_execution_worker_lifecycle_events where request_id = ?`,
    ).bind("worker-unlink:partially-shared").first()).resolves.toMatchObject({
      reason: "explicit_user_unlink",
      outcome: "deleted",
      attempt_count: 2,
      hard_delete_rows_written: expect.any(Number),
      detail_json: expect.stringContaining('"remainingBindings":1'),
    });
  });

  it("retries an abandoned unlink after its lifecycle lease expires", async () => {
    const registered = await register("stale-unlink-retry");
    const requestId = "worker-unlink:stale-unlink-retry";
    await db.prepare(
      `insert into briar_execution_worker_lifecycle_events (
         request_id, organization_id, project_id, device_id, worker_id,
         operation, reason, outcome, attempt_count, created_at, updated_at
       ) values (?, ?, ?, ?, ?, 'binding_delete', 'explicit_user_unlink',
                 'started', 1, ?, ?)`,
    ).bind(
      requestId,
      projectId,
      projectId,
      registered.device.id,
      registered.worker.id,
      atMinute(1),
      atMinute(1),
    ).run();

    await expect(unbindExecutionWorker(
      db,
      registered.device.id,
      projectId,
      atMinute(7),
      {
        requestId,
        organizationId: projectId,
        workerId: registered.worker.id,
        reason: "explicit_user_unlink",
      },
    )).resolves.toBe(true);
    await expect(db.prepare(
      `select outcome, attempt_count from
         briar_execution_worker_lifecycle_events where request_id = ?`,
    ).bind(requestId).first()).resolves.toEqual({
      outcome: "deleted",
      attempt_count: 2,
    });
  });

  it("does not let another organization member adopt an enrolled device", async () => {
    await register("owned");
    await expect(
      registerExecutionWorker(db, secondProjectId, {
        id: "worker-owned-by-member",
        deviceId: "device-owned-by-member",
        organizationId: projectId,
        ownerUserId: "member",
        label: "member worker",
        deviceIdentityHash: fingerprint("owned"),
        credentialTokenHash: fingerprint("member-token"),
        runtime: runtimeMetadata(),
        observedAt: atMinute(3),
      }),
    ).rejects.toThrow("already owned by another organization member");
  });

  it("stops accepting a worker credential when its owner leaves the organization", async () => {
    const registration = await registerExecutionWorker(db, projectId, {
      id: "worker-departing-member",
      deviceId: "device-departing-member",
      organizationId: projectId,
      ownerUserId: "member",
      label: "member worker",
      deviceIdentityHash: fingerprint("departing"),
      credentialTokenHash: fingerprint("departing-token"),
      runtime: runtimeMetadata(),
      observedAt: atMinute(2),
    });
    expect(registration.device.owner_user_id).toBe("member");
    expect(
      await authenticateExecutionWorker(
        db,
        fingerprint("departing-token"),
        atMinute(3),
      ),
    ).not.toBeNull();
    await db
      .prepare(
        `delete from briar_organization_members
         where organization_id = ? and user_id = ?`,
      )
      .bind(projectId, "member")
      .run();
    await expect(
      authenticateExecutionWorker(
        db,
        fingerprint("departing-token"),
        atMinute(4),
      ),
    ).resolves.toBeNull();
  });

  it("rejects unusable labels, identities, and credentials", async () => {
    await expect(
      registerExecutionWorker(db, projectId, {
        id: "worker-bad",
        deviceId: "device-bad",
        organizationId: projectId,
        ownerUserId: "owner",
        label: "   ",
        deviceIdentityHash: fingerprint("b"),
        credentialTokenHash: fingerprint("token-b"),
        runtime: runtimeMetadata(),
        observedAt: atMinute(1),
      }),
    ).rejects.toBeInstanceOf(WorkerConflictError);
    await expect(
      registerExecutionWorker(db, projectId, {
        id: "worker-bad",
        deviceId: "device-bad",
        organizationId: projectId,
        ownerUserId: "owner",
        label: "ok",
        deviceIdentityHash: "not-a-digest",
        credentialTokenHash: fingerprint("token-b"),
        runtime: runtimeMetadata(),
        observedAt: atMinute(1),
      }),
    ).rejects.toBeInstanceOf(WorkerConflictError);
    await expect(
      registerExecutionWorker(db, projectId, {
        id: "worker-bad",
        deviceId: "device-bad",
        organizationId: projectId,
        ownerUserId: "owner",
        label: "ok",
        deviceIdentityHash: fingerprint("b"),
        credentialTokenHash: "not-a-digest",
        runtime: runtimeMetadata(),
        observedAt: atMinute(1),
      }),
    ).rejects.toBeInstanceOf(WorkerConflictError);
  });

  it("revokes the credential and every project binding when disabled", async () => {
    const registered = await register("revoked");
    expect(
      await executionWorkerBindingForProject(
        db,
        registered.device.id,
        projectId,
      ),
    ).not.toBeNull();
    expect(
      await disableExecutionWorker(db, registered.device.id, atMinute(5)),
    ).toBe(true);
    await expect(
      authenticateExecutionWorker(
        db,
        fingerprint("token-revoked"),
        atMinute(6),
      ),
    ).resolves.toBeNull();
    expect((await listExecutionWorkers(db, projectId, atMinute(6)))[0].state).toBe(
      "disabled",
    );
  });

  it("permanently deletes an idle Worker and its pending update", async () => {
    const registered = await register("deleted");
    await bindExecutionWorkerProject(db, secondProjectId, {
      id: "worker-deleted-second-project",
      organizationId: projectId,
      ownerUserId: "owner",
      deviceIdentityHash: fingerprint("deleted"),
      runtime: runtimeMetadata({}, "1.2.69"),
      observedAt: atMinute(2),
    });
    await requestExecutionWorkerUpdate(db, {
      id: "77777777-7777-4777-8777-777777777779",
      organizationId: projectId,
      deviceId: registered.device.id,
      requestedByUserId: "owner",
      targetVersion: "1.2.84",
      requestedAt: atMinute(3),
    });

    await expect(
      deleteExecutionWorker(db, registered.device.id, atMinute(4), {
        requestId: "worker-deprovision:deleted",
        organizationId: projectId,
        projectId: null,
        workerId: null,
        reason: "explicit_user_deprovision",
      }),
    ).resolves.toBe(true);
    await expect(
      authenticateExecutionWorker(
        db,
        fingerprint("token-deleted"),
        atMinute(5),
      ),
    ).resolves.toBeNull();
    await expect(
      executionWorkerBindingForProject(db, registered.device.id, projectId),
    ).resolves.toBeNull();
    await expect(
      executionWorkerBindingForProject(
        db,
        registered.device.id,
        secondProjectId,
      ),
    ).resolves.toBeNull();
    await expect(
      pendingExecutionWorkerUpdate(db, registered.device.id),
    ).resolves.toBeNull();
    await expect(
      listOrganizationExecutionWorkers(db, projectId, atMinute(5)),
    ).resolves.toEqual([]);
    await expect(db.prepare(
      `select reason, operation, outcome, hard_delete_rows_written, detail_json
       from briar_execution_worker_lifecycle_events where request_id = ?`,
    ).bind("worker-deprovision:deleted").first()).resolves.toMatchObject({
      reason: "explicit_user_deprovision",
      operation: "device_delete",
      outcome: "deleted",
      hard_delete_rows_written: expect.any(Number),
      detail_json: expect.stringContaining('"bindingCount":2'),
    });
  });

  it("does not delete or clear a Worker that is designated by an Agent", async () => {
    const registered = await register("designated-delete");
    const agentId = crypto.randomUUID();
    await db.prepare(
      `insert into briar_project_agents (
         id, organization_id, project_id, name, provider, model, effort,
         designated_worker_id, designated_worker_label, responsibility,
         created_at, updated_at
       ) values (?, ?, ?, 'Pinned Agent', 'codex', null, null, ?, ?,
                 'Stay on one Worker', ?, ?)`,
    ).bind(
      agentId,
      projectId,
      projectId,
      registered.worker.id,
      registered.worker.label,
      atMinute(3),
      atMinute(3),
    ).run();

    await expect(updateExecutionWorkerLabel(
      db,
      registered.device.id,
      "renamed designated Worker",
      atMinute(4),
    )).resolves.toMatchObject({ label: "renamed designated Worker" });
    await expect(db.prepare(
      `select designated_worker_label from briar_project_agents where id = ?`,
    ).bind(agentId).first()).resolves.toMatchObject({
      designated_worker_label: "renamed designated Worker",
    });

    await expect(
      deleteExecutionWorker(db, registered.device.id, atMinute(5), {
        requestId: "worker-deprovision:designated-delete",
        organizationId: projectId,
        projectId: null,
        workerId: null,
        reason: "explicit_user_deprovision",
      }),
    ).rejects.toThrow("Designated Worker");
    await expect(db.prepare(
      `select designated_worker_id from briar_project_agents where id = ?`,
    ).bind(agentId).first()).resolves.toMatchObject({
      designated_worker_id: registered.worker.id,
    });
    await expect(
      executionWorkerBindingForProject(db, registered.device.id, projectId),
    ).resolves.not.toBeNull();

    await db.prepare(
      `update briar_project_agents
       set designated_worker_id = null, designated_worker_label = null
       where id = ?`,
    ).bind(agentId).run();
    await expect(
      deleteExecutionWorker(db, registered.device.id, atMinute(10), {
        requestId: "worker-deprovision:designated-delete",
        organizationId: projectId,
        projectId: null,
        workerId: null,
        reason: "explicit_user_deprovision",
      }),
    ).resolves.toBe(true);
  });

  it("disables but does not delete a Worker with an active session", async () => {
    const registered = await register("delete-active");
    const runId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("delete-active", 2),
    );
    await claimNextQueuedHuntRun(db, projectId, {
      runId,
      claimTokenHash: fingerprint("delete-active-claim"),
      claimedBy: registered.worker.label,
      claimedAt: atMinute(3),
      leaseExpiresAt: leaseExpiryFrom(atMinute(3)),
      workerId: registered.worker.id,
      workerDeviceId: registered.device.id,
    });

    await expect(
      deleteExecutionWorker(db, registered.device.id, atMinute(4), {
        requestId: "worker-deprovision:delete-active",
        organizationId: projectId,
        projectId: null,
        workerId: null,
        reason: "explicit_user_deprovision",
      }),
    ).rejects.toThrow("active sessions");
    await expect(
      listOrganizationExecutionWorkers(db, projectId, atMinute(4)),
    ).resolves.toEqual([
      expect.objectContaining({
        deviceId: registered.device.id,
        state: "disabled",
      }),
    ]);
  });

  it("reports a worker as stale once heartbeats stop", async () => {
    await register("c", 1);
    expect((await listExecutionWorkers(db, projectId, atMinute(2)))[0].state).toBe(
      "online",
    );
    expect((await listExecutionWorkers(db, projectId, atMinute(10)))[0].state).toBe(
      "stale",
    );
    await recordWorkerHeartbeat(db, projectId, {
      workerId: "worker-c",
      runtime: runtimeMetadata(),
      observedAt: atMinute(10),
    });
    expect((await listExecutionWorkers(db, projectId, atMinute(11)))[0].state).toBe(
      "online",
    );
    await expect(
      recordWorkerHeartbeat(db, projectId, {
        workerId: "worker-missing",
        runtime: runtimeMetadata(),
        observedAt: atMinute(11),
      }),
    ).rejects.toBeInstanceOf(WorkerConflictError);
  });

  it("builds the project catalog from live, policy-allowed Worker heartbeats", async () => {
    const first = await register("catalog-first", 1);
    const second = await register("catalog-second", 1);
    const runtimeWithCodexModels = (
      models: Array<{ id: string; label: string }>
    ) =>
      runtimeMetadata({
        providerCapabilities: {
          ...providerCapabilities,
          codex: { ...providerCapabilities.codex, models },
        },
      });
    await recordWorkerHeartbeat(db, projectId, {
      workerId: first.worker.id,
      runtime: runtimeWithCodexModels([
        { id: "remote-zeta", label: "Remote Zeta" },
        { id: "remote-shared", label: "Remote Shared" },
      ]),
      observedAt: atMinute(2),
    });
    await recordWorkerHeartbeat(db, projectId, {
      workerId: second.worker.id,
      runtime: runtimeWithCodexModels([
        { id: "remote-alpha", label: "Remote Alpha" },
        { id: "remote-shared", label: "Remote Shared" },
      ]),
      observedAt: atMinute(2),
    });

    const liveWorkers = await listExecutionWorkers(db, projectId, atMinute(3));
    expect(projectExecutionWorkerCapabilityCatalog(liveWorkers, {
      selectionMode: "any",
      defaultWorkerId: null,
      allowedWorkerIds: [],
      updatedAt: null,
    })).toMatchObject({
      workerCount: 2,
      capabilities: {
        codex: {
          models: [
            { id: "remote-alpha" },
            { id: "remote-shared" },
            { id: "remote-zeta" },
          ],
        },
      },
    });

    const policy = await updateProjectExecutionWorkerPolicy(db, projectId, {
      selectionMode: "allowlist",
      defaultWorkerId: second.worker.id,
      allowedWorkerIds: [second.worker.id],
      updatedByUserId: "owner",
      observedAt: atMinute(3),
    });
    expect(
      projectExecutionWorkerCapabilityCatalog(liveWorkers, policy).capabilities
        .codex.models.map((model) => model.id),
    ).toEqual(["remote-alpha", "remote-shared"]);

    await recordWorkerHeartbeat(db, projectId, {
      workerId: second.worker.id,
      runtime: runtimeWithCodexModels([
        { id: "remote-after-heartbeat", label: "Remote After Heartbeat" },
      ]),
      observedAt: atMinute(8),
    });
    const refreshedWorkers = await listExecutionWorkers(
      db,
      projectId,
      atMinute(9),
    );
    expect(refreshedWorkers.find((worker) => worker.id === first.worker.id)?.state)
      .toBe("stale");
    expect(
      projectExecutionWorkerCapabilityCatalog(refreshedWorkers, {
        selectionMode: "any",
        defaultWorkerId: null,
        allowedWorkerIds: [],
        updatedAt: null,
      }).capabilities.codex.models.map((model) => model.id),
    ).toEqual(["remote-after-heartbeat"]);
  });

  it("rejects automatic dispatch when the last compatible Worker heartbeat expired", async () => {
    await register("expired-auto", 1);
    const runId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("expired-auto-dispatch", 10),
    );

    await expect(
      dispatchHuntRun(db, projectId, projectId, {
        runId,
        provider: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
        workerId: null,
        requestedByUserId: "member",
        requestId: "12121212-aaaa-4121-8121-121212121212",
        occurredAt: atMinute(10),
      }),
    ).rejects.toThrow(
      "No Worker supports codex model gpt-5.6-sol with high effort",
    );
  });

  it("keeps a disabled worker disabled through heartbeats", async () => {
    await register("d");
    await db
      .prepare(`update briar_execution_workers set state = 'disabled' where id = ?`)
      .bind("worker-d")
      .run();
    const row = await recordWorkerHeartbeat(db, projectId, {
      workerId: "worker-d",
      runtime: runtimeMetadata(),
      observedAt: atMinute(3),
    });
    expect(row.state).toBe("disabled");
    expect(workerStateAt(atMinute(3), atMinute(3), "disabled")).toBe("disabled");
  });

  it("keeps the Agent logical and assigns a specific Worker only for the run", async () => {
    const first = await register("target-a");
    const second = await register("target-b");
    const agent = await db
      .prepare(
        `select id from briar_project_agents
         where project_id = ? and provider = 'codex' limit 1`,
      )
      .bind(projectId)
      .first<{ id: string }>();
    expect(agent).not.toBeNull();
    const run = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("targeted-issue", 2),
    );

    const dispatched = await dispatchHuntRun(db, projectId, projectId, {
      runId: run,
      agentId: agent!.id,
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "xhigh",
      persistPreferences: true,
      workerId: first.worker.id,
      requestedByUserId: "member",
      requestId: "11111111-aaaa-4111-8111-111111111111",
      occurredAt: atMinute(2),
    });
    expect(dispatched).toMatchObject({
      agentId: agent!.id,
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "xhigh",
      requestedWorkerId: first.worker.id,
      dispatchMode: "specific",
    });

    const wrongWorkerClaim = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: fingerprint("wrong-worker-claim"),
      claimedBy: second.worker.label,
      claimedAt: atMinute(3),
      leaseExpiresAt: leaseExpiryFrom(atMinute(3)),
      workerId: second.worker.id,
      detachedOnly: true,
    });
    expect(wrongWorkerClaim).toBeNull();

    const legacyAgentClaim = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: fingerprint("legacy-agent-claim"),
      claimedBy: "legacy-agent",
      claimedAt: atMinute(3),
      leaseExpiresAt: leaseExpiryFrom(atMinute(3)),
      runId: run,
    });
    expect(legacyAgentClaim).toBeNull();

    const assignedClaim = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: fingerprint("assigned-worker-claim"),
      claimedBy: first.worker.label,
      claimedAt: atMinute(3),
      leaseExpiresAt: leaseExpiryFrom(atMinute(3)),
      workerId: first.worker.id,
      detachedOnly: true,
    });
    expect(assignedClaim).toMatchObject({
      agent_id: agent!.id,
      preferred_agent_provider: "codex",
      preferred_agent_model: "gpt-5.6-sol",
      preferred_agent_effort: "xhigh",
      requested_agent_model: "gpt-5.6-sol",
      requested_agent_effort: "xhigh",
      requested_worker_id: first.worker.id,
      worker_id: first.worker.id,
    });
  });

  it("dispatches and claims Agents through every provider advertised by a Worker", async () => {
    const registered = await register("multi-provider");
    const providers = [
      "codex",
      "claude",
      "cursor",
      "grok",
      "agy",
      "opencode",
      "openrouter",
    ] as const;
    await recordWorkerHeartbeat(db, projectId, {
      workerId: registered.worker.id,
      runtime: runtimeMetadata({ providers }),
      observedAt: atMinute(2),
    });
    const claudeAgentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await db
      .prepare(
        `insert into briar_project_agents (
           id, project_id, organization_id, name, provider, model, responsibility,
           skill_markdown, created_at, updated_at
         ) values (?, ?, ?, 'Claude Agent', 'claude', null, 'Review the issue.',
                   '# Claude Agent', ?, ?)`,
      )
      .bind(claudeAgentId, projectId, projectId, atMinute(2), atMinute(2))
      .run();
    const runId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("multi-provider-issue", 3),
    );

    await expect(
      dispatchHuntRun(db, projectId, projectId, {
        runId,
        agentId: claudeAgentId,
        workerId: null,
        requestedByUserId: "member",
        requestId: "66666666-aaaa-4666-8666-666666666666",
        occurredAt: atMinute(3),
      }),
    ).resolves.toMatchObject({
      agentId: claudeAgentId,
      dispatchMode: "any",
    });

    const claimed = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: fingerprint("multi-provider-claim"),
      claimedBy: registered.worker.label,
      claimedAt: atMinute(4),
      leaseExpiresAt: leaseExpiryFrom(atMinute(4)),
      workerId: registered.worker.id,
      detachedOnly: true,
    });
    expect(claimed).toMatchObject({
      id: runId,
      agent_id: claudeAgentId,
      worker_id: registered.worker.id,
    });

    const devices = await listOrganizationExecutionWorkers(
      db,
      projectId,
      atMinute(4),
    );
    expect(devices[0].bindings[0].providers).toEqual([
      "codex",
      "claude",
      "cursor",
      "grok",
      "agy",
      "opencode",
      "openrouter",
    ]);
  });

  it("routes a logical Agent through the explicitly selected provider", async () => {
    const registered = await register("provider-override");
    await recordWorkerHeartbeat(db, projectId, {
      workerId: registered.worker.id,
      runtime: runtimeMetadata({ providers: ["codex", "claude"] }),
      observedAt: atMinute(2),
    });
    const agent = await db
      .prepare(
        `select id from briar_project_agents
         where project_id = ? and provider = 'codex' limit 1`,
      )
      .bind(projectId)
      .first<{ id: string }>();
    const runId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("provider-override-issue", 3),
    );

    await expect(
      dispatchHuntRun(db, projectId, projectId, {
        runId,
        agentId: agent!.id,
        provider: "grok",
        workerId: registered.worker.id,
        requestedByUserId: "member",
        requestId: "88888888-aaaa-4888-8888-888888888888",
        occurredAt: atMinute(3),
      }),
    ).rejects.toThrow("Worker does not support the grok provider");

    await expect(
      dispatchHuntRun(db, projectId, projectId, {
        runId,
        agentId: agent!.id,
        provider: "claude",
        workerId: registered.worker.id,
        requestedByUserId: "member",
        requestId: "77777777-aaaa-4777-8777-777777777777",
        occurredAt: atMinute(3),
      }),
    ).resolves.toMatchObject({
      agentId: agent!.id,
      provider: "claude",
      requestedWorkerId: registered.worker.id,
    });

    const selectedProviderClaim = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: fingerprint("selected-provider-claim"),
      claimedBy: registered.worker.label,
      claimedAt: atMinute(4),
      leaseExpiresAt: leaseExpiryFrom(atMinute(4)),
      workerId: registered.worker.id,
      detachedOnly: true,
    });
    expect(selectedProviderClaim).toMatchObject({
      id: runId,
      agent_id: agent!.id,
      requested_agent_provider: "claude",
      worker_id: registered.worker.id,
    });
  });

  it("claims explicit dispatch snapshots ahead of pre-existing or mutated preferences", async () => {
    const registered = await register("dispatch-snapshot");
    await recordWorkerHeartbeat(db, projectId, {
      workerId: registered.worker.id,
      runtime: runtimeMetadata({ providers: ["codex", "claude", "grok"] }),
      observedAt: atMinute(2),
    });
    const runIds = await Promise.all([
      recordHuntEvent(db, projectId, queuedEvent("dispatch-snapshot-existing", 3)),
      recordHuntEvent(db, projectId, queuedEvent("dispatch-snapshot-mutated", 4)),
    ]);
    for (const runId of runIds) {
      await db
        .prepare(
          `update briar_hunt_runs
           set preferred_agent_provider = 'codex',
               preferred_agent_model = 'gpt-5.6-sol',
               preferred_agent_effort = 'xhigh'
           where id = ?`,
        )
        .bind(runId)
        .run();
    }
    await dispatchHuntRun(db, projectId, projectId, {
      runId: runIds[0],
      provider: "claude",
      model: "claude-sonnet-4-0",
      effort: "medium",
      workerId: registered.worker.id,
      requestedByUserId: "member",
      requestId: "12121212-aaaa-4121-8121-121212121212",
      occurredAt: atMinute(5),
    });
    await dispatchHuntRun(db, projectId, projectId, {
      runId: runIds[1],
      provider: "claude",
      model: "claude-sonnet-4-0",
      effort: "medium",
      workerId: registered.worker.id,
      requestedByUserId: "member",
      requestId: "34343434-aaaa-4343-8343-343434343434",
      occurredAt: atMinute(5),
    });
    await db
      .prepare(
        `update briar_hunt_runs
         set preferred_agent_provider = 'grok',
             preferred_agent_model = 'grok-4',
             preferred_agent_effort = 'high'
         where id = ?`,
      )
      .bind(runIds[1])
      .run();

    for (const [runId, claimSeed] of [
      [runIds[0], "existing"],
      [runIds[1], "mutated"],
    ] as const) {
      await expect(
        claimNextQueuedHuntRun(db, projectId, {
          claimTokenHash: fingerprint(`requested-${claimSeed}`),
          claimedBy: registered.worker.label,
          claimedAt: atMinute(6),
          leaseExpiresAt: leaseExpiryFrom(atMinute(6)),
          runId,
          workerId: registered.worker.id,
          detachedOnly: true,
        }),
      ).resolves.toMatchObject({
        id: runId,
        requested_agent_provider: "claude",
        requested_agent_model: "claude-sonnet-4-0",
        requested_agent_effort: "medium",
        worker_id: registered.worker.id,
      });
    }
  });

  it("enforces the project Worker allowlist for dispatch and claim", async () => {
    const allowed = await register("policy-allowed");
    const denied = await register("policy-denied");
    const agent = await db
      .prepare(
        `select id from briar_project_agents where project_id = ? limit 1`,
      )
      .bind(projectId)
      .first<{ id: string }>();
    const policy = await updateProjectExecutionWorkerPolicy(db, projectId, {
      selectionMode: "allowlist",
      defaultWorkerId: allowed.worker.id,
      allowedWorkerIds: [allowed.worker.id],
      updatedByUserId: "owner",
      observedAt: atMinute(2),
    });
    expect(policy).toMatchObject({
      selectionMode: "allowlist",
      defaultWorkerId: allowed.worker.id,
      allowedWorkerIds: [allowed.worker.id],
    });
    await expect(
      updateProjectExecutionWorkerPolicy(db, projectId, {
        selectionMode: "allowlist",
        defaultWorkerId: denied.worker.id,
        allowedWorkerIds: [allowed.worker.id],
        updatedByUserId: "owner",
        observedAt: atMinute(2),
      }),
    ).rejects.toBeInstanceOf(WorkerConflictError);

    const specificallyDeniedRun = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("policy-specific-denied", 3),
    );
    await expect(
      dispatchHuntRun(db, projectId, projectId, {
        runId: specificallyDeniedRun,
        agentId: agent!.id,
        workerId: denied.worker.id,
        requestedByUserId: "member",
        requestId: "44444444-aaaa-4444-8444-444444444444",
        occurredAt: atMinute(3),
      }),
    ).rejects.toThrow("execution policy");

    const anyRun = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("policy-any", 4),
    );
    await dispatchHuntRun(db, projectId, projectId, {
      runId: anyRun,
      agentId: agent!.id,
      workerId: null,
      requestedByUserId: "member",
      requestId: "55555555-aaaa-4555-8555-555555555555",
      occurredAt: atMinute(4),
    });
    const deniedClaim = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: fingerprint("policy-denied-claim"),
      claimedBy: denied.worker.label,
      claimedAt: atMinute(5),
      leaseExpiresAt: leaseExpiryFrom(atMinute(5)),
      workerId: denied.worker.id,
      detachedOnly: true,
    });
    expect(deniedClaim).toBeNull();
    const allowedClaim = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: fingerprint("policy-allowed-claim"),
      claimedBy: allowed.worker.label,
      claimedAt: atMinute(5),
      leaseExpiresAt: leaseExpiryFrom(atMinute(5)),
      workerId: allowed.worker.id,
      detachedOnly: true,
    });
    expect(allowedClaim?.id).toBe(anyRun);
    await expect(
      getProjectExecutionWorkerPolicy(db, projectId),
    ).resolves.toEqual(policy);
  });

  it("reassigns an active run by invalidating the old claim", async () => {
    const first = await register("reassign-a");
    const second = await register("reassign-b");
    const agent = await db
      .prepare(`select id from briar_project_agents where project_id = ? limit 1`)
      .bind(projectId)
      .first<{ id: string }>();
    const run = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("reassigned-issue", 2),
    );
    await dispatchHuntRun(db, projectId, projectId, {
      runId: run,
      agentId: agent!.id,
      workerId: first.worker.id,
      requestedByUserId: "member",
      requestId: "22222222-aaaa-4222-8222-222222222222",
      occurredAt: atMinute(2),
    });
    await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: fingerprint("old-claim"),
      claimedBy: first.worker.label,
      claimedAt: atMinute(3),
      leaseExpiresAt: leaseExpiryFrom(atMinute(3)),
      workerId: first.worker.id,
      detachedOnly: true,
    });
    await updateHuntRunExecutionMetrics(db, projectId, {
      runId: run,
      attempt: 1,
      workerId: first.worker.id,
      metrics: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 50,
        cacheWriteTokens: null,
        reasoningOutputTokens: null,
        totalTokens: 120,
        durationMs: 1_000,
      },
    });

    await dispatchHuntRun(db, projectId, projectId, {
      runId: run,
      agentId: agent!.id,
      workerId: second.worker.id,
      requestedByUserId: "member",
      requestId: "33333333-aaaa-4333-8333-333333333333",
      occurredAt: atMinute(4),
      reassign: true,
    });
    await expect(
      renewHuntRunLease(db, projectId, {
        runId: run,
        claimTokenHash: fingerprint("old-claim"),
        workerId: first.worker.id,
        observedAt: atMinute(5),
      }),
    ).rejects.toBeInstanceOf(WorkerConflictError);
    const reassigned = await db
      .prepare(
        `select agent_id, requested_worker_id, worker_id, claim_token_hash,
                execution_metrics_json
         from briar_hunt_runs where id = ?`,
      )
      .bind(run)
      .first<{
        agent_id: string;
        requested_worker_id: string;
        worker_id: string | null;
        claim_token_hash: string | null;
        execution_metrics_json: string | null;
      }>();
    expect(reassigned).toEqual({
      agent_id: agent!.id,
      requested_worker_id: second.worker.id,
      worker_id: null,
      claim_token_hash: null,
      execution_metrics_json: null,
    });
  });

  it("hands one queued run to exactly one of many concurrent claimers", async () => {
    await recordHuntEvent(db, projectId, queuedEvent("only-issue", 1));

    const claims = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        claimNextQueuedHuntRun(db, projectId, {
          claimTokenHash: `${index}`.padEnd(64, "f"),
          claimedBy: `worker-${index}`,
          claimedAt: atMinute(2),
          leaseExpiresAt: leaseExpiryFrom(atMinute(2)),
        }),
      ),
    );

    const won = claims.filter((claim) => claim !== null);
    expect(won).toHaveLength(1);
  });

  it("shares a queue of many runs across concurrent claimers without overlap", async () => {
    for (const key of ["issue-1", "issue-2", "issue-3"]) {
      await recordHuntEvent(db, projectId, queuedEvent(key, 1));
    }

    const claims = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        claimNextQueuedHuntRun(db, projectId, {
          claimTokenHash: `${index}`.padEnd(64, "e"),
          claimedBy: `worker-${index}`,
          claimedAt: atMinute(2),
          leaseExpiresAt: leaseExpiryFrom(atMinute(2)),
        }),
      ),
    );

    const runIds = claims.filter((claim) => claim !== null).map((claim) => claim!.id);
    expect(runIds).toHaveLength(3);
    expect(new Set(runIds).size).toBe(3);
  });

  it("enforces a shared device session limit inside the atomic claim", async () => {
    const registration = await register("e");
    await updateExecutionWorkerConcurrency(
      db,
      registration.device.id,
      2,
      atMinute(1),
    );
    for (const key of ["issue-1", "issue-2", "issue-3"]) {
      await recordHuntEvent(db, projectId, queuedEvent(key, 1));
    }
    const claim = (token: string) =>
      claimNextQueuedHuntRun(db, projectId, {
        claimTokenHash: token.repeat(64),
        claimedBy: "worker-e",
        claimedAt: atMinute(2),
        leaseExpiresAt: leaseExpiryFrom(atMinute(2)),
        workerId: registration.worker.id,
        workerDeviceId: registration.device.id,
      });
    const first = await claim("a");
    const second = await claim("b");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    await expect(claim("c")).resolves.toBeNull();
    await expect(
      countExecutionWorkerDeviceSessions(
        db,
        registration.device.id,
        atMinute(3),
      ),
    ).resolves.toBe(2);

    await recordHuntEvent(db, projectId, {
      ...queuedEvent("issue-1", 3),
      stage: "cancelled",
      eventKey: "issue-1:cancelled",
      claimToken: null,
    } as HuntEventInput);
    await expect(claim("c")).resolves.not.toBeNull();
  });

  it("does not treat backlog work as held or leased Auto Hunt work", async () => {
    const registration = await register("backlog");
    await recordHuntEvent(db, projectId, queuedEvent("issue-backlog", 1));
    const claimed = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: "f".repeat(64),
      claimedBy: "worker-backlog",
      claimedAt: atMinute(2),
      leaseExpiresAt: leaseExpiryFrom(atMinute(2)),
      workerId: registration.worker.id,
      workerDeviceId: registration.device.id,
    });
    await db
      .prepare(
        `update briar_hunt_runs
         set stage = 'queued', status = 'backlog', claim_token_hash = null,
             claimed_by = null, claimed_at = null, lease_expires_at = null
         where id = ?`,
      )
      .bind(claimed!.id)
      .run();

    expect(await countLeasedRuns(db, projectId, atMinute(3))).toBe(0);
    expect(await reapStalledHuntRuns(db, projectId, atMinute(60))).toEqual([]);
  });

  it("renews a lease for the holder and rejects a superseded token", async () => {
    const registration = await register("f");
    await recordHuntEvent(db, projectId, queuedEvent("issue-lease", 1));
    const claimTokenHash = "b".repeat(64);
    const claimed = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash,
      claimedBy: "worker-f",
      claimedAt: atMinute(2),
      leaseExpiresAt: leaseExpiryFrom(atMinute(2)),
      workerId: registration.worker.id,
      workerDeviceId: registration.device.id,
    });

    const renewed = await renewHuntRunLease(db, projectId, {
      runId: claimed!.id,
      claimTokenHash,
      observedAt: atMinute(10),
      workerId: "worker-f",
    });
    expect(renewed.lease_expires_at).toBe(leaseExpiryFrom(atMinute(10)));

    await expect(
      renewHuntRunLease(db, projectId, {
        runId: claimed!.id,
        claimTokenHash: "c".repeat(64),
        observedAt: atMinute(11),
        workerId: "worker-f",
      }),
    ).rejects.toBeInstanceOf(WorkerConflictError);
    await expect(
      renewHuntRunLease(db, projectId, {
        runId: claimed!.id,
        claimTokenHash,
        observedAt: atMinute(11),
        workerId: "worker-other",
      }),
    ).rejects.toBeInstanceOf(WorkerConflictError);
  });

  it("requeues a run whose worker stopped reporting, then blocks it after the ceiling", async () => {
    const registration = await register("g");
    await recordHuntEvent(db, projectId, queuedEvent("issue-stall", 1));
    const claimTokenHash = "d".repeat(64);
    const claimed = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash,
      claimedBy: "worker-g",
      claimedAt: atMinute(2),
      leaseExpiresAt: leaseExpiryFrom(atMinute(2)),
      workerId: registration.worker.id,
      workerDeviceId: registration.device.id,
    });
    // Move the run out of `queued`, where the claim check no longer gates writes.
    await recordHuntEvent(db, projectId, {
      ...queuedEvent("issue-stall", 3),
      stage: "analyzing",
      eventKey: "issue-stall:analyzing",
      claimToken: null,
    } as HuntEventInput);

    // Still inside the lease: nothing is reaped.
    expect(await reapStalledHuntRuns(db, projectId, atMinute(10))).toEqual([]);

    const reaped = await reapStalledHuntRuns(db, projectId, atMinute(40));
    expect(reaped).toEqual([
      {
        runId: claimed!.id,
        outcome: "requeued",
        workerId: "worker-g",
        claimAttempts: 1,
      },
    ]);

    const requeued = await db
      .prepare(
        `select status, stage, workflow_stage, detail, claim_token_hash,
                lease_expires_at
         from briar_hunt_runs where id = ?`,
      )
      .bind(claimed!.id)
      .first<{
        status: string;
        stage: string;
        workflow_stage: string | null;
        detail: string | null;
        claim_token_hash: string | null;
        lease_expires_at: string | null;
      }>();
    expect(requeued?.status).toBe("queued");
    expect(requeued?.stage).toBe("queued");
    expect(requeued?.workflow_stage).toBe("analyzing");
    expect(requeued?.detail).toBe("워커가 응답하지 않아 대기열로 돌아갔습니다.");
    expect(requeued?.claim_token_hash).toBeNull();
    expect(requeued?.lease_expires_at).toBeNull();

    const replacementClaim = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: "e".repeat(64),
      claimedBy: "worker-replacement",
      claimedAt: atMinute(41),
      leaseExpiresAt: leaseExpiryFrom(atMinute(41)),
      runId: claimed!.id,
    });
    expect(replacementClaim).toMatchObject({
      id: claimed!.id,
      status: "running",
      stage: "analyzing",
      workflow_stage: "analyzing",
      detail: "워커가 이전 작업 단계부터 이어받았습니다.",
      claimed_by: "worker-replacement",
      claim_attempts: 2,
    });

    // A run that has burned through its attempts is blocked instead of looping.
    await db
      .prepare(
        `update briar_hunt_runs
         set status = 'running', stage = 'analyzing', claim_attempts = ?,
             claim_token_hash = ?, lease_expires_at = ?
         where id = ?`,
      )
      .bind(MAX_CLAIM_ATTEMPTS, claimTokenHash, leaseExpiryFrom(atMinute(2)), claimed!.id)
      .run();
    const blocked = await reapStalledHuntRuns(db, projectId, atMinute(60));
    expect(blocked[0].outcome).toBe("blocked");
  });

  it("keeps a resumed run paused while replacing a stalled worker", async () => {
    await register("resume-stall");
    await recordHuntEvent(db, projectId, queuedEvent("issue-resume-stall", 1));
    const claimed = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: "f".repeat(64),
      claimedBy: "worker-resume-stall",
      claimedAt: atMinute(2),
      leaseExpiresAt: leaseExpiryFrom(atMinute(2)),
    });
    await db
      .prepare(
        `update briar_hunt_runs
         set status = 'running', stage = 'implementing', paused_at = null,
             resume_requested_at = ?, worker_id = ?
         where id = ?`,
      )
      .bind(atMinute(3), "worker-resume-stall", claimed!.id)
      .run();

    const reaped = await reapStalledHuntRuns(db, projectId, atMinute(40));
    expect(reaped[0]).toMatchObject({
      runId: claimed!.id,
      outcome: "requeued",
    });

    const paused = await db
      .prepare(
        `select status, stage, paused_at, resume_requested_at, claim_token_hash
         from briar_hunt_runs where id = ?`,
      )
      .bind(claimed!.id)
      .first<{
        status: string;
        stage: string;
        paused_at: string | null;
        resume_requested_at: string | null;
        claim_token_hash: string | null;
      }>();
    expect(paused).toEqual({
      status: "running",
      stage: "implementing",
      paused_at: atMinute(3),
      resume_requested_at: atMinute(3),
      claim_token_hash: null,
    });

    const replacementClaim = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: "a".repeat(64),
      claimedBy: "worker-replacement",
      claimedAt: atMinute(41),
      leaseExpiresAt: leaseExpiryFrom(atMinute(41)),
    });
    expect(replacementClaim?.id).toBe(claimed!.id);
    expect(replacementClaim?.paused_at).toBeNull();
    expect(replacementClaim?.stage).toBe("implementing");
  });

  it("counts only runs under a live lease", async () => {
    await recordHuntEvent(db, projectId, queuedEvent("issue-leased", 1));
    await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: "e".repeat(64),
      claimedBy: "worker-h",
      claimedAt: atMinute(2),
      leaseExpiresAt: leaseExpiryFrom(atMinute(2)),
    });
    expect(await countLeasedRuns(db, projectId, atMinute(3))).toBe(1);
    expect(await countLeasedRuns(db, projectId, atMinute(40))).toBe(0);
  });

  it("keeps claim attempts immutable across Worker reassignment", async () => {
    const firstCredential = "briar_worker_usage-ledger-first";
    const secondCredential = "briar_worker_usage-ledger-second";
    const firstWorker = await register(
      "usage-ledger-first",
      1,
      createHash("sha256").update(firstCredential).digest("hex"),
    );
    const secondWorker = await register(
      "usage-ledger-second",
      1,
      createHash("sha256").update(secondCredential).digest("hex"),
    );
    const runId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("issue-usage-ledger", 1),
    );
    const firstClaim = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: "1".repeat(64),
      claimedBy: "usage-ledger-first",
      claimedAt: atMinute(2),
      leaseExpiresAt: leaseExpiryFrom(atMinute(2)),
      runId,
      workerId: firstWorker.worker.id,
      workerDeviceId: firstWorker.device.id,
    });
    expect(firstClaim?.last_execution_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );

    await db
      .prepare(
        `update briar_hunt_runs set status = 'running', stage = 'analyzing'
         where id = ?`,
      )
      .bind(runId)
      .run();
    await reapStalledHuntRuns(db, projectId, atMinute(40));
    const secondClaim = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: "2".repeat(64),
      claimedBy: "usage-ledger-second",
      claimedAt: atMinute(41),
      leaseExpiresAt: leaseExpiryFrom(atMinute(41)),
      runId,
      workerId: secondWorker.worker.id,
      workerDeviceId: secondWorker.device.id,
    });
    expect(secondClaim?.last_execution_id).not.toBe(
      firstClaim?.last_execution_id,
    );
    expect(secondClaim?.claim_attempts).toBe(2);

    const attempts = await listOrganizationUsageExecutionAttempts(
      db,
      projectId,
      atMinute(0),
    );
    expect(attempts.filter((attempt) => attempt.run_id === runId)).toEqual([
      expect.objectContaining({
        id: firstClaim!.last_execution_id,
        run_attempt: firstClaim!.current_attempt,
        claim_attempt: 1,
        worker_id: firstWorker.worker.id,
      }),
      expect.objectContaining({
        id: secondClaim!.last_execution_id,
        run_attempt: secondClaim!.current_attempt,
        claim_attempt: 2,
        worker_id: secondWorker.worker.id,
      }),
    ]);
    await expect(
      claimNextQueuedHuntRun(db, projectId, {
        claimTokenHash: "3".repeat(64),
        claimedBy: "usage-ledger-missing",
        claimedAt: atMinute(42),
        leaseExpiresAt: leaseExpiryFrom(atMinute(42)),
        runId: "99999999-9999-4999-8999-999999999999",
      }),
    ).resolves.toBeNull();
    const attemptCount = await db
      .prepare(
        `select count(*) as count from briar_run_execution_attempts
         where run_id = ?`,
      )
      .bind(runId)
      .first<{ count: number }>();
    expect(attemptCount?.count).toBe(2);
  });

  it("accepts terminal final metrics only for the exact live completion claim", async () => {
    const credential = "briar_worker_terminal-metrics";
    const claimToken = "briar_claim_terminal_metrics_first";
    const worker = await register(
      "terminal-metrics",
      1,
      createHash("sha256").update(credential).digest("hex"),
    );
    const runId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("issue-terminal-metrics", 1),
    );
    const claim = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: createHash("sha256").update(claimToken).digest("hex"),
      claimedBy: worker.worker.label,
      claimedAt: atMinute(3),
      leaseExpiresAt: leaseExpiryFrom(atMinute(3)),
      runId,
      workerId: worker.worker.id,
      workerDeviceId: worker.device.id,
    });
    expect(claim?.last_execution_id).toEqual(expect.any(String));

    // This is the state left by `briar run complete` before the worker's
    // finally block uploads its final metrics payload.
    await db
      .prepare(
        `update briar_hunt_runs
         set status = 'completed', stage = 'completed', completed_at = ?,
             last_event_at = ?, updated_at = ?
         where id = ?`,
      )
      .bind(atMinute(4), atMinute(4), atMinute(4), runId)
      .run();

    const executionMetrics = {
      inputTokens: 1_000,
      outputTokens: 250,
      cacheReadTokens: 800,
      cacheWriteTokens: null,
      reasoningOutputTokens: 100,
      totalTokens: 1_250,
      durationMs: 90_000,
    };
    const telemetryBody = {
      projectId,
      work: {
        workId: runId,
        runId,
        claimToken,
        issue: {},
      },
      executionId: claim!.last_execution_id,
      agentProvider: "AGENT_PROVIDER_CODEX",
      executionMetrics: {
        inputTokens: "1000",
        outputTokens: "250",
        cacheReadTokens: "800",
        reasoningOutputTokens: "100",
        totalTokens: "1250",
        durationMs: "90000",
      },
      usageObservations: [{
        usageKey: "codex:terminal-metrics:usage",
        sessionId: "terminal-metrics-session",
        scopeId: "terminal",
        turnId: "terminal",
        agentProvider: "AGENT_PROVIDER_CODEX",
        modelProvider: "openai",
        model: "gpt-5.6-sol",
        modelSource: "AGENT_EXECUTION_MODEL_SOURCE_PROVIDER_REPORTED",
        source: "codex.terminal.metrics",
        uncachedInputTokens: "1000",
        cacheReadTokens: "800",
        outputTokens: "250",
        reasoningOutputTokens: "100",
        totalTokens: "1250",
        observedAt: atMinute(4),
      }],
      costObservations: [{
        costKey: "codex:terminal-metrics:cost",
        usageKey: "codex:terminal-metrics:usage",
        sessionId: "terminal-metrics-session",
        scopeId: "terminal",
        turnId: "terminal",
        agentProvider: "AGENT_PROVIDER_CODEX",
        modelProvider: "openai",
        model: "gpt-5.6-sol",
        modelSource: "AGENT_EXECUTION_MODEL_SOURCE_PROVIDER_REPORTED",
        source: "codex.terminal.metrics",
        amountUsdTicks: "12345678",
        observedAt: atMinute(4),
      }],
    };
    const env = {
      DB: db,
      ARCHIVES: archives,
      BETTER_AUTH_SECRET: "terminal-metrics-test-secret-terminal-metrics-test-secret",
      GOOGLE_CLIENT_ID: "google-client-test",
      GOOGLE_CLIENT_SECRET: "google-secret-test",
    } as unknown as Env;
    const postWorkerRpc = (method: string, body: Record<string, unknown>) =>
      apiWorker.fetch(
        new Request(
          `https://briar-api.example/briar.worker.v1.WorkerExecutionService/${method}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${credential}`,
              "connect-protocol-version": "1",
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          },
        ),
        env,
      );

    const accepted = await postWorkerRpc(
      "ReportIssueExecutionTelemetry",
      telemetryBody,
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      executionMetricsUpdated: true,
      usageObservationsStored: 1,
      costObservationsStored: 1,
    });

    const retry = await postWorkerRpc(
      "ReportIssueExecutionTelemetry",
      telemetryBody,
    );
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ executionMetricsUpdated: true });

    const storedMetrics = await db
      .prepare(
        `select execution_metrics_json from briar_hunt_runs where id = ?`,
      )
      .bind(runId)
      .first<{ execution_metrics_json: string }>();
    expect(JSON.parse(storedMetrics!.execution_metrics_json)).toEqual(
      executionMetrics,
    );
    await expect(
      listOrganizationUsageRecords(db, projectId, atMinute(0)),
    ).resolves.toHaveLength(1);
    await expect(
      listOrganizationUsageCostRecords(db, projectId, atMinute(0)),
    ).resolves.toHaveLength(1);

    const ordinaryLateTranscript = await postWorkerRpc(
      "AppendTranscriptEvents",
      {
        projectId,
        sessionId: "terminal-metrics-ordinary-late-write",
        work: telemetryBody.work,
        agentProvider: "AGENT_PROVIDER_CODEX",
        events: [{
          sequence: "2",
          direction: "AGENT_EVENT_DIRECTION_SERVER",
          rawPayload: { type: "ordinary.transcript" },
        }],
      },
    );
    expect(ordinaryLateTranscript.status).toBe(400);
    await expect(ordinaryLateTranscript.json()).resolves.toMatchObject({
      code: "failed_precondition",
    });

    const wrongClaim = await postWorkerRpc("ReportIssueExecutionTelemetry", {
      ...telemetryBody,
      work: {
        ...telemetryBody.work,
        claimToken: "briar_claim_terminal_metrics_wrong",
      },
    });
    expect(wrongClaim.status).toBe(400);
    await expect(wrongClaim.json()).resolves.toMatchObject({
      code: "failed_precondition",
    });

    await db
      .prepare(`update briar_hunt_runs set completed_at = ? where id = ?`)
      .bind(atMinute(20), runId)
      .run();
    const expiredCompletion = await postWorkerRpc(
      "ReportIssueExecutionTelemetry",
      telemetryBody,
    );
    expect(expiredCompletion.status).toBe(400);
    await expect(expiredCompletion.json()).resolves.toMatchObject({
      code: "failed_precondition",
    });
  });

  it("keeps cost-only runs and attempts inside the usage range", async () => {
    const runId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("issue-cost-only-range", 1),
    );
    const claim = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: "6".repeat(64),
      claimedBy: "cost-only-worker",
      claimedAt: atMinute(2),
      leaseExpiresAt: leaseExpiryFrom(atMinute(2)),
      runId,
    });
    expect(claim?.last_execution_id).toEqual(expect.any(String));
    await recordRunCostRecords(db, {
      executionId: claim!.last_execution_id!,
      recordedAt: atMinute(100),
      records: [
        {
          costKey: "opencode:step:late-cost",
          usageKey: null,
          sessionId: "cost-only-session",
          scopeId: "step-1",
          turnId: null,
          agentProvider: "opencode",
          modelProvider: "anthropic",
          model: "claude-sonnet-4-5",
          canonicalModel: null,
          modelSource: "providerReported",
          source: "opencode.step.cost",
          amountUsdTicks: 42,
          observedAt: atMinute(100),
        },
      ],
    });

    const since = atMinute(50);
    const attempts = await listOrganizationUsageExecutionAttempts(
      db,
      projectId,
      since,
    );
    const runs = await listOrganizationUsageRuns(db, projectId, since);

    expect(attempts.some((attempt) => attempt.id === claim!.last_execution_id)).toBe(true);
    expect(runs.some((run) => run.id === runId)).toBe(true);
  });

  it("keeps historical attempts when a transferred run restarts claim numbering", async () => {
    const runId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("issue-usage-transfer", 1),
    );
    const sourceClaim = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: "4".repeat(64),
      claimedBy: "source-project-worker",
      claimedAt: atMinute(2),
      leaseExpiresAt: leaseExpiryFrom(atMinute(2)),
      runId,
    });
    expect(sourceClaim?.claim_attempts).toBe(1);

    await expect(
      transferIssue(db, {
        sourceProjectId: projectId,
        targetProjectId: secondProjectId,
        targetProjectName: "Second",
        runId,
        observedAt: atMinute(40),
      }),
    ).resolves.toBe("transferred");
    const targetClaim = await claimNextQueuedHuntRun(db, secondProjectId, {
      claimTokenHash: "5".repeat(64),
      claimedBy: "target-project-worker",
      claimedAt: atMinute(41),
      leaseExpiresAt: leaseExpiryFrom(atMinute(41)),
      runId,
    });
    expect(targetClaim).toMatchObject({
      id: runId,
      project_id: secondProjectId,
      claim_attempts: 1,
      last_execution_id: expect.any(String),
    });
    expect(targetClaim?.last_execution_id).not.toBe(
      sourceClaim?.last_execution_id,
    );

    const attempts = await db
      .prepare(
        `select id, project_id, claim_attempt
         from briar_run_execution_attempts where run_id = ?
         order by claimed_at`,
      )
      .bind(runId)
      .all<{ id: string; project_id: string; claim_attempt: number }>();
    expect(attempts.results).toEqual([
      {
        id: sourceClaim!.last_execution_id!,
        project_id: projectId,
        claim_attempt: 1,
      },
      {
        id: targetClaim!.last_execution_id!,
        project_id: secondProjectId,
        claim_attempt: 1,
      },
    ]);
  });
});
