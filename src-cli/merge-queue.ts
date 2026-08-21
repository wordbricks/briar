import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as Schema from "effect/Schema";
import {
  MERGE_GROUP_CI_CONTEXTS,
  MERGE_GROUP_CI_PROTECTED_BASE_REF_PREFIX,
  MERGE_GROUP_CI_SOURCE_REF_PREFIX,
  type MergeGroupCiContext,
} from "../src/lib/merge-group-validation-contract";
import {
  disposeExactShaValidation,
  ExactShaValidationInputError,
  MergeGroupCiDefinitionChangedError,
  prepareExactShaValidation,
  runFixedMergeGroupValidation,
  type CommandResult as ValidationCommandResult,
  type GitRunner as ValidationGitRunner,
  type MergeGroupContainerRuntime,
} from "./merge-group-validation";
import {
  decodeClaimedMergeBatch,
  type ClaimedMergeBatch,
} from "./worker-claim-contract";

export type MergeQueueCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type MergeQueueCommandOptions = {
  cwd: string;
  timeoutMs: number;
  /** A complete environment when provided. */
  env?: Readonly<NodeJS.ProcessEnv>;
};

export type MergeQueueCommandRunner = (
  command: readonly string[],
  options: MergeQueueCommandOptions,
) => MergeQueueCommandResult;

export type MergeBatchApi = <T = unknown>(
  path: string,
  init: { method: "POST"; body: string },
) => Promise<T>;

export class MergeQueueInfrastructureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MergeQueueInfrastructureError";
  }
}

export class MergeQueueAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeQueueAuthorityError";
  }
}

export class MergeQueueRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeQueueRetryError";
  }
}

class ForeignQueuePrefixError extends Error {
  constructor() {
    super(
      "The signed cumulative merge-group contains a queue entry outside the sealed Briar cohort",
    );
    this.name = "ForeignQueuePrefixError";
  }
}

const runLocalCommand: MergeQueueCommandRunner = (command, options) => {
  if (command.length === 0) {
    throw new MergeQueueInfrastructureError("Local command argv is empty");
  }
  const result = spawnSync(command[0], command.slice(1), {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    shell: false,
    timeout: options.timeoutMs,
    windowsHide: true,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
};

const localCredentialEnvironment = () => ({
  ...process.env,
  GH_PROMPT_DISABLED: "1",
  GIT_TERMINAL_PROMPT: "0",
});

const localOptions = (cwd: string, timeoutMs = 30_000) => ({
  cwd,
  timeoutMs,
  env: localCredentialEnvironment(),
});

const GitObjectId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}$/u),
);
const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
const GraphQlError = Schema.Struct({ message: Schema.String });
const GraphQlErrors = Schema.optional(Schema.mutable(Schema.Array(GraphQlError)));

const QueueEntrySchema = Schema.Struct({
  id: Schema.NonEmptyString,
  state: Schema.String,
  pullRequest: Schema.Struct({
    id: Schema.NonEmptyString,
    databaseId: PositiveInteger,
    number: PositiveInteger,
    headRefOid: GitObjectId,
    baseRefName: Schema.String,
    baseRefOid: GitObjectId,
  }),
});
export type MergeQueueEntry = typeof QueueEntrySchema.Type;

const PullRequestSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  databaseId: PositiveInteger,
  number: PositiveInteger,
  state: Schema.String,
  isDraft: Schema.Boolean,
  headRefOid: GitObjectId,
  baseRefName: Schema.String,
  baseRefOid: GitObjectId,
  mergeQueueEntry: Schema.NullOr(Schema.Struct({
    id: Schema.NonEmptyString,
    state: Schema.String,
  })),
});

const RepositoryIdentity = {
  databaseId: PositiveInteger,
  nameWithOwner: Schema.NonEmptyString,
} as const;

const PullRequestQueryResponse = Schema.Struct({
  data: Schema.NullOr(Schema.Struct({
    repository: Schema.NullOr(Schema.Struct({
      ...RepositoryIdentity,
      pullRequest: Schema.NullOr(PullRequestSchema),
    })),
  })),
  errors: GraphQlErrors,
});
const decodePullRequestQueryResponse = Schema.decodeUnknownSync(
  PullRequestQueryResponse,
);

const EnqueueMutationResponse = Schema.Struct({
  data: Schema.NullOr(Schema.Struct({
    enqueuePullRequest: Schema.NullOr(Schema.Struct({
      mergeQueueEntry: Schema.NullOr(QueueEntrySchema),
    })),
  })),
  errors: GraphQlErrors,
});
const decodeEnqueueMutationResponse = Schema.decodeUnknownSync(
  EnqueueMutationResponse,
);

const DequeueMutationResponse = Schema.Struct({
  data: Schema.NullOr(Schema.Struct({
    dequeuePullRequest: Schema.NullOr(Schema.Struct({
      clientMutationId: Schema.optional(Schema.NullOr(Schema.String)),
    })),
  })),
  errors: GraphQlErrors,
});
const decodeDequeueMutationResponse = Schema.decodeUnknownSync(
  DequeueMutationResponse,
);

const MergeQueuePageResponse = Schema.Struct({
  data: Schema.NullOr(Schema.Struct({
    repository: Schema.NullOr(Schema.Struct({
      ...RepositoryIdentity,
      mergeQueue: Schema.NullOr(Schema.Struct({
        entries: Schema.Struct({
          nodes: Schema.mutable(Schema.Array(QueueEntrySchema)),
          pageInfo: Schema.Struct({
            hasNextPage: Schema.Boolean,
            endCursor: Schema.NullOr(Schema.String),
          }),
        }),
      })),
    })),
  })),
  errors: GraphQlErrors,
});
const decodeMergeQueuePageResponse = Schema.decodeUnknownSync(
  MergeQueuePageResponse,
);

const MergeBatchClaimResponse = Schema.Struct({
  work: Schema.NullOr(Schema.Unknown),
  retryAfterMs: Schema.optional(Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
  )),
});
const decodeMergeBatchClaimResponse = Schema.decodeUnknownSync(
  MergeBatchClaimResponse,
);

const PULL_REQUEST_QUERY = `query BriarMergePullRequest(
  $owner: String!, $name: String!, $number: Int!
) {
  repository(owner: $owner, name: $name) {
    databaseId
    nameWithOwner
    pullRequest(number: $number) {
      id
      databaseId
      number
      state
      isDraft
      headRefOid
      baseRefName
      baseRefOid
      mergeQueueEntry { id state }
    }
  }
}`;

