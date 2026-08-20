import { describe, expect, it } from "vitest";
import {
  assertFrozenPullRequest,
  assertLiveMergeGroupSha,
  assertMergeQueueProtection,
  inspectAndEnqueueMember,
  mergeGroupContainingAllMembers,
  parseMergeGroupRefs,
} from "./merge-queue";
import type { ClaimedMergeBatch } from "./worker-claim-contract";

const batch = {
  workType: "mergeBatch",
  workId: "11111111-1111-4111-8111-111111111111",
  runId: "11111111-1111-4111-8111-111111111111",
  sourceKey: "merge-batch:test",
  title: "test",
  claimToken: "briar_merge_batch_claim_token",
  claimAttempts: 1,
  claimedAt: "2026-08-21T00:00:00.000Z",
  leaseExpiresAt: "2026-08-21T00:15:00.000Z",
  state: "enqueueing",
  repository: "wordbricks/briar",
  repositoryId: 1,
  baseBranch: "main",
  mergeGroupRef: null,
  mergeGroupSha: null,
  validationCommand: "bun run ci:local",
  statusContexts: ["signoff/app-worker"],
  members: [{
    id: "22222222-2222-4222-8222-222222222222",
    runId: "33333333-3333-4333-8333-333333333333",
    attempt: 1,
    revision: 1,
    pullRequestId: 100,
    pullRequestNodeId: "PR_node",
    pullRequestNumber: 42,
    pullRequestUrl: "https://github.com/wordbricks/briar/pull/42",
    frozenHeadSha: "a".repeat(40),
    state: "frozen",
    queueEntryId: null,
  }],
} satisfies ClaimedMergeBatch;

describe("native merge queue client", () => {
  it("fails closed when Require merge queue is absent", () => {
    expect(() => assertMergeQueueProtection('[{"type":"required_status_checks"}]'))
      .toThrow(/not enabled/u);
    expect(() => assertMergeQueueProtection('[{"type":"merge_queue"}]'))
      .not.toThrow();
  });

  it("rejects stale, draft, wrong-base, closed, and conflicting PRs", () => {
    const live = {
      id: "PR_node",
      headRefOid: "a".repeat(40),
      isDraft: false,
      baseRefName: "main",
      state: "OPEN",
      mergeable: "MERGEABLE",
    };
    expect(() => assertFrozenPullRequest(batch, batch.members[0], live)).not.toThrow();
    for (const changed of [
      { headRefOid: "b".repeat(40) },
      { isDraft: true },
      { baseRefName: "release" },
      { state: "CLOSED" },
      { mergeable: "CONFLICTING" },
    ]) {
      expect(() => assertFrozenPullRequest(
        batch,
        batch.members[0],
        { ...live, ...changed },
      )).toThrow();
    }
  });

  it("uses expectedHeadOid and recovers an already queued member", () => {
    const calls: string[][] = [];
    const command = (args: string[]) => {
      calls.push(args);
      if (args[1] === "pr") {
        return { exitCode: 0, stdout: JSON.stringify({
          id: "PR_node",
          headRefOid: "a".repeat(40),
          isDraft: false,
          baseRefName: "main",
          state: "OPEN",
          mergeable: "MERGEABLE",
        }), stderr: "" };
      }
      return { exitCode: 0, stdout: JSON.stringify({
        data: { node: { mergeQueueEntry: { id: "MQE_existing" } } },
      }), stderr: "" };
    };
    expect(inspectAndEnqueueMember(command, batch, batch.members[0]))
      .toBe("MQE_existing");
    expect(calls.some((args) => args.includes("--admin"))).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("selects only an exact synthetic ref containing every frozen head", () => {
    const refs = parseMergeGroupRefs(JSON.stringify([{
      ref: "refs/heads/gh-readonly-queue/main/pr-42-deadbeef",
      object: { sha: "c".repeat(40) },
    }]));
    const git = (args: string[]) => ({
      exitCode: args[0] === "rev-parse" || args.includes("fetch") ||
          (args[0] === "merge-base" && args[3] === "c".repeat(40))
        ? 0
        : 1,
      stdout: args[0] === "rev-parse" ? `${"c".repeat(40)}\n` : "",
      stderr: "",
    });
    expect(mergeGroupContainingAllMembers(git, "/repo", batch, refs))
      .toEqual(refs[0]);
    expect(() => assertLiveMergeGroupSha(
      JSON.stringify({ object: { sha: "d".repeat(40) } }),
      refs[0]!.sha,
    )).toThrow(/changed/u);
  });
});
