import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import {
  MERGE_QUEUE_GITHUB_STATUS_CONTEXT,
  MERGE_QUEUE_VALIDATION_BASE_REF_PREFIX,
  MERGE_QUEUE_VALIDATION_COMMAND_TIMEOUT_MS,
  MERGE_QUEUE_VALIDATION_CONTEXT,
  MERGE_QUEUE_VALIDATION_MAX_COMMANDS,
  MERGE_QUEUE_VALIDATION_SOURCE_REF_PREFIX,
} from "../src/lib/merge-queue-validation-contract";
import type { ClaimedMergeBatch } from "./worker-queue-contract";

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

const RepositoryMergeMethodsResponse = Schema.Struct({
  allow_merge_commit: Schema.Boolean,
  allow_squash_merge: Schema.Boolean,
  allow_rebase_merge: Schema.Boolean,
});
const decodeRepositoryMergeMethodsResponse = Schema.decodeUnknownSync(
  RepositoryMergeMethodsResponse,
);

const PullRequestMergeResponse = Schema.Struct({
  sha: Schema.NullOr(GitObjectId),
  merged: Schema.Boolean,
  message: Schema.String,
});
const decodePullRequestMergeResponse = Schema.decodeUnknownSync(
  PullRequestMergeResponse,
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

const briarGithubCommand = () => ["briar", "github"];

function runGraphQl<T>(
  repositoryPath: string,
  query: string,
  variables: readonly GraphQlVariable[],
  decode: (input: unknown) => T,
  run: MergeQueueCommandRunner,
  name: string,
): T {
  const variableObject = Object.fromEntries(
    variables.filter((entry) => entry[1] !== null),
  );
  const command = [
    ...briarGithubCommand(),
    "graphql",
    "--query",
    query,
    "--variables-json",
    JSON.stringify(variableObject),
  ];
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
  const baseRef = `${MERGE_QUEUE_VALIDATION_BASE_REF_PREFIX}/${input.claim.workId}`;
  const memberRefs = input.claim.members.map((member) =>
    `${MERGE_QUEUE_VALIDATION_SOURCE_REF_PREFIX}/${input.claim.workId}/${member.ordinal}`
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
  const sourceRef = `${MERGE_QUEUE_VALIDATION_SOURCE_REF_PREFIX}/${claim.workId}`;
  const protectedBaseRef =
    `${MERGE_QUEUE_VALIDATION_BASE_REF_PREFIX}/${claim.workId}`;
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

const MAX_VALIDATION_LOG_LENGTH = 64 * 1_024;

function boundedValidationLog(log: string) {
  return log.length <= MAX_VALIDATION_LOG_LENGTH
    ? { log, truncated: false }
    : {
        log: log.slice(0, MAX_VALIDATION_LOG_LENGTH),
        truncated: true,
      };
}

function validationEnvironment(root: string): NodeJS.ProcessEnv {
  const inherited = [
    "PATH",
    "TMPDIR",
    "TEMP",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
  ];
  return Object.fromEntries([
    ["CI", "1"],
    ["HOME", root],
    ...inherited.flatMap((key) =>
      process.env[key] ? [[key, process.env[key]!]] : []
    ),
  ]);
}

function validationShellCommand(command: string) {
  return process.platform === "win32"
    ? [process.env.ComSpec ?? "cmd.exe", "/d", "/s", "/c", command]
    : ["/bin/sh", "-lc", command];
}

async function validateMergeBatch(input: NormalizedMergeBatchExecutionInput) {
  const exact = fetchExactValidationRefs(
    input.claim,
    input.repositoryPath,
    input.runCommand,
  );
  const root = await mkdtemp(join(tmpdir(), "briar-merge-queue-validation."));
  const workspace = join(root, "workspace");
  let combinedLog = "";
  let exitCode = 0;
  try {
    runGitCommand(input.runCommand, root, ["init", "--quiet", workspace]);
    runGitCommand(
      input.runCommand,
      workspace,
      ["fetch", "--no-tags", input.repositoryPath, exact.sourceRef],
      120_000,
    );
    runGitCommand(
      input.runCommand,
      workspace,
      ["checkout", "--detach", exact.headSha],
    );
    for (const command of input.claim.validationCommands) {
      if (input.signal.aborted) throw input.signal.reason;
      const result = input.runCommand(validationShellCommand(command), {
        cwd: workspace,
        timeoutMs: MERGE_QUEUE_VALIDATION_COMMAND_TIMEOUT_MS,
        env: validationEnvironment(root),
      });
      combinedLog += `$ ${command}\n${result.stdout}${result.stderr}`;
      if (result.exitCode !== 0) {
        exitCode = result.exitCode;
        break;
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  const bounded = boundedValidationLog(combinedLog);
  const validationResults = [{
    context: MERGE_QUEUE_VALIDATION_CONTEXT,
    passed: exitCode === 0,
    exitCode,
    failureCode: exitCode === 0 ? null : "ci_failed" as const,
    log: bounded.log,
    logSha256: createHash("sha256").update(combinedLog).digest("hex"),
    logTruncated: bounded.truncated,
  }];
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

function mergedPrefixLength(claim: ClaimedMergeBatch) {
  let merged = 0;
  let foundOpen = false;
  for (const member of claim.members) {
    if (member.state === "merged") {
      if (foundOpen) {
        throw new MergeQueueAuthorityError(
          "Merged batch members are not a contiguous prefix",
        );
      }
      merged += 1;
    } else {
      foundOpen = true;
    }
  }
  return merged;
}

function verifyPublishedPrefix(
  input: NormalizedMergeBatchExecutionInput,
  authority: ReturnType<typeof assertPublishAuthorityValues>,
  mergedCount: number,
) {
  const integrationRef = `${MERGE_QUEUE_VALIDATION_SOURCE_REF_PREFIX}/${input.claim.workId}`;
  const mainRef = `${MERGE_QUEUE_VALIDATION_BASE_REF_PREFIX}/${input.claim.workId}-publication`;
  runGitCommand(
    input.runCommand,
    input.repositoryPath,
    [
      "fetch",
      "--no-tags",
      "--force",
      "--no-write-fetch-head",
      "origin",
      `+${authority.mergeGroupRef}:${integrationRef}`,
      `+refs/heads/main:${mainRef}`,
    ],
    120_000,
  );
  const integrationSha = runGitCommand(input.runCommand, input.repositoryPath, [
    "rev-parse",
    "--verify",
    `${integrationRef}^{commit}`,
  ]);
  if (integrationSha !== authority.mergeGroupSha) {
    throw new MergeQueueAuthorityError(
      "The live integration ref no longer matches the validated SHA",
    );
  }
  const liveMainSha = runGitCommand(input.runCommand, input.repositoryPath, [
    "rev-parse",
    "--verify",
    `${mainRef}^{commit}`,
  ]);
  if (mergedCount === 0 && liveMainSha !== authority.mergeGroupBaseSha) {
    throw new MergeQueueRetryError(
      "Main advanced before the validated batch started merging",
    );
  }
  const remaining = input.claim.members.length - mergedCount;
  const expectedCommit = remaining === 0
    ? integrationRef
    : `${integrationRef}~${remaining}`;
  const expectedTree = runGitCommand(input.runCommand, input.repositoryPath, [
    "rev-parse",
    "--verify",
    `${expectedCommit}^{tree}`,
  ]);
  const liveMainTree = runGitCommand(input.runCommand, input.repositoryPath, [
    "rev-parse",
    "--verify",
    `${mainRef}^{tree}`,
  ]);
  if (liveMainTree !== expectedTree) {
    throw new MergeQueueAuthorityError(
      "Main content does not match the validated merged prefix",
    );
  }
  return liveMainSha;
}

function repositoryMergeMethod(input: NormalizedMergeBatchExecutionInput) {
  const methods = decodeCommandJson(
    input.runCommand(
      [...briarGithubCommand(), "repository"],
      localOptions(input.repositoryPath),
    ),
    decodeRepositoryMergeMethodsResponse,
    "GitHub repository merge-method inspection",
  );
  if (methods.allow_squash_merge) return "squash";
  if (methods.allow_rebase_merge) return "rebase";
  if (methods.allow_merge_commit) return "merge";
  throw new MergeQueueAuthorityError(
    "The repository does not allow a pull-request merge method",
  );
}

async function reFencePublication(input: NormalizedMergeBatchExecutionInput) {
  await input.renewLease();
  const authority = assertPublishAuthorityValues(input.claim);
  const mergedCount = mergedPrefixLength(input.claim);
  for (const member of input.claim.members) {
    if (member.state === "merged") continue;
    inspectPullRequest(
      input.claim,
      member,
      input.repositoryPath,
      input.runCommand,
    );
  }
  verifyPublishedPrefix(input, authority, mergedCount);
  return { ...authority, mergedCount };
}

async function mergeBatchPullRequests(
  input: NormalizedMergeBatchExecutionInput,
  authority: Awaited<ReturnType<typeof reFencePublication>>,
) {
  if (authority.mergedCount === input.claim.members.length) return;
  const mergeMethod = repositoryMergeMethod(input);
  for (
    let index = authority.mergedCount;
    index < input.claim.members.length;
    index += 1
  ) {
    if (input.signal.aborted) throw input.signal.reason;
    await input.renewLease();
    const member = input.claim.members[index];
    inspectPullRequest(
      input.claim,
      member,
      input.repositoryPath,
      input.runCommand,
    );
    const merged = decodeCommandJson(
      input.runCommand(
        [
          ...briarGithubCommand(),
          "pr",
          "merge",
          "--number",
          String(member.pullRequestNumber),
          "--head-sha",
          member.headSha,
          "--method",
          mergeMethod,
        ],
        localOptions(input.repositoryPath, 120_000),
      ),
      decodePullRequestMergeResponse,
      `GitHub pull request #${member.pullRequestNumber} merge`,
    );
    if (!merged.merged || !merged.sha) {
      throw new MergeQueueAuthorityError(
        `GitHub did not merge pull request #${member.pullRequestNumber}: ${merged.message}`,
      );
    }
    const liveMainSha = verifyPublishedPrefix(input, authority, index + 1);
    if (liveMainSha !== merged.sha) {
      throw new MergeQueueRetryError(
        `Main advanced while pull request #${member.pullRequestNumber} was merging`,
      );
    }
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
  const context = MERGE_QUEUE_GITHUB_STATUS_CONTEXT;
  const description = result.passed
    ? `Briar exact integration validation passed: ${result.context}`
    : `Briar exact integration validation failed: ${result.context}`;
  const command = [
    ...briarGithubCommand(),
    "status",
    "--sha",
    sha,
    "--state",
    state,
    "--context",
    context,
    "--description",
    description,
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
  const byContext = new Map<string, typeof proof[number]>();
  for (const result of proof) byContext.set(result.context, result);
  const failed = proof.some((result) => !result.passed);
  const publishProofStatuses = async (
    authority: ReturnType<typeof assertPublishAuthorityValues>,
    renewBeforeEach: boolean,
  ) => {
    for (const context of [MERGE_QUEUE_VALIDATION_CONTEXT]) {
      if (input.signal.aborted) throw input.signal.reason;
      const result = byContext.get(context);
      if (!result) {
        throw new MergeQueueAuthorityError(
          `Publication proof is missing ${context}`,
        );
      }
      if (renewBeforeEach) {
        await input.renewLease();
      }
      publishStatus(input, authority.mergeGroupSha, result);
    }
  };
  if (failed) {
    // A failed durable proof is safe to replay against its immutable SHA: it
    // can never merge a pull request. Keep the lease live before every status.
    const authority = assertPublishAuthorityValues(input.claim);
    await publishProofStatuses(authority, true);
    await postClaimAction(
      input.api,
      input.claim,
      "published",
      {
        ...commonClaimBody(input.claim, input.workerId),
        mergeGroupSha: authority.mergeGroupSha,
      },
    );
    return;
  }
  const authority = await reFencePublication(input);
  await publishProofStatuses(authority, false);
  await mergeBatchPullRequests(input, authority);
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
  signal: AbortSignal;
  api: MergeBatchApi;
  renewLease: () => Promise<void>;
  releaseLease: () => Promise<void>;
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
        await input.releaseLease();
        return;
      case "tail_authority":
        await establishTailAuthority(input);
        await input.releaseLease();
        return;
      case "validate":
        await validateMergeBatch(input);
        await input.releaseLease();
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
      await input.releaseLease();
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
  readinessStageId: Schema.String.check(
    Schema.isPattern(/^[a-z][a-z0-9_-]{0,63}$/u),
  ),
  validationCommands: Schema.mutable(Schema.Array(
    Schema.String.check(Schema.isLengthBetween(1, 500)),
  )).check(Schema.isLengthBetween(1, MERGE_QUEUE_VALIDATION_MAX_COMMANDS)),
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

export function inspectMergeQueueDoctor(input: {
  profile: MergeQueueProfile | null;
  repositoryPath: string;
  runCommand?: MergeQueueCommandRunner;
}): MergeQueueDoctorResult {
  const checks: MergeQueueDoctorCheck[] = [];
  const run = input.runCommand ?? runLocalCommand;
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
  doctorCheck(
    checks,
    "validation-commands",
    input.profile.validationCommands.length > 0,
    input.profile.validationCommands.length > 0
      ? `${input.profile.validationCommands.length} repository workflow command(s)`
      : "The readiness stage has no repository validation commands",
  );

  const auth = run(
    [...briarGithubCommand(), "repository"],
    localOptions(input.repositoryPath),
  );
  doctorCheck(
    checks,
    "github-app",
    auth.exitCode === 0,
    auth.exitCode === 0
      ? "Project-scoped GitHub App access is ready"
      : auth.stderr.trim() || "GitHub App repository access failed",
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
        auth,
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
      "Project-scoped GitHub App access is unavailable",
    );
  }

  return { ok: checks.every((check) => check.ok), checks };
}
