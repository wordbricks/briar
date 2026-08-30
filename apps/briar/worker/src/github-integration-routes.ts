import * as SchemaIssue from "effect/SchemaIssue";
import type { BriarAuth } from "./auth";
import { hasOrganizationCapability } from "./organization-access";
import { getOrganizationRole } from "./organization-repository";
import {
  claimGithubDelivery,
  completeGithubDelivery,
  connectGithubInstallation,
  consumeGithubInstallState,
  consumeGithubOAuthState,
  createGithubOAuthState,
  disconnectGithubInstallationById,
  disconnectGithubInstallationsByAuthorizedUser,
  getGithubConnectionByInstallation,
  getGithubConnectionForOrganization,
  listGithubConnectionRepositories,
  releaseGithubDelivery,
  syncGithubConnectionRepositories,
  syncGithubPullRequest,
} from "./db";
import {
  exchangeGithubOAuthCode,
  githubOAuthStateTtlMs,
  githubPkceChallenge,
  githubSha256Hex,
  mergeQueueTailPullRequestNumber,
  parseGitHubWebhook,
  parseGitHubWebhookHeaders,
  randomGithubOAuthToken,
  verifyGithubOAuthInstallation,
  verifyGitHubWebhook,
} from "./github";
import { HttpError, json } from "./http-response";
import {
  integrationHtml as html,
  noStoreRedirect,
} from "./integration-http";
import {
  observeSignedMergedBatchPullRequest,
  recordSignedMergeGroupHead,
  recordSignedMergeQueuePullRequestObservation,
} from "./merge-batches";
import { reconcileMergeQueuePullRequest } from "./merge-queue-reconcile";
import { RequestDecodeError } from "./request-schema";
import { scheduleInboxRealtimeFlush } from "./realtime-scheduling";
import { requireSession } from "./session-auth";

const formatSchemaIssue = SchemaIssue.makeFormatterStandardSchemaV1();

const githubCallbackOrigin = (env: Env) => {
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

const githubConfigAvailable = (env: Env) =>
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

const githubOAuthRedirectUri = (origin: string) =>
  `${origin}/github/oauth/callback`;

async function readVerifiedGithubBody(request: Request, env: Env) {
  const maxBytes = 1_048_576;
  const webhookSecret = env.GITHUB_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw new HttpError(503, "GitHub integration is not configured");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new HttpError(400, "Invalid GitHub webhook content length");
    }
    if (declaredLength > maxBytes) {
      throw new HttpError(413, "GitHub webhook body is too large");
    }
  }
  if (!request.body) {
    throw new HttpError(400, "GitHub webhook body is required");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, "GitHub webhook body is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (bytes.byteLength > maxBytes) {
    throw new HttpError(413, "GitHub webhook body is too large");
  }
  if (!(await verifyGitHubWebhook(bytes, request.headers, webhookSecret))) {
    throw new HttpError(401, "Invalid GitHub webhook signature");
  }
  return bytes;
}

