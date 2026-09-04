import { create } from "@bufbuild/protobuf";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ChannelService,
  ChannelVisibility as ProtoChannelVisibility,
  DeclineChannelProposalResponse_Outcome,
  DeclineChannelProposalResponseSchema,
} from "@briar/contracts/gen/briar/app/v1/channel_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import {
  PreparedUploadSchema,
  UploadReferenceSchema,
} from "@briar/contracts/gen/briar/types/v1/upload_pb";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import type { BriarAuth } from "./auth";
import { processArchiveCleanupQueue } from "./archive";
import {
  createChannelApplication,
  deleteChannelApplication,
  setChannelAgentApplication,
  setChannelMemberApplication,
  updateChannelApplication,
} from "./channel-administration-application";
import {
  getChannelLinkPreviewApplication,
  getChannelMessageDocumentApplication,
} from "./channel-content-application";
import {
  createOrganizationChannelMessage,
  deleteOrganizationChannelMessage,
  listOrganizationChannelMessages,
  setOrganizationChannelThreadSubscription,
  toggleOrganizationChannelMessageReaction,
} from "./channel-message-routes";
import {
  createChannelMessageApplicationRequest,
  requiredAppAgentProviderFromProto,
} from "./app-mutation-request-mappers";
import {
  acceptOrganizationChannelExecutionProposal,
  acceptOrganizationChannelProposal,
  acceptOrganizationChannelSkillExecutionProposal,
  declineOrganizationChannelProposal,
} from "./channel-proposal-routes";
import {
  createOrganizationDirectMessage,
  getOrganizationChannelDetail,
  listOrganizationChannels,
  markOrganizationChannelRead,
  syncOrganizationChannels,
} from "./organization-channel-routes";
import {
  createChannelWebhookApplication,
  listChannelWebhooksApplication,
  revokeChannelWebhookApplication,
  rotateChannelWebhookApplication,
  updateChannelWebhookApplication,
} from "./channel-webhook-application";
import {
  channelNameSchema,
  channelSlugSchema,
  channelTopicSchema,
  channelUserIdSchema,
  channelWebhookNameSchema,
  type ChannelVisibility,
} from "../../src/lib/channels-contract";
import { hasOrganizationCapability } from "./organization-access";
import {
  getOrganizationRole,
  listOrganizationMembers,
} from "./organization-repository";
import {
  listOrganizationAgents,
} from "./organization-agents";
import {
  scheduleChannelRealtimePublish,
  scheduleChannelActivityDisconnect,
  scheduleProjectAgentSessionRealtimePublish,
  scheduleProjectRealtimePublish,
} from "./realtime-scheduling";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";
import { appOrganizationMember } from "./app-connect-mappers";
import { appOrganizationAgent } from "./app-connect-agent-mappers";
import {
  appChannelDocumentContent,
  appChannelLinkPreview,
  appChannelMember,
  appChannelSummary,
  appChannelWebhook,
} from "./app-connect-channel-mappers";
import {
  appAcceptChannelExecutionProposal,
  appAcceptChannelProposal,
  appAcceptChannelSkillExecutionProposal,
  appChannelAgent,
  appChannelAgentReply,
  appChannelMessage,
  appChannelSubscriber,
  appChannelSummaryJson,
  appCreateChannelMessageResponse,
} from "./app-connect-channel-response-mappers";
import { schedulePostCommitCleanup } from "./post-commit-cleanup";
import {
  prepareChannelMessageAttachmentsApplication,
} from "./channel-message-upload-application";

export type AppConnectChannelInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
  readonly attachmentsBucket: R2Bucket;
  readonly env: Env;
  readonly context?: ExecutionContext;
};

