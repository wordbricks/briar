import * as SchemaIssue from "effect/SchemaIssue";
import {
  AutoHuntWorkflowValidationError,
} from "../../src/lib/auto-hunt-contract";
import {
  createAuth,
  type BriarAuth,
} from "./auth";
import { requireSession } from "./session-auth";
import { handleAccountRoute } from "./account-routes";
import { handleIssueConversationRoute } from "./issue-conversation-routes";
import { handleIssueCoreRoute } from "./issue-core-routes";
import { handleIssueReplyWorkerRoute } from "./issue-reply-worker-routes";
import { handleChannelMessageRoute } from "./channel-message-routes";
import { handleChannelOrganizationContextRoute } from "./channel-organization-context-routes";
import { handleChannelReplyResultRoute } from "./channel-reply-result-routes";
import { handleManagedComputerRoute } from "./managed-computer-routes";
import { handleProjectAgentRoute } from "./project-agent-routes";
import { handleProjectGithubRoute } from "./project-github-routes";
import { handlePublicRoute } from "./public-routes";
import { handleIncomingChannelWebhookRoute } from "./incoming-channel-webhook";
import { handleRealtimeRoute } from "./realtime-routes";
import {
  requireAgentProject,
  requireWorkerProjectBinding,
} from "./worker-route-auth";
import { handleRunAgentRoute } from "./run-agent-routes";
import { handleRunEvidenceRoute } from "./run-evidence-routes";
import { handleGithubPublicRoute } from "./github-integration-routes";
import {
  getProject,
} from "./db";
import { WorkerConflictError } from "./workers";
import { WorkerLifecycleConflictError } from "./worker-lifecycle-repository";
import {
  RequestDecodeError,
} from "./request-schema";
import { ManagedComputerServiceError } from "./managed-computer-service";
import {
  OrganizationAgentContextCursorError,
  OrganizationAgentContextPageTooLargeError,
} from "./organization-agent-context";
import {
  agentSkillConflictMessage,
} from "./agent-skills";
import { handleScheduledTask } from "./scheduled-task";
import { handleSlackAppPublicRoute } from "./slack-app-routes";
import { handleSlackEventPublicRoute } from "./slack-event-routes";
import { sha256 } from "./crypto-digest";
import {
  corsHeaders,
  HttpError,
  json,
} from "./http-response";
import { handleAppConnectRequest } from "./app-connect";
import {
  channelMutationOrganization,
  projectMutationProject,
  scheduleChannelRealtimePublish,
  scheduleInboxRealtimeFlush,
  scheduleProjectRealtimePublish,
} from "./realtime-scheduling";

const formatSchemaIssue = SchemaIssue.makeFormatterStandardSchemaV1();
const bearerToken = (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
};

async function requireRunExecutionProject(
  db: D1Database,
  request: Request,
  runId: string,
) {
  if (!bearerToken(request).startsWith("briar_worker_")) {
    return await requireAgentProject(db, request);
  }
  const run = await db
    .prepare(`select project_id, worker_id from briar_hunt_runs where id = ?`)
    .bind(runId)
    .first<{ project_id: string; worker_id: string | null }>();
  if (!run) throw new HttpError(404, "Run not found");
  const { binding } = await requireWorkerProjectBinding(
    db,
    request,
    run.project_id,
  );
  if (run.worker_id !== binding.id) {
    throw new HttpError(403, "Run is not assigned to this worker");
  }
  return run.project_id;
}

async function requireActiveWorkerRunClaim(
  db: D1Database,
  request: Request,
  runId: string,
) {
  const projectId = await requireRunExecutionProject(db, request, runId);
  const claimToken = request.headers.get("x-briar-claim-token");
  if (!claimToken?.startsWith("briar_claim_")) {
    throw new HttpError(409, "Active claim token is required");
  }
  const claimTokenHash = await sha256(claimToken);
  const authenticatedAt = new Date().toISOString();
  const active = await db
    .prepare(
      `select id from briar_hunt_runs
       where id = ? and project_id = ? and claim_token_hash = ?
         and lease_expires_at > ?
         and status not in ('completed', 'cancelled', 'blocked', 'failed')`,
    )
    .bind(runId, projectId, claimTokenHash, authenticatedAt)
    .first<{ id: string }>();
  if (!active) throw new HttpError(409, "Issue processing claim token is no longer active");
  return { projectId, claimTokenHash, authenticatedAt };
}

