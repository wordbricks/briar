import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HuntEventInput } from "./db";
import {
  assertQueuedHuntClaim,
  claimNextQueuedHuntRun,
  createProject,
  createIssueAttachments,
  deleteProject,
  getProject,
  getProjectSettings,
  getHuntRunForProject,
  getIssueAttachment,
  getNextQueuedHuntRun,
  HuntClaimError,
  HuntTransitionError,
  listIssueAttachments,
  recoverHuntRun,
  recordHuntEvent,
  recordQaResult,
} from "./db";

const projectId = "11111111-1111-4111-8111-111111111111";
const baseTime = Date.parse("2026-07-21T00:00:00Z");
const atMinute = (minute: number) =>
  new Date(baseTime + minute * 60_000).toISOString();
const executeSql = async (db: D1Database, sql: string) => {
  for (const statement of sql.split(/;\s*(?:\n|$)/u)) {
    if (statement.trim()) await db.prepare(statement).run();
  }
};

const event = (
  stage: HuntEventInput["stage"],
  minute: number,
  overrides: Partial<HuntEventInput> = {},
): HuntEventInput => ({
  source: "issue",
  sourceKey: "integration-run",
  title: "D1 lifecycle integration",
  stage,
  eventKey: `integration:${stage}:${minute}`,
  occurredAt: atMinute(minute),
  actor: "vitest",
  repository: "example/repository",
  detail: `${stage} detail`,
  priority: null,
  branch: "codex/integration",
  commitSha: "abcdef1",
  tracker: null,
  issueDescription: null,
  resultSummary: null,
  pullRequestUrls: [],
  targetSha: null,
  sourceCreatedAt: null,
  qaStatus: null,
  stagingQaDetail: null,
  productionQaDetail: null,
  context: null,
  ...overrides,
});

