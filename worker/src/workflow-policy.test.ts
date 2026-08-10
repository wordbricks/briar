import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeAutoHuntWorkflow } from "../../src/lib/auto-hunt-contract";
import {
  createOrganization,
  createProject,
  recordHuntEvent,
  updateIssueCheckpoints,
  updateProjectMandatoryCheckpoints,
  updateUserWorkflowCheckpointDefaults,
  type HuntEventInput,
} from "./db";
import {
  assertStoredCheckpointPoliciesCompatible,
  isStoredWorkflowUnchanged,
  loadWorkflowCheckpointPolicy,
} from "./workflow-policy";
import { applyD1Migrations } from "./test-helpers/d1";

const queuedEvent = (
  sourceKey: string,
  createdByUserId?: string,
): HuntEventInput => ({
  source: "issue",
  sourceKey,
  title: sourceKey,
  stage: "queued",
  eventKey: `${sourceKey}:queued`,
  occurredAt: "2026-08-04T00:00:00.000Z",
  actor: "vitest",
  repository: "example/repository",
  detail: null,
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
  createdByUserId,
});

describe("workflow checkpoint policy persistence", () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "briar-workflow-policy-test" },
  });
  let db: D1Database;
  let projectId: string;

  beforeAll(async () => {
    db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
    await applyD1Migrations(db);
    await db
      .prepare(
        `insert into user (id, name, email, emailVerified, createdAt, updatedAt)
         values (?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        "policy-user",
        "Policy User",
        "policy@example.com",
        "2026-08-04T00:00:00.000Z",
        "2026-08-04T00:00:00.000Z",
      )
      .run();
    const organization = await createOrganization(db, {
      name: "Policy Org",
      handle: "policy-org",
      ownerUserId: "policy-user",
    });
    const project = await createProject(db, {
      ownerUserId: "policy-user",
      organizationId: organization.id,
      name: "Policy Project",
      agentTokenHash: "d".repeat(64),
    });
    projectId = project.id;
    const workflow = normalizeAutoHuntWorkflow({
      version: 2,
      requirements: [],
      stages: [
        { id: "implementing", label: "Implement", required: true },
        { id: "pr_open", label: "Open PR", required: true },
        { id: "production_qa", label: "Production QA", required: true },
      ],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["implementing", "pr_open", "production_qa"] },
    });
    await db
      .prepare(`update briar_project_settings set workflow_json = ? where project_id = ?`)
      .bind(JSON.stringify(workflow), projectId)
      .run();
  }, 30_000);

  afterAll(async () => miniflare.dispose());

  it("treats a normalized workflow resubmission as unchanged", () => {
    const workflow = {
      version: 2,
      requirements: [],
      stages: [
        { id: "implementing", label: "Implement", required: true },
      ],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["implementing"] },
    };

    expect(isStoredWorkflowUnchanged(JSON.stringify(workflow), workflow)).toBe(
      true,
    );
    expect(
      isStoredWorkflowUnchanged(JSON.stringify(workflow), {
        ...workflow,
        stages: [
          ...workflow.stages,
          { id: "local_qa", label: "Local QA", required: true },
        ],
        completion: { requiredStages: ["implementing", "local_qa"] },
      }),
    ).toBe(false);
  });

  it("uses revision CAS and freezes the effective policy into each new run", async () => {
    const mandatory = [
      { key: "project-before-pr_open", stage: "pr_open", position: "before" as const },
    ];
    const defaults = [
      { key: "user-after-implementing", stage: "implementing", position: "after" as const },
    ];
    const initial = await db
      .prepare(
        `select checkpoint_policy_revision as revision
         from briar_project_settings where project_id = ?`,
      )
      .bind(projectId)
      .first<{ revision: number }>();
    expect(initial?.revision).toBe(1);
    expect(await updateProjectMandatoryCheckpoints(db, projectId, mandatory, 1)).toBe(true);
    expect(await updateProjectMandatoryCheckpoints(db, projectId, [], 1)).toBe(false);
    expect(
      await updateUserWorkflowCheckpointDefaults(
        db,
        projectId,
        "policy-user",
        defaults,
        0,
      ),
    ).toBe(true);
    expect(
      await updateUserWorkflowCheckpointDefaults(
        db,
        projectId,
        "policy-user",
        [],
        0,
      ),
    ).toBe(false);

    const policy = await loadWorkflowCheckpointPolicy(db, projectId, "policy-user");
    expect(policy.effective.map((checkpoint) => checkpoint.key)).toEqual([
      "user-after-implementing",
      "project-before-pr_open",
    ]);

    const userRunId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("user-policy-run", "policy-user"),
    );
    const serviceRunId = await recordHuntEvent(
      db,
      projectId,
      queuedEvent("mandatory-only-run"),
    );
    const snapshots = await db
      .prepare(
        `select id, workflow_snapshot_json from briar_hunt_runs
         where id in (?, ?) order by id`,
      )
      .bind(userRunId, serviceRunId)
      .all<{ id: string; workflow_snapshot_json: string }>();
    const byId = new Map(snapshots.results.map((row) => [row.id, row.workflow_snapshot_json]));
    const userSnapshotBefore = byId.get(userRunId)!;
    expect(
      JSON.parse(userSnapshotBefore).execution.checkpoints.map(
        (checkpoint: { key: string }) => checkpoint.key,
      ),
    ).toEqual(["user-after-implementing", "project-before-pr_open"]);
    expect(
      JSON.parse(byId.get(serviceRunId)!).execution.checkpoints.map(
        (checkpoint: { key: string }) => checkpoint.key,
      ),
    ).toEqual(["project-before-pr_open"]);

    await expect(assertStoredCheckpointPoliciesCompatible(db, projectId, {
      version: 2,
      requirements: [],
      stages: [
        { id: "pr_open", label: "Open PR", required: true },
        { id: "production_qa", label: "Production QA", required: true },
      ],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["pr_open", "production_qa"] },
    })).rejects.toThrow("unknown stage 'implementing'");

    expect(await updateProjectMandatoryCheckpoints(db, projectId, [], 2)).toBe(true);
    expect(
      await updateUserWorkflowCheckpointDefaults(
        db,
        projectId,
        "policy-user",
        [],
        1,
      ),
    ).toBe(true);
    const stored = await db
      .prepare(`select workflow_snapshot_json from briar_hunt_runs where id = ?`)
      .bind(userRunId)
      .first<{ workflow_snapshot_json: string }>();
    expect(stored?.workflow_snapshot_json).toBe(userSnapshotBefore);
  });

  it("freezes and updates additive checkpoints for an unstarted issue", async () => {
    const event = queuedEvent("issue-checkpoint-run", "policy-user");
    event.issueCheckpoints = [{
      key: "issue-after-pr_open",
      stage: "pr_open",
      position: "after",
    }];
    const runId = await recordHuntEvent(db, projectId, event);
    const created = await db
      .prepare(
        `select workflow_snapshot_json, issue_checkpoints_json
         from briar_hunt_runs where id = ?`,
      )
      .bind(runId)
      .first<{
        workflow_snapshot_json: string;
        issue_checkpoints_json: string;
      }>();
    expect(JSON.parse(created!.issue_checkpoints_json)).toEqual(
      event.issueCheckpoints,
    );
    expect(
      JSON.parse(created!.workflow_snapshot_json).execution.checkpoints,
    ).toContainEqual(event.issueCheckpoints[0]);

    const replacement = [{
      key: "issue-before-production_qa",
      stage: "production_qa",
      position: "before" as const,
    }];
    await expect(
      updateIssueCheckpoints(
        db,
        projectId,
        runId,
        replacement,
        "2026-08-04T01:00:00.000Z",
      ),
    ).resolves.toBe("updated");
    const updated = await db
      .prepare(
        `select workflow_snapshot_json, issue_checkpoints_json
         from briar_hunt_runs where id = ?`,
      )
      .bind(runId)
      .first<{
        workflow_snapshot_json: string;
        issue_checkpoints_json: string;
      }>();
    const updatedWorkflow = JSON.parse(updated!.workflow_snapshot_json);
    expect(JSON.parse(updated!.issue_checkpoints_json)).toEqual(replacement);
    expect(updatedWorkflow.execution.checkpoints).toContainEqual(replacement[0]);
    expect(updatedWorkflow.execution.checkpoints).not.toContainEqual(
      event.issueCheckpoints[0],
    );

    await db
      .prepare(`update briar_hunt_runs set status = 'running' where id = ?`)
      .bind(runId)
      .run();
    await expect(
      updateIssueCheckpoints(
        db,
        projectId,
        runId,
        [],
        "2026-08-04T02:00:00.000Z",
      ),
    ).resolves.toBe("ineligible");
  });

  it("removes every effective checkpoint for Full Auto issues", async () => {
    const event = queuedEvent("full-auto-run", "policy-user");
    event.fullAuto = true;
    event.issueCheckpoints = [{
      key: "issue-after-pr_open",
      stage: "pr_open",
      position: "after",
    }];
    event.context = { origin: "briar-app", fullAuto: true };

    const runId = await recordHuntEvent(db, projectId, event);
    const created = await db
      .prepare(
        `select workflow_snapshot_json, issue_checkpoints_json
         from briar_hunt_runs where id = ?`,
      )
      .bind(runId)
      .first<{
        workflow_snapshot_json: string;
        issue_checkpoints_json: string;
      }>();

    expect(JSON.parse(created!.workflow_snapshot_json).execution.checkpoints)
      .toEqual([]);
    expect(JSON.parse(created!.issue_checkpoints_json)).toEqual([]);
    await expect(
      updateIssueCheckpoints(
        db,
        projectId,
        runId,
        event.issueCheckpoints,
        "2026-08-04T01:00:00.000Z",
      ),
    ).resolves.toBe("ineligible");
  });
});
