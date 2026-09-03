import { describe, expect, it } from "vitest";

import {
  type SignoffGitRunner,
  verifySignoffReady,
  verifySignoffTargetUnchanged,
} from "./verify-signoff-ready";

type GitState = {
  baseSha: string;
  dirty: boolean;
  head: string;
  pushBranch: string;
  pushedHead: string;
};

const headSha = "a".repeat(40);

function gitState() {
  const state = {
    baseSha: "b".repeat(40),
    dirty: false,
    head: headSha,
    pushBranch: "ci-optimization",
    pushedHead: headSha,
  } satisfies GitState;
  const runner: SignoffGitRunner = (args) => {
    const command = args.join(" ");
    if (command === "status --porcelain") return state.dirty ? " M dirty.ts" : "";
    if (command === "rev-parse --abbrev-ref @{push}") {
      return `origin/${state.pushBranch}`;
    }
    if (command === "rev-parse HEAD") return state.head;
    if (command.startsWith("ls-remote --exit-code origin ")) {
      return [
        `${state.baseSha}\trefs/heads/main`,
        `${state.pushedHead}\trefs/heads/${state.pushBranch}`,
      ].join("\n");
    }
    throw new Error(`Unexpected Git command: ${command}`);
  };
  return { runner, state };
}

describe("signoff preflight", () => {
  it("accepts only a clean commit at its exact remote push branch", () => {
    const { runner, state } = gitState();
    expect(verifySignoffReady("/repository", runner)).toEqual({
      baseSha: state.baseSha,
      head: headSha,
      pushBranch: state.pushBranch,
      upstream: `origin/${state.pushBranch}`,
    });

    state.pushedHead = "c".repeat(40);
    expect(() => verifySignoffReady("/repository", runner)).toThrow(
      "push the exact commit",
    );

    state.pushedHead = headSha;
    state.dirty = true;
    expect(() => verifySignoffReady("/repository", runner)).toThrow(
      "uncommitted changes",
    );
  });

  it("cancels a running signoff when origin/main moves", () => {
    const { runner, state } = gitState();
    const target = verifySignoffReady("/repository", runner);
    state.baseSha = "d".repeat(40);

    expect(() => verifySignoffTargetUnchanged(target, "/repository", runner))
      .toThrow("origin/main moved");
  });
});