export type AppConnectChannelServices = {
  readonly acceptExecutionProposal:
    typeof acceptOrganizationChannelExecutionProposal;
  readonly acceptProposal: typeof acceptOrganizationChannelProposal;
  readonly acceptSkillExecutionProposal:
    typeof acceptOrganizationChannelSkillExecutionProposal;
  readonly createDirectMessage: typeof createOrganizationDirectMessage;
  readonly createChannel: typeof createChannelApplication;
  readonly updateChannel: typeof updateChannelApplication;
  readonly deleteChannel: typeof deleteChannelApplication;
  readonly setChannelAgent: typeof setChannelAgentApplication;
  readonly setChannelMember: typeof setChannelMemberApplication;
  readonly listChannelWebhooks: typeof listChannelWebhooksApplication;
  readonly createChannelWebhook: typeof createChannelWebhookApplication;
  readonly updateChannelWebhook: typeof updateChannelWebhookApplication;
  readonly rotateChannelWebhook: typeof rotateChannelWebhookApplication;
  readonly revokeChannelWebhook: typeof revokeChannelWebhookApplication;
  readonly createMessage: typeof createOrganizationChannelMessage;
  readonly prepareMessageAttachments:
    typeof prepareChannelMessageAttachmentsApplication;
  readonly declineProposal: typeof declineOrganizationChannelProposal;
  readonly deleteMessage: typeof deleteOrganizationChannelMessage;
  readonly getChannel: typeof getOrganizationChannelDetail;
  readonly getLinkPreview: typeof getChannelLinkPreviewApplication;
  readonly getMessageDocument: typeof getChannelMessageDocumentApplication;
  readonly listChannels: typeof listOrganizationChannels;
  readonly listMessages: typeof listOrganizationChannelMessages;
  readonly markRead: typeof markOrganizationChannelRead;
  readonly requireSession: typeof requireSession;
  readonly setThreadSubscription:
    typeof setOrganizationChannelThreadSubscription;
  readonly syncChannels: typeof syncOrganizationChannels;
  readonly toggleReaction: typeof toggleOrganizationChannelMessageReaction;
};

export const appConnectChannelServices: AppConnectChannelServices = {
  acceptExecutionProposal: acceptOrganizationChannelExecutionProposal,
  acceptProposal: acceptOrganizationChannelProposal,
  acceptSkillExecutionProposal: acceptOrganizationChannelSkillExecutionProposal,
  createDirectMessage: createOrganizationDirectMessage,
  createChannel: createChannelApplication,
  updateChannel: updateChannelApplication,
  deleteChannel: deleteChannelApplication,
  setChannelAgent: setChannelAgentApplication,
  setChannelMember: setChannelMemberApplication,
  listChannelWebhooks: listChannelWebhooksApplication,
  createChannelWebhook: createChannelWebhookApplication,
  updateChannelWebhook: updateChannelWebhookApplication,
  rotateChannelWebhook: rotateChannelWebhookApplication,
  revokeChannelWebhook: revokeChannelWebhookApplication,
  createMessage: createOrganizationChannelMessage,
  prepareMessageAttachments: prepareChannelMessageAttachmentsApplication,
  declineProposal: declineOrganizationChannelProposal,
  deleteMessage: deleteOrganizationChannelMessage,
  getChannel: getOrganizationChannelDetail,
  getLinkPreview: getChannelLinkPreviewApplication,
  getMessageDocument: getChannelMessageDocumentApplication,
  listChannels: listOrganizationChannels,
  listMessages: listOrganizationChannelMessages,
  markRead: markOrganizationChannelRead,
  requireSession,
  setThreadSubscription: setOrganizationChannelThreadSubscription,
  syncChannels: syncOrganizationChannels,
  toggleReaction: toggleOrganizationChannelMessageReaction,
};

const decodeUuid = decodeRequestSync(UuidString);
const canonicalUuid = (value: string) => decodeUuid(value).toLowerCase();
const decodeChannelName = decodeRequestSync(channelNameSchema);
const decodeChannelSlug = decodeRequestSync(channelSlugSchema);
const decodeChannelTopic = decodeRequestSync(channelTopicSchema);
const decodeChannelUserId = decodeRequestSync(channelUserIdSchema);
const decodeChannelWebhookName = decodeRequestSync(channelWebhookNameSchema);

const domainChannelVisibility = (
  value: ProtoChannelVisibility,
): ChannelVisibility => {
  switch (value) {
    case ProtoChannelVisibility.PUBLIC:
      return "public";
    case ProtoChannelVisibility.PRIVATE:
      return "private";
    case ProtoChannelVisibility.UNSPECIFIED:
    default:
      throw new ConnectError("visibility is invalid", Code.InvalidArgument);
  }
};

