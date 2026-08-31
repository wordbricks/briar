import { create, toJsonString } from "@bufbuild/protobuf";
import {
  GitHubPullRequestSchema,
  GitHubPullRequestState,
} from "@briar/contracts/gen/briar/app/v1/github_pb";
import { describe, expect, it } from "vitest";
import {
  executeClaimedMergeBatch,
  inspectMergeQueueDoctor,
  type MergeBatchRpc,
  type MergeQueueCommandRunner,
} from "./merge-queue";
import type { ClaimedMergeBatch } from "./worker-queue-contract";

const batchId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const memberId = "3".repeat(32);
const runId = "44444444-4444-4444-8444-444444444444";
const headSha = "a".repeat(40);
const historicalBaseSha = "b".repeat(40);
const liveBaseSha = "c".repeat(40);
const integrationSha = "d".repeat(40);
const treeSha = "e".repeat(40);
const baseTreeSha = "1".repeat(40);
const mergedMainSha = "2".repeat(40);
const logSha256 = "f".repeat(64);
const integrationRef = `refs/heads/briar/merge-queue/${batchId}`;
const validationResults: NonNullable<
  ClaimedMergeBatch["batch"]["validationResults"]
> = [{
  context: "merge-queue",
  passed: true,
  exitCode: 0,
  failureCode: null,
  log: "merge queue validation passed",
  logSha256,
  logTruncated: false,
}];

function claimFixture(
  phase: ClaimedMergeBatch["phase"] = "tail_authority",
  proof = validationResults,
): ClaimedMergeBatch {
  const hasAuthority = ["validate", "publish", "drain"].includes(phase);
  return {
    workType: "mergeBatch",
    workId: batchId,
    runId: batchId,
    sourceKey: "merge:wordbricks/briar#11111111",
    title: "Merge 1 PR into main",
    projectId,
    repositoryId: 701,
    repository: "wordbricks/briar",
    baseBranch: "main",
    validationCommands: ["bun run ci:local"],
    phase,
    claimToken: `briar_merge_claim_${"8".repeat(64)}`,
    claimedAt: "2026-08-21T01:00:00+00:00",
    leaseExpiresAt: "2026-08-21T01:15:00+00:00",
    claimAttempts: 1,
    handoffContext: null,
    batch: {
      id: batchId,
      state: phase === "enqueue"
        ? "enqueueing"
        : phase === "tail_authority"
          ? "waiting_tail"
          : phase === "validate"
            ? "validating"
            : phase === "publish"
              ? "publishing"
              : "draining",
      finalDeliveryId: hasAuthority ? `integration:${integrationSha}` : null,
      mergeGroupRef: hasAuthority ? integrationRef : null,
      mergeGroupSha: hasAuthority ? integrationSha : null,
      mergeGroupBaseSha: hasAuthority ? liveBaseSha : null,
      validationResults: phase === "publish" || phase === "drain"
        ? proof
        : null,
      validatedAt: phase === "publish" || phase === "drain"
        ? "2026-08-21T01:05:00+00:00"
        : null,
      publishedAt: phase === "drain" ? "2026-08-21T01:06:00+00:00" : null,
      failureCode: phase === "drain" ? "validation_failed" : null,
      failureDetail: phase === "drain" ? "validation failed" : null,
    },
    members: [{
      id: memberId,
      ordinal: 1,
      runId,
      attempt: 1,
      revision: 1,
      pullRequestId: 501,
      pullRequestNodeId: "PR_kwDOBriar42",
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/wordbricks/briar/pull/42",
      headSha,
      baseSha: historicalBaseSha,
      queueEntryId: phase === "enqueue" ? null : `briar:${batchId}:1`,
      state: phase === "enqueue" ? "frozen" : "enqueued",
    }],
    pendingHeads: [],
  };
}

function pullRequestResponse() {
  return toJsonString(
    GitHubPullRequestSchema,
    create(GitHubPullRequestSchema, {
      repositoryId: 701n,
      repository: "wordbricks/briar",
      pullRequestId: 501n,
      pullRequestNodeId: "PR_kwDOBriar42",
      pullRequestNumber: 42n,
      url: "https://github.com/wordbricks/briar/pull/42",
      state: GitHubPullRequestState.OPEN,
      draft: false,
      merged: false,
      headSha,
      baseSha: liveBaseSha,
      baseRef: "main",
    }),
  );
}

