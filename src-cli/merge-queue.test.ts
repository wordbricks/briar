import { describe, expect, it, vi } from "vitest";
import {
  claimMergeBatchIfReady,
  exactAwaitingChecksWindow,
  executeClaimedMergeBatch,
  inspectMergeQueueDoctor,
  listCompleteMergeQueue,
  selectTailAuthority,
  type MergeBatchApi,
  type MergeQueueCommandRunner,
  type MergeQueueEntry,
} from "./merge-queue";
import type { MergeGroupContainerRuntime } from "./merge-group-validation";
import {
  decodeClaimedMergeBatch,
  type ClaimedMergeBatch,
} from "./worker-claim-contract";

const batchId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const memberId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const headSha = "a".repeat(40);
const historicalBaseSha = "b".repeat(40);
const signedBaseSha = "c".repeat(40);
const mergeGroupSha = "d".repeat(40);
const wrongSha = "e".repeat(40);
const logSha256 = "f".repeat(64);
const mergeGroupRef =
  "refs/heads/gh-readonly-queue/main/pr-42-deadbeef";
const runtime: MergeGroupContainerRuntime = {
  executable: "/usr/local/bin/docker",
  image: `ghcr.io/wordbricks/briar-merge-group-ci@sha256:${"9".repeat(64)}`,
};

const validationResults = [
  "app-worker",
  "d1-migrations",
  "rust",
  "security",
].map((context) => ({
  context,
  passed: true,
  exitCode: 0,
  failureCode: null,
  log: `${context} passed`,
  logSha256,
  logTruncated: false,
}));

function claimFixture(
  phase: ClaimedMergeBatch["phase"] = "tail_authority",
  overrides: Partial<Record<string, unknown>> = {},
) {
  const hasAuthority = ["validate", "publish", "drain"].includes(phase);
  const raw = {
    workType: "mergeBatch",
    workId: batchId,
    runId: batchId,
    sourceKey: "merge:wordbricks/briar#11111111",
    title: "Merge 1 PR into main",
    projectId,
    repositoryId: 701,
    repository: "wordbricks/briar",
    baseBranch: "main",
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
      finalDeliveryId: hasAuthority ? "delivery-final" : null,
      mergeGroupRef: hasAuthority ? mergeGroupRef : null,
      mergeGroupSha: hasAuthority ? mergeGroupSha : null,
      mergeGroupBaseSha: hasAuthority ? signedBaseSha : null,
      validationResults: phase === "publish" || phase === "drain"
        ? validationResults
        : null,
      validatedAt: phase === "publish" || phase === "drain"
        ? "2026-08-21T01:05:00+00:00"
        : null,
      publishedAt: phase === "drain"
        ? "2026-08-21T01:06:00+00:00"
        : null,
      failureCode: phase === "drain" ? "validation_failed" : null,
      failureDetail: phase === "drain"
        ? "One or more required validation contexts failed"
        : null,
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
      queueEntryId: phase === "enqueue" ? null : "MQE_42",
      state: phase === "enqueue" ? "frozen" : "enqueued",
    }],
    pendingHeads: phase === "tail_authority"
      ? [{
          deliveryId: "delivery-final",
          headRef: mergeGroupRef,
          headSha: mergeGroupSha,
          baseSha: signedBaseSha,
          tailPullRequestNumber: 42,
          receivedAt: "2026-08-21T01:04:00+00:00",
        }]
      : [],
    ...overrides,
  };
  return decodeClaimedMergeBatch(raw);
}

function queueEntry(input: {
  id?: string;
  number?: number;
  sha?: string;
  state?: string;
} = {}): MergeQueueEntry {
  const number = input.number ?? 42;
  return {
    id: input.id ?? "MQE_42",
    state: input.state ?? "AWAITING_CHECKS",
    pullRequest: {
      id: number === 42 ? "PR_kwDOBriar42" : `PR_${number}`,
      databaseId: number === 42 ? 501 : 1_000 + number,
      number,
      headRefOid: input.sha ?? (number === 42 ? headSha : wrongSha),
      baseRefName: "main",
      baseRefOid: historicalBaseSha,
    },
  };
}

function pullRequestResponse(
  queueEntryId: string | null,
  liveBaseSha = historicalBaseSha,
) {
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
          mergeQueueEntry: queueEntryId
            ? { id: queueEntryId, state: "AWAITING_CHECKS" }
            : null,
        },
      },
    },
  });
}

