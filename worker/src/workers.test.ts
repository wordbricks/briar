import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimNextIssueAgentReply,
  claimNextQueuedHuntRun,
  createIssueDependency,
  createIssueMessage,
  enqueueIssueAgentReply,
  recordHuntEvent,
  type HuntEventInput,
} from "./db";
import {
  appendAgentTranscript,
  authenticateExecutionWorker,
  attributeRunToWorker,
  bindExecutionWorkerProject,
  countExecutionWorkerDeviceSessions,
  countLeasedRuns,
  disableExecutionWorker,
  dispatchHuntRun,
  executionWorkerBindingForProject,
  getProjectExecutionWorkerPolicy,
  leaseExpiryFrom,
  listExecutionWorkers,
  listOrganizationExecutionWorkers,
  MAX_CLAIM_ATTEMPTS,
  MAX_TRANSCRIPT_PAYLOAD_BYTES,
  MAX_TRANSCRIPT_SESSIONS_PER_PROJECT,
  reapStalledHuntRuns,
  readAgentTranscript,
  recordWorkerHeartbeat,
  registerExecutionWorker,
  renewHuntRunLease,
  TranscriptLimitError,
  unbindExecutionWorker,
  updateExecutionWorkerConcurrency,
  updateExecutionWorkerIcon,
  updateExecutionWorkerLabel,
  updateProjectExecutionWorkerPolicy,
  WorkerConflictError,
  workerStateAt,
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

const executeSql = async (db: D1Database, sql: string) => {
  for (const statement of sql.split(/;\s*(?:\n|$)/u)) {
    if (statement.trim()) await db.prepare(statement).run();
  }
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
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "briar-workers-test" },
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
      "migrations/0015_backlog_status.sql",
      "migrations/0016_project_agents.sql",
      "migrations/0017_default_auto_hunt_agent.sql",
      "migrations/0018_project_agent_schedules.sql",
      "migrations/0019_project_agent_schedule_runs.sql",
      "migrations/0020_project_agent_calendar_color.sql",
      "migrations/0021_run_evidence.sql",
      "migrations/0022_remove_workflow_presets.sql",
      "migrations/0023_project_agent_skills.sql",
      "migrations/0024_project_agent_avatars.sql",
      "migrations/0025_project_agent_codex_pets.sql",
      "migrations/0026_flexible_project_agent_schedules.sql",
      "migrations/0027_run_revisions.sql",
      "migrations/0029_structured_agent_results.sql",
      "migrations/0030_run_evidence_images.sql",
      "migrations/0031_organization_logos.sql",
      "migrations/0032_slack_integration.sql",
      "migrations/0033_organization_logo_browser_formats.sql",
      "migrations/0034_execution_worker_credentials.sql",
      "migrations/0035_detached_worker_dispatch.sql",
      "migrations/0036_execution_worker_concurrency.sql",
      "migrations/0038_project_execution_worker_policies.sql",
      "migrations/0039_project_agent_tokens.sql",
      "migrations/0040_run_execution_provider.sql",
      "migrations/0043_execution_worker_icons.sql",
      "migrations/0044_issue_agent_reply_jobs.sql",
      "migrations/0045_issue_execution_preferences.sql",
      "migrations/0046_project_icons.sql",
      "migrations/0047_project_icon_browser_formats.sql",
      "migrations/0048_issue_dependencies.sql",
    ]) {
      await executeSql(db, await readFile(resolve(migration), "utf8"));
    }
    await executeSql(
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
      values ('${projectId}', 'member', 'member', '${atMinute(0)}', '${atMinute(0)}');
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
        project_id, velen_org, linear_enabled, workflow_json, created_at, updated_at
      ) values (
        '${projectId}', 'example', 0,
        '{"version":1,"stages":[{"id":"analyzing","label":"분석","required":true},{"id":"implementing","label":"구현","required":true}],"execution":{"stopAfterStage":"implementing"},"completion":{"requiredStages":["analyzing","implementing"]}}',
        '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_project_settings (
        project_id, velen_org, linear_enabled, workflow_json, created_at, updated_at
      ) values (
        '${secondProjectId}', 'example', 0,
        '{"version":1,"stages":[{"id":"analyzing","label":"분석","required":true},{"id":"implementing","label":"구현","required":true}],"completion":{"requiredStages":["analyzing","implementing"]},"release":{"enabled":false}}',
        '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_project_agents (
        id, project_id, name, provider, model, responsibility,
        skill_markdown, created_at, updated_at
      ) values (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${projectId}',
        'Codex Agent', 'codex', null, 'Perform the assigned issue.',
        '# Codex Agent', '${atMinute(0)}', '${atMinute(0)}'
      );
    `,
    );
  }, 30_000);

  afterAll(async () => {
    await miniflare.dispose();
  });

  beforeEach(async () => {
    await executeSql(
      db,
      `delete from briar_agent_transcripts;
       delete from briar_agent_transcript_sessions;
       delete from briar_hunt_events;
       delete from briar_hunt_runs;
       delete from briar_project_execution_worker_allowlist;
       delete from briar_project_execution_worker_policies;
       delete from briar_execution_worker_credentials;
       delete from briar_execution_workers;
       delete from briar_execution_worker_devices;
       insert into briar_organization_members (
         organization_id, user_id, role, created_at, updated_at
       ) values (
         '${projectId}', 'member', 'member', '${atMinute(0)}', '${atMinute(0)}'
       ) on conflict (organization_id, user_id) do update set role = 'member';`,
    );
  });

  const register = (seed: string, minute = 1) =>
    registerExecutionWorker(db, projectId, {
      id: `worker-${seed}`,
      deviceId: `device-${seed}`,
      organizationId: projectId,
      ownerUserId: "owner",
      label: `worker ${seed}`,
      deviceIdentityHash: fingerprint(seed),
      credentialTokenHash: fingerprint(`token-${seed}`),
      agentProvider: "codex",
      providers: ["codex"],
      providerHealth: {
        codex: {
          installed: true,
          authenticated: true,
          healthy: true,
        },
      },
      versions: { briar: "1.1.1" },
      observedAt: atMinute(minute),
    });

  it("dispatches a queued issue to a selected Worker without an Agent", async () => {
    const selected = await register("agentless");
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
        requestId: "99999999-aaaa-4999-8999-999999999999",
        occurredAt: atMinute(2),
      }),
    ).resolves.toMatchObject({
      agentId: null,
      provider: "codex",
      requestedWorkerId: selected.worker.id,
      dispatchMode: "specific",
    });

    const claimed = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: fingerprint("agentless-claim"),
      claimedBy: selected.worker.label,
      claimedAt: atMinute(3),
      leaseExpiresAt: leaseExpiryFrom(atMinute(3)),
      workerId: selected.worker.id,
      agentProviders: ["codex"],
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
      body: "@briar what changed?",
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
        agentProviders: ["codex"],
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
        agentProviders: ["codex"],
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

  it("lets another worker answer when the previous worker is inaccessible", async () => {
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
      body: "@briar summarize the result",
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
        agentProviders: ["codex"],
        claimTokenHash: fingerprint("available-claim"),
        claimedAt: atMinute(12),
        leaseExpiresAt: atMinute(27),
        staleBefore: atMinute(9),
      }),
    ).resolves.toMatchObject({
      trigger_message_id: triggerMessageId,
      claimed_worker_id: fallback.worker.id,
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
      body: "@briar inspect the server record",
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
        agentProviders: ["codex"],
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
      agentProvider: "claude",
      versions: { briar: "1.2.0" },
      observedAt: atMinute(5),
    });
    expect(second.device.id).toBe(first.device.id);
    expect(second.worker.id).toBe(first.worker.id);
    expect(second.worker.label).toBe("renamed");
    expect(second.worker.agent_provider).toBe("claude");
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
      agentProvider: "codex",
      versions: { briar: "1.1.2" },
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

  it("renames a device and all of its project bindings together", async () => {
    const first = await register("rename");
    const second = await bindExecutionWorkerProject(db, secondProjectId, {
      id: "worker-rename-second",
      organizationId: projectId,
      ownerUserId: "owner",
      deviceIdentityHash: fingerprint("rename"),
      agentProvider: "codex",
      versions: {},
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

  it("stores one device icon and exposes it through every Worker listing", async () => {
    const registered = await register("icon");
    const icon = { type: "emoji", value: "🍋" } as const;

    await expect(
      updateExecutionWorkerIcon(
        db,
        registered.device.id,
        icon,
        atMinute(3),
      ),
    ).resolves.toMatchObject({
      icon_type: "emoji",
      icon_value: "🍋",
    });

    await expect(
      listOrganizationExecutionWorkers(db, projectId, atMinute(3)),
    ).resolves.toEqual([
      expect.objectContaining({
        icon,
      }),
    ]);
    await expect(
      listExecutionWorkers(db, projectId, atMinute(3)),
    ).resolves.toEqual([
      expect.objectContaining({
        icon_type: "emoji",
        icon_value: "🍋",
      }),
    ]);
    await expect(
      updateExecutionWorkerIcon(
        db,
        registered.device.id,
        { type: "emoji", value: "not-an-emoji" },
        atMinute(4),
      ),
    ).rejects.toThrow("one emoji");
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
      agentProvider: "grok",
      versions: { briar: "1.2.0" },
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
      agentProvider: "codex",
      versions: {},
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
      agentProvider: "codex",
      versions: {},
      observedAt: atMinute(2),
    });
    expect(
      await unbindExecutionWorker(
        db,
        first.device.id,
        projectId,
        atMinute(3),
      ),
    ).toBe(true);
    expect(
      await executionWorkerBindingForProject(db, first.device.id, projectId),
    ).toBeNull();
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
        agentProvider: "codex",
        versions: {},
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
      agentProvider: "codex",
      versions: {},
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
        agentProvider: "codex",
        versions: {},
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
        agentProvider: "codex",
        versions: {},
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
        agentProvider: "codex",
        versions: {},
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
      observedAt: atMinute(10),
    });
    expect((await listExecutionWorkers(db, projectId, atMinute(11)))[0].state).toBe(
      "online",
    );
    await expect(
      recordWorkerHeartbeat(db, projectId, {
        workerId: "worker-missing",
        observedAt: atMinute(11),
      }),
    ).rejects.toBeInstanceOf(WorkerConflictError);
  });

  it("keeps a disabled worker disabled through heartbeats", async () => {
    await register("d");
    await db
      .prepare(`update briar_execution_workers set state = 'disabled' where id = ?`)
      .bind("worker-d")
      .run();
    const row = await recordWorkerHeartbeat(db, projectId, {
      workerId: "worker-d",
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
      agentProvider: "codex",
      detachedOnly: true,
    });
    expect(wrongWorkerClaim).toBeNull();

    const assignedClaim = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: fingerprint("assigned-worker-claim"),
      claimedBy: first.worker.label,
      claimedAt: atMinute(3),
      leaseExpiresAt: leaseExpiryFrom(atMinute(3)),
      workerId: first.worker.id,
      agentProvider: "codex",
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
    await recordWorkerHeartbeat(db, projectId, {
      workerId: registered.worker.id,
      capabilities: {
        providers: ["codex", "claude", "grok"],
        providerHealth: {
          codex: { installed: true, authenticated: true, healthy: true },
          claude: { installed: true, authenticated: true, healthy: true },
          grok: { installed: true, authenticated: true, healthy: true },
        },
        worktrees: true,
      },
      observedAt: atMinute(2),
    });
    const claudeAgentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await db
      .prepare(
        `insert into briar_project_agents (
           id, project_id, name, provider, model, responsibility,
           skill_markdown, created_at, updated_at
         ) values (?, ?, 'Claude Agent', 'claude', null, 'Review the issue.',
                   '# Claude Agent', ?, ?)`,
      )
      .bind(claudeAgentId, projectId, atMinute(2), atMinute(2))
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
      agentProviders: ["codex", "claude", "grok"],
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
      "grok",
    ]);
  });

  it("routes a logical Agent through the explicitly selected provider", async () => {
    const registered = await register("provider-override");
    await recordWorkerHeartbeat(db, projectId, {
      workerId: registered.worker.id,
      capabilities: {
        providers: ["codex", "claude"],
        providerHealth: {
          codex: { installed: true, authenticated: true, healthy: true },
          claude: { installed: true, authenticated: true, healthy: true },
          grok: { installed: true, authenticated: false, healthy: false },
        },
        worktrees: true,
      },
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

    const wrongProviderClaim = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: fingerprint("wrong-provider-claim"),
      claimedBy: registered.worker.label,
      claimedAt: atMinute(4),
      leaseExpiresAt: leaseExpiryFrom(atMinute(4)),
      workerId: registered.worker.id,
      agentProvider: "codex",
      detachedOnly: true,
    });
    expect(wrongProviderClaim).toBeNull();

    const selectedProviderClaim = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: fingerprint("selected-provider-claim"),
      claimedBy: registered.worker.label,
      claimedAt: atMinute(4),
      leaseExpiresAt: leaseExpiryFrom(atMinute(4)),
      workerId: registered.worker.id,
      agentProvider: "claude",
      detachedOnly: true,
    });
    expect(selectedProviderClaim).toMatchObject({
      id: runId,
      agent_id: agent!.id,
      requested_agent_provider: "claude",
      worker_id: registered.worker.id,
    });
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
      agentProvider: "codex",
      detachedOnly: true,
    });
    expect(deniedClaim).toBeNull();
    const allowedClaim = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: fingerprint("policy-allowed-claim"),
      claimedBy: allowed.worker.label,
      claimedAt: atMinute(5),
      leaseExpiresAt: leaseExpiryFrom(atMinute(5)),
      workerId: allowed.worker.id,
      agentProvider: "codex",
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
      agentProvider: "codex",
      detachedOnly: true,
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
        `select agent_id, requested_worker_id, worker_id, claim_token_hash
         from briar_hunt_runs where id = ?`,
      )
      .bind(run)
      .first<{
        agent_id: string;
        requested_worker_id: string;
        worker_id: string | null;
        claim_token_hash: string | null;
      }>();
    expect(reassigned).toEqual({
      agent_id: agent!.id,
      requested_worker_id: second.worker.id,
      worker_id: null,
      claim_token_hash: null,
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
    await register("backlog");
    await recordHuntEvent(db, projectId, queuedEvent("issue-backlog", 1));
    const claimed = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: "f".repeat(64),
      claimedBy: "worker-backlog",
      claimedAt: atMinute(2),
      leaseExpiresAt: leaseExpiryFrom(atMinute(2)),
    });
    await attributeRunToWorker(db, projectId, {
      runId: claimed!.id,
      workerId: "worker-backlog",
      observedAt: atMinute(2),
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
    await register("f");
    await recordHuntEvent(db, projectId, queuedEvent("issue-lease", 1));
    const claimTokenHash = "b".repeat(64);
    const claimed = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash,
      claimedBy: "worker-f",
      claimedAt: atMinute(2),
      leaseExpiresAt: leaseExpiryFrom(atMinute(2)),
    });
    await attributeRunToWorker(db, projectId, {
      runId: claimed!.id,
      workerId: "worker-f",
      observedAt: atMinute(2),
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
    await register("g");
    await recordHuntEvent(db, projectId, queuedEvent("issue-stall", 1));
    const claimTokenHash = "d".repeat(64);
    const claimed = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash,
      claimedBy: "worker-g",
      claimedAt: atMinute(2),
      leaseExpiresAt: leaseExpiryFrom(atMinute(2)),
    });
    await attributeRunToWorker(db, projectId, {
      runId: claimed!.id,
      workerId: "worker-g",
      observedAt: atMinute(2),
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
      .prepare(`select status, claim_token_hash, lease_expires_at from briar_hunt_runs where id = ?`)
      .bind(claimed!.id)
      .first<{ status: string; claim_token_hash: string | null; lease_expires_at: string | null }>();
    expect(requeued?.status).toBe("queued");
    expect(requeued?.claim_token_hash).toBeNull();
    expect(requeued?.lease_expires_at).toBeNull();

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

  it("stores a transcript and reads it back in order", async () => {
    const result = await appendAgentTranscript(db, projectId, {
      sessionId: "session-1",
      runId: null,
      workerId: null,
      agentProvider: "codex",
      observedAt: atMinute(2),
      events: [
        { sequence: 1, direction: "client", payload: { type: "run" } },
        { sequence: 2, direction: "server", payload: { type: "messageDelta" } },
        { sequence: 3, direction: "server", payload: { type: "result" } },
      ],
    });
    expect(result.stored).toBe(3);

    const transcript = await readAgentTranscript(db, projectId, "session-1");
    expect(transcript?.session.event_count).toBe(3);
    expect(transcript?.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(JSON.parse(transcript!.events[0].payload_json)).toEqual({ type: "run" });

    const tail = await readAgentTranscript(db, projectId, "session-1", {
      afterSequence: 1,
    });
    expect(tail?.events.map((event) => event.sequence)).toEqual([2, 3]);
    const boundedTail = await readAgentTranscript(db, projectId, "session-1", {
      limit: 2,
      tail: true,
    });
    expect(boundedTail?.events.map((event) => event.sequence)).toEqual([2, 3]);
    expect(await readAgentTranscript(db, projectId, "session-missing")).toBeNull();
  });

  it("charges a retried batch only once", async () => {
    const batch = {
      sessionId: "session-retry",
      runId: null,
      workerId: null,
      agentProvider: "codex" as const,
      observedAt: atMinute(2),
      events: [{ sequence: 1, direction: "client" as const, payload: { type: "run" } }],
    };
    await appendAgentTranscript(db, projectId, batch);
    const retry = await appendAgentTranscript(db, projectId, batch);
    expect(retry.stored).toBe(0);
    const transcript = await readAgentTranscript(db, projectId, "session-retry");
    expect(transcript?.session.event_count).toBe(1);
    expect(transcript?.events).toHaveLength(1);
  });

  it("rejects oversized and malformed transcript events", async () => {
    const oversized = "x".repeat(MAX_TRANSCRIPT_PAYLOAD_BYTES + 1);
    await expect(
      appendAgentTranscript(db, projectId, {
        sessionId: "session-big",
        runId: null,
        workerId: null,
        agentProvider: "codex",
        observedAt: atMinute(2),
        events: [{ sequence: 1, direction: "server", payload: { text: oversized } }],
      }),
    ).rejects.toBeInstanceOf(TranscriptLimitError);

    await expect(
      appendAgentTranscript(db, projectId, {
        sessionId: "session-bad-sequence",
        runId: null,
        workerId: null,
        agentProvider: "codex",
        observedAt: atMinute(2),
        events: [{ sequence: 0, direction: "server", payload: {} }],
      }),
    ).rejects.toBeInstanceOf(TranscriptLimitError);

    await expect(
      appendAgentTranscript(db, projectId, {
        sessionId: "session-empty",
        runId: null,
        workerId: null,
        agentProvider: "codex",
        observedAt: atMinute(2),
        events: [],
      }),
    ).rejects.toBeInstanceOf(TranscriptLimitError);
  });

  it(
    "keeps transcript payloads until the verified archive job removes them",
    async () => {
      for (
        let index = 0;
        index < MAX_TRANSCRIPT_SESSIONS_PER_PROJECT + 3;
        index += 1
      ) {
        await appendAgentTranscript(db, projectId, {
          sessionId: `session-${String(index).padStart(3, "0")}`,
          runId: null,
          workerId: null,
          agentProvider: "codex",
          observedAt: atMinute(index + 1),
          events: [{ sequence: 1, direction: "client", payload: { index } }],
        });
      }

      const remaining = await db
        .prepare(
          `select count(*) as sessions from briar_agent_transcript_sessions where project_id = ?`,
        )
        .bind(projectId)
        .first<{ sessions: number }>();
      expect(remaining?.sessions).toBe(MAX_TRANSCRIPT_SESSIONS_PER_PROJECT + 3);

      // The append path must not remove a source row before R2 verification.
      expect(await readAgentTranscript(db, projectId, "session-000"))
        .not.toBeNull();
      expect(
        await readAgentTranscript(db, projectId, "session-052"),
      ).not.toBeNull();
      const orphans = await db
        .prepare(
          `select count(*) as events from briar_agent_transcripts where session_id = ?`,
        )
        .bind("session-000")
        .first<{ events: number }>();
      expect(orphans?.events).toBe(1);
    },
    20_000,
  );
});
