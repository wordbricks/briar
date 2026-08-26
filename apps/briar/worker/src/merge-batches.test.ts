import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase } from "./test-helpers/d1";
import {
  blockMergeBatch,
  claimNextMergeBatch,
  completeMergeBatchPublication,
  type MergeBatchRow,
  type MergeBatchValidationResult,
  type MergeQueueAuthorityEntry,
  observeSignedMergedBatchPullRequest,
  reconcileReadyMergeCandidates,
  recordMergeBatchCandidateEnqueued,
  recordPreparedMergeBatch,
  recordMergeBatchValidationProof,
  recordSignedMergeQueuePullRequestObservation,
  recordSignedMergeGroupHead,
  registerReadyMergeCandidates,
  releaseMergeBatchLease,
  renewMergeBatchLease,
  sealNextMergeBatch,
  selectAuthoritativeMergeGroupHead,
} from "./merge-batches";

const baseTime = Date.parse("2026-08-21T00:00:00.000Z");
const installationId = 901;
const at = (scenario: number, seconds: number) =>
  new Date(baseTime + scenario * 1_000_000 + seconds * 1_000).toISOString();
const sha = (character: string) => character.repeat(40);
const tokenHash = (character: string) => character.repeat(64);
const workflow = JSON.stringify({
  version: 2,
  requirements: [],
  stages: [
    { id: "reviewing", label: "Review", required: false, evidence: [] },
    { id: "ci_qa", label: "CI", required: true, evidence: [] },
    { id: "merged", label: "Merge", required: true, evidence: [] },
  ],
  execution: { checkpoints: [] },
  completion: { requiredStages: ["ci_qa", "merged"] },
});
const validationContexts = [
  "app-worker",
  "d1-migrations",
  "rust",
  "security",
] as const;
const successfulValidationResults: MergeBatchValidationResult[] =
  validationContexts.map((context) => ({
    context,
    passed: true,
    exitCode: 0,
    failureCode: null,
    log: `${context} passed`,
    logSha256: tokenHash(context === "rust" ? "b" : "a"),
    logTruncated: false,
  }));
const failedValidationResults: MergeBatchValidationResult[] =
  successfulValidationResults.map((result) =>
    result.context === "rust"
      ? {
        ...result,
        passed: false,
        exitCode: 1,
        failureCode: "ci_failed",
        log: "rust failed",
      }
      : result
  );

type Lane = {
  scenario: number;
  projectId: string;
  repositoryId: number;
  repository: string;
  deviceId: string;
  workerId: string;
};

type ReadyRun = {
  runId: string;
  pullRequestNumbers: number[];
  headSha: string;
  baseSha: string;
};

