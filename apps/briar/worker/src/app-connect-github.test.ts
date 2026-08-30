import { generateKeyPairSync } from "node:crypto";
import {
  Code,
  ConnectError,
  createClient,
} from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  GitHubIntegrationService,
  GitHubPullRequestState,
  ProjectGitHubService,
} from "@briar/contracts/gen/briar/app/v1/github_pb";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { sha256 } from "./crypto-digest";
import {
  connectGithubInstallation,
  consumeGithubInstallState,
} from "./db";
import { githubSha256Hex } from "./github";
import worker from "./index";
import {
  createIsolatedTestDatabase,
  type IsolatedTestDatabase,
} from "./test-helpers/d1";

const installOrganizationId = "11111111-1111-4111-8111-111111111111";
const projectOrganizationId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const otherProjectId = "44444444-4444-4444-8444-444444444444";
const deviceId = "55555555-5555-4555-8555-555555555555";
const workerId = "github-connect-worker";
const ownerId = "github-connect-owner";
const viewerId = "github-connect-viewer";
const outsiderId = "github-connect-outsider";
const observedAt = "2026-08-31T01:00:00.000Z";
const ownerToken = "github-connect-owner-token";
const viewerToken = "github-connect-viewer-token";
const outsiderToken = "github-connect-outsider-token";
const agentToken = "briar_agent_github_connect_project";
const otherAgentToken = "briar_agent_github_connect_other";
const workerToken = "briar_worker_github_connect_device";
const installationId = 901;
const repositoryId = 701;
const repository = "wordbricks/briar";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({
  format: "pem",
  type: "pkcs8",
}).toString();

const workflow = JSON.stringify({
  version: 2,
  requirements: [],
  stages: [{ id: "implement", label: "Implement", required: true }],
  execution: { checkpoints: [] },
  completion: { requiredStages: ["implement"] },
});

