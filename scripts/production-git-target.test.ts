import { describe, expect, it, vi } from "vitest";

import {
  type GitCommandRunner,
  verifyProductionGitTarget,
} from "./production-git-target";

const headSha = "a".repeat(40);

function gitRunner(mainSha: string) {
  return vi.fn<GitCommandRunner>(async (args) => {
    const command = args.join(" ");
    if (command === "status --porcelain --untracked-files=all") {
      return { exitCode: 0, stdout: "" };
    }
    if (command.startsWith("fetch ")) return { exitCode: 0, stdout: "" };
    if (command === "rev-parse HEAD") return { exitCode: 0, stdout: headSha };
    if (command === "rev-parse refs/remotes/origin/main") {
      return { exitCode: 0, stdout: mainSha };
    }
    return { exitCode: 1, stdout: "" };
  });
}

describe("Production Git target", () => {
  it("accepts only the exact freshly fetched origin/main commit", async () => {
    await expect(
      verifyProductionGitTarget("/test/repository", gitRunner(headSha)),
    ).resolves.toBe(headSha);
    await expect(
      verifyProductionGitTarget("/test/repository", gitRunner("b".repeat(40))),
    ).rejects.toThrow("exact origin/main commit");
  });
});
