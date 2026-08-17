import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  normalizeAutoHuntWorkflow,
  type AutoHuntWorkflow,
} from "../../src/lib/auto-hunt-contract";
import type { HuntEventInput } from "./db";
import {
  assertWorkflowRunCompletion,
  claimNextQueuedHuntRun,
  completeWorkflowStageLifecycle,
  completeWorkflowStage,
  createOrganization,
  createProject,
  getHuntRunForProject,
  getWorkflowProgress,
  initializeWorkflowProgress,
  listHuntRunEvents,
  reachWorkflowCheckpoint,
  recordHuntEvent,
  reworkHuntRun,
  resumeWorkflowCheckpoint,
  startWorkflowStageLifecycle,
  startWorkflowStage,
  HuntTransitionError,
} from "./db";
import { applyD1Migrations } from "./test-helpers/d1";

const baseTime = Date.parse("2026-08-01T00:00:00Z");
const at = (minute: number) =>
  new Date(baseTime + minute * 60_000).toISOString();

const event = (
  sourceKey: string,
  eventKey: string,
  occurredAt: string,
  overrides: Partial<HuntEventInput> = {},
): HuntEventInput => ({
  source: "issue",
  sourceKey,
  title: "Workflow v2 integration",
  stage: "queued",
  eventKey,
  occurredAt,
  actor: "vitest",
  repository: "example/repository",
  detail: "workflow v2 test run",
  priority: null,
  branch: null,
  commitSha: null,
  tracker: null,
  issueDescription: null,
  resultSummary: null,
  structuredResult: null,
  pullRequestUrls: [],
  targetSha: null,
  sourceCreatedAt: null,
  qaStatus: null,
  stagingQaDetail: null,
  productionQaDetail: null,
  context: null,
  ...overrides,
});

const frozenSnapshot = JSON.stringify({
  version: 2,
  requirements: [],
  stages: [
    { id: "implementing", label: "Implement", required: true },
    { id: "pr_open", label: "Open PR", required: true },
    { id: "production_qa", label: "Production QA", required: true },
  ],
  execution: {
    checkpoints: [{
      key: "project-after-pr_open",
      stage: "pr_open",
      position: "after",
    }],
  },
  completion: { requiredStages: ["implementing", "pr_open", "production_qa"] },
});

const v2Workflow: AutoHuntWorkflow = normalizeAutoHuntWorkflow({
  version: 2,
  requirements: [],
  stages: [
    { id: "implementing", label: "Implement", required: true, evidence: [], checks: [] },
    { id: "pr_open", label: "Open PR", required: true, evidence: [], checks: [] },
    { id: "staging_qa", label: "Stage QA", required: true, evidence: [], checks: [] },
    { id: "production_qa", label: "Production QA", required: true, evidence: [], checks: [] },
  ],
  execution: {
    checkpoints: [
      { key: "project-before-pr_open", stage: "pr_open", position: "before" },
      { key: "project-after-pr_open", stage: "pr_open", position: "after" },
      { key: "project-before-production_qa", stage: "production_qa", position: "before" },
    ],
  },
  completion: {
    requiredStages: ["implementing", "pr_open", "staging_qa", "production_qa"],
  },
});

