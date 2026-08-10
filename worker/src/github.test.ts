import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exchangeGithubOAuthCode,
  extractBriarIssueLinks,
  githubPkceChallenge,
  parseGitHubWebhook,
  parseGitHubWebhookHeaders,
  verifyGithubOAuthInstallation,
  verifyGitHubWebhook,
} from "./github";

const deliveryId = "33333333-3333-4333-8333-333333333333";
const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const issueUrl =
  `https://briar-api.example/open/issues/${projectId}/${runId}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

const pullRequestHeaders = {
  event: "pull_request" as const,
  deliveryId,
};

function pullRequestPayload(input: {
  action?: string;
  state?: "open" | "closed";
  merged?: boolean;
  body?: string | null;
  updatedAt?: string;
}) {
  return {
    action: input.action ?? "opened",
    installation: { id: 901 },
    repository: { id: 701, full_name: "wordbricks/briar" },
    sender: { login: "octocat" },
    pull_request: {
      id: 501,
      node_id: "PR_kwDOExample",
      number: 42,
      html_url: "https://github.com/wordbricks/briar/pull/42",
      state: input.state ?? "open",
      draft: false,
      merged: input.merged ?? false,
      merge_commit_sha: input.merged ? "c".repeat(40) : null,
      body: input.body ?? "No Briar link yet",
      head: { sha: "a".repeat(40) },
      base: { sha: "b".repeat(40) },
      merged_at: input.merged ? "2026-08-04T09:40:00Z" : null,
      closed_at: input.state === "closed"
        ? "2026-08-04T09:40:00Z"
        : null,
      created_at: "2026-08-04T08:00:00Z",
      updated_at: input.updatedAt ?? "2026-08-04T18:34:56+09:00",
    },
  };
}

describe("GitHub webhooks", () => {
  it("verifies the raw body HMAC-SHA256 signature", async () => {
    const secret = "It's a Secret to Everybody";
    const headers = new Headers({
      "x-hub-signature-256":
        "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
    });

    expect(await verifyGitHubWebhook("Hello, World!", headers, secret))
      .toBe(true);
    expect(await verifyGitHubWebhook("Hello, World?", headers, secret))
      .toBe(false);
    expect(await verifyGitHubWebhook("Hello, World!", headers, "wrong"))
      .toBe(false);
    expect(
      await verifyGitHubWebhook(
        "Hello, World!",
        new Headers({ "x-hub-signature-256": "sha256=invalid" }),
        secret,
      ),
    ).toBe(false);
  });

  it("parses and validates supported event and delivery headers", () => {
    expect(
      parseGitHubWebhookHeaders(new Headers({
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": deliveryId.toUpperCase(),
      })),
    ).toEqual(pullRequestHeaders);

    expect(() => parseGitHubWebhookHeaders(new Headers({
      "x-github-event": "push",
      "x-github-delivery": deliveryId,
    }))).toThrow();
    expect(() => parseGitHubWebhookHeaders(new Headers({
      "x-github-event": "issues",
    }))).toThrow();
  });

  it("parses a GitHub webhook setup ping", () => {
    const headers = parseGitHubWebhookHeaders(new Headers({
      "x-github-event": "ping",
      "x-github-delivery": deliveryId,
    }));

    expect(parseGitHubWebhook(headers, {
      zen: "Keep it logically awesome.",
      hook_id: 12345,
    })).toEqual({
      deliveryId,
      event: "ping",
      zen: "Keep it logically awesome.",
      hookId: 12345,
    });
  });

  it("accepts lifecycle webhooks required by GitHub App OAuth", () => {
    expect(parseGitHubWebhook(
      { event: "installation", deliveryId },
      { action: "deleted", installation: { id: 901 } },
    )).toEqual({
      deliveryId,
      event: "installation",
      action: "deleted",
      installationId: 901,
    });
    expect(parseGitHubWebhook(
      { event: "github_app_authorization", deliveryId },
      { action: "revoked", sender: { id: 801, login: "octocat" } },
    )).toEqual({
      deliveryId,
      event: "github_app_authorization",
      action: "revoked",
      githubUserId: 801,
      githubUserLogin: "octocat",
    });
    expect(parseGitHubWebhook(
      { event: "installation_repositories", deliveryId },
      {
        action: "added",
        installation: { id: 901 },
        repositories_added: [{
          id: 701,
          name: "briar",
          full_name: "wordbricks/briar",
          owner: { login: "wordbricks" },
        }],
        repositories_removed: [],
      },
    )).toEqual({
      deliveryId,
      event: "installation_repositories",
      action: "added",
      installationId: 901,
      added: [{
        id: 701,
        owner: "wordbricks",
        name: "briar",
        fullName: "wordbricks/briar",
      }],
      removed: [],
    });
  });

  it("normalizes an open pull request and its provider timestamp", () => {
    const parsed = parseGitHubWebhook(
      pullRequestHeaders,
      pullRequestPayload({ body: `[Briar issue](${issueUrl})` }),
    );

    expect(parsed).toMatchObject({
      deliveryId,
      event: "pull_request",
      action: "opened",
      installationId: 901,
      repositoryId: 701,
      repositoryFullName: "wordbricks/briar",
      senderLogin: "octocat",
      pullRequestId: 501,
      pullRequestNodeId: "PR_kwDOExample",
      number: 42,
      state: "open",
      providerState: "open",
      merged: false,
      isMerged: false,
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      providerUpdatedAt: "2026-08-04T09:34:56.000Z",
      briarIssueLinks: [{ projectId, runId }],
    });
  });

  it("keeps an unmerged close distinct from a merge", () => {
    const closed = parseGitHubWebhook(
      pullRequestHeaders,
      pullRequestPayload({
        action: "closed",
        state: "closed",
        merged: false,
      }),
    );
    expect(closed).toMatchObject({
      state: "closed",
      providerState: "closed",
      merged: false,
      isMerged: false,
      mergedAt: null,
    });

    const nonClosingDelivery = parseGitHubWebhook(
      pullRequestHeaders,
      pullRequestPayload({
        action: "edited",
        state: "closed",
        merged: true,
      }),
    );
    expect(nonClosingDelivery).toMatchObject({
      state: "closed",
      merged: true,
      isMerged: false,
    });
  });

  it("marks only a closed, merged pull request delivery as merged", () => {
    const merged = parseGitHubWebhook(
      pullRequestHeaders,
      pullRequestPayload({
        action: "closed",
        state: "closed",
        merged: true,
      }),
    );

    expect(merged).toMatchObject({
      state: "merged",
      providerState: "closed",
      merged: true,
      isMerged: true,
      mergeCommitSha: "c".repeat(40),
      mergedAt: "2026-08-04T09:40:00.000Z",
    });
  });

  it("extracts unique Briar issue links from bodies, capped at twenty", () => {
    const generatedLinks = Array.from({ length: 21 }, (_, index) => {
      const generatedRunId =
        `22222222-2222-4222-8222-${index.toString(16).padStart(12, "0")}`;
      return `https://briar.example/open/issues/${projectId}/${generatedRunId}`;
    });
    const body = [
      issueUrl,
      issueUrl.toUpperCase(),
      "https://briar.example/open/issues/not-a-uuid/not-a-uuid",
      ...generatedLinks,
    ].join("\n");

    const links = extractBriarIssueLinks(body);
    expect(links).toHaveLength(20);
    expect(links[0]).toEqual({ projectId, runId });
    expect(new Set(links.map((link) => `${link.projectId}:${link.runId}`)).size)
      .toBe(20);
    expect(extractBriarIssueLinks(`[Briar issue](${issueUrl})`)).toEqual([{
      projectId,
      runId,
    }]);
    expect(extractBriarIssueLinks(null)).toEqual([]);
  });

  it("parses the minimum issues payload", () => {
    const parsed = parseGitHubWebhook(
      { event: "issues", deliveryId },
      {
        action: "closed",
        installation: { id: 901 },
        repository: { id: 701, full_name: "wordbricks/briar" },
        sender: { login: "octocat" },
        issue: {
          id: 601,
          node_id: "I_kwDOExample",
          number: 41,
          html_url: "https://github.com/wordbricks/briar/issues/41",
          state: "closed",
          title: "Synchronize this issue",
          body: issueUrl,
          labels: [{ name: "bug" }, { name: "priority:high" }],
          assignees: [{ login: "hubot" }],
          closed_at: "2026-08-04T09:45:00Z",
          created_at: "2026-08-04T08:00:00Z",
          updated_at: "2026-08-04T18:45:00+09:00",
        },
      },
    );

    expect(parsed).toMatchObject({
      event: "issues",
      issueId: 601,
      number: 41,
      state: "closed",
      labels: ["bug", "priority:high"],
      assignees: ["hubot"],
      providerUpdatedAt: "2026-08-04T09:45:00.000Z",
      briarIssueLinks: [{ projectId, runId }],
    });
  });

  it("rejects malformed provider payloads", () => {
    expect(() => parseGitHubWebhook(
      pullRequestHeaders,
      pullRequestPayload({ updatedAt: "yesterday" }),
    )).toThrow();

    expect(() => parseGitHubWebhook(
      { event: "issues", deliveryId },
      { action: "closed", issue: {} },
    )).toThrow();
  });
});

