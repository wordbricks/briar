import { Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
import { createIsolatedTestDatabase } from "./test-helpers/d1";

describe("GitHub integration D1 state", () => {
  let miniflare: Miniflare;
  let db: D1Database;
  const firstOrganizationId = "11111111-1111-4111-8111-111111111111";
  const secondOrganizationId = "22222222-2222-4222-8222-222222222222";
  const thirdOrganizationId = "33333333-3333-4333-8333-333333333333";
  const fourthOrganizationId = "44444444-4444-4444-8444-444444444444";
  const ownerId = "github-integration-owner";
  const now = "2026-08-05T00:00:00.000Z";

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({
      suite: "github-integration-db",
    });
    miniflare = database.miniflare;
    db = database.db;
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

  afterAll(async () => {
    await miniflare.dispose();
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

  it("serves the authenticated organization-scoped API contract", async () => {
    const env = {
      DB: db,
      BETTER_AUTH_SECRET: "briar-test-secret-that-is-at-least-32-characters",
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
      GITHUB_APP_CLIENT_ID: "Iv1.client",
      GITHUB_APP_CLIENT_SECRET: "client-secret",
      GITHUB_APP_SLUG: "briar-app",
      GITHUB_CALLBACK_ORIGIN: "https://briar.example",
    } as never;
    const headers = {
      authorization: "Bearer github-integration-session-token",
    };
    const statusResponse = await worker.fetch(new Request(
      `https://briar.example/organizations/${firstOrganizationId}/integrations/github`,
      { headers },
    ), env);

    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toMatchObject({
      configured: true,
      canManage: true,
      connected: true,
      accountLogin: "wordbricks",
      installationId: 902,
      repositories: [{
        id: 502,
        owner: "wordbricks",
        name: "briar",
        fullName: "wordbricks/briar",
      }],
    });

    const disconnectResponse = await worker.fetch(new Request(
      `https://briar.example/organizations/${firstOrganizationId}/integrations/github`,
      { method: "DELETE", headers },
    ), env);
    expect(disconnectResponse.status).toBe(204);

    const installResponse = await worker.fetch(new Request(
      `https://briar.example/organizations/${firstOrganizationId}/integrations/github/install-url`,
      { method: "POST", headers },
    ), env);
    expect(installResponse.status).toBe(201);
    const install = await installResponse.json() as { installUrl: string };
    const installUrl = new URL(install.installUrl);
    expect(installUrl.origin + installUrl.pathname).toBe(
      "https://github.com/apps/briar-app/installations/new",
    );
    expect(installUrl.searchParams.get("state")).toBeTruthy();
  });
});
