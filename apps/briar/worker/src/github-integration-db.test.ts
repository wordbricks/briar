import { generateKeyPairSync } from "node:crypto";
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "./index";
import {
  connectGithubInstallation,
  consumeGithubInstallState,
  consumeGithubOAuthState,
  createGithubOAuthState,
  disconnectGithubInstallation,
  disconnectGithubInstallationById,
  disconnectGithubInstallationsByAuthorizedUser,
  getGithubConnectionByInstallation,
  getGithubConnectionForOrganization,
  listGithubConnectionRepositories,
  syncGithubConnectionRepositories,
} from "./db";
import { githubSha256Hex } from "./github";
import { getGithubIntegrationApplication } from "./github-integration-application";

const githubAppEnv = (privateKey: string) => ({
  GITHUB_WEBHOOK_SECRET: "webhook-secret",
  GITHUB_APP_CLIENT_ID: "Iv1.client",
  GITHUB_APP_CLIENT_SECRET: "client-secret",
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY: privateKey,
  GITHUB_APP_SLUG: "briar-app",
  GITHUB_CALLBACK_ORIGIN: "https://briar.example",
});

// The App JWT is signed for real, so the refresh path needs a usable key.
let privateKeyPem: string | undefined;
function installationPrivateKeyPem() {
  privateKeyPem ??= generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  return privateKeyPem;
}

const installationRepositoriesFetch = (
  repositories: Array<{
    id: number;
    owner: { login: string };
    name: string;
    full_name: string;
  }>,
) =>
  vi.fn(async (input: string | URL | Request, _init?: RequestInit) =>
    String(input).includes("/access_tokens")
      ? Response.json({
        token: "ghs_installation",
        expires_at: "2099-01-01T00:00:00Z",
      })
      : Response.json({ total_count: repositories.length, repositories })
  );

