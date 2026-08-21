import { describe, expect, it } from "vitest";
import {
  assertExactMainMergeQueueRuleset,
  doctorMergeQueue,
  enqueuePullRequestExact,
  MERGE_QUEUE_RULESET_PROFILE,
  type CommandRunner,
} from "./merge-queue";

const sha = (value: string) => value.repeat(40);
const appId = 12345;
const doctorProfile = {
  enabled: true,
  baseRef: "refs/heads/main",
  workerId: "11111111-1111-4111-8111-111111111111",
  workerReady: true,
  workflowReady: true,
  appId,
  fixedProfile: "briar/merge-group-ci/v3",
  appAttestation: {
    ready: true,
    installationId: 8001,
    appId,
    permissions: {
      administration: "read",
      contents: "read",
      merge_queues: "write",
      pull_requests: "read",
      statuses: "write",
    },
    events: ["merge_group", "pull_request"],
    attestedAt: "2026-08-21T00:00:00.000Z",
  },
};
const pullRequest = (entry: string | null = null) => ({
  data: {
    repository: {
      pullRequest: {
        id: "PR_node",
        state: "OPEN",
        isDraft: false,
        headRefOid: sha("a"),
        baseRefOid: sha("b"),
        baseRefName: "main",
        mergeQueueEntry: entry ? { id: entry } : null,
      },
    },
  },
});

const ruleset = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  target: "branch",
  enforcement: "active",
  bypass_actors: [],
  conditions: {
    ref_name: { include: ["refs/heads/main"], exclude: [] },
  },
  rules: [{
    type: "merge_queue",
    parameters: {
      check_response_timeout_minutes:
        MERGE_QUEUE_RULESET_PROFILE.checkResponseTimeoutMinutes,
      grouping_strategy: MERGE_QUEUE_RULESET_PROFILE.groupingStrategy,
      max_entries_to_build: MERGE_QUEUE_RULESET_PROFILE.maxEntriesToBuild,
      min_entries_to_merge: MERGE_QUEUE_RULESET_PROFILE.minEntriesToMerge,
      max_entries_to_merge: MERGE_QUEUE_RULESET_PROFILE.maxEntriesToMerge,
      min_entries_to_merge_wait_minutes:
        MERGE_QUEUE_RULESET_PROFILE.minEntriesToMergeWaitMinutes,
      merge_method: MERGE_QUEUE_RULESET_PROFILE.mergeMethod,
    },
  }, {
    type: "required_status_checks",
    parameters: {
      strict_required_status_checks_policy: false,
      required_status_checks: [
        { context: "signoff/app-worker", integration_id: appId },
        { context: "signoff/d1-migrations", integration_id: appId },
        { context: "signoff/rust", integration_id: appId },
        { context: "signoff/security", integration_id: appId },
      ],
    },
  }, {
    type: "pull_request",
    parameters: {},
  }, {
    type: "deletion",
  }, {
    type: "non_fast_forward",
  }],
  ...overrides,
});

describe("exact PR merge-queue enqueue", () => {
  it("uses expectedHeadOid and jump:false, then verifies base/head/entry readback", () => {
    const calls: string[][] = [];
    let inspection = 0;
    const command: CommandRunner = (args) => {
      calls.push(args);
      if (args.some((item) => item.startsWith("query=query"))) {
        inspection += 1;
        return {
          exitCode: 0,
          stdout: JSON.stringify(pullRequest(inspection === 1 ? null : "MQE_1")),
          stderr: "",
        };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: { enqueuePullRequest: { mergeQueueEntry: { id: "MQE_1" } } },
        }),
        stderr: "",
      };
    };

    expect(enqueuePullRequestExact(command, {
      pullRequestUrl: "https://github.com/wordbricks/briar/pull/42",
      expectedBaseBranch: "main",
    })).toMatchObject({
      queueEntryId: "MQE_1",
      headSha: sha("a"),
      baseSha: sha("b"),
      alreadyQueued: false,
    });
    const mutation = calls.flat().find((item) =>
      item.startsWith("query=mutation")
    )!;
    expect(mutation).toContain("expectedHeadOid:$expectedHeadOid");
    expect(mutation).toContain("jump:false");
    expect(calls.flat()).toContain(`expectedHeadOid=${sha("a")}`);
  });

  it("fails closed when the readback head changes", () => {
    let inspection = 0;
    expect(() => enqueuePullRequestExact((args) => {
      if (args.some((item) => item.startsWith("query=query"))) {
        inspection += 1;
        const value = pullRequest(inspection === 1 ? null : "MQE_1");
        if (inspection === 2) {
          value.data.repository.pullRequest.headRefOid = sha("c");
        }
        return { exitCode: 0, stdout: JSON.stringify(value), stderr: "" };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: { enqueuePullRequest: { mergeQueueEntry: { id: "MQE_1" } } },
        }),
        stderr: "",
      };
    }, {
      pullRequestUrl: "https://github.com/wordbricks/briar/pull/42",
      expectedBaseBranch: "main",
    })).toThrow(/readback/u);
  });
});

