import {
  fromJson,
  type DescEnum,
  type DescField,
  type DescMessage,
  type JsonObject,
  type JsonValue,
} from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  ChannelService,
} from "@briar/contracts/gen/briar/app/v1/channel_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import * as Predicate from "effect/Predicate";
import type { BriarAuth } from "./auth";
import { handleChannelMessageRoute } from "./channel-message-routes";
import { handleChannelProposalRoute } from "./channel-proposal-routes";
import { HttpError } from "./http-response";
import { handleOrganizationChannelRoute } from "./organization-channel-routes";
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

type ChannelRoute = "message" | "organization" | "proposal";

export type AppConnectChannelServices = {
  readonly handleMessageRoute: typeof handleChannelMessageRoute;
  readonly handleOrganizationRoute: typeof handleOrganizationChannelRoute;
  readonly handleProposalRoute: typeof handleChannelProposalRoute;
};

const appConnectChannelServices: AppConnectChannelServices = {
  handleMessageRoute: handleChannelMessageRoute,
  handleOrganizationRoute: handleOrganizationChannelRoute,
  handleProposalRoute: handleChannelProposalRoute,
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

const readResponseJson = async (response: Response): Promise<unknown> => {
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Predicate.isObject(value) && typeof value.message === "string"
      ? value.message
      : `Channel request failed (${response.status})`;
    throw new HttpError(response.status, message);
  }
  return value;
};

