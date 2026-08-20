import * as Schema from "effect/Schema";
import { MERGE_GROUP_STATUS_CONTEXTS } from "../src/lib/merge-group-validation-contract";
import { githubPullRequestTarget } from "./github-pr";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (command: string[]) => CommandResult;

const GitObjectSha = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}$/u),
);
const QueueEntry = Schema.Struct({
  id: Schema.NonEmptyString,
});
const PullRequest = Schema.Struct({
  id: Schema.NonEmptyString,
  state: Schema.Literal("OPEN"),
  isDraft: Schema.Boolean,
  headRefOid: GitObjectSha,
  baseRefOid: GitObjectSha,
  baseRefName: Schema.NonEmptyString,
  mergeQueueEntry: Schema.NullOr(QueueEntry),
});
const PullRequestQuery = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.Struct({
      pullRequest: Schema.NullOr(PullRequest),
    }),
  }),
});
const EnqueueMutation = Schema.Struct({
  data: Schema.Struct({
    enqueuePullRequest: Schema.Struct({
      mergeQueueEntry: QueueEntry,
    }),
  }),
});
const decodePullRequestQuery = Schema.decodeUnknownSync(PullRequestQuery);
const decodeEnqueueMutation = Schema.decodeUnknownSync(EnqueueMutation);

const parseJson = (stdout: string, label: string): unknown => {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`${label} response was not valid JSON`);
  }
};

const pullRequestQuery = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){id state isDraft headRefOid baseRefOid baseRefName mergeQueueEntry{id}}}}`;
const enqueueMutation = `mutation($pullRequestId:ID!,$expectedHeadOid:GitObjectID!){enqueuePullRequest(input:{pullRequestId:$pullRequestId,expectedHeadOid:$expectedHeadOid,jump:false}){mergeQueueEntry{id}}}`;

function inspectPullRequest(
  command: CommandRunner,
  target: { owner: string; repository: string; number: string },
) {
  const response = command([
    "gh",
    "api",
    "graphql",
    "-f",
    `query=${pullRequestQuery}`,
    "-f",
    `owner=${target.owner}`,
    "-f",
    `name=${target.repository}`,
    "-F",
    `number=${target.number}`,
  ]);
  if (response.exitCode !== 0) {
    throw new Error(
      `GitHub PR could not be inspected: ${response.stderr.trim() || "gh api failed"}`,
    );
  }
  const pullRequest = decodePullRequestQuery(
    parseJson(response.stdout, "GitHub PR"),
  ).data.repository.pullRequest;
  if (!pullRequest) throw new Error("GitHub PR was not found");
  if (pullRequest.isDraft) throw new Error("Draft pull requests cannot be queued");
  return pullRequest;
}

export function enqueuePullRequestExact(
  command: CommandRunner,
  input: {
    pullRequestUrl: string;
    expectedBaseBranch: string;
  },
) {
  const target = githubPullRequestTarget(input.pullRequestUrl);
  if (!target) throw new Error("A canonical GitHub pull request URL is required");
  const before = inspectPullRequest(command, target);
  if (before.baseRefName !== input.expectedBaseBranch) {
    throw new Error("GitHub PR targets a different base branch");
  }
  let queueEntryId = before.mergeQueueEntry?.id ?? null;
  const alreadyQueued = queueEntryId !== null;
  if (!queueEntryId) {
    const response = command([
      "gh",
      "api",
      "graphql",
      "-f",
      `query=${enqueueMutation}`,
      "-f",
      `pullRequestId=${before.id}`,
      "-f",
      `expectedHeadOid=${before.headRefOid}`,
    ]);
    if (response.exitCode !== 0) {
      throw new Error(
        `Exact-head enqueue failed: ${response.stderr.trim() || "gh api failed"}`,
      );
    }
    queueEntryId = decodeEnqueueMutation(
      parseJson(response.stdout, "GitHub enqueue"),
    ).data.enqueuePullRequest.mergeQueueEntry.id;
  }
  const after = inspectPullRequest(command, target);
  if (
    after.id !== before.id ||
    after.headRefOid !== before.headRefOid ||
    after.baseRefOid !== before.baseRefOid ||
    after.baseRefName !== before.baseRefName ||
    after.mergeQueueEntry?.id !== queueEntryId
  ) {
    throw new Error(
      "GitHub queue readback did not preserve the exact PR head, base, and entry",
    );
  }
  return {
    queueEntryId,
    alreadyQueued,
    pullRequestNodeId: before.id,
    headSha: before.headRefOid,
    baseSha: before.baseRefOid,
    baseBranch: before.baseRefName,
  };
}

export const MERGE_QUEUE_RULESET_PROFILE = {
  checkResponseTimeoutMinutes: 60,
  groupingStrategy: "HEADGREEN",
  maxEntriesToBuild: 1,
  minEntriesToMerge: 1,
  maxEntriesToMerge: 1,
  minEntriesToMergeWaitMinutes: 0,
  mergeMethod: "SQUASH",
} as const;

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} was invalid`);
  }
  return value as Record<string, unknown>;
};

const exactStringArray = (value: unknown, expected: readonly string[]) =>
  Array.isArray(value) && value.length === expected.length &&
  value.every((item, index) => item === expected[index]);

