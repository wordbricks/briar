import * as Schema from "effect/Schema";

const encoder = new TextEncoder();

const GitHubInstallationTokenResponse = Schema.Struct({
  token: Schema.String.check(Schema.isLengthBetween(1, 1_000)),
  expires_at: Schema.String,
  repositories: Schema.optional(Schema.Array(Schema.Struct({
    id: Schema.Int.check(Schema.isGreaterThan(0)),
    full_name: Schema.String,
  }))),
}).annotate({ parseOptions: { onExcessProperty: "preserve" } });

const GitHubPullRequestResponse = Schema.Struct({
  id: Schema.Int.check(Schema.isGreaterThan(0)),
  node_id: Schema.String,
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  html_url: Schema.String,
  state: Schema.Literals(["open", "closed"]),
  draft: Schema.Boolean,
  merged: Schema.Boolean,
  body: Schema.NullOr(Schema.String),
  head: Schema.Struct({ sha: Schema.String, ref: Schema.String }),
  base: Schema.Struct({ sha: Schema.String, ref: Schema.String }),
}).annotate({ parseOptions: { onExcessProperty: "preserve" } });

const GitHubMergeResponse = Schema.Struct({
  sha: Schema.String,
  merged: Schema.Boolean,
  message: Schema.String,
}).annotate({ parseOptions: { onExcessProperty: "preserve" } });

const GitHubRepositoryResponse = Schema.Struct({
  id: Schema.Int.check(Schema.isGreaterThan(0)),
  full_name: Schema.String,
  default_branch: Schema.String,
  allow_squash_merge: Schema.Boolean,
  allow_rebase_merge: Schema.Boolean,
  allow_merge_commit: Schema.Boolean,
}).annotate({ parseOptions: { onExcessProperty: "preserve" } });

const decodeInstallationToken = Schema.decodeUnknownSync(
  GitHubInstallationTokenResponse,
  { errors: "all" },
);
const decodePullRequest = Schema.decodeUnknownSync(
  GitHubPullRequestResponse,
  { errors: "all" },
);
const decodeMerge = Schema.decodeUnknownSync(GitHubMergeResponse, {
  errors: "all",
});
const decodeRepository = Schema.decodeUnknownSync(GitHubRepositoryResponse, {
  errors: "all",
});

export type ProjectGithubIdentity = {
  installationId: number;
  repositoryId: number;
  repository: string;
};

export class GithubAppApiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "GithubAppApiError";
  }
}

const base64Url = (value: Uint8Array | string) => {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

const githubPrivateKeyBytes = (pem: string) => {
  const normalized = pem.trim().replaceAll("\\n", "\n");
  const match = normalized.match(
    /^-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+?)\s+-----END PRIVATE KEY-----$/u,
  );
  if (!match) {
    throw new GithubAppApiError(
      "GitHub App private key must be an unencrypted PKCS#8 PEM",
      503,
    );
  }
  const binary = atob(match[1].replaceAll(/\s/gu, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export async function createGithubAppJwt(input: {
  appId: string;
  privateKey: string;
  now?: number;
}) {
  if (!/^[1-9][0-9]{0,19}$/u.test(input.appId)) {
    throw new GithubAppApiError("GitHub App ID is not configured", 503);
  }
  const issuedAt = Math.floor((input.now ?? Date.now()) / 1_000) - 30;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iat: issuedAt,
    exp: issuedAt + 9 * 60,
    iss: input.appId,
  }));
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    githubPrivateKeyBytes(input.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(signingInput),
  ));
  return `${signingInput}.${base64Url(signature)}`;
}

const githubHeaders = (token: string) => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  "user-agent": "Briar-Workflow-GitHub-App",
  "x-github-api-version": "2026-03-10",
});

async function githubJson(response: Response, operation: string) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "message" in body &&
        typeof body.message === "string"
      ? body.message
      : `GitHub returned status ${response.status}`;
    throw new GithubAppApiError(`${operation}: ${message}`, response.status);
  }
  return body;
}

export async function createGithubInstallationToken(
  env: Pick<Env, "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY">,
  identity: ProjectGithubIdentity,
  fetchImpl: typeof fetch = fetch,
) {
  const appId = env.GITHUB_APP_ID?.trim();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (!appId || !privateKey) {
    throw new GithubAppApiError(
      "GitHub App installation credentials are not configured",
      503,
    );
  }
  const jwt = await createGithubAppJwt({ appId, privateKey });
  const response = await fetchImpl(
    `https://api.github.com/app/installations/${identity.installationId}/access_tokens`,
    {
      method: "POST",
      headers: githubHeaders(jwt),
      body: JSON.stringify({
        repository_ids: [identity.repositoryId],
        permissions: {
          contents: "write",
          pull_requests: "write",
          statuses: "write",
        },
      }),
    },
  );
  const token = decodeInstallationToken(
    await githubJson(response, "GitHub installation token request failed"),
  );
  if (
    token.repositories &&
    !token.repositories.some((repository) =>
      repository.id === identity.repositoryId &&
      repository.full_name.toLowerCase() === identity.repository.toLowerCase()
    )
  ) {
    throw new GithubAppApiError(
      "GitHub issued a token for a different repository",
      409,
    );
  }
  return { token: token.token, expiresAt: token.expires_at };
}