const ENQUEUE_PULL_REQUEST_MUTATION = `mutation BriarEnqueuePullRequest(
  $pullRequestId: ID!, $expectedHeadOid: GitObjectID!
) {
  enqueuePullRequest(input: {
    pullRequestId: $pullRequestId,
    expectedHeadOid: $expectedHeadOid,
    jump: false
  }) {
    mergeQueueEntry {
      id
      state
      pullRequest {
        id
        databaseId
        number
        headRefOid
        baseRefName
        baseRefOid
      }
    }
  }
}`;

const DEQUEUE_PULL_REQUEST_MUTATION = `mutation BriarDequeuePullRequest(
  $pullRequestId: ID!
) {
  dequeuePullRequest(input: { pullRequestId: $pullRequestId }) {
    clientMutationId
  }
}`;

const MERGE_QUEUE_PAGE_QUERY = `query BriarMergeQueuePage(
  $owner: String!, $name: String!, $branch: String!, $cursor: String
) {
  repository(owner: $owner, name: $name) {
    databaseId
    nameWithOwner
    mergeQueue(branch: $branch) {
      entries(first: 100, after: $cursor) {
        nodes {
          id
          state
          pullRequest {
            id
            databaseId
            number
            headRefOid
            baseRefName
            baseRefOid
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

type GraphQlVariable = readonly [string, string | number | boolean | null];

function repositoryTarget(repository: string) {
  const match = repository.match(
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u,
  );
  if (!match) {
    throw new MergeQueueAuthorityError(
      "Merge batch repository must be an exact owner/name",
    );
  }
  return { owner: match[1], name: match[2] };
}

function commandFailure(name: string, result: MergeQueueCommandResult): never {
  throw new MergeQueueInfrastructureError(
    `${name} failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`,
  );
}

function runGraphQl<T>(
  repositoryPath: string,
  query: string,
  variables: readonly GraphQlVariable[],
  decode: (input: unknown) => T,
  run: MergeQueueCommandRunner,
  name: string,
): T {
  const command = ["gh", "api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of variables) {
    if (value === null) continue;
    command.push(
      typeof value === "string" ? "-f" : "-F",
      `${key}=${String(value)}`,
    );
  }
  const result = run(command, localOptions(repositoryPath));
  if (result.exitCode !== 0) commandFailure(name, result);
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (cause) {
    throw new MergeQueueInfrastructureError(
      `${name} returned invalid JSON`,
      { cause },
    );
  }
  try {
    return decode(parsed);
  } catch (cause) {
    throw new MergeQueueInfrastructureError(
      `${name} returned an invalid response`,
      { cause },
    );
  }
}

function assertNoGraphQlErrors(
  errors: readonly { readonly message: string }[] | undefined,
  name: string,
) {
  if (!errors || errors.length === 0) return;
  throw new MergeQueueInfrastructureError(
    `${name} was rejected: ${errors.map((error) => error.message).join("; ").slice(0, 1_000)}`,
  );
}

function assertRepositoryIdentity(
  repository: { readonly databaseId: number; readonly nameWithOwner: string },
  claim: Pick<ClaimedMergeBatch, "repository" | "repositoryId">,
) {
  if (
    repository.databaseId !== claim.repositoryId ||
    repository.nameWithOwner.toLowerCase() !== claim.repository.toLowerCase()
  ) {
    throw new MergeQueueAuthorityError(
      "GitHub repository identity does not match the sealed merge batch",
    );
  }
}

type MergeBatchMember = ClaimedMergeBatch["members"][number];

function assertPullRequestIdentity(
  pullRequest: typeof PullRequestSchema.Type,
  member: MergeBatchMember,
) {
  if (
    pullRequest.id !== member.pullRequestNodeId ||
    pullRequest.databaseId !== member.pullRequestId ||
    pullRequest.number !== member.pullRequestNumber ||
    pullRequest.headRefOid !== member.headSha ||
    pullRequest.baseRefName !== "main" ||
    pullRequest.state !== "OPEN" ||
    pullRequest.isDraft
  ) {
    throw new MergeQueueAuthorityError(
      `Pull request #${member.pullRequestNumber} no longer matches its sealed OPEN, non-draft identity`,
    );
  }
}

function inspectPullRequest(
  claim: ClaimedMergeBatch,
  member: MergeBatchMember,
  repositoryPath: string,
  run: MergeQueueCommandRunner,
) {
  const target = repositoryTarget(claim.repository);
  const response = runGraphQl(
    repositoryPath,
    PULL_REQUEST_QUERY,
    [
      ["owner", target.owner],
      ["name", target.name],
      ["number", member.pullRequestNumber],
    ],
    decodePullRequestQueryResponse,
    run,
    `GitHub pull request #${member.pullRequestNumber} readback`,
  );
  assertNoGraphQlErrors(response.errors,
    `GitHub pull request #${member.pullRequestNumber} readback`);
  const repository = response.data?.repository;
  const pullRequest = repository?.pullRequest;
  if (!repository || !pullRequest) {
    throw new MergeQueueAuthorityError(
      `Pull request #${member.pullRequestNumber} does not exist`,
    );
  }
  assertRepositoryIdentity(repository, claim);
  assertPullRequestIdentity(pullRequest, member);
  return pullRequest;
}

function commonClaimBody(
  claim: ClaimedMergeBatch,
  workerId: string,
) {
  return {
    projectId: claim.projectId,
    workerId,
    claimToken: claim.claimToken,
  };
}

