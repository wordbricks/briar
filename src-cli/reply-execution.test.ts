import { describe, expect, it } from "vitest";
import type { Config, ProjectConfig } from "./config-contract";
import type { DetachedProviderTurnResult } from "./detached-provider-turn";
import { runClaimedProjectAgentTask } from "./reply-execution";
import { decodeClaimedProjectAgentTask } from "./worker-claim-contract";
import type { GitRunner } from "./worktree";

const projectId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const deviceId = "33333333-3333-4333-8333-333333333333";
const workId = "44444444-4444-4444-8444-444444444444";
const runId = "55555555-5555-4555-8555-555555555555";

const config: Config = {
  apiUrl: "https://api.example.com",
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
  },
  projects: [],
};

const project: ProjectConfig = {
  id: projectId,
  repositoryPath: "/projects/connected-checkout",
  agentToken: "agent-token",
  autoHunt: {
    worktrees: {
      enabled: false,
      root: "/worktrees",
      branchPrefix: "briar",
    },
    sandbox: { fullAccess: false },
  },
  executionWorker: {
    deviceId,
    workerId: "worker-1",
    organizationId,
    token: "briar_worker_test",
    label: "Worker 1",
    maxConcurrentSessions: 1,
  },
};

const task = decodeClaimedProjectAgentTask({
  workType: "projectAgentTask",
  workId,
  runId,
  sourceKey: "agent-task:test",
  title: "Run release Skill",
  claimToken: "briar_agent_task_claim_test",
  claimAttempts: 1,
  claimedAt: "2026-08-22T08:00:00+00:00",
  leaseExpiresAt: "2026-08-22T08:15:00+00:00",
  request: "Run the saved release Skill",
  agent: {
    id: "agent-1",
    name: "Release Agent",
    provider: "codex",
    model: null,
    effort: null,
    responsibility: "Release the project",
  },
});

const git: GitRunner = () => ({ exitCode: 0, stdout: "", stderr: "" });

function successfulTurn(
  overrides: Partial<DetachedProviderTurnResult> = {},
): DetachedProviderTurnResult {
  return {
    exitCode: 0,
    stderr: "",
    runnerError: null,
    completed: true,
    resultText: "Release Skill completed",
    conversationId: "codex:conversation-1",
    ...overrides,
  };
}

describe("Project Agent task worktrees", () => {
  it("runs an approved Skill in the shared detached-worktree lifecycle", async () => {
    const allocated: unknown[] = [];
    const removed: unknown[] = [];
    const providerWorkspaces: string[] = [];
    const prompts: string[] = [];
    const checkpoints: unknown[] = [];
    const isolatedPath = `/worktrees/${projectId}/analysis/analysis-${workId}`;

    const result = await runClaimedProjectAgentTask(
      config,
      project,
      task,
      "worker-token",
      "worker-1",
      new AbortController().signal,
      (checkpoint) => checkpoints.push(checkpoint),
      {
        allocateWorktree: async (input) => {
          allocated.push(input);
          return {
            path: isolatedPath,
            baseRef: "origin/main",
            baseSha: "a".repeat(40),
            includedPaths: [".env.keys"],
          };
        },
        removeWorktree: async (input) => {
          removed.push(input);
        },
        runProviderTurn: async (input) => {
          providerWorkspaces.push(input.workspacePath);
          prompts.push(input.prompt);
          return successfulTurn();
        },
        git,
      },
    );

    expect(allocated).toEqual([
      expect.objectContaining({
        repositoryPath: project.repositoryPath,
        projectId,
        workId,
        settings: expect.objectContaining({ root: "/worktrees" }),
      }),
    ]);
    expect(providerWorkspaces).toEqual([isolatedPath]);
    expect(providerWorkspaces).not.toContain(project.repositoryPath);
    expect(prompts[0]).toContain("prepared isolated project worktree");
    expect(checkpoints).toContainEqual({ workspacePath: isolatedPath });
    expect(removed).toEqual([
      expect.objectContaining({
        repositoryPath: project.repositoryPath,
        path: isolatedPath,
      }),
    ]);
    expect(result).toMatchObject({
      projectId,
      workerId: "worker-1",
      summary: "Release Skill completed",
      conversationId: "codex:conversation-1",
    });
  });

  it("removes the detached worktree when the provider fails", async () => {
    const removed: string[] = [];
    const isolatedPath = `/worktrees/${projectId}/analysis/analysis-${workId}`;

    await expect(
      runClaimedProjectAgentTask(
        config,
        project,
        task,
        "worker-token",
        "worker-1",
        new AbortController().signal,
        undefined,
        {
          allocateWorktree: async () => ({
            path: isolatedPath,
            baseRef: "origin/main",
            baseSha: "a".repeat(40),
            includedPaths: [],
          }),
          removeWorktree: async (input) => {
            removed.push(input.path);
          },
          runProviderTurn: async () => {
            throw new Error("provider failed");
          },
          git,
        },
      ),
    ).rejects.toThrow("provider failed");

    expect(removed).toEqual([isolatedPath]);
  });

  it("does not run the provider or fall back when worktree allocation fails", async () => {
    let providerRan = false;
    let cleanupRan = false;

    await expect(
      runClaimedProjectAgentTask(
        config,
        project,
        task,
        "worker-token",
        "worker-1",
        new AbortController().signal,
        undefined,
        {
          allocateWorktree: async () => {
            throw new Error("worktree allocation failed");
          },
          removeWorktree: async () => {
            cleanupRan = true;
          },
          runProviderTurn: async () => {
            providerRan = true;
            return successfulTurn();
          },
          git,
        },
      ),
    ).rejects.toThrow("worktree allocation failed");

    expect(providerRan).toBe(false);
    expect(cleanupRan).toBe(false);
  });
});
