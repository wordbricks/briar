import { describe, expect, it } from "vitest";
import { decodeConfig } from "./config-contract";

const projectId = "11111111-1111-4111-8111-111111111111";

describe("CLI config contract", () => {
  it("applies defaults while preserving forward-compatible config fields", () => {
    const config = decodeConfig({
      apiUrl: "https://briar.example.com",
      futureRoot: { enabled: true },
      appSettings: {
        futureSetting: "preserved",
      },
      projects: [{
        id: projectId,
        repositoryPath: "/tmp/briar",
        agentToken: "briar_agent_test",
        futureProject: 1,
        autoHunt: {
          futureAutoHunt: "preserved",
          worktrees: {
            enabled: true,
            futureWorktree: "preserved",
          },
        },
      }],
    });

    expect(config).toMatchObject({
      futureRoot: { enabled: true },
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
        browserAutomationProvider: "ego-browser",
        futureSetting: "preserved",
      },
      projects: [{
        futureProject: 1,
        autoHunt: {
          futureAutoHunt: "preserved",
          worktrees: {
            enabled: true,
            futureWorktree: "preserved",
          },
        },
      }],
    });

    config.userToken = "token";
    config.projects.push({
      id: "22222222-2222-4222-8222-222222222222",
      repositoryPath: "/tmp/second",
      agentToken: "briar_agent_second",
    });
    config.projects[0]!.autoHunt = undefined;
    expect(config.projects).toHaveLength(2);
  });

  it("keeps strict workflow and stripping boundaries distinct", () => {
    const base = {
      apiUrl: "https://briar.example.com",
      projects: [{
        id: projectId,
        repositoryPath: "/tmp/briar",
        agentToken: "briar_agent_test",
        executionWorker: {
          deviceId: "22222222-2222-4222-8222-222222222222",
          workerId: "worker-1",
          organizationId: "33333333-3333-4333-8333-333333333333",
          token: "briar_worker_test",
          label: "Worker",
          ignored: true,
        },
        autoHunt: {
          workflow: {
            version: 2,
            stages: [{
              id: "analyzing",
              label: "Analyze",
              required: true,
              ignored: true,
            }],
            execution: { checkpoints: [] },
            completion: { requiredStages: ["analyzing"] },
          },
        },
      }],
    };

    const config = decodeConfig(base);
    expect(config.projects[0]!.executionWorker).not.toHaveProperty("ignored");
    expect(config.projects[0]!.autoHunt?.workflow?.stages[0])
      .not.toHaveProperty("ignored");
    expect(config.projects[0]!.autoHunt?.workflow).toMatchObject({
      requirements: [],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["analyzing"] },
    });

    expect(() =>
      decodeConfig({
        ...base,
        projects: [{
          ...base.projects[0],
          autoHunt: {
            workflow: {
              ...base.projects[0].autoHunt.workflow,
              unexpected: true,
            },
          },
        }],
      })
    ).toThrow();

    expect(() =>
      decodeConfig({
        ...base,
        projects: [{
          ...base.projects[0],
          autoHunt: {
            workflow: {
              version: 2,
              stages: [{
                id: "analyzing",
                label: "Analyze",
                required: true,
              }],
            },
          },
        }],
      })
    ).toThrow("version 2 execution.checkpoints is required");
  });

  it("supports a managed worker without copying machine credentials into config", () => {
    const managedComputerId = "44444444-4444-4444-8444-444444444444";
    const config = decodeConfig({
      apiUrl: "https://briar.example.com",
      managedComputer: {
        managedComputerId,
        deviceId: `managed-${managedComputerId}`,
        organizationId: "55555555-5555-4555-8555-555555555555",
        credentialFile: "/var/lib/briar/worker-credential.json",
      },
      projects: [{
        id: projectId,
        repositoryPath: "/home/briar/project",
        executionWorker: {
          deviceId: `managed-${managedComputerId}`,
          workerId: "managed-worker",
          organizationId: "55555555-5555-4555-8555-555555555555",
          label: "Managed computer",
          maxConcurrentSessions: 1,
        },
      }],
    });

    expect(config.projects[0]).not.toHaveProperty("agentToken");
    expect(config.projects[0]!.executionWorker).not.toHaveProperty("token");
    expect(config.managedComputer?.credentialFile).toBe(
      "/var/lib/briar/worker-credential.json",
    );
  });
});
