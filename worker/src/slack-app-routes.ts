import { issueTitleAbsoluteMaxLength } from "../../src/lib/issue-title";
import type { BriarAuth } from "./auth";
import { canManageOrganization } from "./organization-access";
import { getOrganizationRole } from "./organization-repository";
import { decodeSlackOAuthInput } from "./account-organization-request-contract";
import {
  claimSlackEvent,
  completeSlackEvent,
  consumeSlackOAuthState,
  createSlackOAuthState,
  deleteSlackInstallation,
  getHuntRunForProject,
  getProject,
  getSlackInstallation,
  listSlackInstallations,
  releaseSlackEvent,
  updateSlackInstallationProject,
  upsertSlackInstallation,
} from "./db";
import { HttpError, corsHeaders, json } from "./http-response";
import { integrationHtml as html } from "./integration-http";
import { createIssueWithAttachments } from "./issue-write-service";
import { responseWithPostCommitCleanup } from "./post-commit-cleanup";
import {
  listOrganizationProjects,
  type ProjectRow,
} from "./project-repository";
import { readJson } from "./request-readers";
import { flushOrganizationInboxRealtimeOutbox } from "./realtime-scheduling";
import { requireSession } from "./session-auth";
import {
  buildSlackCreateIssueModal,
  buildSlackIssueCreatedMessage,
  callSlackApi,
  decryptSlackToken,
  downloadSlackIssueAttachments,
  encryptSlackToken,
  exchangeSlackOAuthCode,
  parseSlackCreateIssueSubmission,
  postSlackCommandResponse,
  randomUrlSafeToken,
  sha256Hex,
  slackBotScopes,
  slackCreateIssueCallbackId,
  slackCreateIssueBlocks,
  slackCreateIssueShortcutCallbackId,
  SlackCreateIssueValidationError,
  slackEventClaimTtlMs,
  slackOAuthStateTtlMs,
  type SlackCreateIssueSubmission,
} from "./slack";
import {
  processSlackRevocationQueue,
  slackConfigAvailable,
} from "./slack-revocations";
import { readVerifiedSlackBody } from "./slack-request";

