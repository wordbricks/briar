import * as Schema from "effect/Schema";
import type { MergeQueueMember } from "./merge-queue-coordinator";
import { schemaDecodeOptions } from "./schema-codecs";

const encoder = new TextEncoder();

const GitObjectSha = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}$/u),
);
const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
const NonNegativeInteger = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
);
const InstallationTokenResponse = Schema.Struct({
  token: Schema.NonEmptyString,
  expires_at: Schema.NonEmptyString,
});
const GitRefResponse = Schema.Struct({
  object: Schema.Struct({ sha: GitObjectSha }),
});
const MergeQueueTailResponse = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.NullOr(Schema.Struct({
      mergeQueue: Schema.NullOr(Schema.Struct({
        entries: Schema.Struct({
          nodes: Schema.Array(Schema.Struct({
            position: NonNegativeInteger,
            enqueuedAt: Schema.NonEmptyString,
            state: Schema.Literals([
              "QUEUED",
              "AWAITING_CHECKS",
              "MERGEABLE",
              "UNMERGEABLE",
              "LOCKED",
            ]),
            headCommit: Schema.NullOr(Schema.Struct({ oid: GitObjectSha })),
            pullRequest: Schema.NullOr(Schema.Struct({
              number: PositiveInteger,
            })),
          })),
        }),
      })),
    })),
  }),
});
const MergeQueuePageResponse = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.NullOr(Schema.Struct({
      mergeQueue: Schema.NullOr(Schema.Struct({
        entries: Schema.Struct({
          nodes: Schema.Array(Schema.Struct({
            id: Schema.NonEmptyString,
            position: NonNegativeInteger,
            enqueuedAt: Schema.NonEmptyString,
            state: Schema.Literals([
              "QUEUED",
              "AWAITING_CHECKS",
              "MERGEABLE",
              "UNMERGEABLE",
              "LOCKED",
            ]),
            headCommit: Schema.NullOr(Schema.Struct({ oid: GitObjectSha })),
            pullRequest: Schema.NullOr(Schema.Struct({
              id: Schema.NonEmptyString,
              databaseId: PositiveInteger,
              number: PositiveInteger,
              headRefOid: GitObjectSha,
            })),
          })),
          pageInfo: Schema.Struct({
            hasNextPage: Schema.Boolean,
            endCursor: Schema.NullOr(Schema.NonEmptyString),
          }),
        }),
      })),
    })),
  }),
});
const PullRequestResponse = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.NullOr(Schema.Struct({
      pullRequest: Schema.NullOr(Schema.Struct({
        id: Schema.NonEmptyString,
        databaseId: PositiveInteger,
        number: PositiveInteger,
        state: Schema.Literal("OPEN"),
        isDraft: Schema.Boolean,
        headRefOid: GitObjectSha,
        baseRefOid: GitObjectSha,
        baseRefName: Schema.NonEmptyString,
        mergeQueueEntry: Schema.NullOr(Schema.Struct({
          id: Schema.NonEmptyString,
        })),
      })),
    })),
  }),
});
const EnqueuePullRequestResponse = Schema.Struct({
  data: Schema.Struct({
    enqueuePullRequest: Schema.Struct({
      mergeQueueEntry: Schema.Struct({ id: Schema.NonEmptyString }),
    }),
  }),
});
const GitHubAppInstallationResponse = Schema.Struct({
  id: PositiveInteger,
  app_id: PositiveInteger,
  permissions: Schema.Record(Schema.String, Schema.String),
  events: Schema.Array(Schema.String),
});
const CommitStatusReceipt = Schema.Struct({
  id: PositiveInteger,
  context: Schema.NonEmptyString,
  state: Schema.Literals(["success", "failure"]),
  created_at: Schema.NonEmptyString,
  creator: Schema.Struct({
    id: PositiveInteger,
    login: Schema.NonEmptyString,
  }),
});

