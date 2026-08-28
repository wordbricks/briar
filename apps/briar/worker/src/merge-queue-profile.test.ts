import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase } from "./test-helpers/d1";
import {
  configureMergeQueueProfile,
  getMergeQueueProfile,
} from "./merge-queue-profile";

const observedAt = "2026-08-21T03:00:00.000Z";
const tokenHash = "a".repeat(64);
const firstProject = "11111111-1111-4111-8111-111111111111";
const secondProject = "22222222-2222-4222-8222-222222222222";

describe("merge queue profile", () => {
  let fixture: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
  let db: D1Database;

  beforeAll(async () => {
    fixture = await createIsolatedTestDatabase({ suite: "merge-queue-profile" });
    db = fixture.db;
    await db.batch([
      db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values ('queue-owner', 'Owner', 'queue@example.com', 1, ?, ?)`,
      ).bind(observedAt, observedAt),
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values ('queue-org', 'Queue Org', 'queue-org', ?, ?)`,
      ).bind(observedAt, observedAt),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values ('queue-org', 'queue-owner', 'owner', ?, ?)`,
      ).bind(observedAt, observedAt),
      ...[firstProject, secondProject].map((projectId, index) => db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, 'queue-owner', 'queue-org', ?, ?, ?, ?)`,
      ).bind(
        projectId,
        `Queue ${index + 1}`,
        index === 0 ? tokenHash : "b".repeat(64),
        observedAt,
        observedAt,
      )),
    ]);
  });

  afterAll(async () => fixture.dispose());

  it("allows exactly one enabled project to own repository/main", async () => {
    await expect(configureMergeQueueProfile(db, {
      projectId: firstProject,
      repositoryId: 701,
      repository: "Wordbricks/Briar",
      enabled: true,
      readinessStageId: "ci_qa",
      validationCommands: ["bun run ci:local"],
      quietWindowMs: 30_000,
      maxBatchSize: 5,
      observedAt,
    })).resolves.toMatchObject({ outcome: "updated" });
    await expect(getMergeQueueProfile(db, firstProject)).resolves.toMatchObject({
      repository: "wordbricks/briar",
      base_branch: "main",
      enabled: 1,
    });
    await expect(configureMergeQueueProfile(db, {
      projectId: secondProject,
      repositoryId: 701,
      repository: "wordbricks/briar",
      enabled: true,
      readinessStageId: "ci_qa",
      validationCommands: ["bun run ci:local"],
      quietWindowMs: 30_000,
      maxBatchSize: 5,
      observedAt,
    })).resolves.toMatchObject({
      outcome: "lane_owned",
      ownerProjectId: firstProject,
    });
  });

  it("starts a fresh proof boundary when a profile changes repositories", async () => {
    await configureMergeQueueProfile(db, {
      projectId: secondProject,
      repositoryId: 702,
      repository: "wordbricks/first",
      enabled: false,
      readinessStageId: "ci_qa",
      validationCommands: ["bun run ci:local"],
      quietWindowMs: 30_000,
      maxBatchSize: 5,
      observedAt,
    });
    const retargetedAt = "2026-08-21T03:01:00.000Z";
    await configureMergeQueueProfile(db, {
      projectId: secondProject,
      repositoryId: 703,
      repository: "wordbricks/second",
      enabled: false,
      readinessStageId: "ci_qa",
      validationCommands: ["bun run ci:local"],
      quietWindowMs: 20_000,
      maxBatchSize: 4,
      observedAt: retargetedAt,
    });
    await expect(getMergeQueueProfile(db, secondProject)).resolves
      .toMatchObject({
        repository_id: 703,
        repository: "wordbricks/second",
        created_at: retargetedAt,
      });

    await configureMergeQueueProfile(db, {
      projectId: secondProject,
      repositoryId: 703,
      repository: "wordbricks/second",
      enabled: false,
      readinessStageId: "ci_qa",
      validationCommands: ["bun run ci:local"],
      quietWindowMs: 10_000,
      maxBatchSize: 3,
      observedAt: "2026-08-21T03:02:00.000Z",
    });
    await expect(getMergeQueueProfile(db, secondProject)).resolves
      .toMatchObject({ created_at: retargetedAt });
  });

  it("starts a fresh proof boundary when the readiness stage changes", async () => {
    const changedAt = "2026-08-21T03:03:00.000Z";
    await configureMergeQueueProfile(db, {
      projectId: secondProject,
      repositoryId: 703,
      repository: "wordbricks/second",
      enabled: false,
      readinessStageId: "reviewing",
      validationCommands: ["bun run check"],
      quietWindowMs: 10_000,
      maxBatchSize: 3,
      observedAt: changedAt,
    });
    await expect(getMergeQueueProfile(db, secondProject)).resolves
      .toMatchObject({
        readiness_stage_id: "reviewing",
        created_at: changedAt,
      });
  });

  it("starts a fresh proof boundary when validation commands change", async () => {
    const changedAt = "2026-08-21T03:04:00.000Z";
    await configureMergeQueueProfile(db, {
      projectId: secondProject,
      repositoryId: 703,
      repository: "wordbricks/second",
      enabled: false,
      readinessStageId: "reviewing",
      validationCommands: ["bun run check", "bun run test"],
      quietWindowMs: 10_000,
      maxBatchSize: 3,
      observedAt: changedAt,
    });
    await expect(getMergeQueueProfile(db, secondProject)).resolves
      .toMatchObject({
        validation_commands_json: '["bun run check","bun run test"]',
        created_at: changedAt,
      });
  });

  it("will not disable a lane while an active batch holds it", async () => {
    await db.prepare(
      `insert into briar_merge_batches (
         id, project_id, repository_id, repository, base_branch, state,
         quiet_until, created_at, updated_at
       ) values (?, ?, 701, 'wordbricks/briar', 'main', 'collecting', ?, ?, ?)`,
    ).bind(
      "33333333-3333-4333-8333-333333333333",
      firstProject,
      observedAt,
      observedAt,
      observedAt,
    ).run();
    await expect(configureMergeQueueProfile(db, {
      projectId: firstProject,
      repositoryId: 701,
      repository: "wordbricks/briar",
      enabled: true,
      readinessStageId: "reviewing",
      validationCommands: ["bun run check"],
      quietWindowMs: 30_000,
      maxBatchSize: 5,
      observedAt,
    })).resolves.toMatchObject({ outcome: "active_batch" });
    await expect(configureMergeQueueProfile(db, {
      projectId: firstProject,
      repositoryId: 701,
      repository: "wordbricks/briar",
      enabled: false,
      readinessStageId: "ci_qa",
      validationCommands: ["bun run ci:local"],
      quietWindowMs: 30_000,
      maxBatchSize: 5,
      observedAt,
    })).resolves.toMatchObject({ outcome: "active_batch" });
    await expect(getMergeQueueProfile(db, firstProject)).resolves.toMatchObject({
      enabled: 1,
    });
  });
});