async function postClaimAction<T>(
  api: MergeBatchApi,
  claim: ClaimedMergeBatch,
  action: string,
  body: Readonly<Record<string, unknown>>,
) {
  return api<T>(`/merge-batch-claims/${claim.workId}/${action}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function claimMergeBatchIfReady(input: {
  api: MergeBatchApi;
  projectId: string;
  workerId: string;
  claimedBy: string;
  repliesOnly: boolean;
  runtime: MergeGroupContainerRuntime | null;
}): Promise<ClaimedMergeBatch | null> {
  if (input.repliesOnly || input.runtime === null) return null;
  const raw = await input.api<unknown>("/merge-batch-claims", {
    method: "POST",
    body: JSON.stringify({
      projectId: input.projectId,
      workerId: input.workerId,
      claimedBy: input.claimedBy,
    }),
  });
  let response: typeof MergeBatchClaimResponse.Type;
  try {
    response = decodeMergeBatchClaimResponse(raw);
  } catch (cause) {
    throw new MergeQueueInfrastructureError(
      "Merge batch claim response was invalid",
      { cause },
    );
  }
  return response.work === null ? null : decodeClaimedMergeBatch(response.work);
}

export async function renewMergeBatchClaim(
  api: MergeBatchApi,
  claim: ClaimedMergeBatch,
  workerId: string,
) {
  await postClaimAction(
    api,
    claim,
    "lease",
    commonClaimBody(claim, workerId),
  );
}

export async function releaseMergeBatchClaim(
  api: MergeBatchApi,
  claim: ClaimedMergeBatch,
  workerId: string,
) {
  await postClaimAction(
    api,
    claim,
    "release",
    commonClaimBody(claim, workerId),
  );
}

async function enqueueMember(
  input: NormalizedMergeBatchExecutionInput,
  member: MergeBatchMember,
) {
  const before = inspectPullRequest(
    input.claim,
    member,
    input.repositoryPath,
    input.runCommand,
  );
  let queueEntryId = before.mergeQueueEntry?.id ?? null;
  if (
    member.queueEntryId !== null && queueEntryId !== null &&
    member.queueEntryId !== queueEntryId
  ) {
    throw new MergeQueueAuthorityError(
      `Pull request #${member.pullRequestNumber} is in a different merge-queue entry`,
    );
  }

  if (queueEntryId === null) {
    const response = runGraphQl(
      input.repositoryPath,
      ENQUEUE_PULL_REQUEST_MUTATION,
      [
        ["pullRequestId", member.pullRequestNodeId],
        ["expectedHeadOid", member.headSha],
      ],
      decodeEnqueueMutationResponse,
      input.runCommand,
      `GitHub enqueue for pull request #${member.pullRequestNumber}`,
    );
    assertNoGraphQlErrors(
      response.errors,
      `GitHub enqueue for pull request #${member.pullRequestNumber}`,
    );
    const entry = response.data?.enqueuePullRequest?.mergeQueueEntry;
    if (!entry) {
      throw new MergeQueueAuthorityError(
        `GitHub did not return a merge-queue entry for pull request #${member.pullRequestNumber}`,
      );
    }
    if (
      entry.pullRequest.id !== member.pullRequestNodeId ||
      entry.pullRequest.databaseId !== member.pullRequestId ||
      entry.pullRequest.number !== member.pullRequestNumber ||
      entry.pullRequest.headRefOid !== member.headSha ||
      entry.pullRequest.baseRefName !== "main"
    ) {
      throw new MergeQueueAuthorityError(
        `GitHub enqueue result did not preserve pull request #${member.pullRequestNumber} identity`,
      );
    }
    queueEntryId = entry.id;
  }

  const after = inspectPullRequest(
    input.claim,
    member,
    input.repositoryPath,
    input.runCommand,
  );
  if (!after.mergeQueueEntry || after.mergeQueueEntry.id !== queueEntryId) {
    throw new MergeQueueAuthorityError(
      `Pull request #${member.pullRequestNumber} enqueue readback did not match`,
    );
  }
  await postClaimAction(
    input.api,
    input.claim,
    "enqueued",
    {
      ...commonClaimBody(input.claim, input.workerId),
      candidateId: member.id,
      expectedHeadSha: member.headSha,
      expectedBaseSha: member.baseSha,
      queueEntryId,
    },
  );
}

async function enqueueMergeBatch(input: NormalizedMergeBatchExecutionInput) {
  for (const member of input.claim.members) {
    if (input.signal.aborted) throw input.signal.reason;
    if (member.state !== "frozen" && member.state !== "enqueued") {
      throw new MergeQueueAuthorityError(
        `Merge batch member #${member.pullRequestNumber} is not enqueueable`,
      );
    }
    await enqueueMember(input, member);
  }
}

export async function listCompleteMergeQueue(
  claim: ClaimedMergeBatch,
  repositoryPath: string,
  run: MergeQueueCommandRunner = runLocalCommand,
): Promise<MergeQueueEntry[]> {
  const target = repositoryTarget(claim.repository);
  const entries: MergeQueueEntry[] = [];
  const cursors = new Set<string>();
  const entryIds = new Set<string>();
  let cursor: string | null = null;
  do {
    const response: typeof MergeQueuePageResponse.Type = runGraphQl(
      repositoryPath,
      MERGE_QUEUE_PAGE_QUERY,
      [
        ["owner", target.owner],
        ["name", target.name],
        ["branch", "main"],
        ["cursor", cursor],
      ],
      decodeMergeQueuePageResponse,
      run,
      "GitHub merge queue pagination",
    );
    assertNoGraphQlErrors(response.errors, "GitHub merge queue pagination");
    const repository: NonNullable<
      NonNullable<typeof response.data>["repository"]
    > | null | undefined = response.data?.repository;
    const connection: NonNullable<
      NonNullable<typeof repository>["mergeQueue"]
    >["entries"] | null | undefined = repository?.mergeQueue?.entries;
    if (!repository || !connection) {
      throw new MergeQueueAuthorityError(
        "GitHub merge queue for protected branch main was not available",
      );
    }
    assertRepositoryIdentity(repository, claim);
    for (const entry of connection.nodes) {
      if (entryIds.has(entry.id)) {
        throw new MergeQueueAuthorityError(
          `GitHub merge queue repeated entry ${entry.id} across pages`,
        );
      }
      entryIds.add(entry.id);
      entries.push(entry);
    }
    if (!connection.pageInfo.hasNextPage) return entries;
    const next: string | null = connection.pageInfo.endCursor;
    if (!next || cursors.has(next)) {
      throw new MergeQueueInfrastructureError(
        "GitHub merge queue pagination did not advance its cursor",
      );
    }
    cursors.add(next);
    cursor = next;
  } while (true);
}

export function exactAwaitingChecksWindow(
  claim: ClaimedMergeBatch,
  entries: readonly MergeQueueEntry[],
): MergeQueueEntry[] | null {
  const memberCount = claim.members.length;
  if (entries.length < memberCount) return null;
  // A signed merge-group head is cumulative from the front of the lane
  // through its tail PR. Accepting an arbitrary matching subwindow would let
  // an unrelated earlier entry ride inside the signed head while Briar sends
  // only its truncated cohort to the server. The sealed members must therefore
  // be the exact authoritative queue prefix ending at the signed tail.
  const window = entries.slice(0, memberCount);
  const exact = window.every((entry, index) => {
    const member = claim.members[index];
    return member.queueEntryId !== null &&
      entry.state === "AWAITING_CHECKS" &&
      entry.id === member.queueEntryId &&
      entry.pullRequest.number === member.pullRequestNumber &&
      entry.pullRequest.headRefOid === member.headSha;
  });
  return exact ? window : null;
}