describe("GitHub integration D1 state", () => {
  const db = env.DB;
  const firstOrganizationId = "11111111-1111-4111-8111-111111111111";
  const secondOrganizationId = "22222222-2222-4222-8222-222222222222";
  const thirdOrganizationId = "33333333-3333-4333-8333-333333333333";
  const fourthOrganizationId = "44444444-4444-4444-8444-444444444444";
  const ownerId = "github-integration-owner";
  const now = "2026-08-05T00:00:00.000Z";

  beforeAll(async () => {
    await db.prepare(
      `insert into user (id, name, email, emailVerified, createdAt, updatedAt)
       values (?, 'Owner', 'owner@example.com', 1, ?, ?)`,
    ).bind(ownerId, now, now).run();
    await db.prepare(
      `insert into "session" (
         id, expiresAt, token, createdAt, updatedAt, userId
       ) values ('github-integration-session', '2099-01-01T00:00:00.000Z',
                 'github-integration-session-token', ?, ?, ?)`,
    ).bind(now, now, ownerId).run();
    for (const [id, handle] of [
      [firstOrganizationId, "github-first"],
      [secondOrganizationId, "github-second"],
      [thirdOrganizationId, "github-third"],
      [fourthOrganizationId, "github-fourth"],
    ]) {
      await db.prepare(
        `insert into briar_organizations (
           id, name, handle, created_at, updated_at
         ) values (?, ?, ?, ?, ?)`,
      ).bind(id, handle, handle, now, now).run();
      await db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(id, ownerId, now, now).run();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rotates and consumes install and OAuth CSRF states exactly once", async () => {
    const installHash = "a".repeat(64);
    await createGithubOAuthState(db, {
      stateHash: installHash,
      organizationId: firstOrganizationId,
      userId: ownerId,
      pkceVerifier: "v".repeat(64),
      createdAt: now,
      expiresAt: "2026-08-05T00:10:00.000Z",
    });
    await expect(
      consumeGithubInstallState(
        db,
        installHash,
        "2026-08-05T00:05:00.000Z",
      ),
    ).resolves.toMatchObject({
      organization_id: firstOrganizationId,
      installation_id: null,
    });
    await expect(
      consumeGithubInstallState(
        db,
        installHash,
        "2026-08-05T00:05:00.000Z",
      ),
    ).resolves.toBeNull();

    const oauthHash = "b".repeat(64);
    await createGithubOAuthState(db, {
      stateHash: oauthHash,
      organizationId: firstOrganizationId,
      userId: ownerId,
      pkceVerifier: "w".repeat(64),
      installationId: 101,
      createdAt: now,
      expiresAt: "2026-08-05T00:10:00.000Z",
    });
    await expect(
      consumeGithubOAuthState(
        db,
        oauthHash,
        "2026-08-05T00:05:00.000Z",
      ),
    ).resolves.toMatchObject({
      organization_id: firstOrganizationId,
      installation_id: 101,
      pkce_verifier: "w".repeat(64),
    });
    await expect(
      consumeGithubOAuthState(
        db,
        oauthHash,
        "2026-08-05T00:05:00.000Z",
      ),
    ).resolves.toBeNull();
  });

  it("stores a verified installation and fails closed on mapping conflicts", async () => {
    const connected = await connectGithubInstallation(db, {
      organizationId: firstOrganizationId,
      installationId: 201,
      installationAccountId: 301,
      accountLogin: "example-org",
      accountAvatarUrl: "https://avatars.githubusercontent.com/u/301?v=4",
      authorizedGithubUserId: 401,
      authorizedGithubUserLogin: "octocat",
      connectedByUserId: ownerId,
      repositories: [{
        id: 501,
        owner: "example-org",
        name: "briar",
        fullName: "example-org/briar",
      }],
      observedAt: now,
    });
    expect(connected.outcome).toBe("connected");
    await expect(
      getGithubConnectionForOrganization(db, firstOrganizationId),
    ).resolves.toMatchObject({
      installation_id: 201,
      status: "connected",
      account_login: "example-org",
    });
    await expect(
      listGithubConnectionRepositories(db, 201),
    ).resolves.toEqual([
      expect.objectContaining({
        repository_id: 501,
        full_name: "example-org/briar",
      }),
    ]);
    await expect(syncGithubConnectionRepositories(db, {
      installationId: 201,
      added: [{
        id: 502,
        owner: "example-org",
        name: "worker",
        fullName: "example-org/worker",
      }],
      removedIds: [501],
      observedAt: "2026-08-05T00:01:00.000Z",
    })).resolves.toBe(true);
    await expect(listGithubConnectionRepositories(db, 201)).resolves.toEqual([
      expect.objectContaining({
        repository_id: 502,
        full_name: "example-org/worker",
      }),
    ]);

    await expect(connectGithubInstallation(db, {
      organizationId: firstOrganizationId,
      installationId: 202,
      installationAccountId: 302,
      accountLogin: "other-org",
      accountAvatarUrl: "https://avatars.githubusercontent.com/u/302?v=4",
      authorizedGithubUserId: 401,
      authorizedGithubUserLogin: "octocat",
      connectedByUserId: ownerId,
      repositories: [],
      observedAt: now,
    })).resolves.toEqual({ outcome: "organization_conflict" });

    await expect(connectGithubInstallation(db, {
      organizationId: secondOrganizationId,
      installationId: 201,
      installationAccountId: 301,
      accountLogin: "example-org",
      accountAvatarUrl: "https://avatars.githubusercontent.com/u/301?v=4",
      authorizedGithubUserId: 401,
      authorizedGithubUserLogin: "octocat",
      connectedByUserId: ownerId,
      repositories: [],
      observedAt: now,
    })).resolves.toEqual({ outcome: "installation_conflict" });
  });

  it("disconnects with a tombstone and clears repository access", async () => {
    await expect(
      disconnectGithubInstallation(
        db,
        firstOrganizationId,
        "2026-08-05T00:06:00.000Z",
      ),
    ).resolves.toBe(true);
    await expect(
      getGithubConnectionForOrganization(db, firstOrganizationId),
    ).resolves.toBeNull();
    await expect(getGithubConnectionByInstallation(db, 201)).resolves
      .toMatchObject({
        status: "disconnected",
        disconnected_at: "2026-08-05T00:06:00.000Z",
      });
    await expect(listGithubConnectionRepositories(db, 201)).resolves.toEqual([]);
  });

  it("keeps a concurrent OAuth callback from moving an installation", async () => {
    let conflictInjected = false;
    const racingDb = new Proxy(db, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!conflictInjected) {
              conflictInjected = true;
              await connectGithubInstallation(db, {
                organizationId: fourthOrganizationId,
                installationId: 230,
                installationAccountId: 330,
                accountLogin: "race-winner",
                accountAvatarUrl:
                  "https://avatars.githubusercontent.com/u/330?v=4",
                authorizedGithubUserId: 430,
                authorizedGithubUserLogin: "winner",
                connectedByUserId: ownerId,
                repositories: [{
                  id: 530,
                  owner: "race-winner",
                  name: "winner",
                  fullName: "race-winner/winner",
                }],
                observedAt: "2026-08-05T00:06:30.000Z",
              });
            }
            return db.batch(statements);
          };
        }
        const value = target[property as keyof D1Database];
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database;

    await expect(connectGithubInstallation(racingDb, {
      organizationId: thirdOrganizationId,
      installationId: 230,
      installationAccountId: 330,
      accountLogin: "race-loser",
      accountAvatarUrl: "https://avatars.githubusercontent.com/u/330?v=4",
      authorizedGithubUserId: 431,
      authorizedGithubUserLogin: "loser",
      connectedByUserId: ownerId,
      repositories: [{
        id: 531,
        owner: "race-loser",
        name: "loser",
        fullName: "race-loser/loser",
      }],
      observedAt: "2026-08-05T00:06:31.000Z",
    })).resolves.toEqual({ outcome: "installation_conflict" });
    await expect(getGithubConnectionByInstallation(db, 230)).resolves
      .toMatchObject({
        organization_id: fourthOrganizationId,
        account_login: "race-winner",
        status: "connected",
      });
    await expect(listGithubConnectionRepositories(db, 230)).resolves.toEqual([
      expect.objectContaining({
        repository_id: 530,
        full_name: "race-winner/winner",
      }),
    ]);
  });

  it("does not restore repository access when disconnect wins the race", async () => {
    await connectGithubInstallation(db, {
      organizationId: thirdOrganizationId,
      installationId: 231,
      installationAccountId: 331,
      accountLogin: "disconnect-race",
      accountAvatarUrl: "https://avatars.githubusercontent.com/u/331?v=4",
      authorizedGithubUserId: 431,
      authorizedGithubUserLogin: "disconnect-race-user",
      connectedByUserId: ownerId,
      repositories: [{
        id: 532,
        owner: "disconnect-race",
        name: "before",
        fullName: "disconnect-race/before",
      }],
      observedAt: "2026-08-05T00:06:40.000Z",
    });

    let disconnectInjected = false;
    const racingDb = new Proxy(db, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!disconnectInjected) {
              disconnectInjected = true;
              await disconnectGithubInstallationById(
                db,
                231,
                "2026-08-05T00:06:41.000Z",
              );
            }
            return db.batch(statements);
          };
        }
        const value = target[property as keyof D1Database];
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database;

    await expect(syncGithubConnectionRepositories(racingDb, {
      installationId: 231,
      added: [{
        id: 533,
        owner: "disconnect-race",
        name: "after",
        fullName: "disconnect-race/after",
      }],
      removedIds: [532],
      observedAt: "2026-08-05T00:06:42.000Z",
    })).resolves.toBe(false);
    await expect(getGithubConnectionByInstallation(db, 231)).resolves
      .toMatchObject({ status: "disconnected" });
    await expect(listGithubConnectionRepositories(db, 231)).resolves.toEqual([]);
  });

  it("tombstones every connection when a GitHub user revokes authorization", async () => {
    for (const [organizationId, installationId] of [
      [firstOrganizationId, 211],
      [secondOrganizationId, 212],
    ] as const) {
      await connectGithubInstallation(db, {
        organizationId,
        installationId,
        installationAccountId: installationId + 100,
        accountLogin: `account-${installationId}`,
        accountAvatarUrl:
          `https://avatars.githubusercontent.com/u/${installationId + 100}?v=4`,
        authorizedGithubUserId: 777,
        authorizedGithubUserLogin: "revoking-user",
        connectedByUserId: ownerId,
        repositories: [],
        observedAt: "2026-08-05T00:07:00.000Z",
      });
    }
    await expect(disconnectGithubInstallationsByAuthorizedUser(
      db,
      777,
      "2026-08-05T00:08:00.000Z",
    )).resolves.toBe(2);
    await expect(getGithubConnectionByInstallation(db, 211)).resolves
      .toMatchObject({ status: "disconnected" });
    await expect(getGithubConnectionByInstallation(db, 212)).resolves
      .toMatchObject({ status: "disconnected" });
  });

  it("rotates setup state before redirecting to GitHub user OAuth", async () => {
    const state = "install-csrf-state";
    const createdAt = new Date();
    await createGithubOAuthState(db, {
      stateHash: await githubSha256Hex(state),
      organizationId: firstOrganizationId,
      userId: ownerId,
      pkceVerifier: "x".repeat(64),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + 10 * 60_000).toISOString(),
    });
    const response = await worker.fetch(new Request(
      `https://briar.example/github/install/callback?state=${state}&installation_id=901`,
    ), {
      DB: db,
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
      GITHUB_APP_CLIENT_ID: "Iv1.client",
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: "test-private-key",
      GITHUB_APP_CLIENT_SECRET: "client-secret",
      GITHUB_APP_SLUG: "briar-app",
      GITHUB_CALLBACK_ORIGIN: "https://briar.example",
    } as never);

    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(location.searchParams.get("state")).not.toBe(state);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://briar.example/github/oauth/callback",
    );
    await expect(consumeGithubInstallState(
      db,
      await githubSha256Hex(state),
      new Date().toISOString(),
    )).resolves.toBeNull();
    await expect(consumeGithubOAuthState(
      db,
      await githubSha256Hex(location.searchParams.get("state")!),
      new Date().toISOString(),
    )).resolves.toMatchObject({ installation_id: 901 });
  });

  it("verifies OAuth installation access before completing a connection", async () => {
    const state = "oauth-csrf-state";
    const createdAt = new Date();
    await createGithubOAuthState(db, {
      stateHash: await githubSha256Hex(state),
      organizationId: firstOrganizationId,
      userId: ownerId,
      pkceVerifier: "y".repeat(64),
      installationId: 902,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + 10 * 60_000).toISOString(),
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://github.com/login/oauth/access_token") {
        return Response.json({
          access_token: "ghu_transient",
          token_type: "bearer",
          expires_in: 28_800,
        });
      }
      if (url.endsWith("/user")) {
        return Response.json({
          id: 802,
          login: "octocat",
          avatar_url: "https://avatars.githubusercontent.com/u/802?v=4",
        });
      }
      if (url.includes("/user/installations?")) {
        return Response.json({
          installations: [{
            id: 902,
            app_slug: "briar-app",
            account: {
              id: 702,
              login: "wordbricks",
              avatar_url: "https://avatars.githubusercontent.com/u/702?v=4",
            },
          }],
        });
      }
      return Response.json({
        repositories: [{
          id: 502,
          owner: { login: "wordbricks" },
          name: "briar",
          full_name: "wordbricks/briar",
        }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(new Request(
      `https://briar.example/github/oauth/callback?state=${state}&code=temporary-code`,
    ), {
      DB: db,
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
      GITHUB_APP_CLIENT_ID: "Iv1.client",
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: "test-private-key",
      GITHUB_APP_CLIENT_SECRET: "client-secret",
      GITHUB_APP_SLUG: "briar-app",
      GITHUB_CALLBACK_ORIGIN: "https://briar.example",
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("GitHub 연결 완료");
    await expect(
      getGithubConnectionForOrganization(db, firstOrganizationId),
    ).resolves.toMatchObject({
      installation_id: 902,
      account_login: "wordbricks",
      authorized_github_user_id: 802,
      status: "connected",
    });
    await expect(listGithubConnectionRepositories(db, 902)).resolves.toEqual([
      expect.objectContaining({
        repository_id: 502,
        full_name: "wordbricks/briar",
      }),
    ]);
  });

  it("reads repository access back from the App instead of trusting the stored snapshot", async () => {
    const env = { ...githubAppEnv(installationPrivateKeyPem()), DB: db };
    const fetchImpl = installationRepositoriesFetch([
      {
        id: 502,
        owner: { login: "wordbricks" },
        name: "briar",
        full_name: "wordbricks/briar",
      },
      {
        id: 503,
        owner: { login: "wordbricks" },
        name: "heydoti",
        full_name: "wordbricks/heydoti",
      },
    ]);

    const integration = await getGithubIntegrationApplication({
      db,
      env: env as never,
      organizationId: firstOrganizationId,
      userId: ownerId,
      fetchImpl: fetchImpl as never,
    });

    // "All repositories" installations never emit installation_repositories for
    // a repository created after the connection, so heydoti only shows up here
    // because the App itself was asked.
    expect(integration).toMatchObject({ connected: true });
    expect(
      integration.connected ? integration.repositories.map((r) => r.fullName) : [],
    ).toEqual(["wordbricks/briar", "wordbricks/heydoti"]);
    // The snapshot the team settings write validates against is updated too.
    await expect(listGithubConnectionRepositories(db, 902)).resolves.toEqual([
      expect.objectContaining({ repository_id: 502 }),
      expect.objectContaining({ repository_id: 503 }),
    ]);
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "https://api.github.com/app/installations/902/access_tokens",
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
      permissions: { metadata: "read" },
    });
  });

  it("drops a repository the App can no longer reach", async () => {
    const env = { ...githubAppEnv(installationPrivateKeyPem()), DB: db };
    const integration = await getGithubIntegrationApplication({
      db,
      env: env as never,
      organizationId: firstOrganizationId,
      userId: ownerId,
      fetchImpl: installationRepositoriesFetch([{
        id: 503,
        owner: { login: "wordbricks" },
        name: "heydoti",
        full_name: "wordbricks/heydoti",
      }]) as never,
    });

    expect(
      integration.connected ? integration.repositories.map((r) => r.id) : [],
    ).toEqual([503]);
    await expect(listGithubConnectionRepositories(db, 902)).resolves.toEqual([
      expect.objectContaining({ repository_id: 503 }),
    ]);
  });

  it("keeps the stored repositories when GitHub cannot be reached", async () => {
    const env = { ...githubAppEnv(installationPrivateKeyPem()), DB: db };
    const integration = await getGithubIntegrationApplication({
      db,
      env: env as never,
      organizationId: firstOrganizationId,
      userId: ownerId,
      fetchImpl: vi.fn(async () =>
        Response.json({ message: "Bad credentials" }, { status: 401 })
      ) as never,
    });

    expect(
      integration.connected ? integration.repositories.map((r) => r.id) : [],
    ).toEqual([503]);
    await expect(listGithubConnectionRepositories(db, 902)).resolves.toEqual([
      expect.objectContaining({ repository_id: 503 }),
    ]);
  });

});
