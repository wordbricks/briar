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
import { handleIssueControlRoute } from "./issue-control-routes";
import { handleIssueReplyWorkerRoute } from "./issue-reply-worker-routes";
import { handleIssueProposalRoute } from "./issue-proposal-routes";
import { handleChannelMessageRoute } from "./channel-message-routes";
import { handleChannelOrganizationContextRoute } from "./channel-organization-context-routes";
import { handleChannelProposalRoute } from "./channel-proposal-routes";
import { handleChannelReplyClaimRoute } from "./channel-reply-claim-routes";
import { handleChannelReplyResultRoute } from "./channel-reply-result-routes";
import { handleChannelWebhookManagementRoute } from "./channel-webhook-management-routes";
import { handleManagedComputerRoute } from "./managed-computer-routes";
import { handleOrganizationChannelRoute } from "./organization-channel-routes";
import { handleOrganizationWorkerRoute } from "./organization-worker-routes";
import { handleOrganizationRoute } from "./organization-routes";
import { handleProjectAgentRoute } from "./project-agent-routes";
import { handleProjectAgentSessionRoute } from "./project-agent-session-routes";
import { handleProjectAgentTaskRoute } from "./project-agent-task-routes";
import { handleProjectAgentTaskWorkerRoute } from "./project-agent-task-worker-routes";
import { handleProjectCoreRoute } from "./project-core-routes";
import { handleProjectLinearRoute } from "./project-linear-routes";
import { handleProjectSettingsRoute } from "./project-settings-routes";
import { handleProjectWorkerRoute } from "./project-worker-routes";
import { handleQueueClaimRoute } from "./queue-claim-routes";
import { handlePublicRoute } from "./public-routes";
import { handleIncomingChannelWebhookRoute } from "./incoming-channel-webhook";
import { handleRealtimeRoute } from "./realtime-routes";
import {
  requireAgentProject,
  requireWorkerCredential,
  requireWorkerProjectBinding,
} from "./worker-route-auth";
import { handleMergeBatchRoute } from "./merge-batch-routes";
import { handleRunAgentRoute } from "./run-agent-routes";
import { handleRunEvidenceRoute } from "./run-evidence-routes";
import { handleTranscriptRoute } from "./transcript-routes";
import { handleExecutionWorkerRoute } from "./execution-worker-routes";
import { handleWorkerClaimRoute } from "./worker-claim-routes";
import {
  handleGithubPublicRoute,
  handleOrganizationGithubRoute,
} from "./github-integration-routes";
import { handleDashboardRoute } from "./dashboard-routes";
import {
  getProject,
} from "./db";
import {
  TranscriptLimitError,
  WorkerConflictError,
} from "./workers";
import { TranscriptRequestDecodeError } from "./transcript-request";
import {
  RequestDecodeError,
} from "./request-schema";
import {
  ProjectWorkflowInputError,
} from "./run-request-contract";
import { ManagedComputerServiceError } from "./managed-computer-service";
import {
  OrganizationAgentContextCursorError,
  OrganizationAgentContextPageTooLargeError,
} from "./organization-agent-context";
import {
  agentSkillConflictMessage,
} from "./agent-skills";
import { handleScheduledTask } from "./scheduled-task";
import {
  handleOrganizationSlackRoute,
  handleSlackAppPublicRoute,
} from "./slack-app-routes";
import { handleSlackEventPublicRoute } from "./slack-event-routes";
import { sha256 } from "./crypto-digest";
import { handleProjectAgentScheduleRoute } from "./project-agent-schedule-routes";
import {
  corsHeaders,
  HttpError,
  json,
} from "./http-response";
import {
  channelMutationOrganization,
  projectMutationProject,
  projectScheduleClaimMutation,
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
    attachmentsBucket,
    env,
    context,
  });
  if (accountResponse) return accountResponse;

  const managedComputerResponse = await handleManagedComputerRoute({
    request,
    auth,
    db,
    env,
  });
  if (managedComputerResponse !== undefined) return managedComputerResponse;

  const organizationResponse = await handleOrganizationRoute({
    request,
    url,
    auth,
    db,
  });
  if (organizationResponse !== undefined) return organizationResponse;

  const realtimeResponse = await handleRealtimeRoute({
    request,
    auth,
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
  });
  if (channelMessageResponse !== undefined) return channelMessageResponse;

  const organizationChannelResponse = await handleOrganizationChannelRoute({
    request,
    url,
    auth,
    db,
    attachmentsBucket,
    env,
    context,
  });
  if (organizationChannelResponse !== undefined) {
    return organizationChannelResponse;
  }

  const channelWebhookManagementResponse =
    await handleChannelWebhookManagementRoute({
      request,
      url,
      auth,
      db,
    });
  if (channelWebhookManagementResponse !== undefined) {
    return channelWebhookManagementResponse;
  }

  const channelProposalResponse = await handleChannelProposalRoute({
    request,
    url,
    auth,
    db,
    env,
  });
  if (channelProposalResponse !== undefined) return channelProposalResponse;

  const organizationWorkerResponse = await handleOrganizationWorkerRoute({
    request,
    url,
    auth,
    db,
    env,
  });
  if (organizationWorkerResponse !== undefined) {
    return organizationWorkerResponse;
  }

  const organizationGithubResponse = await handleOrganizationGithubRoute({
    request,
    url,
    auth,
    db,
    env,
  });
  if (organizationGithubResponse !== undefined) {
    return organizationGithubResponse;
  }

  const organizationSlackResponse = await handleOrganizationSlackRoute({
    request,
    url,
    auth,
    db,
    env,
    context,
  });
  if (organizationSlackResponse !== undefined) {
    return organizationSlackResponse;
  }

  const projectCoreResponse = await handleProjectCoreRoute({
    request,
    url,
    auth,
    db,
    attachmentsBucket,
    env,
    context,
  });
  if (projectCoreResponse !== undefined) return projectCoreResponse;

  const projectSettingsResponse = await handleProjectSettingsRoute({
    request,
    url,
    auth,
    db,
  });
  if (projectSettingsResponse !== undefined) return projectSettingsResponse;

  const projectAgentTaskResponse = await handleProjectAgentTaskRoute({
    request,
    url,
    auth,
    db,
    env,
    context,
  });
  if (projectAgentTaskResponse !== undefined) return projectAgentTaskResponse;

  const projectAgentSessionResponse = await handleProjectAgentSessionRoute({
    request,
    url,
    auth,
    db,
    env,
    context,
  });
  if (projectAgentSessionResponse !== undefined) {
    return projectAgentSessionResponse;
  }

  const projectAgentResponse = await handleProjectAgentRoute({
    request,
    url,
    auth,
    db,
    attachmentsBucket,
  });
  if (projectAgentResponse !== undefined) return projectAgentResponse;

  const projectAgentScheduleResponse =
    await handleProjectAgentScheduleRoute({
      request,
      db,
      env,
      context,
      requireSession: () => requireSession(auth, request),
    });
  if (projectAgentScheduleResponse) return projectAgentScheduleResponse;

  const projectLinearResponse = await handleProjectLinearRoute({
    request,
    url,
    auth,
    db,
  });
  if (projectLinearResponse !== undefined) return projectLinearResponse;

  const dashboardResponse = await handleDashboardRoute({
    request,
    url,
    auth,
    db,
    archivesBucket: env.ARCHIVES,
  });
  if (dashboardResponse !== undefined) return dashboardResponse;

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

  const issueProposalResponse = await handleIssueProposalRoute({
    request,
    url,
    auth,
    db,
    attachmentsBucket,
    archivesBucket: env.ARCHIVES,
  });
  if (issueProposalResponse !== undefined) return issueProposalResponse;

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
    archivesBucket: env.ARCHIVES,
    context,
  });
  if (issueCoreResponse !== undefined) return issueCoreResponse;

  const issueControlResponse = await handleIssueControlRoute({
    request,
    url,
    auth,
    db,
    archivesBucket: env.ARCHIVES,
  });
  if (issueControlResponse !== undefined) return issueControlResponse;

  const executionWorkerResponse = await handleExecutionWorkerRoute({
    request,
    url,
    auth,
    db,
    env,
    requireAgentProject: () => requireAgentProject(db, request),
    requireWorkerCredential: () => requireWorkerCredential(db, request),
    requireWorkerProjectBinding: (projectId) =>
      requireWorkerProjectBinding(db, request, projectId),
  });
  if (executionWorkerResponse !== undefined) return executionWorkerResponse;

  const transcriptResponse = await handleTranscriptRoute({
    request,
    url,
    db,
    env,
    requireAgentProject: () => requireAgentProject(db, request),
    requireWorkerProjectBinding: (projectId, workerId) =>
      requireWorkerProjectBinding(db, request, projectId, workerId),
    requireRunExecutionProject: (runId) =>
      requireRunExecutionProject(db, request, runId),
    requireProjectAccess: (projectId) =>
      requireProjectAccess(auth, db, request, projectId),
  });
  if (transcriptResponse !== undefined) return transcriptResponse;

  const projectWorkerResponse = await handleProjectWorkerRoute({
    request,
    url,
    db,
    requireProjectAccess: (projectId) =>
      requireProjectAccess(auth, db, request, projectId),
  });
  if (projectWorkerResponse !== undefined) return projectWorkerResponse;

  const mergeBatchResponse = await handleMergeBatchRoute({
    request,
    url,
    db,
    requireWorkerProjectBinding: (projectId, workerId) =>
      requireWorkerProjectBinding(db, request, projectId, workerId),
  });
  if (mergeBatchResponse !== undefined) return mergeBatchResponse;

  const workerClaimResponse = await handleWorkerClaimRoute({
    request,
    url,
    db,
    attachmentsBucket,
    env,
    context,
  });
  if (workerClaimResponse !== undefined) return workerClaimResponse;

  const issueReplyWorkerResponse = await handleIssueReplyWorkerRoute({
    request,
    url,
    db,
    attachmentsBucket,
    env,
    context,
  });
  if (issueReplyWorkerResponse !== undefined) return issueReplyWorkerResponse;

  const channelReplyClaimResponse = await handleChannelReplyClaimRoute({
    request,
    url,
    db,
    env,
    context,
  });
  if (channelReplyClaimResponse !== undefined) {
    return channelReplyClaimResponse;
  }

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

  const projectAgentTaskWorkerResponse =
    await handleProjectAgentTaskWorkerRoute({
      request,
      url,
      db,
      env,
      context,
    });
  if (projectAgentTaskWorkerResponse !== undefined) {
    return projectAgentTaskWorkerResponse;
  }

  const queueClaimResponse = await handleQueueClaimRoute({
    request,
    url,
    db,
    env,
  });
  if (queueClaimResponse !== undefined) return queueClaimResponse;

  const runAgentResponse = await handleRunAgentRoute({
    request,
    url,
    db,
    attachmentsBucket,
    env,
    requireRunExecutionProject: (runId) =>
      requireRunExecutionProject(db, request, runId),
    requireActiveWorkerRunClaim: (runId) =>
      requireActiveWorkerRunClaim(db, request, runId),
    requireAgentProject: () => requireAgentProject(db, request),
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
      const projectScheduleClaimHandled = projectScheduleClaimMutation(
        url.pathname,
        request.method,
        response.status,
      );
      if (
        !organizationId &&
        !projectId &&
        !projectScheduleClaimHandled &&
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
        return json(
          {
            message: error.message,
            ...(error.code ? { code: error.code } : {}),
          },
          error.status,
        );
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
      if (error instanceof TranscriptLimitError) {
        return json({ message: error.message }, 413);
      }
      if (error instanceof OrganizationAgentContextCursorError) {
        return json({ message: error.message }, 400);
      }
      if (error instanceof OrganizationAgentContextPageTooLargeError) {
        return json({ message: error.message }, 413);
      }
      if (error instanceof TranscriptRequestDecodeError) {
        return json({
          message: "Invalid request",
          issues: formatSchemaIssue(error.cause.issue).issues,
        }, 400);
      }
      if (error instanceof RequestDecodeError) {
        return json({
          message: "Invalid request",
          issues: formatSchemaIssue(error.cause.issue).issues,
        }, 400);
      }
      if (error instanceof ProjectWorkflowInputError) {
        return json({
          message: error.message,
          code: error.code,
          issues: error.issues,
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
