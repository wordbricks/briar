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
  const calls: Array<{
    path: string;
    token: string | null;
    init?: RequestInit;
  }> = [];
  const writeLine = vi.fn();
  const request: IssueUpdateCommandDependencies["request"] = async <T>(
    _apiUrl: string,
    path: string,
    token: string | null,
    init?: RequestInit,
  ) => {
    calls.push({ path, token, init });
    if (path.endsWith("/dashboard")) {
      return {
        runs: [{
          id: runId,
          title: "Current title",
          issueDescription: "Current description",
          priority: 3,
          difficulty: "normal",
          assigneeUserId: "user-1",
        }],
      } as T;
    }
    return {
      runId,
      title: "Updated title",
      description: null,
      priority: 3,
      difficulty: "hard",
      assigneeUserId: "user-1",
      attachments: [],
    } as T;
  };
  return {
    calls,
    writeLine,
    dependencies: {
      loadConfig: async () => config,
      currentProject: async () => project,
      request,
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

    expect(state.calls).toHaveLength(2);
    expect(state.calls[0]).toMatchObject({
      path: `/projects/${projectId}/dashboard`,
      token: "user-token",
    });
    expect(state.calls[1]).toMatchObject({
      path: `/projects/${projectId}/runs/${runId}`,
      token: "user-token",
      init: { method: "PATCH" },
    });
    expect(JSON.parse(String(state.calls[1].init?.body))).toEqual({
      title: "Updated title",
      description: null,
      priority: 3,
      difficulty: "hard",
      assigneeUserId: "user-1",
    });
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
    expect(state.calls).toHaveLength(0);
  });
});