async function requireProjectAccess(
  auth: BriarAuth,
  db: D1Database,
  request: Request,
  projectId: string,
) {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer briar_agent_")) {
    const agentProjectId = await requireAgentProject(db, request);
    if (agentProjectId !== projectId)
      throw new HttpError(404, "Attachment not found");
    return;
  }
  const session = await requireSession(auth, request);
  if (!(await getProject(db, projectId, session.user.id))) {
    throw new HttpError(404, "Attachment not found");
  }
}

async function route(
  request: Request,
  auth: BriarAuth,
  db: D1Database,
  attachmentsBucket: R2Bucket,
  env: Env,
  context?: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);

  const accountResponse = await handleAccountRoute({
    request,
    auth,
    db,
    env,
  });
  if (accountResponse) return accountResponse;

  const managedComputerResponse = await handleManagedComputerRoute({
    request,
    db,
    env,
  });
  if (managedComputerResponse !== undefined) return managedComputerResponse;

  const realtimeResponse = await handleRealtimeRoute({
    request,
    db,
    env,
  });
  if (realtimeResponse !== undefined) return realtimeResponse;

  const channelMessageResponse = await handleChannelMessageRoute({
    request,
    url,
    auth,
    db,
    attachmentsBucket,
    env,
    context,
  });
  if (channelMessageResponse !== undefined) return channelMessageResponse;

  const projectGithubResponse = await handleProjectGithubRoute({
    request,
    url,
    auth,
    db,
    env,
  });
  if (projectGithubResponse !== undefined) return projectGithubResponse;

  const projectAgentResponse = await handleProjectAgentRoute({
    request,
    url,
    auth,
    db,
    attachmentsBucket,
  });
  if (projectAgentResponse !== undefined) return projectAgentResponse;

  const issueConversationResponse = await handleIssueConversationRoute({
    request,
    url,
    auth,
    db,
    attachmentsBucket,
    archivesBucket: env.ARCHIVES,
    requireRunExecutionProject,
    requireProjectAccess,
  });
  if (issueConversationResponse !== undefined) {
    return issueConversationResponse;
  }

  const runEvidenceResponse = await handleRunEvidenceRoute({
    request,
    url,
    auth,
    db,
    attachmentsBucket,
    archivesBucket: env.ARCHIVES,
    requireRunExecutionProject,
    requireProjectAccess,
  });
  if (runEvidenceResponse !== undefined) return runEvidenceResponse;

  const issueCoreResponse = await handleIssueCoreRoute({
    request,
    url,
    auth,
    db,
    attachmentsBucket,
  });
  if (issueCoreResponse !== undefined) return issueCoreResponse;

  const issueReplyWorkerResponse = await handleIssueReplyWorkerRoute({
    request,
    url,
    db,
    attachmentsBucket,
    env,
    context,
  });
  if (issueReplyWorkerResponse !== undefined) return issueReplyWorkerResponse;

  const channelOrganizationContextResponse =
    await handleChannelOrganizationContextRoute({
      request,
      url,
      db,
      env,
    });
  if (channelOrganizationContextResponse !== undefined) {
    return channelOrganizationContextResponse;
  }

  const channelReplyResultResponse = await handleChannelReplyResultRoute({
    request,
    url,
    db,
    attachmentsBucket,
    env,
    context,
  });
  if (channelReplyResultResponse !== undefined) {
    return channelReplyResultResponse;
  }

  const runAgentResponse = await handleRunAgentRoute({
    request,
    url,
    db,
    attachmentsBucket,
    requireActiveWorkerRunClaim: (runId) =>
      requireActiveWorkerRunClaim(db, request, runId),
  });
  if (runAgentResponse !== undefined) return runAgentResponse;

  throw new HttpError(404, "Not found");
}

