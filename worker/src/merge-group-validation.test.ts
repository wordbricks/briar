import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase } from "./test-helpers/d1";
import {
  claimNextMergeGroupValidationJob,
  completeMergeGroupStatusPublication,
  enqueueMergeGroupValidationJob,
  fenceMergeGroupStatusPublication,
  mergeGroupValidationProject,
  recordMergeGroupValidation,
  releaseMergeGroupValidationClaim,
  renewMergeGroupValidationLease,
  supersedeMergeGroupValidationJob,
} from "./merge-group-validation";

const projectId = "11111111-1111-4111-8111-111111111111";
const workerA = "22222222-2222-4222-8222-222222222222";
const workerB = "33333333-3333-4333-8333-333333333333";
const repositoryId = 9_001;
const installationId = 8_001;
const baseTime = Date.parse("2026-08-21T00:00:00.000Z");
const at = (seconds: number) => new Date(baseTime + seconds * 1_000).toISOString();
const sha = (character: string) => character.repeat(40);
const tokenHash = (character: string) => character.repeat(64);

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
      ...[workerA, workerB].map((workerId, index) => db.prepare(
        `insert into briar_execution_workers (
           id, project_id, label, host_fingerprint, agent_provider,
           versions_json, capabilities_json, state, last_heartbeat_at,
           created_at, updated_at
         ) values (?, ?, ?, ?, 'codex', '{}',
                   '{"merge_group_ci":{"protocol":1}}', 'online', ?, ?, ?)`,
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

  const enqueue = (head: string, queuedAt: string) =>
    enqueueMergeGroupValidationJob(db, {
      projectId,
      installationId,
      repositoryId,
      repository: "wordbricks/briar",
      baseRef: "refs/heads/main",
      headRef: `refs/heads/gh-readonly-queue/main/pr-1-${head.slice(0, 8)}`,
      headSha: head,
      baseSha: sha("a"),
      queuedAt,
    });

  it("creates zero jobs for an unconnected installation and deduplicates deliveries by SHA", async () => {
    await expect(mergeGroupValidationProject(db, {
      installationId: 9999,
      repositoryId,
      repository: "wordbricks/briar",
    })).resolves.toBeNull();

    const project = await mergeGroupValidationProject(db, {
      installationId,
      repositoryId,
      repository: "wordbricks/briar",
    });
    expect(project).toEqual({ id: projectId });
    const first = await enqueue(sha("1"), at(1));
    const duplicate = await enqueue(sha("1"), at(2));
    expect(duplicate?.id).toBe(first?.id);
    await expect(db.prepare(
      `select count(*) as count from merge_group_validation_jobs
       where head_sha = ?`,
    ).bind(sha("1")).first<number>("count")).resolves.toBe(1);
  });

  it("allows one of five concurrent claimers and fences a lease takeover", async () => {
    const claims = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        claimNextMergeGroupValidationJob(db, projectId, {
          workerId: index === 0 ? workerA : workerB,
          claimTokenHash: tokenHash(String(index + 1)),
          claimedAt: at(3),
          leaseExpiresAt: at(10),
        })
      ),
    );
    const first = claims.find((claim) => claim !== null)!;
    expect(claims.filter(Boolean)).toHaveLength(1);

    const takeover = await claimNextMergeGroupValidationJob(db, projectId, {
      workerId: workerB,
      claimTokenHash: tokenHash("9"),
      claimedAt: at(11),
      leaseExpiresAt: at(20),
    });
    expect(takeover).toMatchObject({ id: first.id, claimed_worker_id: workerB });
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
      workerId: workerB,
      claimTokenHash: tokenHash("9"),
      authenticatedAt: at(12),
      headSha: takeover!.head_sha,
      passed: true,
    })).resolves.toMatchObject({ state: "validated" });
  });

  it("retries status publication without rerunning validation", async () => {
    const validated = await db.prepare(
      `select * from merge_group_validation_jobs where state = 'validated'`,
    ).first<{ id: string; attempts: number; head_sha: string }>();
    expect(validated).not.toBeNull();
    await releaseMergeGroupValidationClaim(db, {
      jobId: validated!.id,
      projectId,
      workerId: workerB,
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
    await expect(completeMergeGroupStatusPublication(db, {
      jobId: validated!.id,
      projectId,
      workerId: workerA,
      claimTokenHash: tokenHash("8"),
      authenticatedAt: at(15),
      headSha: validated!.head_sha,
    })).resolves.toMatchObject({ state: "published" });
  });

  it("never revives an out-of-order old head after the live queue fence supersedes it", async () => {
    await enqueue(sha("3"), at(20));
    const old = await enqueue(sha("2"), at(21));
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
    await completeMergeGroupStatusPublication(db, {
      jobId: current!.id,
      projectId,
      workerId: workerA,
      claimTokenHash: tokenHash("4"),
      authenticatedAt: at(24),
      headSha: current!.head_sha,
    });
    const oldClaim = await claimNextMergeGroupValidationJob(db, projectId, {
      workerId: workerB,
      claimTokenHash: tokenHash("5"),
      claimedAt: at(25),
      leaseExpiresAt: at(40),
    });
    expect(oldClaim?.id).toBe(old?.id);
    await supersedeMergeGroupValidationJob(db, {
      jobId: oldClaim!.id,
      projectId,
      workerId: workerB,
      claimTokenHash: tokenHash("5"),
      authenticatedAt: at(26),
      detail: "signed head ref is no longer the live queue head",
    });
    await expect(db.prepare(
      `select state from merge_group_validation_jobs where id = ?`,
    ).bind(oldClaim!.id).first<string>("state")).resolves.toBe("superseded");
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
    expect(released).toMatchObject({ state: "queued", attempts: 1 });
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
      workerId: workerB,
      claimTokenHash: tokenHash("7"),
      claimedAt: at(34),
      leaseExpiresAt: at(50),
    });
    await expect(recordMergeGroupValidation(db, {
      jobId: claim!.id,
      projectId,
      workerId: workerB,
      claimTokenHash: tokenHash("7"),
      authenticatedAt: at(35),
      headSha: sha("f"),
      passed: false,
    })).resolves.toBeNull();
    await expect(recordMergeGroupValidation(db, {
      jobId: claim!.id,
      projectId,
      workerId: workerB,
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
  });
});
