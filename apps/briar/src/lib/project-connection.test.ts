import { describe, expect, it, vi } from "vitest";
import {
  repositoryWorkflowBootstrap,
  type AutoHuntWorkflow,
} from "./auto-hunt-contract";
import {
  preflightThenCreateProject,
  resolveProjectConnectionWorkflow,
} from "./project-connection";

const configuredWorkflow: AutoHuntWorkflow = {
  version: 2,
  requirements: [],
  stages: [{
    id: "implementing",
    label: "Implement",
    required: true,
    evidence: ["diff"],
  }],
  execution: { checkpoints: [] },
  completion: { requiredStages: ["implementing"] },
};

describe("project connection workflow authorization", () => {
  it("reuses an existing workflow for viewers without repository analysis", async () => {
    const generateWorkflow = vi.fn<() => Promise<AutoHuntWorkflow>>();

    await expect(resolveProjectConnectionWorkflow(
      "viewer",
      configuredWorkflow,
      generateWorkflow,
    )).resolves.toEqual({
      workflow: configuredWorkflow,
      shouldPersistProjectSettings: false,
    });
    expect(generateWorkflow).not.toHaveBeenCalled();
  });

  it("blocks editors while a development workflow is pending", async () => {
    const generateWorkflow = vi.fn<() => Promise<AutoHuntWorkflow>>();

    await expect(resolveProjectConnectionWorkflow(
      "editor",
      repositoryWorkflowBootstrap,
      generateWorkflow,
    )).rejects.toThrow("owner, co-owner, or developer");
    expect(generateWorkflow).not.toHaveBeenCalled();
  });

  it("persists a compatible preset without running repository analysis", async () => {
    const generateWorkflow = vi.fn<() => Promise<AutoHuntWorkflow>>();

    await expect(resolveProjectConnectionWorkflow(
      "developer",
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

describe("project creation preflight", () => {
  it("does not create a remote project when native preflight fails", async () => {
    const create = vi.fn<() => Promise<void>>();

    await expect(preflightThenCreateProject(
      () => Promise.reject(new Error("provider unavailable")),
      create,
    )).rejects.toThrow("provider unavailable");

    expect(create).not.toHaveBeenCalled();
  });

  it("creates only after preflight and skips creation for reconnects", async () => {
    const order: string[] = [];
    const create = vi.fn(async () => {
      order.push("create");
    });
    const preflight = async () => {
      order.push("preflight");
      return { repositoryPath: "/repo" };
    };

    await expect(preflightThenCreateProject(preflight, create)).resolves.toEqual({
      repositoryPath: "/repo",
    });
    expect(order).toEqual(["preflight", "create"]);

    order.length = 0;
    await preflightThenCreateProject(preflight);
    expect(order).toEqual(["preflight"]);
    expect(create).toHaveBeenCalledOnce();
  });

  it("does not create after the preflight request is cancelled", async () => {
    const create = vi.fn<() => Promise<void>>();

    await expect(preflightThenCreateProject(
      () => Promise.resolve({ repositoryPath: "/repo" }),
      create,
      () => {
        throw new Error("cancelled");
      },
    )).rejects.toThrow("cancelled");

    expect(create).not.toHaveBeenCalled();
  });
});