const optionalDomainChannelVisibility = (
  value: ProtoChannelVisibility | undefined,
): ChannelVisibility | undefined => value === undefined
  ? undefined
  : domainChannelVisibility(value);

const domainMembershipChange = (
  value: { readonly case: "add" | "remove" | undefined },
) => {
  switch (value.case) {
    case "add":
      return { case: "add" } as const;
    case "remove":
      return { case: "remove" } as const;
    case undefined:
      throw new ConnectError("membership change is required", Code.InvalidArgument);
  }
};

const approvalJson = (approval: {
  provider: AgentProvider;
  model?: string;
  effort?: string;
  workerId?: string;
}) => ({
  provider: requiredAppAgentProviderFromProto(approval.provider),
  model: approval.model ?? null,
  effort: approval.effort ?? null,
  workerId: approval.workerId ?? null,
});

const declineProposalMessage = (
  value: Awaited<ReturnType<typeof declineOrganizationChannelProposal>>,
) => create(DeclineChannelProposalResponseSchema, {
  outcome: value.outcome === "declined"
    ? DeclineChannelProposalResponse_Outcome.DECLINED
    : DeclineChannelProposalResponse_Outcome.ALREADY_DECLINED,
});

const scheduleChannelMutation = (
  input: AppConnectChannelInput,
  organizationId: string,
) => scheduleChannelRealtimePublish(
  input.env,
  input.db,
  canonicalUuid(organizationId),
  input.context,
);