describe("merge-queue doctor", () => {
  it("accepts only the fixed HEADGREEN/SQUASH/no-bypass profile", () => {
    expect(assertExactMainMergeQueueRuleset(
      [{ id: 7, target: "branch", enforcement: "active" }],
      new Map([[7, ruleset()]]),
      "main",
      appId,
    )).toMatchObject({ rulesetId: 7 });
  });

  it.each([
    ["strict=true", () => {
      const value = ruleset();
      Reflect.set(Reflect.get(value.rules[1] as object, "parameters"),
        "strict_required_status_checks_policy", true);
      return value;
    }],
    ["ALLGREEN", () => {
      const value = ruleset();
      Reflect.set(Reflect.get(value.rules[0] as object, "parameters"),
        "grouping_strategy", "ALLGREEN");
      return value;
    }],
    ["wrong contexts", () => {
      const value = ruleset();
      Reflect.set(Reflect.get(value.rules[1] as object, "parameters"),
        "required_status_checks", [{ context: "ci/forged" }]);
      return value;
    }],
    ["bypass", () => ruleset({ bypass_actors: [{ actor_type: "OrganizationAdmin" }] })],
    ["group limits", () => {
      const value = ruleset();
      Reflect.set(Reflect.get(value.rules[0] as object, "parameters"),
        "max_entries_to_build", 2);
      return value;
    }],
  ])("rejects %s", (_label, changed) => {
    expect(() => assertExactMainMergeQueueRuleset(
      [{ id: 7, target: "branch", enforcement: "active" }],
      new Map([[7, changed()]]),
      "main",
      appId,
    )).toThrow();
  });

  it("fails before local gh calls when server App attestation is absent", () => {
    expect(() => doctorMergeQueue(() => {
      throw new Error("local gh must not inspect the App installation");
    }, {
      repository: "wordbricks/briar",
      baseBranch: "main",
      profile: { ...doctorProfile, appAttestation: null },
    })).toThrow(/configured App/u);
  });

  it("rejects classic strict=true even when the ruleset is correct", () => {
    const command: CommandRunner = (args) => {
      if (args[2]?.includes("rulesets?")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ id: 7, target: "branch", enforcement: "active" }]),
          stderr: "",
        };
      }
      if (args[2]?.endsWith("rulesets/7")) {
        return { exitCode: 0, stdout: JSON.stringify(ruleset()), stderr: "" };
      }
      if (args[2]?.includes("rules/branches/main")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify(ruleset().rules),
          stderr: "",
        };
      }
      if (args[2]?.includes("required_status_checks")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ strict: true, contexts: [] }),
          stderr: "",
        };
      }
      return { exitCode: 1, stdout: "", stderr: "unexpected" };
    };
    expect(() => doctorMergeQueue(command, {
      repository: "wordbricks/briar",
      baseBranch: "main",
      profile: doctorProfile,
    })).toThrow(/strict=false/u);
  });

  it("rejects inherited or overlapping active branch rulesets", () => {
    expect(() => assertExactMainMergeQueueRuleset(
      [
        { id: 7, target: "branch", enforcement: "active" },
        { id: 8, target: "branch", enforcement: "active" },
      ],
      new Map([[7, ruleset()], [8, ruleset({ id: 8 })]]),
      "main",
      appId,
    )).toThrow(/Exactly one ruleset/u);
  });

  it("supports a fail-closed inactive preflight before activation", () => {
    expect(assertExactMainMergeQueueRuleset(
      [{ id: 7, target: "branch", enforcement: "disabled" }],
      new Map([[7, ruleset({ enforcement: "disabled" })]]),
      "main",
      appId,
      "inactive",
    )).toMatchObject({ rulesetId: 7 });
    expect(() => assertExactMainMergeQueueRuleset(
      [{ id: 7, target: "branch", enforcement: "disabled" }],
      new Map([[7, ruleset({ enforcement: "disabled" })]]),
      "main",
      appId,
      "active",
    )).toThrow(/must be active/u);
  });

  it("rejects an unavailable isolated Worker before reading GitHub", () => {
    const command = (() => {
      throw new Error("GitHub must not be queried");
    }) as CommandRunner;
    expect(() => doctorMergeQueue(command, {
      repository: "wordbricks/briar",
      baseBranch: "main",
      profile: { ...doctorProfile, workerReady: false },
    })).toThrow(/ready isolated Worker/u);
  });

  it("rejects a workflow without the canonical merge-wait checkpoint", () => {
    expect(() => doctorMergeQueue(() => {
      throw new Error("GitHub must not be read before the workflow fence");
    }, {
      repository: "wordbricks/briar",
      baseBranch: "main",
      profile: { ...doctorProfile, workflowReady: false },
    })).toThrow(/canonical merge-wait workflow/u);
  });
});