const decodeInstallationToken = Schema.decodeUnknownSync(
  InstallationTokenResponse,
  schemaDecodeOptions,
);
const decodeGitRef = Schema.decodeUnknownSync(GitRefResponse, schemaDecodeOptions);
const decodeMergeQueueTail = Schema.decodeUnknownSync(
  MergeQueueTailResponse,
  schemaDecodeOptions,
);
const decodeMergeQueuePage = Schema.decodeUnknownSync(
  MergeQueuePageResponse,
  schemaDecodeOptions,
);
const decodePullRequest = Schema.decodeUnknownSync(
  PullRequestResponse,
  schemaDecodeOptions,
);
const decodeEnqueuePullRequest = Schema.decodeUnknownSync(
  EnqueuePullRequestResponse,
  schemaDecodeOptions,
);
const decodeGitHubAppInstallation = Schema.decodeUnknownSync(
  GitHubAppInstallationResponse,
  schemaDecodeOptions,
);
const decodeCommitStatusReceipt = Schema.decodeUnknownSync(
  CommitStatusReceipt,
  schemaDecodeOptions,
);

const base64Url = (bytes: Uint8Array | string) => {
  const source = typeof bytes === "string" ? encoder.encode(bytes) : bytes;
  let binary = "";
  for (const byte of source) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

function pkcs8Bytes(pem: string) {
  const match = pem.trim().match(
    /^-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+)\s+-----END PRIVATE KEY-----$/u,
  );
  if (!match) {
    throw new Error("GitHub App private key must be PKCS#8 PEM");
  }
  const binary = atob(match[1].replace(/\s+/gu, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export type GitHubAppCredentials = {
  appId: number;
  privateKeyPkcs8: string;
};

export async function createGitHubAppJwt(
  credentials: GitHubAppCredentials,
  now = Date.now(),
) {
  if (!Number.isSafeInteger(credentials.appId) || credentials.appId <= 0) {
    throw new Error("GitHub App ID is invalid");
  }
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iat: Math.floor(now / 1_000) - 60,
    exp: Math.floor(now / 1_000) + 9 * 60,
    iss: credentials.appId,
  }));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Bytes(credentials.privateKeyPkcs8),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(`${header}.${payload}`),
  ));
  return `${header}.${payload}.${base64Url(signature)}`;
}

type GitHubFetch = typeof fetch;

export class GitHubAppRequestError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "GitHubAppRequestError";
    this.status = status;
  }
}

export function transientGitHubAppError(error: unknown) {
  return error instanceof GitHubAppRequestError &&
    (error.status === null || error.status === 408 || error.status === 409 ||
      error.status === 425 || error.status === 429 ||
      (error.status !== null && error.status >= 500));
}

async function githubJson(
  fetcher: GitHubFetch,
  url: string,
  init: RequestInit,
  label: string,
) {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new GitHubAppRequestError(
      `${label} infrastructure request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new GitHubAppRequestError(
      `${label} failed with HTTP ${response.status}`,
      response.status,
    );
  }
  return body;
}

const githubHeaders = (token: string) => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  "x-github-api-version": "2022-11-28",
});

export async function createGitHubInstallationToken(input: {
  credentials: GitHubAppCredentials;
  installationId: number;
  repositoryId: number;
  permissions: Readonly<Record<string, "read" | "write">>;
  fetcher?: GitHubFetch;
  now?: number;
}) {
  const fetcher = input.fetcher ?? fetch;
  const jwt = await createGitHubAppJwt(input.credentials, input.now);
  return decodeInstallationToken(await githubJson(
    fetcher,
    `https://api.github.com/app/installations/${input.installationId}/access_tokens`,
    {
      method: "POST",
      headers: githubHeaders(jwt),
      body: JSON.stringify({
        repository_ids: [input.repositoryId],
        permissions: input.permissions,
      }),
    },
    "GitHub installation token",
  ));
}

export type AuthoritativeMergeGroup = {
  tailPullRequestNumber: number;
  tailPosition: number;
  tailEnqueuedAt: string;
};

