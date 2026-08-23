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

const PullRequestSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  databaseId: PositiveInteger,
  number: PositiveInteger,
  state: Schema.String,
  isDraft: Schema.Boolean,
  headRefOid: GitObjectId,
  baseRefName: Schema.String,
  baseRefOid: GitObjectId,
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
  inspectPullRequest(
    input.claim,
    member,
    input.repositoryPath,
    input.runCommand,
  );
  const queueEntryId = `briar:${input.claim.workId}:${member.ordinal}`;
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

async function establishTailAuthority(input: NormalizedMergeBatchExecutionInput) {
  for (const member of input.claim.members) {
    inspectPullRequest(
      input.claim,
      member,
      input.repositoryPath,
      input.runCommand,
    );
  }
  const integrationRef =
    `refs/heads/briar/merge-queue/${input.claim.workId}`;
  const baseRef = `${MERGE_GROUP_CI_PROTECTED_BASE_REF_PREFIX}/${input.claim.workId}`;
  const memberRefs = input.claim.members.map((member) =>
    `${MERGE_GROUP_CI_SOURCE_REF_PREFIX}/${input.claim.workId}/${member.ordinal}`
  );
  runGitCommand(
    input.runCommand,
    input.repositoryPath,
    [
      "fetch",
      "--no-tags",
      "--force",
      "--no-write-fetch-head",
      "origin",
      `+refs/heads/main:${baseRef}`,
      ...input.claim.members.map((member, index) =>
        `+refs/pull/${member.pullRequestNumber}/head:${memberRefs[index]}`
      ),
    ],
    120_000,
  );
  const baseSha = runGitCommand(input.runCommand, input.repositoryPath, [
    "rev-parse",
    "--verify",
    `${baseRef}^{commit}`,
  ]);
  let integrationSha = baseSha;
  for (const [index, member] of input.claim.members.entries()) {
    const fetchedHead = runGitCommand(input.runCommand, input.repositoryPath, [
      "rev-parse",
      "--verify",
      `${memberRefs[index]}^{commit}`,
    ]);
    if (fetchedHead !== member.headSha) {
      throw new MergeQueueAuthorityError(
        `Pull request #${member.pullRequestNumber} remote head changed during integration`,
      );
    }
    const merged = input.runCommand(
      ["git", "merge-tree", "--write-tree", "--no-messages", integrationSha, fetchedHead],
      localOptions(input.repositoryPath, 120_000),
    );
    if (merged.exitCode !== 0) {
      throw new MergeQueueAuthorityError(
        `Pull request #${member.pullRequestNumber} conflicts with the sealed cohort`,
      );
    }
    const treeSha = merged.stdout.trim().split("\n", 1)[0];
    if (!/^[0-9a-f]{40}$/u.test(treeSha)) {
      throw new MergeQueueInfrastructureError("git merge-tree returned an invalid tree SHA");
    }
    const committed = input.runCommand(
      [
        "git", "commit-tree", treeSha,
        "-p", integrationSha,
        "-p", fetchedHead,
        "-m",
        `Merge pull request #${member.pullRequestNumber} for Briar batch ${input.claim.workId}`,
      ],
      {
        ...localOptions(input.repositoryPath),
        env: {
          ...localCredentialEnvironment(),
          GIT_AUTHOR_NAME: "Briar Merge Queue",
          GIT_AUTHOR_EMAIL: "merge-queue@briar.local",
          GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
          GIT_COMMITTER_NAME: "Briar Merge Queue",
          GIT_COMMITTER_EMAIL: "merge-queue@briar.local",
          GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
        },
      },
    );
    if (committed.exitCode !== 0) commandFailure("git commit-tree", committed);
    integrationSha = committed.stdout.trim();
    if (!/^[0-9a-f]{40}$/u.test(integrationSha)) {
      throw new MergeQueueInfrastructureError("git commit-tree returned an invalid commit SHA");
    }
  }
  const liveRefs = readRemoteRefs(
    input.repositoryPath,
    ["refs/heads/main", integrationRef],
    input.runCommand,
  );
  if (liveRefs.get("refs/heads/main") !== baseSha) {
    throw new MergeQueueRetryError("Protected main advanced while the cohort was assembled");
  }
  const publishedIntegration = liveRefs.get(integrationRef);
  if (publishedIntegration && publishedIntegration !== integrationSha) {
    throw new MergeQueueAuthorityError("The batch integration ref has a foreign SHA");
  }
  if (!publishedIntegration) {
    runGitCommand(input.runCommand, input.repositoryPath, [
      "push",
      `--force-with-lease=${integrationRef}:`,
      "origin",
      `${integrationSha}:${integrationRef}`,
    ], 120_000);
  }
  await postClaimAction(
    input.api,
    input.claim,
    "authority",
    {
      ...commonClaimBody(input.claim, input.workerId),
      integrationRef,
      integrationSha,
      baseSha,
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
    headRef !== `refs/heads/briar/merge-queue/${claim.workId}` ||
    !headSha || !baseSha
  ) {
    throw new MergeQueueAuthorityError(
      "Validation claim does not contain exact prepared integration authority",
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
      "The live integration ref no longer resolves to its claimed SHA",
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
    mergeGroupRef !== `refs/heads/briar/merge-queue/${claim.workId}` ||
    !mergeGroupSha || !mergeGroupBaseSha
  ) {
    throw new MergeQueueAuthorityError(
      "Publication claim lacks exact prepared integration authority",
    );
  }
  return { mergeGroupRef, mergeGroupSha, mergeGroupBaseSha };
}

async function reFencePublication(input: NormalizedMergeBatchExecutionInput) {
  await renewMergeBatchClaim(input.api, input.claim, input.workerId);
  const authority = assertPublishAuthorityValues(input.claim);
  for (const member of input.claim.members) {
    if (member.state === "merged") continue;
    inspectPullRequest(
      input.claim,
      member,
      input.repositoryPath,
      input.runCommand,
    );
  }
  const refs = readRemoteRefs(
    input.repositoryPath,
    [authority.mergeGroupRef, "refs/heads/main"],
    input.runCommand,
  );
  const liveMain = refs.get("refs/heads/main");
  if (
    refs.get(authority.mergeGroupRef) !== authority.mergeGroupSha &&
    liveMain !== authority.mergeGroupSha
  ) {
    throw new MergeQueueAuthorityError(
      "The live integration ref no longer matches the claimed publication SHA",
    );
  }
  if (
    liveMain !== authority.mergeGroupBaseSha &&
    liveMain !== authority.mergeGroupSha
  ) {
    throw new MergeQueueAuthorityError(
      "Protected main advanced beyond the prepared publication base SHA",
    );
  }
  return { ...authority, alreadyPublished: liveMain === authority.mergeGroupSha };
}

function publishIntegrationRef(
  input: NormalizedMergeBatchExecutionInput,
  authority: ReturnType<typeof assertPublishAuthorityValues>,
) {
  const pushed = input.runCommand(
    [
      "git",
      "push",
      `--force-with-lease=refs/heads/main:${authority.mergeGroupBaseSha}`,
      "origin",
      `${authority.mergeGroupSha}:refs/heads/main`,
    ],
    localOptions(input.repositoryPath, 120_000),
  );
  if (pushed.exitCode === 0) return;
  const main = readRemoteRefs(
    input.repositoryPath,
    ["refs/heads/main"],
    input.runCommand,
  ).get("refs/heads/main");
  if (main !== authority.mergeGroupSha) {
    commandFailure("Exact integration publish", pushed);
  }
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
    ? `Briar exact integration validation passed: ${result.context}`
    : `Briar exact integration validation failed: ${result.context}`;
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
  let publicationAuthority: ReturnType<typeof assertPublishAuthorityValues> | null = null;
  let alreadyPublished = false;
  for (const context of MERGE_GROUP_CI_CONTEXTS) {
    if (input.signal.aborted) throw input.signal.reason;
    const result = byContext.get(context);
    if (!result) {
      throw new MergeQueueAuthorityError(
        `Publication proof is missing ${context}`,
      );
    }
    // A failed durable proof is safe to replay against its immutable SHA: it
    // can never publish the integration ref to main. Keep the lease live
    // before every status, while retaining the stronger ref/main fence for an
    // all-success proof.
    let authority: ReturnType<typeof assertPublishAuthorityValues>;
    if (failed) {
      await renewMergeBatchClaim(input.api, input.claim, input.workerId);
      authority = assertPublishAuthorityValues(input.claim);
    } else {
      const fenced = await reFencePublication(input);
      authority = fenced;
      publicationAuthority = fenced;
      alreadyPublished = fenced.alreadyPublished;
    }
    publishStatus(input, authority.mergeGroupSha, result);
  }
  const authority = assertPublishAuthorityValues(input.claim);
  if (!failed && !alreadyPublished) {
    publishIntegrationRef(input, publicationAuthority ?? authority);
  }
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
  bypass_actors: Schema.mutable(Schema.Array(Schema.Struct({
    actor_id: PositiveInteger,
    actor_type: Schema.Literals(["Integration", "Team"]),
    bypass_mode: Schema.Literal("always"),
  }))),
  conditions: Schema.Struct({
    ref_name: Schema.Struct({
      include: Schema.mutable(Schema.Array(Schema.String)),
      exclude: Schema.mutable(Schema.Array(Schema.String)),
    }),
  }),
});
const decodeDetailedRuleset = Schema.decodeUnknownSync(DetailedRulesetSchema);

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
        : "required_status_checks must contain only the four signoff " +
          "contexts, strict=false, without integration pinning",
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
    const publisherActors = new Set(
      rulesets.flatMap((ruleset) =>
        ruleset.bypass_actors.map((actor) =>
          `${actor.actor_type}:${actor.actor_id}`
        )
      ),
    );
    const rulesetsReady = rulesets.length > 0 && publisherActors.size === 1 &&
      rulesets.every((ruleset) =>
        ruleset.target === "branch" &&
        ruleset.enforcement === "active" &&
        ruleset.bypass_actors.length === 1 &&
        ruleset.conditions.ref_name.include.length === 1 &&
        ruleset.conditions.ref_name.include[0] === "refs/heads/main" &&
        ruleset.conditions.ref_name.exclude.length === 0
      );
    doctorCheck(
      checks,
      "active-publisher-bypass-rulesets",
      rulesetsReady,
      rulesetsReady
        ? "all effective coordinator rules come from exact-main active " +
          "rulesets with one publisher bypass actor"
        : "effective coordinator rules must come from exact refs/heads/main " +
          "active rulesets with exactly one publisher bypass actor",
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