function sealedCohortStart(
  claim: ClaimedMergeBatch,
  entries: readonly MergeQueueEntry[],
) {
  for (let start = 0; start <= entries.length - claim.members.length; start += 1) {
    if (claim.members.every((member, index) => {
      const entry = entries[start + index];
      return member.queueEntryId !== null &&
        entry.state === "AWAITING_CHECKS" &&
        entry.id === member.queueEntryId &&
        entry.pullRequest.number === member.pullRequestNumber &&
        entry.pullRequest.headRefOid === member.headSha;
    })) return start;
  }
  return -1;
}

export function readRemoteRefs(
  repositoryPath: string,
  refs: readonly string[],
  run: MergeQueueCommandRunner = runLocalCommand,
) {
  const uniqueRefs = [...new Set(refs)];
  const result = run(
    ["git", "ls-remote", "--refs", "origin", ...uniqueRefs],
    localOptions(repositoryPath),
  );
  if (result.exitCode !== 0) commandFailure("Git remote ref inspection", result);
  const requested = new Set(uniqueRefs);
  const resolved = new Map<string, string>();
  for (const line of result.stdout.split("\n")) {
    if (line.length === 0) continue;
    const match = line.match(/^([0-9a-f]{40})\t(.+)$/u);
    if (!match || !requested.has(match[2])) {
      throw new MergeQueueInfrastructureError(
        "Git remote ref inspection returned an unexpected record",
      );
    }
    if (resolved.has(match[2]) && resolved.get(match[2]) !== match[1]) {
      throw new MergeQueueAuthorityError(
        `Remote ref ${match[2]} resolved ambiguously`,
      );
    }
    resolved.set(match[2], match[1]);
  }
  return resolved;
}

export type TailAuthoritySelection = {
  head: ClaimedMergeBatch["pendingHeads"][number];
  authorityEntries: Array<{
    queueEntryId: string;
    pullRequestNumber: number;
  }>;
};

export function selectTailAuthority(
  claim: ClaimedMergeBatch,
  entries: readonly MergeQueueEntry[],
  remoteRefs: ReadonlyMap<string, string>,
): TailAuthoritySelection | null {
  const window = exactAwaitingChecksWindow(claim, entries);
  if (!window) return null;
  const tailPullRequestNumber = claim.members.at(-1)!.pullRequestNumber;
  const protectedBase = remoteRefs.get("refs/heads/main");
  const heads = claim.pendingHeads
    .filter((head) => head.tailPullRequestNumber === tailPullRequestNumber)
    .sort((left, right) =>
      right.receivedAt.localeCompare(left.receivedAt) ||
      right.deliveryId.localeCompare(left.deliveryId)
    );
  const head = heads.find((candidate) =>
    protectedBase === candidate.baseSha &&
    remoteRefs.get(candidate.headRef) === candidate.headSha
  );
  if (!head) return null;
  return {
    head,
    authorityEntries: window.map((entry) => ({
      queueEntryId: entry.id,
      pullRequestNumber: entry.pullRequest.number,
    })),
  };
}

async function establishTailAuthority(input: NormalizedMergeBatchExecutionInput) {
  const entries = await listCompleteMergeQueue(
    input.claim,
    input.repositoryPath,
    input.runCommand,
  );
  const finalNumber = input.claim.members.at(-1)!.pullRequestNumber;
  const finalHeads = input.claim.pendingHeads.filter((head) =>
    head.tailPullRequestNumber === finalNumber
  );
  if (finalHeads.length === 0) {
    // Signed intermediate deliveries are deliberately neutral. A later signed
    // cumulative delivery will make this batch claimable again.
    throw new MergeQueueRetryError(
      "No signed merge-group delivery represents the final batch member yet",
    );
  }
  const remoteRefs = readRemoteRefs(
    input.repositoryPath,
    ["refs/heads/main", ...finalHeads.map((head) => head.headRef)],
    input.runCommand,
  );
  const selected = selectTailAuthority(input.claim, entries, remoteRefs);
  if (!selected) {
    if (!exactAwaitingChecksWindow(input.claim, entries)) {
      if (sealedCohortStart(input.claim, entries) > 0) {
        throw new ForeignQueuePrefixError();
      }
      throw new MergeQueueRetryError(
        "The exact consecutive merge-queue cohort is not awaiting checks yet",
      );
    }
    throw new MergeQueueAuthorityError(
      "No final signed delivery matched the live exact queue ref and protected main SHA",
    );
  }
  await postClaimAction(
    input.api,
    input.claim,
    "authority",
    {
      ...commonClaimBody(input.claim, input.workerId),
      deliveryId: selected.head.deliveryId,
      authorityEntries: selected.authorityEntries,
    },
  );
}

function runGitCommand(
  run: MergeQueueCommandRunner,
  repositoryPath: string,
  args: readonly string[],
  timeoutMs = 30_000,
) {
  const result = run(
    ["git", ...args],
    localOptions(repositoryPath, timeoutMs),
  );
  if (result.exitCode !== 0) commandFailure(`git ${args[0] ?? "command"}`, result);
  return result.stdout.trim();
}

export function fetchExactValidationRefs(
  claim: ClaimedMergeBatch,
  repositoryPath: string,
  run: MergeQueueCommandRunner = runLocalCommand,
) {
  const sourceRef = `${MERGE_GROUP_CI_SOURCE_REF_PREFIX}/${claim.workId}`;
  const protectedBaseRef =
    `${MERGE_GROUP_CI_PROTECTED_BASE_REF_PREFIX}/${claim.workId}`;
  const headRef = claim.batch.mergeGroupRef;
  const headSha = claim.batch.mergeGroupSha;
  const baseSha = claim.batch.mergeGroupBaseSha;
  if (
    !headRef?.startsWith("refs/heads/gh-readonly-queue/main/") ||
    !headSha || !baseSha
  ) {
    throw new MergeQueueAuthorityError(
      "Validation claim does not contain exact signed merge-group authority",
    );
  }
  runGitCommand(
    run,
    repositoryPath,
    [
      "fetch",
      "--no-tags",
      "--force",
      "--no-write-fetch-head",
      "origin",
      `+${headRef}:${sourceRef}`,
      `+refs/heads/main:${protectedBaseRef}`,
    ],
    120_000,
  );
  const fetchedHead = runGitCommand(run, repositoryPath, [
    "rev-parse",
    "--verify",
    `${sourceRef}^{commit}`,
  ]);
  const fetchedBase = runGitCommand(run, repositoryPath, [
    "rev-parse",
    "--verify",
    `${protectedBaseRef}^{commit}`,
  ]);
  if (fetchedHead !== headSha) {
    throw new MergeQueueAuthorityError(
      "The live signed merge-group ref no longer resolves to its claimed SHA",
    );
  }
  if (fetchedBase !== baseSha) {
    throw new MergeQueueAuthorityError(
      "The protected main ref no longer resolves to the signed base SHA",
    );
  }
  return { sourceRef, protectedBaseRef, headSha, baseSha };
}

