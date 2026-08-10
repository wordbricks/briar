import { z } from "zod";

const encoder = new TextEncoder();
const supportedGitHubWebhookEventSchema = z.enum([
  "pull_request",
  "issues",
  "ping",
  "installation",
  "installation_repositories",
  "github_app_authorization",
]);
const githubTimestampSchema = z.iso.datetime({ offset: true });
const githubIdSchema = z.number().int().positive();
const githubShaSchema = z.string().trim().min(1).max(128);
const nullableGithubTimestampSchema = githubTimestampSchema.nullable();

const githubRepositorySchema = z.object({
  id: githubIdSchema,
  full_name: z.string().trim().min(3).max(300),
});

const githubSenderSchema = z.object({
  login: z.string().trim().min(1).max(100),
});

const githubInstallationSchema = z.object({
  id: githubIdSchema,
});

const githubInstallationWebhookPayloadSchema = z.object({
  action: z.string().trim().min(1).max(100),
  installation: githubInstallationSchema,
});

const githubWebhookRepositoryAccessSchema = z.object({
  id: githubIdSchema,
  name: z.string().trim().min(1).max(100),
  full_name: z.string().trim().min(3).max(300),
  owner: z.object({
    login: z.string().trim().min(1).max(100),
  }),
});

const githubInstallationRepositoriesWebhookPayloadSchema = z.object({
  action: z.string().trim().min(1).max(100),
  installation: githubInstallationSchema,
  repositories_added: z.array(githubWebhookRepositoryAccessSchema),
  repositories_removed: z.array(githubWebhookRepositoryAccessSchema),
});

const githubAppAuthorizationWebhookPayloadSchema = z.object({
  action: z.string().trim().min(1).max(100),
  sender: z.object({
    id: githubIdSchema,
    login: z.string().trim().min(1).max(100),
  }),
});

export const githubPullRequestWebhookPayloadSchema = z.object({
  action: z.string().trim().min(1).max(100),
  installation: githubInstallationSchema,
  repository: githubRepositorySchema,
  sender: githubSenderSchema,
  pull_request: z.object({
    id: githubIdSchema,
    node_id: z.string().trim().min(1).max(200),
    number: z.number().int().positive(),
    html_url: z.url(),
    state: z.enum(["open", "closed"]),
    draft: z.boolean(),
    merged: z.boolean(),
    merge_commit_sha: githubShaSchema.nullable(),
    body: z.string().nullable(),
    head: z.object({ sha: githubShaSchema }),
    base: z.object({ sha: githubShaSchema }),
    merged_at: nullableGithubTimestampSchema,
    closed_at: nullableGithubTimestampSchema,
    created_at: githubTimestampSchema,
    updated_at: githubTimestampSchema,
  }),
});

export const githubIssuesWebhookPayloadSchema = z.object({
  action: z.string().trim().min(1).max(100),
  installation: githubInstallationSchema,
  repository: githubRepositorySchema,
  sender: githubSenderSchema,
  issue: z.object({
    id: githubIdSchema,
    node_id: z.string().trim().min(1).max(200),
    number: z.number().int().positive(),
    html_url: z.url(),
    state: z.enum(["open", "closed"]),
    title: z.string().min(1).max(1_000),
    body: z.string().nullable(),
    labels: z.array(z.object({
      name: z.string().min(1).max(200),
    })),
    assignees: z.array(z.object({
      login: z.string().trim().min(1).max(100),
    })),
    closed_at: nullableGithubTimestampSchema,
    created_at: githubTimestampSchema,
    updated_at: githubTimestampSchema,
  }),
});

export const githubPingWebhookPayloadSchema = z.object({
  zen: z.string().trim().min(1).max(1_000),
  hook_id: githubIdSchema.optional(),
});

const githubWebhookHeadersSchema = z.object({
  event: z.string().trim().pipe(supportedGitHubWebhookEventSchema),
  deliveryId: z.string().trim().toLowerCase().pipe(z.uuid()),
});

export type GitHubWebhookHeaders = z.infer<typeof githubWebhookHeadersSchema>;

export type BriarIssueLink = {
  projectId: string;
  runId: string;
};

export type GitHubPullRequestState = "open" | "closed" | "merged";

export const githubOAuthStateTtlMs = 10 * 60_000;

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

export function randomGithubOAuthToken(bytes = 48) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function githubPkceChallenge(verifier: string) {
  return bytesToBase64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(verifier)),
    ),
  );
}

