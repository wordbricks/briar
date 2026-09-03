import { describe, expect, it, vi } from "vitest";
import { decodeConfig, type Config } from "./config-contract";
import {
  managedComputerSyncCommand,
  type ManagedComputerSyncDependencies,
} from "./managed-computer-commands";
import type { RemoteTeamSettings } from "./team-settings-sync";

const projectId = "11111111-1111-4111-8111-111111111111";
const apiOrigin = "https://briar.example";

const settings = {
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

describe("managed-computer sync", () => {
  it("is idempotent and never replaces local repository, provider, or worker fields", async () => {
    let storedConfig: Config = decodeConfig({
      apiUrl: apiOrigin,
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
      managedComputer: {
        managedComputerId: "22222222-2222-4222-8222-222222222222",
        deviceId: "managed-22222222-2222-4222-8222-222222222222",
        organizationId: "33333333-3333-4333-8333-333333333333",
        credentialFile: "/var/lib/briar/worker-credential.json",
      },
      projects: [{
        id: projectId,
        repositoryPath: "/home/briar/briar",
        apiUrl: apiOrigin,
        llm: {
          provider: "AGENT_PROVIDER_CODEX",
          approvalPolicy: "LOCAL_APPROVAL_POLICY_NEVER",
        },
        executionWorker: {
          deviceId: "managed-22222222-2222-4222-8222-222222222222",
          workerId: "worker-1",
          organizationId: "33333333-3333-4333-8333-333333333333",
          label: "Managed computer",
          maxConcurrentSessions: 1,
        },
      }],
    });
    const fetchTeamSettings = vi.fn(async () => settings);
    const writeOutput = vi.fn();
    const dependencies: Partial<ManagedComputerSyncDependencies> = {
      credentialPath: () => "/var/lib/briar/worker-credential.json",
      loadCredential: async () => ({
        credential: "worker-credential-must-not-be-printed",
        deviceId: "managed-22222222-2222-4222-8222-222222222222",
        organizationId: "33333333-3333-4333-8333-333333333333",
        managedComputerId: "22222222-2222-4222-8222-222222222222",
        apiOrigin,
      }),
      loadAuthentication: async () => ({
        config: storedConfig,
        userToken: "user-session-must-not-be-printed",
      }),
      resolveProjectId: async () => projectId,
      fetchTeamSettings,
      persistConfig: async (config) => {
        storedConfig = config;
      },
      writeOutput,
    };

    await managedComputerSyncCommand(dependencies);
    const firstConfig = structuredClone(storedConfig);
    await managedComputerSyncCommand(dependencies);

    expect(storedConfig).toEqual(firstConfig);
    expect(fetchTeamSettings).toHaveBeenNthCalledWith(
      1,
      apiOrigin,
      projectId,
      "user-session-must-not-be-printed",
    );
    expect(storedConfig.projects[0]).toMatchObject({
      repositoryPath: "/home/briar/briar",
      llm: { provider: "codex" },
      executionWorker: { workerId: "worker-1" },
      autoHunt: {
        githubRepository: "wordbricks/briar",
        workflow: { requirements: [{ id: "bun" }] },
      },
    });
    const output = writeOutput.mock.calls.at(-1)![0];
    expect(JSON.parse(output)).toEqual({
      projectId,
      githubRepository: "wordbricks/briar",
      workflowState: "ready",
      workflowRequirementCount: 1,
      synced: true,
    });
    expect(output).not.toContain("credential");
    expect(output).not.toContain("user-session");
  });
});