function enqueueResponse(liveBaseSha = historicalBaseSha) {
  return JSON.stringify({
    data: {
      enqueuePullRequest: {
        mergeQueueEntry: {
          ...queueEntry(),
          pullRequest: {
            ...queueEntry().pullRequest,
            baseRefOid: liveBaseSha,
          },
        },
      },
    },
  });
}

function dequeueResponse() {
  return JSON.stringify({
    data: { dequeuePullRequest: { clientMutationId: null } },
  });
}

function queuePage(
  nodes: readonly MergeQueueEntry[],
  hasNextPage = false,
  endCursor: string | null = null,
) {
  return JSON.stringify({
    data: {
      repository: {
        databaseId: 701,
        nameWithOwner: "wordbricks/briar",
        mergeQueue: {
          entries: {
            nodes,
            pageInfo: { hasNextPage, endCursor },
          },
        },
      },
    },
  });
}

const successful = (stdout = "{}") => ({
  exitCode: 0,
  stdout,
  stderr: "",
});

function recordingApi() {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const api: MergeBatchApi = async <T>(path: string, init: {
    method: "POST";
    body: string;
  }) => {
    calls.push({
      path,
      body: JSON.parse(init.body) as Record<string, unknown>,
    });
    return {} as T;
  };
  return { api, calls };
}