const createAppChannelService = (
  input: AppConnectChannelInput,
  services: AppConnectChannelServices = appConnectChannelServices,
): ServiceImpl<typeof ChannelService> => ({
  listChannels: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.listChannels({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      userId: session.user.id,
    });
    return create(ChannelService.method.listChannels.output, {
      channels: result.channels.map(appChannelSummaryJson),
      cursor: BigInt(result.cursor),
    });
  },

  syncChannels: async (request) => {
    if (request.cursor > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ConnectError("Invalid channel cursor", Code.InvalidArgument);
    }
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.syncChannels({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      userId: session.user.id,
      since: Number(request.cursor),
    });
    return create(ChannelService.method.syncChannels.output, {
      cursor: BigInt(result.cursor),
      hasMore: result.hasMore,
      reset: false,
      channels: result.channels.map(appChannelSummaryJson),
      removedChannelIds: result.removedChannelIds,
      messages: result.messages.map(appChannelMessage),
      removedMessageIds: result.removedMessageIds,
      agentReplies: result.agentReplies.map(appChannelAgentReply),
    });
  },

  listDirectMessageRecipients: async (request) => {
    const organizationId = canonicalUuid(request.organizationId);
    const session = await services.requireSession(input.auth, input.request);
    const role = await getOrganizationRole(
      input.db,
      organizationId,
      session.user.id,
    );
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new ConnectError("Organization not found", Code.NotFound);
    }
    const [members, agents] = await Promise.all([
      listOrganizationMembers(input.db, organizationId),
      listOrganizationAgents(input.db, organizationId),
    ]);
    return create(ChannelService.method.listDirectMessageRecipients.output, {
      members: members.map((member) => appOrganizationMember(member)),
      agents: agents.map(appOrganizationAgent),
    });
  },

  createDirectMessage: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.createDirectMessage({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      userId: session.user.id,
      request: { memberIds: request.memberIds, agentIds: request.agentIds },
    });
    scheduleChannelMutation(input, request.organizationId);
    return create(ChannelService.method.createDirectMessage.output, {
      channel: appChannelSummaryJson(result.channel),
    });
  },

  createChannel: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const organizationId = canonicalUuid(request.organizationId);
    const channel = await services.createChannel({
      db: input.db,
      organizationId,
      userId: session.user.id,
      command: {
        name: decodeChannelName(request.name),
        slug: request.slug === undefined
          ? undefined
          : decodeChannelSlug(request.slug),
        topic: request.topic === undefined
          ? null
          : decodeChannelTopic(request.topic),
        visibility: domainChannelVisibility(request.visibility),
        defaultProjectId: request.defaultProjectId === undefined
          ? null
          : canonicalUuid(request.defaultProjectId),
      },
    });
    scheduleChannelMutation(input, organizationId);
    return create(ChannelService.method.createChannel.output, {
      channel: appChannelSummary(channel),
    });
  },

  updateChannel: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const organizationId = canonicalUuid(request.organizationId);
    const channelId = canonicalUuid(request.channelId);
    const topic = request.topicUpdate.case === "topic"
      ? decodeChannelTopic(request.topicUpdate.value)
      : request.topicUpdate.case === "clearTopic"
      ? null
      : undefined;
    const defaultProjectId = request.defaultProjectUpdate.case ===
        "defaultProjectId"
      ? canonicalUuid(request.defaultProjectUpdate.value)
      : request.defaultProjectUpdate.case === "clearDefaultProject"
      ? null
      : undefined;
    const channel = await services.updateChannel({
      db: input.db,
      organizationId,
      channelId,
      userId: session.user.id,
      command: {
        name: request.name === undefined
          ? undefined
          : decodeChannelName(request.name),
        topic,
        visibility: optionalDomainChannelVisibility(request.visibility),
        defaultProjectId,
        archived: request.archived,
      },
    });
    scheduleChannelMutation(input, organizationId);
    scheduleChannelActivityDisconnect(
      input.env,
      organizationId,
      channelId,
      input.context,
    );
    return create(ChannelService.method.updateChannel.output, {
      channel: appChannelSummary(channel),
    });
  },

  deleteChannel: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const organizationId = canonicalUuid(request.organizationId);
    const channelId = canonicalUuid(request.channelId);
    const result = await services.deleteChannel({
      db: input.db,
      organizationId,
      channelId,
      userId: session.user.id,
    });
    void schedulePostCommitCleanup({
      context: input.context,
      operation: "channel_delete",
      observedAt: result.observedAt,
      tasks: [{
        queue: "archive",
        run: () =>
          processArchiveCleanupQueue(
            input.db,
            input.env.ARCHIVES,
            input.attachmentsBucket,
            result.observedAt,
            1_000,
          ),
      }],
    });
    scheduleChannelMutation(input, organizationId);
    scheduleChannelActivityDisconnect(
      input.env,
      organizationId,
      channelId,
      input.context,
    );
    return create(ChannelService.method.deleteChannel.output, { deleted: true });
  },

  setChannelAgent: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const organizationId = canonicalUuid(request.organizationId);
    const channelId = canonicalUuid(request.channelId);
    const change = domainMembershipChange(request.membership);
    const agents = await services.setChannelAgent({
      db: input.db,
      organizationId,
      channelId,
      userId: session.user.id,
      agentId: canonicalUuid(request.agentId),
      change,
    });
    scheduleChannelMutation(input, organizationId);
    if (change.case === "remove") {
      scheduleChannelActivityDisconnect(
        input.env,
        organizationId,
        channelId,
        input.context,
      );
    }
    return create(ChannelService.method.setChannelAgent.output, {
      agents: agents.map(appOrganizationAgent),
    });
  },

  setChannelMember: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const organizationId = canonicalUuid(request.organizationId);
    const channelId = canonicalUuid(request.channelId);
    const change = domainMembershipChange(request.membership);
    const members = await services.setChannelMember({
      db: input.db,
      organizationId,
      channelId,
      userId: session.user.id,
      targetUserId: decodeChannelUserId(request.userId),
      change,
    });
    scheduleChannelMutation(input, organizationId);
    if (change.case === "remove") {
      scheduleChannelActivityDisconnect(
        input.env,
        organizationId,
        channelId,
        input.context,
      );
    }
    return create(ChannelService.method.setChannelMember.output, {
      members: members.map(appChannelMember),
    });
  },

  listChannelWebhooks: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const webhooks = await services.listChannelWebhooks({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      userId: session.user.id,
    });
    return create(ChannelService.method.listChannelWebhooks.output, {
      webhooks: webhooks.map(appChannelWebhook),
    });
  },

  createChannelWebhook: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.createChannelWebhook({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      userId: session.user.id,
      name: decodeChannelWebhookName(request.name),
    });
    return create(ChannelService.method.createChannelWebhook.output, {
      webhook: appChannelWebhook(result.webhook),
      url: new URL(
        `/hooks/channels/${result.webhook.id}/${result.secret}`,
        input.request.url,
      ).toString(),
    });
  },

  updateChannelWebhook: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const webhook = await services.updateChannelWebhook({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      webhookId: canonicalUuid(request.webhookId),
      userId: session.user.id,
      name: decodeChannelWebhookName(request.name),
    });
    return create(ChannelService.method.updateChannelWebhook.output, {
      webhook: appChannelWebhook(webhook),
    });
  },

  rotateChannelWebhook: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.rotateChannelWebhook({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      webhookId: canonicalUuid(request.webhookId),
      userId: session.user.id,
    });
    return create(ChannelService.method.rotateChannelWebhook.output, {
      webhook: appChannelWebhook(result.webhook),
      url: new URL(
        `/hooks/channels/${result.webhook.id}/${result.secret}`,
        input.request.url,
      ).toString(),
    });
  },

  revokeChannelWebhook: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const webhook = await services.revokeChannelWebhook({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      webhookId: canonicalUuid(request.webhookId),
      userId: session.user.id,
    });
    return create(ChannelService.method.revokeChannelWebhook.output, {
      webhook: appChannelWebhook(webhook),
    });
  },

  getChannel: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.getChannel({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      userId: session.user.id,
      messageLimit: request.messageLimit ?? null,
    });
    return create(ChannelService.method.getChannel.output, {
      channel: appChannelSummaryJson(result.channel),
      members: result.members.map(appChannelMember),
      agents: result.agents.map(appChannelAgent),
      messages: result.messages.map(appChannelMessage),
      agentReplies: result.agentReplies.map(appChannelAgentReply),
      nextCursor: result.nextCursor ?? undefined,
    });
  },

  markChannelRead: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.markRead({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      userId: session.user.id,
      request: {
        lastReadAt: request.lastReadAt
          ? timestampDate(request.lastReadAt).toISOString()
          : undefined,
      },
    });
    scheduleChannelMutation(input, request.organizationId);
    return create(ChannelService.method.markChannelRead.output, {
      channel: appChannelSummaryJson(result.channel),
    });
  },

  listChannelMessages: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.listMessages({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      userId: session.user.id,
      parentMessageId: request.parentMessageId,
      cursor: request.cursor,
      limit: request.limit,
    });
    return create(ChannelService.method.listChannelMessages.output, {
      messages: result.messages.map(appChannelMessage),
      nextCursor: result.nextCursor ?? undefined,
    });
  },

  prepareChannelMessageAttachments: async (request, context) => {
    context.responseHeader.set("Cache-Control", "private, no-store");
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.prepareMessageAttachments({
      db: input.db,
      signingSecret: input.env.BETTER_AUTH_SECRET,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      userId: session.user.id,
      messageId: canonicalUuid(request.clientMessageId),
      requestId: canonicalUuid(request.requestId),
      attachments: request.attachments,
    });
    return create(
      ChannelService.method.prepareChannelMessageAttachments.output,
      {
        replayed: result.replayed,
        uploads: result.uploads.map((upload) =>
          create(PreparedUploadSchema, {
            clientId: upload.clientId,
            reference: create(UploadReferenceSchema, {
              uploadId: upload.uploadId,
            }),
            uploadUrl: new URL(
              `/app-api/uploads/${encodeURIComponent(upload.uploadId)}`,
              input.request.url,
            ).toString(),
            uploadCapability: upload.uploadCapability,
            expiresAt: timestampFromDate(new Date(upload.expiresAt)),
          })
        ),
      },
    );
  },

  createChannelMessage: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.createMessage({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      userId: session.user.id,
      attachmentIds: request.attachments.map((attachment) =>
        canonicalUuid(attachment.uploadId)
      ),
      request: createChannelMessageApplicationRequest(request),
    });
    scheduleChannelMutation(input, request.organizationId);
    return appCreateChannelMessageResponse(result);
  },

  deleteChannelMessage: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.deleteMessage({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      messageId: canonicalUuid(request.messageId),
      userId: session.user.id,
      attachmentsBucket: input.attachmentsBucket,
      env: input.env,
      context: input.context,
    });
    scheduleChannelMutation(input, request.organizationId);
    return create(ChannelService.method.deleteChannelMessage.output, {
      deleted: result.deleted,
      message: result.message ? appChannelMessage(result.message) : undefined,
      parentMessage: result.parentMessage
        ? appChannelMessage(result.parentMessage)
        : undefined,
    });
  },

  getChannelMessageDocument: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const document = await services.getMessageDocument({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      messageId: canonicalUuid(request.messageId),
      userId: session.user.id,
    });
    return create(ChannelService.method.getChannelMessageDocument.output, {
      document: appChannelDocumentContent(document),
    });
  },

  getChannelLinkPreview: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const preview = await services.getLinkPreview({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      userId: session.user.id,
      url: request.url,
    });
    return create(ChannelService.method.getChannelLinkPreview.output, {
      preview: preview ? appChannelLinkPreview(preview) : undefined,
    });
  },

  toggleChannelMessageReaction: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.toggleReaction({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      messageId: canonicalUuid(request.messageId),
      userId: session.user.id,
      request: { emoji: request.emoji },
    });
    scheduleChannelMutation(input, request.organizationId);
    return create(ChannelService.method.toggleChannelMessageReaction.output, {
      message: appChannelMessage(result.message),
    });
  },

  setChannelThreadSubscription: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.setThreadSubscription({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      rootMessageId: canonicalUuid(request.rootMessageId),
      userId: session.user.id,
      subscribed: request.subscribed,
    });
    scheduleChannelMutation(input, request.organizationId);
    return create(ChannelService.method.setChannelThreadSubscription.output, {
      rootMessageId: result.rootMessageId,
      subscribers: result.subscribers.map(appChannelSubscriber),
    });
  },

  acceptChannelProposal: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.acceptProposal({
      db: input.db,
      env: input.env,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      proposalId: canonicalUuid(request.proposalId),
      userId: session.user.id,
      request: {
        projectId: request.projectId ?? null,
        execution: request.execution ? approvalJson(request.execution) : null,
      },
    });
    scheduleChannelMutation(input, request.organizationId);
    if (result.projectId) {
      scheduleProjectRealtimePublish(
        input.env,
        input.db,
        canonicalUuid(result.projectId),
        input.context,
      );
    }
    return appAcceptChannelProposal(result);
  },

  acceptChannelExecutionProposal: async (request) => {
    if (!request.approval) {
      throw new ConnectError("approval is required", Code.InvalidArgument);
    }
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.acceptExecutionProposal({
      db: input.db,
      env: input.env,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      proposalId: canonicalUuid(request.proposalId),
      userId: session.user.id,
      request: approvalJson(request.approval),
    });
    scheduleChannelMutation(input, request.organizationId);
    if (result.projectId) {
      scheduleProjectRealtimePublish(
        input.env,
        input.db,
        canonicalUuid(result.projectId),
        input.context,
      );
    }
    return appAcceptChannelExecutionProposal(result);
  },

  declineChannelProposal: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.declineProposal({
      db: input.db,
      env: input.env,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      proposalId: canonicalUuid(request.proposalId),
      userId: session.user.id,
    });
    scheduleChannelMutation(input, request.organizationId);
    return declineProposalMessage(result);
  },

  acceptChannelSkillExecutionProposal: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.acceptSkillExecutionProposal({
      db: input.db,
      env: input.env,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      proposalId: canonicalUuid(request.proposalId),
      userId: session.user.id,
      request: { workerId: request.workerId ?? null },
    });
    scheduleChannelMutation(input, request.organizationId);
    if (result.projectId) {
      const projectId = canonicalUuid(result.projectId);
      scheduleProjectRealtimePublish(input.env, input.db, projectId, input.context);
      if (result.session) {
        scheduleProjectAgentSessionRealtimePublish(
          input.env,
          input.db,
          projectId,
          input.context,
        );
      }
    }
    return appAcceptChannelSkillExecutionProposal(result);
  },
});

export function registerAppChannelService(
  router: ConnectRouter,
  input: AppConnectChannelInput,
  services: AppConnectChannelServices = appConnectChannelServices,
) {
  router.service(ChannelService, createAppChannelService(input, services));
}

export { ChannelService, createAppChannelService };
