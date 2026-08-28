import { describe, expect, it } from "vitest";
import {
  executeClaimedMergeBatch,
  inspectMergeQueueDoctor,
  type MergeBatchApi,
  type MergeQueueCommandRunner,
} from "./merge-queue";
import {
  decodeClaimedMergeBatch,
  type ClaimedMergeBatch,
} from "./worker-claim-contract";

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
) {
  const hasAuthority = ["validate", "publish", "drain"].includes(phase);
  return decodeClaimedMergeBatch({
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
  });
}

function pullRequestResponse() {
  return JSON.stringify({
    data: {
      repository: {
        databaseId: 701,
        nameWithOwner: "wordbricks/briar",
        pullRequest: {
          id: "PR_kwDOBriar42",
          databaseId: 501,
          number: 42,
          state: "OPEN",
          isDraft: false,
          headRefOid: headSha,
          baseRefName: "main",
          baseRefOid: liveBaseSha,
        },
      },
    },
  });
}

const successful = (stdout = "{}") => ({ exitCode: 0, stdout, stderr: "" });

function recordingApi() {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const api: MergeBatchApi = async <T>(path: string, init: {
    method: "POST";
    body: string;
  }) => {
    calls.push({ path, body: JSON.parse(init.body) as Record<string, unknown> });
    return {} as T;
  };
  return { api, calls };
}

