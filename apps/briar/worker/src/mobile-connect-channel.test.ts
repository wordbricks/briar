import { createConnectRouter } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import {
  ChannelService,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/channel_pb";
import { describe, expect, it, vi } from "vitest";
import type { BriarAuth } from "./auth";
import {
  registerMobileChannelService,
  type MobileConnectChannelServices,
} from "./mobile-connect-channel";

const routeMocks = {
  message: vi.fn<MobileConnectChannelServices["handleMessageRoute"]>(),
  organization:
    vi.fn<MobileConnectChannelServices["handleOrganizationRoute"]>(),
  proposal: vi.fn<MobileConnectChannelServices["handleProposalRoute"]>(),
};

const organizationId = "11111111-1111-4111-8111-111111111111";
const channelId = "22222222-2222-4222-8222-222222222222";
const messageId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const agentId = "55555555-5555-4555-8555-555555555555";
const proposalId = "66666666-6666-4666-8666-666666666666";
const projectId = "77777777-7777-4777-8777-777777777777";
const skillId = "88888888-8888-4888-8888-888888888888";
const clientMessageId = "99999999-9999-4999-8999-999999999999";

const connectRequest = () => new Request(
  "https://api.example.test/briar.mobile.v1.ChannelService/CreateChannelMessage",
  {
    method: "POST",
    headers: {
      authorization: "Bearer session-token",
      "connect-protocol-version": "1",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      organizationId,
      channelId,
      clientMessageId,
      body: "Please create the issue",
      mentionedUserIds: [userId],
      mentionedAgentIds: [agentId],
      skillId,
      preferredDeviceId: "device-1",
    }),
  },
);

describe("mobile Channel Connect adapter", () => {
  it("registers every RPC and preserves message oneofs and invocation input", async () => {
    routeMocks.message.mockResolvedValueOnce(new Response(JSON.stringify({
      message: {
        id: messageId,
        channelId,
        parentMessageId: null,
        body: "Please create the issue",
        blocks: [{
          type: "header",
          text: { type: "plain_text", text: "Plan", emoji: true },
          block_id: "plan-header",
        }],
        author: {
          type: "user",
          id: userId,
          name: "Owner",
          email: "owner@example.com",
          image: null,
        },
        mentionedUserIds: [userId],
        mentionedAgentIds: [agentId],
        attachments: [],
        reactions: [{
          emoji: "👍",
          count: 1,
          userIds: [userId],
          people: [{ userId, name: "Owner", image: null }],
        }],
        replyCount: 0,
        lastReplyAt: null,
        replyAuthors: [],
        document: null,
        proposal: {
          id: proposalId,
          actionType: "request_issue_create",
          status: "pending",
          projectId,
          payload: {
            issue: {
              title: "Implement Connect",
              description: null,
              priority: 1,
              status: "backlog",
            },
            executeAfterCreate: true,
          },
          resultRunId: null,
          resultItems: [],
        },
        executionProposal: null,
        skillExecutionProposal: null,
        subscribers: [{
          userId,
          subscribedAt: "2026-08-30T01:02:02.000Z",
        }],
        createdAt: "2026-08-30T01:02:03.000Z",
        deletedAt: null,
      },
      agentReplies: [{
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        agentId,
        channelId,
        triggerMessageId: messageId,
        parentMessageId: messageId,
        replyMessageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        status: "queued",
        attempts: 0,
        error: null,
        createdAt: "2026-08-30T01:02:03.000Z",
        updatedAt: "2026-08-30T01:02:03.000Z",
      }],
    }), { headers: { "content-type": "application/json" } }));

    const router = createConnectRouter({
      connect: true,
      grpc: false,
      grpcWeb: false,
    });
    registerMobileChannelService(
      router,
      {
        request: connectRequest(),
        auth: {} as BriarAuth,
        db: {} as D1Database,
        attachmentsBucket: {} as R2Bucket,
        env: {} as Env,
      },
      {
        handleMessageRoute: routeMocks.message,
        handleOrganizationRoute: routeMocks.organization,
        handleProposalRoute: routeMocks.proposal,
      },
    );

    expect(router.handlers).toHaveLength(Object.keys(ChannelService.method).length);
    const handler = router.handlers.find((candidate) =>
      candidate.requestPath ===
        "/briar.mobile.v1.ChannelService/CreateChannelMessage"
    );
    expect(handler).toBeDefined();

    const response = await createFetchHandler(handler!)(connectRequest());

    expect(response.status).toBe(200);
    expect(routeMocks.message).toHaveBeenCalledOnce();
    const routed = routeMocks.message.mock.calls[0][0] as { request: Request };
    expect(routed.request.method).toBe("POST");
    expect(new URL(routed.request.url).pathname).toBe(
      `/organizations/${organizationId}/channels/${channelId}/messages`,
    );
    expect(routed.request.headers.get("authorization")).toBe("Bearer session-token");
    expect(await routed.request.json()).toEqual({
      clientMessageId,
      body: "Please create the issue",
      parentMessageId: null,
      mentionedUserIds: [userId],
      mentionedAgentIds: [agentId],
      skillId,
      preferredDeviceId: "device-1",
    });
    expect(await response.json()).toEqual({
      message: {
        id: messageId,
        channelId,
        body: "Please create the issue",
        blocks: [{
          header: {
            text: { kind: "KIND_PLAIN_TEXT", text: "Plan", emoji: true },
            blockId: "plan-header",
          },
        }],
        author: {
          kind: "KIND_USER",
          id: userId,
          name: "Owner",
          email: "owner@example.com",
        },
        mentionedUserIds: [userId],
        mentionedAgentIds: [agentId],
        reactions: [{
          emoji: "👍",
          count: 1,
          userIds: [userId],
          people: [{ userId, name: "Owner" }],
        }],
        proposal: {
          id: proposalId,
          status: "PROPOSAL_STATUS_PENDING",
          projectId,
          issue: {
            issue: {
              title: "Implement Connect",
              priority: 1,
              status: "RUN_STATUS_BACKLOG",
            },
            executeAfterCreate: true,
          },
        },
        subscribers: [{
          userId,
          subscribedAt: "2026-08-30T01:02:02Z",
        }],
        createdAt: "2026-08-30T01:02:03Z",
      },
      agentReplies: [{
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        agentId,
        channelId,
        triggerMessageId: messageId,
        parentMessageId: messageId,
        replyMessageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        status: "REPLY_JOB_STATUS_QUEUED",
        createdAt: "2026-08-30T01:02:03Z",
        updatedAt: "2026-08-30T01:02:03Z",
      }],
    });
  });
});
