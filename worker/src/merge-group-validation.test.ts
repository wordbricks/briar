import { createHash, createHmac, generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MERGE_GROUP_CI_AUDITED_IMAGE,
  MERGE_GROUP_STATUS_CONTEXTS,
} from "../../src/lib/merge-group-validation-contract";
import worker from "./index";
import {
  collectReadyMergeQueueGeneration,
  generationMembers,
} from "./merge-queue-coordinator";
import { reworkTerminalMergeQueueGeneration } from "./merge-queue-recovery";
import { createIsolatedTestDatabase } from "./test-helpers/d1";
import {
  claimNextMergeGroupAuthorityJob,
  claimNextMergeGroupValidationJob,
  completeMergeGroupStatusPublication,
  enqueueMergeGroupValidationJob,
  fenceMergeGroupStatusPublication,
  mergeGroupValidationProject,
  recordMergeGroupPublicationFailure,
  recordPendingMergeGroupValidationJob,
  recordMergeGroupValidation,
  recordMergeGroupStatusReceipt,
  releaseMergeGroupValidationClaim,
  retryMergeGroupValidationJob,
  renewMergeGroupValidationLease,
} from "./merge-group-validation";

const projectId = "11111111-1111-4111-8111-111111111111";
const workerA = "22222222-2222-4222-8222-222222222222";
const workerB = "33333333-3333-4333-8333-333333333333";
const deviceA = "44444444-4444-4444-8444-444444444444";
const deviceB = "55555555-5555-4555-8555-555555555555";
const repositoryId = 9_001;
const installationId = 8_001;
const providerlessToken = "briar_worker_providerless_merge_group";
const baseTime = Date.parse("2026-08-20T00:00:00.000Z");
const at = (seconds: number) => new Date(baseTime + seconds * 1_000).toISOString();
const sha = (character: string) => character.repeat(40);
const tokenHash = (character: string) => character.repeat(64);
const mergeGroupCapabilityJson = JSON.stringify({
  merge_group_ci: {
    protocol: 3,
    isolation: "container",
    network: "none",
    uid: 65532,
    image: MERGE_GROUP_CI_AUDITED_IMAGE,
  },
});