describe("local provider-independent merge-queue worker", () => {
  it("seals an exact PR identity without calling GitHub merge-queue mutations", async () => {
    const commands: string[][] = [];
    const run: MergeQueueCommandRunner = (command) => {
      commands.push([...command]);
      return successful(pullRequestResponse());
    };
    const api = recordingApi();
    await executeClaimedMergeBatch({
      claim: claimFixture("enqueue"),
      workerId: "worker-1",
      repositoryPath: "/repo",
      signal: new AbortController().signal,
      api: api.api,
      runCommand: run,
    });
    expect(commands.join("\n")).not.toContain("enqueuePullRequest");
    expect(commands.join("\n")).not.toContain("mergeQueue");
    expect(api.calls[0]).toMatchObject({
      path: `/merge-batch-claims/${batchId}/enqueued`,
      body: { queueEntryId: `briar:${batchId}:1`, expectedHeadSha: headSha },
    });
  });

  it("assembles and publishes an exact bors-style integration ref", async () => {
    const commands: string[][] = [];
    const run: MergeQueueCommandRunner = (command) => {
      commands.push([...command]);
      if (command[0] === "gh") return successful(pullRequestResponse());
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
    const api = recordingApi();
    await executeClaimedMergeBatch({
      claim: claimFixture(),
      workerId: "worker-1",
      repositoryPath: "/repo",
      signal: new AbortController().signal,
      api: api.api,
      runCommand: run,
    });
    expect(commands.some((command) => command[1] === "merge-tree")).toBe(true);
    expect(commands.some((command) =>
      command[1] === "push" && command.includes(`${integrationSha}:${integrationRef}`)
    )).toBe(true);
    expect(api.calls.at(-2)).toMatchObject({
      path: `/merge-batch-claims/${batchId}/authority`,
      body: { integrationRef, integrationSha, baseSha: liveBaseSha },
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
    const api = recordingApi();
    await executeClaimedMergeBatch({
      claim: claimFixture("validate"),
      workerId: "worker-1",
      repositoryPath: "/repo",
      signal: new AbortController().signal,
      api: api.api,
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
    expect(api.calls.find((call) => call.path.endsWith("/validation")))
      .toMatchObject({
        path: `/merge-batch-claims/${batchId}/validation`,
        body: {
          mergeGroupSha: integrationSha,
          validationResults: [{
            context: "merge-queue",
            passed: true,
            exitCode: 0,
            log: "$ bun run ci:local\nrepository checks passed\n",
          }],
        },
      });
  });

  it("re-fences the validated tree and merges each original PR through GitHub", async () => {
    const commands: string[][] = [];
    let mainSha = liveBaseSha;
    const run: MergeQueueCommandRunner = (command) => {
      commands.push([...command]);
      if (command[0] === "gh" && command.includes("graphql")) {
        return successful(pullRequestResponse());
      }
      if (command[0] === "gh" && command.at(-1) === "repos/wordbricks/briar") {
        return successful(JSON.stringify({
          allow_merge_commit: true,
          allow_squash_merge: true,
          allow_rebase_merge: true,
        }));
      }
      if (command[0] === "gh" && command.includes("repos/wordbricks/briar/pulls/42/merge")) {
        mainSha = mergedMainSha;
        return successful(JSON.stringify({
          sha: mergedMainSha,
          merged: true,
          message: "Pull Request successfully merged",
        }));
      }
      if (command[0] === "gh") return successful();
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
    const api = recordingApi();
    await executeClaimedMergeBatch({
      claim: claimFixture("publish"),
      workerId: "worker-1",
      repositoryPath: "/repo",
      signal: new AbortController().signal,
      api: api.api,
      runCommand: run,
    });
    const statuses = commands.filter((command) =>
      command[2] === `repos/wordbricks/briar/statuses/${integrationSha}`
    );
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toContain("context=briar/merge-queue");
    expect(api.calls.filter((call) => call.path.endsWith("/lease"))).toHaveLength(2);
    expect(commands.some((command) =>
      command[0] === "gh" &&
      command.includes("repos/wordbricks/briar/pulls/42/merge") &&
      command.includes(`sha=${headSha}`) &&
      command.includes("merge_method=squash")
    )).toBe(true);
    expect(commands.some((command) =>
      command[1] === "push" && command.includes("refs/heads/main")
    )).toBe(false);
    expect(api.calls.at(-1)?.path).toBe(`/merge-batch-claims/${batchId}/published`);
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
      if (command[0] === "gh") return successful();
      throw new Error(`failed publication must not run git: ${command.join(" ")}`);
    };
    const api = recordingApi();
    await executeClaimedMergeBatch({
      claim: claimFixture("publish", failedProof),
      workerId: "worker-1",
      repositoryPath: "/repo",
      signal: new AbortController().signal,
      api: api.api,
      runCommand: run,
    });
    expect(commands.every((command) => command[0] === "gh")).toBe(true);
    expect(commands.filter((command) => command[0] === "gh")).toHaveLength(1);
    expect(api.calls.at(-1)?.path).toBe(`/merge-batch-claims/${batchId}/published`);
  });

  it("accepts a retry after signed member state and main tree match the batch", async () => {
    const initial = claimFixture("publish");
    const claim = decodeClaimedMergeBatch({
      ...initial,
      claimAttempts: 2,
      members: initial.members.map((member) => ({
        ...member,
        state: "merged",
      })),
    });
    const commands: string[][] = [];
    const run: MergeQueueCommandRunner = (command) => {
      commands.push([...command]);
      if (command[0] === "gh") return successful();
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
    const api = recordingApi();
    await executeClaimedMergeBatch({
      claim,
      workerId: "worker-1",
      repositoryPath: "/repo",
      signal: new AbortController().signal,
      api: api.api,
      runCommand: run,
    });
    expect(commands.filter((command) => command[1] === "fetch")).toHaveLength(1);
    expect(commands.some((command) => command[1] === "push")).toBe(false);
    expect(commands.some((command) => command.includes("pulls/42/merge"))).toBe(false);
    expect(api.calls.at(-1)?.path).toBe(`/merge-batch-claims/${batchId}/published`);
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
      if (command[1] === "auth") return successful();
      const endpoint = command.at(-1) ?? "";
      if (endpoint === "repos/wordbricks/briar") {
        return successful(JSON.stringify({
          id: 701,
          full_name: "wordbricks/briar",
          default_branch: "main",
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