function validationGitRunner(run: MergeQueueCommandRunner): ValidationGitRunner {
  return (args, options): ValidationCommandResult =>
    run(["git", ...args], {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      env: options.env,
    });
}

const MAX_VALIDATION_LOG_LENGTH = 64 * 1_024;

function boundedValidationLog(log: string) {
  return log.length <= MAX_VALIDATION_LOG_LENGTH
    ? { log, truncated: false }
    : {
        log: log.slice(0, MAX_VALIDATION_LOG_LENGTH),
        truncated: true,
      };
}

function deterministicValidationFailure(
  error: MergeGroupCiDefinitionChangedError | ExactShaValidationInputError,
) {
  const bounded = boundedValidationLog(error.message);
  const logSha256 = createHash("sha256").update(error.message).digest("hex");
  return MERGE_GROUP_CI_CONTEXTS.map((context) => ({
    context,
    passed: false,
    exitCode: 1,
    failureCode: "ci_failed" as const,
    log: bounded.log,
    logSha256,
    logTruncated: bounded.truncated,
  }));
}

async function validateMergeBatch(input: NormalizedMergeBatchExecutionInput) {
  const exact = fetchExactValidationRefs(
    input.claim,
    input.repositoryPath,
    input.runCommand,
  );
  let prepared: Awaited<ReturnType<typeof prepareExactShaValidation>> | null = null;
  let validationResults;
  try {
    prepared = await prepareExactShaValidation(
      validationGitRunner(input.runCommand),
      input.repositoryPath,
      {
        executionId: input.claim.workId,
        sourceRef: exact.sourceRef,
        protectedBaseRef: exact.protectedBaseRef,
        baseSha: exact.baseSha,
        headSha: exact.headSha,
      },
    );
    const results = await runFixedMergeGroupValidation({
      prepared,
      runtime: input.runtime,
      signal: input.signal,
    });
    validationResults = results.map((result) => {
      const bounded = boundedValidationLog(result.log);
      return {
        context: result.context,
        passed: result.passed,
        exitCode: result.exitCode,
        failureCode: result.failureCode,
        log: bounded.log,
        logSha256: result.logSha256,
        logTruncated: result.logTruncated || bounded.truncated,
      };
    });
  } catch (error) {
    if (
      !(error instanceof MergeGroupCiDefinitionChangedError) &&
      !(error instanceof ExactShaValidationInputError)
    ) throw error;
    validationResults = deterministicValidationFailure(error);
  } finally {
    if (prepared) await disposeExactShaValidation(prepared);
  }
  await postClaimAction(
    input.api,
    input.claim,
    "validation",
    {
      ...commonClaimBody(input.claim, input.workerId),
      mergeGroupSha: exact.headSha,
      validationResults,
    },
  );
}

function assertPublishAuthorityValues(claim: ClaimedMergeBatch) {
  const { mergeGroupRef, mergeGroupSha, mergeGroupBaseSha } = claim.batch;
  if (
    !mergeGroupRef?.startsWith("refs/heads/gh-readonly-queue/main/") ||
    !mergeGroupSha || !mergeGroupBaseSha
  ) {
    throw new MergeQueueAuthorityError(
      "Publication claim lacks exact signed merge-group authority",
    );
  }
  return { mergeGroupRef, mergeGroupSha, mergeGroupBaseSha };
}

async function reFencePublication(input: NormalizedMergeBatchExecutionInput) {
  await renewMergeBatchClaim(input.api, input.claim, input.workerId);
  const authority = assertPublishAuthorityValues(input.claim);
  const entries = await listCompleteMergeQueue(
    input.claim,
    input.repositoryPath,
    input.runCommand,
  );
  if (!exactAwaitingChecksWindow(input.claim, entries)) {
    if (sealedCohortStart(input.claim, entries) > 0) {
      throw new ForeignQueuePrefixError();
    }
    throw new MergeQueueAuthorityError(
      "The live merge queue no longer contains the exact consecutive cohort",
    );
  }
  const refs = readRemoteRefs(
    input.repositoryPath,
    [authority.mergeGroupRef, "refs/heads/main"],
    input.runCommand,
  );
  if (refs.get(authority.mergeGroupRef) !== authority.mergeGroupSha) {
    throw new MergeQueueAuthorityError(
      "The live merge-group ref no longer matches the claimed publication SHA",
    );
  }
  if (refs.get("refs/heads/main") !== authority.mergeGroupBaseSha) {
    throw new MergeQueueAuthorityError(
      "Protected main advanced beyond the signed publication base SHA",
    );
  }
  return authority;
}

function publishStatus(
  input: NormalizedMergeBatchExecutionInput,
  sha: string,
  result: NonNullable<
    ClaimedMergeBatch["batch"]["validationResults"]
  >[number],
) {
  const state = result.passed ? "success" : "failure";
  const context = `signoff/${result.context}`;
  const description = result.passed
    ? `Briar exact merge-group validation passed: ${result.context}`
    : `Briar exact merge-group validation failed: ${result.context}`;
  const command = [
    "gh",
    "api",
    `repos/${input.claim.repository}/statuses/${sha}`,
    "--method",
    "POST",
    "-f",
    `state=${state}`,
    "-f",
    `context=${context}`,
    "-f",
    `description=${description}`,
  ];
  const published = input.runCommand(
    command,
    localOptions(input.repositoryPath),
  );
  if (published.exitCode !== 0) {
    commandFailure(`GitHub status ${context}`, published);
  }
}