describe("workflow v2 D1 persistence and transitions", () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "briar-workflow-v2-test" },
  });
  let db: D1Database;
  let projectId: string;
  let v2RunId: string;
  let snapshotsBeforeMigration: { settings: string; run: string };

  const setProjectWorkflow = async (workflow: AutoHuntWorkflow | string) => {
    const workflowJson = typeof workflow === "string"
      ? workflow
      : JSON.stringify(workflow);
    const checkpoints = (JSON.parse(workflowJson) as AutoHuntWorkflow)
      .execution.checkpoints;
    await db
      .prepare(
        `update briar_project_settings
         set workflow_json = ?, mandatory_checkpoints_json = ?
         where project_id = ?`,
      )
      .bind(workflowJson, JSON.stringify(checkpoints), projectId)
      .run();
  };

  const claimResumedRun = async (runId: string, minute: number) => {
    const claimed = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: "f".repeat(64),
      claimedBy: "resume-worker",
      claimedAt: at(minute),
      leaseExpiresAt: at(minute + 10),
      runId,
    });
    expect(claimed).toMatchObject({
      id: runId,
      status: "running",
      paused_at: null,
      resume_requested_at: expect.any(String),
    });
  };

  beforeAll(async () => {
    db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
    await applyD1Migrations(db, {
      exclude: [
        "0059_workflow_v2_progress.sql",
        "0061_workflow_stage_status_events.sql",
        "0078_workflow_v2_only.sql",
        // 0090 validates the checkpoint wait columns introduced by 0059.
        // Keep this historical fixture in real dependency order instead of
        // applying the approval guards against the deliberately pre-0059
        // schema assembled above.
        "0090_channel_issue_approval.sql",
        "0091_issue_execution_approvals.sql",
        "0092_agent_skill_execution_approvals.sql",
        "0100_channel_issue_regular_lifecycle.sql",
        "0101_issue_conversation_realtime.sql",
        // 0099 rebuilds channel messages and restores the guards from the
        // deliberately excluded 0091 and 0092 migrations.
        "0099_channel_incoming_webhooks.sql",
        // 0106 snapshots the fully migrated provider-constrained schema and
        // therefore depends on the deliberately excluded approval tables.
        "0106_agent_provider_agy.sql",
        // 0111 is the equivalent full-schema rebuild for Cursor and has the
        // same dependency on the deliberately excluded approval tables.
        "0111_agent_provider_cursor.sql",
        // 0112 rebuilds the Agent approval tables whose migrations are
        // deliberately excluded by this historical workflow fixture.
        "0112_expand_agent_text_limits.sql",
      ],
    });

    await db
      .prepare(
        `insert into user (id, name, email, emailVerified, createdAt, updatedAt)
         values (?, ?, ?, 1, ?, ?)`,
      )
      .bind("workflow-owner", "Workflow Owner", "workflow@example.com", at(0), at(0))
      .run();
    const organization = await createOrganization(db, {
      name: "Workflow Org",
      handle: "workflow-org",
      ownerUserId: "workflow-owner",
    });
    const project = await createProject(db, {
      ownerUserId: "workflow-owner",
      organizationId: organization.id,
      name: "Workflow Project",
      agentTokenHash: "a".repeat(64),
    });
    projectId = project.id;

    // Migration 0059 only adds normalized progress storage and must not rewrite
    // an already-frozen workflow snapshot.
    await setProjectWorkflow(v2Workflow);
    const frozenRunId = await recordHuntEvent(
      db,
      projectId,
      event("frozen-snapshot", "frozen-snapshot:queued", at(1)),
    );
    await setProjectWorkflow(frozenSnapshot);
    await db
      .prepare(`update briar_hunt_runs set workflow_snapshot_json = ? where id = ?`)
      .bind(frozenSnapshot, frozenRunId)
      .run();
    const beforeSettings = await db
      .prepare(`select workflow_json from briar_project_settings where project_id = ?`)
      .bind(projectId)
      .first<{ workflow_json: string }>();
    const beforeRun = await db
      .prepare(`select workflow_snapshot_json from briar_hunt_runs where id = ?`)
      .bind(frozenRunId)
      .first<{ workflow_snapshot_json: string }>();
    snapshotsBeforeMigration = {
      settings: beforeSettings!.workflow_json,
      run: beforeRun!.workflow_snapshot_json,
    };

    await applyD1Migrations(db, {
      files: ["0059_workflow_v2_progress.sql"],
    });
    await db
      .prepare(
        `insert into briar_run_stage_progress (
           run_id, attempt, revision, stage_id, state, started_at, finished_at
         ) values (?, 1, 1, 'implementing', 'completed', ?, ?)`,
      )
      .bind(frozenRunId, at(3), at(4))
      .run();
    await applyD1Migrations(db, {
      files: ["0061_workflow_stage_status_events.sql"],
    });
    await applyD1Migrations(db, {
      files: ["0090_channel_issue_approval.sql"],
    });
    await applyD1Migrations(db, {
      files: ["0091_issue_execution_approvals.sql"],
    });
    await applyD1Migrations(db, {
      files: ["0092_agent_skill_execution_approvals.sql"],
    });
    await applyD1Migrations(db, {
      files: ["0100_channel_issue_regular_lifecycle.sql"],
    });
    await applyD1Migrations(db, {
      files: ["0101_issue_conversation_realtime.sql"],
    });
    const backfilled = await db
      .prepare(
        `select event_count, last_event_at from briar_hunt_runs where id = ?`,
      )
      .bind(frozenRunId)
      .first<{ event_count: number; last_event_at: string }>();
    expect(backfilled).toEqual({ event_count: 2, last_event_at: at(3) });
    expect(
      await db
        .prepare(
          `select workflow_stage from briar_hunt_events
           where run_id = ? and event_key = 'workflow:stage-start:1:1:implementing'`,
        )
        .bind(frozenRunId)
        .first<string>("workflow_stage"),
    ).toBe("implementing");

    const afterSettings = await db
      .prepare(`select workflow_json from briar_project_settings where project_id = ?`)
      .bind(projectId)
      .first<{ workflow_json: string }>();
    const afterRun = await db
      .prepare(`select workflow_snapshot_json from briar_hunt_runs where id = ?`)
      .bind(frozenRunId)
      .first<{ workflow_snapshot_json: string }>();
    expect(afterSettings?.workflow_json).toBe(snapshotsBeforeMigration.settings);
    expect(afterRun?.workflow_snapshot_json).toBe(snapshotsBeforeMigration.run);

    await setProjectWorkflow(v2Workflow);
    v2RunId = await recordHuntEvent(
      db,
      projectId,
      event("v2-transitions", "v2-transitions:queued", at(2)),
    );
  }, 30_000);

  afterAll(async () => {
    await miniflare.dispose();
  });

  it("keeps frozen snapshots byte-for-byte unchanged and initializes normalized rows", async () => {
    const progress = await initializeWorkflowProgress(db, projectId, { runId: v2RunId });

    expect(progress?.attempt).toBe(1);
    expect(progress?.revision).toBe(1);
    expect(progress?.stages.map((stage) => [stage.stage_id, stage.state])).toEqual([
      ["implementing", "pending"],
      ["pr_open", "pending"],
      ["staging_qa", "pending"],
      ["production_qa", "pending"],
    ]);
    expect(progress?.checkpoints.map((checkpoint) => checkpoint.checkpoint_key)).toEqual([
      "project-before-pr_open",
      "project-after-pr_open",
      "project-before-production_qa",
    ]);

    const frozenRun = await db
      .prepare(
        `select waiting_checkpoint_key, waiting_checkpoint_revision
         from briar_hunt_runs where workflow_snapshot_json = ?`,
      )
      .bind(snapshotsBeforeMigration.run)
      .first<{ waiting_checkpoint_key: string | null; waiting_checkpoint_revision: number | null }>();
    expect(frozenRun).toEqual({
      waiting_checkpoint_key: null,
      waiting_checkpoint_revision: null,
    });
  });

  it("enforces idempotent forward stage transitions and before/after checkpoint boundaries", async () => {
    const identity = { runId: v2RunId, attempt: 1, revision: 1 };
    expect((await startWorkflowStage(db, projectId, {
      ...identity,
      stageId: "implementing",
      startedAt: at(10),
    })).outcome).toBe("started");
    expect((await startWorkflowStage(db, projectId, {
      ...identity,
      stageId: "implementing",
      startedAt: at(11),
    })).outcome).toBe("already_running");
    expect((await completeWorkflowStage(db, projectId, {
      ...identity,
      stageId: "implementing",
      finishedAt: at(12),
    })).outcome).toBe("completed");
    expect((await completeWorkflowStage(db, projectId, {
      ...identity,
      stageId: "implementing",
      finishedAt: at(13),
    })).outcome).toBe("completed");
    expect((await startWorkflowStage(db, projectId, {
      ...identity,
      stageId: "implementing",
      startedAt: at(14),
    })).outcome).toBe("completed");

    await expect(completeWorkflowStage(db, projectId, {
      ...identity,
      stageId: "pr_open",
      finishedAt: at(15),
    })).rejects.toThrow(HuntTransitionError);

    expect((await reachWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "project-before-pr_open",
      reachedAt: at(16),
    })).outcome).toBe("waiting");
    const paused = await getHuntRunForProject(db, projectId, v2RunId);
    expect(paused?.paused_at).toBe(at(16));
    expect(paused?.waiting_checkpoint_key).toBe("project-before-pr_open");
    await expect(startWorkflowStage(db, projectId, {
      ...identity,
      stageId: "pr_open",
      startedAt: at(17),
    })).rejects.toThrow(/waiting for checkpoint/u);

    const stale = await resumeWorkflowCheckpoint(db, projectId, {
      ...identity,
      revision: 2,
      checkpointKey: "project-before-pr_open",
      requestId: "11111111-1111-4111-8111-111111111111",
      actor: "pm",
      approvedAt: at(18),
    });
    expect(stale.outcome).toBe("conflict");
    expect((await getWorkflowProgress(db, projectId, v2RunId))?.waitingCheckpoint?.checkpoint_key)
      .toBe("project-before-pr_open");

    const approved = await resumeWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "project-before-pr_open",
      requestId: "11111111-1111-4111-8111-111111111111",
      actor: "pm",
      approvedAt: at(19),
    });
    expect(approved.outcome).toBe("approved");
    expect(await getHuntRunForProject(db, projectId, v2RunId)).toMatchObject({
      status: "running",
      stage: "pr_open",
      workflow_stage: "pr_open",
      paused_at: at(16),
      resume_requested_at: at(19),
    });
    const duplicate = await resumeWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "project-before-pr_open",
      requestId: "11111111-1111-4111-8111-111111111111",
      actor: "pm",
      approvedAt: at(20),
    });
    expect(duplicate.outcome).toBe("already_approved");
    expect(duplicate.nextStage).toBe("pr_open");
    await claimResumedRun(v2RunId, 20.5);

    expect((await startWorkflowStage(db, projectId, {
      ...identity,
      stageId: "pr_open",
      startedAt: at(21),
    })).outcome).toBe("started");
    expect((await completeWorkflowStage(db, projectId, {
      ...identity,
      stageId: "pr_open",
      finishedAt: at(22),
    })).outcome).toBe("completed");
    expect((await reachWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "project-after-pr_open",
      reachedAt: at(23),
    })).outcome).toBe("waiting");

    const secondWaiting = await reachWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "project-before-production_qa",
      reachedAt: at(24),
    });
    expect(secondWaiting.outcome).toBe("conflict");
    expect((await getWorkflowProgress(db, projectId, v2RunId))?.checkpoints
      .filter((checkpoint) => checkpoint.state === "waiting")).toHaveLength(1);

    const afterApproved = await resumeWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "project-after-pr_open",
      requestId: "22222222-2222-4222-8222-222222222222",
      actor: "pm",
      approvedAt: at(25),
    });
    expect(afterApproved.nextStage).toBe("staging_qa");
    expect(await getHuntRunForProject(db, projectId, v2RunId)).toMatchObject({
      status: "running",
      stage: "staging_qa",
      workflow_stage: "staging_qa",
      paused_at: at(23),
      resume_requested_at: at(25),
    });
    await claimResumedRun(v2RunId, 25.5);
    expect((await startWorkflowStage(db, projectId, {
      ...identity,
      stageId: "staging_qa",
      startedAt: at(26),
    })).outcome).toBe("started");
    expect((await completeWorkflowStage(db, projectId, {
      ...identity,
      stageId: "staging_qa",
      finishedAt: at(27),
    })).outcome).toBe("completed");

    await expect(assertWorkflowRunCompletion(db, projectId, v2RunId))
      .rejects.toThrow(/terminal stage production_qa/u);
    expect((await reachWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "project-before-production_qa",
      reachedAt: at(28),
    })).outcome).toBe("waiting");
    await expect(assertWorkflowRunCompletion(db, projectId, v2RunId))
      .rejects.toThrow(/waiting for checkpoint project-before-production_qa/u);
  });

  it("requires terminal completion, then invalidates all prior checkpoint approvals on rework", async () => {
    const identity = { runId: v2RunId, attempt: 1, revision: 1 };
    const approved = await resumeWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "project-before-production_qa",
      requestId: "33333333-3333-4333-8333-333333333333",
      actor: "pm",
      approvedAt: at(29),
    });
    expect(approved.outcome).toBe("approved");
    await claimResumedRun(v2RunId, 29.5);
    expect((await startWorkflowStage(db, projectId, {
      ...identity,
      stageId: "production_qa",
      startedAt: at(30),
    })).outcome).toBe("started");
    expect((await completeWorkflowStage(db, projectId, {
      ...identity,
      stageId: "production_qa",
      finishedAt: at(31),
    })).outcome).toBe("completed");
    expect((await assertWorkflowRunCompletion(db, projectId, v2RunId))?.runId)
      .toBe(v2RunId);

    const reworkAt = at(40);
    await db
      .prepare(
        `update briar_hunt_runs
         set status = 'running', stage = 'production_qa', workflow_stage = 'production_qa',
             paused_at = null, last_event_at = ?, updated_at = ?
         where id = ?`,
      )
      .bind(reworkAt, reworkAt, v2RunId)
      .run();
    const reworked = await reworkHuntRun(db, projectId, {
      runId: v2RunId,
      workflowStage: "pr_open",
      requestId: "44444444-4444-4444-8444-444444444444",
      actor: "pm",
      reason: "Rework PR implementation",
      occurredAt: reworkAt,
    });
    expect(reworked).toMatchObject({ outcome: "reworked", revision: 2, workflowStage: "pr_open" });

    const invalidated = await db
      .prepare(
        `select state from briar_run_checkpoint_progress
         where run_id = ? and revision = 1 and checkpoint_key = 'project-before-production_qa'`,
      )
      .bind(v2RunId)
      .first<{ state: string }>();
    expect(invalidated?.state).toBe("invalidated");
    expect((await getHuntRunForProject(db, projectId, v2RunId))?.waiting_checkpoint_key)
      .toBeNull();

    const newRevision = await initializeWorkflowProgress(db, projectId, {
      runId: v2RunId,
      attempt: 1,
      revision: 2,
    });
    expect(newRevision?.revision).toBe(2);
    expect(newRevision?.stages.find((stage) => stage.stage_id === "implementing")?.state)
      .toBe("completed");
    expect(newRevision?.checkpoints.find((checkpoint) => checkpoint.checkpoint_key === "project-before-production_qa")?.state)
      .toBe("pending");
    await expect(startWorkflowStage(db, projectId, {
      runId: v2RunId,
      attempt: 1,
      revision: 2,
      stageId: "pr_open",
      startedAt: at(41),
    })).rejects.toThrow(/before checkpoint project-before-pr_open/u);
    expect((await reachWorkflowCheckpoint(db, projectId, {
      runId: v2RunId,
      attempt: 1,
      revision: 2,
      checkpointKey: "project-before-pr_open",
      reachedAt: at(42),
    })).outcome).toBe("waiting");
  });

  it("orchestrates sequential before/after checkpoints and never replays the terminal stage", async () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 2,
      requirements: [],
      stages: [
        { id: "implementing", label: "Implement", required: true, evidence: [] },
        { id: "pr_open", label: "Open PR", required: true, evidence: [] },
        { id: "production_qa", label: "Production QA", required: true, evidence: [] },
      ],
      execution: {
        checkpoints: [
          { key: "project-before-pr_open", stage: "pr_open", position: "before" },
          { key: "project-after-pr_open", stage: "pr_open", position: "after" },
          { key: "project-after-production_qa", stage: "production_qa", position: "after" },
        ],
      },
      completion: {
        requiredStages: ["implementing", "pr_open", "production_qa"],
      },
    });
    await setProjectWorkflow(workflow);
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("lifecycle-orchestration", "lifecycle-orchestration:queued", at(50)),
    );
    const identity = { runId, attempt: 1, revision: 1 };

    expect((await startWorkflowStageLifecycle(db, projectId, {
      ...identity,
      stageId: "implementing",
      startedAt: at(51),
    })).outcome).toBe("started");
    expect((await completeWorkflowStageLifecycle(db, projectId, {
      ...identity,
      stageId: "implementing",
      finishedAt: at(52),
    })).outcome).toBe("completed");

    const before = await startWorkflowStageLifecycle(db, projectId, {
      ...identity,
      stageId: "pr_open",
      startedAt: at(53),
    });
    expect(before).toMatchObject({
      outcome: "paused",
      checkpoint: { key: "project-before-pr_open", position: "before" },
    });
    const resumedBefore = await resumeWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "project-before-pr_open",
      requestId: "55555555-5555-4555-8555-555555555555",
      actor: "pm",
      approvedAt: at(54),
    });
    expect(resumedBefore).toMatchObject({
      outcome: "approved",
      nextStage: "pr_open",
      terminalReviewOnly: false,
    });
    await claimResumedRun(runId, 54.5);

    expect((await startWorkflowStageLifecycle(db, projectId, {
      ...identity,
      stageId: "pr_open",
      startedAt: at(55),
    })).outcome).toBe("started");
    const after = await completeWorkflowStageLifecycle(db, projectId, {
      ...identity,
      stageId: "pr_open",
      finishedAt: at(56),
    });
    expect(after).toMatchObject({
      outcome: "paused",
      checkpoint: { key: "project-after-pr_open", position: "after" },
    });
    expect(await resumeWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "project-after-pr_open",
      requestId: "66666666-6666-4666-8666-666666666666",
      actor: "pm",
      approvedAt: at(57),
    })).toMatchObject({
      nextStage: "production_qa",
      terminalReviewOnly: false,
    });
    await claimResumedRun(runId, 57.5);

    expect((await startWorkflowStageLifecycle(db, projectId, {
      ...identity,
      stageId: "production_qa",
      startedAt: at(58),
    })).outcome).toBe("started");
    const terminalPause = await completeWorkflowStageLifecycle(db, projectId, {
      ...identity,
      stageId: "production_qa",
      finishedAt: at(59),
    });
    expect(terminalPause).toMatchObject({
      outcome: "paused",
      checkpoint: { key: "project-after-production_qa", position: "after" },
    });
    const terminalResume = await resumeWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "project-after-production_qa",
      requestId: "77777777-7777-4777-8777-777777777777",
      actor: "pm",
      approvedAt: at(60),
    });
    expect(terminalResume).toMatchObject({
      outcome: "approved",
      nextStage: null,
      terminalReviewOnly: true,
    });
    await claimResumedRun(runId, 60.5);
    expect((await completeWorkflowStageLifecycle(db, projectId, {
      ...identity,
      stageId: "production_qa",
      finishedAt: at(61),
    })).outcome).toBe("already_completed");
    await expect(assertWorkflowRunCompletion(db, projectId, runId)).resolves.toMatchObject({
      runId,
    });
  });

  it("requires configured evidence before completing a stage", async () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 2,
      requirements: [],
      stages: [
        {
          id: "implementing",
          label: "Implement",
          required: true,
          evidence: ["diff"],
        },
      ],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["implementing"] },
    });
    await setProjectWorkflow(workflow);
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("lifecycle-evidence", "lifecycle-evidence:queued", at(70)),
    );
    const identity = { runId, attempt: 1, revision: 1 };
    await startWorkflowStageLifecycle(db, projectId, {
      ...identity,
      stageId: "implementing",
      startedAt: at(71),
    });
    await expect(completeWorkflowStageLifecycle(db, projectId, {
      ...identity,
      stageId: "implementing",
      finishedAt: at(72),
    })).rejects.toThrow(/requires evidence: diff/u);
    expect((await getWorkflowProgress(db, projectId, runId))?.stages[0]?.state)
      .toBe("running");
  });

  it("records lifecycle stage starts in the issue status history", async () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 2,
      requirements: [],
      stages: [
        { id: "staging_qa", label: "Stage QA", required: true, evidence: [] },
      ],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["staging_qa"] },
    });
    await setProjectWorkflow(workflow);
    const sourceKey = "lifecycle-status-history";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event(sourceKey, `${sourceKey}:queued`, at(75)),
    );

    await startWorkflowStageLifecycle(db, projectId, {
      runId,
      attempt: 1,
      revision: 1,
      stageId: "staging_qa",
      startedAt: at(76),
      actor: "briar-worker:test",
    });

    const events = await listHuntRunEvents(db, projectId, runId);
    expect(events.map((item) => item.workflow_stage)).toEqual([
      "staging_qa",
      null,
    ]);
    expect(events[0]).toMatchObject({
      event_key: "workflow:stage-start:1:1:staging_qa",
      status: "running",
      actor: "briar-worker:test",
      detail: "Stage QA 단계를 시작했습니다.",
    });
    expect((await getHuntRunForProject(db, projectId, runId))?.event_count).toBe(2);
  });

  it("recovers a crash between stage completion and its after checkpoint", async () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 2,
      requirements: [],
      stages: [
        { id: "implementing", label: "Implement", required: true, evidence: [] },
        { id: "pr_open", label: "Open PR", required: true, evidence: [] },
      ],
      execution: {
        checkpoints: [
          { key: "project-after-implementing", stage: "implementing", position: "after" },
        ],
      },
      completion: { requiredStages: ["implementing", "pr_open"] },
    });
    await setProjectWorkflow(workflow);
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("checkpoint-crash-recovery", "checkpoint-crash-recovery:queued", at(80)),
    );
    const identity = { runId, attempt: 1, revision: 1 };
    await startWorkflowStage(db, projectId, {
      ...identity,
      stageId: "implementing",
      startedAt: at(81),
    });
    // Simulate a process exit after the stage row committed but before the
    // lifecycle wrapper reached the after-stage checkpoint.
    await completeWorkflowStage(db, projectId, {
      ...identity,
      stageId: "implementing",
      finishedAt: at(82),
    });
    expect(await startWorkflowStageLifecycle(db, projectId, {
      ...identity,
      stageId: "pr_open",
      startedAt: at(83),
    })).toMatchObject({
      outcome: "paused",
      checkpoint: { key: "project-after-implementing", position: "after" },
    });
  });

  it("keeps lifecycle progress authoritative when status events arrive", async () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 2,
      requirements: [],
      stages: [
        { id: "implementing", label: "Implement", required: true, evidence: [] },
      ],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["implementing"] },
    });
    await setProjectWorkflow(workflow);
    const sourceKey = "lifecycle-event-guard";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event(sourceKey, `${sourceKey}:queued`, at(90)),
    );
    await initializeWorkflowProgress(db, projectId, { runId });
    await expect(recordHuntEvent(
      db,
      projectId,
      event(sourceKey, `${sourceKey}:running-before-start`, at(91), {
        status: "running",
        workflowStage: "implementing",
      }),
    )).resolves.toBe(runId);
    await expect(getWorkflowProgress(db, projectId, runId)).resolves.toMatchObject({
      stages: [expect.objectContaining({ stage_id: "implementing", state: "pending" })],
    });
    await startWorkflowStageLifecycle(db, projectId, {
      runId,
      attempt: 1,
      revision: 1,
      stageId: "implementing",
      startedAt: at(92),
    });
    await expect(recordHuntEvent(
      db,
      projectId,
      event(sourceKey, `${sourceKey}:running-after-start`, at(93), {
        status: "running",
        workflowStage: "implementing",
      }),
    )).resolves.toBe(runId);
  });

  it("reworks a paused current stage only for the exact checkpoint revision", async () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 2,
      requirements: [],
      stages: [
        { id: "implementing", label: "Implement", required: true, evidence: [] },
      ],
      execution: {
        checkpoints: [
          { key: "project-after-implementing", stage: "implementing", position: "after" },
        ],
      },
      completion: { requiredStages: ["implementing"] },
    });
    await setProjectWorkflow(workflow);
    const sourceKey = "paused-current-stage-rework";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event(sourceKey, `${sourceKey}:queued`, at(100)),
    );
    const identity = { runId, attempt: 1, revision: 1 };
    expect((await startWorkflowStageLifecycle(db, projectId, {
      ...identity,
      stageId: "implementing",
      startedAt: at(101),
    })).outcome).toBe("started");
    expect(await completeWorkflowStageLifecycle(db, projectId, {
      ...identity,
      stageId: "implementing",
      finishedAt: at(102),
    })).toMatchObject({
      outcome: "paused",
      checkpoint: { key: "project-after-implementing" },
    });

    await expect(reworkHuntRun(db, projectId, {
      runId,
      workflowStage: "implementing",
      requestId: "88888888-8888-4888-8888-888888888888",
      actor: "pm",
      reason: "Revise the copy and rerun the UI checks.",
      occurredAt: at(103),
      checkpoint: {
        key: "stale-checkpoint",
        attempt: 1,
        revision: 1,
      },
    })).rejects.toThrow(/checkpoint changed/u);

    await expect(reworkHuntRun(db, projectId, {
      runId,
      workflowStage: "implementing",
      requestId: "99999999-9999-4999-8999-999999999999",
      actor: "pm",
      reason: "Revise the copy and rerun the UI checks.",
      occurredAt: at(104),
      checkpoint: {
        key: "project-after-implementing",
        attempt: 1,
        revision: 1,
      },
    })).resolves.toEqual({
      outcome: "reworked",
      attempt: 1,
      revision: 2,
      workflowStage: "implementing",
    });
    expect(await getHuntRunForProject(db, projectId, runId)).toMatchObject({
      current_attempt: 1,
      current_revision: 2,
      status: "queued",
      workflow_stage: "implementing",
      detail: "Revise the copy and rerun the UI checks.",
      paused_at: null,
      waiting_checkpoint_key: null,
    });
  });
});
