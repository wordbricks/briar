import { describe, expect, it } from "vitest";
import {
  AutoHuntWorkflowValidationError,
  canonicalizeCheckpointSet,
  cloneAutoHuntWorkflow,
  normalizeAutoHuntWorkflow,
  resolveCheckpointPolicy,
  workflowWithEffectiveCheckpoints,
  workflowWithAdditionalCheckpoints,
  type AutoHuntWorkflowInput,
} from "./auto-hunt-contract";

const stages = [
  { id: "implementing", label: "Implement", required: true },
  { id: "pr_open", label: "Open PR", required: true },
  { id: "production_qa", label: "Production QA", required: true },
];

const v2 = (checkpoints: unknown[]) => ({
  version: 2 as const,
  requirements: [],
  stages,
  execution: { checkpoints },
  completion: { requiredStages: stages.map((stage) => stage.id) },
}) as AutoHuntWorkflowInput;

describe("Auto Hunt workflow v2 contract", () => {
  it("clones a canonical workflow without sharing nested values", () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 2,
      requirements: [],
      stages: [
        { id: "analyzing", label: "Analyze", required: true },
        { id: "local_qa", label: "Validate", required: true },
      ],
      execution: {
        checkpoints: [{
          key: "after-local-qa",
          stage: "local_qa",
          position: "after",
        }],
      },
      completion: { requiredStages: ["analyzing", "local_qa"] },
    });

    const clone = cloneAutoHuntWorkflow(workflow);
    expect(clone).toEqual({
      version: 2,
      requirements: [],
      stages: [
        {
          id: "analyzing",
          label: "Analyze",
          required: true,
          evidence: ["repository"],
        },
        {
          id: "local_qa",
          label: "Validate",
          required: true,
          evidence: ["test"],
          checks: ["bun run test", "bun run build"],
        },
      ],
      execution: {
        checkpoints: [
          {
            key: "after-local-qa",
            stage: "local_qa",
            position: "after",
          },
        ],
      },
      completion: { requiredStages: ["analyzing", "local_qa"] },
    });
    expect(clone).not.toBe(workflow);
    expect(clone.execution.checkpoints).not.toBe(workflow.execution.checkpoints);
  });

  it("accepts zero checkpoints and writes only the canonical v2 shape", () => {
    const workflow = normalizeAutoHuntWorkflow(v2([]));

    expect(workflow.version).toBe(2);
    expect(workflow.execution.checkpoints).toEqual([]);
    expect(JSON.parse(JSON.stringify(workflow))).toEqual({
      version: 2,
      requirements: [],
      stages: [
        { ...stages[0], evidence: ["diff"] },
        { ...stages[1], evidence: ["pull_request"] },
        { ...stages[2], evidence: ["production"] },
      ],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["implementing", "pr_open", "production_qa"] },
    });
  });

  it("canonicalizes checkpoints by stage order and before/after position", () => {
    const workflow = normalizeAutoHuntWorkflow(v2([
      { key: "production-review", stage: "production_qa", position: "after" },
      { key: "pr-review", stage: "pr_open", position: "after" },
      { key: "production-approval", stage: "production_qa", position: "before" },
      { key: "pr-approval", stage: "pr_open", position: "before" },
    ]));

    expect(workflow.execution.checkpoints.map((checkpoint) => checkpoint.key)).toEqual([
      "pr-approval",
      "pr-review",
      "production-approval",
      "production-review",
    ]);
  });

  it.each([
    ["unknown stage", [{ key: "review", stage: "missing", position: "after" }]],
    ["duplicate key", [
      { key: "review", stage: "pr_open", position: "before" },
      { key: "review", stage: "production_qa", position: "after" },
    ]],
    ["duplicate boundary", [
      { key: "first", stage: "pr_open", position: "before" },
      { key: "second", stage: "pr_open", position: "before" },
    ]],
    ["invalid key", [{ key: "Review", stage: "pr_open", position: "before" }]],
    ["invalid position", [{ key: "review", stage: "pr_open", position: "during" }]],
  ])("rejects %s", (_name, checkpoints) => {
    expect(() => normalizeAutoHuntWorkflow(v2(checkpoints))).toThrow(
      AutoHuntWorkflowValidationError,
    );
  });

  it("rejects a v2 execution object without checkpoints", () => {
    expect(() => normalizeAutoHuntWorkflow({
      ...v2([]),
      execution: {},
    })).toThrow(AutoHuntWorkflowValidationError);
  });

  it("rejects workflow versions other than 2", () => {
    expect(() => normalizeAutoHuntWorkflow({
      version: 3,
      stages,
      execution: { checkpoints: [] },
      completion: { requiredStages: stages.map((stage) => stage.id) },
    } as unknown as AutoHuntWorkflowInput)).toThrow("version must be 2");
  });

  it("combines project mandatory and user defaults with project ownership winning", () => {
    const workflow = normalizeAutoHuntWorkflow(v2([]));
    const policy = resolveCheckpointPolicy(
      workflow,
      [
        { key: "project-before-pr", stage: "pr_open", position: "before" },
        { key: "project-after-production", stage: "production_qa", position: "after" },
      ],
      [
        { key: "user-before-implement", stage: "implementing", position: "before" },
        { key: "user-before-pr", stage: "pr_open", position: "before" },
      ],
    );

    expect(policy.projectMandatory.map((checkpoint) => checkpoint.key)).toEqual([
      "project-before-pr_open",
      "project-after-production_qa",
    ]);
    expect(policy.userDefaults.map((checkpoint) => checkpoint.key)).toEqual([
      "user-before-implementing",
      "user-before-pr_open",
    ]);
    expect(policy.effective).toEqual([
      { key: "user-before-implementing", stage: "implementing", position: "before" },
      { key: "project-before-pr_open", stage: "pr_open", position: "before" },
      { key: "project-after-production_qa", stage: "production_qa", position: "after" },
    ]);
  });

  it("supports mandatory-only, user-only, and fully automatic policies", () => {
    const workflow = normalizeAutoHuntWorkflow(v2([]));
    const project = [{ key: "project-pr", stage: "pr_open", position: "after" as const }];
    const user = [{ key: "user-production", stage: "production_qa", position: "before" as const }];

    expect(resolveCheckpointPolicy(workflow, project, []).effective).toEqual([
      { key: "project-after-pr_open", stage: "pr_open", position: "after" },
    ]);
    expect(resolveCheckpointPolicy(workflow, [], user).effective).toEqual([
      { key: "user-before-production_qa", stage: "production_qa", position: "before" },
    ]);
    expect(resolveCheckpointPolicy(workflow, [], []).effective).toEqual([]);
  });

  it("writes a new effective snapshot without mutating the project workflow", () => {
    const workflow = normalizeAutoHuntWorkflow(v2([
      { key: "project-after-pr_open", stage: "pr_open", position: "after" },
    ]));
    const before = JSON.stringify(workflow);
    const snapshot = workflowWithEffectiveCheckpoints(
      workflow,
      [{ key: "project-production", stage: "production_qa", position: "before" }],
      [{ key: "user-implement", stage: "implementing", position: "after" }],
    );

    expect(JSON.stringify(workflow)).toBe(before);
    expect(snapshot.execution.checkpoints.map((checkpoint) => checkpoint.key)).toEqual([
      "user-after-implementing",
      "project-before-production_qa",
    ]);
  });

  it("adds issue checkpoints without overriding inherited boundaries", () => {
    const workflow = normalizeAutoHuntWorkflow(v2([
      { key: "project-before-pr_open", stage: "pr_open", position: "before" },
    ]));
    const snapshot = workflowWithAdditionalCheckpoints(workflow, [
      { key: "issue-before-pr", stage: "pr_open", position: "before" },
      { key: "issue-after-pr", stage: "pr_open", position: "after" },
    ]);

    expect(snapshot.execution.checkpoints).toEqual([
      { key: "project-before-pr_open", stage: "pr_open", position: "before" },
      { key: "issue-after-pr_open", stage: "pr_open", position: "after" },
    ]);
    expect(workflow.execution.checkpoints).toHaveLength(1);
  });

  it("rejects unknown and duplicate policy boundaries before persistence", () => {
    const workflow = normalizeAutoHuntWorkflow(v2([]));

    expect(() => canonicalizeCheckpointSet(workflow, [
      { key: "unknown", stage: "missing", position: "after" },
    ], "project")).toThrow(AutoHuntWorkflowValidationError);
    expect(() => canonicalizeCheckpointSet(workflow, [
      { key: "first", stage: "pr_open", position: "after" },
      { key: "second", stage: "pr_open", position: "after" },
    ], "user")).toThrow(AutoHuntWorkflowValidationError);
  });
});