async function publishMergeBatch(input: NormalizedMergeBatchExecutionInput) {
  const proof = input.claim.batch.validationResults;
  if (!proof) {
    throw new MergeQueueAuthorityError(
      "Publication claim is missing its durable validation proof",
    );
  }
  const byContext = new Map<MergeGroupCiContext, typeof proof[number]>();
  for (const result of proof) byContext.set(result.context, result);
  const failed = proof.some((result) => !result.passed);
  for (const context of MERGE_GROUP_CI_CONTEXTS) {
    if (input.signal.aborted) throw input.signal.reason;
    const result = byContext.get(context);
    if (!result) {
      throw new MergeQueueAuthorityError(
        `Publication proof is missing ${context}`,
      );
    }
    // GitHub may remove a merge-group ref as soon as the first required
    // failure is published. A failed durable proof is already safe to replay
    // against its immutable SHA: it can never make a replacement head green.
    // Keep the lease live before every status, while retaining the stronger
    // queue/ref/main fence for an all-success proof.
    let authority: ReturnType<typeof assertPublishAuthorityValues>;
    if (failed) {
      await renewMergeBatchClaim(input.api, input.claim, input.workerId);
      authority = assertPublishAuthorityValues(input.claim);
    } else {
      authority = await reFencePublication(input);
    }
    publishStatus(input, authority.mergeGroupSha, result);
  }
  const authority = assertPublishAuthorityValues(input.claim);
  await postClaimAction(
    input.api,
    input.claim,
    "published",
    {
      ...commonClaimBody(input.claim, input.workerId),
      mergeGroupSha: authority.mergeGroupSha,
    },
  );
}

function dequeuePullRequest(
  input: NormalizedMergeBatchExecutionInput,
  member: MergeBatchMember,
) {
  const before = inspectPullRequest(
    input.claim,
    member,
    input.repositoryPath,
    input.runCommand,
  );
  if (!before.mergeQueueEntry) return;
  if (
    member.queueEntryId === null ||
    before.mergeQueueEntry.id !== member.queueEntryId
  ) {
    throw new MergeQueueAuthorityError(
      `Refusing to dequeue pull request #${member.pullRequestNumber} from an unsealed queue entry`,
    );
  }
  const response = runGraphQl(
    input.repositoryPath,
    DEQUEUE_PULL_REQUEST_MUTATION,
    [["pullRequestId", member.pullRequestNodeId]],
    decodeDequeueMutationResponse,
    input.runCommand,
    `GitHub dequeue for pull request #${member.pullRequestNumber}`,
  );
  assertNoGraphQlErrors(
    response.errors,
    `GitHub dequeue for pull request #${member.pullRequestNumber}`,
  );
  if (!response.data?.dequeuePullRequest) {
    throw new MergeQueueAuthorityError(
      `GitHub did not acknowledge dequeue for pull request #${member.pullRequestNumber}`,
    );
  }
  const after = inspectPullRequest(
    input.claim,
    member,
    input.repositoryPath,
    input.runCommand,
  );
  if (after.mergeQueueEntry !== null) {
    throw new MergeQueueAuthorityError(
      `Pull request #${member.pullRequestNumber} remained queued after dequeue`,
    );
  }
}

function blockCode(claim: ClaimedMergeBatch) {
  const code = claim.batch.failureCode?.trim() ?? "";
  return /^[a-z][a-z0-9_]{0,63}$/u.test(code)
    ? code
    : "merge_batch_drained";
}

function blockDetail(claim: ClaimedMergeBatch) {
  const detail = claim.batch.failureDetail?.trim() ?? "";
  return (detail || "The merge batch was drained without publication")
    .slice(0, 4_000);
}

async function drainMergeBatch(
  input: NormalizedMergeBatchExecutionInput,
  failure?: { code: string; detail: string },
) {
  for (const member of input.claim.members) {
    if (input.signal.aborted) throw input.signal.reason;
    if (member.state === "merged" || member.state === "dequeued") continue;
    dequeuePullRequest(input, member);
  }
  await postClaimAction(
    input.api,
    input.claim,
    "block",
    {
      ...commonClaimBody(input.claim, input.workerId),
      code: failure?.code ?? blockCode(input.claim),
      detail: (failure?.detail ?? blockDetail(input.claim)).slice(0, 4_000),
    },
  );
}

export type MergeBatchExecutionInput = {
  claim: ClaimedMergeBatch;
  workerId: string;
  repositoryPath: string;
  runtime: MergeGroupContainerRuntime;
  signal: AbortSignal;
  api: MergeBatchApi;
  runCommand?: MergeQueueCommandRunner;
};

type NormalizedMergeBatchExecutionInput = Omit<
  MergeBatchExecutionInput,
  "runCommand"
> & { runCommand: MergeQueueCommandRunner };

export async function executeClaimedMergeBatch(
  rawInput: MergeBatchExecutionInput,
) {
  const input = {
    ...rawInput,
    runCommand: rawInput.runCommand ?? runLocalCommand,
  } as NormalizedMergeBatchExecutionInput;
  try {
    switch (input.claim.phase) {
      case "enqueue":
        await enqueueMergeBatch(input);
        await releaseMergeBatchClaim(input.api, input.claim, input.workerId);
        return;
      case "tail_authority":
        await establishTailAuthority(input);
        await releaseMergeBatchClaim(input.api, input.claim, input.workerId);
        return;
      case "validate":
        await validateMergeBatch(input);
        await releaseMergeBatchClaim(input.api, input.claim, input.workerId);
        return;
      case "publish":
        await publishMergeBatch(input);
        return;
      case "drain":
        await drainMergeBatch(input);
        return;
    }
  } catch (error) {
    // A planned update uses the Worker loop's dedicated release handoff. It
    // must not race this retry release with a second protocol.
    if (input.signal.aborted) throw error;
    if (error instanceof ForeignQueuePrefixError) {
      try {
        await drainMergeBatch(input, {
          code: "foreign_queue_prefix",
          detail: error.message,
        });
        return;
      } catch (drainError) {
        try {
          await releaseMergeBatchClaim(input.api, input.claim, input.workerId);
        } catch (releaseError) {
          throw new AggregateError(
            [error, drainError, releaseError],
            "Foreign merge-queue membership could not be drained, blocked, or released",
          );
        }
        throw new AggregateError(
          [error, drainError],
          "Foreign merge-queue membership could not be drained and blocked",
        );
      }
    }
    try {
      await releaseMergeBatchClaim(input.api, input.claim, input.workerId);
    } catch (releaseError) {
      throw new AggregateError(
        [error, releaseError],
        "Merge batch execution failed and its lease could not be released",
      );
    }
    throw error;
  }
}