const slackInstallationJson = (
  row: Awaited<ReturnType<typeof listSlackInstallations>>[number],
) => ({
  teamId: row.team_id,
  teamName: row.team_name,
  botUserId: row.bot_user_id,
  defaultProjectId: row.default_project_id,
  defaultProjectName: row.default_project_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const slackOAuthRedirectUri = (origin: string) =>
  `${origin}/slack/oauth/callback`;

const slackCommandMessage = (text: string) =>
  Response.json({ response_type: "ephemeral", text });

async function openSlackCreateIssueModal(
  input: {
    env: Env;
    teamId: string;
    userId: string;
    channelId: string | null;
    triggerId: string;
    responseUrl: string | null;
    initialTitle?: string;
  },
) {
  const { env, teamId, userId, channelId, triggerId, responseUrl } = input;
  let token: string | null = null;
  const notify = async (text: string) => {
    if (responseUrl) {
      await postSlackCommandResponse(responseUrl, text);
    } else if (token) {
      await callSlackApi("chat.postMessage", token, {
        channel: userId,
        text,
      });
    }
  };
  try {
    const installation = await getSlackInstallation(env.DB, teamId);
    if (!installation) {
      await notify("이 Slack 워크스페이스가 Briar에 연결되어 있지 않습니다.");
      return;
    }
    token = await decryptSlackToken(
      installation.encrypted_bot_token,
      installation.token_iv,
      env.SLACK_TOKEN_ENCRYPTION_KEY,
    );
    const projects = await listOrganizationProjects(
      env.DB,
      installation.organization_id,
    );
    if (projects.length === 0) {
      await notify(
        "이슈를 만들 Briar 프로젝트가 없습니다. 먼저 프로젝트를 만들어 주세요.",
      );
      return;
    }
    await callSlackApi("views.open", token, {
      trigger_id: triggerId,
      view: buildSlackCreateIssueModal({
        projects,
        defaultProjectId: installation.default_project_id,
        responseUrl,
        channelId,
        initialTitle: input.initialTitle,
      }),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Slack create issue modal failed",
        error: error instanceof Error ? error.message : String(error),
        teamId,
      }),
    );
    try {
      await notify(
        "Briar 이슈 생성 화면을 열지 못했습니다. Slack 연결을 새로고침한 뒤 다시 시도해 주세요.",
      );
    } catch {
      // The slash command has already been acknowledged.
    }
  }
}

export async function handleSlackCommandForm(
  form: URLSearchParams,
  env: Env,
  ctx?: ExecutionContext,
) {
  if (form.get("ssl_check") === "1") return new Response(null);
  if (form.get("command") !== "/create") {
    return slackCommandMessage("지원하지 않는 Slack 명령입니다.");
  }
  const teamId = form.get("team_id")?.trim() ?? "";
  const channelId = form.get("channel_id")?.trim() ?? "";
  const userId = form.get("user_id")?.trim() ?? "";
  const triggerId = form.get("trigger_id")?.trim() ?? "";
  const responseUrl = form.get("response_url")?.trim() ?? "";
  if (!teamId || !userId || !channelId || !triggerId || !responseUrl) {
    return slackCommandMessage("Slack 명령 정보를 확인할 수 없습니다.");
  }

  const processing = openSlackCreateIssueModal({
    env,
    teamId,
    userId,
    channelId,
    triggerId,
    responseUrl,
    initialTitle: form.get("text") ?? undefined,
  });
  if (ctx) ctx.waitUntil(processing);
  else await processing;
  return new Response(null);
}

async function handleSlackCommandRequest(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
) {
  return handleSlackCommandForm(
    new URLSearchParams(await readVerifiedSlackBody(request, env)),
    env,
    ctx,
  );
}

async function processSlackCreateIssueSubmission(
  env: Env,
  submission: SlackCreateIssueSubmission,
  project: ProjectRow,
  token: string,
) {
  const now = new Date();
  const eventId = `view_submission:${submission.viewId}`;
  const claimed = await claimSlackEvent(
    env.DB,
    submission.teamId,
    eventId,
    now.toISOString(),
    new Date(now.getTime() - slackEventClaimTtlMs).toISOString(),
  );
  if (!claimed) return;

  try {
    const attachments = await downloadSlackIssueAttachments(
      token,
      submission.fileIds,
    );
    const sourceKey = `slack-create:${submission.teamId}:${submission.viewId}`;
    const created = await createIssueWithAttachments({
      db: env.DB,
      attachmentsBucket: env.ATTACHMENTS,
      project,
      issue: {
        title: submission.title,
        description: submission.description,
        priority: null,
        status: "queued",
        checkpoints: [],
      },
      attachments,
      sourceKey,
      actor: `slack:${submission.userId}`,
      detail:
        submission.source === "shortcut"
          ? "Slack Briar shortcut으로 생성된 이슈가 처리를 기다리고 있습니다."
          : "Slack /create 명령으로 생성된 이슈가 처리를 기다리고 있습니다.",
      context: {
        origin:
          submission.source === "shortcut"
            ? "slack-shortcut"
            : "slack-command",
        slackTeamId: submission.teamId,
        slackChannelId: submission.channelId,
        slackUserId: submission.userId,
        slackViewId: submission.viewId,
      },
    });
    await completeSlackEvent(
      env.DB,
      submission.teamId,
      eventId,
      new Date().toISOString(),
    );
    try {
      const run = await getHuntRunForProject(
        env.DB,
        project.id,
        created.runId,
      );
      if (!run) {
        throw new Error("Created Slack issue is missing");
      }
      const text = buildSlackIssueCreatedMessage({
        title: submission.title,
        projectName: project.name,
        statusLabel: "작업 대기열",
        runNumber: run.run_number,
        issueKeyPrefix: project.issue_key_prefix,
      });
      if (submission.responseUrl) {
        await postSlackCommandResponse(submission.responseUrl, text);
      } else {
        await callSlackApi("chat.postMessage", token, {
          channel: submission.userId,
          text,
        });
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "Slack create issue confirmation failed",
          error: error instanceof Error ? error.message : String(error),
          teamId: submission.teamId,
          viewId: submission.viewId,
          runId: created.runId,
        }),
      );
    }
  } catch (error) {
    await releaseSlackEvent(env.DB, submission.teamId, eventId);
    console.error(
      JSON.stringify({
        message: "Slack create issue submission failed",
        error: error instanceof Error ? error.message : String(error),
        teamId: submission.teamId,
        viewId: submission.viewId,
      }),
    );
    try {
      const text =
        ":warning: 이슈를 만들지 못했습니다. 첨부파일 제한과 프로젝트 워크플로를 확인한 뒤 다시 시도해 주세요.";
      if (submission.responseUrl) {
        await postSlackCommandResponse(submission.responseUrl, text);
      } else {
        await callSlackApi("chat.postMessage", token, {
          channel: submission.userId,
          text,
        });
      }
    } catch {
      // The command response URL is best-effort after the modal is acknowledged.
    }
  }
}

