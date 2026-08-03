import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  normalizeAutoHuntWorkflow,
  type AutoHuntWorkflow,
} from "../../src/lib/auto-hunt-contract";
import type { HuntEventInput } from "./db";
import {
  assertWorkflowRunCompletion,
  completeWorkflowStageLifecycle,
  completeWorkflowStage,
  createOrganization,
  createProject,
  getHuntRunForProject,
  getWorkflowProgress,
  initializeWorkflowProgress,
  reachWorkflowCheckpoint,
  recordHuntEvent,
  reworkHuntRun,
  resumeWorkflowCheckpoint,
  startWorkflowStageLifecycle,
  startWorkflowStage,
  HuntTransitionError,
} from "./db";

const baseTime = Date.parse("2026-08-01T00:00:00Z");
const at = (minute: number) =>
  new Date(baseTime + minute * 60_000).toISOString();

const executeMigration = async (db: D1Database, sql: string) => {
  let statement: string[] = [];
  let inTrigger = false;
  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed && statement.length === 0) continue;
    statement.push(line);
    if (/^create trigger\b/iu.test(trimmed)) inTrigger = true;
    const complete = inTrigger
      ? /^end;$/iu.test(trimmed)
      : trimmed.endsWith(";");
    if (!complete) continue;
    await db.prepare(statement.join("\n")).run();
    statement = [];
    inTrigger = false;
  }
  if (statement.some((line) => line.trim())) {
    throw new Error("Incomplete migration statement");
  }
};

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