export default {
  scheduled: handleScheduledTask,
  async fetch(
    request: Request,
    env: Env,
    ctx?: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    const publicResponse = await handlePublicRoute({ request, env });
    if (publicResponse) return publicResponse;

    const incomingChannelWebhookResponse =
      await handleIncomingChannelWebhookRoute({
        request,
        env,
        context: ctx,
      });
    if (incomingChannelWebhookResponse !== undefined) {
      return incomingChannelWebhookResponse;
    }
    const githubPublicResponse = await handleGithubPublicRoute({
      request,
      url,
      env,
      context: ctx,
    });
    if (githubPublicResponse !== undefined) return githubPublicResponse;

    const slackAppResponse = await handleSlackAppPublicRoute({
      request,
      url,
      env,
      context: ctx,
    });
    if (slackAppResponse !== undefined) return slackAppResponse;

    const slackEventResponse = await handleSlackEventPublicRoute({
      request,
      url,
      env,
      context: ctx,
    });
    if (slackEventResponse !== undefined) return slackEventResponse;

    try {
      const authOrigin = url.protocol === "wss:"
        ? `https://${url.host}`
        : url.protocol === "ws:"
          ? `http://${url.host}`
          : url.origin;
      const auth = createAuth(env, authOrigin, ctx);
      const connectResponse = await handleAppConnectRequest({
        request,
        auth,
        env,
        context: ctx,
        requireRunExecutionProject: (runId) =>
          requireRunExecutionProject(env.DB, request, runId),
      });
      // Connect uses POST for reads as well as writes. RPC implementations own
      // mutation scheduling instead of relying on the legacy HTTP verb fallback.
      if (connectResponse !== undefined) return connectResponse;
      const response = await route(
        request,
        auth,
        env.DB,
        env.ATTACHMENTS,
        env,
        ctx,
      );
      const organizationId = channelMutationOrganization(
        url.pathname,
        request.method,
        response.status,
      );
      if (organizationId) {
        scheduleChannelRealtimePublish(env, env.DB, organizationId, ctx);
      }
      const projectId = projectMutationProject(
        url.pathname,
        request.method,
        response.status,
      );
      if (projectId) {
        scheduleProjectRealtimePublish(env, env.DB, projectId, ctx);
      }
      if (
        !organizationId &&
        !projectId &&
        request.method !== "GET" &&
        request.method !== "HEAD"
      ) {
        scheduleInboxRealtimeFlush(env, env.DB, ctx);
      }
      return response;
    } catch (error) {
      const skillConflictMessage = agentSkillConflictMessage(error);
      if (skillConflictMessage) {
        return json({ message: skillConflictMessage }, 409);
      }
      if (error instanceof HttpError) {
        const body = { message: error.message };
        if (error.code) Object.assign(body, { code: error.code });
        return json(body, error.status);
      }
      if (error instanceof ManagedComputerServiceError) {
        return json(
          { message: error.message, code: error.code },
          error.status,
        );
      }
      if (error instanceof WorkerConflictError) {
        return json({ message: error.message }, 409);
      }
      if (error instanceof WorkerLifecycleConflictError) {
        return json({ message: error.message }, 409);
      }
      if (error instanceof OrganizationAgentContextCursorError) {
        return json({ message: error.message }, 400);
      }
      if (error instanceof OrganizationAgentContextPageTooLargeError) {
        return json({ message: error.message }, 413);
      }
      if (error instanceof RequestDecodeError) {
        return json({
          message: "Invalid request",
          issues: formatSchemaIssue(error.cause.issue).issues,
        }, 400);
      }
      if (error instanceof AutoHuntWorkflowValidationError) {
        return json({
          message: "Invalid checkpoint policy",
          code: "INVALID_CHECKPOINT_POLICY",
          issues: error.issues,
        }, 400);
      }
      console.error(
        JSON.stringify({
          message: "request failed",
          error: error instanceof Error ? error.message : String(error),
          method: request.method,
          path: url.pathname,
        }),
      );
      return json({ message: "Internal server error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
