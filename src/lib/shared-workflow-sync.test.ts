import { describe, expect, it, vi } from "vitest";
import { repositoryWorkflowBootstrap } from "./auto-hunt-contract";
import {
  shouldSyncSharedWorkflow,
  syncSharedProjectWorkflows,
} from "./shared-workflow-sync";

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

describe("syncSharedProjectWorkflows", () => {
  it("refreshes every locally stored project from its server workflow", async () => {
    const loadSharedWorkflow = vi.fn(async () => workflow);
    const updateLocalWorkflow = vi.fn(async () => undefined);

    await expect(
      syncSharedProjectWorkflows({
        projectIds: ["project-1", "project-2"],
        lastSyncedKeys: new Map(),
        loadSharedWorkflow,
        updateLocalWorkflow,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ projectId: "project-1", status: "synced" }),
      expect.objectContaining({ projectId: "project-2", status: "synced" }),
    ]);
    expect(loadSharedWorkflow).toHaveBeenCalledTimes(2);
    expect(updateLocalWorkflow).toHaveBeenCalledTimes(2);
    expect(updateLocalWorkflow).toHaveBeenCalledWith("project-1", workflow);
    expect(updateLocalWorkflow).toHaveBeenCalledWith("project-2", workflow);
  });

  it("does not write a workflow that was already synced", async () => {
    const initial = shouldSyncSharedWorkflow({
      connectedLocally: true,
      sharedWorkflow: workflow,
      lastSyncedKey: null,
      projectId: "project-1",
    });
    const updateLocalWorkflow = vi.fn(async () => undefined);

    await expect(
      syncSharedProjectWorkflows({
        projectIds: ["project-1"],
        lastSyncedKeys: new Map([["project-1", initial.key!]]),
        loadSharedWorkflow: async () => workflow,
        updateLocalWorkflow,
      }),
    ).resolves.toEqual([
      { projectId: "project-1", status: "unchanged", key: initial.key },
    ]);
    expect(updateLocalWorkflow).not.toHaveBeenCalled();
  });

  it("continues syncing other projects when one server request fails", async () => {
    const updateLocalWorkflow = vi.fn(async () => undefined);
    const result = await syncSharedProjectWorkflows({
      projectIds: ["project-1", "project-2"],
      lastSyncedKeys: new Map(),
      loadSharedWorkflow: async (projectId) => {
        if (projectId === "project-1") throw new Error("offline");
        return workflow;
      },
      updateLocalWorkflow,
    });

    expect(result[0]).toMatchObject({ projectId: "project-1", status: "failed" });
    expect(result[1]).toMatchObject({ projectId: "project-2", status: "synced" });
    expect(updateLocalWorkflow).toHaveBeenCalledOnce();
    expect(updateLocalWorkflow).toHaveBeenCalledWith("project-2", workflow);
  });
});
