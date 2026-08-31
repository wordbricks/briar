import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import {
  Code,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import {
  ChannelService,
  ChannelVisibility,
} from "@briar/contracts/gen/briar/app/v1/channel_pb";
import { RunStatus } from "@briar/contracts/gen/briar/app/v1/common_pb";
import { describe, expect, it, vi } from "vitest";
import type { BriarAuth } from "./auth";
import { connectErrorInterceptor } from "./app-connect-errors";
import {
  appConnectChannelServices,
  type AppConnectChannelServices,
  registerAppChannelService,
} from "./app-connect-channel";

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

const authenticatedSession = {
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
};

const createChannelClient = (
  overrides: Partial<AppConnectChannelServices>,
) => {
  const context = createExecutionContext();
  const services: AppConnectChannelServices = {
    ...appConnectChannelServices,
    requireSession: vi.fn().mockResolvedValue(authenticatedSession),
    ...overrides,
  };
  const transport = createRouterTransport(
    (router) =>
      registerAppChannelService(router, {
        request: new Request("https://api.example.test"),
        auth: {} as BriarAuth,
        db: env.DB,
        attachmentsBucket: env.ATTACHMENTS,
        env,
        context,
      }, services),
    {
      router: {
        grpc: false,
        grpcWeb: false,
        interceptors: [connectErrorInterceptor],
      },
    },
  );
  return {
    client: createClient(ChannelService, transport),
    flushBackgroundTasks: () => waitOnExecutionContext(context),
  };
};

describe("app Channel Connect adapter", () => {
  it("maps message input and domain unions through generated oneofs", async () => {
    const createMessage = vi.fn<AppConnectChannelServices["createMessage"]>();
    createMessage.mockResolvedValueOnce({
      message: {
        id: messageId,
        channelId,
        parentMessageId: null,
        body: "Please create the issue",
        blocks: [],
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
        reactions: [],
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
        subscribers: [],
        createdAt: "2026-08-30T01:02:03.000Z",
        deletedAt: null,
      },
      agentReplies: [],
    });
    const { client, flushBackgroundTasks } = createChannelClient({
      createMessage,
    });

    const result = await client.createChannelMessage({
      organizationId,
      channelId,
      clientMessageId,
      body: "Please create the issue",
      mentionedUserIds: [userId],
      mentionedAgentIds: [agentId],
      skillId,
      preferredDeviceId: deviceId,
    });
    await flushBackgroundTasks();

    expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({
      organizationId,
      channelId,
      userId,
      attachmentIds: [],
      request: {
        body: "Please create the issue",
        clientMessageId,
        parentMessageId: null,
        mentionedUserIds: [userId],
        mentionedAgentIds: [agentId],
        skillId,
        preferredDeviceId: deviceId,
      },
    }));
    expect(result.message?.author?.author).toMatchObject({
      case: "user",
      value: { id: userId },
    });
    expect(result.message?.proposal?.payload).toMatchObject({
      case: "issue",
      value: {
        issue: { title: "Implement Connect", status: RunStatus.BACKLOG },
        executeAfterCreate: true,
      },
    });
  });

  it("normalizes channel writes and rejects unspecified visibility", async () => {
    const createChannel = vi.fn<AppConnectChannelServices["createChannel"]>();
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
    const { client, flushBackgroundTasks } = createChannelClient({
      createChannel,
    });

    const result = await client.createChannel({
      organizationId,
      name: "  Release Notes  ",
      slug: "  RELEASE-NOTES  ",
      topic: "  Shipping  ",
      visibility: ChannelVisibility.PUBLIC,
    });
    await flushBackgroundTasks();

    expect(createChannel).toHaveBeenCalledWith(expect.objectContaining({
      organizationId,
      userId,
      command: {
        name: "Release Notes",
        slug: "release-notes",
        topic: "Shipping",
        visibility: "public",
        defaultProjectId: null,
      },
    }));
    expect(result.channel?.visibility).toBe(ChannelVisibility.PUBLIC);

    createChannel.mockClear();
    await expect(client.createChannel({
      organizationId,
      name: "Release Notes",
      visibility: ChannelVisibility.UNSPECIFIED,
    })).rejects.toMatchObject({ code: Code.InvalidArgument });
    expect(createChannel).not.toHaveBeenCalled();
  });

  it("requires and maps the membership oneof while preserving opaque user IDs", async () => {
    const setChannelMember = vi.fn<
      AppConnectChannelServices["setChannelMember"]
    >().mockResolvedValue([]);
    const { client, flushBackgroundTasks } = createChannelClient({
      setChannelMember,
    });

    await client.setChannelMember({
      organizationId,
      channelId,
      userId: "target-member",
      membership: { case: "add", value: {} },
    });
    await flushBackgroundTasks();

    expect(setChannelMember).toHaveBeenCalledWith(expect.objectContaining({
      organizationId,
      channelId,
      userId,
      targetUserId: "target-member",
      change: { case: "add" },
    }));

    setChannelMember.mockClear();
    await expect(client.setChannelMember({
      organizationId,
      channelId,
      userId: "target-member",
    })).rejects.toMatchObject({ code: Code.InvalidArgument });
    expect(setChannelMember).not.toHaveBeenCalled();
  });
});
