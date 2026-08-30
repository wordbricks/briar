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
  getLinkPreview: vi.fn<AppConnectChannelServices["getLinkPreview"]>(),
  getMessageDocument: vi.fn<
    AppConnectChannelServices["getMessageDocument"]
  >(),
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

  it("normalizes channel writes and rejects explicit unspecified visibility", async () => {
    const createChannel = vi.fn<AppConnectChannelServices["createChannel"]>();
    applicationMocks.requireSession.mockResolvedValue({
      session: {
        id: "session-channel-write",
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
    createChannel.mockResolvedValue({
      id: channelId,
      organization_id: organizationId,
      kind: "channel",
      dm_key: null,
      slug: "release-notes",
      name: "Release Notes",
      topic: "Shipping",
      visibility: "public",
      default_project_id: null,
      archived_at: null,
      member_count: 1,
      agent_count: 0,
      created_by_user_id: userId,
      created_at: "2026-08-30T01:02:03.000Z",
      updated_at: "2026-08-30T01:02:03.000Z",
      last_message_at: null,
      last_message_preview: null,
      dm_participants_json: null,
      last_read_at: null,
      last_unread_message_at: null,
    });
    const requestFor = (
      visibility?: string,
      name = "  Release Notes  ",
    ) =>
      new Request(
        "https://api.example.test/briar.app.v1.ChannelService/CreateChannel",
        {
          method: "POST",
          headers: {
            authorization: "Bearer session-token",
            "connect-protocol-version": "1",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            organizationId,
            name,
            slug: "  RELEASE-NOTES  ",
            topic: "  Shipping  ",
            ...(visibility ? { visibility } : {}),
          }),
        },
      );
    const router = createConnectRouter({
      connect: true,
      grpc: false,
      grpcWeb: false,
    });
    registerAppChannelService(
      router,
      {
        request: requestFor(),
        auth: {} as BriarAuth,
        db: {} as D1Database,
        attachmentsBucket: {} as R2Bucket,
        env: {} as Env,
      },
      {
        ...appConnectChannelServices,
        createChannel,
        requireSession: applicationMocks.requireSession,
      },
    );
    const handler = router.handlers.find((candidate) =>
      candidate.requestPath === "/briar.app.v1.ChannelService/CreateChannel"
    )!;

    const response = await createFetchHandler(handler)(requestFor());
    expect(response.status, await response.clone().text()).toBe(200);
    expect(createChannel).toHaveBeenCalledWith({
      db: {},
      organizationId,
      userId,
      command: {
        name: "Release Notes",
        slug: "release-notes",
        topic: "Shipping",
        visibility: "public",
        defaultProjectId: null,
      },
    });
    expect(await response.json()).toMatchObject({
      channel: {
        id: channelId,
        visibility: "CHANNEL_VISIBILITY_PUBLIC",
      },
    });

    createChannel.mockClear();
    const invalid = await createFetchHandler(handler)(
      requestFor("CHANNEL_VISIBILITY_UNSPECIFIED"),
    );
    expect(invalid.status).toBe(400);
    expect(createChannel).not.toHaveBeenCalled();

    const invalidName = await createFetchHandler(handler)(
      requestFor(undefined, "   "),
    );
    expect(invalidName.status).toBe(400);
    expect(createChannel).not.toHaveBeenCalled();
  });

  it("keeps opaque user IDs while enforcing the membership oneof", async () => {
    const setChannelMember = vi.fn<
      AppConnectChannelServices["setChannelMember"]
    >().mockResolvedValue([]);
    applicationMocks.requireSession.mockResolvedValue({
      session: {
        id: "session-member-write",
        userId: "owner",
        token: "session-token",
        expiresAt: new Date("2027-08-30T00:00:00.000Z"),
        createdAt: new Date("2026-08-30T00:00:00.000Z"),
        updatedAt: new Date("2026-08-30T00:00:00.000Z"),
      },
      user: {
        id: "owner",
        name: "Owner",
        email: "owner@example.com",
        emailVerified: true,
        createdAt: new Date("2026-08-30T00:00:00.000Z"),
        updatedAt: new Date("2026-08-30T00:00:00.000Z"),
      },
    });
    const requestFor = (addMembership: boolean) =>
      new Request(
        "https://api.example.test/briar.app.v1.ChannelService/SetChannelMember",
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
            userId: "target-member",
            ...(addMembership ? { add: {} } : {}),
          }),
        },
      );
    const router = createConnectRouter({
      connect: true,
      grpc: false,
      grpcWeb: false,
    });
    registerAppChannelService(
      router,
      {
        request: requestFor(true),
        auth: {} as BriarAuth,
        db: {} as D1Database,
        attachmentsBucket: {} as R2Bucket,
        env: {} as Env,
      },
      {
        ...appConnectChannelServices,
        requireSession: applicationMocks.requireSession,
        setChannelMember,
      },
    );
    const handler = router.handlers.find((candidate) =>
      candidate.requestPath === "/briar.app.v1.ChannelService/SetChannelMember"
    )!;

    const response = await createFetchHandler(handler)(requestFor(true));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(setChannelMember).toHaveBeenCalledWith({
      db: {},
      organizationId,
      channelId,
      userId: "owner",
      targetUserId: "target-member",
      change: { case: "add" },
    });

    setChannelMember.mockClear();
    const missing = await createFetchHandler(handler)(requestFor(false));
    expect(missing.status).toBe(400);
    expect(setChannelMember).not.toHaveBeenCalled();
  });

  it("authenticates channel content reads and preserves a null preview", async () => {
    applicationMocks.requireSession.mockClear();
    applicationMocks.getMessageDocument.mockClear();
    applicationMocks.getLinkPreview.mockClear();
    applicationMocks.requireSession.mockResolvedValue({
      session: {
        id: "session-content-read",
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
    applicationMocks.getMessageDocument.mockResolvedValueOnce({
      message_id: messageId,
      channel_id: channelId,
      project_id: null,
      title: "Rollout plan",
      markdown: "# Rollout",
    });
    applicationMocks.getLinkPreview.mockResolvedValueOnce(null);

    const requestFor = (method: string, body: Record<string, string>) =>
      new Request(
        `https://api.example.test/briar.app.v1.ChannelService/${method}`,
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
    const router = createConnectRouter({
      connect: true,
      grpc: false,
      grpcWeb: false,
    });
    registerAppChannelService(
      router,
      {
        request: requestFor("GetChannelMessageDocument", {}),
        auth: {} as BriarAuth,
        db: {} as D1Database,
        attachmentsBucket: {} as R2Bucket,
        env: {} as Env,
      },
      {
        ...appConnectChannelServices,
        getLinkPreview: applicationMocks.getLinkPreview,
        getMessageDocument: applicationMocks.getMessageDocument,
        requireSession: applicationMocks.requireSession,
      },
    );
    const handlerFor = (method: string) => router.handlers.find((candidate) =>
      candidate.requestPath === `/briar.app.v1.ChannelService/${method}`
    )!;

    const documentResponse = await createFetchHandler(
      handlerFor("GetChannelMessageDocument"),
    )(requestFor("GetChannelMessageDocument", {
      organizationId,
      channelId,
      messageId,
    }));
    expect(documentResponse.status, await documentResponse.clone().text())
      .toBe(200);
    expect(applicationMocks.getMessageDocument).toHaveBeenCalledWith({
      db: {},
      organizationId,
      channelId,
      messageId,
      userId,
    });
    await expect(documentResponse.json()).resolves.toEqual({
      document: {
        messageId,
        title: "Rollout plan",
        markdown: "# Rollout",
      },
    });

    const previewUrl = "https://news.example.com/articles/42";
    const previewResponse = await createFetchHandler(
      handlerFor("GetChannelLinkPreview"),
    )(requestFor("GetChannelLinkPreview", {
      organizationId,
      channelId,
      url: previewUrl,
    }));
    expect(previewResponse.status, await previewResponse.clone().text()).toBe(200);
    expect(applicationMocks.getLinkPreview).toHaveBeenCalledWith({
      db: {},
      organizationId,
      channelId,
      userId,
      url: previewUrl,
    });
    await expect(previewResponse.json()).resolves.toEqual({});
    expect(applicationMocks.requireSession).toHaveBeenCalledTimes(2);
  });
});
