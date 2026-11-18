import { createConnectRouter } from "@connectrpc/connect";
import {
  createFetchHandler,
  createMethodUrl,
} from "@connectrpc/connect/protocol";
import {
  RealtimeService,
} from "@briar/contracts/gen/briar/app/v1/realtime_control_pb";
import { describe, expect, it, vi } from "vitest";
import type { BriarAuth } from "./auth";
import { connectErrorInterceptor } from "./app-connect-errors";
import {
  type AppConnectRealtimeServices,
  registerAppRealtimeService,
} from "./app-connect-realtime";
import { requireConnectHandler } from "./test-helpers/connect";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const channelId = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";

const request = (body: unknown) => new Request(
  createMethodUrl(
    "https://api.example.test",
    RealtimeService.method.createRealtimeTicket,
  ),
  {
    method: "POST",
    headers: {
      authorization: "Bearer session-token",
      "connect-protocol-version": "1",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  },
);

const invoke = async (
  body: unknown,
  services: AppConnectRealtimeServices,
) => {
  const connectRequest = request(body);
  const router = createConnectRouter({
    connect: true,
    grpc: false,
    grpcWeb: false,
    interceptors: [connectErrorInterceptor],
  });
  registerAppRealtimeService(router, {
    request: connectRequest,
    auth: {} as BriarAuth,
    db: {} as D1Database,
    signingSecret: "signing-secret",
  }, services);
  const handler = requireConnectHandler(
    router.handlers,
    RealtimeService.method.createRealtimeTicket,
  );
  return createFetchHandler(handler)(connectRequest);
};

const authenticatedSession = {
  user: { id: userId },
} as never;

describe("app Realtime Connect adapter", () => {
  it("maps each oneof scope to its canonical WebSocket URL", async () => {
    const requireSession = vi.fn<AppConnectRealtimeServices["requireSession"]>()
      .mockResolvedValue(authenticatedSession);
    const createTicket = vi.fn<AppConnectRealtimeServices["createTicket"]>()
      .mockImplementation(async ({ scope }) => {
        switch (scope.type) {
          case "workspaceNotifications":
            return {
              socketPath: `/workspaces/${scope.workspaceId}/channel-events`,
              ticket: "workspace-ticket",
            };
          case "issueActivity":
            return {
              socketPath:
                `/projects/${scope.projectId}/runs/${scope.runId}/agent-activity-events`,
              ticket: "issue-ticket",
            };
          case "channelActivity":
            return {
              socketPath:
                `/workspaces/${scope.workspaceId}/channels/${scope.channelId}/agent-activity-events`,
              ticket: "channel-ticket",
            };
        }
      });
    const services = { createTicket, requireSession };

    const workspace = await invoke({
      workspaceNotifications: { workspaceId: workspaceId },
    }, services);
    expect(workspace.status).toBe(200);
    expect(await workspace.json()).toEqual({
      url:
        `wss://api.example.test/workspaces/${workspaceId}/channel-events?ticket=workspace-ticket`,
    });

    const issue = await invoke({ issueActivity: { projectId, runId } }, services);
    expect(issue.status).toBe(200);
    expect(await issue.json()).toEqual({
      url:
        `wss://api.example.test/projects/${projectId}/runs/${runId}/agent-activity-events?ticket=issue-ticket`,
    });

    const channel = await invoke({
      channelActivity: { workspaceId: workspaceId, channelId },
    }, services);
    expect(channel.status).toBe(200);
    expect(await channel.json()).toEqual({
      url:
        `wss://api.example.test/workspaces/${workspaceId}/channels/${channelId}/agent-activity-events?ticket=channel-ticket`,
    });
    expect(createTicket.mock.calls.map(([input]) => input.scope)).toEqual([
      { type: "workspaceNotifications", workspaceId },
      { type: "issueActivity", projectId, runId },
      { type: "channelActivity", workspaceId, channelId },
    ]);
  });

  it("authenticates before rejecting a missing scope", async () => {
    const requireSession = vi.fn<AppConnectRealtimeServices["requireSession"]>()
      .mockResolvedValue(authenticatedSession);
    const createTicket = vi.fn<AppConnectRealtimeServices["createTicket"]>();

    const response = await invoke({}, { createTicket, requireSession });

    expect(response.status).toBe(400);
    expect(requireSession).toHaveBeenCalledOnce();
    expect(createTicket).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ code: "invalid_argument" });
  });
});