describe("local GitHub merge-queue worker", () => {
  it("accepts a sealed single-member batch with an independent signed base", () => {
    const claim = claimFixture("publish");
    expect(claim.members).toHaveLength(1);
    expect(claim.members[0].baseSha).toBe(historicalBaseSha);
    expect(claim.batch.mergeGroupBaseSha).toBe(signedBaseSha);
  });

  it("skips merge claims when the runtime is not ready or polling replies only", async () => {
    const api = vi.fn();
    await expect(claimMergeBatchIfReady({
      api: api as unknown as MergeBatchApi,
      projectId,
      workerId: "worker-1",
      claimedBy: "local",
      repliesOnly: false,
      runtime: null,
    })).resolves.toBeNull();
    await expect(claimMergeBatchIfReady({
      api: api as unknown as MergeBatchApi,
      projectId,
      workerId: "worker-1",
      claimedBy: "local",
      repliesOnly: true,
      runtime,
    })).resolves.toBeNull();
    expect(api).not.toHaveBeenCalled();
  });

  it("enqueues with exactHeadOid and jump:false across historical base drift, then requires readback", async () => {
    const claim = claimFixture("enqueue");
    const githubCalls: string[][] = [];
    let pullReads = 0;
    const run: MergeQueueCommandRunner = (command) => {
      githubCalls.push([...command]);
      const query = command.find((argument) => argument.startsWith("query=")) ?? "";
      if (query.includes("BriarMergePullRequest")) {
        pullReads += 1;
        return successful(pullRequestResponse(
          pullReads === 1 ? null : "MQE_42",
          signedBaseSha,
        ));
      }
      if (query.includes("BriarEnqueuePullRequest")) {
        return successful(enqueueResponse(signedBaseSha));
      }
      throw new Error(`unexpected command: ${command.join(" ")}`);
    };
    const api = recordingApi();

    await executeClaimedMergeBatch({
      claim,
      workerId: "worker-1",
      repositoryPath: "/repo",
      runtime,
      signal: new AbortController().signal,
      api: api.api,
      runCommand: run,
    });

    const mutation = githubCalls.find((command) =>
      command.some((argument) => argument.includes("BriarEnqueuePullRequest"))
    )!;
    const mutationText = mutation.find((argument) =>
      argument.startsWith("query=")
    )!;
    expect(mutationText).toContain("expectedHeadOid: $expectedHeadOid");
    expect(mutationText).toContain("jump: false");
    expect(mutation).toContain(`expectedHeadOid=${headSha}`);
    expect(pullReads).toBe(2);
    expect(api.calls.map((call) => call.path)).toEqual([
      `/merge-batch-claims/${batchId}/enqueued`,
      `/merge-batch-claims/${batchId}/release`,
    ]);
    expect(api.calls[0].body).toMatchObject({
      candidateId: memberId,
      expectedHeadSha: headSha,
      expectedBaseSha: historicalBaseSha,
      queueEntryId: "MQE_42",
    });
  });

  it("releases instead of accepting an enqueue whose post-readback is absent", async () => {
    const claim = claimFixture("enqueue");
    let pullReads = 0;
    const run: MergeQueueCommandRunner = (command) => {
      const query = command.find((argument) => argument.startsWith("query=")) ?? "";
      if (query.includes("BriarMergePullRequest")) {
        pullReads += 1;
        return successful(pullRequestResponse(null));
      }
      if (query.includes("BriarEnqueuePullRequest")) {
        return successful(enqueueResponse());
      }
      throw new Error("unexpected command");
    };
    const api = recordingApi();

    await expect(executeClaimedMergeBatch({
      claim,
      workerId: "worker-1",
      repositoryPath: "/repo",
      runtime,
      signal: new AbortController().signal,
      api: api.api,
      runCommand: run,
    })).rejects.toThrow("enqueue readback did not match");
    expect(pullReads).toBe(2);
    expect(api.calls.map((call) => call.path)).toEqual([
      `/merge-batch-claims/${batchId}/release`,
    ]);
  });

  it("paginates the complete queue instead of trusting the first entries", async () => {
    const claim = claimFixture();
    const commands: string[][] = [];
    const distractors = Array.from({ length: 5 }, (_, index) =>
      queueEntry({ id: `MQE_${index}`, number: index + 1 })
    );
    const run: MergeQueueCommandRunner = (command) => {
      commands.push([...command]);
      const hasCursor = command.includes("cursor=page-2");
      return successful(hasCursor
        ? queuePage([queueEntry()])
        : queuePage(distractors, true, "page-2"));
    };

    const entries = await listCompleteMergeQueue(claim, "/repo", run);

    expect(entries).toHaveLength(6);
    expect(entries.at(-1)?.id).toBe("MQE_42");
    expect(commands).toHaveLength(2);
    expect(commands[0].join("\n")).toContain("entries(first: 100");
    expect(commands[1]).toContain("cursor=page-2");
  });

  it("ignores intermediate signed heads and selects only the exact live final tail", () => {
    const final = claimFixture();
    const intermediate = {
      deliveryId: "delivery-intermediate",
      headRef: "refs/heads/gh-readonly-queue/main/pr-41-deadbeef",
      headSha: wrongSha,
      baseSha: signedBaseSha,
      tailPullRequestNumber: 41,
      receivedAt: "2026-08-21T01:03:00+00:00",
    };
    const claim = decodeClaimedMergeBatch({
      ...final,
      pendingHeads: [intermediate, ...final.pendingHeads],
    });
    const entries = [queueEntry()];
    const refs = new Map([
      ["refs/heads/main", signedBaseSha],
      [mergeGroupRef, mergeGroupSha],
      [intermediate.headRef, intermediate.headSha],
    ]);

    expect(selectTailAuthority(claim, entries, refs)).toEqual({
      head: final.pendingHeads[0],
      authorityEntries: [{
        queueEntryId: "MQE_42",
        pullRequestNumber: 42,
      }],
    });
    expect(selectTailAuthority(
      decodeClaimedMergeBatch({ ...final, pendingHeads: [intermediate] }),
      entries,
      refs,
    )).toBeNull();
    expect(selectTailAuthority(
      claim,
      [queueEntry({ id: "MQE_external", number: 7 }), ...entries],
      refs,
    )).toBeNull();
    expect(exactAwaitingChecksWindow(claim, [
      queueEntry({ state: "LOCKED" }),
    ])).toBeNull();
  });

  it("fails and releases when the signed final ref or protected base is not live", async () => {
    const claim = claimFixture();
    const run: MergeQueueCommandRunner = (command) => {
      if (command[0] === "gh") return successful(queuePage([queueEntry()]));
      if (command[0] === "git") {
        return successful(
          `${wrongSha}\t${mergeGroupRef}\n${signedBaseSha}\trefs/heads/main\n`,
        );
      }
      throw new Error("unexpected command");
    };
    const api = recordingApi();

    await expect(executeClaimedMergeBatch({
      claim,
      workerId: "worker-1",
      repositoryPath: "/repo",
      runtime,
      signal: new AbortController().signal,
      api: api.api,
      runCommand: run,
    })).rejects.toThrow("live exact queue ref and protected main SHA");
    expect(api.calls.map((call) => call.path)).toEqual([
      `/merge-batch-claims/${batchId}/release`,
    ]);
  });

  it("dequeues and blocks instead of accepting a signed cohort with a foreign prefix", async () => {
    const claim = claimFixture();
    const commands: string[][] = [];
    let pullReads = 0;
    const run: MergeQueueCommandRunner = (command) => {
      commands.push([...command]);
      if (command[0] === "git") {
        return successful(
          `${mergeGroupSha}\t${mergeGroupRef}\n${signedBaseSha}\trefs/heads/main\n`,
        );
      }
      const query = command.find((argument) => argument.startsWith("query=")) ?? "";
      if (query.includes("BriarMergeQueuePage")) {
        return successful(queuePage([
          queueEntry({ id: "MQE_external", number: 7 }),
          queueEntry(),
        ]));
      }
      if (query.includes("BriarMergePullRequest")) {
        pullReads += 1;
        return successful(pullRequestResponse(
          pullReads === 1 ? "MQE_42" : null,
        ));
      }
      if (query.includes("BriarDequeuePullRequest")) {
        return successful(dequeueResponse());
      }
      throw new Error(`unexpected command: ${command.join(" ")}`);
    };
    const api = recordingApi();

    await executeClaimedMergeBatch({
      claim,
      workerId: "worker-1",
      repositoryPath: "/repo",
      runtime,
      signal: new AbortController().signal,
      api: api.api,
      runCommand: run,
    });

    expect(commands.some((command) =>
      command.some((argument) => argument.includes("BriarDequeuePullRequest"))
    )).toBe(true);
    expect(api.calls).toEqual([{
      path: `/merge-batch-claims/${batchId}/block`,
      body: {
        projectId,
        workerId: "worker-1",
        claimToken: claim.claimToken,
        code: "foreign_queue_prefix",
        detail:
          "The signed cumulative merge-group contains a queue entry outside the sealed Briar cohort",
      },
    }]);
  });

  it("re-fences before every status and always targets the claimed SHA", async () => {
    const claim = claimFixture("publish");
    const commands: string[][] = [];
    const run: MergeQueueCommandRunner = (command) => {
      commands.push([...command]);
      if (command[0] === "git") {
        return successful(
          `${mergeGroupSha}\t${mergeGroupRef}\n${signedBaseSha}\trefs/heads/main\n`,
        );
      }
      const query = command.find((argument) => argument.startsWith("query=")) ?? "";
      if (query.includes("BriarMergeQueuePage")) {
        return successful(queuePage([queueEntry()]));
      }
      if (command[2]?.startsWith("repos/")) return successful();
      throw new Error(`unexpected command: ${command.join(" ")}`);
    };
    const api = recordingApi();

    await executeClaimedMergeBatch({
      claim,
      workerId: "worker-1",
      repositoryPath: "/repo",
      runtime,
      signal: new AbortController().signal,
      api: api.api,
      runCommand: run,
    });

    const statuses = commands.filter((command) =>
      command[2]?.startsWith("repos/wordbricks/briar/statuses/")
    );
    expect(statuses).toHaveLength(4);
    expect(statuses.every((command) =>
      command[2] === `repos/wordbricks/briar/statuses/${mergeGroupSha}`
    )).toBe(true);
    expect(statuses.map((command) =>
      command.find((argument) => argument.startsWith("context="))
    )).toEqual([
      "context=signoff/app-worker",
      "context=signoff/d1-migrations",
      "context=signoff/rust",
      "context=signoff/security",
    ]);
    expect(api.calls.filter((call) => call.path.endsWith("/lease"))).toHaveLength(4);
    expect(api.calls.at(-1)?.path).toBe(
      `/merge-batch-claims/${batchId}/published`,
    );
  });

  it("finishes exact-SHA failure publication after GitHub removes the queue ref", async () => {
    const successfulClaim = claimFixture("publish");
    const failedProof = successfulClaim.batch.validationResults!.map(
      (result, index) => index === 0
        ? {
            ...result,
            passed: false,
            exitCode: 1,
            failureCode: "ci_failed" as const,
            log: "app-worker failed",
          }
        : result,
    );
    const claim = decodeClaimedMergeBatch({
      ...successfulClaim,
      batch: {
        ...successfulClaim.batch,
        validationResults: failedProof,
      },
    });
    const commands: string[][] = [];
    const run: MergeQueueCommandRunner = (command) => {
      commands.push([...command]);
      if (command[2]?.startsWith("repos/wordbricks/briar/statuses/")) {
        return successful();
      }
      throw new Error(
        `failed proof must not depend on a deleted queue ref: ${command.join(" ")}`,
      );
    };
    const api = recordingApi();

    await executeClaimedMergeBatch({
      claim,
      workerId: "worker-1",
      repositoryPath: "/repo",
      runtime,
      signal: new AbortController().signal,
      api: api.api,
      runCommand: run,
    });

    const statuses = commands.filter((command) =>
      command[2]?.startsWith("repos/wordbricks/briar/statuses/")
    );
    expect(statuses).toHaveLength(4);
    expect(statuses.every((command) =>
      command[2] === `repos/wordbricks/briar/statuses/${mergeGroupSha}`
    )).toBe(true);
    expect(statuses[0]).toContain("state=failure");
    expect(api.calls.filter((call) => call.path.endsWith("/lease"))).toHaveLength(4);
    expect(api.calls.at(-1)?.path).toBe(
      `/merge-batch-claims/${batchId}/published`,
    );
  });

  it("doctors only exact-main active no-bypass effective rules", () => {
    const profile = {
      projectId,
      repositoryId: 701,
      repository: "wordbricks/briar",
      baseBranch: "main" as const,
      enabled: true,
      quietWindowMs: 30_000,
      maxBatchSize: 5,
      updatedAt: "2026-08-21T01:00:00Z",
    };
    const effectiveRules = [[
      {
        type: "merge_queue",
        ruleset_id: 99,
        parameters: {
          grouping_strategy: "HEADGREEN",
          merge_method: "SQUASH",
          max_entries_to_build: 5,
          max_entries_to_merge: 5,
        },
      },
      { type: "pull_request", ruleset_id: 99 },
      { type: "deletion", ruleset_id: 99 },
      { type: "non_fast_forward", ruleset_id: 99 },
      {
        type: "required_status_checks",
        ruleset_id: 99,
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: validationResults.map((result) => ({
            context: `signoff/${result.context}`,
          })),
        },
      },
    ]];
    const ruleset = {
      id: 99,
      target: "branch",
      enforcement: "active",
      bypass_actors: [],
      conditions: {
        ref_name: { include: ["refs/heads/main"], exclude: [] },
      },
    };
    const commands: string[][] = [];
    const run: MergeQueueCommandRunner = (command) => {
      commands.push([...command]);
      if (command[0] === "git") {
        return successful("git@github.com:wordbricks/briar.git\n");
      }
      if (command[1] === "auth") return successful();
      const endpoint = command.at(-1) ?? "";
      if (endpoint === "repos/wordbricks/briar") {
        return successful(JSON.stringify({
          id: 701,
          full_name: "wordbricks/briar",
          default_branch: "main",
        }));
      }
      if (endpoint.includes("rules/branches/main")) {
        return successful(JSON.stringify(effectiveRules));
      }
      if (endpoint.includes("rulesets/99")) {
        return successful(JSON.stringify(ruleset));
      }
      throw new Error(`unexpected command: ${command.join(" ")}`);
    };

    const result = inspectMergeQueueDoctor({
      profile,
      repositoryPath: "/repo",
      runtime: { ready: true, ...runtime },
      runCommand: run,
    });

    expect(result.ok).toBe(true);
    expect(result.checks.every((check) => check.ok)).toBe(true);
    expect(commands.some((command) =>
      command.some((argument) => argument.includes("/installation"))
    )).toBe(false);

    const disabled = inspectMergeQueueDoctor({
      profile: { ...profile, enabled: false },
      repositoryPath: "/repo",
      runtime: { ready: true, ...runtime },
      runCommand: run,
    });
    expect(disabled.ok).toBe(true);
    expect(disabled.checks).toContainEqual(expect.objectContaining({
      name: "active-no-bypass-rulesets",
      ok: true,
    }));

    const bypassedRun: MergeQueueCommandRunner = (command, options) => {
      const endpoint = command.at(-1) ?? "";
      if (endpoint.includes("rulesets/99")) {
        return successful(JSON.stringify({
          ...ruleset,
          bypass_actors: [{ actor_type: "OrganizationAdmin" }],
        }));
      }
      return run(command, options);
    };
    const bypassed = inspectMergeQueueDoctor({
      profile: { ...profile, enabled: false },
      repositoryPath: "/repo",
      runtime: { ready: true, ...runtime },
      runCommand: bypassedRun,
    });
    expect(bypassed.ok).toBe(false);
    expect(bypassed.checks).toContainEqual(expect.objectContaining({
      name: "active-no-bypass-rulesets",
      ok: false,
    }));
  });
});
