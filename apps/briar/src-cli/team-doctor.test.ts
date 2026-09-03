import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";
import { repositoryWorkflowBootstrap } from "../src/lib/auto-hunt-contract";
import { decodeConfig, type Config } from "./config-contract";
import {
  teamDoctor,
  type TeamDoctorDependencies,
} from "./team-commands";
import type { RemoteTeamSettings } from "./team-settings-sync";

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
} satisfies RemoteTeamSettings;

const pendingSettings = {
  ...readySettings,
  workflow: repositoryWorkflowBootstrap,
} satisfies RemoteTeamSettings;

const localConfig = () => decodeConfig({
  apiUrl,
  userToken: "user-session",
  agentProviders: {
    codex: true,
    claude: true,
    cursor: true,
    grok: true,
    agy: true,
    opencode: true,
    openrouter: true,
  },
  appSettings: {
    preventSleepWhileRunning: false,
    browserAutomationProvider:
      "LOCAL_BROWSER_AUTOMATION_PROVIDER_EGO_BROWSER",
  },
  projects: [{
    id: projectId,
    repositoryPath: "/home/briar/briar",
    apiUrl,
    llm: {
      provider: "AGENT_PROVIDER_CODEX",
      approvalPolicy: "LOCAL_APPROVAL_POLICY_NEVER",
    },
    executionWorker: {
      deviceId: "managed-22222222-2222-4222-8222-222222222222",
      workerId: "worker-1",
      organizationId: "33333333-3333-4333-8333-333333333333",
      token: "briar_worker_test",
      label: "Managed computer",
      maxConcurrentSessions: 1,
    },
  }],
});

const dependencies = (
  config: Config,
  overrides: Partial<TeamDoctorDependencies> = {},
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
      fetchTeamSettings: async () => readySettings,
      persistConfig,
      inspectVelen: () => null,
      resolveTeamBaseRef: () => "origin/main",
      writeOutput,
      ...overrides,
    } satisfies Partial<TeamDoctorDependencies>,
  };
};

describe("team doctor repository workflow sync", () => {
  it("refreshes and persists an authoritative server workflow with requirements", async () => {
    const config = localConfig();
    const deps = dependencies(config);

    await teamDoctor(deps.values);

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
      fetchTeamSettings: async () => pendingSettings,
    });

    await expect(teamDoctor(deps.values)).rejects.toThrow(
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
      fetchTeamSettings: async () => {
        throw new ConnectError("Unauthorized", Code.Unauthenticated);
      },
    });
    await expect(teamDoctor(expired.values)).rejects.toThrow(
      "session_unavailable",
    );

    expect(JSON.parse(expired.writeOutput.mock.calls[0]![0])).toMatchObject({
      ok: false,
      workflowSync: { status: "session_unavailable" },
    });

    const unavailable = dependencies(config, {
      fetchTeamSettings: async () => {
        throw new ConnectError("Unavailable", Code.Unavailable);
      },
    });
    await expect(teamDoctor(unavailable.values)).rejects.toThrow(
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
      fetchTeamSettings: async () => {
        throw new TypeError("fetch failed");
      },
    });

    await expect(teamDoctor(deps.values)).rejects.toThrow(
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

    await expect(teamDoctor(deps.values)).rejects.toThrow(
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
