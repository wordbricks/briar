import { createConnectRouter } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import type { BriarAuth } from "./auth";
import { withCorsHeaders } from "./http-response";
import { registerAppAccountService } from "./app-connect-account";
import { registerAppAgentService } from "./app-connect-agent";
import { registerAppChannelService } from "./app-connect-channel";
import { registerAppDashboardService } from "./app-connect-dashboard";
import { registerAppFleetService } from "./app-connect-fleet";
import { registerAppInboxService } from "./app-connect-inbox";
import { registerAppIssueService } from "./app-connect-issue";
import { registerAppMergeQueueService } from "./app-connect-merge-queue";
import { registerAppOrganizationService } from "./app-connect-organization";
import { registerAppReportingService } from "./app-connect-reporting";
import { registerAppRealtimeService } from "./app-connect-realtime";
import {
  appConnectProjectServices,
  type AppConnectProjectServices,
  registerAppProjectService,
} from "./app-connect-project";
import { registerWorkerExecutionService } from "./worker-connect-execution";
import { registerWorkerQueueService } from "./worker-connect-queue";

export type AppConnectRouteInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly env: Env;
  readonly context?: ExecutionContext;
  readonly requireRunExecutionProject: (runId: string) => Promise<string>;
};

export type AppConnectServices = AppConnectProjectServices;

/** Serve a generated Connect RPC when the request targets a registered method. */
export async function handleAppConnectRequest(
  input: AppConnectRouteInput,
  services: AppConnectServices = appConnectProjectServices,
): Promise<Response | undefined> {
  const router = createConnectRouter({
    connect: true,
    grpc: false,
    grpcWeb: false,
  });
  registerAppProjectService(router, {
    request: input.request,
    auth: input.auth,
    db: input.env.DB,
    env: input.env,
    context: input.context,
  }, services);
  const sharedInput = {
    request: input.request,
    auth: input.auth,
    db: input.env.DB,
  };
  registerAppAccountService(router, sharedInput);
  registerAppOrganizationService(router, sharedInput);
  registerAppMergeQueueService(router, sharedInput);
  registerAppReportingService(router, sharedInput);
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
  registerAppFleetService(router, {
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
  registerAppRealtimeService(router, {
    ...sharedInput,
    signingSecret: input.env.BETTER_AUTH_SECRET,
  });
  registerWorkerQueueService(router, {
    request: input.request,
    db: input.env.DB,
    env: input.env,
    context: input.context,
  });
  registerWorkerExecutionService(router, {
    request: input.request,
    db: input.env.DB,
    env: input.env,
    archivesBucket: input.env.ARCHIVES,
    requireRunExecutionProject: input.requireRunExecutionProject,
  });

  const pathname = new URL(input.request.url).pathname;
  const handler = router.handlers.find(
    (candidate) => candidate.requestPath === pathname,
  );
  if (!handler) return undefined;

  const response = await createFetchHandler(handler)(input.request);
  return withCorsHeaders(response);
}
