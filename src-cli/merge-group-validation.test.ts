import { describe, expect, it, vi } from "vitest";
import {
  assertLiveMergeGroupRef,
  fetchExactMergeGroupHead,
  MERGE_GROUP_STATUS_CONTEXTS,
  MERGE_GROUP_VALIDATION_COMMAND,
  mergeGroupValidationEnvironment,
  publishMergeGroupStatus,
  StaleMergeGroupError,
  terminateProcessGroup,
  type CommandRunner,
} from "./merge-group-validation";

const job = {
  workId: "11111111-1111-4111-8111-111111111111",
  repository: "wordbricks/briar",
  headRef: "refs/heads/gh-readonly-queue/main/pr-1-deadbeef",
  headSha: "b".repeat(40),
  baseSha: "a".repeat(40),
};

describe("fixed merge-group executor", () => {
  it("has no configurable shell command or status contexts", () => {
    expect(MERGE_GROUP_VALIDATION_COMMAND).toEqual(["bun", "run", "ci:local"]);
    expect(MERGE_GROUP_STATUS_CONTEXTS).toEqual([
      "signoff/app-worker",
      "signoff/d1-migrations",
      "signoff/rust",
      "signoff/security",
    ]);
  });

  it("removes Briar, GitHub, and arbitrary secrets from the validation environment", () => {
    expect(mergeGroupValidationEnvironment({
      PATH: "/usr/bin",
      HOME: "/home/worker",
      BRIAR_WORKER_TOKEN: "secret",
      GH_TOKEN: "secret",
      AWS_SECRET_ACCESS_KEY: "secret",
    })).toEqual({
      CI: "true",
      GIT_TERMINAL_PROMPT: "0",
      GH_PROMPT_DISABLED: "1",
      HOME: "/home/worker",
      PATH: "/usr/bin",
    });
  });

  it("fetches the signed ref to a private ref and verifies exact head and ancestry", () => {
    const calls: string[][] = [];
    const git = (args: string[]) => {
      calls.push(args);
      if (args[0] === "rev-parse") {
        return { exitCode: 0, stdout: `${job.headSha}\n`, stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    expect(fetchExactMergeGroupHead(git, "/repo", job)).toContain(job.workId);
    expect(calls[0]).toEqual([
      "-c",
      "maintenance.auto=false",
      "fetch",
      "--no-tags",
      "origin",
      `+${job.headRef}:refs/briar/merge-group-validation/${job.workId}`,
    ]);
    expect(calls).toContainEqual([
      "merge-base",
      "--is-ancestor",
      job.baseSha,
      job.headSha,
    ]);
  });

  it("publishes only to the claimed SHA and a fixed context", () => {
    const calls: string[][] = [];
    const run: CommandRunner = (command) => {
      calls.push(command);
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    publishMergeGroupStatus(run, {
      repository: job.repository,
      headSha: job.headSha,
      context: MERGE_GROUP_STATUS_CONTEXTS[0],
      passed: true,
    });
    expect(calls[0]).toContain(
      `repos/${job.repository}/statuses/${job.headSha}`,
    );
    expect(calls[0]).toContain("context=signoff/app-worker");
  });

  it("rejects a changed queue ref before status publication", () => {
    expect(() => assertLiveMergeGroupRef(() => ({
      exitCode: 0,
      stdout: JSON.stringify({ object: { sha: "c".repeat(40) } }),
      stderr: "",
    }), job)).toThrow(StaleMergeGroupError);
  });

  it("terminates the entire POSIX process group", () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    try {
      expect(terminateProcessGroup({ pid: 4321, kill: vi.fn() } as never, "SIGTERM", "darwin"))
        .toBe(true);
      expect(kill).toHaveBeenCalledWith(-4321, "SIGTERM");
    } finally {
      kill.mockRestore();
    }
  });
});
