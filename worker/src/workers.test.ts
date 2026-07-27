import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimNextQueuedHuntRun, recordHuntEvent, type HuntEventInput } from "./db";
import {
  appendAgentTranscript,
  assertWorkerHasNoRunInFlight,
  attributeRunToWorker,
  countLeasedRuns,
  leaseExpiryFrom,
  listExecutionWorkers,
  MAX_CLAIM_ATTEMPTS,
  MAX_TRANSCRIPT_PAYLOAD_BYTES,
  MAX_TRANSCRIPT_SESSIONS_PER_PROJECT,
  reapStalledHuntRuns,
  readAgentTranscript,
  recordWorkerHeartbeat,
  registerExecutionWorker,
  renewHuntRunLease,
  TranscriptLimitError,
  WorkerConflictError,
  workerStateAt,
} from "./workers";

const projectId = "11111111-1111-4111-8111-111111111111";
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
    ]) {
      await executeSql(db, await readFile(resolve(migration), "utf8"));
    }
    await executeSql(
      db,
      `
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('owner', 'Owner', 'owner@example.com', 1, '${atMinute(0)}', '${atMinute(0)}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('${projectId}', 'Example Org', 'example-org', '${atMinute(0)}', '${atMinute(0)}');
      insert into briar_organization_members (organization_id, user_id, role, created_at, updated_at)
      values ('${projectId}', 'owner', 'owner', '${atMinute(0)}', '${atMinute(0)}');
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
        '{"version":1,"preset":"local","stages":[{"id":"analyzing","label":"분석","required":true},{"id":"implementing","label":"구현","required":true},{"id":"local_qa","label":"로컬 검증","required":true}]}',
        '${atMinute(0)}', '${atMinute(0)}'
      );
    `,
    );
  });

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
       delete from briar_execution_workers;`,
    );
  });

  const register = (seed: string, minute = 1) =>
    registerExecutionWorker(db, projectId, {
      id: `worker-${seed}`,
      label: `worker ${seed}`,
      hostFingerprint: fingerprint(seed),
      agentProvider: "codex",
      versions: { briar: "1.1.1" },
      observedAt: atMinute(minute),
    });

  it("registers a worker and adopts the same machine on restart", async () => {
    const first = await register("a");
    expect(first?.state).toBe("online");
    const second = await registerExecutionWorker(db, projectId, {
      id: "worker-different-id",
      label: "renamed",
      hostFingerprint: fingerprint("a"),
      agentProvider: "claude",
      versions: { briar: "1.2.0" },
      observedAt: atMinute(5),
    });
    expect(second?.id).toBe(first?.id);
    expect(second?.label).toBe("renamed");
    expect(second?.agent_provider).toBe("claude");
    const workers = await listExecutionWorkers(db, projectId, atMinute(5));
    expect(workers).toHaveLength(1);
  });

  it("rejects unusable labels and fingerprints", async () => {
    await expect(
      registerExecutionWorker(db, projectId, {
        id: "worker-bad",
        label: "   ",
        hostFingerprint: fingerprint("b"),
        agentProvider: "codex",
        versions: {},
        observedAt: atMinute(1),
      }),
    ).rejects.toBeInstanceOf(WorkerConflictError);
    await expect(
      registerExecutionWorker(db, projectId, {
        id: "worker-bad",
        label: "ok",
        hostFingerprint: "not-a-digest",
        agentProvider: "codex",
        versions: {},
        observedAt: atMinute(1),
      }),
    ).rejects.toBeInstanceOf(WorkerConflictError);
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

  it("refuses a second claim from a worker that already holds a run", async () => {
    await register("e");
    for (const key of ["issue-1", "issue-2"]) {
      await recordHuntEvent(db, projectId, queuedEvent(key, 1));
    }
    const claimed = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: "a".repeat(64),
      claimedBy: "worker-e",
      claimedAt: atMinute(2),
      leaseExpiresAt: leaseExpiryFrom(atMinute(2)),
    });
    await attributeRunToWorker(db, projectId, {
      runId: claimed!.id,
      workerId: "worker-e",
      observedAt: atMinute(2),
    });

    await expect(
      assertWorkerHasNoRunInFlight(db, projectId, "worker-e"),
    ).rejects.toBeInstanceOf(WorkerConflictError);

    await recordHuntEvent(db, projectId, {
      ...queuedEvent("issue-1", 3),
      stage: "cancelled",
      eventKey: "issue-1:cancelled",
      claimToken: null,
    } as HuntEventInput);
    await expect(
      assertWorkerHasNoRunInFlight(db, projectId, "worker-e"),
    ).resolves.toBeUndefined();
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

    await expect(
      assertWorkerHasNoRunInFlight(db, projectId, "worker-backlog"),
    ).resolves.toBeUndefined();
    expect(await countLeasedRuns(db, projectId, atMinute(3))).toBe(0);
    expect(await reapStalledHuntRuns(db, projectId, atMinute(60))).toEqual([]);
  });

  it("renews a lease for the holder and rejects a superseded token", async () => {
    await recordHuntEvent(db, projectId, queuedEvent("issue-lease", 1));
    const claimTokenHash = "b".repeat(64);
    const claimed = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash,
      claimedBy: "worker-f",
      claimedAt: atMinute(2),
      leaseExpiresAt: leaseExpiryFrom(atMinute(2)),
    });

    const renewed = await renewHuntRunLease(db, projectId, {
      runId: claimed!.id,
      claimTokenHash,
      observedAt: atMinute(10),
    });
    expect(renewed.lease_expires_at).toBe(leaseExpiryFrom(atMinute(10)));

    await expect(
      renewHuntRunLease(db, projectId, {
        runId: claimed!.id,
        claimTokenHash: "c".repeat(64),
        observedAt: atMinute(11),
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
      ],
    });
    expect(result.stored).toBe(2);

    const transcript = await readAgentTranscript(db, projectId, "session-1");
    expect(transcript?.session.event_count).toBe(2);
    expect(transcript?.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(JSON.parse(transcript!.events[0].payload_json)).toEqual({ type: "run" });

    const tail = await readAgentTranscript(db, projectId, "session-1", {
      afterSequence: 1,
    });
    expect(tail?.events.map((event) => event.sequence)).toEqual([2]);
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
    "prunes the oldest sessions past the project retention limit",
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
      expect(remaining?.sessions).toBe(MAX_TRANSCRIPT_SESSIONS_PER_PROJECT);

      // The oldest sessions go first, and their events go with them.
      expect(await readAgentTranscript(db, projectId, "session-000")).toBeNull();
      expect(
        await readAgentTranscript(db, projectId, "session-052"),
      ).not.toBeNull();
      const orphans = await db
        .prepare(
          `select count(*) as events from briar_agent_transcripts where session_id = ?`,
        )
        .bind("session-000")
        .first<{ events: number }>();
      expect(orphans?.events).toBe(0);
    },
    20_000,
  );
});
