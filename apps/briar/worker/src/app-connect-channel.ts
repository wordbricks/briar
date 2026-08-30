import {
  create,
  fromJson,
  type DescEnum,
  type DescField,
  type DescMessage,
  type JsonObject,
  type JsonValue,
} from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  AcceptChannelExecutionProposalResponseSchema,
  AcceptChannelProposalResponseSchema,
  AcceptChannelSkillExecutionProposalResponseSchema,
  ChannelIssueBatchResultItemSchema,
  ChannelService,
  DeclineChannelProposalResponse_Outcome,
  DeclineChannelProposalResponseSchema,
} from "@briar/contracts/gen/briar/app/v1/channel_pb";
import {
  AgentSkillExecutionProposalSchema,
  ProjectAgentSessionSchema,
} from "@briar/contracts/gen/briar/app/v1/agent_pb";
import { ApprovalOutcome } from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  IssueExecutionDispatch_DispatchMode,
  IssueExecutionDispatch_Outcome,
  IssueExecutionDispatchSchema,
  IssueExecutionProposalSchema,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import * as Predicate from "effect/Predicate";
import type { BriarAuth } from "./auth";
import {
  createOrganizationChannelMessage,
  decodeChannelMessageApplicationInput,
  deleteOrganizationChannelMessage,
  listOrganizationChannelMessages,
  setOrganizationChannelThreadSubscription,
  toggleOrganizationChannelMessageReaction,
} from "./channel-message-routes";
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
import { hasOrganizationCapability } from "./organization-access";
import { organizationMemberJson } from "./organization-json";
import {
  getOrganizationRole,
  listOrganizationMembers,
} from "./organization-repository";
import {
  listOrganizationAgents,
  organizationAgentJson,
} from "./organization-agents";
import {
  scheduleChannelRealtimePublish,
  scheduleProjectAgentSessionRealtimePublish,
  scheduleProjectRealtimePublish,
} from "./realtime-scheduling";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";
import { toConnectError } from "./app-connect-errors";

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
  readonly createMessage: typeof createOrganizationChannelMessage;
  readonly declineProposal: typeof declineOrganizationChannelProposal;
  readonly deleteMessage: typeof deleteOrganizationChannelMessage;
  readonly getChannel: typeof getOrganizationChannelDetail;
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
  createMessage: createOrganizationChannelMessage,
  declineProposal: declineOrganizationChannelProposal,
  deleteMessage: deleteOrganizationChannelMessage,
  getChannel: getOrganizationChannelDetail,
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

const rpc = async <A>(operation: () => Promise<A>): Promise<A> => {
  try {
    return await operation();
  } catch (error) {
    throw toConnectError(error);
  }
};

const enumJsonName = (descriptor: DescEnum, value: unknown): JsonValue => {
  if (typeof value === "number") return value;
  if (typeof value !== "string") {
    throw new Error(`Expected ${descriptor.typeName} to be a string`);
  }
  const normalized = value.trim().replaceAll("-", "_").toUpperCase();
  const matches = descriptor.values.filter((candidate) =>
    candidate.name === normalized || candidate.name.endsWith(`_${normalized}`)
  );
  if (matches.length !== 1) {
    throw new Error(`Unknown ${descriptor.typeName} value: ${value}`);
  }
  return matches[0].name;
};

const fieldValue = (field: DescField, value: unknown): JsonValue => {
  if (value === null) return null;
  switch (field.fieldKind) {
    case "scalar":
      if (
        typeof value === "string" || typeof value === "number" ||
        typeof value === "boolean" || typeof value === "bigint"
      ) return typeof value === "bigint" ? value.toString() : value;
      throw new Error(`Invalid scalar value for ${field.localName}`);
    case "enum":
      return enumJsonName(field.enum, value);
    case "message":
      return messageJson(field.message, value);
    case "list": {
      if (!Array.isArray(value)) throw new Error(`Expected an array for ${field.localName}`);
      switch (field.listKind) {
        case "scalar":
          return value.map((item) =>
            typeof item === "bigint" ? item.toString() : item
          ) as JsonValue[];
        case "enum":
          return value.map((item) => enumJsonName(field.enum, item));
        case "message":
          return value.map((item) => messageJson(field.message, item));
      }
    }
    case "map": {
      if (!Predicate.isObject(value)) {
        throw new Error(`Expected an object for ${field.localName}`);
      }
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          switch (field.mapKind) {
            case "scalar":
              return [key, item as JsonValue];
            case "enum":
              return [key, enumJsonName(field.enum, item)];
            case "message":
              return [key, messageJson(field.message, item)];
          }
        }),
      );
    }
  }
};

