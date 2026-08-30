import { createConnectRouter } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import {
  ProjectService,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/project_pb";
import type { BriarAuth } from "./auth";
import { withCorsHeaders } from "./http-response";
import { registerMobileAccountService } from "./mobile-connect-account";
import { registerMobileAgentService } from "./mobile-connect-agent";
import { registerMobileChannelService } from "./mobile-connect-channel";
import { registerMobileDashboardService } from "./mobile-connect-dashboard";
import { withConnectErrors } from "./mobile-connect-errors";
import { registerMobileInboxService } from "./mobile-connect-inbox";
import { registerMobileIssueService } from "./mobile-connect-issue";
import { mobileProject } from "./mobile-connect-mappers";
import { listProjects } from "./project-repository";
import { requireSession } from "./session-auth";

export type MobileConnectRouteInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly env: Env;
  readonly context?: ExecutionContext;
};

export type MobileConnectServices = {
  readonly requireSession: typeof requireSession;
  readonly listProjects: typeof listProjects;
};

const mobileConnectServices: MobileConnectServices = {
  requireSession,
  listProjects,
};

const createProjectService = (
  { request, auth, env }: MobileConnectRouteInput,
  services: MobileConnectServices,
) => ({
  listProjects: async () => withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const rows = await services.listProjects(env.DB, session.user.id);
      return {
        projects: rows.map(mobileProject),
      };
    }),
});

/** Serve a generated Connect RPC when the request targets a registered method. */
export async function handleMobileConnectRequest(
  input: MobileConnectRouteInput,
  services: MobileConnectServices = mobileConnectServices,
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
  registerMobileAccountService(router, sharedInput);
  registerMobileDashboardService(router, {
    ...sharedInput,
    archivesBucket: input.env.ARCHIVES,
  });
  registerMobileInboxService(router, {
    ...sharedInput,
    env: input.env,
    context: input.context,
  });
  registerMobileIssueService(router, {
    ...sharedInput,
    env: input.env,
    context: input.context,
  });
  registerMobileAgentService(router, {
    ...sharedInput,
    env: input.env,
    context: input.context,
  });
  registerMobileChannelService(router, {
    ...sharedInput,
    attachmentsBucket: input.env.ATTACHMENTS,
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
