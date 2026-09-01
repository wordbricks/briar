import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { Config, ProjectConfig } from "./config-contract";
import {
  type IssueUpdateCommandDependencies,
  updateIssueCommand,
} from "./run-commands";

const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const cliEntry = fileURLToPath(new URL("./index.ts", import.meta.url));
const bunExecutable = spawnSync("/usr/bin/env", ["which", "bun"], {
  encoding: "utf8",
}).stdout.trim();

const config = {
  apiUrl: "https://briar.example",
  userToken: "user-token",
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
} satisfies Config;

const project = {
  id: projectId,
  repositoryPath: process.cwd(),
} as ProjectConfig;

function dependencies() {
  const updates: Array<unknown> = [];
  const writeLine = vi.fn();
  return {
    updates,
    writeLine,
    dependencies: {
      loadConfig: async () => config,
      currentProject: async () => project,
      loadRun: async () => ({
        title: "Current title",
        description: "Current description",
        priority: 3,
        difficulty: "normal" as const,
        assigneeUserId: "user-1",
      }),
      updateRun: async (_config, _project, receivedRunId, input) => {
        updates.push({ runId: receivedRunId, input });
        return {
          $typeName: "briar.app.v1.UpdateIssueResponse" as const,
          runId,
          title: input.title,
          description: input.description ?? undefined,
          priority: input.priority ?? undefined,
          difficulty: undefined,
          assigneeUserId: input.assigneeUserId ?? undefined,
          attachments: [],
        };
      },
      readFile: async () => "Description from file",
      writeLine,
    } satisfies IssueUpdateCommandDependencies,
  };
}

describe("briar issue update", () => {
  it("registers the update command and its mutation flags", () => {
    const result = spawnSync(
      bunExecutable,
      ["run", cliEntry, "issue", "update", "--help"],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("--run");
    expect(result.stdout).toContain("--description-file");
    expect(result.stdout).toContain("--clear-description");
    expect(result.stdout).toContain("--clear-assignee");
  });

  it("preserves unspecified fields and sends a complete PATCH payload", async () => {
    const state = dependencies();

    await updateIssueCommand(
      {
        runId,
        title: "  Updated title  ",
        clearDescription: true,
        clearPriority: false,
        difficulty: "hard",
        clearDifficulty: false,
        clearAssignee: false,
      },
      state.dependencies,
    );

    expect(state.updates).toEqual([{
      runId,
      input: {
      title: "Updated title",
      description: null,
      priority: 3,
      difficulty: "hard",
      assigneeUserId: "user-1",
      },
    }]);
    expect(state.writeLine).toHaveBeenCalledWith(
      expect.stringContaining(`"runId":"${runId}"`),
    );
  });

  it("rejects missing changes and conflicting clear flags before requests", async () => {
    const state = dependencies();

    await expect(
      updateIssueCommand(
        {
          runId,
          clearDescription: false,
          clearPriority: false,
          clearDifficulty: false,
          clearAssignee: false,
        },
        state.dependencies,
      ),
    ).rejects.toThrow("At least one issue change is required");
    await expect(
      updateIssueCommand(
        {
          runId,
          priority: 2,
          clearDescription: false,
          clearPriority: true,
          clearDifficulty: false,
          clearAssignee: false,
        },
        state.dependencies,
      ),
    ).rejects.toThrow("--priority cannot be combined with --clear-priority");
    expect(state.updates).toHaveLength(0);
  });
});
