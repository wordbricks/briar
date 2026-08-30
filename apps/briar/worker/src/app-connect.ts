import { createConnectRouter } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import { ProjectService } from "@briar/contracts/gen/briar/app/v1/project_pb";
import type { BriarAuth } from "./auth";
import { withCorsHeaders } from "./http-response";
import { registerAppAccountService } from "./app-connect-account";
import { registerAppAgentService } from "./app-connect-agent";
import { registerAppChannelService } from "./app-connect-channel";
import { registerAppDashboardService } from "./app-connect-dashboard";
import { withConnectErrors } from "./app-connect-errors";
import { registerAppInboxService } from "./app-connect-inbox";
import { registerAppIssueService } from "./app-connect-issue";
import { appProject } from "./app-connect-mappers";
import { listProjects } from "./project-repository";
import { requireSession } from "./session-auth";
import { registerWorkerQueueService } from "./worker-connect-queue";

export type AppConnectRouteInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly env: Env;
  readonly context?: ExecutionContext;
};

export type AppConnectServices = {
  readonly requireSession: typeof requireSession;
  readonly listProjects: typeof listProjects;
};

const appConnectServices: AppConnectServices = {
  requireSession,
  listProjects,
};

const createProjectService = (
  { request, auth, env }: AppConnectRouteInput,
  services: AppConnectServices,
) => ({
  listProjects: async () =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const rows = await services.listProjects(env.DB, session.user.id);
      return {
        projects: rows.map(appProject),
      };
    }),
});

/** Serve a generated Connect RPC when the request targets a registered method. */
export async function handleAppConnectRequest(
  input: AppConnectRouteInput,
  services: AppConnectServices = appConnectServices,
): Promise<Response | undefined> {
  const router = createConnectRouter({
    connect: true,
    grpc: false,
    grpcWeb: false,
  });
  router.service(ProjectService, createProjectService(input, services));
  const sharedInput = {
    request: input.request,
    auth: input.auth,
    db: input.env.DB,
  };
  registerAppAccountService(router, sharedInput);
  registerAppDashboardService(router, {
    ...sharedInput,
    archivesBucket: input.env.ARCHIVES,
  });
  registerAppInboxService(router, {
    ...sharedInput,
    env: input.env,
    context: input.context,
  });
  registerAppIssueService(router, {
    ...sharedInput,
    env: input.env,
    context: input.context,
  });
  registerAppAgentService(router, {
    ...sharedInput,
    env: input.env,
    context: input.context,
  });
  registerAppChannelService(router, {
    ...sharedInput,
    attachmentsBucket: input.env.ATTACHMENTS,
    env: input.env,
    context: input.context,
  });
  registerWorkerQueueService(router, {
    request: input.request,
    db: input.env.DB,
    env: input.env,
    context: input.context,
  });

  const pathname = new URL(input.request.url).pathname;
  const handler = router.handlers.find(
    (candidate) => candidate.requestPath === pathname,
  );
  if (!handler) return undefined;

  const response = await createFetchHandler(handler)(input.request);
  return withCorsHeaders(response);
}
