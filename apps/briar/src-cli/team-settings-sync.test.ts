import { describe, expect, it } from "vitest";
import { decodeConfig } from "./config-contract";
import {
  configWithRemoteTeamSettings,
  type RemoteTeamSettings,
} from "./team-settings-sync";

const projectId = "11111111-1111-4111-8111-111111111111";

const settings = {
  velenOrg: "wordbricks",
  dataSource: "engineering",
  linear: {
    enabled: true,
    source: "linear://wordbricks",
    teamKey: "BRI",
  },
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

describe("team settings sync", () => {
  it("persists authoritative workflow settings without losing local execution settings", () => {
    const config = decodeConfig({
      apiUrl: "https://briar.example",
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
      teams: [{
        id: projectId,
        repositoryPath: "/home/briar/briar",
        apiUrl: "https://briar.example",
        repositoryRemote: "https://github.com/wordbricks/briar.git",
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
        autoHunt: {
          worktrees: { enabled: false, root: "/home/briar/worktrees" },
          sandbox: { fullAccess: false },
        },
      }],
    });

    const updated = configWithRemoteTeamSettings(
      config,
      projectId,
      settings,
    );
    const project = updated.teams[0]!;

    expect(project).toMatchObject({
      repositoryPath: "/home/briar/briar",
      repositoryRemote: "https://github.com/wordbricks/briar.git",
      llm: { provider: "codex" },
      executionWorker: {
        deviceId: "managed-22222222-2222-4222-8222-222222222222",
        workerId: "worker-1",
        organizationId: "33333333-3333-4333-8333-333333333333",
        label: "Managed computer",
        maxConcurrentSessions: 1,
      },
      autoHunt: {
        worktrees: { enabled: false, root: "/home/briar/worktrees" },
        sandbox: { fullAccess: false },
        githubRepository: "wordbricks/briar",
        workflow: {
          requirements: [{ id: "bun", tool: "bun" }],
          completion: { requiredStages: ["implementation"] },
        },
      },
    });
  });
});
