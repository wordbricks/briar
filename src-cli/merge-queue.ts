import * as Schema from "effect/Schema";
import {
  MERGE_GROUP_MAX_ENTRIES_TO_BUILD,
  MERGE_GROUP_MAX_ENTRIES_TO_MERGE,
  MERGE_GROUP_MIN_ENTRIES_TO_MERGE,
  MERGE_GROUP_MIN_WAIT_MINUTES,
  MERGE_GROUP_STATUS_CONTEXTS,
} from "../src/lib/merge-group-validation-contract";
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
  maxEntriesToBuild: MERGE_GROUP_MAX_ENTRIES_TO_BUILD,
  minEntriesToMerge: MERGE_GROUP_MIN_ENTRIES_TO_MERGE,
  maxEntriesToMerge: MERGE_GROUP_MAX_ENTRIES_TO_MERGE,
  minEntriesToMergeWaitMinutes: MERGE_GROUP_MIN_WAIT_MINUTES,
  mergeMethod: "SQUASH",
} as const;

export type MergeGroupDoctorProfile = {
  enabled: boolean;
  baseRef: string;
  workerId: string | null;
  workerReady: boolean;
  workflowReady: boolean;
  appId: number | null;
  fixedProfile: string;
  appAttestation: {
    ready: boolean;
    installationId: number;
    appId: number | null;
    permissions: Record<string, string> | null;
    events: string[] | null;
    attestedAt: string;
  } | null;
};

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
  expectedAppId: number,
  activation: "active" | "inactive" = "active",
) {
  if (!Array.isArray(rawRulesets)) {
    throw new Error("GitHub ruleset list was invalid");
  }
  const exactRef = `refs/heads/${baseBranch}`;
  const branchRulesets = rawRulesets.flatMap((summary) => {
    const value = object(summary, "GitHub ruleset summary");
    const id = value.id;
    if (
      !Number.isSafeInteger(id) || value.target !== "branch"
    ) return [];
    return [{
      summary: value,
      detail: object(rawDetails.get(Number(id)), "GitHub ruleset detail"),
    }];
  });
  const exact = branchRulesets.flatMap(({ detail }) => {
    const conditions = object(detail.conditions, "GitHub ruleset conditions");
    const refName = object(conditions.ref_name, "GitHub ruleset ref condition");
    return exactStringArray(refName.include, [exactRef]) &&
        exactStringArray(refName.exclude, [])
      ? [detail]
      : [];
  });
  if (exact.length !== 1) {
    throw new Error("Exactly one ruleset must target only the main branch");
  }
  const ruleset = exact[0]!;
  const exactSummary = branchRulesets.find(({ detail }) => detail === ruleset)!
    .summary;
  const enforcement = exactSummary.enforcement;
  if (
    (activation === "active" && enforcement !== "active") ||
    (activation === "inactive" && enforcement === "active") ||
    !["active", "evaluate", "disabled"].includes(String(enforcement))
  ) {
    throw new Error(`The exact-main ruleset must be ${activation}`);
  }
  for (const candidate of branchRulesets) {
    if (candidate.detail === ruleset || candidate.summary.enforcement !== "active") {
      continue;
    }
    const conditions = object(candidate.detail.conditions, "GitHub ruleset conditions");
    const refName = object(conditions.ref_name, "GitHub ruleset ref condition");
    const include = Array.isArray(refName.include) ? refName.include : [];
    const exclude = Array.isArray(refName.exclude) ? refName.exclude : [];
    const definitelyDifferent = include.length > 0 && include.every((pattern) =>
      typeof pattern === "string" && pattern.startsWith("refs/heads/") &&
      !pattern.includes("*") && pattern !== exactRef
    );
    const definitelyExcluded = exclude.includes(exactRef) ||
      exclude.includes("~DEFAULT_BRANCH") || exclude.includes("~ALL");
    if (!definitelyDifferent && !definitelyExcluded) {
      throw new Error("Another active ruleset can overlap the effective main policy");
    }
  }
  if (!Array.isArray(ruleset.bypass_actors) || ruleset.bypass_actors.length > 0) {
    throw new Error("The main ruleset must not allow bypass actors");
  }
  if (!Array.isArray(ruleset.rules)) throw new Error("Ruleset rules were invalid");
  const rules = ruleset.rules.map((rule) => object(rule, "GitHub rule"));
  const mergeQueue = rules.filter((rule) => rule.type === "merge_queue");
  const statusChecks = rules.filter((rule) => rule.type === "required_status_checks");
  const pullRequest = rules.filter((rule) => rule.type === "pull_request");
  const deletion = rules.filter((rule) => rule.type === "deletion");
  const nonFastForward = rules.filter((rule) => rule.type === "non_fast_forward");
  if (
    mergeQueue.length !== 1 || statusChecks.length !== 1 ||
    pullRequest.length !== 1 || deletion.length !== 1 ||
    nonFastForward.length !== 1
  ) {
    throw new Error(
      "The main ruleset must require the merge queue and block direct push, deletion, and force-push",
    );
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
    if (check.integration_id !== expectedAppId) {
      throw new Error("Every required status context must be bound to the Briar GitHub App");
    }
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

export function assertEffectiveMainRules(
  rawRules: unknown,
  expectedAppId: number,
) {
  if (!Array.isArray(rawRules)) {
    throw new Error("GitHub effective main rules were invalid");
  }
  const rules = rawRules.map((rule) => object(rule, "GitHub effective rule"));
  const exactTypes = [
    "merge_queue",
    "required_status_checks",
    "pull_request",
    "deletion",
    "non_fast_forward",
  ];
  for (const type of exactTypes) {
    if (rules.filter((rule) => rule.type === type).length !== 1) {
      throw new Error(`Effective main rules require exactly one ${type} rule`);
    }
  }
  const status = object(
    rules.find((rule) => rule.type === "required_status_checks")!.parameters,
    "Effective status-check parameters",
  );
  if (status.strict_required_status_checks_policy !== false ||
      !Array.isArray(status.required_status_checks)) {
    throw new Error("Effective main status checks must use strict=false");
  }
  const contexts = status.required_status_checks.map((item) => {
    const check = object(item, "Effective required status check");
    if (check.integration_id !== expectedAppId) {
      throw new Error("Effective contexts must be bound to the Briar GitHub App");
    }
    return check.context;
  });
  if (!exactStringArray(
    [...contexts].sort(),
    [...MERGE_GROUP_STATUS_CONTEXTS].sort(),
  )) {
    throw new Error("Effective main contexts do not match Briar's fixed profile");
  }
  return { contexts };
}

export function doctorMergeQueue(
  command: CommandRunner,
  input: {
    repository: string;
    baseBranch: string;
    profile: MergeGroupDoctorProfile;
    activation?: "active" | "inactive";
  },
) {
  const activation = input.activation ?? "active";
  const expectedBaseRef = `refs/heads/${input.baseBranch}`;
  if (
    input.profile.baseRef !== expectedBaseRef ||
    input.profile.workerId === null ||
    !input.profile.workerReady ||
    !input.profile.workflowReady ||
    input.profile.appId === null ||
    !input.profile.appAttestation?.ready ||
    input.profile.appAttestation.appId !== input.profile.appId ||
    input.profile.fixedProfile !== "briar/merge-group-ci/v3"
  ) {
    throw new Error(
      "Briar requires an exact-main profile, canonical merge-wait workflow, configured App, and ready isolated Worker",
    );
  }
  if (activation === "active" && !input.profile.enabled) {
    throw new Error("Briar merge-group CI must be enabled for active postflight");
  }
  const list = command([
    "gh",
    "api",
    `repos/${input.repository}/rulesets?includes_parents=true&per_page=100`,
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
    input.profile.appId,
    activation,
  );
  if (activation === "active") {
    const effective = command([
      "gh",
      "api",
      `repos/${input.repository}/rules/branches/${encodeURIComponent(input.baseBranch)}`,
    ]);
    if (effective.exitCode !== 0) {
      throw new Error("GitHub effective main rules could not be read");
    }
    assertEffectiveMainRules(
      parseJson(effective.stdout, "GitHub effective main rules"),
      input.profile.appId,
    );
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
  return {
    ...verified,
    repository: input.repository,
    baseBranch: input.baseBranch,
    appId: input.profile.appId,
    profileEnabled: input.profile.enabled,
    workerId: input.profile.workerId,
    activation,
  };
}