const sourceWithChannelOneofs = (
  descriptor: DescMessage,
  source: { [x: PropertyKey]: unknown },
) => {
  const adapted = { ...source };
  switch (descriptor.typeName) {
    case "briar.app.v1.ChannelSummary":
      adapted.directMessageParticipants = source.dmParticipants;
      break;
    case "briar.app.v1.DirectMessageParticipant":
    case "briar.app.v1.ChannelMessageAuthor":
      adapted.kind = source.type;
      break;
    case "briar.app.v1.BlockText":
      adapted.kind = source.type === "mrkdwn" ? "markdown" : source.type;
      break;
    case "briar.app.v1.MessageBlock":
      if (typeof source.type === "string") adapted[source.type] = source;
      break;
    case "briar.app.v1.RichTextInline":
      if (typeof source.type === "string") adapted[source.type] = source;
      break;
    case "briar.app.v1.RichTextElement": {
      const kind = {
        rich_text_section: "section",
        rich_text_list: "list",
        rich_text_quote: "quote",
        rich_text_preformatted: "preformatted",
      }[String(source.type)];
      if (kind) adapted[kind] = source;
      break;
    }
    case "briar.app.v1.ChannelProposal": {
      if (!Predicate.isObject(source.payload)) break;
      const payload = source.payload;
      if (Predicate.isObject(payload.batch)) adapted.batch = payload.batch;
      else if (Predicate.isObject(payload.issue)) adapted.issue = payload;
      break;
    }
  }
  return adapted;
};

function messageJson(descriptor: DescMessage, value: unknown): JsonValue {
  if (descriptor.typeName.startsWith("google.protobuf.")) {
    return value as JsonValue;
  }
  if (!Predicate.isObject(value)) {
    throw new Error(`Expected an object for ${descriptor.typeName}`);
  }
  const source = sourceWithChannelOneofs(descriptor, value);
  const output: JsonObject = {};
  for (const field of descriptor.fields) {
    const key = [field.jsonName, field.localName, field.name].find((candidate) =>
      Object.hasOwn(source, candidate)
    );
    if (!key) continue;
    const input = source[key];
    if (input === undefined) continue;
    output[field.jsonName] = fieldValue(field, input);
  }
  return output;
}

const responseMessage = <Descriptor extends DescMessage>(
  descriptor: Descriptor,
  value: unknown,
) => fromJson(
  descriptor,
  messageJson(descriptor, value),
);

const providerJson = (provider: AgentProvider) => {
  switch (provider) {
    case AgentProvider.CODEX:
      return "codex";
    case AgentProvider.CLAUDE:
      return "claude";
    case AgentProvider.CURSOR:
      return "cursor";
    case AgentProvider.GROK:
      return "grok";
    case AgentProvider.AGY:
      return "agy";
    case AgentProvider.OPENCODE:
      return "opencode";
    case AgentProvider.OPENROUTER:
      return "openrouter";
    case AgentProvider.UNSPECIFIED:
      throw new ConnectError("provider is required", Code.InvalidArgument);
  }
};

const approvalJson = (approval: {
  provider: AgentProvider;
  model?: string;
  effort?: string;
  workerId?: string;
}) => ({
  provider: providerJson(approval.provider),
  model: approval.model ?? null,
  effort: approval.effort ?? null,
  workerId: approval.workerId ?? null,
});

const approvalOutcome = (value: "accepted" | "already_accepted") =>
  value === "accepted"
    ? ApprovalOutcome.ACCEPTED
    : ApprovalOutcome.ALREADY_ACCEPTED;

const executionDispatchMessage = (
  value: Awaited<
    ReturnType<typeof acceptOrganizationChannelExecutionProposal>
  >["dispatch"],
) => responseMessage(IssueExecutionDispatchSchema, {
  ...value,
  dispatchMode: value.dispatchMode === "specific"
    ? IssueExecutionDispatch_DispatchMode.SPECIFIC
    : IssueExecutionDispatch_DispatchMode.ANY,
  outcome: value.outcome === "already_dispatched"
    ? IssueExecutionDispatch_Outcome.ALREADY_DISPATCHED
    : IssueExecutionDispatch_Outcome.DISPATCHED,
});

const acceptProposalMessage = (
  value: Awaited<ReturnType<typeof acceptOrganizationChannelProposal>>,
) => create(AcceptChannelProposalResponseSchema, {
  outcome: approvalOutcome(value.outcome),
  projectId: value.projectId,
  resultRunId: value.resultRunId,
  resultItems: "resultItems" in value
    ? value.resultItems.map((item) =>
        create(ChannelIssueBatchResultItemSchema, item)
      )
    : [],
  executionProposal: value.executionProposal
    ? responseMessage(IssueExecutionProposalSchema, value.executionProposal)
    : undefined,
  dispatch: "dispatch" in value && value.dispatch
    ? executionDispatchMessage(value.dispatch)
    : undefined,
});