async function handleSlackInteractionRequest(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
) {
  const form = new URLSearchParams(await readVerifiedSlackBody(request, env));
  const rawPayload = form.get("payload");
  if (!rawPayload) throw new HttpError(400, "Missing Slack interaction payload");
  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    throw new HttpError(400, "Invalid Slack interaction payload");
  }
  const root =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  const view =
    root?.view && typeof root.view === "object"
      ? (root.view as Record<string, unknown>)
      : null;
  if (
    root?.type === "shortcut" &&
    root.callback_id === slackCreateIssueShortcutCallbackId
  ) {
    const team =
      root.team && typeof root.team === "object"
        ? (root.team as Record<string, unknown>)
        : null;
    const user =
      root.user && typeof root.user === "object"
        ? (root.user as Record<string, unknown>)
        : null;
    const teamId = typeof team?.id === "string" ? team.id.trim() : "";
    const userId = typeof user?.id === "string" ? user.id.trim() : "";
    const triggerId =
      typeof root.trigger_id === "string" ? root.trigger_id.trim() : "";
    if (!teamId || !userId || !triggerId) {
      throw new HttpError(400, "Slack shortcut context is incomplete");
    }
    const processing = openSlackCreateIssueModal({
      env,
      teamId,
      userId,
      channelId: null,
      triggerId,
      responseUrl: null,
    });
    if (ctx) ctx.waitUntil(processing);
    else await processing;
    return new Response(null);
  }
  if (
    root?.type !== "view_submission" ||
    view?.callback_id !== slackCreateIssueCallbackId
  ) {
    return new Response(null);
  }

  let submission: SlackCreateIssueSubmission;
  try {
    submission = parseSlackCreateIssueSubmission(payload);
  } catch (error) {
    if (error instanceof SlackCreateIssueValidationError) {
      return Response.json({
        response_action: "errors",
        errors: { [error.blockId]: error.message },
      });
    }
    throw error;
  }
  const installation = await getSlackInstallation(env.DB, submission.teamId);
  if (!installation) {
    return Response.json({
      response_action: "errors",
      errors: {
        [slackCreateIssueBlocks.project]:
          "이 Slack 워크스페이스를 Briar에 다시 연결해 주세요.",
      },
    });
  }
  const project = (
    await listOrganizationProjects(env.DB, installation.organization_id)
  ).find((candidate) => candidate.id === submission.projectId);
  if (!project) {
    return Response.json({
      response_action: "errors",
      errors: {
        [slackCreateIssueBlocks.project]:
          "선택한 프로젝트를 사용할 수 없습니다.",
      },
    });
  }
  const token = await decryptSlackToken(
    installation.encrypted_bot_token,
    installation.token_iv,
    env.SLACK_TOKEN_ENCRYPTION_KEY,
  );
  const processing = processSlackCreateIssueSubmission(
    env,
    submission,
    project,
    token,
  ).finally(() =>
    flushOrganizationInboxRealtimeOutbox(env, env.DB).catch((error) => {
      console.error(JSON.stringify({
        message: "Inbox realtime flush after Slack submission failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    })
  );
  if (ctx) ctx.waitUntil(processing);
  else await processing;
  return new Response(null);
}

async function handleSlackOAuthCallback(request: Request, env: Env) {
  if (!slackConfigAvailable(env)) {
    return html(
      "Slack 연결 실패",
      "Briar 서버의 Slack 환경 변수가 설정되지 않았습니다.",
      503,
    );
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  if (!state || oauthError || !code) {
    return html(
      "Slack 연결 취소됨",
      oauthError
        ? `Slack이 연결을 완료하지 않았습니다 (${oauthError}).`
        : "유효하지 않은 OAuth 응답입니다.",
      400,
    );
  }
  const oauthState = await consumeSlackOAuthState(
    env.DB,
    await sha256Hex(state),
    new Date().toISOString(),
  );
  if (!oauthState) {
    return html(
      "Slack 연결 만료됨",
      "설치 링크가 만료되었거나 이미 사용되었습니다. Briar에서 다시 연결해 주세요.",
      400,
    );
  }

  try {
    const authorization = await exchangeSlackOAuthCode({
      clientId: env.SLACK_CLIENT_ID,
      clientSecret: env.SLACK_CLIENT_SECRET,
      code,
      redirectUri: slackOAuthRedirectUri(url.origin),
    });
    const encrypted = await encryptSlackToken(
      authorization.token,
      env.SLACK_TOKEN_ENCRYPTION_KEY,
    );
    await upsertSlackInstallation(env.DB, {
      teamId: authorization.teamId,
      teamName: authorization.teamName,
      organizationId: oauthState.organization_id,
      defaultProjectId: oauthState.default_project_id,
      botUserId: authorization.botUserId,
      encryptedBotToken: encrypted.encryptedToken,
      tokenIv: encrypted.iv,
      installedByUserId: oauthState.user_id,
      observedAt: new Date().toISOString(),
    });
    return html(
      "Slack 연결 완료",
      `${authorization.teamName} 워크스페이스가 Briar에 연결되었습니다. 이 창을 닫고 Slack에서 @Briar를 멘션해 보세요.`,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Slack OAuth callback failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return html(
      "Slack 연결 실패",
      "Slack 인증을 저장하지 못했습니다. Briar에서 다시 연결해 주세요.",
      502,
    );
  }
}


export async function handleOrganizationSlackRoute(input: {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  env: Env;
  context?: ExecutionContext;
}): Promise<Response | undefined> {
  const { request, url, auth, db, env, context } = input;

  const organizationSlackMatch = url.pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/slack$/u,
  );
  if (organizationSlackMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationSlackMatch[1],
      session.user.id,
    );
    if (!role) throw new HttpError(404, "Organization not found");
    const [projects, installations] = await Promise.all([
      listOrganizationProjects(db, organizationSlackMatch[1]),
      listSlackInstallations(db, organizationSlackMatch[1]),
    ]);
    return json({
      configured: slackConfigAvailable(env),
      canManage: canManageOrganization(role),
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
      })),
      installations: installations.map(slackInstallationJson),
    });
  }
  if (organizationSlackMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationSlackMatch[1],
      session.user.id,
    );
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    if (!slackConfigAvailable(env)) {
      throw new HttpError(503, "Slack integration is not configured");
    }
    const input = decodeSlackOAuthInput(await readJson(request));
    const project = await getProject(db, input.defaultProjectId, session.user.id);
    if (
      !project ||
      project.organization_id !== organizationSlackMatch[1]
    ) {
      throw new HttpError(404, "Project not found");
    }
    const state = randomUrlSafeToken();
    const createdAt = new Date();
    await createSlackOAuthState(db, {
      stateHash: await sha256Hex(state),
      organizationId: organizationSlackMatch[1],
      defaultProjectId: project.id,
      userId: session.user.id,
      expiresAt: new Date(
        createdAt.getTime() + slackOAuthStateTtlMs,
      ).toISOString(),
      createdAt: createdAt.toISOString(),
    });
    const installUrl = new URL("https://slack.com/oauth/v2/authorize");
    installUrl.searchParams.set("client_id", env.SLACK_CLIENT_ID);
    installUrl.searchParams.set("scope", slackBotScopes.join(","));
    installUrl.searchParams.set(
      "redirect_uri",
      slackOAuthRedirectUri(new URL(request.url).origin),
    );
    installUrl.searchParams.set("state", state);
    return json({ installUrl: installUrl.toString() }, 201);
  }

  const organizationSlackInstallationMatch = url.pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/slack\/installations\/([^/]+)$/u,
  );
  if (
    organizationSlackInstallationMatch &&
    (request.method === "PUT" || request.method === "DELETE")
  ) {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationSlackInstallationMatch[1],
      session.user.id,
    );
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const teamId = decodeURIComponent(
      organizationSlackInstallationMatch[2],
    );
    if (request.method === "DELETE") {
      const observedAt = new Date().toISOString();
      const outcome = await deleteSlackInstallation(db, {
        organizationId: organizationSlackInstallationMatch[1],
        teamId,
        actorUserId: session.user.id,
        observedAt,
      });
      if (outcome === "forbidden") {
        throw new HttpError(403, "Organization admin access required");
      }
      if (outcome === "not_found") {
        throw new HttpError(404, "Slack workspace not found");
      }
      // Credential durability is already committed. A missing encryption key
      // or Slack outage leaves the row due for scheduled retry instead of
      // risking credential loss; no OAuth/signing configuration is required.
      return responseWithPostCommitCleanup(
        new Response(null, { status: 204, headers: corsHeaders }),
        {
          context,
          operation: "slack_uninstall",
          observedAt,
          tasks: [{
            queue: "slack",
            run: () => processSlackRevocationQueue(db, env, observedAt, 1),
          }],
        },
      );
    }
    const input = decodeSlackOAuthInput(await readJson(request));
    const updated = await updateSlackInstallationProject(
      db,
      organizationSlackInstallationMatch[1],
      teamId,
      input.defaultProjectId,
    );
    if (!updated) {
      throw new HttpError(404, "Slack workspace or project not found");
    }
    const installations = await listSlackInstallations(
      db,
      organizationSlackInstallationMatch[1],
    );
    const installation = installations.find(
      (candidate) => candidate.team_id === teamId,
    );
    if (!installation) throw new HttpError(404, "Slack workspace not found");
    return json({ installation: slackInstallationJson(installation) });
  }


  return undefined;
}

export async function handleSlackAppPublicRoute(input: {
  request: Request;
  url: URL;
  env: Env;
  context?: ExecutionContext;
}): Promise<Response | undefined> {
  const { request, url, env, context } = input;
  if (url.pathname === "/slack/commands" && request.method === "POST") {
    try {
      return await handleSlackCommandRequest(request, env, context);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ message: error.message }, error.status);
      }
      console.error(JSON.stringify({
        message: "Slack command request failed",
        error: error instanceof Error ? error.message : String(error),
      }));
      return slackCommandMessage(
        "Briar 이슈 생성 화면을 열지 못했습니다. Slack 연결을 새로고침한 뒤 다시 시도해 주세요.",
      );
    }
  }
  if (url.pathname === "/slack/interactions" && request.method === "POST") {
    try {
      return await handleSlackInteractionRequest(request, env, context);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ message: error.message }, error.status);
      }
      console.error(JSON.stringify({
        message: "Slack interaction request failed",
        error: error instanceof Error ? error.message : String(error),
      }));
      return json({ message: "Internal server error" }, 500);
    }
  }
  if (url.pathname === "/slack/oauth/callback" && request.method === "GET") {
    return handleSlackOAuthCallback(request, env);
  }
  return undefined;
}