describe("repository merge queue coordinator", () => {
  let fixture: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
  let db: D1Database;
  let runSequence = 0;

  beforeAll(async () => {
    fixture = await createIsolatedTestDatabase({ suite: "merge-batches-v2" });
    db = fixture.db;
    await db.batch([
      db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values ('merge-owner', 'Owner', 'merge-owner@example.com', 1, ?, ?)`,
      ).bind(at(0, 0), at(0, 0)),
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values ('merge-org', 'Merge Org', 'merge-org', ?, ?)`,
      ).bind(at(0, 0), at(0, 0)),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values ('merge-org', 'merge-owner', 'owner', ?, ?)`,
      ).bind(at(0, 0), at(0, 0)),
      db.prepare(
        `insert into briar_github_connections (
           installation_id, organization_id, installation_account_id,
           account_login, account_avatar_url, authorized_github_user_id,
           authorized_github_user_login, connected_by_user_id, status,
           connected_at, disconnected_at, updated_at
         ) values (?, 'merge-org', 1, 'wordbricks',
                   'https://avatars.githubusercontent.com/u/1', 1,
                   'merge-owner', 'merge-owner', 'connected', ?, null, ?)`,
      ).bind(installationId, at(0, 0), at(0, 0)),
    ]);
  });

  afterAll(async () => fixture.dispose());

  const setupLane = async (
    scenario: number,
    options: {
      enabled?: boolean;
      maxBatchSize?: number;
      maxConcurrentSessions?: number;
      deviceId?: string;
      quietWindowMs?: number;
      readinessStageId?: string;
    } = {},
  ): Promise<Lane> => {
    const projectId = `11111111-1111-4111-8111-${
      String(scenario).padStart(12, "0")
    }`;
    const repositoryId = 90_000 + scenario;
    const repository = `wordbricks/briar-${scenario}`;
    const deviceId = options.deviceId ??
      `33333333-3333-4333-8333-${String(scenario).padStart(12, "0")}`;
    const workerId = `44444444-4444-4444-8444-${
      String(scenario).padStart(12, "0")
    }`;
    await db.batch([
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, 'merge-owner', 'merge-org', ?, ?, ?, ?)`,
      ).bind(
        projectId,
        `Merge Project ${scenario}`,
        scenario.toString(16).padStart(64, "0"),
        at(scenario, 0),
        at(scenario, 0),
      ),
      db.prepare(
        `insert into briar_project_settings (
           project_id, workflow_json, mandatory_checkpoints_json,
           created_at, updated_at
         ) values (?, ?, '[]', ?, ?)`,
      ).bind(projectId, workflow, at(scenario, 0), at(scenario, 0)),
      db.prepare(
        `insert into briar_merge_queue_profiles (
           project_id, repository_id, repository, base_branch, enabled,
           readiness_stage_id, quiet_window_ms, max_batch_size, created_at,
           updated_at
         ) values (?, ?, ?, 'main', ?, ?, ?, ?, ?, ?)`,
      ).bind(
        projectId,
        repositoryId,
        repository,
        options.enabled === false ? 0 : 1,
        options.readinessStageId ?? "ci_qa",
        options.quietWindowMs ?? 1000,
        options.maxBatchSize ?? 5,
        at(scenario, 0),
        at(scenario, 0),
      ),
      db.prepare(
        `insert into briar_github_connection_repositories (
           installation_id, repository_id, owner, name, full_name,
           created_at, updated_at
         ) values (?, ?, 'wordbricks', ?, ?, ?, ?)`,
      ).bind(
        installationId,
        repositoryId,
        `briar-${scenario}`,
        repository,
        at(scenario, 0),
        at(scenario, 0),
      ),
      db.prepare(
        `insert or ignore into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, max_concurrent_sessions, last_heartbeat_at, created_at, updated_at
         ) values (?, 'merge-org', 'merge-owner', ?, ?, 'online', ?, ?, ?, ?)`,
      ).bind(
        deviceId,
        `Merge device ${scenario}`,
        (scenario + 100).toString(16).padStart(64, "0"),
        options.maxConcurrentSessions ?? 5,
        at(scenario, 0),
        at(scenario, 0),
        at(scenario, 0),
      ),
      db.prepare(
        `insert into briar_execution_workers (
           id, project_id, device_id, label, host_fingerprint, agent_provider,
           versions_json, capabilities_json, state, accepting_work,
           readiness_state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, ?, ?, 'codex', '{}', '{}', 'online', 1, 'ready',
                   ?, ?, ?)`,
      ).bind(
        workerId,
        projectId,
        deviceId,
        `Merge worker ${scenario}`,
        (scenario + 200).toString(16).padStart(64, "0"),
        at(scenario, 0),
        at(scenario, 0),
        at(scenario, 0),
      ),
    ]);
    return {
      scenario,
      projectId,
      repositoryId,
      repository,
      deviceId,
      workerId,
    };
  };

  const createReadyRun = async (
    lane: Lane,
    input: {
      readyAt: string;
      priority?: number;
      pullRequestCount?: number;
      headSha?: string;
      baseSha?: string;
      completedStageId?: string;
    },
  ): Promise<ReadyRun> => {
    runSequence += 1;
    const runId = `22222222-2222-4222-8222-${
      String(runSequence).padStart(12, "0")
    }`;
    const headSha = input.headSha ?? sha(((runSequence % 14) + 1).toString(16));
    const baseSha = input.baseSha ?? sha("a");
    const pullRequestCount = input.pullRequestCount ?? 1;
    const pullRequestNumbers = Array.from(
      { length: pullRequestCount },
      (_, index) => 10_000 + runSequence * 10 + index,
    );
    const statements = [
      db.prepare(
        `insert into briar_hunt_runs (
           id, project_id, source, source_key, title, stage, status,
           workflow_stage, repository, priority, branch, commit_sha,
           started_at, last_event_at, created_at, updated_at,
           workflow_snapshot_json
         ) values (?, ?, 'issue', ?, ?, 'implementing', 'running', ?,
                   ?, ?, 'briar/test', ?, ?, ?, ?, ?, ?)`,
      ).bind(
        runId,
        lane.projectId,
        `merge-run-${runSequence}`,
        `Merge run ${runSequence}`,
        input.completedStageId ?? "ci_qa",
        lane.repository,
        input.priority ?? null,
        headSha,
        input.readyAt,
        input.readyAt,
        input.readyAt,
        input.readyAt,
        workflow,
      ),
      db.prepare(
        `insert into briar_run_stage_progress (
           run_id, attempt, revision, stage_id, state, started_at, finished_at
         ) values (?, 1, 1, ?, 'completed', ?, ?)`,
      ).bind(
        runId,
        input.completedStageId ?? "ci_qa",
        input.readyAt,
        input.readyAt,
      ),
      ...pullRequestNumbers.map((pullRequestNumber) =>
        db.prepare(
          `insert into briar_run_pull_requests (
           project_id, run_id, attempt, revision, revision_started_at, url,
           installation_id, repository_id, repository,
           pull_request_id, pull_request_node_id,
           pull_request_number, state, draft, head_sha, base_sha, base_branch,
           opened_at, provider_updated_at, created_at, updated_at
         ) values (?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, ?, ?, 'main',
                   ?, ?, ?, ?)`,
        ).bind(
          lane.projectId,
          runId,
          input.readyAt,
          `https://github.com/${lane.repository}/pull/${pullRequestNumber}`,
          installationId,
          lane.repositoryId,
          lane.repository,
          100_000 + pullRequestNumber,
          `PR_${pullRequestNumber}`,
          pullRequestNumber,
          headSha,
          baseSha,
          input.readyAt,
          input.readyAt,
          input.readyAt,
          input.readyAt,
        )
      ),
    ];
    await db.batch(statements);
    return { runId, pullRequestNumbers, headSha, baseSha };
  };

  const registerRun = (lane: Lane, run: ReadyRun, readyAt: string) =>
    registerReadyMergeCandidates(db, {
      projectId: lane.projectId,
      runId: run.runId,
      attempt: 1,
      revision: 1,
      readyAt,
    });

  const claimAndEnqueue = async (
    lane: Lane,
    claimedAt: string,
    workerId = lane.workerId,
    claimTokenHash = tokenHash("b"),
  ) => {
    const claim = await claimNextMergeBatch(db, lane.projectId, {
      deviceId: lane.deviceId,
      workerId,
      claimedBy: workerId,
      claimTokenHash,
      claimedAt,
      leaseExpiresAt: new Date(Date.parse(claimedAt) + 60_000).toISOString(),
    });
    expect(claim).not.toBeNull();
    for (const member of claim!.members) {
      const recorded = await recordMergeBatchCandidateEnqueued(db, {
        batchId: claim!.batch.id,
        projectId: lane.projectId,
        workerId,
        claimTokenHash,
        candidateId: member.id,
        expectedHeadSha: member.frozen_head_sha,
        expectedBaseSha: member.frozen_base_sha,
        queueEntryId: `MQE_${lane.scenario}_${member.ordinal}`,
        observedAt: claimedAt,
      });
      expect(recorded).not.toBeNull();
    }
    const authorityEntries: MergeQueueAuthorityEntry[] = claim!.members.map(
      (member) => ({
        queueEntryId: `MQE_${lane.scenario}_${member.ordinal}`,
        pullRequestNumber: member.pull_request_number,
      }),
    );
    return { claim: claim!, workerId, claimTokenHash, authorityEntries };
  };

  const signedDelivery = async (
    deliveryId: string,
    eventName: "merge_group" | "pull_request",
    action: "checks_requested" | "closed",
    timestamp: string,
    completed = true,
  ) => {
    await db.prepare(
      `insert into briar_github_deliveries (
         delivery_id, event_name, action, status, claimed_at, completed_at
       ) values (?, ?, ?, ?, ?, ?)`,
    ).bind(
      deliveryId,
      eventName,
      action,
      completed ? "completed" : "processing",
      timestamp,
      completed ? timestamp : null,
    ).run();
  };

  const advanceToValidating = async (
    lane: Lane,
    runs: ReadyRun[],
    registeredAt: string,
  ) => {
    for (const run of runs) await registerRun(lane, run, registeredAt);
    const context = await claimAndEnqueue(lane, at(lane.scenario, 20));
    const tail = context.claim.members.at(-1)!;
    const deliveryId = `merge-final-${lane.scenario}`;
    const mergeGroupSha = sha("e");
    await signedDelivery(
      deliveryId,
      "merge_group",
      "checks_requested",
      at(lane.scenario, 21),
    );
    await recordSignedMergeGroupHead(db, {
      deliveryId,
      repositoryId: lane.repositoryId,
      repository: lane.repository,
      baseBranch: "main",
      headRef:
        `refs/heads/gh-readonly-queue/main/pr-${tail.pull_request_number}-signed`,
      headSha: mergeGroupSha,
      baseSha: tail.frozen_base_sha,
      tailPullRequestNumber: tail.pull_request_number,
      receivedAt: at(lane.scenario, 21),
    });
    const selected = await selectAuthoritativeMergeGroupHead(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: context.workerId,
      claimTokenHash: context.claimTokenHash,
      deliveryId,
      authorityEntries: context.authorityEntries,
      observedAt: at(lane.scenario, 22),
    });
    expect(selected?.batch.state).toBe("validating");
    return { ...context, mergeGroupSha };
  };

  const advanceToAwaitingMerge = async (
    lane: Lane,
    runs: ReadyRun[],
    registeredAt: string,
  ) => {
    const context = await advanceToValidating(lane, runs, registeredAt);
    const proof = await recordMergeBatchValidationProof(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: context.workerId,
      claimTokenHash: context.claimTokenHash,
      mergeGroupSha: context.mergeGroupSha,
      validationResults: successfulValidationResults,
      validatedAt: at(lane.scenario, 23),
    });
    expect(proof?.state).toBe("publishing");
    const published = await completeMergeBatchPublication(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: context.workerId,
      claimTokenHash: context.claimTokenHash,
      mergeGroupSha: context.mergeGroupSha,
      publishedAt: at(lane.scenario, 24),
    });
    expect(published?.state).toBe("awaiting_merge");
    return context;
  };

  it("registers only the workflow stage selected by the profile", async () => {
    const lane = await setupLane(40, { readinessStageId: "reviewing" });
    const ciRun = await createReadyRun(lane, {
      readyAt: at(40, 10),
      completedStageId: "ci_qa",
    });
    await expect(registerRun(lane, ciRun, at(40, 11))).resolves.toHaveLength(0);

    const reviewRun = await createReadyRun(lane, {
      readyAt: at(40, 12),
      completedStageId: "reviewing",
    });
    await expect(registerRun(lane, reviewRun, at(40, 13))).resolves
      .toHaveLength(1);
  });

  it("atomically seals five of six racing candidates and leaves one ready", async () => {
    const lane = await setupLane(2);
    const runs: ReadyRun[] = [];
    for (let index = 0; index < 6; index += 1) {
      runs.push(
        await createReadyRun(lane, {
          readyAt: at(2, index + 1),
          priority: index === 5 ? 1 : 2,
        }),
      );
    }
    await Promise.all(
      runs.map((run, index) => registerRun(lane, run, at(2, index + 1))),
    );
    const seals = await Promise.all(
      Array.from({ length: 6 }, () =>
        sealNextMergeBatch(db, {
          projectId: lane.projectId,
          observedAt: at(2, 8),
        })),
    );
    expect(seals.filter(Boolean)).toHaveLength(1);
    expect(seals.find(Boolean)?.members).toHaveLength(5);

    const candidates = await db.prepare(
      `select batch_id, ordinal, state from briar_merge_batch_candidates
       where project_id = ? order by ready_at`,
    ).bind(lane.projectId).all<{
      batch_id: string | null;
      ordinal: number | null;
      state: string;
    }>();
    expect(
      candidates.results.filter((candidate) => candidate.state === "frozen"),
    )
      .toHaveLength(5);
    expect(
      candidates.results.filter((candidate) =>
        candidate.state === "ready" && candidate.batch_id === null
      ),
    ).toHaveLength(1);
    expect(
      candidates.results
        .filter((candidate) => candidate.state === "frozen")
        .map((candidate) => candidate.ordinal)
        .sort(),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it("collects until five minutes after the latest ready PR", async () => {
    const lane = await setupLane(24, {
      maxBatchSize: 5,
      quietWindowMs: 300_000,
    });
    const first = await createReadyRun(lane, { readyAt: at(24, 1) });
    await registerRun(lane, first, at(24, 1));
    const second = await createReadyRun(lane, { readyAt: at(24, 61) });
    await registerRun(lane, second, at(24, 61));

    await expect(sealNextMergeBatch(db, {
      projectId: lane.projectId,
      observedAt: at(24, 301),
    })).resolves.toBeNull();
    await expect(sealNextMergeBatch(db, {
      projectId: lane.projectId,
      observedAt: at(24, 361),
    })).resolves.toMatchObject({
      batch: { state: "frozen" },
      members: [{ run_id: first.runId }, { run_id: second.runId }],
    });
  });

  it("fences renew, release, and enqueue after a lease is reclaimed", async () => {
    const lane = await setupLane(3);
    const run = await createReadyRun(lane, { readyAt: at(3, 1) });
    await registerRun(lane, run, at(3, 1));
    const first = await claimNextMergeBatch(db, lane.projectId, {
      deviceId: lane.deviceId,
      workerId: lane.workerId,
      claimedBy: "worker-old",
      claimTokenHash: tokenHash("c"),
      claimedAt: at(3, 3),
      leaseExpiresAt: at(3, 10),
    });
    expect(first).not.toBeNull();
    const second = await claimNextMergeBatch(db, lane.projectId, {
      deviceId: lane.deviceId,
      workerId: lane.workerId,
      claimedBy: "worker-new",
      claimTokenHash: tokenHash("d"),
      claimedAt: at(3, 11),
      leaseExpiresAt: at(3, 30),
    });
    expect(second?.batch.claim_attempts).toBe(2);

    await expect(renewMergeBatchLease(db, {
      batchId: first!.batch.id,
      projectId: lane.projectId,
      workerId: lane.workerId,
      claimTokenHash: tokenHash("c"),
      authenticatedAt: at(3, 12),
      leaseExpiresAt: at(3, 40),
    })).resolves.toBeNull();
    await expect(releaseMergeBatchLease(db, {
      batchId: first!.batch.id,
      projectId: lane.projectId,
      workerId: lane.workerId,
      claimTokenHash: tokenHash("c"),
      authenticatedAt: at(3, 12),
    })).resolves.toBe(false);
    await expect(recordMergeBatchCandidateEnqueued(db, {
      batchId: first!.batch.id,
      projectId: lane.projectId,
      workerId: lane.workerId,
      claimTokenHash: tokenHash("c"),
      candidateId: first!.members[0]!.id,
      expectedHeadSha: first!.members[0]!.frozen_head_sha,
      expectedBaseSha: first!.members[0]!.frozen_base_sha,
      queueEntryId: "MQE_STALE",
      observedAt: at(3, 12),
    })).resolves.toBeNull();

    const current = second!.members[0]!;
    await expect(recordMergeBatchCandidateEnqueued(db, {
      batchId: second!.batch.id,
      projectId: lane.projectId,
      workerId: lane.workerId,
      claimTokenHash: tokenHash("d"),
      candidateId: current.id,
      expectedHeadSha: current.frozen_head_sha,
      expectedBaseSha: current.frozen_base_sha,
      queueEntryId: "MQE_CURRENT",
      observedAt: at(3, 12),
    })).resolves.toMatchObject({ batch: { state: "waiting_tail" } });
  });

  it("claims waiting cohorts without merge_group input and seals an integration ref", async () => {
    const lane = await setupLane(25);
    const run = await createReadyRun(lane, { readyAt: at(25, 1) });
    await registerRun(lane, run, at(25, 1));
    const context = await claimAndEnqueue(lane, at(25, 3));
    await expect(releaseMergeBatchLease(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: lane.workerId,
      claimTokenHash: context.claimTokenHash,
      authenticatedAt: at(25, 4),
    })).resolves.toBe(true);

    const preparedClaim = await claimNextMergeBatch(db, lane.projectId, {
      deviceId: lane.deviceId,
      workerId: lane.workerId,
      claimedBy: "integration-25",
      claimTokenHash: tokenHash("e"),
      claimedAt: at(25, 5),
      leaseExpiresAt: at(25, 40),
    });
    expect(preparedClaim).toMatchObject({
      phase: "tail_authority",
      pendingHeads: [],
      batch: { state: "waiting_tail" },
    });
    const integrationSha = sha("f");
    await expect(recordPreparedMergeBatch(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: lane.workerId,
      claimTokenHash: tokenHash("e"),
      integrationRef:
        `refs/heads/briar/merge-queue/${context.claim.batch.id}`,
      integrationSha,
      baseSha: sha("1"),
      observedAt: at(25, 6),
    })).resolves.toMatchObject({
      state: "validating",
      final_delivery_id: `integration:${integrationSha}`,
      merge_group_sha: integrationSha,
      merge_group_base_sha: sha("1"),
    });
  });

  it("blocks a sealed generation when its PR is force-pushed", async () => {
    const lane = await setupLane(4);
    const run = await createReadyRun(lane, {
      readyAt: at(4, 1),
      headSha: sha("4"),
    });
    await registerRun(lane, run, at(4, 1));
    const sealed = await sealNextMergeBatch(db, {
      projectId: lane.projectId,
      observedAt: at(4, 3),
    });
    expect(sealed?.batch.state).toBe("frozen");

    await db.prepare(
      `update briar_run_pull_requests set head_sha = ?, updated_at = ?
       where run_id = ? and attempt = 1 and revision = 1`,
    ).bind(sha("5"), at(4, 4), run.runId).run();
    const reconciled = await reconcileReadyMergeCandidates(db, {
      projectId: lane.projectId,
      runId: run.runId,
      observedAt: at(4, 4),
    });
    expect(reconciled.invalidatedSealed).toBe(1);
    expect(reconciled.blockedBatches).toBe(1);
    expect(
      await db.prepare(
        "select state from briar_merge_batches where id = ?",
      ).bind(sealed!.batch.id).first<{ state: string }>(),
    )
      .toEqual({ state: "blocked" });
    await expect(claimNextMergeBatch(db, lane.projectId, {
      deviceId: lane.deviceId,
      workerId: lane.workerId,
      claimedBy: "worker-force-push",
      claimTokenHash: tokenHash("f"),
      claimedAt: at(4, 5),
      leaseExpiresAt: at(4, 30),
    })).resolves.toBeNull();
  });

  it("does not revive old readiness proof after an out-of-order force-push", async () => {
    const lane = await setupLane(16);
    const originalHead = sha("4");
    const run = await createReadyRun(lane, {
      readyAt: at(16, 1),
      headSha: originalHead,
    });
    await registerRun(lane, run, at(16, 1));
    await db.prepare(
      `update briar_run_stage_progress set finished_at = ?
       where run_id = ? and attempt = 1 and revision = 1 and stage_id = 'ci_qa'`,
    ).bind("2026-08-21T13:26:41+09:00", run.runId).run();

    // The newer A-return delivery may win the mutable snapshot before a
    // delayed B delivery arrives. Append-only signed identity still records
    // B and invalidates the older ci_qa proof.
    await recordSignedMergeQueuePullRequestObservation(db, {
      deliveryId: "force-push-returned-a",
      repositoryId: lane.repositoryId,
      pullRequestNumber: run.pullRequestNumbers[0]!,
      action: "synchronize",
      identityChanged: true,
      headSha: originalHead,
      baseBranch: "main",
      receivedAt: at(16, 2),
    });
    await recordSignedMergeQueuePullRequestObservation(db, {
      deliveryId: "force-push-delayed-b",
      repositoryId: lane.repositoryId,
      pullRequestNumber: run.pullRequestNumbers[0]!,
      action: "synchronize",
      identityChanged: true,
      headSha: sha("5"),
      baseBranch: "main",
      receivedAt: at(16, 3),
    });
    await expect(reconcileReadyMergeCandidates(db, {
      projectId: lane.projectId,
      runId: run.runId,
      observedAt: at(16, 3),
    })).resolves.toMatchObject({ invalidatedReady: 1 });

    const stale = await registerRun(lane, run, at(16, 4));
    expect(stale).toMatchObject([{
      state: "failed",
      failure_code: "readiness_changed",
      frozen_head_sha: originalHead,
    }]);
    await expect(sealNextMergeBatch(db, {
      projectId: lane.projectId,
      observedAt: at(16, 4),
    })).resolves.toBeNull();

    // A genuinely newer ci_qa completion forms a fresh proof boundary and
    // may safely make the exact current head eligible again.
    await db.prepare(
      `update briar_run_stage_progress set finished_at = ?
       where run_id = ? and attempt = 1 and revision = 1 and stage_id = 'ci_qa'`,
    ).bind(at(16, 5), run.runId).run();
    const refreshed = await registerRun(lane, run, at(16, 6));
    expect(refreshed).toMatchObject([{
      state: "ready",
      frozen_head_sha: originalHead,
      failure_code: null,
    }]);
  });

  it("keeps force-push history while a configured profile is disabled", async () => {
    const lane = await setupLane(19, { enabled: false });
    const run = await createReadyRun(lane, {
      readyAt: at(19, 1),
      headSha: sha("4"),
    });
    await recordSignedMergeQueuePullRequestObservation(db, {
      deliveryId: "disabled-profile-force-return",
      repositoryId: lane.repositoryId,
      pullRequestNumber: run.pullRequestNumbers[0]!,
      action: "synchronize",
      identityChanged: true,
      headSha: run.headSha,
      baseBranch: "main",
      receivedAt: at(19, 2),
    });
    await db.prepare(
      `update briar_merge_queue_profiles set enabled = 1, updated_at = ?
       where project_id = ?`,
    ).bind(at(19, 3), lane.projectId).run();

    await expect(registerRun(lane, run, at(19, 3))).resolves.toEqual([]);
    await expect(sealNextMergeBatch(db, {
      projectId: lane.projectId,
      observedAt: at(19, 5),
    })).resolves.toBeNull();
  });

  it("requires readiness completion after the merge-queue profile was configured", async () => {
    const lane = await setupLane(20, { enabled: false });
    const run = await createReadyRun(lane, {
      readyAt: at(20, 1),
      headSha: sha("5"),
    });
    await db.prepare(
      `update briar_merge_queue_profiles
       set enabled = 1, created_at = ?, updated_at = ? where project_id = ?`,
    ).bind(at(20, 2), at(20, 2), lane.projectId).run();
    await expect(registerRun(lane, run, at(20, 3))).resolves.toEqual([]);

    await db.prepare(
      `update briar_run_stage_progress set finished_at = ?
       where run_id = ? and attempt = 1 and revision = 1 and stage_id = 'ci_qa'`,
    ).bind(at(20, 4), run.runId).run();
    await expect(registerRun(lane, run, at(20, 4))).resolves.toMatchObject([{
      state: "ready",
      frozen_head_sha: run.headSha,
    }]);
  });

  it("requires fresh readiness proof after a GitHub integration reconnect", async () => {
    const lane = await setupLane(21);
    const run = await createReadyRun(lane, {
      readyAt: at(21, 1),
      headSha: sha("6"),
    });
    await registerRun(lane, run, at(21, 1));
    await db.prepare(
      `update briar_github_connections
       set status = 'disconnected', disconnected_at = ?, updated_at = ?
       where installation_id = ?`,
    ).bind(at(21, 2), at(21, 2), installationId).run();
    await expect(reconcileReadyMergeCandidates(db, {
      projectId: lane.projectId,
      runId: run.runId,
      observedAt: at(21, 2),
    })).resolves.toMatchObject({ invalidatedReady: 1 });

    await db.prepare(
      `update briar_github_connections
       set status = 'connected', connected_at = ?, disconnected_at = null,
           updated_at = ? where installation_id = ?`,
    ).bind(at(21, 3), at(21, 3), installationId).run();
    await expect(registerRun(lane, run, at(21, 3))).resolves.toMatchObject([{
      state: "failed",
      failure_code: "readiness_changed",
    }]);

    await db.prepare(
      `update briar_run_stage_progress set finished_at = ?
       where run_id = ? and attempt = 1 and revision = 1 and stage_id = 'ci_qa'`,
    ).bind(at(21, 4), run.runId).run();
    await expect(registerRun(lane, run, at(21, 4))).resolves.toMatchObject([{
      state: "ready",
      frozen_head_sha: run.headSha,
    }]);
    await db.prepare(
      `update briar_github_connections set connected_at = ?, updated_at = ?
       where installation_id = ?`,
    ).bind(at(0, 0), at(21, 5), installationId).run();
  });

  it("requires fresh readiness proof after repository access is restored", async () => {
    const lane = await setupLane(22);
    const run = await createReadyRun(lane, {
      readyAt: at(22, 1),
      headSha: sha("7"),
    });
    await registerRun(lane, run, at(22, 1));
    await db.prepare(
      `delete from briar_github_connection_repositories
       where installation_id = ? and repository_id = ?`,
    ).bind(installationId, lane.repositoryId).run();
    await expect(reconcileReadyMergeCandidates(db, {
      projectId: lane.projectId,
      runId: run.runId,
      observedAt: at(22, 2),
    })).resolves.toMatchObject({ invalidatedReady: 1 });

    await db.prepare(
      `insert into briar_github_connection_repositories (
         installation_id, repository_id, owner, name, full_name,
         created_at, updated_at
       ) values (?, ?, 'wordbricks', 'briar-22', ?, ?, ?)`,
    ).bind(
      installationId, lane.repositoryId, lane.repository,
      at(22, 3), at(22, 3),
    ).run();
    await expect(registerRun(lane, run, at(22, 3))).resolves.toMatchObject([{
      state: "failed",
      failure_code: "readiness_changed",
    }]);

    await db.prepare(
      `update briar_run_stage_progress set finished_at = ?
       where run_id = ? and attempt = 1 and revision = 1 and stage_id = 'ci_qa'`,
    ).bind(at(22, 4), run.runId).run();
    await expect(registerRun(lane, run, at(22, 4))).resolves.toMatchObject([{
      state: "ready",
      frozen_head_sha: run.headSha,
    }]);
  });

  it("accepts main SHA advance without weakening the base-branch fence", async () => {
    const lane = await setupLane(17);
    const run = await createReadyRun(lane, {
      readyAt: at(17, 1),
      headSha: sha("6"),
      baseSha: sha("1"),
    });
    await registerRun(lane, run, at(17, 1));
    const sealed = await sealNextMergeBatch(db, {
      projectId: lane.projectId,
      observedAt: at(17, 3),
    });
    expect(sealed).toMatchObject({ batch: { state: "frozen" } });

    await db.prepare(
      `update briar_run_pull_requests
       set base_sha = ?, base_branch = 'main', updated_at = ?
       where run_id = ? and attempt = 1 and revision = 1`,
    ).bind(sha("2"), at(17, 4), run.runId).run();
    await expect(reconcileReadyMergeCandidates(db, {
      projectId: lane.projectId,
      runId: run.runId,
      observedAt: at(17, 4),
    })).resolves.toMatchObject({
      invalidatedSealed: 0,
      blockedBatches: 0,
    });
    await expect(claimNextMergeBatch(db, lane.projectId, {
      deviceId: lane.deviceId,
      workerId: lane.workerId,
      claimedBy: "main-drift",
      claimTokenHash: tokenHash("1"),
      claimedAt: at(17, 5),
      leaseExpiresAt: at(17, 40),
    })).resolves.toMatchObject({
      phase: "enqueue",
      members: [{ frozen_base_sha: sha("1") }],
    });
  });

  it("blocks a sealed PR when a signed webhook retargets its base branch", async () => {
    const lane = await setupLane(18);
    const run = await createReadyRun(lane, {
      readyAt: at(18, 1),
      headSha: sha("7"),
    });
    await registerRun(lane, run, at(18, 1));
    const sealed = await sealNextMergeBatch(db, {
      projectId: lane.projectId,
      observedAt: at(18, 3),
    });
    expect(sealed).toMatchObject({ batch: { state: "frozen" } });

    await db.prepare(
      `update briar_run_pull_requests
       set base_sha = ?, base_branch = 'release', updated_at = ?
       where run_id = ? and attempt = 1 and revision = 1`,
    ).bind(sha("8"), at(18, 4), run.runId).run();
    await expect(reconcileReadyMergeCandidates(db, {
      projectId: lane.projectId,
      runId: run.runId,
      observedAt: at(18, 4),
    })).resolves.toMatchObject({
      invalidatedSealed: 1,
      blockedBatches: 1,
    });
    await expect(
      db.prepare("select state from briar_merge_batches where id = ?")
        .bind(sealed!.batch.id)
        .first<{ state: string }>(),
    ).resolves.toEqual({ state: "blocked" });
  });

  it("selects only the exact final cumulative head regardless of arrival order", async () => {
    const lane = await setupLane(5);
    const runs = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        createReadyRun(lane, {
          readyAt: at(5, index + 1),
          headSha: sha("6"),
          baseSha: sha(String(index + 1)),
        })),
    );
    for (const [index, run] of runs.entries()) {
      await registerRun(lane, run, at(5, index + 1));
    }
    const context = await claimAndEnqueue(lane, at(5, 10));
    const members = context.claim.members;
    const deliveries = ["tail-final-5", "tail-first-5", "tail-second-5"];
    for (const deliveryId of deliveries) {
      await signedDelivery(
        deliveryId,
        "merge_group",
        "checks_requested",
        at(5, 11),
      );
    }
    await signedDelivery(
      "tail-mislabeled-5",
      "merge_group",
      "checks_requested",
      at(5, 11),
    );
    await expect(recordSignedMergeGroupHead(db, {
      deliveryId: "tail-mislabeled-5",
      repositoryId: lane.repositoryId,
      repository: lane.repository,
      baseBranch: "main",
      headRef: `refs/heads/gh-readonly-queue/main/pr-${
        members[0]!.pull_request_number
      }-signed`,
      headSha: sha("7"),
      baseSha: sha("d"),
      tailPullRequestNumber: members[2]!.pull_request_number,
      receivedAt: at(5, 11),
    })).resolves.toBeNull();
    // The authoritative tail arrives first; two intermediate cumulative heads
    // arrive later and must remain neutral until exact queue authority exists.
    for (
      const [deliveryId, member] of [
        [deliveries[0]!, members[2]!],
        [deliveries[1]!, members[0]!],
        [deliveries[2]!, members[1]!],
      ] as const
    ) {
      await recordSignedMergeGroupHead(db, {
        deliveryId,
        repositoryId: lane.repositoryId,
        repository: lane.repository,
        baseBranch: "main",
        headRef:
          `refs/heads/gh-readonly-queue/main/pr-${member.pull_request_number}-signed`,
        headSha: sha(deliveryId === deliveries[0] ? "7" : "8"),
        baseSha: sha("d"),
        tailPullRequestNumber: member.pull_request_number,
        receivedAt: at(5, 11),
      });
    }

    await expect(releaseMergeBatchLease(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: context.workerId,
      claimTokenHash: context.claimTokenHash,
      authenticatedAt: at(5, 12),
    })).resolves.toBe(true);
    const authority = await claimNextMergeBatch(db, lane.projectId, {
      deviceId: lane.deviceId,
      workerId: lane.workerId,
      claimedBy: "authority-5",
      claimTokenHash: tokenHash("9"),
      claimedAt: at(5, 13),
      leaseExpiresAt: at(5, 50),
    });
    expect(authority).toMatchObject({
      phase: "tail_authority",
      batch: { state: "waiting_tail" },
    });
    expect(authority?.pendingHeads).toHaveLength(3);

    await expect(selectAuthoritativeMergeGroupHead(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: lane.workerId,
      claimTokenHash: tokenHash("9"),
      deliveryId: deliveries[0]!,
      authorityEntries: [
        context.authorityEntries[0]!,
        { queueEntryId: "MQE_EXTERNAL", pullRequestNumber: 999_999 },
        context.authorityEntries[2]!,
      ],
      observedAt: at(5, 14),
    })).resolves.toBeNull();
    await expect(selectAuthoritativeMergeGroupHead(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: lane.workerId,
      claimTokenHash: tokenHash("9"),
      deliveryId: deliveries[1]!,
      authorityEntries: context.authorityEntries.slice(0, 1),
      observedAt: at(5, 14),
    })).resolves.toBeNull();

    const selected = await selectAuthoritativeMergeGroupHead(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: lane.workerId,
      claimTokenHash: tokenHash("9"),
      deliveryId: deliveries[0]!,
      authorityEntries: context.authorityEntries,
      observedAt: at(5, 14),
    });
    expect(selected).toMatchObject({
      batch: { state: "validating", final_delivery_id: deliveries[0] },
      head: { state: "selected" },
    });
    const heads = await db.prepare(
      `select delivery_id, state from briar_merge_group_heads
       where batch_id = ? order by delivery_id`,
    ).bind(context.claim.batch.id).all<
      { delivery_id: string; state: string }
    >();
    expect(heads.results).toEqual([
      { delivery_id: "tail-final-5", state: "selected" },
      { delivery_id: "tail-first-5", state: "superseded" },
      { delivery_id: "tail-second-5", state: "superseded" },
    ]);

    const lateDelivery = "tail-late-5";
    await signedDelivery(
      lateDelivery,
      "merge_group",
      "checks_requested",
      at(5, 15),
    );
    await expect(recordSignedMergeGroupHead(db, {
      deliveryId: lateDelivery,
      repositoryId: lane.repositoryId,
      repository: lane.repository,
      baseBranch: "main",
      headRef: `refs/heads/gh-readonly-queue/main/pr-${
        members[0]!.pull_request_number
      }-late`,
      headSha: sha("9"),
      baseSha: members[0]!.frozen_base_sha,
      tailPullRequestNumber: members[0]!.pull_request_number,
      receivedAt: at(5, 15),
    })).resolves.toMatchObject({ state: "superseded" });

    const proof = await recordMergeBatchValidationProof(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: lane.workerId,
      claimTokenHash: tokenHash("9"),
      mergeGroupSha: sha("7"),
      validationResults: successfulValidationResults,
      validatedAt: at(5, 16),
    });
    expect(proof?.state).toBe("publishing");
    await expect(releaseMergeBatchLease(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: lane.workerId,
      claimTokenHash: tokenHash("9"),
      authenticatedAt: at(5, 17),
    })).resolves.toBe(true);
    await expect(completeMergeBatchPublication(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: lane.workerId,
      claimTokenHash: tokenHash("9"),
      mergeGroupSha: sha("7"),
      publishedAt: at(5, 18),
    })).resolves.toBeNull();
    const publisher = await claimNextMergeBatch(db, lane.projectId, {
      deviceId: lane.deviceId,
      workerId: lane.workerId,
      claimedBy: "publisher-5",
      claimTokenHash: tokenHash("e"),
      claimedAt: at(5, 18),
      leaseExpiresAt: at(5, 40),
    });
    expect(publisher).toMatchObject({
      batch: {
        state: "publishing",
        validation_results_json: JSON.stringify(successfulValidationResults),
      },
    });
    const published = await completeMergeBatchPublication(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: lane.workerId,
      claimTokenHash: tokenHash("e"),
      mergeGroupSha: sha("7"),
      publishedAt: at(5, 19),
    });
    expect(published).toMatchObject({
      state: "awaiting_merge",
      claim_token_hash: null,
    });
  });

  it("holds the lane until every original PR has a signed merged delivery", async () => {
    const lane = await setupLane(6);
    const originals = await Promise.all(
      Array.from(
        { length: 3 },
        (_, index) =>
          createReadyRun(lane, {
            readyAt: at(6, index + 1),
            headSha: sha("b"),
          }),
      ),
    );
    const context = await advanceToAwaitingMerge(lane, originals, at(6, 5));
    const late = await createReadyRun(lane, {
      readyAt: at(6, 25),
      headSha: sha("c"),
    });
    await registerRun(lane, late, at(6, 25));
    expect(
      await db.prepare(
        `select count(*) as count from briar_merge_batches
       where repository_id = ? and state = 'collecting'`,
      ).bind(lane.repositoryId).first<number>("count"),
    ).toBe(0);

    for (const [index, member] of context.claim.members.entries()) {
      const deliveryId =
        `merged-${lane.scenario}-${member.pull_request_number}`;
      const mergedAt = at(6, 30 + index);
      const advancedBaseSha = sha((["d", "e", "f"] as const)[index]!);
      await signedDelivery(
        deliveryId,
        "pull_request",
        "closed",
        mergedAt,
        false,
      );
      await db.prepare(
        `update briar_run_pull_requests
         set state = 'merged', base_sha = ?, merged_at = ?,
             last_delivery_id = ?, updated_at = ?
         where run_id = ? and attempt = ? and revision = ?
           and repository_id = ? and pull_request_number = ?
           and head_sha = ?`,
      ).bind(
        advancedBaseSha,
        mergedAt,
        deliveryId,
        mergedAt,
        member.run_id,
        member.attempt,
        member.revision,
        member.repository_id,
        member.pull_request_number,
        member.frozen_head_sha,
      ).run();
      const reconciledBeforeObserve = await registerReadyMergeCandidates(db, {
        projectId: lane.projectId,
        runId: member.run_id,
        attempt: member.attempt,
        revision: member.revision,
        readyAt: mergedAt,
      });
      expect(
        reconciledBeforeObserve.find((candidate) => candidate.id === member.id),
      ).toMatchObject({
        state: "enqueued",
        frozen_base_sha: member.frozen_base_sha,
      });
      expect(
        await db.prepare(
          "select state from briar_merge_batches where id = ?",
        ).bind(context.claim.batch.id).first<{ state: string }>(),
      ).toEqual({
        state: "awaiting_merge",
      });
      const observed = await observeSignedMergedBatchPullRequest(db, {
        deliveryId,
        repositoryId: lane.repositoryId,
        pullRequestNumber: member.pull_request_number,
        headSha: member.frozen_head_sha,
        mergedAt,
      });
      expect(observed?.batch.state).toBe(
        index === context.claim.members.length - 1
          ? "completed"
          : "awaiting_merge",
      );
      if (index === 0) {
        await db.prepare(
          "delete from briar_github_deliveries where delivery_id = ?",
        ).bind(deliveryId).run();
        await db.prepare(
          `update briar_hunt_runs set status = 'completed', updated_at = ?
           where id = ? and current_attempt = ? and current_revision = ?`,
        ).bind(
          at(6, 35),
          member.run_id,
          member.attempt,
          member.revision,
        ).run();
      }
      if (index < context.claim.members.length - 1) {
        expect(
          await db.prepare(
            `select count(*) as count from briar_merge_batches
           where repository_id = ? and state = 'collecting'`,
          ).bind(lane.repositoryId).first<number>("count"),
        ).toBe(0);
      }
    }

    const runs = await db.prepare(
      `select resume_requested_at from briar_hunt_runs
       where project_id = ? and id <> ?`,
    ).bind(lane.projectId, late.runId).all<
      { resume_requested_at: string | null }
    >();
    expect(runs.results.every((run) => run.resume_requested_at === null)).toBe(
      true,
    );

    const next = await sealNextMergeBatch(db, {
      projectId: lane.projectId,
      observedAt: at(6, 40),
    });
    expect(next).toMatchObject({
      batch: { state: "frozen" },
      members: [{ run_id: late.runId }],
    });
    const completed = await db.prepare(
      "select * from briar_merge_batches where id = ?",
    ).bind(context.claim.batch.id).first<MergeBatchRow>();
    expect(completed?.state).toBe("completed");
  });

  it("recovers publication after a signed merge races the final receipt", async () => {
    const lane = await setupLane(15);
    const run = await createReadyRun(lane, {
      readyAt: at(15, 1),
      headSha: sha("9"),
      pullRequestCount: 2,
    });
    const context = await advanceToValidating(lane, [run], at(15, 2));
    const proof = await recordMergeBatchValidationProof(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: context.workerId,
      claimTokenHash: context.claimTokenHash,
      mergeGroupSha: context.mergeGroupSha,
      validationResults: successfulValidationResults,
      validatedAt: at(15, 23),
    });
    expect(proof?.state).toBe("publishing");

    const member = context.claim.members[0]!;
    const deliveryId = "merged-before-publication-receipt";
    const mergedAt = at(15, 24);
    await signedDelivery(deliveryId, "pull_request", "closed", mergedAt, false);
    await db.prepare(
      `update briar_run_pull_requests
       set state = 'merged', base_sha = ?, merged_at = ?,
           last_delivery_id = ?, updated_at = ?
       where run_id = ? and attempt = ? and revision = ?
         and repository_id = ? and pull_request_number = ?
         and head_sha = ?`,
    ).bind(
      sha("f"), mergedAt, deliveryId, mergedAt, member.run_id,
      member.attempt, member.revision, member.repository_id,
      member.pull_request_number, member.frozen_head_sha,
    ).run();
    await registerReadyMergeCandidates(db, {
      projectId: lane.projectId,
      runId: member.run_id,
      attempt: member.attempt,
      revision: member.revision,
      readyAt: mergedAt,
    });
    await expect(observeSignedMergedBatchPullRequest(db, {
      deliveryId,
      repositoryId: lane.repositoryId,
      pullRequestNumber: member.pull_request_number,
      headSha: member.frozen_head_sha,
      mergedAt,
    })).resolves.toMatchObject({
      candidate: { state: "merged" },
      batch: { state: "publishing" },
    });

    const reclaimedTokenHash = tokenHash("c");
    const reclaimed = await claimNextMergeBatch(db, lane.projectId, {
      deviceId: lane.deviceId,
      workerId: context.workerId,
      claimedBy: "publication-recovery",
      claimTokenHash: reclaimedTokenHash,
      claimedAt: at(15, 81),
      leaseExpiresAt: at(15, 141),
    });
    expect(reclaimed).toMatchObject({
      phase: "publish",
      batch: { state: "publishing", claim_attempts: 2 },
      members: [{ state: "merged" }, { state: "enqueued" }],
    });
    await expect(completeMergeBatchPublication(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: context.workerId,
      claimTokenHash: reclaimedTokenHash,
      mergeGroupSha: context.mergeGroupSha,
      publishedAt: at(15, 82),
    })).resolves.toMatchObject({
      state: "awaiting_merge",
      completed_at: null,
      claim_token_hash: null,
    });

    const last = context.claim.members[1]!;
    const finalDeliveryId = "merged-after-publication-recovery";
    const finalMergedAt = at(15, 83);
    await signedDelivery(
      finalDeliveryId, "pull_request", "closed", finalMergedAt, false,
    );
    await db.prepare(
      `update briar_run_pull_requests
       set state = 'merged', base_sha = ?, merged_at = ?,
           last_delivery_id = ?, updated_at = ?
       where run_id = ? and attempt = ? and revision = ?
         and repository_id = ? and pull_request_number = ?
         and head_sha = ?`,
    ).bind(
      sha("f"), finalMergedAt, finalDeliveryId, finalMergedAt, last.run_id,
      last.attempt, last.revision, last.repository_id,
      last.pull_request_number, last.frozen_head_sha,
    ).run();
    await registerReadyMergeCandidates(db, {
      projectId: lane.projectId,
      runId: last.run_id,
      attempt: last.attempt,
      revision: last.revision,
      readyAt: finalMergedAt,
    });
    await expect(observeSignedMergedBatchPullRequest(db, {
      deliveryId: finalDeliveryId,
      repositoryId: lane.repositoryId,
      pullRequestNumber: last.pull_request_number,
      headSha: last.frozen_head_sha,
      mergedAt: finalMergedAt,
    })).resolves.toMatchObject({
      candidate: { state: "merged" },
      batch: { state: "completed", completed_at: finalMergedAt },
    });
  });

  it("completes from durable signed receipts after repository authority is lost", async () => {
    const lane = await setupLane(23);
    const run = await createReadyRun(lane, {
      readyAt: at(23, 1),
      headSha: sha("d"),
      pullRequestCount: 2,
    });
    const context = await advanceToValidating(lane, [run], at(23, 2));
    await expect(recordMergeBatchValidationProof(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: context.workerId,
      claimTokenHash: context.claimTokenHash,
      mergeGroupSha: context.mergeGroupSha,
      validationResults: successfulValidationResults,
      validatedAt: at(23, 23),
    })).resolves.toMatchObject({ state: "publishing" });

    for (const [index, member] of context.claim.members.entries()) {
      const deliveryId = `merged-before-authority-loss-${index}`;
      const mergedAt = at(23, 24 + index);
      await signedDelivery(deliveryId, "pull_request", "closed", mergedAt, false);
      await db.prepare(
        `update briar_run_pull_requests
         set state = 'merged', base_sha = ?, merged_at = ?,
             last_delivery_id = ?, updated_at = ?
         where run_id = ? and attempt = ? and revision = ?
           and repository_id = ? and pull_request_number = ?
           and head_sha = ?`,
      ).bind(
        sha("f"), mergedAt, deliveryId, mergedAt, member.run_id,
        member.attempt, member.revision, member.repository_id,
        member.pull_request_number, member.frozen_head_sha,
      ).run();
      await expect(observeSignedMergedBatchPullRequest(db, {
        deliveryId,
        repositoryId: lane.repositoryId,
        pullRequestNumber: member.pull_request_number,
        headSha: member.frozen_head_sha,
        mergedAt,
      })).resolves.toMatchObject({
        candidate: { state: "merged", merged_delivery_id: deliveryId },
        batch: { state: "publishing" },
      });
    }

    await db.prepare(
      `delete from briar_github_connection_repositories
       where installation_id = ? and repository_id = ?`,
    ).bind(installationId, lane.repositoryId).run();

    await expect(completeMergeBatchPublication(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: context.workerId,
      claimTokenHash: context.claimTokenHash,
      mergeGroupSha: context.mergeGroupSha,
      publishedAt: at(23, 28),
    })).resolves.toMatchObject({
      state: "completed",
      completed_at: at(23, 28),
      claim_token_hash: null,
    });
    await db.prepare(
      `insert into briar_github_connection_repositories (
         installation_id, repository_id, owner, name, full_name,
         created_at, updated_at
       ) values (?, ?, 'wordbricks', ?, ?, ?, ?)`,
    ).bind(
      installationId,
      lane.repositoryId,
      `briar-${lane.scenario}`,
      lane.repository,
      at(23, 0),
      at(23, 29),
    ).run();
  });

  it("seals whole run sets and blocks a cohort when a current PR is added", async () => {
    const lane = await setupLane(7);
    const singles = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        createReadyRun(lane, {
          readyAt: at(7, index + 1),
          priority: 1,
        })),
    );
    const pair = await createReadyRun(lane, {
      readyAt: at(7, 5),
      priority: 4,
      pullRequestCount: 2,
    });
    for (const [index, run] of [...singles, pair].entries()) {
      await registerRun(lane, run, at(7, index + 1));
    }

    const sealed = await sealNextMergeBatch(db, {
      projectId: lane.projectId,
      observedAt: at(7, 8),
    });
    expect(sealed?.members).toHaveLength(4);
    expect(new Set(sealed?.members.map((member) => member.run_id)))
      .toEqual(new Set(singles.map((run) => run.runId)));
    const deferredPair = await db.prepare(
      `select state, batch_id from briar_merge_batch_candidates
       where run_id = ? order by pull_request_number`,
    ).bind(pair.runId).all<{ state: string; batch_id: string | null }>();
    expect(deferredPair.results).toEqual([
      { state: "ready", batch_id: null },
      { state: "ready", batch_id: null },
    ]);

    const changed = singles[0]!;
    const newPullRequestNumber = changed.pullRequestNumbers[0]! + 1;
    await db.prepare(
      `insert into briar_run_pull_requests (
         project_id, run_id, attempt, revision, revision_started_at, url,
         repository_id, repository, pull_request_id, pull_request_node_id,
         pull_request_number, state, draft, head_sha, base_sha, base_branch,
         opened_at, provider_updated_at, created_at, updated_at
       ) values (?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, 'open', 0, ?, ?, 'main',
                 ?, ?, ?, ?)`,
    ).bind(
      lane.projectId,
      changed.runId,
      at(7, 9),
      `https://github.com/${lane.repository}/pull/${newPullRequestNumber}`,
      lane.repositoryId,
      lane.repository,
      100_000 + newPullRequestNumber,
      `PR_${newPullRequestNumber}`,
      newPullRequestNumber,
      changed.headSha,
      changed.baseSha,
      at(7, 9),
      at(7, 9),
      at(7, 9),
      at(7, 9),
    ).run();
    const reconciled = await reconcileReadyMergeCandidates(db, {
      projectId: lane.projectId,
      runId: changed.runId,
      observedAt: at(7, 9),
    });
    expect(reconciled).toMatchObject({
      invalidatedSealed: 1,
      blockedBatches: 1,
    });
    expect(
      await db.prepare(
        "select state from briar_merge_batches where id = ?",
      ).bind(sealed!.batch.id).first<{ state: string }>(),
    ).toEqual({
      state: "blocked",
    });
  });

  it("represents one signed PR once across concurrent run registration and sealing", async () => {
    const lane = await setupLane(8);
    const first = await createReadyRun(lane, {
      readyAt: at(8, 1),
      headSha: sha("1"),
    });
    const duplicate = await createReadyRun(lane, {
      readyAt: at(8, 1),
      headSha: sha("1"),
    });
    const pullRequestNumber = first.pullRequestNumbers[0]!;
    await db.prepare(
      `update briar_run_pull_requests
       set url = ?, pull_request_id = ?, pull_request_node_id = ?,
           pull_request_number = ?, updated_at = ?
       where run_id = ? and attempt = 1 and revision = 1`,
    ).bind(
      `https://github.com/${lane.repository}/pull/${pullRequestNumber}`,
      100_000 + pullRequestNumber,
      `PR_${pullRequestNumber}`,
      pullRequestNumber,
      at(8, 2),
      duplicate.runId,
    ).run();

    const sealPromises = Array.from(
      { length: 4 },
      () =>
        sealNextMergeBatch(db, {
          projectId: lane.projectId,
          observedAt: at(8, 4),
        }),
    );
    await Promise.all([
      registerRun(lane, first, at(8, 2)),
      registerRun(lane, duplicate, at(8, 2)),
      ...sealPromises,
    ]);
    const attemptedSeals = await Promise.all(sealPromises);
    const sealed = attemptedSeals.find((result) => result !== null) ??
      await sealNextMergeBatch(db, {
        projectId: lane.projectId,
        observedAt: at(8, 5),
      });
    expect(sealed?.members).toHaveLength(1);
    expect(sealed?.members[0]?.pull_request_number).toBe(pullRequestNumber);
    const candidates = await db.prepare(
      `select state, batch_id from briar_merge_batch_candidates
       where project_id = ? order by state`,
    ).bind(lane.projectId).all<{ state: string; batch_id: string | null }>();
    expect(
      candidates.results.filter((candidate) =>
        candidate.state === "frozen" && candidate.batch_id === sealed?.batch.id
      ),
    ).toHaveLength(1);
    expect(
      candidates.results.filter((candidate) =>
        candidate.state === "dequeued" && candidate.batch_id === null
      ),
    ).toHaveLength(1);
  });

  it("serializes overlapping run sets after their shared PR is signed merged", async () => {
    const lane = await setupLane(13);
    const primary = await createReadyRun(lane, {
      readyAt: at(13, 1),
      priority: 1,
      pullRequestCount: 2,
      headSha: sha("7"),
    });
    const overlapping = await createReadyRun(lane, {
      readyAt: at(13, 2),
      priority: 2,
      pullRequestCount: 2,
      headSha: sha("7"),
    });
    const sharedPullRequestNumber = primary.pullRequestNumbers[1]!;
    await db.prepare(
      `update briar_run_pull_requests
       set url = ?, pull_request_id = ?, pull_request_node_id = ?,
           pull_request_number = ?, updated_at = ?
       where run_id = ? and attempt = 1 and revision = 1
         and pull_request_number = ?`,
    ).bind(
      `https://github.com/${lane.repository}/pull/${sharedPullRequestNumber}`,
      100_000 + sharedPullRequestNumber,
      `PR_${sharedPullRequestNumber}`,
      sharedPullRequestNumber,
      at(13, 3),
      overlapping.runId,
      overlapping.pullRequestNumbers[0],
    ).run();
    await registerRun(lane, primary, at(13, 4));
    await registerRun(lane, overlapping, at(13, 5));
    const firstCohort = await sealNextMergeBatch(db, {
      projectId: lane.projectId,
      observedAt: at(13, 8),
    });
    expect(firstCohort?.members).toHaveLength(2);
    expect(new Set(firstCohort?.members.map((member) => member.run_id)))
      .toEqual(new Set([primary.runId]));

    const context = await advanceToAwaitingMerge(lane, [primary], at(13, 10));
    for (const [index, member] of context.claim.members.entries()) {
      const deliveryId = `overlap-merged-${member.pull_request_number}`;
      const mergedAt = at(13, 30 + index);
      await signedDelivery(
        deliveryId,
        "pull_request",
        "closed",
        mergedAt,
        false,
      );
      await db.prepare(
        `update briar_run_pull_requests
         set state = 'merged', base_sha = ?, merged_at = ?,
             last_delivery_id = ?, updated_at = ?
         where project_id = ? and repository_id = ?
           and pull_request_number = ? and head_sha = ?`,
      ).bind(
        sha(index === 0 ? "d" : "e"),
        mergedAt,
        deliveryId,
        mergedAt,
        lane.projectId,
        lane.repositoryId,
        member.pull_request_number,
        member.frozen_head_sha,
      ).run();
      const observed = await observeSignedMergedBatchPullRequest(db, {
        deliveryId,
        repositoryId: lane.repositoryId,
        pullRequestNumber: member.pull_request_number,
        headSha: member.frozen_head_sha,
        mergedAt,
      });
      expect(observed?.batch.state).toBe(
        index === context.claim.members.length - 1
          ? "completed"
          : "awaiting_merge",
      );
    }

    const overlappingCandidates = await registerRun(
      lane,
      overlapping,
      at(13, 40),
    );
    expect(overlappingCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pull_request_number: sharedPullRequestNumber,
        state: "dequeued",
      }),
      expect.objectContaining({
        pull_request_number: overlapping.pullRequestNumbers[1],
        state: "ready",
      }),
    ]));
    const secondCohort = await sealNextMergeBatch(db, {
      projectId: lane.projectId,
      observedAt: at(13, 42),
    });
    expect(secondCohort).toMatchObject({
      batch: { state: "frozen" },
      members: [{
        run_id: overlapping.runId,
        pull_request_number: overlapping.pullRequestNumbers[1],
      }],
    });
    const secondClaim = await claimNextMergeBatch(db, lane.projectId, {
      deviceId: lane.deviceId,
      workerId: lane.workerId,
      claimedBy: "overlap-second-cohort",
      claimTokenHash: tokenHash("b"),
      claimedAt: at(13, 43),
      leaseExpiresAt: at(13, 60),
    });
    expect(secondClaim).toMatchObject({
      phase: "enqueue",
      members: [{ pull_request_number: overlapping.pullRequestNumbers[1] }],
    });
  });

  it("bounds only unresolved PRs after a large run set is already signed merged", async () => {
    const lane = await setupLane(14);
    const run = await createReadyRun(lane, {
      readyAt: at(14, 1),
      pullRequestCount: 6,
      headSha: sha("8"),
    });
    for (
      const [index, pullRequestNumber] of run.pullRequestNumbers
        .slice(0, 5)
        .entries()
    ) {
      await db.prepare(
        `update briar_run_pull_requests
         set state = 'merged', merged_at = ?, last_delivery_id = ?, updated_at = ?
         where run_id = ? and pull_request_number = ?`,
      ).bind(
        at(14, 2 + index),
        `presatisfied-${pullRequestNumber}`,
        at(14, 2 + index),
        run.runId,
        pullRequestNumber,
      ).run();
    }
    const registered = await registerRun(lane, run, at(14, 8));
    expect(registered).toMatchObject([{
      pull_request_number: run.pullRequestNumbers[5],
      state: "ready",
    }]);
    const sealed = await sealNextMergeBatch(db, {
      projectId: lane.projectId,
      observedAt: at(14, 10),
    });
    expect(sealed).toMatchObject({
      batch: { state: "frozen" },
      members: [{ pull_request_number: run.pullRequestNumbers[5] }],
    });
  });

  it("publishes a durable deterministic failure before draining the queue", async () => {
    const lane = await setupLane(9);
    const run = await createReadyRun(lane, {
      readyAt: at(9, 1),
      headSha: sha("2"),
    });
    const context = await advanceToValidating(lane, [run], at(9, 2));
    await expect(recordMergeBatchValidationProof(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: context.workerId,
      claimTokenHash: context.claimTokenHash,
      mergeGroupSha: context.mergeGroupSha,
      validationResults: failedValidationResults.slice(0, -1),
      validatedAt: at(9, 23),
    })).resolves.toBeNull();
    const proof = await recordMergeBatchValidationProof(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: context.workerId,
      claimTokenHash: context.claimTokenHash,
      mergeGroupSha: context.mergeGroupSha,
      validationResults: failedValidationResults,
      validatedAt: at(9, 23),
    });
    expect(proof).toMatchObject({
      state: "publishing",
      validation_results_json: JSON.stringify(failedValidationResults),
    });
    await expect(releaseMergeBatchLease(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: context.workerId,
      claimTokenHash: context.claimTokenHash,
      authenticatedAt: at(9, 24),
    })).resolves.toBe(true);

    const publisher = await claimNextMergeBatch(db, lane.projectId, {
      deviceId: lane.deviceId,
      workerId: lane.workerId,
      claimedBy: "publisher-9",
      claimTokenHash: tokenHash("c"),
      claimedAt: at(9, 25),
      leaseExpiresAt: at(9, 40),
    });
    expect(publisher).toMatchObject({
      phase: "publish",
      batch: {
        state: "publishing",
        validation_results_json: JSON.stringify(failedValidationResults),
      },
    });
    const published = await completeMergeBatchPublication(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: lane.workerId,
      claimTokenHash: tokenHash("c"),
      mergeGroupSha: context.mergeGroupSha,
      publishedAt: at(9, 26),
    });
    expect(published).toMatchObject({
      state: "draining",
      failure_code: "validation_failed",
      claim_token_hash: null,
    });

    const drainer = await claimNextMergeBatch(db, lane.projectId, {
      deviceId: lane.deviceId,
      workerId: lane.workerId,
      claimedBy: "drainer-9",
      claimTokenHash: tokenHash("d"),
      claimedAt: at(9, 27),
      leaseExpiresAt: at(9, 50),
    });
    expect(drainer).toMatchObject({
      phase: "drain",
      batch: {
        state: "draining",
        validation_results_json: JSON.stringify(failedValidationResults),
      },
    });
    const blocked = await blockMergeBatch(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: lane.workerId,
      claimTokenHash: tokenHash("d"),
      code: "validation_failed",
      detail: "Failed contexts were published and queue entries were removed",
      observedAt: at(9, 28),
    });
    expect(blocked).toMatchObject({ state: "blocked" });
  });

  it("rejects publication when an exact PR changes after validation proof", async () => {
    const lane = await setupLane(10);
    const run = await createReadyRun(lane, {
      readyAt: at(10, 1),
      headSha: sha("3"),
    });
    const context = await advanceToValidating(lane, [run], at(10, 2));
    const proof = await recordMergeBatchValidationProof(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: context.workerId,
      claimTokenHash: context.claimTokenHash,
      mergeGroupSha: context.mergeGroupSha,
      validationResults: successfulValidationResults,
      validatedAt: at(10, 23),
    });
    expect(proof?.state).toBe("publishing");
    await db.prepare(
      `update briar_run_pull_requests set head_sha = ?, updated_at = ?
       where run_id = ? and attempt = 1 and revision = 1`,
    ).bind(sha("4"), at(10, 24), run.runId).run();
    await expect(completeMergeBatchPublication(db, {
      batchId: context.claim.batch.id,
      projectId: lane.projectId,
      workerId: context.workerId,
      claimTokenHash: context.claimTokenHash,
      mergeGroupSha: context.mergeGroupSha,
      publishedAt: at(10, 24),
    })).resolves.toBeNull();
    const reconciled = await reconcileReadyMergeCandidates(db, {
      projectId: lane.projectId,
      runId: run.runId,
      observedAt: at(10, 25),
    });
    expect(reconciled).toMatchObject({
      invalidatedSealed: 1,
      blockedBatches: 1,
    });
  });

  it("atomically shares device capacity with regular and merge work", async () => {
    const firstLane = await setupLane(11, { maxConcurrentSessions: 1 });
    const secondLane = await setupLane(12, {
      maxConcurrentSessions: 1,
      deviceId: firstLane.deviceId,
    });
    const firstRun = await createReadyRun(firstLane, {
      readyAt: at(11, 1),
      headSha: sha("5"),
    });
    const secondRun = await createReadyRun(secondLane, {
      readyAt: at(12, 1),
      headSha: sha("6"),
    });
    await Promise.all([
      registerRun(firstLane, firstRun, at(11, 2)),
      registerRun(secondLane, secondRun, at(12, 2)),
    ]);

    await expect(claimNextMergeBatch(db, firstLane.projectId, {
      deviceId: "55555555-5555-4555-8555-555555555555",
      workerId: firstLane.workerId,
      claimedBy: "wrong-device",
      claimTokenHash: tokenHash("5"),
      claimedAt: at(12, 4),
      leaseExpiresAt: at(12, 40),
    })).resolves.toBeNull();

    await db.prepare(
      `update briar_hunt_runs
       set claim_token_hash = ?, claimed_by = 'regular-work', claimed_at = ?,
           lease_expires_at = ?, worker_id = ?, updated_at = ?
       where id = ?`,
    ).bind(
      tokenHash("6"),
      at(12, 5),
      at(12, 20),
      firstLane.workerId,
      at(12, 5),
      firstRun.runId,
    ).run();
    for (const lane of [firstLane, secondLane]) {
      await expect(claimNextMergeBatch(db, lane.projectId, {
        deviceId: lane.deviceId,
        workerId: lane.workerId,
        claimedBy: "capacity-denied",
        claimTokenHash: tokenHash("7"),
        claimedAt: at(12, 6),
        leaseExpiresAt: at(12, 40),
      })).resolves.toBeNull();
    }

    const replyMessageId = "reply-capacity-trigger";
    await db.batch([
      db.prepare(
        `insert into briar_issue_messages (
           id, project_id, run_id, body, created_at, updated_at
         ) values (?, ?, ?, 'Interactive reply', ?, ?)`,
      ).bind(
        replyMessageId, firstLane.projectId, firstRun.runId,
        at(12, 20), at(12, 20),
      ),
      db.prepare(
        `insert into briar_issue_agent_reply_jobs (
           id, project_id, run_id, trigger_message_id, parent_message_id,
           reply_message_id, status, claimed_worker_id, claim_token_hash,
           claimed_at, lease_expires_at, attempts, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, 1, ?, ?)`,
      ).bind(
        "reply-capacity-job", firstLane.projectId, firstRun.runId,
        replyMessageId, replyMessageId, "reply-capacity-result",
        firstLane.workerId, tokenHash("d"), at(12, 20), at(12, 40),
        at(12, 20), at(12, 20),
      ),
    ]);

    // Reply jobs run outside the regular execution slot in the local loop;
    // they must not starve the repository delivery lane.
    const concurrentAt = at(12, 21);
    const tokenHashes = [tokenHash("8"), tokenHash("9")] as const;
    const claims = await Promise.all([
      claimNextMergeBatch(db, firstLane.projectId, {
        deviceId: firstLane.deviceId,
        workerId: firstLane.workerId,
        claimedBy: "capacity-first",
        claimTokenHash: tokenHashes[0],
        claimedAt: concurrentAt,
        leaseExpiresAt: at(12, 40),
      }),
      claimNextMergeBatch(db, secondLane.projectId, {
        deviceId: secondLane.deviceId,
        workerId: secondLane.workerId,
        claimedBy: "capacity-second",
        claimTokenHash: tokenHashes[1],
        claimedAt: concurrentAt,
        leaseExpiresAt: at(12, 40),
      }),
    ]);
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);

    const winnerIndex = claims[0] ? 0 : 1;
    const loserIndex = winnerIndex === 0 ? 1 : 0;
    const lanes = [firstLane, secondLane] as const;
    await expect(releaseMergeBatchLease(db, {
      batchId: claims[winnerIndex]!.batch.id,
      projectId: lanes[winnerIndex].projectId,
      workerId: lanes[winnerIndex].workerId,
      claimTokenHash: tokenHashes[winnerIndex],
      authenticatedAt: at(12, 22),
    })).resolves.toBe(true);
    await expect(claimNextMergeBatch(db, lanes[loserIndex].projectId, {
      deviceId: lanes[loserIndex].deviceId,
      workerId: lanes[loserIndex].workerId,
      claimedBy: "capacity-after-release",
      claimTokenHash: tokenHash("a"),
      claimedAt: at(12, 23),
      leaseExpiresAt: at(12, 40),
    })).resolves.toMatchObject({ phase: "enqueue" });
  });
});