export async function githubSha256Hex(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const githubOAuthTokenSchema = z.object({
  access_token: z.string().trim().min(1).max(1_000),
  token_type: z.string().trim().min(1).max(50),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().trim().min(1).max(1_000).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
});

const githubOAuthErrorSchema = z.object({
  error: z.string().trim().min(1).max(200),
  error_description: z.string().trim().min(1).max(1_000).optional(),
});

const githubUserSchema = z.object({
  id: githubIdSchema,
  login: z.string().trim().min(1).max(100),
  avatar_url: z.url(),
});

const githubInstallationAccountSchema = z.object({
  id: githubIdSchema,
  login: z.string().trim().min(1).max(100),
  avatar_url: z.url(),
});

const githubUserInstallationSchema = z.object({
  id: githubIdSchema,
  app_slug: z.string().trim().min(1).max(200),
  account: githubInstallationAccountSchema,
});

const githubUserInstallationsSchema = z.object({
  installations: z.array(githubUserInstallationSchema),
});

const githubRepositoryAccessSchema = z.object({
  id: githubIdSchema,
  name: z.string().trim().min(1).max(100),
  full_name: z.string().trim().min(3).max(300),
  owner: z.object({
    login: z.string().trim().min(1).max(100),
  }),
});

const githubUserRepositoriesSchema = z.object({
  repositories: z.array(githubRepositoryAccessSchema),
});

export class GithubOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubOAuthError";
  }
}

async function readGithubJson(response: Response) {
  try {
    return await response.json();
  } catch {
    throw new GithubOAuthError("GitHub returned an invalid response");
  }
}

export async function exchangeGithubOAuthCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    }),
  });
  const payload = await readGithubJson(response);
  const oauthError = githubOAuthErrorSchema.safeParse(payload);
  if (!response.ok || oauthError.success) {
    throw new GithubOAuthError(
      oauthError.success
        ? `GitHub OAuth failed: ${oauthError.data.error}`
        : `GitHub OAuth failed with status ${response.status}`,
    );
  }
  const token = githubOAuthTokenSchema.safeParse(payload);
  if (!token.success) {
    throw new GithubOAuthError("GitHub returned an invalid OAuth token response");
  }
  return token.data;
}

const githubApiHeaders = (accessToken: string) => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${accessToken}`,
  "x-github-api-version": "2026-03-10",
});

async function fetchGithubApi(path: string, accessToken: string) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: githubApiHeaders(accessToken),
  });
  if (!response.ok) {
    throw new GithubOAuthError(
      `GitHub API request failed with status ${response.status}`,
    );
  }
  return readGithubJson(response);
}

export async function verifyGithubOAuthInstallation(input: {
  accessToken: string;
  installationId: number;
  appSlug: string;
}) {
  const user = githubUserSchema.parse(
    await fetchGithubApi("/user", input.accessToken),
  );

  let installation: z.infer<typeof githubUserInstallationSchema> | undefined;
  for (let page = 1; page <= 10 && !installation; page += 1) {
    const payload = githubUserInstallationsSchema.parse(
      await fetchGithubApi(
        `/user/installations?per_page=100&page=${page}`,
        input.accessToken,
      ),
    );
    installation = payload.installations.find(
      (candidate) => candidate.id === input.installationId,
    );
    if (payload.installations.length < 100) break;
  }
  if (!installation || installation.app_slug !== input.appSlug) {
    throw new GithubOAuthError(
      "The GitHub App installation is not accessible to this user",
    );
  }

  const repositories: Array<z.infer<typeof githubRepositoryAccessSchema>> = [];
  for (let page = 1; page <= 10; page += 1) {
    const payload = githubUserRepositoriesSchema.parse(
      await fetchGithubApi(
        `/user/installations/${input.installationId}/repositories?per_page=100&page=${page}`,
        input.accessToken,
      ),
    );
    repositories.push(...payload.repositories);
    if (payload.repositories.length < 100) break;
  }

  return {
    user: {
      id: user.id,
      login: user.login,
      avatarUrl: user.avatar_url,
    },
    installation: {
      id: installation.id,
      accountId: installation.account.id,
      accountLogin: installation.account.login,
      accountAvatarUrl: installation.account.avatar_url,
    },
    repositories: repositories.map((repository) => ({
      id: repository.id,
      owner: repository.owner.login,
      name: repository.name,
      fullName: repository.full_name,
    })),
  };
}

export function parseGitHubWebhookHeaders(
  headers: Headers,
): GitHubWebhookHeaders {
  return githubWebhookHeadersSchema.parse({
    event: headers.get("x-github-event"),
    deliveryId: headers.get("x-github-delivery"),
  });
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function hexToBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function rawBodyBytes(
  rawBody: string | ArrayBuffer | Uint8Array,
): ArrayBuffer {
  if (typeof rawBody === "string") return encoder.encode(rawBody).buffer;
  if (rawBody instanceof ArrayBuffer) return rawBody;
  return Uint8Array.from(rawBody).buffer;
}

export async function verifyGitHubWebhook(
  rawBody: string | ArrayBuffer | Uint8Array,
  headers: Headers,
  webhookSecret: string,
) {
  const signature = headers.get("x-hub-signature-256");
  const match = signature?.match(/^sha256=([0-9a-f]{64})$/u);
  if (!match || webhookSecret.length === 0) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, rawBodyBytes(rawBody)),
  );
  return constantTimeEqual(digest, hexToBytes(match[1]));
}

export function extractBriarIssueLinks(
  body: string | null | undefined,
): BriarIssueLink[] {
  if (!body) return [];

  const uuidSegment = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const issuePathPattern = new RegExp(
    `/open/issues/(${uuidSegment})/(${uuidSegment})(?![0-9a-z_-])`,
    "giu",
  );
  const uuidSchema = z.uuid();
  const links: BriarIssueLink[] = [];
  const seen = new Set<string>();

  for (const match of body.matchAll(issuePathPattern)) {
    const projectId = uuidSchema.safeParse(match[1]);
    const runId = uuidSchema.safeParse(match[2]);
    if (!projectId.success || !runId.success) continue;

    const link = {
      projectId: projectId.data.toLowerCase(),
      runId: runId.data.toLowerCase(),
    };
    const key = `${link.projectId}:${link.runId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(link);
    if (links.length === 20) break;
  }
  return links;
}

