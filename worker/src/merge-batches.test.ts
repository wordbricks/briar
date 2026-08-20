import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase } from "./test-helpers/d1";
import {
  claimNextMergeBatch,
  completeMergeBatchValidation,
  observeMergedBatchPullRequest,
  recordMergeBatchMemberEnqueued,
  recordMergeGroup,
  registerReadyMergeCandidate,
  renewMergeBatchLease,
} from "./merge-batches";

const projectId = "11111111-1111-4111-8111-111111111111";
const workerA = "22222222-2222-4222-8222-222222222222";
const workerB = "33333333-3333-4333-8333-333333333333";
const repositoryId = 9_001;
const baseTime = Date.parse("2026-08-21T00:00:00.000Z");
const at = (seconds: number) => new Date(baseTime + seconds * 1_000).toISOString();
const hash = (character: string) => character.repeat(40);
const tokenHash = (character: string) => character.repeat(64);
const workflow = JSON.stringify({
  version: 2,
  requirements: [],
  stages: [
    { id: "ci_qa", label: "CI", required: true, evidence: [] },
    { id: "merged", label: "Merge", required: true, evidence: [] },
  ],
  execution: { checkpoints: [] },
  completion: { requiredStages: ["ci_qa", "merged"] },
});

describe("repository merge batch coordinator", () => {
  let fixture: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
  let db: D1Database;
  let sequence = 0;

  beforeAll(async () => {
    fixture = await createIsolatedTestDatabase({ suite: "merge-batches" });
    db = fixture.db;
    await db.batch([
      db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values ('merge-owner', 'Owner', 'merge-owner@example.com', 1, ?, ?)`,
      ).bind(at(0), at(0)),
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values ('merge-org', 'Merge Org', 'merge-org', ?, ?)`,
      ).bind(at(0), at(0)),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values ('merge-org', 'merge-owner', 'owner', ?, ?)`,
      ).bind(at(0), at(0)),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, 'merge-owner', 'merge-org', 'Merge Project', ?, ?, ?)`,
      ).bind(projectId, tokenHash("a"), at(0), at(0)),
      db.prepare(
        `insert into briar_project_settings (
           project_id, workflow_json, mandatory_checkpoints_json,
           created_at, updated_at
         ) values (?, ?, '[]', ?, ?)`,
      ).bind(projectId, workflow, at(0), at(0)),
      ...[workerA, workerB].map((workerId, index) => db.prepare(
        `insert into briar_execution_workers (
           id, project_id, label, host_fingerprint, agent_provider,
           versions_json, state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, ?, 'codex', '{}', 'online', ?, ?, ?)`,
      ).bind(
        workerId,
        projectId,
        `worker-${index}`,
        tokenHash(index === 0 ? "b" : "c"),
        at(0),
        at(0),
        at(0),
      )),
    ]);
  });

  afterAll(async () => fixture.dispose());

  const readyRun = async (input: {
    readyAt: string;
    priority?: number;
    head?: string;
    base?: string;
  }) => {
    sequence += 1;
    const runId = `44444444-4444-4444-8444-${String(sequence).padStart(12, "0")}`;
    const pullRequestNumber = 100 + sequence;
    const head = input.head ?? hash(String((sequence % 9) + 1));
    await db.batch([
      db.prepare(
        `insert into briar_hunt_runs (
           id, project_id, source, source_key, title, stage, status,
           workflow_stage, repository, priority, started_at, last_event_at,
           created_at, updated_at, workflow_snapshot_json
         ) values (?, ?, 'issue', ?, ?, 'implementing', 'running', 'ci_qa',
                   'wordbricks/briar', ?, ?, ?, ?, ?, ?)`,
      ).bind(
        runId,
        projectId,
        `merge-run-${sequence}`,
        `Merge run ${sequence}`,
        input.priority ?? null,
        input.readyAt,
        input.readyAt,
        input.readyAt,
        input.readyAt,
        workflow,
      ),
      db.prepare(
        `insert into briar_run_pull_requests (
           project_id, run_id, attempt, revision, revision_started_at, url,
           repository_id, repository, pull_request_id, pull_request_node_id,
           pull_request_number, state, draft, head_sha, base_sha, base_branch,
           opened_at, provider_updated_at, created_at, updated_at
         ) values (?, ?, 1, 1, ?, ?, ?, 'wordbricks/briar', ?, ?, ?,
                   'open', 0, ?, ?, 'main', ?, ?, ?, ?)`,
      ).bind(
        projectId,
        runId,
        input.readyAt,
        `https://github.com/wordbricks/briar/pull/${pullRequestNumber}`,
        repositoryId,
        10_000 + pullRequestNumber,
        `PR_${pullRequestNumber}`,
        pullRequestNumber,
        head,
        input.base ?? hash("a"),
        input.readyAt,
        input.readyAt,
        input.readyAt,
        input.readyAt,
      ),
    ]);
    const candidate = await registerReadyMergeCandidate(db, {
      projectId,
      runId,
      readyAt: input.readyAt,
      quietWindowMs: 10_000,
    });
    expect(candidate).not.toBeNull();
    return { runId, pullRequestNumber, head, candidate: candidate! };
  };

  it("keeps one active repository/base batch and freezes deterministic members", async () => {
    const low = await readyRun({ readyAt: at(1), priority: 3 });
    const high = await readyRun({ readyAt: at(2), priority: 1 });

    const active = await db.prepare(
      `select count(*) as count from briar_merge_batches
       where project_id = ? and state = 'collecting'`,
    ).bind(projectId).first<{ count: number }>();
    expect(active?.count).toBe(1);

    await expect(Promise.all([
      claimNextMergeBatch(db, projectId, {
        workerId: workerA,
        claimedBy: "worker-a",
        claimTokenHash: tokenHash("d"),
        claimedAt: at(12),
        leaseExpiresAt: at(72),
      }),
      claimNextMergeBatch(db, projectId, {
        workerId: workerB,
        claimedBy: "worker-b",
        claimTokenHash: tokenHash("e"),
        claimedAt: at(12),
        leaseExpiresAt: at(72),
      }),
    ])).resolves.toSatisfy((claims: unknown[]) =>
      claims.filter(Boolean).length === 1
    );
    const batch = await db.prepare(
      `select * from briar_merge_batches where project_id = ?
       and state = 'enqueueing'`,
    ).bind(projectId).first<{ id: string }>();
    expect(batch).not.toBeNull();
    const members = await db.prepare(
      `select run_id from briar_merge_batch_candidates where batch_id = ?
       order by case when priority is null then 1 else 0 end,
                priority, ready_at, run_id`,
    ).bind(batch!.id).all<{ run_id: string }>();
    expect(members.results.map((member) => member.run_id)).toEqual([
      high.runId,
      low.runId,
    ]);
  });

  it("sends post-freeze arrivals to the next batch", async () => {
    const late = await readyRun({ readyAt: at(13), priority: 1 });
    expect(late.candidate.batch_id).toBeNull();
  });

  it("fences exact heads, idempotent enqueue, stale leases, and synthetic SHA", async () => {
    const claimed = await db.prepare(
      `select * from briar_merge_batches where project_id = ?
       and state = 'enqueueing'`,
    ).bind(projectId).first<{
      id: string;
      claimed_worker_id: string;
      claim_token_hash: string;
    }>();
    expect(claimed).not.toBeNull();
    const members = await db.prepare(
      `select * from briar_merge_batch_candidates where batch_id = ?
       order by priority, ready_at`,
    ).bind(claimed!.id).all<{
      id: string;
      frozen_head_sha: string;
    }>();

    for (const [index, member] of members.results.entries()) {
      const common = {
        batchId: claimed!.id,
        projectId,
        workerId: claimed!.claimed_worker_id,
        claimTokenHash: claimed!.claim_token_hash,
        candidateId: member.id,
        expectedHeadSha: member.frozen_head_sha,
        queueEntryId: `MQE_${index}`,
        observedAt: at(20),
      };
      await expect(recordMergeBatchMemberEnqueued(db, {
        ...common,
        expectedHeadSha: hash("f"),
      })).resolves.toBeNull();
      await expect(recordMergeBatchMemberEnqueued(db, common))
        .resolves.toMatchObject({ state: "enqueued" });
      await expect(recordMergeBatchMemberEnqueued(db, common))
        .resolves.toMatchObject({ queue_entry_id: `MQE_${index}` });
    }

    await expect(renewMergeBatchLease(db, {
      batchId: claimed!.id,
      projectId,
      workerId: workerB,
      claimTokenHash: tokenHash("9"),
      authenticatedAt: at(21),
      leaseExpiresAt: at(80),
    })).resolves.toBeNull();

    const mergeSha = hash("c");
    await expect(recordMergeGroup(db, {
      batchId: claimed!.id,
      projectId,
      workerId: claimed!.claimed_worker_id,
      claimTokenHash: claimed!.claim_token_hash,
      mergeGroupRef: "refs/heads/gh-readonly-queue/main/pr-101-deadbeef",
      mergeGroupSha: mergeSha,
      observedAt: at(22),
    })).resolves.toMatchObject({ state: "validating" });
    await expect(completeMergeBatchValidation(db, {
      batchId: claimed!.id,
      projectId,
      workerId: claimed!.claimed_worker_id,
      claimTokenHash: claimed!.claim_token_hash,
      mergeGroupSha: hash("d"),
      observedAt: at(23),
    })).resolves.toBeNull();
    await expect(completeMergeBatchValidation(db, {
      batchId: claimed!.id,
      projectId,
      workerId: claimed!.claimed_worker_id,
      claimTokenHash: claimed!.claim_token_hash,
      mergeGroupSha: mergeSha,
      observedAt: at(23),
    })).resolves.toMatchObject({ state: "awaiting_merge" });
  });

  it("completes only after every original PR merges with its frozen head", async () => {
    const batch = await db.prepare(
      `select id from briar_merge_batches where project_id = ?
       and state = 'awaiting_merge'`,
    ).bind(projectId).first<{ id: string }>();
    const members = await db.prepare(
      `select pull_request_number, frozen_head_sha
       from briar_merge_batch_candidates where batch_id = ?
       order by pull_request_number`,
    ).bind(batch!.id).all<{
      pull_request_number: number;
      frozen_head_sha: string;
    }>();
    await observeMergedBatchPullRequest(db, {
      repositoryId,
      pullRequestNumber: members.results[0]!.pull_request_number,
      headSha: hash("f"),
      mergedAt: at(30),
    });
    expect((await db.prepare(
      `select state from briar_merge_batches where id = ?`,
    ).bind(batch!.id).first<{ state: string }>())?.state).toBe("awaiting_merge");

    for (const member of members.results) {
      await observeMergedBatchPullRequest(db, {
        repositoryId,
        pullRequestNumber: member.pull_request_number,
        headSha: member.frozen_head_sha,
        mergedAt: at(31),
      });
    }
    expect((await db.prepare(
      `select state from briar_merge_batches where id = ?`,
    ).bind(batch!.id).first<{ state: string }>())?.state).toBe("completed");
  });
});