describe("GitHub App user OAuth", () => {
  it("generates the RFC 7636 S256 PKCE challenge", async () => {
    await expect(githubPkceChallenge(
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    )).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("exchanges an OAuth code with the fixed redirect URI and PKCE verifier", async () => {
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => Response.json({
      access_token: "ghu_transient",
      token_type: "bearer",
      expires_in: 28_800,
      refresh_token: "ghr_not_persisted",
      refresh_token_expires_in: 15_897_600,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(exchangeGithubOAuthCode({
      clientId: "Iv1.client",
      clientSecret: "secret",
      code: "temporary-code",
      redirectUri: "https://briar.example/github/oauth/callback",
      codeVerifier: "v".repeat(64),
    })).resolves.toMatchObject({ access_token: "ghu_transient" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://github.com/login/oauth/access_token");
    expect(init?.method).toBe("POST");
    const body = new URLSearchParams(init?.body as string);
    expect(body.get("redirect_uri")).toBe(
      "https://briar.example/github/oauth/callback",
    );
    expect(body.get("code_verifier")).toBe("v".repeat(64));
  });

  it("verifies installation ownership and snapshots accessible repositories", async () => {
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      _init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/user")) {
        return Response.json({
          id: 801,
          login: "octocat",
          avatar_url: "https://avatars.githubusercontent.com/u/801?v=4",
        });
      }
      if (url.includes("/user/installations?")) {
        return Response.json({
          installations: [{
            id: 901,
            app_slug: "briar-app",
            account: {
              id: 701,
              login: "wordbricks",
              avatar_url: "https://avatars.githubusercontent.com/u/701?v=4",
            },
          }],
        });
      }
      return Response.json({
        repositories: [{
          id: 501,
          name: "briar",
          full_name: "wordbricks/briar",
          owner: { login: "wordbricks" },
        }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyGithubOAuthInstallation({
      accessToken: "ghu_transient",
      installationId: 901,
      appSlug: "briar-app",
    })).resolves.toEqual({
      user: {
        id: 801,
        login: "octocat",
        avatarUrl: "https://avatars.githubusercontent.com/u/801?v=4",
      },
      installation: {
        id: 901,
        accountId: 701,
        accountLogin: "wordbricks",
        accountAvatarUrl: "https://avatars.githubusercontent.com/u/701?v=4",
      },
      repositories: [{
        id: 501,
        owner: "wordbricks",
        name: "briar",
        fullName: "wordbricks/briar",
      }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({
        authorization: "Bearer ghu_transient",
        "x-github-api-version": "2026-03-10",
      });
    }
  });

  it("rejects an unverified or wrong-App installation ID", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return Response.json(url.endsWith("/user")
        ? {
            id: 801,
            login: "octocat",
            avatar_url: "https://avatars.githubusercontent.com/u/801?v=4",
          }
        : {
            installations: [{
              id: 999,
              app_slug: "another-app",
              account: {
                id: 701,
                login: "wordbricks",
                avatar_url: "https://avatars.githubusercontent.com/u/701?v=4",
              },
            }],
          });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyGithubOAuthInstallation({
      accessToken: "ghu_transient",
      installationId: 901,
      appSlug: "briar-app",
    })).rejects.toThrow(/not accessible/iu);
  });
});