const v1Snapshot = JSON.stringify({
  version: 1,
  stages: [
    { id: "implementing", label: "Implement", required: true },
    { id: "pr_open", label: "Open PR", required: true },
    { id: "production_qa", label: "Production QA", required: true },
  ],
  execution: { pauseAfterStage: "pr_open" },
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
      { key: "approve-pr", stage: "pr_open", position: "before" },
      { key: "review-pr", stage: "pr_open", position: "after" },
      { key: "approve-production", stage: "production_qa", position: "before" },
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

  beforeAll(async () => {
    db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
    const migrationNames = (await readdir(resolve("migrations")))
      .filter((name) => /^\d+_.*\.sql$/u.test(name))
      .sort();
    for (const name of migrationNames) {
      if (name === "0059_workflow_v2_progress.sql") continue;
      await executeMigration(db, await readFile(resolve("migrations", name), "utf8"));
    }

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

    // Seed a pre-migration v1 settings/run snapshot, then capture its exact
    // stored bytes. Migration 0059 must only add schema, never rewrite them.
    await db
      .prepare(`update briar_project_settings set workflow_json = ? where project_id = ?`)
      .bind(v1Snapshot, projectId)
      .run();
    const legacyRunId = await recordHuntEvent(
      db,
      projectId,
      event("legacy-snapshot", "legacy-snapshot:queued", at(1)),
    );
    await db
      .prepare(`update briar_hunt_runs set workflow_snapshot_json = ? where id = ?`)
      .bind(v1Snapshot, legacyRunId)
      .run();
    const beforeSettings = await db
      .prepare(`select workflow_json from briar_project_settings where project_id = ?`)
      .bind(projectId)
      .first<{ workflow_json: string }>();
    const beforeRun = await db
      .prepare(`select workflow_snapshot_json from briar_hunt_runs where id = ?`)
      .bind(legacyRunId)
      .first<{ workflow_snapshot_json: string }>();
    snapshotsBeforeMigration = {
      settings: beforeSettings!.workflow_json,
      run: beforeRun!.workflow_snapshot_json,
    };

    await executeMigration(
      db,
      await readFile(resolve("migrations", "0059_workflow_v2_progress.sql"), "utf8"),
    );

    const afterSettings = await db
      .prepare(`select workflow_json from briar_project_settings where project_id = ?`)
      .bind(projectId)
      .first<{ workflow_json: string }>();
    const afterRun = await db
      .prepare(`select workflow_snapshot_json from briar_hunt_runs where id = ?`)
      .bind(legacyRunId)
      .first<{ workflow_snapshot_json: string }>();
    expect(afterSettings?.workflow_json).toBe(snapshotsBeforeMigration.settings);
    expect(afterRun?.workflow_snapshot_json).toBe(snapshotsBeforeMigration.run);

    await db
      .prepare(`update briar_project_settings set workflow_json = ? where project_id = ?`)
      .bind(JSON.stringify(v2Workflow), projectId)
      .run();
    v2RunId = await recordHuntEvent(
      db,
      projectId,
      event("v2-transitions", "v2-transitions:queued", at(2)),
    );
  }, 30_000);

  afterAll(async () => {
    await miniflare.dispose();
  });

  it("keeps legacy snapshots byte-for-byte unchanged and initializes normalized rows", async () => {
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
      "approve-pr",
      "review-pr",
      "approve-production",
    ]);

    const legacyRun = await db
      .prepare(
        `select waiting_checkpoint_key, waiting_checkpoint_revision
         from briar_hunt_runs where workflow_snapshot_json = ?`,
      )
      .bind(snapshotsBeforeMigration.run)
      .first<{ waiting_checkpoint_key: string | null; waiting_checkpoint_revision: number | null }>();
    expect(legacyRun).toEqual({
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
      checkpointKey: "approve-pr",
      reachedAt: at(16),
    })).outcome).toBe("waiting");
    const paused = await getHuntRunForProject(db, projectId, v2RunId);
    expect(paused?.paused_at).toBe(at(16));
    expect(paused?.waiting_checkpoint_key).toBe("approve-pr");
    await expect(startWorkflowStage(db, projectId, {
      ...identity,
      stageId: "pr_open",
      startedAt: at(17),
    })).rejects.toThrow(/waiting for checkpoint/u);

    const stale = await resumeWorkflowCheckpoint(db, projectId, {
      ...identity,
      revision: 2,
      checkpointKey: "approve-pr",
      requestId: "11111111-1111-4111-8111-111111111111",
      actor: "pm",
      approvedAt: at(18),
    });
    expect(stale.outcome).toBe("conflict");
    expect((await getWorkflowProgress(db, projectId, v2RunId))?.waitingCheckpoint?.checkpoint_key)
      .toBe("approve-pr");

    const approved = await resumeWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "approve-pr",
      requestId: "11111111-1111-4111-8111-111111111111",
      actor: "pm",
      approvedAt: at(19),
    });
    expect(approved.outcome).toBe("approved");
    const duplicate = await resumeWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "approve-pr",
      requestId: "11111111-1111-4111-8111-111111111111",
      actor: "pm",
      approvedAt: at(20),
    });
    expect(duplicate.outcome).toBe("already_approved");
    expect(duplicate.nextStage).toBe("pr_open");

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
      checkpointKey: "review-pr",
      reachedAt: at(23),
    })).outcome).toBe("waiting");

    const secondWaiting = await reachWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "approve-production",
      reachedAt: at(24),
    });
    expect(secondWaiting.outcome).toBe("conflict");
    expect((await getWorkflowProgress(db, projectId, v2RunId))?.checkpoints
      .filter((checkpoint) => checkpoint.state === "waiting")).toHaveLength(1);

    const afterApproved = await resumeWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "review-pr",
      requestId: "22222222-2222-4222-8222-222222222222",
      actor: "pm",
      approvedAt: at(25),
    });
    expect(afterApproved.nextStage).toBe("staging_qa");
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
      checkpointKey: "approve-production",
      reachedAt: at(28),
    })).outcome).toBe("waiting");
    await expect(assertWorkflowRunCompletion(db, projectId, v2RunId))
      .rejects.toThrow(/waiting for checkpoint approve-production/u);
  });

  it("requires terminal completion, then invalidates all prior checkpoint approvals on rework", async () => {
    const identity = { runId: v2RunId, attempt: 1, revision: 1 };
    const approved = await resumeWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "approve-production",
      requestId: "33333333-3333-4333-8333-333333333333",
      actor: "pm",
      approvedAt: at(29),
    });
    expect(approved.outcome).toBe("approved");
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
         where run_id = ? and revision = 1 and checkpoint_key = 'approve-production'`,
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
    expect(newRevision?.checkpoints.find((checkpoint) => checkpoint.checkpoint_key === "approve-production")?.state)
      .toBe("pending");
    await expect(startWorkflowStage(db, projectId, {
      runId: v2RunId,
      attempt: 1,
      revision: 2,
      stageId: "pr_open",
      startedAt: at(41),
    })).rejects.toThrow(/before checkpoint approve-pr/u);
    expect((await reachWorkflowCheckpoint(db, projectId, {
      runId: v2RunId,
      attempt: 1,
      revision: 2,
      checkpointKey: "approve-pr",
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
          { key: "before-pr", stage: "pr_open", position: "before" },
          { key: "after-pr", stage: "pr_open", position: "after" },
          { key: "after-production", stage: "production_qa", position: "after" },
        ],
      },
      completion: {
        requiredStages: ["implementing", "pr_open", "production_qa"],
      },
    });
    await db
      .prepare(`update briar_project_settings set workflow_json = ? where project_id = ?`)
      .bind(JSON.stringify(workflow), projectId)
      .run();
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
      checkpoint: { key: "before-pr", position: "before" },
    });
    const resumedBefore = await resumeWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "before-pr",
      requestId: "55555555-5555-4555-8555-555555555555",
      actor: "pm",
      approvedAt: at(54),
    });
    expect(resumedBefore).toMatchObject({
      outcome: "approved",
      nextStage: "pr_open",
      terminalReviewOnly: false,
    });

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
      checkpoint: { key: "after-pr", position: "after" },
    });
    expect(await resumeWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "after-pr",
      requestId: "66666666-6666-4666-8666-666666666666",
      actor: "pm",
      approvedAt: at(57),
    })).toMatchObject({
      nextStage: "production_qa",
      terminalReviewOnly: false,
    });

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
      checkpoint: { key: "after-production", position: "after" },
    });
    const terminalResume = await resumeWorkflowCheckpoint(db, projectId, {
      ...identity,
      checkpointKey: "after-production",
      requestId: "77777777-7777-4777-8777-777777777777",
      actor: "pm",
      approvedAt: at(60),
    });
    expect(terminalResume).toMatchObject({
      outcome: "approved",
      nextStage: null,
      terminalReviewOnly: true,
    });
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
    await db
      .prepare(`update briar_project_settings set workflow_json = ? where project_id = ?`)
      .bind(JSON.stringify(workflow), projectId)
      .run();
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
          { key: "after-implementation", stage: "implementing", position: "after" },
        ],
      },
      completion: { requiredStages: ["implementing", "pr_open"] },
    });
    await db
      .prepare(`update briar_project_settings set workflow_json = ? where project_id = ?`)
      .bind(JSON.stringify(workflow), projectId)
      .run();
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
      checkpoint: { key: "after-implementation", position: "after" },
    });
  });

  it("does not let status events bypass lifecycle state", async () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 2,
      requirements: [],
      stages: [
        { id: "implementing", label: "Implement", required: true, evidence: [] },
      ],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["implementing"] },
    });
    await db
      .prepare(`update briar_project_settings set workflow_json = ? where project_id = ?`)
      .bind(JSON.stringify(workflow), projectId)
      .run();
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
    )).rejects.toThrow(/must be started through the workflow lifecycle/u);
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
});