const acceptExecutionProposalMessage = (
  value: Awaited<
    ReturnType<typeof acceptOrganizationChannelExecutionProposal>
  >,
) => create(AcceptChannelExecutionProposalResponseSchema, {
  proposal: responseMessage(IssueExecutionProposalSchema, value.proposal),
  outcome: approvalOutcome(value.outcome),
  projectId: value.projectId,
  runId: value.runId,
  dispatch: executionDispatchMessage(value.dispatch),
});

const declineProposalMessage = (
  value: Awaited<ReturnType<typeof declineOrganizationChannelProposal>>,
) => create(DeclineChannelProposalResponseSchema, {
  outcome: value.outcome === "declined"
    ? DeclineChannelProposalResponse_Outcome.DECLINED
    : DeclineChannelProposalResponse_Outcome.ALREADY_DECLINED,
});

const acceptSkillExecutionProposalMessage = (
  value: Awaited<
    ReturnType<typeof acceptOrganizationChannelSkillExecutionProposal>
  >,
) => create(AcceptChannelSkillExecutionProposalResponseSchema, {
  outcome: approvalOutcome(value.outcome),
  proposal: responseMessage(AgentSkillExecutionProposalSchema, value.proposal),
  projectId: value.projectId,
  session: value.session
    ? responseMessage(ProjectAgentSessionSchema, value.session)
    : undefined,
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
  listChannels: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.listChannels({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      userId: session.user.id,
    });
    return responseMessage(ChannelService.method.listChannels.output, result);
  }),

  syncChannels: (request) => rpc(async () => {
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
    return responseMessage(ChannelService.method.syncChannels.output, result);
  }),

  listDirectMessageRecipients: (request) => rpc(async () => {
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
    return responseMessage(
      ChannelService.method.listDirectMessageRecipients.output,
      {
        members: members.map((member) => organizationMemberJson(member)),
        agents: agents.map(organizationAgentJson),
      },
    );
  }),

  createDirectMessage: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.createDirectMessage({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      userId: session.user.id,
      request: { memberIds: request.memberIds, agentIds: request.agentIds },
    });
    scheduleChannelMutation(input, request.organizationId);
    return responseMessage(ChannelService.method.createDirectMessage.output, result);
  }),

  getChannel: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.getChannel({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      userId: session.user.id,
      messageLimit: request.messageLimit ?? null,
    });
    return responseMessage(ChannelService.method.getChannel.output, result);
  }),

  markChannelRead: (request) => rpc(async () => {
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
    return responseMessage(ChannelService.method.markChannelRead.output, result);
  }),

  listChannelMessages: (request) => rpc(async () => {
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
    return responseMessage(ChannelService.method.listChannelMessages.output, result);
  }),

  createChannelMessage: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.createMessage({
      db: input.db,
      organizationId: canonicalUuid(request.organizationId),
      channelId: canonicalUuid(request.channelId),
      userId: session.user.id,
      attachmentsBucket: input.attachmentsBucket,
      attachments: [],
      attachmentReferences: request.attachmentReferences,
      request: decodeChannelMessageApplicationInput({
        clientMessageId: canonicalUuid(request.clientMessageId),
        body: request.body,
        parentMessageId: request.parentMessageId ?? null,
        mentionedUserIds: request.mentionedUserIds,
        mentionedAgentIds: request.mentionedAgentIds,
        skillId: request.skillId ?? null,
        preferredDeviceId: request.preferredDeviceId ?? null,
      }),
    });
    scheduleChannelMutation(input, request.organizationId);
    return responseMessage(ChannelService.method.createChannelMessage.output, result);
  }),

  deleteChannelMessage: (request) => rpc(async () => {
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
    return responseMessage(ChannelService.method.deleteChannelMessage.output, result);
  }),

  toggleChannelMessageReaction: (request) => rpc(async () => {
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
    return responseMessage(
      ChannelService.method.toggleChannelMessageReaction.output,
      result,
    );
  }),

  setChannelThreadSubscription: (request) => rpc(async () => {
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
    return responseMessage(
      ChannelService.method.setChannelThreadSubscription.output,
      result,
    );
  }),

  acceptChannelProposal: (request) => rpc(async () => {
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
    return acceptProposalMessage(result);
  }),

  acceptChannelExecutionProposal: (request) => rpc(async () => {
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
    return acceptExecutionProposalMessage(result);
  }),

  declineChannelProposal: (request) => rpc(async () => {
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
  }),

  acceptChannelSkillExecutionProposal: (request) => rpc(async () => {
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
    return acceptSkillExecutionProposalMessage(result);
  }),
});

export function registerAppChannelService(
  router: ConnectRouter,
  input: AppConnectChannelInput,
  services: AppConnectChannelServices = appConnectChannelServices,
) {
  router.service(ChannelService, createAppChannelService(input, services));
}

export { ChannelService, createAppChannelService };