async function projectGithubRequest(
  env: Pick<Env, "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY">,
  identity: ProjectGithubIdentity,
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
) {
  const credential = await createGithubInstallationToken(
    env,
    identity,
    fetchImpl,
  );
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(githubHeaders(credential.token))) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return githubJson(
    await fetchImpl(`https://api.github.com${path}`, { ...init, headers }),
    `GitHub API request to ${path} failed`,
  );
}

const repositoryPath = (identity: ProjectGithubIdentity) =>
  `/repos/${encodeURIComponent(identity.repository.split("/")[0])}/${
    encodeURIComponent(identity.repository.split("/")[1])
  }`;

export async function getProjectGithubRepository(
  env: Pick<Env, "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY">,
  identity: ProjectGithubIdentity,
) {
  const repository = decodeRepository(await projectGithubRequest(
    env,
    identity,
    repositoryPath(identity),
  ));
  if (
    repository.id !== identity.repositoryId ||
    repository.full_name.toLowerCase() !== identity.repository.toLowerCase()
  ) {
    throw new GithubAppApiError(
      "GitHub repository identity changed during the request",
      409,
    );
  }
  return repository;
}

export async function projectGithubGraphql(
  env: Pick<Env, "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY">,
  identity: ProjectGithubIdentity,
  input: { query: string; variables: Record<string, string | number | boolean> },
) {
  return projectGithubRequest(env, identity, "/graphql", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

const pullRequestJson = (
  identity: ProjectGithubIdentity,
  input: typeof GitHubPullRequestResponse.Type,
) => ({
  repositoryId: identity.repositoryId,
  repository: identity.repository,
  pullRequestId: input.id,
  pullRequestNodeId: input.node_id,
  pullRequestNumber: input.number,
  url: input.html_url,
  state: input.merged ? ("merged" as const) : input.state,
  draft: input.draft,
  merged: input.merged,
  body: input.body ?? "",
  headSha: input.head.sha,
  headRef: input.head.ref,
  baseSha: input.base.sha,
  baseRef: input.base.ref,
});

export async function getProjectGithubPullRequest(
  env: Pick<Env, "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY">,
  identity: ProjectGithubIdentity,
  pullRequestNumber: number,
) {
  const payload = decodePullRequest(await projectGithubRequest(
    env,
    identity,
    `${repositoryPath(identity)}/pulls/${pullRequestNumber}`,
  ));
  return pullRequestJson(identity, payload);
}

export async function createProjectGithubPullRequest(
  env: Pick<Env, "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY">,
  identity: ProjectGithubIdentity,
  input: { title: string; head: string; base: string; body: string; draft: boolean },
) {
  const payload = decodePullRequest(await projectGithubRequest(
    env,
    identity,
    `${repositoryPath(identity)}/pulls`,
    { method: "POST", body: JSON.stringify(input) },
  ));
  return pullRequestJson(identity, payload);
}

export async function updateProjectGithubPullRequest(
  env: Pick<Env, "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY">,
  identity: ProjectGithubIdentity,
  pullRequestNumber: number,
  input: Record<string, unknown>,
) {
  const payload = decodePullRequest(await projectGithubRequest(
    env,
    identity,
    `${repositoryPath(identity)}/pulls/${pullRequestNumber}`,
    { method: "PATCH", body: JSON.stringify(input) },
  ));
  return pullRequestJson(identity, payload);
}

export async function mergeProjectGithubPullRequest(
  env: Pick<Env, "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY">,
  identity: ProjectGithubIdentity,
  pullRequestNumber: number,
  input: { mergeMethod: "merge" | "squash" | "rebase"; expectedHeadSha?: string },
) {
  return decodeMerge(await projectGithubRequest(
    env,
    identity,
    `${repositoryPath(identity)}/pulls/${pullRequestNumber}/merge`,
    {
      method: "PUT",
      body: JSON.stringify({
        merge_method: input.mergeMethod,
        ...(input.expectedHeadSha ? { sha: input.expectedHeadSha } : {}),
      }),
    },
  ));
}

export async function createProjectGithubCommitStatus(
  env: Pick<Env, "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY">,
  identity: ProjectGithubIdentity,
  input: {
    sha: string;
    state: "error" | "failure" | "pending" | "success";
    context: string;
    description?: string;
    targetUrl?: string;
  },
) {
  await projectGithubRequest(
    env,
    identity,
    `${repositoryPath(identity)}/statuses/${input.sha}`,
    {
      method: "POST",
      body: JSON.stringify({
        state: input.state,
        context: input.context,
        ...(input.description ? { description: input.description } : {}),
        ...(input.targetUrl ? { target_url: input.targetUrl } : {}),
      }),
    },
  );
}
