import { describe, expect, it, vi } from "vitest";
import {
  repositoryWorkflowBootstrap,
  type AutoHuntWorkflow,
} from "./auto-hunt-contract";
import { resolveProjectConnectionWorkflow } from "./project-connection";

const configuredWorkflow: AutoHuntWorkflow = {
  version: 2,
  requirements: [],
  stages: [{
    id: "implementing",
    label: "Implement",
    required: true,
  }],
  execution: { checkpoints: [] },
  completion: { requiredStages: ["implementing"] },
};

describe("project connection workflow authorization", () => {
  it("reuses an existing workflow for members without repository analysis", async () => {
    const generateWorkflow = vi.fn<() => Promise<AutoHuntWorkflow>>();

    await expect(resolveProjectConnectionWorkflow(
      "member",
      configuredWorkflow,
      generateWorkflow,
    )).resolves.toEqual({
      workflow: configuredWorkflow,
      shouldPersistProjectSettings: false,
    });
    expect(generateWorkflow).not.toHaveBeenCalled();
  });

  it("blocks members while an administrator-owned workflow is pending", async () => {
    const generateWorkflow = vi.fn<() => Promise<AutoHuntWorkflow>>();

    await expect(resolveProjectConnectionWorkflow(
      "member",
      repositoryWorkflowBootstrap,
      generateWorkflow,
    )).rejects.toThrow("owner or admin");
    expect(generateWorkflow).not.toHaveBeenCalled();
  });

  it("persists a compatible preset without running repository analysis", async () => {
    const generateWorkflow = vi.fn<() => Promise<AutoHuntWorkflow>>();

    await expect(resolveProjectConnectionWorkflow(
      "admin",
      repositoryWorkflowBootstrap,
      generateWorkflow,
      configuredWorkflow,
    )).resolves.toEqual({
      workflow: configuredWorkflow,
      shouldPersistProjectSettings: true,
    });
    expect(generateWorkflow).not.toHaveBeenCalled();
  });
});
