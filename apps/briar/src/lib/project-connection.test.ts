import { describe, expect, it, vi } from "vitest";
import {
  repositoryWorkflowBootstrap,
  type AutoHuntWorkflow,
} from "./auto-hunt-contract";
import {
  prepareConfiguredProjectRepository,
  preflightThenCreateProject,
  resolveProjectConnectionWorkflow,
} from "./project-connection";
import type { ProjectGithubCredential } from "./api";

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

describe("configured project repository preparation", () => {
  const credential: ProjectGithubCredential = {
    project: { id: "project-1", organizationId: "organization-1" },
    repository: {
      id: 123456789,
      fullName: "wordbricks/briar",
      cloneUrl: "https://github.com/wordbricks/briar.git",
    },
    username: "x-access-token",
    password: "installation-token",
    expiresAt: "2026-08-31T12:00:00.000Z",
  };
  const prepared = {
    repositoryPath: "/managed/project-1/repository",
    repositoryId: credential.repository.id,
    repository: credential.repository.fullName,
    reused: false,
    completedSteps: ["clone"],
  };

  it("lets the server backfill a legacy repository without an immutable ID", async () => {
    const createCredential = vi.fn(async () => credential);
    const prepareRepository = vi.fn(async () => prepared);

    await expect(prepareConfiguredProjectRepository(
      {
        githubRepository: credential.repository.fullName,
        githubRepositoryId: null,
      },
      createCredential,
      prepareRepository,
    )).resolves.toEqual({ credential, prepared });

    expect(createCredential).toHaveBeenCalledOnce();
    expect(prepareRepository).toHaveBeenCalledWith(credential);
  });

  it("still blocks a project that has no selected repository", async () => {
    const createCredential = vi.fn(async () => credential);
    const prepareRepository = vi.fn(async () => prepared);

    await expect(prepareConfiguredProjectRepository(
      { githubRepository: null, githubRepositoryId: null },
      createCredential,
      prepareRepository,
    )).rejects.toThrow("프로젝트 저장소를 먼저 선택");

    expect(createCredential).not.toHaveBeenCalled();
    expect(prepareRepository).not.toHaveBeenCalled();
  });

  it("compares the prepared clone with the server credential", async () => {
    await expect(prepareConfiguredProjectRepository(
      {
        githubRepository: credential.repository.fullName,
        githubRepositoryId: null,
      },
      async () => credential,
      async () => ({ ...prepared, repositoryId: 987654321 }),
    )).rejects.toThrow("프로젝트의 GitHub 저장소와 일치하지 않습니다");
  });
});