describe("Briar Auto Hunt D1 lifecycle", () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "briar-test" },
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
    ]) {
      await executeSql(db, await readFile(resolve(migration), "utf8"));
    }
    await executeSql(db, `
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('owner', 'Owner', 'owner@example.com', 1, '${atMinute(0)}', '${atMinute(0)}');
      insert into briar_projects (
        id, owner_user_id, name, agent_token_hash, created_at, updated_at
      ) values (
        '${projectId}', 'owner', 'Example',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_project_settings (
        project_id, velen_org, linear_enabled, workflow_json, created_at, updated_at
      ) values (
        '${projectId}', 'example', 0,
        '{"version":1,"preset":"release","stages":[{"id":"analyzing","label":"분석","required":true},{"id":"implementing","label":"구현","required":true},{"id":"pr_open","label":"PR 검증","required":true},{"id":"staging_qa","label":"Stage QA","required":true},{"id":"production_qa","label":"Production QA","required":true}]}',
        '${atMinute(0)}', '${atMinute(0)}'
      );
    `);
  });

  afterAll(async () => {
    await miniflare.dispose();
  });

  it("enforces forward stages, QA gates, and a completion summary", async () => {
    const runId = await recordHuntEvent(db, projectId, event("queued", 1));
    expect(runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    await recordHuntEvent(db, projectId, event("analyzing", 2));
    await recordHuntEvent(db, projectId, event("implementing", 3));
    await expect(
      recordHuntEvent(db, projectId, event("analyzing", 4)),
    ).rejects.toBeInstanceOf(HuntTransitionError);

    await recordHuntEvent(db, projectId, event("pr_open", 5));

    await recordHuntEvent(
      db,
      projectId,
      event("staging_qa", 6, { qaStatus: "pending", targetSha: "abcdef1" }),
    );
    expect(
      await recordQaResult(db, projectId, {
        runId,
        environment: "staging",
        result: "passed",
        actor: "vitest",
        observedAt: atMinute(7),
        detail: "staging verified",
      }),
    ).toBe("passed");
    await recordHuntEvent(
      db,
      projectId,
      event("production_qa", 8, { qaStatus: "pending", targetSha: "abcdef1" }),
    );
    await expect(
      recordHuntEvent(
        db,
        projectId,
        event("completed", 9, { resultSummary: "too early" }),
      ),
    ).rejects.toThrow("Production QA");
    expect(
      await recordQaResult(db, projectId, {
        runId,
        environment: "production",
        result: "passed",
        actor: "vitest",
        observedAt: atMinute(10),
        detail: "production verified",
      }),
    ).toBe("passed");
    await expect(
      recordHuntEvent(db, projectId, event("completed", 11)),
    ).rejects.toThrow("result summary");
    const completion = event("completed", 12, {
      resultSummary: "Production verified",
    });
    await recordHuntEvent(
      db,
      projectId,
      completion,
    );
    await expect(recordHuntEvent(db, projectId, completion)).resolves.toBe(runId);

    const run = await db
      .prepare(
        `select stage, staging_qa_status, production_qa_status, result_summary
         from briar_hunt_runs where id = ?`,
      )
      .bind(runId)
      .first<{
        stage: string;
        staging_qa_status: string;
        production_qa_status: string;
        result_summary: string;
      }>();
    expect(run).toEqual({
      stage: "completed",
      staging_qa_status: "passed",
      production_qa_status: "passed",
      result_summary: "Production verified",
    });
  });

  it("deletes only a project owned by the requesting user", async () => {
    const project = await createProject(db, {
      ownerUserId: "owner",
      name: "Disposable",
      agentTokenHash: "d".repeat(64),
    });

    await expect(deleteProject(db, project.id, "someone-else")).resolves.toBe(false);
    await expect(getProject(db, project.id, "owner")).resolves.not.toBeNull();
    await expect(deleteProject(db, project.id, "owner")).resolves.toBe(true);
    await expect(getProject(db, project.id, "owner")).resolves.toBeNull();
    await expect(getProjectSettings(db, project.id)).resolves.toBeNull();
  });

  it("stores an app-created issue as a queued Auto Hunt run", async () => {
    await db
      .prepare(
        `update briar_project_settings set workflow_json = ? where project_id = ?`,
      )
      .bind(
        '{"version":1,"preset":"local","stages":[{"id":"analyzing","label":"분석","required":true},{"id":"implementing","label":"구현","required":true},{"id":"local_qa","label":"로컬 검증","required":true}]}',
        projectId,
      )
      .run();
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 20, {
        sourceKey: "briar-issue:22222222-2222-4222-8222-222222222222",
        eventKey:
          "briar-issue:22222222-2222-4222-8222-222222222222:queued:intake",
        title: "App-created issue",
        actor: "briar-app",
        priority: 2,
        branch: null,
        commitSha: null,
        issueDescription: "Created directly in Briar",
        sourceCreatedAt: atMinute(20),
        context: {
          origin: "briar-app",
          issueId: "22222222-2222-4222-8222-222222222222",
        },
      }),
    );

    const run = await db
      .prepare(
        `select stage, source, title, priority, issue_description, context_json
         from briar_hunt_runs where id = ?`,
      )
      .bind(runId)
      .first<{
        stage: string;
        source: string;
        title: string;
        priority: number;
        issue_description: string;
        context_json: string;
      }>();

    expect(run).toEqual({
      stage: "queued",
      source: "issue",
      title: "App-created issue",
      priority: 2,
      issue_description: "Created directly in Briar",
      context_json:
        '{"origin":"briar-app","issueId":"22222222-2222-4222-8222-222222222222"}',
    });
  });

  it("completes a local workflow without staging or production", async () => {
    const common = { sourceKey: "local-only-run" };
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 30, common),
    );
    await recordHuntEvent(db, projectId, event("analyzing", 31, common));
    await recordHuntEvent(db, projectId, event("implementing", 32, common));
    await recordHuntEvent(
      db,
      projectId,
      event("implementing", 33, {
        ...common,
        status: "running",
        workflowStage: "local_qa",
      }),
    );
    await recordHuntEvent(
      db,
      projectId,
      event("completed", 34, {
        ...common,
        resultSummary: "Local checks passed",
      }),
    );
    const run = await getHuntRunForProject(db, projectId, runId);
    expect(run).toEqual(
      expect.objectContaining({
        status: "completed",
        workflow_stage: "local_qa",
        production_qa_status: null,
      }),
    );
  });

  it("stores issue attachment metadata scoped to its project and run", async () => {
    const run = await getNextQueuedHuntRun(db, projectId);
    expect(run).not.toBeNull();
    const attachmentId = "66666666-6666-4666-8666-666666666666";
    await createIssueAttachments(db, projectId, run!.id, [
      {
        id: attachmentId,
        object_key: `issue-attachments/${projectId}/${run!.id}/${attachmentId}`,
        filename: "screen.png",
        content_type: "image/png",
        byte_size: 2048,
      },
    ]);

    expect(await listIssueAttachments(db, projectId, run!.id)).toEqual([
      expect.objectContaining({
        id: attachmentId,
        run_id: run!.id,
        project_id: projectId,
        filename: "screen.png",
        content_type: "image/png",
        byte_size: 2048,
      }),
    ]);
    expect(
      await getIssueAttachment(db, projectId, run!.id, attachmentId),
    ).toEqual(expect.objectContaining({ object_key: expect.stringContaining(attachmentId) }));
    expect(
      await getIssueAttachment(
        db,
        "99999999-9999-4999-8999-999999999999",
        run!.id,
        attachmentId,
      ),
    ).toBeNull();
  });

  it("returns the highest-priority oldest queued run", async () => {
    const urgentId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 21, {
        sourceKey: "briar-issue:33333333-3333-4333-8333-333333333333",
        eventKey:
          "briar-issue:33333333-3333-4333-8333-333333333333:queued:intake",
        title: "Urgent queued issue",
        priority: 1,
        branch: null,
        commitSha: null,
      }),
    );

    const next = await getNextQueuedHuntRun(db, projectId);

    expect(next?.id).toBe(urgentId);
    expect(next?.title).toBe("Urgent queued issue");
    expect(next?.stage).toBe("queued");
  });

  it("claims queued runs atomically and safely reassigns expired leases", async () => {
    const firstHash = "a".repeat(64);
    const secondHash = "b".repeat(64);
    const replacementHash = "c".repeat(64);
    await expect(
      assertQueuedHuntClaim(
        db,
        projectId,
        {
          source: "issue",
          sourceKey: "briar-issue:22222222-2222-4222-8222-222222222222",
        },
        null,
        atMinute(21),
      ),
    ).rejects.toBeInstanceOf(HuntClaimError);

    const [first, second] = await Promise.all([
      claimNextQueuedHuntRun(db, projectId, {
        claimTokenHash: firstHash,
        claimedBy: "agent-one",
        claimedAt: atMinute(22),
        leaseExpiresAt: atMinute(32),
      }),
      claimNextQueuedHuntRun(db, projectId, {
        claimTokenHash: secondHash,
        claimedBy: "agent-two",
        claimedAt: atMinute(22),
        leaseExpiresAt: atMinute(32),
      }),
    ]);

    expect(new Set([first?.title, second?.title])).toEqual(
      new Set(["Urgent queued issue", "App-created issue"]),
    );
    expect(second?.id).not.toBe(first?.id);

    const replacement = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: replacementHash,
      claimedBy: "agent-three",
      claimedAt: atMinute(40),
      leaseExpiresAt: atMinute(50),
    });
    expect(replacement?.title).toBe("Urgent queued issue");
    expect(replacement?.claim_attempts).toBe(2);

    await expect(
      assertQueuedHuntClaim(
        db,
        projectId,
        { source: "issue", sourceKey: replacement!.source_key },
        firstHash,
        atMinute(41),
      ),
    ).rejects.toBeInstanceOf(HuntClaimError);
    await expect(
      assertQueuedHuntClaim(
        db,
        projectId,
        { source: "issue", sourceKey: replacement!.source_key },
        replacementHash,
        atMinute(41),
      ),
    ).resolves.toBeUndefined();
  });

  it("retries failed runs as a new attempt while preserving prior evidence", async () => {
    const sourceKey = "recovery-run";
    const sharedAnalyzingKey = "recovery:analyzing:stable";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 51, { sourceKey, eventKey: "recovery:queued:1" }),
    );
    await recordHuntEvent(
      db,
      projectId,
      event("analyzing", 52, { sourceKey, eventKey: sharedAnalyzingKey }),
    );
    await recordHuntEvent(
      db,
      projectId,
      event("failed", 53, { sourceKey, eventKey: "recovery:failed:1" }),
    );

    const requestId = "44444444-4444-4444-8444-444444444444";
    expect(
      await recoverHuntRun(db, projectId, {
        runId,
        action: "retry",
        requestId,
        actor: "vitest",
        reason: "Retry after a transient failure",
        occurredAt: atMinute(54),
      }),
    ).toEqual({ outcome: "retried", attempt: 2, stage: "queued" });
    expect(
      await recoverHuntRun(db, projectId, {
        runId,
        action: "retry",
        requestId,
        actor: "vitest",
        reason: "Retry after a transient failure",
        occurredAt: atMinute(54),
      }),
    ).toEqual({ outcome: "already_retried", attempt: 2, stage: "queued" });

    await expect(
      recordHuntEvent(
        db,
        projectId,
        event("analyzing", 55, {
          sourceKey,
          eventKey: sharedAnalyzingKey,
          detail: "Second attempt analysis",
        }),
      ),
    ).resolves.toBe(runId);

    const run = await db
      .prepare(
        `select stage, current_attempt, branch, commit_sha, completed_at
         from briar_hunt_runs where id = ?`,
      )
      .bind(runId)
      .first<{
        stage: string;
        current_attempt: number;
        branch: string | null;
        commit_sha: string | null;
        completed_at: string | null;
      }>();
    expect(run).toEqual({
      stage: "analyzing",
      current_attempt: 2,
      branch: "codex/integration",
      commit_sha: "abcdef1",
      completed_at: null,
    });
    const events = await db
      .prepare(
        `select attempt, stage from briar_hunt_events
         where run_id = ? order by occurred_at`,
      )
      .bind(runId)
      .all<{ attempt: number; stage: string }>();
    expect(events.results).toEqual([
      { attempt: 1, stage: "queued" },
      { attempt: 1, stage: "analyzing" },
      { attempt: 1, stage: "failed" },
      { attempt: 2, stage: "queued" },
      { attempt: 2, stage: "analyzing" },
    ]);
  });

  it("cancels blocked runs idempotently without deleting evidence", async () => {
    const sourceKey = "cancel-run";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 60, { sourceKey, eventKey: "cancel:queued" }),
    );
    await recordHuntEvent(
      db,
      projectId,
      event("blocked", 61, { sourceKey, eventKey: "cancel:blocked" }),
    );
    const input = {
      runId,
      action: "cancel" as const,
      requestId: "55555555-5555-4555-8555-555555555555",
      actor: "vitest",
      reason: null,
      occurredAt: atMinute(62),
    };
    expect(await recoverHuntRun(db, projectId, input)).toEqual({
      outcome: "cancelled",
      attempt: 1,
      stage: "cancelled",
    });
    expect(await recoverHuntRun(db, projectId, input)).toEqual({
      outcome: "already_cancelled",
      attempt: 1,
      stage: "cancelled",
    });
    expect(
      await db
        .prepare("select count(*) as count from briar_hunt_events where run_id = ?")
        .bind(runId)
        .first<number>("count"),
    ).toBe(3);
  });
});
