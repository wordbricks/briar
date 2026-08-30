import { describe, expect, it, vi } from "vitest";
import { repositoryWorkflowBootstrap } from "../src/lib/auto-hunt-contract";
import { decodeConfig, type Config } from "./config-contract";
import { HttpRequestError } from "./http-request-error";
import {
  projectDoctor,
  type ProjectDoctorDependencies,
} from "./project-commands";
import type { RemoteProjectSettings } from "./project-settings-sync";

const projectId = "11111111-1111-4111-8111-111111111111";
const apiUrl = "https://briar.example";

const readySettings = {
  velenOrg: null,
  dataSource: null,
  linear: { enabled: false, source: null, teamKey: null },
  githubRepository: "wordbricks/briar",
  workflow: {
    version: 2,
    requirements: [{
      id: "bun",
      label: "Bun",
      kind: "executable",
      tool: "bun",
      reason: "Repository scripts use Bun",
    }],
    stages: [{
      id: "implementation",
      label: "Implementation",
      required: true,
    }],
    execution: { checkpoints: [] },
    completion: { requiredStages: ["implementation"] },
  },
} satisfies RemoteProjectSettings;

const pendingSettings = {
  ...readySettings,
  workflow: repositoryWorkflowBootstrap,
} satisfies RemoteProjectSettings;

const localConfig = () => decodeConfig({
  apiUrl,
  userToken: "user-session",
  projects: [{
    id: projectId,
    repositoryPath: "/home/briar/briar",
    llm: { provider: "codex" },
    executionWorker: {
      deviceId: "managed-22222222-2222-4222-8222-222222222222",
      workerId: "worker-1",
      organizationId: "33333333-3333-4333-8333-333333333333",
      label: "Managed computer",
      maxConcurrentSessions: 1,
    },
  }],
});

const dependencies = (
  config: Config,
  overrides: Partial<ProjectDoctorDependencies> = {},
) => {
  const writeOutput = vi.fn();
  const persistConfig = vi.fn(async (_nextConfig: Config) => {});
  return {
    writeOutput,
    persistConfig,
    values: {
      loadConfiguration: async () => config,
      selectProject: async () => config.projects[0]!,
      environmentToken: () => undefined,
      fetchProjectSettings: async () => readySettings,
      persistConfig,
      inspectVelen: () => null,
      resolveProjectBaseRef: () => "origin/main",
      writeOutput,
      ...overrides,
    } satisfies Partial<ProjectDoctorDependencies>,
  };
};

describe("project doctor repository workflow sync", () => {
  it("refreshes and persists an authoritative server workflow with requirements", async () => {
    const config = localConfig();
    const deps = dependencies(config);

    await projectDoctor(deps.values);

    const result = JSON.parse(deps.writeOutput.mock.calls[0]![0]);
    expect(result).toMatchObject({
      ok: true,
      githubRepository: "wordbricks/briar",
      workflow: { requirements: [{ id: "bun", tool: "bun" }] },
      workflowSync: {
        status: "refreshed",
        source: "server",
        persisted: true,
        serverWorkflowState: "ready",
      },
    });
    expect(deps.persistConfig).toHaveBeenCalledOnce();
    expect(deps.persistConfig.mock.calls[0]![0].projects[0]).toMatchObject({
      repositoryPath: "/home/briar/briar",
      llm: { provider: "codex" },
      executionWorker: { workerId: "worker-1" },
      autoHunt: { githubRepository: "wordbricks/briar" },
    });
  });

  it("reports server workflow generation as pending without inventing a workflow", async () => {
    const config = localConfig();
    const deps = dependencies(config, {
      fetchProjectSettings: async () => pendingSettings,
    });

    await expect(projectDoctor(deps.values)).rejects.toThrow(
      "server_generation_pending",
    );

    expect(JSON.parse(deps.writeOutput.mock.calls[0]![0])).toMatchObject({
      ok: false,
      workflow: null,
      workflowSync: {
        status: "server_generation_pending",
        persisted: true,
        serverWorkflowState: "generation_pending",
      },
    });
    expect(deps.persistConfig).toHaveBeenCalledOnce();
  });

  it("distinguishes an expired session from an API failure", async () => {
    const config = localConfig();
    const expired = dependencies(config, {
      fetchProjectSettings: async () => {
        throw new HttpRequestError("Unauthorized", 401, null);
      },
    });
    await expect(projectDoctor(expired.values)).rejects.toThrow(
      "session_unavailable",
    );

    expect(JSON.parse(expired.writeOutput.mock.calls[0]![0])).toMatchObject({
      ok: false,
      workflowSync: { status: "session_unavailable" },
    });

    const unavailable = dependencies(config, {
      fetchProjectSettings: async () => {
        throw new HttpRequestError("Unavailable", 503, null);
      },
    });
    await expect(projectDoctor(unavailable.values)).rejects.toThrow(
      "api_unavailable",
    );

    expect(JSON.parse(unavailable.writeOutput.mock.calls[0]![0])).toMatchObject({
      ok: false,
      workflowSync: { status: "api_unavailable" },
    });
  });

  it("distinguishes network unavailability", async () => {
    const config = localConfig();
    const deps = dependencies(config, {
      fetchProjectSettings: async () => {
        throw new TypeError("fetch failed");
      },
    });

    await expect(projectDoctor(deps.values)).rejects.toThrow(
      "network_unavailable",
    );

    expect(JSON.parse(deps.writeOutput.mock.calls[0]![0])).toMatchObject({
      ok: false,
      workflowSync: { status: "network_unavailable" },
    });
  });

  it("reports remote settings when local persistence fails", async () => {
    const config = localConfig();
    const deps = dependencies(config, {
      persistConfig: async () => {
        throw new Error("read-only config");
      },
    });

    await expect(projectDoctor(deps.values)).rejects.toThrow(
      "local_persistence_failed",
    );

    expect(JSON.parse(deps.writeOutput.mock.calls[0]![0])).toMatchObject({
      ok: false,
      githubRepository: "wordbricks/briar",
      workflow: { requirements: [{ id: "bun" }] },
      workflowSync: {
        status: "local_persistence_failed",
        persisted: false,
        serverWorkflowState: "ready",
      },
    });
  });
});