function normalizeGitHubTimestamp(value: string) {
  return new Date(value).toISOString();
}

function normalizeNullableGitHubTimestamp(value: string | null) {
  return value === null ? null : normalizeGitHubTimestamp(value);
}

function commonWebhookFields(
  headers: GitHubWebhookHeaders,
  payload: {
    action: string;
    installation: { id: number };
    repository: { id: number; full_name: string };
    sender: { login: string };
  },
) {
  return {
    deliveryId: headers.deliveryId,
    action: payload.action,
    installationId: payload.installation.id,
    repositoryId: payload.repository.id,
    repositoryFullName: payload.repository.full_name,
    senderLogin: payload.sender.login,
  };
}

export function parseGitHubWebhook(
  headers: GitHubWebhookHeaders,
  payload: unknown,
) {
  if (headers.event === "ping") {
    const parsed = githubPingWebhookPayloadSchema.parse(payload);
    return {
      deliveryId: headers.deliveryId,
      event: "ping" as const,
      zen: parsed.zen,
      hookId: parsed.hook_id ?? null,
    };
  }

  if (headers.event === "installation") {
    const parsed = githubInstallationWebhookPayloadSchema.parse(payload);
    return {
      deliveryId: headers.deliveryId,
      event: "installation" as const,
      action: parsed.action,
      installationId: parsed.installation.id,
    };
  }

  if (headers.event === "installation_repositories") {
    const parsed = githubInstallationRepositoriesWebhookPayloadSchema.parse(
      payload,
    );
    const repository = (
      value: z.infer<typeof githubWebhookRepositoryAccessSchema>,
    ) => ({
      id: value.id,
      owner: value.owner.login,
      name: value.name,
      fullName: value.full_name,
    });
    return {
      deliveryId: headers.deliveryId,
      event: "installation_repositories" as const,
      action: parsed.action,
      installationId: parsed.installation.id,
      added: parsed.repositories_added.map(repository),
      removed: parsed.repositories_removed.map(repository),
    };
  }

  if (headers.event === "github_app_authorization") {
    const parsed = githubAppAuthorizationWebhookPayloadSchema.parse(payload);
    return {
      deliveryId: headers.deliveryId,
      event: "github_app_authorization" as const,
      action: parsed.action,
      githubUserId: parsed.sender.id,
      githubUserLogin: parsed.sender.login,
    };
  }

  if (headers.event === "pull_request") {
    const parsed = githubPullRequestWebhookPayloadSchema.parse(payload);
    const pullRequest = parsed.pull_request;
    const isMerged = parsed.action === "closed" && pullRequest.merged;
    const state: GitHubPullRequestState = isMerged
      ? "merged"
      : pullRequest.state;
    return {
      ...commonWebhookFields(headers, parsed),
      event: "pull_request" as const,
      pullRequestId: pullRequest.id,
      pullRequestNodeId: pullRequest.node_id,
      number: pullRequest.number,
      htmlUrl: pullRequest.html_url,
      state,
      providerState: pullRequest.state,
      draft: pullRequest.draft,
      merged: pullRequest.merged,
      isMerged,
      headSha: pullRequest.head.sha,
      baseSha: pullRequest.base.sha,
      mergeCommitSha: pullRequest.merge_commit_sha,
      body: pullRequest.body,
      briarIssueLinks: extractBriarIssueLinks(pullRequest.body),
      mergedAt: normalizeNullableGitHubTimestamp(pullRequest.merged_at),
      closedAt: normalizeNullableGitHubTimestamp(pullRequest.closed_at),
      createdAt: normalizeGitHubTimestamp(pullRequest.created_at),
      providerUpdatedAt: normalizeGitHubTimestamp(pullRequest.updated_at),
    };
  }

  const parsed = githubIssuesWebhookPayloadSchema.parse(payload);
  const issue = parsed.issue;
  return {
    ...commonWebhookFields(headers, parsed),
    event: "issues" as const,
    issueId: issue.id,
    issueNodeId: issue.node_id,
    number: issue.number,
    htmlUrl: issue.html_url,
    state: issue.state,
    title: issue.title,
    body: issue.body,
    labels: issue.labels.map((label) => label.name),
    assignees: issue.assignees.map((assignee) => assignee.login),
    briarIssueLinks: extractBriarIssueLinks(issue.body),
    closedAt: normalizeNullableGitHubTimestamp(issue.closed_at),
    createdAt: normalizeGitHubTimestamp(issue.created_at),
    providerUpdatedAt: normalizeGitHubTimestamp(issue.updated_at),
  };
}