const MergeQueueProfileSchema = Schema.Struct({
  projectId: Schema.String.check(Schema.isUUID()),
  repositoryId: PositiveInteger,
  repository: Schema.String.check(
    Schema.isPattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u),
  ),
  baseBranch: Schema.Literal("main"),
  enabled: Schema.Boolean,
  quietWindowMs: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(1_000),
    Schema.isLessThanOrEqualTo(300_000),
  ),
  maxBatchSize: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(5),
  ),
  updatedAt: Schema.String,
});

export type MergeQueueProfile = typeof MergeQueueProfileSchema.Type;

const MergeQueueProfileResponse = Schema.Struct({
  profile: Schema.NullOr(MergeQueueProfileSchema),
});
const decodeMergeQueueProfileResponse = Schema.decodeUnknownSync(
  MergeQueueProfileResponse,
);

export function mergeQueueProfileFromResponse(input: unknown) {
  return decodeMergeQueueProfileResponse(input).profile;
}

const GithubRepositoryResponse = Schema.Struct({
  id: PositiveInteger,
  full_name: Schema.NonEmptyString,
  default_branch: Schema.String,
});
const decodeGithubRepositoryResponse = Schema.decodeUnknownSync(
  GithubRepositoryResponse,
);

const EffectiveRuleSchema = Schema.Struct({
  type: Schema.NonEmptyString,
  ruleset_id: PositiveInteger,
  parameters: Schema.optional(Schema.Unknown),
});
type EffectiveRule = typeof EffectiveRuleSchema.Type;
const EffectiveRulePages = Schema.mutable(Schema.Array(
  Schema.mutable(Schema.Array(EffectiveRuleSchema)),
));
const decodeEffectiveRulePages = Schema.decodeUnknownSync(EffectiveRulePages);

const DetailedRulesetSchema = Schema.Struct({
  id: PositiveInteger,
  target: Schema.String,
  enforcement: Schema.String,
  bypass_actors: Schema.mutable(Schema.Array(Schema.Unknown)),
  conditions: Schema.Struct({
    ref_name: Schema.Struct({
      include: Schema.mutable(Schema.Array(Schema.String)),
      exclude: Schema.mutable(Schema.Array(Schema.String)),
    }),
  }),
});
const decodeDetailedRuleset = Schema.decodeUnknownSync(DetailedRulesetSchema);

const MergeQueueRuleParameters = Schema.Struct({
  grouping_strategy: Schema.String,
  max_entries_to_build: PositiveInteger,
  max_entries_to_merge: PositiveInteger,
  merge_method: Schema.String,
});
const decodeMergeQueueRuleParameters = Schema.decodeUnknownSync(
  MergeQueueRuleParameters,
);

const RequiredStatusChecksParameters = Schema.Struct({
  required_status_checks: Schema.mutable(Schema.Array(Schema.Struct({
    context: Schema.NonEmptyString,
    integration_id: Schema.optional(Schema.NullOr(PositiveInteger)),
  }))),
  strict_required_status_checks_policy: Schema.Boolean,
});
const decodeRequiredStatusChecksParameters = Schema.decodeUnknownSync(
  RequiredStatusChecksParameters,
);

export type MergeQueueDoctorCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type MergeQueueDoctorResult = {
  ok: boolean;
  checks: MergeQueueDoctorCheck[];
};

function decodeCommandJson<T>(
  result: MergeQueueCommandResult,
  decode: (input: unknown) => T,
  name: string,
) {
  if (result.exitCode !== 0) commandFailure(name, result);
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (cause) {
    throw new MergeQueueInfrastructureError(`${name} returned invalid JSON`, {
      cause,
    });
  }
  try {
    return decode(parsed);
  } catch (cause) {
    throw new MergeQueueInfrastructureError(
      `${name} returned an invalid response`,
      { cause },
    );
  }
}

