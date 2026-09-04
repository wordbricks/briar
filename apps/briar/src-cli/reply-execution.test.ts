import { describe, expect, it } from "vitest";
import {
  createDetachedTranscriptSequencer,
  detachedProjectAgentPrompt,
} from "./agent-runner";
import type { Config, ProjectConfig } from "./config-contract";
import type { DetachedProviderTurnResult } from "./detached-provider-turn";
import { runClaimedProjectAgentTask } from "./reply-execution";
import type { ClaimedProjectAgentTask } from "./worker-queue-contract";
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
    vertex: true,
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
  agentToken: "briar_agent_test",
  apiUrl: "https://api.example.com",
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

const task: ClaimedProjectAgentTask = {
  workType: "projectAgentTask",
  workId,
  runId,
  sourceKey: "agent-task:test",
  title: "Run release Skill",
  claimToken: "briar_agent_task_claim_test",
  claimAttempts: 1,
  resumeCount: 0,
  claimedAt: "2026-08-22T08:00:00+00:00",
  leaseExpiresAt: "2026-08-22T08:15:00+00:00",
  handoffContext: null,
  request: "Run the saved release Skill",
  agent: {
    id: "agent-1",
    name: "Release Agent",
    provider: "codex",
    model: null,
  effort: null,
  computerUsePolicy: "disabled",
    responsibility: "Release the project",
    skills: [],
  },
  activeSkill: null,
};

const git: GitRunner = () => ({ exitCode: 0, stdout: "", stderr: "" });

const handoffContext = (
  conversationId: string,
): ClaimedProjectAgentTask["handoffContext"] => ({
  requestId: "66666666-6666-4666-8666-666666666666",
  workType: "projectAgentTask",
  workId,
  runId,
  conversationId,
  workspacePath: null,
  createdAt: "2026-08-22T08:10:00+00:00",
});

const continuationPreamble =
  "Briar restarted briefly to install an app update while the previous turn was still running.";

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

  it("completes the task when the runner crashed after delivering its result", async () => {
    // A runner that emitted its terminal result frame and then died while
    // shutting down already finished the work. Failing the task here made the
    // server requeue it and re-run side effects up to three times.
    const isolatedPath = `/worktrees/${projectId}/analysis/analysis-${workId}`;

    const result = await runClaimedProjectAgentTask(
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
        removeWorktree: async () => {},
        runProviderTurn: async () =>
          successfulTurn({
            exitCode: 1,
            stderr: "AbortError: The operation was aborted\n",
          }),
        git,
      },
    );

    expect(result).toMatchObject({
      projectId,
      workerId: "worker-1",
      summary: "Release Skill completed",
      conversationId: "codex:conversation-1",
    });
  });

  it("keeps the original prompt and attempt range for a first claim", async () => {
    const prompts: string[] = [];
    const sequencerArguments: Array<[number, number | undefined]> = [];
    const isolatedPath = `/worktrees/${projectId}/analysis/analysis-${workId}`;

    await runClaimedProjectAgentTask(
      config,
      project,
      { ...task, claimAttempts: 2 },
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
        removeWorktree: async () => {},
        runProviderTurn: async (input) => {
          prompts.push(input.prompt);
          expect(input.conversationId).toBeNull();
          return successfulTurn();
        },
        git,
        createTranscriptSequencer: (claimAttempt, resumeCount) => {
          sequencerArguments.push([claimAttempt, resumeCount]);
          return createDetachedTranscriptSequencer(claimAttempt, resumeCount);
        },
      },
    );

    expect(sequencerArguments).toEqual([[2, 0]]);
    const prompt = prompts[0] ?? "";
    expect(prompt).not.toContain(continuationPreamble);
    expect(prompt).toBe(
      detachedProjectAgentPrompt({
        agent: {
          ...task.agent,
          scope: { kind: "project", organizationId, projectId },
        },
        request: task.request,
        workspacePath: isolatedPath,
      }),
    );
  });

  it("resumes a planned-update handoff with a continuation prompt and its own sequence range", async () => {
    const prompts: string[] = [];
    const conversationIds: Array<string | null | undefined> = [];
    const sequencerArguments: Array<[number, number | undefined]> = [];
    const isolatedPath = `/worktrees/${projectId}/analysis/analysis-${workId}`;
    const resumed: ClaimedProjectAgentTask = {
      ...task,
      claimAttempts: 1,
      resumeCount: 2,
      handoffContext: handoffContext("codex:conversation-1"),
    };

    await runClaimedProjectAgentTask(
      config,
      project,
      resumed,
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
        removeWorktree: async () => {},
        runProviderTurn: async (input) => {
          prompts.push(input.prompt);
          conversationIds.push(input.conversationId);
          return successfulTurn();
        },
        git,
        createTranscriptSequencer: (claimAttempt, resumeCount) => {
          sequencerArguments.push([claimAttempt, resumeCount]);
          return createDetachedTranscriptSequencer(claimAttempt, resumeCount);
        },
      },
    );

    // The resumed claim keeps attempt 1, so only the resume count stops the new
    // transcript from reusing sequences the server already stored.
    expect(sequencerArguments).toEqual([[1, 2]]);
    expect(createDetachedTranscriptSequencer(1, 2).next()).toBe(2_000_001);
    expect(conversationIds).toEqual(["codex:conversation-1"]);
    const prompt = prompts[0] ?? "";
    expect(prompt.startsWith(continuationPreamble)).toBe(true);
    expect(prompt).toContain("Do not repeat side effects or completed work.");
    expect(prompt).toContain(task.request);
    expect(prompt).toContain(
      detachedProjectAgentPrompt({
        agent: {
          ...task.agent,
          scope: { kind: "project", organizationId, projectId },
        },
        request: task.request,
        workspacePath: isolatedPath,
      }),
    );
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
