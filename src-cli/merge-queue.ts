import type { ClaimedMergeBatch } from "./worker-claim-contract";
import type { GitRunner } from "./worktree";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string[],
  options?: { cwd?: string; timeoutMs?: number },
) => CommandResult;

type PullRequestInspection = {
  id: string;
  headRefOid: string;
  isDraft: boolean;
  baseRefName: string;
  state: string;
  mergeable: string;
};

const parseObject = (value: string, label: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} response was not valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} response was invalid`);
  }
  return parsed as Record<string, unknown>;
};

export function assertMergeQueueProtection(stdout: string) {
  let rules: unknown;
  try {
    rules = JSON.parse(stdout);
  } catch {
    throw new Error("GitHub branch rules response was not valid JSON");
  }
  if (
    !Array.isArray(rules) ||
    !rules.some((rule) =>
      rule && typeof rule === "object" && Reflect.get(rule, "type") === "merge_queue"
    )
  ) {
    throw new Error("GitHub Require merge queue is not enabled for the base branch");
  }
}

export function parsePullRequestInspection(stdout: string): PullRequestInspection {
  const value = parseObject(stdout, "GitHub pull request");
  if (
    typeof value.id !== "string" ||
    typeof value.headRefOid !== "string" ||
    typeof value.isDraft !== "boolean" ||
    typeof value.baseRefName !== "string" ||
    typeof value.state !== "string" ||
    typeof value.mergeable !== "string"
  ) {
    throw new Error("GitHub pull request response was incomplete");
  }
  return value as PullRequestInspection;
}

export function assertFrozenPullRequest(
  batch: ClaimedMergeBatch,
  member: ClaimedMergeBatch["members"][number],
  live: PullRequestInspection,
) {
  if (live.id !== member.pullRequestNodeId) {
    throw new Error(`PR #${member.pullRequestNumber} immutable identity changed`);
  }
  if (live.headRefOid !== member.frozenHeadSha) {
    throw new Error(`PR #${member.pullRequestNumber} head changed after batch freeze`);
  }
  if (live.isDraft || live.state !== "OPEN") {
    throw new Error(`PR #${member.pullRequestNumber} is not an open ready PR`);
  }
  if (live.baseRefName !== batch.baseBranch) {
    throw new Error(`PR #${member.pullRequestNumber} targets the wrong base branch`);
  }
  if (live.mergeable !== "MERGEABLE") {
    throw new Error(`PR #${member.pullRequestNumber} is not mergeable`);
  }
}

export function parseQueueEntryId(stdout: string): string {
  const value = parseObject(stdout, "GitHub enqueue");
  const data = value.data;
  const enqueue = data && typeof data === "object"
    ? Reflect.get(data, "enqueuePullRequest")
    : null;
  const entry = enqueue && typeof enqueue === "object"
    ? Reflect.get(enqueue, "mergeQueueEntry")
    : null;
  const id = entry && typeof entry === "object" ? Reflect.get(entry, "id") : null;
  if (typeof id !== "string" || !id) {
    throw new Error("GitHub enqueue did not return a merge queue entry");
  }
  return id;
}

export function parseExistingQueueEntryId(stdout: string): string | null {
  const value = parseObject(stdout, "GitHub queue entry");
  const data = value.data;
  const node = data && typeof data === "object" ? Reflect.get(data, "node") : null;
  const entry = node && typeof node === "object"
    ? Reflect.get(node, "mergeQueueEntry")
    : null;
  const id = entry && typeof entry === "object" ? Reflect.get(entry, "id") : null;
  return typeof id === "string" && id ? id : null;
}

export type MergeGroupRef = { ref: string; sha: string };

export function parseMergeGroupRefs(stdout: string): MergeGroupRef[] {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error("GitHub merge-group refs response was not valid JSON");
  }
  if (!Array.isArray(value)) throw new Error("GitHub merge-group refs response was invalid");
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const ref = Reflect.get(item, "ref");
    const object = Reflect.get(item, "object");
    const sha = object && typeof object === "object" ? Reflect.get(object, "sha") : null;
    return typeof ref === "string" && typeof sha === "string" &&
        /^[0-9a-f]{7,64}$/u.test(sha)
      ? [{ ref, sha }]
      : [];
  });
}