const successful = (stdout = "{}") => ({ exitCode: 0, stdout, stderr: "" });

function recordingRpc() {
  const calls: Array<{
    method: keyof MergeBatchRpc;
    request: Record<string, unknown>;
  }> = [];
  const record = (method: keyof MergeBatchRpc) =>
    async (request: Record<string, unknown>) => {
      calls.push({ method, request });
      return {};
    };
  const client = {
    recordMergeBatchCandidateEnqueued: record(
      "recordMergeBatchCandidateEnqueued",
    ),
    recordMergeBatchAuthority: record("recordMergeBatchAuthority"),
    recordMergeBatchValidation: record("recordMergeBatchValidation"),
    completeMergeBatchPublication: record("completeMergeBatchPublication"),
    blockMergeBatch: record("blockMergeBatch"),
  } as unknown as MergeBatchRpc;
  return { rpc: client, calls };
}

function recordingLeaseLifecycle() {
  const calls: Array<"renew" | "release"> = [];
  return {
    calls,
    renewLease: async () => {
      calls.push("renew");
    },
    releaseLease: async () => {
      calls.push("release");
    },
  };
}

describe("local provider-independent merge-queue worker", () => {
  it("seals an exact PR identity without calling GitHub merge-queue mutations", async () => {
    const commands: string[][] = [];
    const run: MergeQueueCommandRunner = (command) => {
      commands.push([...command]);
      return successful(pullRequestResponse());
    };
    const rpc = recordingRpc();
    const lease = recordingLeaseLifecycle();
    await executeClaimedMergeBatch({
      claim: claimFixture("enqueue"),
      workerId: "worker-1",
      repositoryPath: "/repo",
      signal: new AbortController().signal,
      rpc: rpc.rpc,
      ...lease,
      runCommand: run,
    });
    expect(commands.join("\n")).not.toContain("enqueuePullRequest");
    expect(commands.join("\n")).not.toContain("mergeQueue");
    expect(rpc.calls[0]).toMatchObject({
      method: "recordMergeBatchCandidateEnqueued",
      request: { queueEntryId: `briar:${batchId}:1`, expectedHeadSha: headSha },
    });
  });

  it("assembles and publishes an exact bors-style integration ref", async () => {
    const commands: string[][] = [];
    const run: MergeQueueCommandRunner = (command) => {
      commands.push([...command]);
      if (command[1] === "github") return successful(pullRequestResponse());
      if (command[1] === "fetch" || command[1] === "push") return successful();
      if (command[1] === "merge-tree") return successful(treeSha);
      if (command[1] === "commit-tree") return successful(integrationSha);
      if (command[1] === "ls-remote") {
        return successful(`${liveBaseSha}\trefs/heads/main\n`);
      }
      if (command[1] === "rev-parse") {
        return successful(command.at(-1)?.includes("/1^{commit}") ? headSha : liveBaseSha);
      }
      throw new Error(`unexpected command: ${command.join(" ")}`);
    };
    const rpc = recordingRpc();
    const lease = recordingLeaseLifecycle();
    await executeClaimedMergeBatch({
      claim: claimFixture(),
      workerId: "worker-1",
      repositoryPath: "/repo",
      signal: new AbortController().signal,
      rpc: rpc.rpc,
      ...lease,
      runCommand: run,
    });
    expect(commands.some((command) => command[1] === "merge-tree")).toBe(true);
    expect(commands.some((command) =>
      command[1] === "push" && command.includes(`${integrationSha}:${integrationRef}`)
    )).toBe(true);
    expect(rpc.calls.at(-1)).toMatchObject({
      method: "recordMergeBatchAuthority",
      request: { integrationRef, integrationSha, baseSha: liveBaseSha },
    });
  });

  it("runs the snapshotted workflow commands against the exact integration SHA", async () => {
    const commands: Array<{
      command: readonly string[];
      options: Parameters<MergeQueueCommandRunner>[1];
    }> = [];
    const run: MergeQueueCommandRunner = (command, options) => {
      commands.push({ command: [...command], options });
      if (command[0] === "git" && command[1] === "rev-parse") {
        return successful(
          command.at(-1)?.includes("validation-base")
            ? liveBaseSha
            : integrationSha,
        );
      }
      if (command[0] === "git") return successful();
      if (command.at(-1) === "bun run ci:local") {
        return successful("repository checks passed\n");
      }
      throw new Error(`unexpected command: ${command.join(" ")}`);
    };
    const rpc = recordingRpc();
    const lease = recordingLeaseLifecycle();
    await executeClaimedMergeBatch({
      claim: claimFixture("validate"),
      workerId: "worker-1",
      repositoryPath: "/repo",
      signal: new AbortController().signal,
      rpc: rpc.rpc,
      ...lease,
      runCommand: run,
    });

    const validation = commands.find(({ command }) =>
      command.at(-1) === "bun run ci:local"
    );
    expect(validation?.options.cwd).toMatch(
      /briar-merge-queue-validation\..+\/workspace$/u,
    );
    expect(validation?.options.env).toMatchObject({ CI: "1" });
    expect(validation?.options.env).not.toHaveProperty("GITHUB_TOKEN");
    expect(rpc.calls.find((call) =>
      call.method === "recordMergeBatchValidation"
    ))
      .toMatchObject({
        method: "recordMergeBatchValidation",
        request: {
          mergeGroupSha: integrationSha,
          validationResults: {
            results: [{
              context: "merge-queue",
              passed: true,
              exitCode: 0,
              log: "$ bun run ci:local\nrepository checks passed\n",
            }],
          },
        },
      });
  });

  it("re-fences the validated tree and merges each original PR through GitHub", async () => {
    const commands: string[][] = [];
    let mainSha = liveBaseSha;
    const run: MergeQueueCommandRunner = (command) => {
      commands.push([...command]);
      if (
        command[1] === "github" && command[2] === "pr" &&
        command[3] === "view"
      ) {
        return successful(pullRequestResponse());
      }
      if (command[1] === "github" && command[2] === "repository") {
        return successful(JSON.stringify({
          allow_merge_commit: true,
          allow_squash_merge: true,
          allow_rebase_merge: true,
        }));
      }
      if (command[1] === "github" && command.includes("merge")) {
        mainSha = mergedMainSha;
        return successful(JSON.stringify({
          sha: mergedMainSha,
          merged: true,
          message: "Pull Request successfully merged",
        }));
      }
      if (command[1] === "github") return successful();
      if (command[1] === "fetch") return successful();
      if (command[1] === "rev-parse") {
        const ref = command.at(-1) ?? "";
        if (ref.includes("merge-group-validation/") && ref.endsWith("^{commit}")) {
          return successful(integrationSha);
        }
        if (ref.includes("publication") && ref.endsWith("^{commit}")) {
          return successful(mainSha);
        }
        if (ref.includes("publication") && ref.endsWith("^{tree}")) {
          return successful(mainSha === liveBaseSha ? baseTreeSha : treeSha);
        }
        if (ref.includes("~1^{tree}")) return successful(baseTreeSha);
        if (ref.endsWith("^{tree}")) return successful(treeSha);
      }
      throw new Error(`unexpected command: ${command.join(" ")}`);
    };
    const rpc = recordingRpc();
    const lease = recordingLeaseLifecycle();
    await executeClaimedMergeBatch({
      claim: claimFixture("publish"),
      workerId: "worker-1",
      repositoryPath: "/repo",
      signal: new AbortController().signal,
      rpc: rpc.rpc,
      ...lease,
      runCommand: run,
    });
    const statuses = commands.filter((command) =>
      command[1] === "github" && command[2] === "status"
    );
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toEqual(expect.arrayContaining([
      "--context",
      "briar/merge-queue",
    ]));
    expect(lease.calls.filter((call) => call === "renew")).toHaveLength(2);
    expect(commands.some((command) =>
      command[1] === "github" &&
      command.includes("merge") &&
      command.includes(headSha) &&
      command.includes("squash")
    )).toBe(true);
    expect(commands.some((command) =>
      command[1] === "push" && command.includes("refs/heads/main")
    )).toBe(false);
    expect(rpc.calls.at(-1)?.method).toBe("completeMergeBatchPublication");
  });

  it("publishes a failed proof without updating main", async () => {
    const failedProof = validationResults.map((result, index) =>
      index === 0
        ? { ...result, passed: false, exitCode: 1, failureCode: "ci_failed" as const }
        : result
    );
    const commands: string[][] = [];
    const run: MergeQueueCommandRunner = (command) => {
      commands.push([...command]);
      if (command[1] === "github") return successful();
      throw new Error(`failed publication must not run git: ${command.join(" ")}`);
    };
    const rpc = recordingRpc();
    const lease = recordingLeaseLifecycle();
    await executeClaimedMergeBatch({
      claim: claimFixture("publish", failedProof),
      workerId: "worker-1",
      repositoryPath: "/repo",
      signal: new AbortController().signal,
      rpc: rpc.rpc,
      ...lease,
      runCommand: run,
    });
    expect(commands.every((command) => command[1] === "github")).toBe(true);
    expect(commands.filter((command) => command[1] === "github")).toHaveLength(1);
    expect(rpc.calls.at(-1)?.method).toBe("completeMergeBatchPublication");
  });

  it("accepts a retry after signed member state and main tree match the batch", async () => {
    const initial = claimFixture("publish");
    const claim: ClaimedMergeBatch = {
      ...initial,
      claimAttempts: 2,
      members: initial.members.map((member) => ({
        ...member,
        state: "merged" as const,
      })),
    };
    const commands: string[][] = [];
    const run: MergeQueueCommandRunner = (command) => {
      commands.push([...command]);
      if (command[1] === "github") return successful();
      if (command[1] === "fetch") return successful();
      if (command[1] === "rev-parse") {
        const ref = command.at(-1) ?? "";
        if (ref.includes("merge-group-validation/") && ref.endsWith("^{commit}")) {
          return successful(integrationSha);
        }
        if (ref.includes("publication") && ref.endsWith("^{commit}")) {
          return successful(mergedMainSha);
        }
        return successful(treeSha);
      }
      throw new Error(`unexpected command: ${command.join(" ")}`);
    };
    const rpc = recordingRpc();
    const lease = recordingLeaseLifecycle();
    await executeClaimedMergeBatch({
      claim,
      workerId: "worker-1",
      repositoryPath: "/repo",
      signal: new AbortController().signal,
      rpc: rpc.rpc,
      ...lease,
      runCommand: run,
    });
    expect(commands.filter((command) => command[1] === "fetch")).toHaveLength(1);
    expect(commands.some((command) => command[1] === "push")).toBe(false);
    expect(commands.some((command) => command.includes("pulls/42/merge"))).toBe(false);
    expect(rpc.calls.at(-1)?.method).toBe("completeMergeBatchPublication");
  });

  it("checks repository identity without inspecting or requiring rulesets", () => {
    const profile = {
      projectId,
      repositoryId: 701,
      repository: "wordbricks/briar",
      baseBranch: "main" as const,
      enabled: true,
      readinessStageId: "ci_qa",
      validationCommands: ["bun run ci:local"],
      quietWindowMs: 30_000,
      maxBatchSize: 5,
      updatedAt: "2026-08-21T01:00:00Z",
    };
    const commands: string[][] = [];
    const run: MergeQueueCommandRunner = (command) => {
      commands.push([...command]);
      if (command[0] === "git") return successful("git@github.com:wordbricks/briar.git\n");
      if (command[1] === "github" && command[2] === "repository") {
        return successful(JSON.stringify({
          id: 701,
          full_name: "wordbricks/briar",
          default_branch: "main",
          allow_merge_commit: true,
          allow_squash_merge: true,
          allow_rebase_merge: true,
        }));
      }
      throw new Error(`unexpected command: ${command.join(" ")}`);
    };
    const result = inspectMergeQueueDoctor({
      profile,
      repositoryPath: "/repo",
      runCommand: run,
    });
    expect(result.ok).toBe(true);
    expect(commands.join("\n")).not.toContain("rules/branches");
    expect(commands.join("\n")).not.toContain("rulesets");
  });
});