export type GitHubPullRequestReadback = {
  id: string;
  databaseId: number;
  number: number;
  headSha: string;
  baseSha: string;
  baseBranch: string;
  queueEntryId: string | null;
};

export class StaleGitHubMergeGroupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleGitHubMergeGroupError";
  }
}

const tailPullRequestFromRef = (headRef: string, baseRef: string) => {
  const baseBranch = baseRef.replace(/^refs\/heads\//u, "");
  const escaped = baseBranch.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = headRef.match(new RegExp(
    `^refs/heads/gh-readonly-queue/${escaped}/pr-([1-9][0-9]*)-([0-9a-f]{7,40})$`,
    "u",
  ));
  return match
    ? { pullRequestNumber: Number.parseInt(match[1], 10), headCommitPrefix: match[2] }
    : null;
};

export async function verifyAuthoritativeMergeGroup(input: {
  accessToken: string;
  repository: string;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
  fetcher?: GitHubFetch;
}): Promise<AuthoritativeMergeGroup> {
  const fetcher = input.fetcher ?? fetch;
  const [owner, name, extra] = input.repository.split("/");
  if (!owner || !name || extra) throw new Error("GitHub repository is invalid");
  const refIdentity = tailPullRequestFromRef(input.headRef, input.baseRef);
  if (!refIdentity) throw new Error("Merge-group head ref is outside the configured lane");
  const headers = githubHeaders(input.accessToken);
  let headRef: unknown;
  try {
    headRef = await githubJson(
      fetcher,
      `https://api.github.com/repos/${input.repository}/git/ref/${input.headRef.replace(/^refs\//u, "")}`,
      { headers },
      "GitHub merge-group ref",
    );
  } catch (error) {
    if (error instanceof GitHubAppRequestError && error.status === 404) {
      throw new StaleGitHubMergeGroupError("Merge-group live ref no longer exists");
    }
    throw error;
  }
  const [baseRef, queue] = await Promise.all([
    githubJson(
      fetcher,
      `https://api.github.com/repos/${input.repository}/git/ref/${input.baseRef.replace(/^refs\//u, "")}`,
      { headers },
      "GitHub base ref",
    ),
    githubJson(
      fetcher,
      "https://api.github.com/graphql",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: `query($owner:String!,$name:String!,$branch:String!,$limit:Int!){repository(owner:$owner,name:$name){mergeQueue(branch:$branch){entries(first:$limit){nodes{position enqueuedAt state headCommit{oid} pullRequest{number}}}}}}`,
          variables: {
            owner,
            name,
            branch: input.baseRef.replace(/^refs\/heads\//u, ""),
            limit: 100,
          },
        }),
      },
      "GitHub merge queue tail",
    ),
  ]);
  if (decodeGitRef(headRef).object.sha !== input.headSha) {
    throw new StaleGitHubMergeGroupError(
      "Merge-group ref no longer resolves to the signed head SHA",
    );
  }
  if (decodeGitRef(baseRef).object.sha !== input.baseSha) {
    throw new Error("Base branch SHA changed during authority verification");
  }
  const nodes = decodeMergeQueueTail(queue).data.repository?.mergeQueue?.entries.nodes ?? [];
  const active = nodes
    .filter((entry) => entry.state === "AWAITING_CHECKS" && entry.pullRequest)
    .sort((left, right) => left.position - right.position);
  const tail = active.at(-1);
  if (
    !tail?.pullRequest ||
    tail.pullRequest.number !== refIdentity.pullRequestNumber ||
    !tail.headCommit?.oid.startsWith(refIdentity.headCommitPrefix)
  ) {
    throw new StaleGitHubMergeGroupError(
      "Merge-group ref is not the authoritative current build-window tail",
    );
  }
  return {
    tailPullRequestNumber: tail.pullRequest.number,
    tailPosition: tail.position,
    tailEnqueuedAt: tail.enqueuedAt,
  };
}