async function handleGithubWebhookRequest(request: Request, env: Env) {
  const rawBody = await readVerifiedGithubBody(request, env);
  const headers = parseGitHubWebhookHeaders(request.headers);
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw new HttpError(400, "Invalid GitHub webhook payload");
  }
  const event = parseGitHubWebhook(headers, payload);
  const claimedAt = new Date().toISOString();
  const staleBefore = new Date(Date.parse(claimedAt) - 5 * 60_000).toISOString();
  const action = event.event === "ping" ? null : event.action;
  const claimed = await claimGithubDelivery(env.DB, {
    deliveryId: event.deliveryId,
    eventName: event.event,
    action,
    claimedAt,
    staleBefore,
  });
  if (!claimed) return json({ ok: true, duplicate: true });

  try {
    if (event.event === "ping") {
      await completeGithubDelivery(
        env.DB,
        event.deliveryId,
        claimedAt,
        new Date().toISOString(),
      );
      return json({ ok: true, event: event.event });
    }
    if (event.event === "installation") {
      if (event.action === "deleted" || event.action === "suspend") {
        await disconnectGithubInstallationById(
          env.DB,
          event.installationId,
          claimedAt,
        );
      }
      await completeGithubDelivery(
        env.DB,
        event.deliveryId,
        claimedAt,
        new Date().toISOString(),
      );
      return json({ ok: true, event: event.event, action: event.action });
    }
    if (event.event === "installation_repositories") {
      const updated = await syncGithubConnectionRepositories(env.DB, {
        installationId: event.installationId,
        added: event.added,
        removedIds: event.removed.map((repository) => repository.id),
        observedAt: claimedAt,
      });
      await completeGithubDelivery(
        env.DB,
        event.deliveryId,
        claimedAt,
        new Date().toISOString(),
      );
      return json({
        ok: true,
        event: event.event,
        action: event.action,
        updated,
      });
    }
    if (event.event === "github_app_authorization") {
      if (event.action === "revoked") {
        await disconnectGithubInstallationsByAuthorizedUser(
          env.DB,
          event.githubUserId,
          claimedAt,
        );
      }
      await completeGithubDelivery(
        env.DB,
        event.deliveryId,
        claimedAt,
        new Date().toISOString(),
      );
      return json({ ok: true, event: event.event, action: event.action });
    }

    const connection = await getGithubConnectionByInstallation(
      env.DB,
      event.installationId,
    );
    if (event.event === "merge_group") {
      if (event.action !== "checks_requested") {
        await completeGithubDelivery(
          env.DB,
          event.deliveryId,
          claimedAt,
          new Date().toISOString(),
        );
        return json({
          ok: true,
          event: event.event,
          ignored: true,
          reason: "unsupported_action",
        });
      }
      const repositoryAccess = connection?.status === "connected"
        ? (await listGithubConnectionRepositories(
            env.DB,
            event.installationId,
          )).some((repository) =>
            repository.repository_id === event.repositoryId &&
            repository.full_name.toLowerCase() ===
              event.repositoryFullName.toLowerCase()
          )
        : false;
      const tailPullRequestNumber = mergeQueueTailPullRequestNumber(
        event.headRef,
        event.baseRef,
      );
      if (!repositoryAccess || tailPullRequestNumber === null) {
        await completeGithubDelivery(
          env.DB,
          event.deliveryId,
          claimedAt,
          new Date().toISOString(),
        );
        return json({
          ok: true,
          event: event.event,
          ignored: true,
          reason: !repositoryAccess
            ? "repository_unconnected"
            : "unsupported_base",
        });
      }
      const stored = await recordSignedMergeGroupHead(env.DB, {
        deliveryId: event.deliveryId,
        repositoryId: event.repositoryId,
        repository: event.repositoryFullName,
        baseBranch: "main",
        headRef: event.headRef,
        headSha: event.headSha,
        baseSha: event.baseSha,
        tailPullRequestNumber,
        receivedAt: claimedAt,
      });
      await completeGithubDelivery(
        env.DB,
        event.deliveryId,
        claimedAt,
        new Date().toISOString(),
      );
      return json({
        ok: true,
        event: event.event,
        stored: stored !== null,
        state: stored?.state ?? null,
      });
    }
    if (connection?.status === "disconnected") {
      await completeGithubDelivery(
        env.DB,
        event.deliveryId,
        claimedAt,
        new Date().toISOString(),
      );
      return json({
        ok: true,
        event: event.event,
        ignored: true,
        reason: "integration_disconnected",
      });
    }
    if (event.event === "issues") {
      // GitHub Issue mirroring is intentionally non-authoritative for the
      // Briar workflow. Accept the signed delivery without moving a run.
      await completeGithubDelivery(
        env.DB,
        event.deliveryId,
        claimedAt,
        new Date().toISOString(),
      );
      return json({ ok: true, event: event.event, matchedRunCount: 0 });
    }

    await recordSignedMergeQueuePullRequestObservation(env.DB, {
      deliveryId: event.deliveryId,
      repositoryId: event.repositoryId,
      pullRequestNumber: event.number,
      action: event.action,
      identityChanged: event.action === "synchronize" || event.baseBranchChanged,
      headSha: event.headSha,
      baseBranch: event.baseBranch,
      receivedAt: claimedAt,
    });
    const result = await syncGithubPullRequest(env.DB, {
      deliveryId: event.deliveryId,
      installationId: event.installationId,
      repositoryId: event.repositoryId,
      repository: event.repositoryFullName,
      pullRequestId: event.pullRequestId,
      pullRequestNodeId: event.pullRequestNodeId,
      pullRequestNumber: event.number,
      url: event.htmlUrl,
      state: event.state,
      draft: event.draft,
      headSha: event.headSha,
      baseSha: event.baseSha,
      baseBranch: event.baseBranch,
      mergeCommitSha: event.mergeCommitSha,
      openedAt: event.createdAt,
      closedAt: event.closedAt,
      mergedAt: event.mergedAt,
      providerUpdatedAt: event.providerUpdatedAt,
      linkedIssues: event.briarIssueLinks,
      actor: `github:${event.senderLogin}`,
      observedAt: claimedAt,
      organizationId: connection?.organization_id ?? null,
    });
    const mergeQueueReconciliation = await reconcileMergeQueuePullRequest(
      env.DB,
      {
        repositoryId: event.repositoryId,
        pullRequestNumber: event.number,
        observedAt: claimedAt,
      },
    );
    const mergeBatchObservation =
      event.state === "merged" && event.mergedAt
        ? await observeSignedMergedBatchPullRequest(env.DB, {
            deliveryId: event.deliveryId,
            repositoryId: event.repositoryId,
            pullRequestNumber: event.number,
            headSha: event.headSha,
            mergedAt: event.mergedAt,
          })
        : null;
    // The signed provider snapshot includes its exact Briar issue links. A PR
    // evidence request that commits after this handler can consume that
    // snapshot, so successful deliveries are safe to complete even when no
    // run link was visible during this request.
    await completeGithubDelivery(
      env.DB,
      event.deliveryId,
      claimedAt,
      new Date().toISOString(),
    );
    return json({
      ok: true,
      event: event.event,
      ...result,
      mergeQueueReconciliation,
      mergeBatchState: mergeBatchObservation?.batch?.state ?? null,
    });
  } catch (error) {
    await releaseGithubDelivery(env.DB, event.deliveryId, claimedAt);
    throw error;
  }
}


