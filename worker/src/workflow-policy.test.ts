import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeAutoHuntWorkflow } from "../../src/lib/auto-hunt-contract";
import {
  createOrganization,
  createProject,
  recordHuntEvent,
  updateProjectMandatoryCheckpoints,
  updateUserWorkflowCheckpointDefaults,
  type HuntEventInput,
} from "./db";
import {
  assertStoredCheckpointPoliciesCompatible,
  loadWorkflowCheckpointPolicy,
} from "./workflow-policy";

const executeMigration = async (db: D1Database, sql: string) => {
  let statement: string[] = [];
  let inTrigger = false;
  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed && statement.length === 0) continue;
    statement.push(line);
    if (/^create trigger\b/iu.test(trimmed)) inTrigger = true;
    const complete = inTrigger ? /^end;$/iu.test(trimmed) : trimmed.endsWith(";");
    if (!complete) continue;
    await db.prepare(statement.join("\n")).run();
    statement = [];
    inTrigger = false;
  }
};

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
    const migrations = (await readdir(resolve("migrations")))
      .filter((name) => /^\d+_.*\.sql$/u.test(name))
      .sort();
    for (const migration of migrations) {
      await executeMigration(db, await readFile(resolve("migrations", migration), "utf8"));
    }
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

  it("uses revision CAS and freezes the effective policy into each new run", async () => {
    const mandatory = [
      { key: "project-before-pr", stage: "pr_open", position: "before" as const },
    ];
    const defaults = [
      { key: "user-after-implement", stage: "implementing", position: "after" as const },
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
      "user-after-implement",
      "project-before-pr",
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
    ).toEqual(["user-after-implement", "project-before-pr"]);
    expect(
      JSON.parse(byId.get(serviceRunId)!).execution.checkpoints.map(
        (checkpoint: { key: string }) => checkpoint.key,
      ),
    ).toEqual(["project-before-pr"]);

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
});
