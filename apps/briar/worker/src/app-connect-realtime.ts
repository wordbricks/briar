import { create } from "@bufbuild/protobuf";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import {
  CreateRealtimeTicketResponseSchema,
  RealtimeService,
} from "@briar/contracts/gen/briar/app/v1/realtime_control_pb";
import type { BriarAuth } from "./auth";

import { HttpError } from "./http-response";
import {
  createRealtimeTicketApplication,
  RealtimeTicketApplicationError,
  type RealtimeTicketScope,
} from "./realtime-ticket-application";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";

export type AppConnectRealtimeInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
  readonly signingSecret: string;
};

export type AppConnectRealtimeServices = {
  readonly createTicket: typeof createRealtimeTicketApplication;
  readonly requireSession: typeof requireSession;
};

const appConnectRealtimeServices: AppConnectRealtimeServices = {
  createTicket: createRealtimeTicketApplication,
  requireSession,
};

const canonicalUuid = (value: string) =>
  decodeRequestSync(UuidString)(value).toLowerCase();

const ticketScope = (
  request: Parameters<ServiceImpl<typeof RealtimeService>["createRealtimeTicket"]>[0],
): RealtimeTicketScope => {
  switch (request.scope.case) {
    case "organizationNotifications":
      return {
        type: "organizationNotifications",
        organizationId: canonicalUuid(request.scope.value.organizationId),
      };
    case "issueActivity":
      return {
        type: "issueActivity",
        projectId: canonicalUuid(request.scope.value.projectId),
        runId: canonicalUuid(request.scope.value.runId),
      };
    case "channelActivity":
      return {
        type: "channelActivity",
        organizationId: canonicalUuid(request.scope.value.organizationId),
        channelId: canonicalUuid(request.scope.value.channelId),
      };
    case undefined:
      throw new ConnectError("Realtime ticket scope is required", Code.InvalidArgument);
  }
};

const socketUrl = (
  requestUrl: string,
  issued: Awaited<ReturnType<typeof createRealtimeTicketApplication>>,
) => {
  const url = new URL(requestUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else throw new ConnectError("Unsupported realtime origin", Code.Internal);
  url.pathname = issued.socketPath;
  url.search = "";
  url.searchParams.set("ticket", issued.ticket);
  return url.toString();
};

const throwApplicationError = (error: unknown): never => {
  if (!(error instanceof RealtimeTicketApplicationError)) throw error;
  throw new HttpError(404, error.message);
};

export function createAppRealtimeService(
  input: AppConnectRealtimeInput,
  services: AppConnectRealtimeServices = appConnectRealtimeServices,
): ServiceImpl<typeof RealtimeService> {
  return {
    createRealtimeTicket: async (request) => {
      const session = await services.requireSession(input.auth, input.request);
      let issued: Awaited<ReturnType<typeof createRealtimeTicketApplication>>;
      try {
        issued = await services.createTicket({
          db: input.db,
          signingSecret: input.signingSecret,
          userId: session.user.id,
          scope: ticketScope(request),
        });
      } catch (error) {
        return throwApplicationError(error);
      }
      return create(CreateRealtimeTicketResponseSchema, {
        url: socketUrl(input.request.url, issued),
      });
    },
  };
}

export function registerAppRealtimeService(
  router: ConnectRouter,
  input: AppConnectRealtimeInput,
  services: AppConnectRealtimeServices = appConnectRealtimeServices,
) {
  router.service(RealtimeService, createAppRealtimeService(input, services));
}