export function assertExactMainMergeQueueRuleset(
  rawRulesets: unknown,
  rawDetails: ReadonlyMap<number, unknown>,
  baseBranch: string,
) {
  if (!Array.isArray(rawRulesets)) {
    throw new Error("GitHub ruleset list was invalid");
  }
  const exactRef = `refs/heads/${baseBranch}`;
  const exact = rawRulesets.flatMap((summary) => {
    const value = object(summary, "GitHub ruleset summary");
    const id = value.id;
    if (
      !Number.isSafeInteger(id) || value.target !== "branch" ||
      value.enforcement !== "active"
    ) return [];
    const detail = object(rawDetails.get(Number(id)), "GitHub ruleset detail");
    const conditions = object(detail.conditions, "GitHub ruleset conditions");
    const refName = object(conditions.ref_name, "GitHub ruleset ref condition");
    return exactStringArray(refName.include, [exactRef]) &&
        exactStringArray(refName.exclude, [])
      ? [detail]
      : [];
  });
  if (exact.length !== 1) {
    throw new Error("Exactly one active ruleset must target only the main branch");
  }
  const ruleset = exact[0]!;
  if (!Array.isArray(ruleset.bypass_actors) || ruleset.bypass_actors.length > 0) {
    throw new Error("The main ruleset must not allow bypass actors");
  }
  if (!Array.isArray(ruleset.rules)) throw new Error("Ruleset rules were invalid");
  const rules = ruleset.rules.map((rule) => object(rule, "GitHub rule"));
  const mergeQueue = rules.filter((rule) => rule.type === "merge_queue");
  const statusChecks = rules.filter((rule) => rule.type === "required_status_checks");
  if (mergeQueue.length !== 1 || statusChecks.length !== 1) {
    throw new Error("The main ruleset requires one merge queue and one status-check rule");
  }
  const queue = object(mergeQueue[0]!.parameters, "Merge queue parameters");
  const profile = MERGE_QUEUE_RULESET_PROFILE;
  const expectedQueue = {
    check_response_timeout_minutes: profile.checkResponseTimeoutMinutes,
    grouping_strategy: profile.groupingStrategy,
    max_entries_to_build: profile.maxEntriesToBuild,
    min_entries_to_merge: profile.minEntriesToMerge,
    max_entries_to_merge: profile.maxEntriesToMerge,
    min_entries_to_merge_wait_minutes: profile.minEntriesToMergeWaitMinutes,
    merge_method: profile.mergeMethod,
  };
  for (const [key, expected] of Object.entries(expectedQueue)) {
    if (queue[key] !== expected) {
      throw new Error(`Merge queue ${key} must be ${expected}`);
    }
  }
  const checks = object(
    statusChecks[0]!.parameters,
    "Required status-check parameters",
  );
  if (checks.strict_required_status_checks_policy !== false) {
    throw new Error("Required status checks must use strict=false");
  }
  if (!Array.isArray(checks.required_status_checks)) {
    throw new Error("Required status checks were invalid");
  }
  const contexts = checks.required_status_checks.map((item) => {
    const check = object(item, "Required status check");
    return check.context;
  });
  if (
    !contexts.every((context) => typeof context === "string") ||
    !exactStringArray([...contexts].sort(), [...MERGE_GROUP_STATUS_CONTEXTS].sort())
  ) {
    throw new Error("Required status contexts do not match Briar's fixed profile");
  }
  return { rulesetId: Number(ruleset.id), contexts };
}

export function doctorMergeQueue(
  command: CommandRunner,
  input: { repository: string; baseBranch: string },
) {
  const list = command([
    "gh",
    "api",
    `repos/${input.repository}/rulesets?includes_parents=false&per_page=100`,
  ]);
  if (list.exitCode !== 0) {
    throw new Error("GitHub rulesets could not be read");
  }
  const summaries = parseJson(list.stdout, "GitHub rulesets");
  if (!Array.isArray(summaries)) throw new Error("GitHub ruleset list was invalid");
  const details = new Map<number, unknown>();
  for (const summary of summaries) {
    const id = object(summary, "GitHub ruleset summary").id;
    if (!Number.isSafeInteger(id)) continue;
    const detail = command([
      "gh",
      "api",
      `repos/${input.repository}/rulesets/${Number(id)}`,
    ]);
    if (detail.exitCode !== 0) throw new Error(`GitHub ruleset ${id} could not be read`);
    details.set(Number(id), parseJson(detail.stdout, `GitHub ruleset ${id}`));
  }
  const verified = assertExactMainMergeQueueRuleset(
    summaries,
    details,
    input.baseBranch,
  );
  const repository = command(["gh", "api", `repos/${input.repository}`]);
  if (repository.exitCode !== 0) throw new Error("GitHub Worker permission could not be read");
  const permission = object(
    object(parseJson(repository.stdout, "GitHub repository"), "GitHub repository")
      .permissions,
    "GitHub repository permission",
  );
  if (permission.push !== true) {
    throw new Error("The Worker credential requires repository push permission");
  }
  const classic = command([
    "gh",
    "api",
    `repos/${input.repository}/branches/${encodeURIComponent(input.baseBranch)}/protection/required_status_checks`,
  ]);
  if (classic.exitCode === 0) {
    const protection = object(
      parseJson(classic.stdout, "GitHub classic branch protection"),
      "GitHub classic branch protection",
    );
    if (protection.strict !== false) {
      throw new Error("Classic branch protection must use strict=false");
    }
  } else if (!/(?:HTTP 404|Not Found)/iu.test(classic.stderr)) {
    throw new Error("GitHub classic branch protection could not be read");
  }
  return { ...verified, repository: input.repository, baseBranch: input.baseBranch };
}
