import { createClient, Code, ConnectError } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  MergeQueueBatchState,
  MergeQueueCandidateState,
  MergeQueueService,
} from "@briar/contracts/gen/briar/app/v1/merge_queue_pb";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "./index";

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const guardedProjectId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const batchId = "55555555-5555-4555-8555-555555555555";
const candidateId = "66666666-6666-4666-8666-666666666666";
const guardedBatchId = "77777777-7777-4777-8777-777777777777";
const ownerId = "merge-queue-owner";
const viewerId = "merge-queue-viewer";
const observedAt = "2026-08-30T05:00:00.000Z";
const tokens = {
  owner: "merge-queue-owner-token",
  viewer: "merge-queue-viewer-token",
} as const;
const workflow = JSON.stringify({
  version: 2,
  requirements: [],
  stages: [
    {
      id: "ci_qa",
      label: "CI QA",
      required: true,
      checks: [" bun run check "],
      evidence: [],
    },
  ],
  execution: { checkpoints: [] },
  completion: { requiredStages: ["ci_qa"] },
});

describe("MergeQueueService", () => {
  const db = env.DB;

  beforeAll(async () => {
    await db.batch([
      ...[
        [ownerId, "Owner", "merge-queue-owner@example.com"],
        [viewerId, "Viewer", "merge-queue-viewer@example.com"],
      ].map(([id, name, email]) =>
        db
          .prepare(
            `insert into "user" (
             id, name, email, emailVerified, createdAt, updatedAt
           ) values (?, ?, ?, 1, ?, ?)`,
          )
          .bind(id, name, email, observedAt, observedAt),
      ),
      ...Object.entries(tokens).map(([role, token]) =>
        db
          .prepare(
            `insert into "session" (
             id, expiresAt, token, createdAt, updatedAt, userId
           ) values (?, '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
          )
          .bind(
            `merge-queue-${role}-session`,
            token,
            observedAt,
            observedAt,
            role === "owner" ? ownerId : viewerId,
          ),
      ),
      db
        .prepare(
          `insert into briar_organizations (
           id, name, handle, created_at, updated_at
         ) values (?, 'Merge Queue', 'merge-queue', ?, ?)`,
        )
        .bind(organizationId, observedAt, observedAt),
      ...[
        [ownerId, "owner"],
        [viewerId, "viewer"],
      ].map(([userId, role]) =>
        db
          .prepare(
            `insert into briar_organization_members (
             organization_id, user_id, role, created_at, updated_at
           ) values (?, ?, ?, ?, ?)`,
          )
          .bind(organizationId, userId, role, observedAt, observedAt),
      ),
      ...[
        [projectId, "Merge Queue Project", "a".repeat(64)],
        [guardedProjectId, "Guarded Merge Queue", "b".repeat(64)],
      ].map(([id, name, tokenHash]) =>
        db
          .prepare(
            `insert into briar_projects (
             id, owner_user_id, organization_id, name, agent_token_hash,
             created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, ownerId, organizationId, name, tokenHash, observedAt, observedAt),
      ),
      ...[projectId, guardedProjectId].map((id) =>
        db
          .prepare(
            `insert into briar_project_members (
             project_id, organization_id, user_id, created_at, updated_at
           ) values (?, ?, ?, ?, ?)`,
          )
          .bind(id, organizationId, viewerId, observedAt, observedAt),
      ),
      ...[
        [projectId, 701, "wordbricks/briar"],
        [guardedProjectId, 702, "wordbricks/guarded"],
      ].map(([id, repositoryId, repository]) =>
        db
          .prepare(
            `insert into briar_project_settings (
             project_id, github_repository_id, github_repository,
             workflow_json, mandatory_checkpoints_json, created_at, updated_at
           ) values (?, ?, ?, ?, '[]', ?, ?)`,
          )
          .bind(id, repositoryId, repository, workflow, observedAt, observedAt),
      ),
      db
        .prepare(
          `insert into briar_github_connections (
           installation_id, organization_id, installation_account_id,
           account_login, account_avatar_url, authorized_github_user_id,
           authorized_github_user_login, connected_by_user_id, status,
           connected_at, disconnected_at, updated_at
         ) values (
           901, ?, 1, 'wordbricks', 'https://example.com/avatar.png', 1,
           'merge-queue-owner', ?, 'connected', ?, null, ?
         )`,
        )
        .bind(organizationId, ownerId, observedAt, observedAt),
      ...[
        [701, "briar", "wordbricks/briar"],
        [702, "guarded", "wordbricks/guarded"],
      ].map(([repositoryId, name, fullName]) =>
        db
          .prepare(
            `insert into briar_github_connection_repositories (
             installation_id, repository_id, owner, name, full_name,
             created_at, updated_at
           ) values (901, ?, 'wordbricks', ?, ?, ?, ?)`,
          )
          .bind(repositoryId, name, fullName, observedAt, observedAt),
      ),
      db
        .prepare(
          `insert into briar_merge_queue_profiles (
           project_id, repository_id, repository, base_branch, enabled,
           readiness_stage_id, validation_commands_json, quiet_window_ms,
           max_batch_size, created_at, updated_at
         ) values (?, 702, 'wordbricks/guarded', 'main', 1, 'ci_qa',
                   '["bun run check"]', 30000, 5, ?, ?)`,
        )
        .bind(guardedProjectId, observedAt, observedAt),
      db
        .prepare(
          `insert into briar_merge_batches (
           id, project_id, repository_id, repository, base_branch, state,
           quiet_until, frozen_at, failure_code, created_at, updated_at
         ) values (?, ?, 702, 'wordbricks/guarded', 'main', 'blocked',
                   ?, ?, 'validation_failed', ?, ?)`,
        )
        .bind(guardedBatchId, guardedProjectId, observedAt, observedAt, observedAt, observedAt),
    ]);
  }, 60_000);

  const client = () =>
    createClient(
      MergeQueueService,
      createConnectTransport({
        baseUrl: "https://briar.example",
        fetch: async (input, init) =>
          worker.fetch(new Request(input, { ...init, redirect: "manual" }), {
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

  const expectCode = async (operation: Promise<unknown>, code: Code) => {
    const error = await operation.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(code);
  };

  it("persists workflow-derived configuration and projects status as generated messages", async () => {
    const mergeQueue = client();
    const updated = await mergeQueue.updateMergeQueueProfile(
      {
        projectId,
        enabled: true,
        readinessStageId: "ci_qa",
        quietWindow: { seconds: 1n, nanos: 500_000_000 },
        maxBatchSize: 2,
      },
      options(tokens.owner),
    );
    expect(updated.profile).toMatchObject({
      projectId,
      repositoryId: 701n,
      repository: "wordbricks/briar",
      baseBranch: "main",
      enabled: true,
      readinessStageId: "ci_qa",
      validationCommands: ["bun run check"],
      quietWindow: { seconds: 1n, nanos: 500_000_000 },
      maxBatchSize: 2,
    });

    await db.batch([
      db
        .prepare(
          `insert into briar_hunt_runs (
           id, project_id, source, source_key, title, stage, status,
           workflow_stage, repository, branch, commit_sha, started_at,
           last_event_at, created_at, updated_at, workflow_snapshot_json
         ) values (?, ?, 'issue', 'merge-queue-status', 'Merge queue status',
                   'implementing', 'running', 'ci_qa', 'wordbricks/briar',
                   'briar/status', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          runId,
          projectId,
          "a".repeat(40),
          observedAt,
          observedAt,
          observedAt,
          observedAt,
          workflow,
        ),
      db
        .prepare(
          `insert into briar_merge_batches (
           id, project_id, repository_id, repository, base_branch, state,
           quiet_until, frozen_at, failure_code, created_at, updated_at
         ) values (?, ?, 701, 'wordbricks/briar', 'main', 'blocked', ?, ?,
                   'validation_failed', ?, ?)`,
        )
        .bind(batchId, projectId, observedAt, observedAt, observedAt, observedAt),
      db
        .prepare(
          `insert into briar_merge_batch_candidates (
           id, project_id, batch_id, run_id, attempt, revision,
           repository_id, repository, base_branch, pull_request_id,
           pull_request_node_id, pull_request_number, pull_request_url,
           frozen_head_sha, frozen_base_sha, ready_at, ordinal, state,
           queue_entry_id, enqueued_at, created_at, updated_at
         ) values (?, ?, ?, ?, 1, 1, 701, 'wordbricks/briar', 'main', 91,
                   'PR_status', 42, 'https://github.com/wordbricks/briar/pull/42',
                   ?, ?, ?, 1, 'enqueued', 'MQ_status', ?, ?, ?)`,
        )
        .bind(
          candidateId,
          projectId,
          batchId,
          runId,
          "b".repeat(40),
          "c".repeat(40),
          observedAt,
          observedAt,
          observedAt,
          observedAt,
        ),
    ]);

    const status = await mergeQueue.getMergeQueueStatus({ projectId }, options(tokens.owner));
    expect(status.batches).toEqual([
      expect.objectContaining({
        id: batchId,
        state: MergeQueueBatchState.BLOCKED,
        candidateCount: 1,
        failureCode: "validation_failed",
      }),
    ]);
    expect(status.candidates).toEqual([
      expect.objectContaining({
        id: candidateId,
        pullRequestNumber: 42n,
        state: MergeQueueCandidateState.ENQUEUED,
        ordinal: 1,
      }),
    ]);
    expect(status.generatedAt).toBeDefined();
  });

  it("rejects invalid bounds, insufficient capability, and active-lane changes", async () => {
    const mergeQueue = client();
    await expectCode(
      mergeQueue.updateMergeQueueProfile(
        { projectId, enabled: true, maxBatchSize: 1 },
        options(tokens.owner),
      ),
      Code.InvalidArgument,
    );
    await expectCode(
      mergeQueue.updateMergeQueueProfile(
        { projectId: guardedProjectId, enabled: false },
        options(tokens.viewer),
      ),
      Code.PermissionDenied,
    );
    await expectCode(
      mergeQueue.updateMergeQueueProfile(
        {
          projectId: guardedProjectId,
          enabled: true,
          readinessStageId: "missing",
        },
        options(tokens.owner),
      ),
      Code.FailedPrecondition,
    );
    await expectCode(
      mergeQueue.updateMergeQueueProfile(
        { projectId: guardedProjectId, enabled: false },
        options(tokens.owner),
      ),
      Code.FailedPrecondition,
    );
  });
});
