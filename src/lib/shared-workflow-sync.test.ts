import { describe, expect, it } from "vitest";
import { repositoryWorkflowBootstrap } from "./auto-hunt-contract";
import { shouldSyncSharedWorkflow } from "./shared-workflow-sync";

const workflow = {
  ...repositoryWorkflowBootstrap,
  requirements: [
    {
      id: "bun",
      label: "Bun",
      kind: "executable" as const,
      tool: "bun",
      reason: "Runs local checks.",
    },
  ],
};

describe("shouldSyncSharedWorkflow", () => {
  it("syncs when the project is connected and the workflow has not been mirrored yet", () => {
    const result = shouldSyncSharedWorkflow({
      connectedLocally: true,
      sharedWorkflow: workflow,
      lastSyncedKey: null,
      projectId: "project-1",
    });
    expect(result.sync).toBe(true);
    expect(result.key).toContain("project-1");
    expect(result.key).toContain("bun");
  });

  it("skips when the same shared workflow is already mirrored", () => {
    const first = shouldSyncSharedWorkflow({
      connectedLocally: true,
      sharedWorkflow: workflow,
      lastSyncedKey: null,
      projectId: "project-1",
    });
    const second = shouldSyncSharedWorkflow({
      connectedLocally: true,
      sharedWorkflow: workflow,
      lastSyncedKey: first.key,
      projectId: "project-1",
    });
    expect(second.sync).toBe(false);
    expect(second.key).toBe(first.key);
  });

  it("does not sync for projects that are not connected on this computer", () => {
    expect(
      shouldSyncSharedWorkflow({
        connectedLocally: false,
        sharedWorkflow: workflow,
        lastSyncedKey: null,
        projectId: "project-1",
      }),
    ).toEqual({ sync: false, key: null });
  });
});