function githubRemoteRepository(remote: string) {
  const trimmed = remote.trim();
  const scp = trimmed.match(
    /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/u,
  );
  if (scp) return `${scp[1]}/${scp[2]}`.toLowerCase();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (
    url.hostname.toLowerCase() !== "github.com" ||
    !["https:", "ssh:"].includes(url.protocol)
  ) return null;
  const path = url.pathname.replace(/^\//u, "").replace(/\.git$/u, "");
  return /^[^/\s]+\/[^/\s]+$/u.test(path) ? path.toLowerCase() : null;
}

function doctorCheck(
  checks: MergeQueueDoctorCheck[],
  name: string,
  ok: boolean,
  detail: string,
) {
  checks.push({ name, ok, detail });
}

function ruleParameters<T>(
  rule: EffectiveRule,
  decode: (input: unknown) => T,
  name: string,
) {
  try {
    return decode(rule.parameters);
  } catch (cause) {
    throw new MergeQueueInfrastructureError(
      `${name} rule parameters were invalid`,
      { cause },
    );
  }
}

export function inspectMergeQueueDoctor(input: {
  profile: MergeQueueProfile | null;
  repositoryPath: string;
  runtime:
    | ({ ready: true } & MergeGroupContainerRuntime)
    | { ready: false; detail: string };
  runCommand?: MergeQueueCommandRunner;
}): MergeQueueDoctorResult {
  const checks: MergeQueueDoctorCheck[] = [];
  const run = input.runCommand ?? runLocalCommand;
  doctorCheck(
    checks,
    "audited-runtime",
    input.runtime.ready,
    input.runtime.ready
      ? `${input.runtime.executable} ${input.runtime.image}`
      : input.runtime.detail,
  );
  if (!input.profile) {
    doctorCheck(
      checks,
      "profile",
      false,
      "No merge-queue profile is configured for this project",
    );
    return { ok: false, checks };
  }
  doctorCheck(
    checks,
    "profile",
    true,
    input.profile.enabled
      ? `enabled for ${input.profile.repository}/main`
      : `disabled for ${input.profile.repository}/main`,
  );

  const auth = run(
    ["gh", "auth", "status", "--hostname", "github.com"],
    localOptions(input.repositoryPath),
  );
  doctorCheck(
    checks,
    "gh-auth",
    auth.exitCode === 0,
    auth.exitCode === 0
      ? "GitHub CLI authentication is ready"
      : auth.stderr.trim() || "gh auth status failed",
  );

  const remote = run(
    ["git", "remote", "get-url", "origin"],
    localOptions(input.repositoryPath),
  );
  const remoteRepository = remote.exitCode === 0
    ? githubRemoteRepository(remote.stdout)
    : null;
  const remoteMatches = remoteRepository === input.profile.repository.toLowerCase();
  doctorCheck(
    checks,
    "origin-repository",
    remoteMatches,
    remoteMatches
      ? `origin is ${input.profile.repository}`
      : remote.stderr.trim() ||
        `origin does not resolve to ${input.profile.repository}`,
  );

  let githubRepositoryReady = false;
  if (auth.exitCode === 0) {
    try {
      const repository = decodeCommandJson(
        run(
          ["gh", "api", `repos/${input.profile.repository}`],
          localOptions(input.repositoryPath),
        ),
        decodeGithubRepositoryResponse,
        "GitHub repository inspection",
      );
      githubRepositoryReady =
        repository.id === input.profile.repositoryId &&
        repository.full_name.toLowerCase() ===
          input.profile.repository.toLowerCase() &&
        repository.default_branch === "main";
      doctorCheck(
        checks,
        "github-repository",
        githubRepositoryReady,
        githubRepositoryReady
          ? `GitHub repository ${repository.full_name} has exact default branch main`
          : "GitHub repository id, name, or default branch does not match the profile",
      );
    } catch (error) {
      doctorCheck(
        checks,
        "github-repository",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  } else {
    doctorCheck(
      checks,
      "github-repository",
      false,
      "GitHub CLI authentication is unavailable",
    );
  }

  if (!githubRepositoryReady) {
    doctorCheck(
      checks,
      "effective-main-rules",
      false,
      "GitHub repository identity must pass before rules are trusted",
    );
    return { ok: false, checks };
  }

  try {
    const pages = decodeCommandJson(
      run(
        [
          "gh",
          "api",
          "--paginate",
          "--slurp",
          `repos/${input.profile.repository}/rules/branches/main?per_page=100`,
        ],
        localOptions(input.repositoryPath),
      ),
      decodeEffectiveRulePages,
      "GitHub effective main rules inspection",
    );
    const rules = pages.flat();
    const relevantTypes = new Set([
      "merge_queue",
      "pull_request",
      "deletion",
      "non_fast_forward",
      "required_status_checks",
    ]);
    const relevantRules = rules.filter((rule) => relevantTypes.has(rule.type));
    const byType = new Map<string, EffectiveRule[]>();
    for (const rule of relevantRules) {
      const current = byType.get(rule.type) ?? [];
      current.push(rule);
      byType.set(rule.type, current);
    }

    const mergeQueueRules = byType.get("merge_queue") ?? [];
    const mergeQueueParameters = mergeQueueRules.map((rule) =>
      ruleParameters(
        rule,
        decodeMergeQueueRuleParameters,
        "GitHub merge_queue",
      )
    );
    const mergeQueueReady = mergeQueueParameters.length > 0 &&
      mergeQueueParameters.every((parameters) =>
        parameters.grouping_strategy === "HEADGREEN" &&
        parameters.merge_method === "SQUASH" &&
        parameters.max_entries_to_build >= input.profile!.maxBatchSize &&
        parameters.max_entries_to_merge >= input.profile!.maxBatchSize
      );
    doctorCheck(
      checks,
      "merge-queue-rule",
      mergeQueueReady,
      mergeQueueReady
        ? "HEADGREEN/SQUASH capacity covers the configured batch size"
        : "merge_queue must be HEADGREEN/SQUASH with build and merge capacity at least maxBatchSize",
    );

    const protectionsReady = [
      "pull_request",
      "deletion",
      "non_fast_forward",
    ].every((type) => (byType.get(type)?.length ?? 0) > 0);
    doctorCheck(
      checks,
      "main-protections",
      protectionsReady,
      protectionsReady
        ? "pull_request, deletion, and non_fast_forward are effective"
        : "main requires pull_request, deletion, and non_fast_forward rules",
    );

    const statusRules = byType.get("required_status_checks") ?? [];
    const statusParameters = statusRules.map((rule) =>
      ruleParameters(
        rule,
        decodeRequiredStatusChecksParameters,
        "GitHub required_status_checks",
      )
    );
    const contexts = statusParameters.flatMap((parameters) =>
      parameters.required_status_checks.map((check) => check.context)
    );
    const expectedContexts = MERGE_GROUP_CI_CONTEXTS.map((context) =>
      `signoff/${context}`
    );
    const statusReady = statusParameters.length > 0 &&
      statusParameters.every((parameters) =>
        !parameters.strict_required_status_checks_policy &&
        parameters.required_status_checks.every((check) =>
          check.integration_id === undefined || check.integration_id === null
        )
      ) &&
      contexts.length === expectedContexts.length &&
      new Set(contexts).size === expectedContexts.length &&
      expectedContexts.every((context) => contexts.includes(context));
    doctorCheck(
      checks,
      "signoff-contexts",
      statusReady,
      statusReady
        ? "exact four signoff contexts are required with strict=false"
        : "required_status_checks must contain only the four signoff contexts, strict=false, without integration pinning",
    );

    const rulesetIds = [...new Set(
      relevantRules.map((rule) => rule.ruleset_id),
    )];
    const rulesets = rulesetIds.map((rulesetId) =>
      decodeCommandJson(
        run(
          [
            "gh",
            "api",
            `repos/${input.profile!.repository}/rulesets/${rulesetId}?includes_parents=true`,
          ],
          localOptions(input.repositoryPath),
        ),
        decodeDetailedRuleset,
        `GitHub ruleset ${rulesetId} inspection`,
      )
    );
    const rulesetsReady = rulesets.length > 0 && rulesets.every((ruleset) =>
      ruleset.target === "branch" &&
      ruleset.enforcement === "active" &&
      ruleset.bypass_actors.length === 0 &&
      ruleset.conditions.ref_name.include.length === 1 &&
      ruleset.conditions.ref_name.include[0] === "refs/heads/main" &&
      ruleset.conditions.ref_name.exclude.length === 0
    );
    doctorCheck(
      checks,
      "active-no-bypass-rulesets",
      rulesetsReady,
      rulesetsReady
        ? "all effective coordinator rules come from exact-main active rulesets without bypass actors"
        : "effective coordinator rules must come from exact refs/heads/main active rulesets with no bypass actors",
    );
  } catch (error) {
    doctorCheck(
      checks,
      "effective-main-rules",
      false,
      error instanceof Error ? error.message : String(error),
    );
  }

  return { ok: checks.every((check) => check.ok), checks };
}