const repositoryParts = (repository: string) => {
  const [owner, name, extra] = repository.split("/");
  if (!owner || !name || extra) throw new Error("GitHub repository is invalid");
  return { owner, name };
};

async function inspectPullRequestWithApp(input: {
  accessToken: string;
  repository: string;
  pullRequestNumber: number;
  fetcher: GitHubFetch;
}): Promise<GitHubPullRequestReadback> {
  const { owner, name } = repositoryParts(input.repository);
  const response = decodePullRequest(await githubJson(
    input.fetcher,
    "https://api.github.com/graphql",
    {
      method: "POST",
      headers: githubHeaders(input.accessToken),
      body: JSON.stringify({
        query: `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){id databaseId number state isDraft headRefOid baseRefOid baseRefName mergeQueueEntry{id}}}}`,
        variables: {
          owner,
          name,
          number: input.pullRequestNumber,
        },
      }),
    },
    "GitHub pull request readback",
  ));
  const pullRequest = response.data.repository?.pullRequest;
  if (!pullRequest) throw new StaleGitHubMergeGroupError("Pull request no longer exists");
  if (pullRequest.isDraft) {
    throw new StaleGitHubMergeGroupError("Draft pull request cannot enter the merge queue");
  }
  return {
    id: pullRequest.id,
    databaseId: pullRequest.databaseId,
    number: pullRequest.number,
    headSha: pullRequest.headRefOid,
    baseSha: pullRequest.baseRefOid,
    baseBranch: pullRequest.baseRefName,
    queueEntryId: pullRequest.mergeQueueEntry?.id ?? null,
  };
}

export async function verifyExactPullRequestWithApp(input: {
  accessToken: string;
  member: MergeQueueMember;
  fetcher?: GitHubFetch;
}) {
  const pullRequest = await inspectPullRequestWithApp({
    accessToken: input.accessToken,
    repository: input.member.repository,
    pullRequestNumber: input.member.pullRequestNumber,
    fetcher: input.fetcher ?? fetch,
  });
  if (
    pullRequest.id !== input.member.pullRequestNodeId ||
    pullRequest.databaseId !== input.member.pullRequestId ||
    pullRequest.number !== input.member.pullRequestNumber ||
    pullRequest.headSha !== input.member.headSha ||
    pullRequest.baseSha !== input.member.baseSha ||
    pullRequest.baseBranch !== "main"
  ) {
    throw new StaleGitHubMergeGroupError(
      "Pull request identity, exact head, or exact base changed after signoff",
    );
  }
  return pullRequest;
}

export async function enqueueExactPullRequestWithApp(input: {
  accessToken: string;
  member: MergeQueueMember;
  fetcher?: GitHubFetch;
}) {
  const fetcher = input.fetcher ?? fetch;
  const before = await verifyExactPullRequestWithApp({
    accessToken: input.accessToken,
    member: input.member,
    fetcher,
  });
  let queueEntryId = before.queueEntryId;
  if (!queueEntryId) {
    const response = decodeEnqueuePullRequest(await githubJson(
      fetcher,
      "https://api.github.com/graphql",
      {
        method: "POST",
        headers: githubHeaders(input.accessToken),
        body: JSON.stringify({
          query: `mutation($pullRequestId:ID!,$expectedHeadOid:GitObjectID!){enqueuePullRequest(input:{pullRequestId:$pullRequestId,expectedHeadOid:$expectedHeadOid,jump:false}){mergeQueueEntry{id}}}`,
          variables: {
            pullRequestId: input.member.pullRequestNodeId,
            expectedHeadOid: input.member.headSha,
          },
        }),
      },
      "GitHub exact-head enqueue",
    ));
    queueEntryId = response.data.enqueuePullRequest.mergeQueueEntry.id;
  }
  const after = await verifyExactPullRequestWithApp({
    accessToken: input.accessToken,
    member: input.member,
    fetcher,
  });
  if (after.queueEntryId !== queueEntryId) {
    throw new StaleGitHubMergeGroupError(
      "GitHub enqueue readback did not preserve the exact queue entry",
    );
  }
  return { ...after, queueEntryId };
}

