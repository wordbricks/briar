import { describe, expect, it } from "vitest";
import { lovableWorkflowPreset } from "./lovable-workflow";

describe("Lovable workflow preset", () => {
  it("builds a minimal TanStack Start workflow from compatible scripts", () => {
    const workflow = lovableWorkflowPreset({
      compatible: true,
      stack: "tanstack-start",
      packageManager: "bun",
      scripts: ["dev", "build", "test", "lint"],
      issues: [],
    });

    expect(workflow).toMatchObject({
      version: 2,
      requirements: [{ id: "bun", tool: "bun" }],
      stages: [
        { id: "analyzing" },
        { id: "implementing" },
        { id: "reviewing", evidence: ["review findings"] },
        {
          id: "local_qa",
          checks: ["bun run lint", "bun run test", "bun run build"],
        },
        {
          id: "pr_open",
          evidence: ["branch", "commit", "push", "pull_request"],
        },
        { id: "ci_qa", evidence: ["ci", "signoff"] },
        { id: "merged", evidence: ["merge_commit"] },
      ],
      execution: {
        checkpoints: [{
          key: "human_review",
          stage: "pr_open",
          position: "after",
        }],
      },
      completion: {
        requiredStages: [
          "analyzing",
          "implementing",
          "reviewing",
          "local_qa",
          "pr_open",
          "ci_qa",
          "merged",
        ],
      },
    });
  });

  it("returns no preset when compatibility requires repository analysis", () => {
    expect(lovableWorkflowPreset({
      compatible: false,
      stack: "vite-react",
      packageManager: "npm",
      scripts: ["build", "deploy"],
      issues: ["Custom deployment scripts were detected."],
    })).toBeNull();
  });
});