export function assertLiveMergeGroupSha(stdout: string, expectedSha: string) {
  const value = parseObject(stdout, "GitHub merge-group ref");
  const object = value.object;
  const sha = object && typeof object === "object" ? Reflect.get(object, "sha") : null;
  if (sha !== expectedSha) {
    throw new Error("GitHub merge-group SHA changed after validation started");
  }
}

export function mergeGroupContainingAllMembers(
  git: GitRunner,
  repositoryPath: string,
  batch: ClaimedMergeBatch,
  refs: readonly MergeGroupRef[],
): MergeGroupRef | null {
  for (const candidate of refs) {
    const localRef = `refs/briar/merge-batches/${batch.workId}/${candidate.sha}`;
    const fetched = git([
      "-c",
      "maintenance.auto=false",
      "fetch",
      "--no-tags",
      "origin",
      `+${candidate.ref}:${localRef}`,
    ], { cwd: repositoryPath, timeoutMs: 120_000 });
    if (fetched.exitCode !== 0) continue;
    const exact = git(["rev-parse", localRef], { cwd: repositoryPath });
    if (exact.exitCode !== 0 || exact.stdout.trim() !== candidate.sha) continue;
    if (batch.members.every((member) =>
      git(["merge-base", "--is-ancestor", member.frozenHeadSha, candidate.sha], {
        cwd: repositoryPath,
      }).exitCode === 0
    )) return candidate;
  }
  return null;
}

const graphqlQueueEntry = `query($pullRequestId:ID!){node(id:$pullRequestId){... on PullRequest{mergeQueueEntry{id}}}}`;
const graphqlEnqueue = `mutation($pullRequestId:ID!,$expectedHeadOid:GitObjectID!){enqueuePullRequest(input:{pullRequestId:$pullRequestId,expectedHeadOid:$expectedHeadOid}){mergeQueueEntry{id}}}`;

export function inspectAndEnqueueMember(
  command: CommandRunner,
  batch: ClaimedMergeBatch,
  member: ClaimedMergeBatch["members"][number],
): string {
  const inspection = command([
    "gh", "pr", "view", String(member.pullRequestNumber),
    "--repo", batch.repository,
    "--json", "id,headRefOid,isDraft,baseRefName,state,mergeable",
  ]);
  if (inspection.exitCode !== 0) {
    throw new Error(
      `PR #${member.pullRequestNumber} could not be inspected: ${inspection.stderr.trim()}`,
    );
  }
  assertFrozenPullRequest(batch, member, parsePullRequestInspection(inspection.stdout));
  const queued = command([
    "gh", "api", "graphql", "-f", `query=${graphqlQueueEntry}`,
    "-F", `pullRequestId=${member.pullRequestNodeId}`,
  ]);
  if (queued.exitCode !== 0) {
    throw new Error(`PR #${member.pullRequestNumber} queue status could not be read`);
  }
  const existing = parseExistingQueueEntryId(queued.stdout);
  if (existing) return existing;
  const enqueued = command([
    "gh", "api", "graphql", "-f", `query=${graphqlEnqueue}`,
    "-F", `pullRequestId=${member.pullRequestNodeId}`,
    "-F", `expectedHeadOid=${member.frozenHeadSha}`,
  ]);
  if (enqueued.exitCode !== 0) {
    throw new Error(
      `PR #${member.pullRequestNumber} exact-head enqueue failed: ${enqueued.stderr.trim()}`,
    );
  }
  return parseQueueEntryId(enqueued.stdout);
}

export function verifyNativeMergeQueue(
  command: CommandRunner,
  repository: string,
  baseBranch: string,
) {
  const result = command([
    "gh",
    "api",
    `repos/${repository}/rules/branches/${encodeURIComponent(baseBranch)}`,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `GitHub branch rules could not be read: ${result.stderr.trim() || "gh api failed"}`,
    );
  }
  assertMergeQueueProtection(result.stdout);
}

export function publishCommitStatus(
  command: CommandRunner,
  input: {
    repository: string;
    sha: string;
    context: string;
    state: "success" | "failure";
    description: string;
  },
) {
  const result = command([
    "gh", "api", "--method", "POST",
    `repos/${input.repository}/statuses/${input.sha}`,
    "-f", `state=${input.state}`,
    "-f", `context=${input.context}`,
    "-f", `description=${input.description.slice(0, 140)}`,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`Exact-SHA status ${input.context} could not be published`);
  }
}