export type AuthoritativeQueueEntry = {
  id: string;
  position: number;
  state: "QUEUED" | "AWAITING_CHECKS" | "MERGEABLE" | "UNMERGEABLE" | "LOCKED";
  headSha: string;
  pullRequestId: string;
  pullRequestDatabaseId: number;
  pullRequestNumber: number;
  pullRequestHeadSha: string;
};

export async function listAuthoritativeMergeQueue(input: {
  accessToken: string;
  repository: string;
  baseRef: string;
  fetcher?: GitHubFetch;
}) {
  const fetcher = input.fetcher ?? fetch;
  const { owner, name } = repositoryParts(input.repository);
  const entries: AuthoritativeQueueEntry[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const response = decodeMergeQueuePage(await githubJson(
      fetcher,
      "https://api.github.com/graphql",
      {
        method: "POST",
        headers: githubHeaders(input.accessToken),
        body: JSON.stringify({
          query: `query($owner:String!,$name:String!,$branch:String!,$cursor:String){repository(owner:$owner,name:$name){mergeQueue(branch:$branch){entries(first:100,after:$cursor){nodes{id position enqueuedAt state headCommit{oid} pullRequest{id databaseId number headRefOid}}pageInfo{hasNextPage endCursor}}}}}`,
          variables: {
            owner,
            name,
            branch: input.baseRef.replace(/^refs\/heads\//u, ""),
            cursor,
          },
        }),
      },
      "GitHub merge queue page",
    ));
    const connection = response.data.repository?.mergeQueue?.entries;
    if (!connection) return [];
    for (const entry of connection.nodes) {
      if (!entry.pullRequest || !entry.headCommit) continue;
      entries.push({
        id: entry.id,
        position: entry.position,
        state: entry.state,
        headSha: entry.headCommit.oid,
        pullRequestId: entry.pullRequest.id,
        pullRequestDatabaseId: entry.pullRequest.databaseId,
        pullRequestNumber: entry.pullRequest.number,
        pullRequestHeadSha: entry.pullRequest.headRefOid,
      });
    }
    if (!connection.pageInfo.hasNextPage) return entries;
    if (!connection.pageInfo.endCursor) {
      throw new GitHubAppRequestError("GitHub merge queue pagination lost its cursor");
    }
    cursor = connection.pageInfo.endCursor;
  }
  throw new GitHubAppRequestError("GitHub merge queue exceeded the pagination bound");
}

export async function verifySealedMergeGroup(input: {
  accessToken: string;
  repository: string;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
  expectedMembers: readonly MergeQueueMember[];
  fetcher?: GitHubFetch;
}) {
  if (input.expectedMembers.length < 1 || input.expectedMembers.length > 5) {
    throw new StaleGitHubMergeGroupError("Sealed generation size is invalid");
  }
  const fetcher = input.fetcher ?? fetch;
  const headers = githubHeaders(input.accessToken);
  const [headRef, baseRef, entries] = await Promise.all([
    githubJson(
      fetcher,
      `https://api.github.com/repos/${input.repository}/git/ref/${input.headRef.replace(/^refs\//u, "")}`,
      { headers },
      "GitHub merge-group ref",
    ),
    githubJson(
      fetcher,
      `https://api.github.com/repos/${input.repository}/git/ref/${input.baseRef.replace(/^refs\//u, "")}`,
      { headers },
      "GitHub base ref",
    ),
    listAuthoritativeMergeQueue({
      accessToken: input.accessToken,
      repository: input.repository,
      baseRef: input.baseRef,
      fetcher,
    }),
  ]);
  if (decodeGitRef(headRef).object.sha !== input.headSha) {
    throw new StaleGitHubMergeGroupError("Signed merge-group ref changed");
  }
  if (decodeGitRef(baseRef).object.sha !== input.baseSha) {
    throw new StaleGitHubMergeGroupError("Base moved before validation authority was established");
  }
  const awaiting = entries
    .filter((entry) => entry.state === "AWAITING_CHECKS")
    .sort((left, right) => left.position - right.position);
  if (awaiting.length !== input.expectedMembers.length) {
    throw new StaleGitHubMergeGroupError(
      "The active build window contains an external or late queue entry",
    );
  }
  for (const [index, member] of input.expectedMembers.entries()) {
    const entry = awaiting[index];
    if (
      !entry || entry.pullRequestId !== member.pullRequestNodeId ||
      entry.pullRequestDatabaseId !== member.pullRequestId ||
      entry.pullRequestNumber !== member.pullRequestNumber ||
      entry.pullRequestHeadSha !== member.headSha ||
      (index > 0 && entry.position !== awaiting[index - 1]!.position + 1)
    ) {
      throw new StaleGitHubMergeGroupError(
        "The sealed PR/head set is not the exact consecutive active window",
      );
    }
  }
  const tail = input.expectedMembers.at(-1)!;
  const authoritativeTail = awaiting.at(-1)!;
  const signedTail = tailPullRequestFromRef(input.headRef, input.baseRef);
  if (
    !signedTail || signedTail.pullRequestNumber !== tail.pullRequestNumber ||
    !tail.headSha.startsWith(signedTail.headCommitPrefix) ||
    authoritativeTail.headSha !== input.headSha
  ) {
    throw new StaleGitHubMergeGroupError(
      "Signed cumulative tail does not match the sealed generation tail",
    );
  }
  return { entries: awaiting, tail };
}

export async function attestGitHubAppInstallation(input: {
  credentials: GitHubAppCredentials;
  repository: string;
  expectedInstallationId: number;
  fetcher?: GitHubFetch;
  now?: number;
}) {
  const fetcher = input.fetcher ?? fetch;
  const jwt = await createGitHubAppJwt(input.credentials, input.now);
  const installation = decodeGitHubAppInstallation(await githubJson(
    fetcher,
    `https://api.github.com/repos/${input.repository}/installation`,
    { headers: githubHeaders(jwt) },
    "GitHub App installation attestation",
  ));
  if (installation.id !== input.expectedInstallationId ||
      installation.app_id !== input.credentials.appId) {
    throw new Error("GitHub App installation identity does not match Briar");
  }
  const expectedPermissions = {
    administration: "read",
    contents: "read",
    merge_queues: "write",
    metadata: "read",
    pull_requests: "read",
    statuses: "write",
  } as const;
  for (const [permission, level] of Object.entries(expectedPermissions)) {
    if (installation.permissions[permission] !== level) {
      throw new Error(`GitHub App permission ${permission} must be ${level}`);
    }
  }
  for (const event of ["merge_group", "pull_request"]) {
    if (!installation.events.includes(event)) {
      throw new Error(`GitHub App must subscribe to ${event}`);
    }
  }
  return {
    installationId: installation.id,
    appId: installation.app_id,
    permissions: installation.permissions,
    events: installation.events,
  };
}

export async function publishGitHubAppCommitStatus(input: {
  accessToken: string;
  repository: string;
  headSha: string;
  context: string;
  passed: boolean;
  targetUrl: string;
  description?: string;
  fetcher?: GitHubFetch;
}) {
  return decodeCommitStatusReceipt(await githubJson(
    input.fetcher ?? fetch,
    `https://api.github.com/repos/${input.repository}/statuses/${input.headSha}`,
    {
      method: "POST",
      headers: githubHeaders(input.accessToken),
      body: JSON.stringify({
        state: input.passed ? "success" : "failure",
        context: input.context,
        description: input.description ??
          `Briar isolated merge-group validation ${input.passed ? "passed" : "failed"}`,
        target_url: input.targetUrl,
      }),
    },
    `GitHub status ${input.context}`,
  ));
}