async function handleGithubInstallCallback(request: Request, env: Env) {
  const callbackOrigin = githubCallbackOrigin(env);
  if (!githubConfigAvailable(env) || !callbackOrigin) {
    return html(
      "GitHub 연결 실패",
      "Briar 서버의 GitHub App 환경 변수가 설정되지 않았습니다.",
      503,
    );
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const rawInstallationId = url.searchParams.get("installation_id");
  const installationId = rawInstallationId && /^\d+$/u.test(rawInstallationId)
    ? Number(rawInstallationId)
    : Number.NaN;
  if (!state || !Number.isSafeInteger(installationId) || installationId <= 0) {
    return html(
      "GitHub 연결 취소됨",
      "GitHub App 설치가 완료되지 않았거나 유효하지 않은 응답입니다.",
      400,
    );
  }

  const installState = await consumeGithubInstallState(
    env.DB,
    await githubSha256Hex(state),
    new Date().toISOString(),
  );
  if (!installState) {
    return html(
      "GitHub 연결 만료됨",
      "설치 링크가 만료되었거나 이미 사용되었습니다. Briar에서 다시 연결해 주세요.",
      400,
    );
  }

  const oauthState = randomGithubOAuthToken();
  const pkceVerifier = randomGithubOAuthToken();
  const createdAt = new Date();
  await createGithubOAuthState(env.DB, {
    stateHash: await githubSha256Hex(oauthState),
    organizationId: installState.organization_id,
    userId: installState.user_id,
    pkceVerifier,
    installationId,
    expiresAt: new Date(
      createdAt.getTime() + githubOAuthStateTtlMs,
    ).toISOString(),
    createdAt: createdAt.toISOString(),
  });
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", env.GITHUB_APP_CLIENT_ID!);
  authorizeUrl.searchParams.set(
    "redirect_uri",
    githubOAuthRedirectUri(callbackOrigin),
  );
  authorizeUrl.searchParams.set("state", oauthState);
  authorizeUrl.searchParams.set(
    "code_challenge",
    await githubPkceChallenge(pkceVerifier),
  );
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("prompt", "select_account");
  return noStoreRedirect(authorizeUrl.toString());
}

async function handleGithubOAuthCallback(request: Request, env: Env) {
  const callbackOrigin = githubCallbackOrigin(env);
  if (!githubConfigAvailable(env) || !callbackOrigin) {
    return html(
      "GitHub 연결 실패",
      "Briar 서버의 GitHub App 환경 변수가 설정되지 않았습니다.",
      503,
    );
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  if (!state || oauthError || !code) {
    return html(
      "GitHub 연결 취소됨",
      oauthError
        ? `GitHub이 연결을 완료하지 않았습니다 (${oauthError}).`
        : "유효하지 않은 OAuth 응답입니다.",
      400,
    );
  }

  const oauthState = await consumeGithubOAuthState(
    env.DB,
    await githubSha256Hex(state),
    new Date().toISOString(),
  );
  if (!oauthState?.installation_id) {
    return html(
      "GitHub 연결 만료됨",
      "인증 요청이 만료되었거나 이미 사용되었습니다. Briar에서 다시 연결해 주세요.",
      400,
    );
  }
  const role = await getOrganizationRole(
    env.DB,
    oauthState.organization_id,
    oauthState.user_id,
  );
  if (!hasOrganizationCapability(role, "development:manage")) {
    return html(
      "GitHub 연결 권한 없음",
      "조직 관리자 권한이 없어 GitHub 연결을 완료할 수 없습니다.",
      403,
    );
  }

  try {
    const authorization = await exchangeGithubOAuthCode({
      clientId: env.GITHUB_APP_CLIENT_ID!,
      clientSecret: env.GITHUB_APP_CLIENT_SECRET!,
      code,
      redirectUri: githubOAuthRedirectUri(callbackOrigin),
      codeVerifier: oauthState.pkce_verifier,
    });
    const verified = await verifyGithubOAuthInstallation({
      accessToken: authorization.access_token,
      installationId: oauthState.installation_id,
      appSlug: env.GITHUB_APP_SLUG!,
    });
    const result = await connectGithubInstallation(env.DB, {
      organizationId: oauthState.organization_id,
      installationId: verified.installation.id,
      installationAccountId: verified.installation.accountId,
      accountLogin: verified.installation.accountLogin,
      accountAvatarUrl: verified.installation.accountAvatarUrl,
      authorizedGithubUserId: verified.user.id,
      authorizedGithubUserLogin: verified.user.login,
      connectedByUserId: oauthState.user_id,
      repositories: verified.repositories,
      observedAt: new Date().toISOString(),
    });
    if (result.outcome !== "connected") {
      return html(
        "GitHub 연결 충돌",
        result.outcome === "organization_conflict"
          ? "이 Briar 조직에는 다른 GitHub 설치가 이미 연결되어 있습니다."
          : "이 GitHub 설치는 다른 Briar 조직에 이미 연결되어 있습니다.",
        409,
      );
    }
    return html(
      "GitHub 연결 완료",
      `${verified.installation.accountLogin}의 GitHub 저장소가 Briar에 연결되었습니다. 이 창을 닫고 Briar로 돌아가세요.`,
    );
  } catch (error) {
    console.error(JSON.stringify({
      message: "GitHub OAuth callback failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    return html(
      "GitHub 연결 실패",
      "GitHub 설치를 확인하거나 연결 정보를 저장하지 못했습니다. Briar에서 다시 연결해 주세요.",
      502,
    );
  }
}

export async function handleOrganizationGithubRoute(input: {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  env: Env;
}): Promise<Response | undefined> {
  const { request, url, auth, db, env } = input;

  const organizationGithubMatch = url.pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/integrations\/github$/u,
  );
  if (organizationGithubMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationGithubMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new HttpError(404, "Organization not found");
    }
    const connection = await getGithubConnectionForOrganization(
      db,
      organizationId,
    );
    if (!connection) {
      return json({
        configured: githubConfigAvailable(env),
        canManage: hasOrganizationCapability(role, "development:manage"),
        connected: false,
      });
    }
    const repositories = await listGithubConnectionRepositories(
      db,
      connection.installation_id,
    );
    return json({
      configured: githubConfigAvailable(env),
      canManage: hasOrganizationCapability(role, "development:manage"),
      connected: true,
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
    });
  }
  const organizationGithubInstallMatch = url.pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/integrations\/github\/install-url$/u,
  );
  if (organizationGithubInstallMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = organizationGithubInstallMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    if (!githubConfigAvailable(env)) {
      throw new HttpError(503, "GitHub integration is not configured");
    }
    if (await getGithubConnectionForOrganization(db, organizationId)) {
      throw new HttpError(409, "GitHub integration is already connected");
    }
    const state = randomGithubOAuthToken();
    const createdAt = new Date();
    await createGithubOAuthState(db, {
      stateHash: await githubSha256Hex(state),
      organizationId,
      userId: session.user.id,
      // This verifier is never disclosed or exchanged. The setup callback
      // consumes this state and rotates to a fresh state and PKCE verifier.
      pkceVerifier: randomGithubOAuthToken(),
      expiresAt: new Date(
        createdAt.getTime() + githubOAuthStateTtlMs,
      ).toISOString(),
      createdAt: createdAt.toISOString(),
    });
    const installUrl = new URL(
      `https://github.com/apps/${env.GITHUB_APP_SLUG!}/installations/new`,
    );
    installUrl.searchParams.set("state", state);
    return json({ installUrl: installUrl.toString() }, 201);
  }


  return undefined;
}

export async function handleGithubPublicRoute(input: {
  request: Request;
  url: URL;
  env: Env;
  context?: ExecutionContext;
}): Promise<Response | undefined> {
  const { request, url, env, context } = input;
  if (url.pathname === "/github/webhooks" && request.method === "POST") {
    try {
      const response = await handleGithubWebhookRequest(request, env);
      scheduleInboxRealtimeFlush(env, env.DB, context);
      return response;
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ message: error.message }, error.status);
      }
      if (error instanceof RequestDecodeError) {
        return json({
          message: "Invalid GitHub webhook",
          issues: formatSchemaIssue(error.cause.issue).issues,
        }, 400);
      }
      console.error(JSON.stringify({
        message: "GitHub webhook request failed",
        error: error instanceof Error ? error.message : String(error),
      }));
      return json({ message: "Internal server error" }, 500);
    }
  }
  if (url.pathname === "/github/install/callback" && request.method === "GET") {
    return handleGithubInstallCallback(request, env);
  }
  if (url.pathname === "/github/oauth/callback" && request.method === "GET") {
    return handleGithubOAuthCallback(request, env);
  }
  return undefined;
}