describe("GitHub Connect services", () => {
  let database: IsolatedTestDatabase;
  let db: D1Database;

  const env = () => ({
    DB: db,
    ATTACHMENTS: {},
    ARCHIVES: {},
    BETTER_AUTH_SECRET: "briar-test-secret-that-is-at-least-32-characters",
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
    GITHUB_APP_CLIENT_ID: "Iv1.client",
    GITHUB_APP_ID: "12345",
    GITHUB_APP_PRIVATE_KEY: privateKeyPem,
    GITHUB_APP_CLIENT_SECRET: "client-secret",
    GITHUB_APP_SLUG: "briar-app",
    GITHUB_CALLBACK_ORIGIN: "https://briar.example",
  } as never);

  beforeAll(async () => {
    database = await createIsolatedTestDatabase({
      suite: "app-connect-github",
    });
    db = database.db;

    await db.batch([
      ...[
        [ownerId, "Owner", "github-owner@example.com"],
        [viewerId, "Viewer", "github-viewer@example.com"],
        [outsiderId, "Outsider", "github-outsider@example.com"],
      ].map(([id, name, email]) =>
        db.prepare(
          `insert into "user" (
             id, name, email, emailVerified, createdAt, updatedAt
           ) values (?, ?, ?, 1, ?, ?)`,
        ).bind(id, name, email, observedAt, observedAt)
      ),
      ...[
        [ownerId, ownerToken],
        [viewerId, viewerToken],
        [outsiderId, outsiderToken],
      ].map(([userId, token]) =>
        db.prepare(
          `insert into "session" (
             id, expiresAt, token, createdAt, updatedAt, userId
           ) values (?, '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
        ).bind(`session-${userId}`, token, observedAt, observedAt, userId)
      ),
      ...[
        [installOrganizationId, "github-install", "GitHub Install"],
        [projectOrganizationId, "github-project", "GitHub Project"],
      ].map(([id, handle, name]) =>
        db.prepare(
          `insert into briar_organizations (
             id, name, handle, created_at, updated_at
           ) values (?, ?, ?, ?, ?)`,
        ).bind(id, name, handle, observedAt, observedAt)
      ),
      ...[installOrganizationId, projectOrganizationId].flatMap(
        (organizationId) => [
          db.prepare(
            `insert into briar_organization_members (
               organization_id, user_id, role, created_at, updated_at
             ) values (?, ?, 'owner', ?, ?)`,
          ).bind(organizationId, ownerId, observedAt, observedAt),
          db.prepare(
            `insert into briar_organization_members (
               organization_id, user_id, role, created_at, updated_at
             ) values (?, ?, 'viewer', ?, ?)`,
          ).bind(organizationId, viewerId, observedAt, observedAt),
        ],
      ),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'GitHub Project', ?, ?, ?)`,
      ).bind(
        projectId,
        ownerId,
        projectOrganizationId,
        await sha256(agentToken),
        observedAt,
        observedAt,
      ),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Other Project', ?, ?, ?)`,
      ).bind(
        otherProjectId,
        ownerId,
        projectOrganizationId,
        await sha256(otherAgentToken),
        observedAt,
        observedAt,
      ),
      db.prepare(
        `insert into briar_project_settings (
           project_id, github_repository_id, github_repository,
           workflow_json, mandatory_checkpoints_json, created_at, updated_at
         ) values (?, ?, ?, ?, '[]', ?, ?)`,
      ).bind(
        projectId,
        repositoryId,
        repository,
        workflow,
        observedAt,
        observedAt,
      ),
      db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'GitHub Device', ?, 'online', ?, ?, ?)`,
      ).bind(
        deviceId,
        projectOrganizationId,
        ownerId,
        "a".repeat(64),
        observedAt,
        observedAt,
        observedAt,
      ),
      db.prepare(
        `insert into briar_execution_worker_credentials (
           device_id, token_hash, created_at
         ) values (?, ?, ?)`,
      ).bind(deviceId, await sha256(workerToken), observedAt),
      db.prepare(
        `insert into briar_execution_workers (
           id, project_id, label, host_fingerprint, agent_provider, state,
           last_heartbeat_at, created_at, updated_at, device_id
         ) values (?, ?, 'GitHub Worker', ?, 'codex', 'online', ?, ?, ?, ?)`,
      ).bind(
        workerId,
        projectId,
        "b".repeat(64),
        observedAt,
        observedAt,
        observedAt,
        deviceId,
      ),
    ]);

    await connectGithubInstallation(db, {
      organizationId: projectOrganizationId,
      installationId,
      installationAccountId: 301,
      accountLogin: "wordbricks",
      accountAvatarUrl: "https://example.com/avatar.png",
      authorizedGithubUserId: 401,
      authorizedGithubUserLogin: "octocat",
      connectedByUserId: ownerId,
      repositories: [{
        id: repositoryId,
        owner: "wordbricks",
        name: "briar",
        fullName: repository,
      }],
      observedAt,
    });
  }, 60_000);

  afterAll(async () => database.dispose());

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const transport = () => createConnectTransport({
    baseUrl: "https://briar.example",
    fetch: async (input, init) => worker.fetch(new Request(input, init), env()),
  });

  const integrationClient = () => createClient(
    GitHubIntegrationService,
    transport(),
  );

  const projectClient = () => createClient(ProjectGitHubService, transport());

  const options = (token: string) => ({
    headers: { authorization: `Bearer ${token}` },
  });

  const errorCode = async (operation: Promise<unknown>) => {
    const error = await operation.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConnectError);
    return (error as ConnectError).code;
  };

  it("scopes organization visibility and persists install state exactly once", async () => {
    const github = integrationClient();
    await expect(github.getGitHubIntegration(
      { organizationId: installOrganizationId },
      options(viewerToken),
    )).resolves.toMatchObject({
      configured: true,
      canManage: false,
      connected: false,
    });
    expect(await errorCode(github.getGitHubIntegration(
      { organizationId: installOrganizationId },
      options(outsiderToken),
    ))).toBe(Code.NotFound);
    expect(await errorCode(github.beginGitHubInstallation(
      { organizationId: installOrganizationId },
      options(viewerToken),
    ))).toBe(Code.PermissionDenied);

    let responseHeaders: Headers | undefined;
    const begun = await github.beginGitHubInstallation(
      { organizationId: installOrganizationId },
      {
        ...options(ownerToken),
        onHeader: (headers) => {
          responseHeaders = headers;
        },
      },
    );
    expect(responseHeaders?.get("cache-control")).toBe("private, no-store");
    const rawState = new URL(begun.installUrl).searchParams.get("state");
    expect(rawState).toBeTruthy();
    const stateHash = await githubSha256Hex(rawState!);
    await expect(consumeGithubInstallState(
      db,
      stateHash,
      new Date().toISOString(),
    )).resolves.toMatchObject({
      organization_id: installOrganizationId,
      user_id: ownerId,
    });
    await expect(consumeGithubInstallState(
      db,
      stateHash,
      new Date().toISOString(),
    )).resolves.toBeNull();
  });

  it("serves one repository-scoped secret to session, worker, and agent principals", async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({
        token: "installation-secret",
        expires_at: "2026-08-31T02:00:00.000Z",
        repositories: [{ id: repositoryId, full_name: repository }],
      }), { status: 201 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const github = projectClient();

    let responseHeaders: Headers | undefined;
    const sessionCredential = await github.createProjectGitHubCredential(
      { projectId },
      {
        ...options(ownerToken),
        onHeader: (headers) => {
          responseHeaders = headers;
        },
      },
    );
    expect(responseHeaders?.get("cache-control")).toBe("private, no-store");
    expect(sessionCredential.credential).toMatchObject({
      projectId,
      repositoryId: BigInt(repositoryId),
      repository,
      username: "x-access-token",
      password: "installation-secret",
    });
    await expect(github.createProjectGitHubCredential(
      { projectId },
      options(workerToken),
    )).resolves.toMatchObject({ credential: { projectId } });
    await expect(github.createProjectGitHubCredential(
      { projectId },
      options(agentToken),
    )).resolves.toMatchObject({ credential: { projectId } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await errorCode(github.createProjectGitHubCredential(
      { projectId },
      options(otherAgentToken),
    ))).toBe(Code.PermissionDenied);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid updates and repository drift before mapping provider failures", async () => {
    const github = projectClient();
    expect(await errorCode(github.updateGitHubPullRequest(
      { projectId, pullRequestNumber: 1n },
      options(ownerToken),
    ))).toBe(Code.InvalidArgument);
    expect(await errorCode(github.updateGitHubPullRequest(
      {
        projectId,
        pullRequestNumber: 1n,
        state: GitHubPullRequestState.MERGED,
      },
      options(ownerToken),
    ))).toBe(Code.InvalidArgument);

    await db.prepare(
      `update briar_project_settings
       set github_repository_id = 999
       where project_id = ?`,
    ).bind(projectId).run();
    expect(await errorCode(github.getProjectGitHubRepository(
      { projectId },
      options(ownerToken),
    ))).toBe(Code.FailedPrecondition);

    await db.prepare(
      `update briar_project_settings
       set github_repository_id = ?
       where project_id = ?`,
    ).bind(repositoryId, projectId).run();
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("/access_tokens")
        ? new Response(JSON.stringify({
          token: "installation-secret",
          expires_at: "2026-08-31T02:00:00.000Z",
          repositories: [{ id: repositoryId, full_name: repository }],
        }), { status: 201 })
        : Response.json({ message: "head is invalid" }, { status: 422 })
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await errorCode(github.createGitHubPullRequest(
      {
        projectId,
        title: "Open the pull request",
        head: "feature/connect-github",
        base: "main",
        body: "Connect owns the wire contract.",
      },
      options(ownerToken),
    ))).toBe(Code.FailedPrecondition);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
