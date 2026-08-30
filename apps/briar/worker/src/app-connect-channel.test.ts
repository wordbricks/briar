import { createConnectRouter } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import {
  ChannelService,
} from "@briar/contracts/gen/briar/app/v1/channel_pb";
import { describe, expect, it, vi } from "vitest";
import type { BriarAuth } from "./auth";
import {
  appConnectChannelServices,
  registerAppChannelService,
  type AppConnectChannelServices,
} from "./app-connect-channel";

const applicationMocks = {
  acceptProposal: vi.fn<AppConnectChannelServices["acceptProposal"]>(),
  createMessage: vi.fn<AppConnectChannelServices["createMessage"]>(),
  requireSession: vi.fn<AppConnectChannelServices["requireSession"]>(),
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
const deviceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";

const connectRequest = () => new Request(
  "https://api.example.test/briar.app.v1.ChannelService/CreateChannelMessage",
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
      preferredDeviceId: deviceId,
      attachmentReferences: ["existing-image"],
    }),
  },
);

const proposalConnectRequest = () => new Request(
  "https://api.example.test/briar.app.v1.ChannelService/AcceptChannelProposal",
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
      proposalId,
      projectId,
    }),
  },
);

describe("app Channel Connect adapter", () => {
  it("calls the message application service directly and preserves oneofs", async () => {
    applicationMocks.requireSession.mockResolvedValueOnce({
      session: {
        id: "session-1",
        userId,
        token: "session-token",
        expiresAt: new Date("2027-08-30T00:00:00.000Z"),
        createdAt: new Date("2026-08-30T00:00:00.000Z"),
        updatedAt: new Date("2026-08-30T00:00:00.000Z"),
      },
      user: {
        id: userId,
        name: "Owner",
        email: "owner@example.com",
        emailVerified: true,
        createdAt: new Date("2026-08-30T00:00:00.000Z"),
        updatedAt: new Date("2026-08-30T00:00:00.000Z"),
      },
    });
    applicationMocks.createMessage.mockResolvedValueOnce({
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
    });

    const router = createConnectRouter({
      connect: true,
      grpc: false,
      grpcWeb: false,
    });
    registerAppChannelService(
      router,
      {
        request: connectRequest(),
        auth: {} as BriarAuth,
        db: {} as D1Database,
        attachmentsBucket: {} as R2Bucket,
        env: {} as Env,
      },
      {
        ...appConnectChannelServices,
        createMessage: applicationMocks.createMessage,
        requireSession: applicationMocks.requireSession,
      },
    );

    expect(router.handlers).toHaveLength(Object.keys(ChannelService.method).length);
    const handler = router.handlers.find((candidate) =>
      candidate.requestPath ===
        "/briar.app.v1.ChannelService/CreateChannelMessage"
    );
    expect(handler).toBeDefined();

    const response = await createFetchHandler(handler!)(connectRequest());

    expect(response.status, await response.clone().text()).toBe(200);
    expect(applicationMocks.createMessage).toHaveBeenCalledWith({
      db: {},
      organizationId,
      channelId,
      userId,
      attachmentsBucket: {},
      attachments: [],
      attachmentReferences: ["existing-image"],
      request: {
        body: "Please create the issue",
        clientMessageId,
        parentMessageId: null,
        mentionedUserIds: [userId],
        mentionedAgentIds: [agentId],
        skillId,
        preferredDeviceId: deviceId,
      },
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

  it("maps a batch proposal result without routing through HTTP", async () => {
    applicationMocks.requireSession.mockResolvedValueOnce({
      session: {
        id: "session-2",
        userId,
        token: "session-token",
        expiresAt: new Date("2027-08-30T00:00:00.000Z"),
        createdAt: new Date("2026-08-30T00:00:00.000Z"),
        updatedAt: new Date("2026-08-30T00:00:00.000Z"),
      },
      user: {
        id: userId,
        name: "Owner",
        email: "owner@example.com",
        emailVerified: true,
        createdAt: new Date("2026-08-30T00:00:00.000Z"),
        updatedAt: new Date("2026-08-30T00:00:00.000Z"),
      },
    });
    applicationMocks.acceptProposal.mockResolvedValueOnce({
      outcome: "accepted",
      projectId,
      resultRunId: "run-batch",
      resultItems: [
        { localKey: "api", runId: "run-api" },
        { localKey: "ios", runId: "run-ios" },
      ],
      executionProposal: null,
    });

    const router = createConnectRouter({
      connect: true,
      grpc: false,
      grpcWeb: false,
    });
    registerAppChannelService(
      router,
      {
        request: proposalConnectRequest(),
        auth: {} as BriarAuth,
        db: {} as D1Database,
        attachmentsBucket: {} as R2Bucket,
        env: {} as Env,
      },
      {
        ...appConnectChannelServices,
        acceptProposal: applicationMocks.acceptProposal,
        requireSession: applicationMocks.requireSession,
      },
    );
    const handler = router.handlers.find((candidate) =>
      candidate.requestPath ===
        "/briar.app.v1.ChannelService/AcceptChannelProposal"
    );

    const response = await createFetchHandler(handler!)(proposalConnectRequest());

    expect(applicationMocks.acceptProposal).toHaveBeenCalledOnce();
    expect(response.status, await response.clone().text()).toBe(200);
    expect(applicationMocks.acceptProposal).toHaveBeenCalledWith({
      db: {},
      env: {},
      organizationId,
      channelId,
      proposalId,
      userId,
      request: { projectId, execution: null },
    });
    expect(await response.json()).toEqual({
      outcome: "APPROVAL_OUTCOME_ACCEPTED",
      projectId,
      resultRunId: "run-batch",
      resultItems: [
        { localKey: "api", runId: "run-api" },
        { localKey: "ios", runId: "run-ios" },
      ],
    });
  });
});