const callChannelRoute = async (
  input: AppConnectChannelInput,
  services: AppConnectChannelServices,
  route: ChannelRoute,
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown,
) => {
  const headers = new Headers(input.request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const request = new Request(new URL(path, input.request.url), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const url = new URL(request.url);
  const response = route === "message"
    ? await services.handleMessageRoute({
        request,
        url,
        auth: input.auth,
        db: input.db,
        attachmentsBucket: input.attachmentsBucket,
        env: input.env,
        context: input.context,
      })
    : route === "organization"
    ? await services.handleOrganizationRoute({
        request,
        url,
        auth: input.auth,
        db: input.db,
        attachmentsBucket: input.attachmentsBucket,
        env: input.env,
        context: input.context,
      })
    : await services.handleProposalRoute({
        request,
        url,
        auth: input.auth,
        db: input.db,
        env: input.env,
      });
  if (!response) {
    throw new ConnectError("Channel route is not implemented", Code.Internal);
  }
  return readResponseJson(response);
};

const organizationPath = (organizationId: string) =>
  `/organizations/${canonicalUuid(organizationId)}`;

const channelPath = (organizationId: string, channelId: string) =>
  `${organizationPath(organizationId)}/channels/${canonicalUuid(channelId)}`;

const messagePath = (
  organizationId: string,
  channelId: string,
  messageId?: string,
) => `${channelPath(organizationId, channelId)}/messages${
  messageId ? `/${canonicalUuid(messageId)}` : ""
}`;

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
    const result = await callChannelRoute(
      input,
      services,
      "organization",
      `${organizationPath(request.organizationId)}/channels`,
      "GET",
    );
    return responseMessage(ChannelService.method.listChannels.output, result);
  }),

  syncChannels: (request) => rpc(async () => {
    if (request.cursor > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ConnectError("Invalid channel cursor", Code.InvalidArgument);
    }
    const query = new URLSearchParams({ since: request.cursor.toString() });
    const result = await callChannelRoute(
      input,
      services,
      "organization",
      `${organizationPath(request.organizationId)}/channel-changes?${query}`,
      "GET",
    );
    return responseMessage(ChannelService.method.syncChannels.output, result);
  }),

  listDirectMessageRecipients: (request) => rpc(async () => {
    const organizationId = canonicalUuid(request.organizationId);
    const session = await requireSession(input.auth, input.request);
    const role = await getOrganizationRole(
      input.db,
      organizationId,
      session.user.id,
    );
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new HttpError(404, "Organization not found");
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
    const result = await callChannelRoute(
      input,
      services,
      "organization",
      `${organizationPath(request.organizationId)}/dms`,
      "POST",
      { memberIds: request.memberIds, agentIds: request.agentIds },
    );
    scheduleChannelMutation(input, request.organizationId);
    return responseMessage(ChannelService.method.createDirectMessage.output, result);
  }),

  getChannel: (request) => rpc(async () => {
    const query = request.messageLimit === undefined
      ? ""
      : `?${new URLSearchParams({ limit: String(request.messageLimit) })}`;
    const result = await callChannelRoute(
      input,
      services,
      "organization",
      `${channelPath(request.organizationId, request.channelId)}${query}`,
      "GET",
    );
    return responseMessage(ChannelService.method.getChannel.output, result);
  }),

  markChannelRead: (request) => rpc(async () => {
    const result = await callChannelRoute(
      input,
      services,
      "organization",
      `${channelPath(request.organizationId, request.channelId)}/read`,
      "PUT",
      {
        lastReadAt: request.lastReadAt
          ? timestampDate(request.lastReadAt).toISOString()
          : undefined,
      },
    );
    scheduleChannelMutation(input, request.organizationId);
    return responseMessage(ChannelService.method.markChannelRead.output, result);
  }),

  listChannelMessages: (request) => rpc(async () => {
    const query = new URLSearchParams();
    if (request.parentMessageId) query.set("parentMessageId", request.parentMessageId);
    if (request.cursor) query.set("cursor", request.cursor);
    if (request.limit !== undefined) query.set("limit", String(request.limit));
    const result = await callChannelRoute(
      input,
      services,
      "message",
      `${messagePath(request.organizationId, request.channelId)}${
        query.size ? `?${query}` : ""
      }`,
      "GET",
    );
    return responseMessage(ChannelService.method.listChannelMessages.output, result);
  }),

  createChannelMessage: (request) => rpc(async () => {
    const result = await callChannelRoute(
      input,
      services,
      "message",
      messagePath(request.organizationId, request.channelId),
      "POST",
      {
        clientMessageId: canonicalUuid(request.clientMessageId),
        body: request.body,
        parentMessageId: request.parentMessageId ?? null,
        mentionedUserIds: request.mentionedUserIds,
        mentionedAgentIds: request.mentionedAgentIds,
        skillId: request.skillId ?? null,
        preferredDeviceId: request.preferredDeviceId ?? null,
      },
    );
    scheduleChannelMutation(input, request.organizationId);
    return responseMessage(ChannelService.method.createChannelMessage.output, result);
  }),

  deleteChannelMessage: (request) => rpc(async () => {
    const result = await callChannelRoute(
      input,
      services,
      "message",
      messagePath(request.organizationId, request.channelId, request.messageId),
      "DELETE",
    );
    scheduleChannelMutation(input, request.organizationId);
    return responseMessage(ChannelService.method.deleteChannelMessage.output, result);
  }),

  toggleChannelMessageReaction: (request) => rpc(async () => {
    const result = await callChannelRoute(
      input,
      services,
      "message",
      `${messagePath(request.organizationId, request.channelId, request.messageId)}/reactions`,
      "PUT",
      { emoji: request.emoji },
    );
    scheduleChannelMutation(input, request.organizationId);
    return responseMessage(
      ChannelService.method.toggleChannelMessageReaction.output,
      result,
    );
  }),

  setChannelThreadSubscription: (request) => rpc(async () => {
    const result = await callChannelRoute(
      input,
      services,
      "message",
      `${messagePath(
        request.organizationId,
        request.channelId,
        request.rootMessageId,
      )}/subscription`,
      request.subscribed ? "PUT" : "DELETE",
    );
    scheduleChannelMutation(input, request.organizationId);
    return responseMessage(
      ChannelService.method.setChannelThreadSubscription.output,
      result,
    );
  }),

  acceptChannelProposal: (request) => rpc(async () => {
    const result = await callChannelRoute(
      input,
      services,
      "proposal",
      `${channelPath(request.organizationId, request.channelId)}/proposals/${
        canonicalUuid(request.proposalId)
      }/accept`,
      "POST",
      {
        projectId: request.projectId ?? null,
        execution: request.execution ? approvalJson(request.execution) : null,
      },
    );
    scheduleChannelMutation(input, request.organizationId);
    if (Predicate.isObject(result) && typeof result.projectId === "string") {
      scheduleProjectRealtimePublish(
        input.env,
        input.db,
        canonicalUuid(result.projectId),
        input.context,
      );
    }
    return responseMessage(ChannelService.method.acceptChannelProposal.output, result);
  }),

  acceptChannelExecutionProposal: (request) => rpc(async () => {
    if (!request.approval) {
      throw new ConnectError("approval is required", Code.InvalidArgument);
    }
    const result = await callChannelRoute(
      input,
      services,
      "proposal",
      `${channelPath(request.organizationId, request.channelId)}/proposals/${
        canonicalUuid(request.proposalId)
      }/accept-execution`,
      "POST",
      approvalJson(request.approval),
    );
    scheduleChannelMutation(input, request.organizationId);
    if (Predicate.isObject(result) && typeof result.projectId === "string") {
      scheduleProjectRealtimePublish(
        input.env,
        input.db,
        canonicalUuid(result.projectId),
        input.context,
      );
    }
    return responseMessage(
      ChannelService.method.acceptChannelExecutionProposal.output,
      result,
    );
  }),

  declineChannelProposal: (request) => rpc(async () => {
    const result = await callChannelRoute(
      input,
      services,
      "proposal",
      `${channelPath(request.organizationId, request.channelId)}/proposals/${
        canonicalUuid(request.proposalId)
      }/decline`,
      "POST",
    );
    scheduleChannelMutation(input, request.organizationId);
    return responseMessage(ChannelService.method.declineChannelProposal.output, result);
  }),

  acceptChannelSkillExecutionProposal: (request) => rpc(async () => {
    const result = await callChannelRoute(
      input,
      services,
      "proposal",
      `${channelPath(
        request.organizationId,
        request.channelId,
      )}/skill-execution-proposals/${canonicalUuid(request.proposalId)}/accept`,
      "POST",
      { workerId: request.workerId },
    );
    scheduleChannelMutation(input, request.organizationId);
    if (Predicate.isObject(result) && typeof result.projectId === "string") {
      const projectId = canonicalUuid(result.projectId);
      scheduleProjectRealtimePublish(input.env, input.db, projectId, input.context);
      if (result.session !== null && result.session !== undefined) {
        scheduleProjectAgentSessionRealtimePublish(
          input.env,
          input.db,
          projectId,
          input.context,
        );
      }
    }
    return responseMessage(
      ChannelService.method.acceptChannelSkillExecutionProposal.output,
      result,
    );
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
