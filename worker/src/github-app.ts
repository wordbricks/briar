import * as Schema from "effect/Schema";
import { MERGE_GROUP_MAX_ENTRIES_TO_MERGE } from "../../src/lib/merge-group-validation-contract";
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
    throw new Error(
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
    const error = new Error(`${label} failed with HTTP ${response.status}`);
    Reflect.set(error, "status", response.status);
    throw error;
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
    if (error instanceof Error && Reflect.get(error, "status") === 404) {
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
            limit: MERGE_GROUP_MAX_ENTRIES_TO_MERGE,
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

export async function publishGitHubAppCommitStatus(input: {
  accessToken: string;
  repository: string;
  headSha: string;
  context: string;
  passed: boolean;
  targetUrl: string;
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
        description: `Briar isolated merge-group validation ${input.passed ? "passed" : "failed"}`,
        target_url: input.targetUrl,
      }),
    },
    `GitHub status ${input.context}`,
  ));
}