describe("merge-group exact-SHA validation jobs", () => {
  let fixture: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
  let db: D1Database;

  beforeAll(async () => {
    fixture = await createIsolatedTestDatabase({ suite: "merge-group-validation" });
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
           project_id, github_repository, workflow_json,
           mandatory_checkpoints_json, created_at, updated_at
         ) values (?, 'wordbricks/briar', '{}', '[]', ?, ?)`,
      ).bind(projectId, at(0), at(0)),
      db.prepare(
        `insert into briar_github_connections (
           installation_id, organization_id, installation_account_id,
           account_login, account_avatar_url, authorized_github_user_id,
           authorized_github_user_login, connected_by_user_id, status,
           connected_at, disconnected_at, updated_at
         ) values (?, 'merge-org', 7001, 'wordbricks',
                   'https://example.com/avatar.png', 6001, 'owner',
                   'merge-owner', 'connected', ?, null, ?)`,
      ).bind(installationId, at(0), at(0)),
      db.prepare(
        `insert into briar_github_connection_repositories (
           installation_id, repository_id, owner, name, full_name,
           created_at, updated_at
         ) values (?, ?, 'wordbricks', 'briar', 'wordbricks/briar', ?, ?)`,
      ).bind(installationId, repositoryId, at(0), at(0)),
      ...[deviceA, deviceB].map((deviceId, index) => db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, last_heartbeat_at, created_at, updated_at
         ) values (?, 'merge-org', 'merge-owner', ?, ?, 'online', ?, ?, ?)`,
      ).bind(
        deviceId,
        `device-${index}`,
        tokenHash(index === 0 ? "d" : "e"),
        at(0),
        at(0),
        at(0),
      )),
      ...[workerA, workerB].map((workerId, index) => db.prepare(
        `insert into briar_execution_workers (
           id, project_id, device_id, label, host_fingerprint, agent_provider,
           versions_json, capabilities_json, state, last_heartbeat_at,
           created_at, updated_at
         ) values (?, ?, ?, ?, ?, 'codex', '{}',
                   ?, 'online', ?, ?, ?)`,
      ).bind(
        workerId,
        projectId,
        index === 0 ? deviceA : deviceB,
        `worker-${index}`,
        tokenHash(index === 0 ? "b" : "c"),
        mergeGroupCapabilityJson,
        at(0),
        at(0),
        at(0),
      )),
      db.prepare(
        `update briar_execution_workers
         set accepting_work = 1, readiness_state = 'ready'
         where id in (?, ?)`,
      ).bind(workerA, workerB),
      db.prepare(
        `insert into briar_execution_worker_credentials (
           device_id, token_hash, created_at
         ) values (?, ?, ?)`,
      ).bind(
        deviceA,
        createHash("sha256").update(providerlessToken).digest("hex"),
        at(0),
      ),
      db.prepare(
        `update briar_project_settings
         set merge_group_ci_enabled = 1,
             merge_group_ci_base_ref = 'refs/heads/main',
             merge_group_ci_worker_id = ?
         where project_id = ?`,
      ).bind(workerA, projectId),
    ]);
  });

  afterAll(async () => fixture.dispose());

  const enqueue = (
    head: string,
    queuedAt: string,
    authorityCheckedAt = queuedAt,
    tailPosition = 0,
  ) =>
    enqueueMergeGroupValidationJob(db, {
      projectId,
      installationId,
      repositoryId,
      repository: "wordbricks/briar",
      baseRef: "refs/heads/main",
      headRef: `refs/heads/gh-readonly-queue/main/pr-1-${head.slice(0, 8)}`,
      headSha: head,
      baseSha: sha("a"),
      tailPullRequestNumber: 1,
      tailPosition,
      authorityCheckedAt,
      eligibleWorkerId: workerA,
      queuedAt,
    });

  it("lets a providerless fresh executor poll only the merge-group lane", async () => {
    const observedAt = new Date().toISOString();
    await db.batch([
      db.prepare(
        `update briar_execution_workers set last_heartbeat_at = ?, updated_at = ?
         where id = ?`,
      ).bind(observedAt, observedAt, workerA),
      db.prepare(
        `update briar_execution_worker_devices set last_heartbeat_at = ?, updated_at = ?
         where id = ?`,
      ).bind(observedAt, observedAt, deviceA),
    ]);
    const response = await worker.fetch(
      new Request("https://briar.example/worker-claims", {
        method: "POST",
        headers: {
          authorization: `Bearer ${providerlessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          claimedBy: "isolated executor",
          workerId: workerA,
          projectId,
        }),
      }),
      { DB: db } as never,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      work: null,
      retryAfterMs: 15_000,
    });
  });

  it("refuses merge-group work when the designated worker loses its isolation attestation", async () => {
    const head = sha("f");
    const job = await enqueueMergeGroupValidationJob(db, {
      projectId,
      installationId,
      repositoryId: repositoryId + 99,
      repository: "wordbricks/isolation-fence",
      baseRef: "refs/heads/main",
      headRef: `refs/heads/gh-readonly-queue/main/pr-99-${head.slice(0, 8)}`,
      headSha: head,
      baseSha: sha("a"),
      tailPullRequestNumber: 99,
      tailPosition: 0,
      authorityCheckedAt: at(1),
      eligibleWorkerId: workerA,
      queuedAt: at(1),
    });
    await db.prepare(
      `update briar_execution_workers
       set capabilities_json = '{"merge_group_ci":{"protocol":3,"isolation":"container","network":"none","uid":65532,"image":"ghcr.io/wordbricks/ci:mutable"}}'
       where id = ?`,
    ).bind(workerA).run();

    const response = await worker.fetch(
      new Request("https://briar.example/merge-group-validation-claims", {
        method: "POST",
        headers: {
          authorization: `Bearer ${providerlessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          claimedBy: "isolated executor",
          workerId: workerA,
          projectId,
        }),
      }),
      { DB: db } as never,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ work: null });
    await expect(db.prepare(
      "select state from merge_group_validation_jobs where id = ?",
    ).bind(job!.id).first<string>("state")).resolves.toBe("queued");

    await db.batch([
      db.prepare(
        `update briar_execution_workers
         set capabilities_json = ?
         where id = ?`,
      ).bind(mergeGroupCapabilityJson, workerA),
      db.prepare("delete from merge_group_validation_jobs where id = ?").bind(job!.id),
    ]);
  });

  it("creates zero jobs for an unconnected installation and deduplicates deliveries by SHA", async () => {
    await expect(mergeGroupValidationProject(db, {
      installationId: 9999,
      repositoryId,
      repository: "wordbricks/briar",
      baseRef: "refs/heads/main",
      workerHeartbeatAfter: at(-1),
    })).resolves.toBeNull();

    const project = await mergeGroupValidationProject(db, {
      installationId,
      repositoryId,
      repository: "wordbricks/briar",
      baseRef: "refs/heads/main",
      workerHeartbeatAfter: at(-1),
    });
    expect(project).toEqual({ id: projectId, merge_group_ci_worker_id: workerA });
    const first = await enqueue(sha("1"), at(1));
    const duplicate = await enqueue(sha("1"), at(2));
    expect(duplicate?.id).toBe(first?.id);
    await expect(db.prepare(
      `select count(*) as count from merge_group_validation_jobs
       where head_sha = ?`,
    ).bind(sha("1")).first<number>("count")).resolves.toBe(1);
  });

  it("records an early signed tail without spending authority attempts before sealing", async () => {
    const laneRepositoryId = repositoryId + 501;
    const generationId = "77777777-7777-4777-8777-777777777777";
    await db.prepare(
      `insert into merge_queue_generations (
         id, project_id, installation_id, repository_id, repository,
         base_ref, owner_worker_id, state, expected_members_json,
         collection_started_at, collection_deadline_at, created_at, updated_at
       ) values (?, ?, ?, ?, 'wordbricks/early-tail', 'refs/heads/main', ?,
                 'collecting', '[]', ?, ?, ?, ?)`,
    ).bind(
      generationId,
      projectId,
      installationId,
      laneRepositoryId,
      workerA,
      at(1),
      at(301),
      at(1),
      at(1),
    ).run();
    const pending = await recordPendingMergeGroupValidationJob(db, {
      projectId,
      installationId,
      repositoryId: laneRepositoryId,
      repository: "wordbricks/early-tail",
      baseRef: "refs/heads/main",
      headRef: `refs/heads/gh-readonly-queue/main/pr-501-${sha("5").slice(0, 8)}`,
      headSha: sha("5"),
      baseSha: sha("a"),
      deliveryId: "early-tail-delivery",
      eligibleWorkerId: workerA,
      receivedAt: at(2),
    });
    await expect(claimNextMergeGroupAuthorityJob(db, at(3))).resolves.toBeNull();
    await expect(db.prepare(
      `select state, authority_attempts from merge_group_validation_jobs
       where id = ?`,
    ).bind(pending!.id).first()).resolves.toEqual({
      state: "authority_pending",
      authority_attempts: 0,
    });

    await db.prepare(
      `update merge_queue_generations set state = 'awaiting_tail', updated_at = ?
       where id = ?`,
    ).bind(at(301), generationId).run();
    await expect(claimNextMergeGroupAuthorityJob(db, at(302))).resolves.toMatchObject({
      id: pending!.id,
      state: "authority_pending",
      authority_attempts: 1,
    });
    await db.batch([
      db.prepare(
        `update merge_group_validation_jobs
         set state = 'superseded', next_authority_at = null,
             superseded_at = ?, updated_at = ? where id = ?`,
      ).bind(at(303), at(303), pending!.id),
      db.prepare(
        `update merge_queue_generations set state = 'superseded', updated_at = ?
         where id = ?`,
      ).bind(at(303), generationId),
    ]);
  });

  it("allows one of five concurrent claimers and fences a lease takeover", async () => {
    await enqueue(sha("1"), at(2));
    const secondJob = await enqueueMergeGroupValidationJob(db, {
      projectId,
      installationId,
      repositoryId: repositoryId + 1,
      repository: "wordbricks/briar-mirror",
      baseRef: "refs/heads/main",
      headRef: `refs/heads/gh-readonly-queue/main/pr-2-${sha("2").slice(0, 8)}`,
      headSha: sha("2"),
      baseSha: sha("a"),
      tailPullRequestNumber: 2,
      tailPosition: 0,
      authorityCheckedAt: at(2),
      eligibleWorkerId: workerA,
      queuedAt: at(2),
    });
    expect(secondJob).not.toBeNull();
    const claims = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        claimNextMergeGroupValidationJob(db, projectId, {
          workerId: workerA,
          claimTokenHash: tokenHash(String(index + 1)),
          claimedAt: at(3),
          leaseExpiresAt: at(10),
        })
      ),
    );
    const first = claims.find((claim) => claim !== null)!;
    expect(claims.filter(Boolean)).toHaveLength(1);

    const takeover = await claimNextMergeGroupValidationJob(db, projectId, {
      workerId: workerA,
      claimTokenHash: tokenHash("9"),
      claimedAt: at(11),
      leaseExpiresAt: at(20),
    });
    expect(takeover).toMatchObject({ id: first.id, claimed_worker_id: workerA });
    const staleFence = {
      jobId: first.id,
      projectId,
      workerId: first.claimed_worker_id!,
      claimTokenHash: first.claim_token_hash!,
      authenticatedAt: at(12),
    };
    await expect(renewMergeGroupValidationLease(db, {
      ...staleFence,
      leaseExpiresAt: at(30),
    })).resolves.toBeNull();
    await expect(recordMergeGroupValidation(db, {
      ...staleFence,
      headSha: first.head_sha,
      passed: true,
    })).resolves.toBeNull();
    await expect(fenceMergeGroupStatusPublication(db, {
      ...staleFence,
      headSha: first.head_sha,
      leaseExpiresAt: at(30),
    })).resolves.toBeNull();

    await expect(recordMergeGroupValidation(db, {
      jobId: takeover!.id,
      projectId,
      workerId: workerA,
      claimTokenHash: tokenHash("9"),
      authenticatedAt: at(12),
      headSha: takeover!.head_sha,
      passed: true,
    })).resolves.toMatchObject({ state: "validated" });
    await db.prepare(
      `update merge_group_validation_jobs
       set state = 'superseded', superseded_at = ?, updated_at = ?
       where state = 'queued'`,
    ).bind(at(12), at(12)).run();
  });

  it("retries status publication without rerunning validation", async () => {
    const validated = await db.prepare(
      `select * from merge_group_validation_jobs where state = 'validated'`,
    ).first<{ id: string; attempts: number; head_sha: string }>();
    expect(validated).not.toBeNull();
    await recordMergeGroupStatusReceipt(db, {
      jobId: validated!.id,
      projectId,
      workerId: workerA,
      claimTokenHash: tokenHash("9"),
      authenticatedAt: at(13),
      headSha: validated!.head_sha,
      context: MERGE_GROUP_STATUS_CONTEXTS[0],
      receipt: { id: 1 },
    });
    await releaseMergeGroupValidationClaim(db, {
      jobId: validated!.id,
      projectId,
      workerId: workerA,
      claimTokenHash: tokenHash("9"),
      authenticatedAt: at(13),
      reason: "infra_error",
      detail: "status response lost",
    });
    const publicationRetry = await claimNextMergeGroupValidationJob(
      db,
      projectId,
      {
        workerId: workerA,
        claimTokenHash: tokenHash("8"),
        claimedAt: at(14),
        leaseExpiresAt: at(30),
      },
    );
    expect(publicationRetry).toMatchObject({
      id: validated!.id,
      state: "validated",
      attempts: validated!.attempts,
    });
    for (const [index, context] of MERGE_GROUP_STATUS_CONTEXTS.slice(1).entries()) {
      await recordMergeGroupStatusReceipt(db, {
        jobId: validated!.id,
        projectId,
        workerId: workerA,
        claimTokenHash: tokenHash("8"),
        authenticatedAt: at(15),
        headSha: validated!.head_sha,
        context,
        receipt: { id: index + 2 },
      });
    }
    await expect(completeMergeGroupStatusPublication(db, {
      jobId: validated!.id,
      projectId,
      workerId: workerA,
      claimTokenHash: tokenHash("8"),
      authenticatedAt: at(15),
      headSha: validated!.head_sha,
    })).resolves.toMatchObject({ state: "published" });
  });

  it("bounds partial publication retries and manually resumes without rerunning CI", async () => {
    const queued = await enqueueMergeGroupValidationJob(db, {
      projectId,
      installationId,
      repositoryId: repositoryId + 20,
      repository: "wordbricks/briar-publication",
      baseRef: "refs/heads/main",
      headRef: "refs/heads/gh-readonly-queue/main/pr-20-cccccccc",
      headSha: sha("c"),
      baseSha: sha("a"),
      tailPullRequestNumber: 20,
      tailPosition: 0,
      authorityCheckedAt: at(60),
      eligibleWorkerId: workerA,
      queuedAt: at(60),
    });
    let claim = await claimNextMergeGroupValidationJob(db, projectId, {
      workerId: workerA,
      claimTokenHash: tokenHash("a"),
      claimedAt: at(61),
      leaseExpiresAt: at(200),
    });
    expect(claim?.id).toBe(queued?.id);
    await recordMergeGroupValidation(db, {
      jobId: claim!.id,
      projectId,
      workerId: workerA,
      claimTokenHash: tokenHash("a"),
      authenticatedAt: at(62),
      headSha: claim!.head_sha,
      passed: true,
    });
    await fenceMergeGroupStatusPublication(db, {
      jobId: claim!.id,
      projectId,
      workerId: workerA,
      claimTokenHash: tokenHash("a"),
      authenticatedAt: at(63),
      leaseExpiresAt: at(200),
      headSha: claim!.head_sha,
    });
    await recordMergeGroupStatusReceipt(db, {
      jobId: claim!.id,
      projectId,
      workerId: workerA,
      claimTokenHash: tokenHash("a"),
      authenticatedAt: at(64),
      headSha: claim!.head_sha,
      context: MERGE_GROUP_STATUS_CONTEXTS[0],
      receipt: { id: 1 },
    });

    let currentToken = tokenHash("a");
    for (let attempt = 2; attempt <= 8; attempt += 1) {
      await fenceMergeGroupStatusPublication(db, {
        jobId: claim!.id,
        projectId,
        workerId: workerA,
        claimTokenHash: currentToken,
        authenticatedAt: at(60 + attempt * 4),
        leaseExpiresAt: at(200),
        headSha: claim!.head_sha,
      });
      const failed = await recordMergeGroupPublicationFailure(db, {
        jobId: claim!.id,
        projectId,
        workerId: workerA,
        claimTokenHash: currentToken,
        authenticatedAt: at(61 + attempt * 4),
        nextPublicationAt: at(62 + attempt * 4),
        detail: "GitHub status response was unavailable",
      });
      expect(failed?.publication_attempts).toBe(attempt);
      if (attempt < 8) {
        currentToken = tokenHash(String(attempt));
        claim = await claimNextMergeGroupValidationJob(db, projectId, {
          workerId: workerA,
          claimTokenHash: currentToken,
          claimedAt: at(63 + attempt * 4),
          leaseExpiresAt: at(200),
        });
      } else {
        expect(failed?.error_code).toBe("publication_exhausted");
      }
    }
    const retried = await retryMergeGroupValidationJob(db, {
      projectId,
      jobId: claim!.id,
      requestedAt: at(100),
    });
    expect(retried).toMatchObject({
      state: "validated",
      validation_outcome: "passed",
      attempts: 1,
      publication_attempts: 0,
      published_contexts_json: JSON.stringify([MERGE_GROUP_STATUS_CONTEXTS[0]]),
    });
    await db.prepare(
      `update merge_group_validation_jobs
       set state = 'superseded', claimed_worker_id = null,
           claim_token_hash = null, claimed_at = null, lease_expires_at = null,
           superseded_at = ?, updated_at = ? where id = ?`,
    ).bind(at(101), at(101), claim!.id).run();
  });

  it("never revives an out-of-order old head after the live queue fence supersedes it", async () => {
    await enqueue(sha("3"), at(20), at(20), 2);
    const old = await enqueue(sha("2"), at(21), at(21), 1);
    await db.prepare(
      `update merge_group_validation_jobs
       set state = 'superseded', superseded_at = ?, updated_at = ?
       where id = ?`,
    ).bind(at(21), at(21), old!.id).run();
    const current = await claimNextMergeGroupValidationJob(db, projectId, {
      workerId: workerA,
      claimTokenHash: tokenHash("4"),
      claimedAt: at(22),
      leaseExpiresAt: at(40),
    });
    expect(current?.head_sha).toBe(sha("3"));
    await recordMergeGroupValidation(db, {
      jobId: current!.id,
      projectId,
      workerId: workerA,
      claimTokenHash: tokenHash("4"),
      authenticatedAt: at(23),
      headSha: current!.head_sha,
      passed: true,
    });
    for (const [index, context] of MERGE_GROUP_STATUS_CONTEXTS.entries()) {
      await recordMergeGroupStatusReceipt(db, {
        jobId: current!.id,
        projectId,
        workerId: workerA,
        claimTokenHash: tokenHash("4"),
        authenticatedAt: at(24),
        headSha: current!.head_sha,
        context,
        receipt: { id: index + 10 },
      });
    }
    await completeMergeGroupStatusPublication(db, {
      jobId: current!.id,
      projectId,
      workerId: workerA,
      claimTokenHash: tokenHash("4"),
      authenticatedAt: at(24),
      headSha: current!.head_sha,
    });
    await enqueue(sha("2"), at(25), at(25), 1);
    const oldClaim = await claimNextMergeGroupValidationJob(db, projectId, {
      workerId: workerA,
      claimTokenHash: tokenHash("5"),
      claimedAt: at(25),
      leaseExpiresAt: at(40),
    });
    expect(oldClaim).toBeNull();
    await expect(db.prepare(
      `select state from merge_group_validation_jobs where id = ?`,
    ).bind(old!.id).first<string>("state")).resolves.toBe("superseded");
    expect(old).not.toBeNull();
  });

  it("immediately requeues a planned update without accepting a stale completion", async () => {
    await enqueue(sha("4"), at(30));
    const claim = await claimNextMergeGroupValidationJob(db, projectId, {
      workerId: workerA,
      claimTokenHash: tokenHash("6"),
      claimedAt: at(31),
      leaseExpiresAt: at(40),
    });
    const released = await releaseMergeGroupValidationClaim(db, {
      jobId: claim!.id,
      projectId,
      workerId: workerA,
      claimTokenHash: tokenHash("6"),
      authenticatedAt: at(32),
      reason: "planned_update",
    });
    expect(released).toMatchObject({ state: "queued", attempts: 0 });
    await expect(recordMergeGroupValidation(db, {
      jobId: claim!.id,
      projectId,
      workerId: workerA,
      claimTokenHash: tokenHash("6"),
      authenticatedAt: at(33),
      headSha: sha("4"),
      passed: true,
    })).resolves.toBeNull();
  });

  it("records deterministic CI failure only for the claimed exact SHA", async () => {
    const claim = await claimNextMergeGroupValidationJob(db, projectId, {
      workerId: workerA,
      claimTokenHash: tokenHash("7"),
      claimedAt: at(34),
      leaseExpiresAt: at(50),
    });
    await expect(recordMergeGroupValidation(db, {
      jobId: claim!.id,
      projectId,
      workerId: workerA,
      claimTokenHash: tokenHash("7"),
      authenticatedAt: at(35),
      headSha: sha("f"),
      passed: false,
    })).resolves.toBeNull();
    await expect(recordMergeGroupValidation(db, {
      jobId: claim!.id,
      projectId,
      workerId: workerA,
      claimTokenHash: tokenHash("7"),
      authenticatedAt: at(35),
      headSha: claim!.head_sha,
      passed: false,
      detail: "ci exited 1",
    })).resolves.toMatchObject({
      state: "failed",
      head_sha: sha("4"),
      error_code: "ci_failed",
    });
    await db.prepare(
      `update merge_group_validation_jobs
       set state = 'superseded', claimed_worker_id = null,
           claim_token_hash = null, claimed_at = null, lease_expires_at = null,
           superseded_at = ?, updated_at = ? where id = ?`,
    ).bind(at(36), at(36), claim!.id).run();
  });

  it("durably reworks every paused exact member after a terminal queue failure", async () => {
    const runId = "77777777-7777-4777-8777-777777777777";
    const generationId = "88888888-8888-4888-8888-888888888888";
    const jobId = "99999999-9999-4999-8999-999999999999";
    const workflow = JSON.stringify({
      version: 2,
      requirements: [],
      stages: [
        { id: "ci_qa", label: "Signoff", required: true, evidence: [] },
        { id: "merged", label: "Merge", required: true, evidence: [] },
      ],
      execution: {
        checkpoints: [{
          key: "issue-before-merged",
          stage: "merged",
          position: "before",
        }],
      },
      completion: { requiredStages: ["ci_qa", "merged"] },
    });
    const member = {
      projectId,
      runId,
      attempt: 1,
      revision: 1,
      installationId,
      repositoryId,
      repository: "wordbricks/briar",
      pullRequestId: 1_196,
      pullRequestNodeId: "PR_terminal_rework",
      pullRequestNumber: 1_196,
      headSha: sha("c"),
      baseSha: sha("a"),
      readyAt: at(700),
    };
    await db.batch([
      db.prepare(
        `insert into briar_hunt_runs (
           id, project_id, source, source_key, title, stage, status,
           workflow_stage, workflow_snapshot_json, issue_checkpoints_json,
           detail, repository, commit_sha, paused_at, waiting_checkpoint_key,
           waiting_checkpoint_revision, started_at, last_event_at, created_at,
           updated_at
         ) values (?, ?, 'issue', 'terminal-rework', 'Terminal rework',
                   'implementing', 'running', 'merged', ?, '[]', null,
                   'wordbricks/briar', ?, ?, 'issue-before-merged', 1,
                   ?, ?, ?, ?)`,
      ).bind(
        runId,
        projectId,
        workflow,
        member.headSha,
        at(701),
        at(700),
        at(701),
        at(700),
        at(701),
      ),
      db.prepare(
        `insert into merge_queue_generations (
           id, project_id, installation_id, repository_id, repository,
           base_ref, owner_worker_id, state, expected_members_json,
           enqueue_cursor, collection_started_at, collection_deadline_at,
           sealed_at, enqueued_at, matched_head_ref, matched_head_sha,
           validation_job_id, created_at, updated_at
         ) values (?, ?, ?, ?, 'wordbricks/briar', 'refs/heads/main', ?,
                   'validating', ?, 1, ?, ?, ?, ?,
                   'refs/heads/gh-readonly-queue/main/pr-1196-cccccccc', ?, ?, ?, ?)`,
      ).bind(
        generationId,
        projectId,
        installationId,
        repositoryId,
        workerA,
        JSON.stringify([member]),
        at(700),
        at(1_000),
        at(700),
        at(700),
        member.headSha,
        jobId,
        at(700),
        at(700),
      ),
    ]);

    await expect(reworkTerminalMergeQueueGeneration(db, {
      generationId,
      jobId,
      code: "publication_exhausted",
      detail: "The App status API remained unavailable; retry is recorded on the job.",
      observedAt: at(702),
    })).resolves.toEqual({ generation: true, reworked: 1 });
    await expect(db.prepare(
      `select status, workflow_stage, current_revision, paused_at
       from briar_hunt_runs where id = ?`,
    ).bind(runId).first()).resolves.toMatchObject({
      status: "queued",
      workflow_stage: "ci_qa",
      current_revision: 2,
      paused_at: null,
    });
    await expect(db.prepare(
      `select state, error_code from merge_queue_generations where id = ?`,
    ).bind(generationId).first()).resolves.toEqual({
      state: "failed",
      error_code: "publication_exhausted",
    });
    await expect(db.prepare(
      `select detail from briar_hunt_events
       where run_id = ? and event_key like 'workflow:rework:%'`,
    ).bind(runId).first<string>("detail")).resolves.toContain(jobId);
  });

  it("requires an administrator retry after bounded infrastructure exhaustion", async () => {
    const queued = await enqueueMergeGroupValidationJob(db, {
      projectId,
      installationId,
      repositoryId: repositoryId + 31,
      repository: "wordbricks/briar-infra-retry",
      baseRef: "refs/heads/main",
      headRef: "refs/heads/gh-readonly-queue/main/pr-31-dddddddd",
      headSha: sha("d"),
      baseSha: sha("a"),
      tailPullRequestNumber: 31,
      tailPosition: 0,
      authorityCheckedAt: at(200),
      eligibleWorkerId: workerA,
      queuedAt: at(200),
    });
    let terminal = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claim = await claimNextMergeGroupValidationJob(db, projectId, {
        workerId: workerA,
        claimTokenHash: tokenHash(String(attempt)),
        claimedAt: at(200 + attempt * 3),
        leaseExpiresAt: at(250),
      });
      expect(claim?.id).toBe(queued?.id);
      terminal = await releaseMergeGroupValidationClaim(db, {
        jobId: claim!.id,
        projectId,
        workerId: workerA,
        claimTokenHash: tokenHash(String(attempt)),
        authenticatedAt: at(201 + attempt * 3),
        reason: "infra_error",
        detail: "sandbox setup unavailable",
      });
    }
    expect(terminal).toMatchObject({
      state: "failed",
      validation_outcome: "failed",
      attempts: 3,
      error_code: "infra_exhausted",
    });
    await expect(retryMergeGroupValidationJob(db, {
      projectId,
      jobId: queued!.id,
      requestedAt: at(220),
    })).resolves.toMatchObject({
      state: "queued",
      validation_outcome: null,
      attempts: 0,
      publication_attempts: 0,
      published_contexts_json: "[]",
      publication_receipts_json: "[]",
      validated_at: null,
      published_at: null,
      error_code: null,
    });
    await db.prepare(
      `update merge_group_validation_jobs
       set state = 'superseded', superseded_at = ?, updated_at = ?
       where id = ?`,
    ).bind(at(221), at(221), queued!.id).run();
  });

  it("never revives a terminal SHA because a later delivery has a new ref", async () => {
    const common = {
      projectId,
      installationId,
      repositoryId: repositoryId + 32,
      repository: "wordbricks/briar-revival",
      baseRef: "refs/heads/main",
      baseSha: sha("a"),
      tailPosition: 0,
      eligibleWorkerId: workerA,
    } as const;
    const original = await enqueueMergeGroupValidationJob(db, {
      ...common,
      headRef: "refs/heads/gh-readonly-queue/main/pr-32-eeeeeeee",
      headSha: sha("e"),
      tailPullRequestNumber: 32,
      authorityCheckedAt: at(230),
      queuedAt: at(230),
    });
    await db.prepare(
      `update merge_group_validation_jobs
       set state = 'superseded', superseded_at = ?, updated_at = ?
       where id = ?`,
    ).bind(at(231), at(231), original!.id).run();
    await expect(db.prepare(
      "select state from merge_group_validation_jobs where id = ?",
    ).bind(original!.id).first<string>("state")).resolves.toBe("superseded");

    const revived = await enqueueMergeGroupValidationJob(db, {
      ...common,
      headRef: "refs/heads/gh-readonly-queue/main/pr-34-eeeeeeee",
      headSha: sha("e"),
      tailPullRequestNumber: 34,
      authorityCheckedAt: at(232),
      queuedAt: at(232),
    });
    expect(revived).toMatchObject({
      id: original!.id,
      state: "superseded",
      head_ref: "refs/heads/gh-readonly-queue/main/pr-32-eeeeeeee",
      tail_pull_request_number: 32,
      superseded_at: at(231),
    });
  });

  it("atomically seals five exact ready PRs and leaves a late PR for the next generation", async () => {
    const readyAt = at(300);
    for (let index = 1; index <= 6; index += 1) {
      const runId = `90000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
      const prHead = index.toString(16).repeat(40);
      await db.batch([
        db.prepare(
          `insert into briar_hunt_runs (
             id, project_id, source, source_key, title, stage, status,
             workflow_stage, workflow_snapshot_json, issue_checkpoints_json,
             detail, repository, branch, commit_sha, started_at,
             last_event_at, created_at, updated_at
           ) values (?, ?, 'issue', ?, ?, 'implementing', 'running',
                     'merged', '{"version":2,"requirements":[],"stages":[],"execution":{"checkpoints":[]},"completion":{"requiredStages":[]}}',
                     '[]', null, 'wordbricks/briar', null, ?, ?, ?, ?, ?)`,
        ).bind(
          runId,
          projectId,
          `coordinator-${index}`,
          `Coordinator ${index}`,
          prHead,
          readyAt,
          readyAt,
          readyAt,
          readyAt,
        ),
        db.prepare(
          `insert into briar_run_pull_requests (
             project_id, run_id, attempt, revision, revision_started_at, url,
             installation_id, repository_id, repository, pull_request_id,
             pull_request_node_id, pull_request_number, state, draft,
             head_sha, base_sha, opened_at, provider_updated_at,
             last_delivery_id, created_at, updated_at,
             merge_queue_admission_state, merge_queue_ready_at
           ) values (?, ?, 1, 1, ?, ?, ?, ?, 'wordbricks/briar', ?, ?, ?,
                     'open', 0, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
        ).bind(
          projectId,
          runId,
          readyAt,
          `https://github.com/wordbricks/briar/pull/${100 + index}`,
          installationId,
          repositoryId,
          1_000 + index,
          `PR_node_${index}`,
          100 + index,
          prHead,
          sha("a"),
          readyAt,
          readyAt,
          `delivery-${index}`,
          readyAt,
          readyAt,
          index <= 5 ? readyAt : at(301),
        ),
      ]);
    }
    const races = await Promise.all(Array.from({ length: 5 }, () =>
      collectReadyMergeQueueGeneration(db, {
        projectId,
        repositoryId,
        observedAt: readyAt,
      })
    ));
    const sealed = races.find((generation) => generation?.state === "enqueuing") ??
      await db.prepare(
        `select * from merge_queue_generations where repository_id = ?`,
      ).bind(repositoryId).first<never>();
    expect(sealed).not.toBeNull();
    expect(generationMembers(sealed!)).toHaveLength(5);
    await expect(db.prepare(
      `select count(*) as count from merge_queue_generations
       where repository_id = ? and state in (
         'collecting', 'sealing', 'enqueuing', 'awaiting_tail', 'validating'
       )`,
    ).bind(repositoryId).first<number>("count")).resolves.toBe(1);
    await expect(db.prepare(
      `select merge_queue_generation_id from briar_run_pull_requests
       where pull_request_number = 106`,
    ).first<string>("merge_queue_generation_id")).resolves.toBeNull();

    await db.prepare(
      `update merge_queue_generations set state = 'published', updated_at = ?
       where id = ?`,
    ).bind(at(302), Reflect.get(sealed!, "id")).run();
    const collecting = await collectReadyMergeQueueGeneration(db, {
      projectId,
      repositoryId,
      observedAt: at(302),
    });
    expect(collecting?.state).toBe("collecting");
    const single = await collectReadyMergeQueueGeneration(db, {
      projectId,
      repositoryId,
      observedAt: at(602),
    });
    expect(single?.state).toBe("enqueuing");
    expect(generationMembers(single!)).toHaveLength(1);
  });

  it("enqueues only connected checks_requested deliveries and deduplicates by SHA", async () => {
    const heartbeatAt = new Date().toISOString();
    await db.prepare(
      `update briar_execution_workers
       set state = 'online', accepting_work = 1, readiness_state = 'ready',
           last_heartbeat_at = ?, updated_at = ? where id = ?`,
    ).bind(heartbeatAt, heartbeatAt, workerA).run();
    const secret = "merge-group-webhook-secret";
    const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    let delivery = 0;
    const deliver = async (input: {
      action: string;
      installation: number;
      headSha: string;
      validSignature?: boolean;
    }) => {
      delivery += 1;
      const body = JSON.stringify({
        action: input.action,
        installation: { id: input.installation },
        repository: { id: repositoryId, full_name: "wordbricks/briar" },
        sender: { login: "github-merge-queue[bot]" },
        merge_group: {
          head_sha: input.headSha,
          head_ref:
            `refs/heads/gh-readonly-queue/main/pr-${delivery}-${input.headSha.slice(0, 8)}`,
          base_sha: sha("a"),
          base_ref: "refs/heads/main",
        },
      });
      const signature = input.validSignature === false
        ? `sha256=${"0".repeat(64)}`
        : `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (url, init) => {
        const target = String(url);
        if (target.includes("/access_tokens")) {
          return Response.json({
            token: "installation-token",
            expires_at: "2026-08-21T07:00:00.000Z",
          });
        }
        if (target.includes("/git/ref/heads/gh-readonly-queue/")) {
          return Response.json({ object: { sha: input.headSha } });
        }
        if (target.endsWith("/git/ref/heads/main")) {
          return Response.json({ object: { sha: sha("a") } });
        }
        if (target.endsWith("/graphql")) {
          return Response.json({
            data: {
              repository: {
                mergeQueue: {
                  entries: {
                    nodes: [{
                      position: delivery - 1,
                      enqueuedAt: at(delivery),
                      state: "AWAITING_CHECKS",
                      headCommit: { oid: input.headSha },
                      pullRequest: { number: delivery },
                    }],
                  },
                },
              },
            },
          });
        }
        return originalFetch(url, init);
      }) as typeof fetch;
      try {
        return await worker.fetch(new Request("https://briar.example/github/webhooks", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "merge_group",
            "x-github-delivery":
              `77777777-7777-4777-8777-${delivery.toString().padStart(12, "0")}`,
            "x-hub-signature-256": signature,
          },
          body,
        }), {
          DB: db,
          GITHUB_WEBHOOK_SECRET: secret,
          GITHUB_APP_ID: "12345",
          GITHUB_APP_PRIVATE_KEY_PKCS8: privateKey,
        } as never);
      } finally {
        globalThis.fetch = originalFetch;
      }
    };

    const head = sha("6");
    const invalid = await deliver({
      action: "checks_requested",
      installation: installationId,
      headSha: sha("9"),
      validSignature: false,
    });
    expect(invalid.status).toBe(401);
    const firstDelivery = await deliver({
      action: "checks_requested",
      installation: installationId,
      headSha: head,
    }).then((response) => response.json());
    expect(firstDelivery).toMatchObject({
      ok: true,
      event: "merge_group",
      action: "checks_requested",
      jobId: expect.any(String),
    });
    await deliver({
      action: "checks_requested",
      installation: installationId,
      headSha: head,
    });
    await deliver({
      action: "destroyed",
      installation: installationId,
      headSha: sha("7"),
    });
    await deliver({
      action: "checks_requested",
      installation: 9999,
      headSha: sha("8"),
    });
    await expect(db.prepare(
      `select count(*) as count from merge_group_validation_jobs
       where head_sha in (?, ?, ?, ?)`,
    ).bind(head, sha("7"), sha("8"), sha("9")).first<number>("count"))
      .resolves.toBe(1);
  });
});
