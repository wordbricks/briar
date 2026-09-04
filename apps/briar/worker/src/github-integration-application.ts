import { hasOrganizationCapability } from "./organization-access";
import { getOrganizationRole } from "./organization-repository";
import {
  createGithubOAuthState,
  getGithubConnectionForOrganization,
  listGithubConnectionRepositories,
  syncGithubConnectionRepositories,
} from "./db";
import { listGithubInstallationRepositories } from "./github-app-api";
import {
  githubOAuthStateTtlMs,
  githubSha256Hex,
  randomGithubOAuthToken,
} from "./github";
import { HttpError } from "./http-response";

export const githubCallbackOrigin = (env: Env) => {
  const value = env.GITHUB_CALLBACK_ORIGIN?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const isLocalhost = url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (
      (url.protocol !== "https:" && !(isLocalhost && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

export const githubConfigAvailable = (env: Env) =>
  Boolean(
    env.GITHUB_WEBHOOK_SECRET?.trim() &&
      env.GITHUB_APP_ID?.trim() &&
      env.GITHUB_APP_PRIVATE_KEY?.trim() &&
      env.GITHUB_APP_CLIENT_ID?.trim() &&
      env.GITHUB_APP_CLIENT_SECRET?.trim() &&
      /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/u.test(
        env.GITHUB_APP_SLUG?.trim() ?? "",
      ) &&
      githubCallbackOrigin(env),
  );

export const githubOAuthRedirectUri = (origin: string) =>
  `${origin}/github/oauth/callback`;

type OrganizationGithubApplicationInput = {
  readonly db: D1Database;
  readonly env: Env;
  readonly organizationId: string;
  readonly userId: string;
  readonly fetchImpl?: typeof fetch;
};

/**
 * Brings the stored repository snapshot back in line with what the App can
 * reach. Installations granted "All repositories" never announce a newly
 * created repository over the installation_repositories webhook, so without
 * this every caller that checks the snapshot rejects repositories the App does
 * have access to. A GitHub failure leaves the snapshot as it was rather than
 * emptying an organization's repository list.
 */
async function refreshedInstallationRepositories(
  input: {
    readonly db: D1Database;
    readonly env: Env;
    readonly installationId: number;
    readonly fetchImpl?: typeof fetch;
  },
) {
  const stored = await listGithubConnectionRepositories(
    input.db,
    input.installationId,
  );
  if (
    !input.env.GITHUB_APP_ID?.trim() || !input.env.GITHUB_APP_PRIVATE_KEY?.trim()
  ) {
    return stored;
  }
  try {
    const live = await listGithubInstallationRepositories(
      input.env,
      input.installationId,
      input.fetchImpl,
    );
    const liveIds = new Set(live.map((repository) => repository.id));
    await syncGithubConnectionRepositories(input.db, {
      installationId: input.installationId,
      added: live,
      removedIds: stored
        .filter((repository) => !liveIds.has(repository.repository_id))
        .map((repository) => repository.repository_id),
      observedAt: new Date().toISOString(),
    });
    return await listGithubConnectionRepositories(
      input.db,
      input.installationId,
    );
  } catch (error) {
    console.error(JSON.stringify({
      message: "GitHub installation repository refresh failed",
      installationId: input.installationId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return stored;
  }
}

export async function getGithubIntegrationApplication(
  input: OrganizationGithubApplicationInput,
) {
  const role = await getOrganizationRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  if (!hasOrganizationCapability(role, "organization:read")) {
    throw new HttpError(404, "Organization not found");
  }
  const connection = await getGithubConnectionForOrganization(
    input.db,
    input.organizationId,
  );
  const common = {
    configured: githubConfigAvailable(input.env),
    canManage: hasOrganizationCapability(role, "development:manage"),
  };
  if (!connection) return { ...common, connected: false as const };
  const repositories = await refreshedInstallationRepositories({
    db: input.db,
    env: input.env,
    installationId: connection.installation_id,
    fetchImpl: input.fetchImpl,
  });
  return {
    ...common,
    connected: true as const,
    accountLogin: connection.account_login,
    accountAvatarUrl: connection.account_avatar_url,
    installationId: connection.installation_id,
    repositories: repositories.map((repository) => ({
      id: repository.repository_id,
      owner: repository.owner,
      name: repository.name,
      fullName: repository.full_name,
    })),
    connectedAt: connection.connected_at,
  };
}

export async function beginGithubInstallationApplication(
  input: OrganizationGithubApplicationInput,
) {
  const role = await getOrganizationRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  if (!hasOrganizationCapability(role, "development:manage")) {
    throw new HttpError(403, "Development management permission required");
  }
  if (!githubConfigAvailable(input.env)) {
    throw new HttpError(503, "GitHub integration is not configured");
  }
  if (
    await getGithubConnectionForOrganization(input.db, input.organizationId)
  ) {
    throw new HttpError(409, "GitHub integration is already connected");
  }
  const state = randomGithubOAuthToken();
  const createdAt = new Date();
  await createGithubOAuthState(input.db, {
    stateHash: await githubSha256Hex(state),
    organizationId: input.organizationId,
    userId: input.userId,
    // The setup callback consumes this state and rotates to a fresh state and
    // PKCE verifier. This request-only verifier is never disclosed.
    pkceVerifier: randomGithubOAuthToken(),
    expiresAt: new Date(
      createdAt.getTime() + githubOAuthStateTtlMs,
    ).toISOString(),
    createdAt: createdAt.toISOString(),
  });
  const installUrl = new URL(
    `https://github.com/apps/${input.env.GITHUB_APP_SLUG!}/installations/new`,
  );
  installUrl.searchParams.set("state", state);
  return { installUrl: installUrl.toString() };
}
