import { describe, expect, it } from "vitest";
import { decodeConfig } from "./config-contract";
import {
  configWithRemoteProjectSettings,
  type RemoteProjectSettings,
} from "./project-settings-sync";

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
} satisfies RemoteProjectSettings;

describe("project settings sync", () => {
  it("persists authoritative workflow settings without losing local execution settings", () => {
    const config = decodeConfig({
      apiUrl: "https://briar.example",
      projects: [{
        id: projectId,
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
        },
      }],
    });

    const updated = configWithRemoteProjectSettings(
      config,
      projectId,
      settings,
    );
    const project = updated.projects[0]!;

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
