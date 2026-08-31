import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import {
  AgentSkillExecutionStatus as ProtoAgentSkillExecutionStatus,
  type AgentSkillExecutionProposal as AgentSkillExecutionProposalMessage,
} from "@briar/contracts/gen/briar/app/v1/agent_pb";
import {
  ChannelKind as ProtoChannelKind,
  ChannelMemberRole as ProtoChannelMemberRole,
  ChannelMessageAuthor_Kind as ProtoChannelMessageAuthorKind,
  ChannelService,
  ChannelVisibility as ProtoChannelVisibility,
  DeclineChannelProposalResponse_Outcome as ProtoDeclineOutcome,
  DirectMessageParticipant_Kind as ProtoDirectMessageParticipantKind,
  type ChannelAgentReply as ChannelAgentReplyMessage,
  type ChannelDocumentContent as ChannelDocumentContentMessage,
  type ChannelIssueProposal as ChannelIssueProposalMessage,
  type ChannelLinkPreview as ChannelLinkPreviewMessage,
  type ChannelMember as ChannelMemberMessage,
  type ChannelMessage as ChannelMessageMessage,
  type ChannelMessageAuthor as ChannelMessageAuthorMessage,
  type ChannelProposal as ChannelProposalMessage,
  type ChannelSummary as ChannelSummaryMessage,
  type ChannelWebhook as ChannelWebhookMessage,
  type CreateChannelMessageResponse as CreateChannelMessageResponseMessage,
  type SyncChannelsResponse as SyncChannelsResponseMessage,
} from "@briar/contracts/gen/briar/app/v1/channel_pb";
import {
  ApprovalOutcome as ProtoApprovalOutcome,
  BlockText_Kind as ProtoBlockTextKind,
  ProposalStatus as ProtoProposalStatus,
  ReplyJobStatus as ProtoReplyJobStatus,
  RichTextElement_List_Style as ProtoRichTextListStyle,
  type BlockText as BlockTextMessage,
  type MessageBlock as MessageBlockMessage,
  type RichTextElement as RichTextElementMessage,
  type RichTextInline as RichTextInlineMessage,
  type RichTextSection as RichTextSectionMessage,
  type RichTextStyle as RichTextStyleMessage,
} from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  IssueExecutionDispatch_DispatchMode as ProtoDispatchMode,
  IssueExecutionDispatch_Outcome as ProtoDispatchOutcome,
  type IssueExecutionDispatch as IssueExecutionDispatchMessage,
  type IssueExecutionProposal as IssueExecutionProposalMessage,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import type { AutoHuntSession } from "../../hooks/useAutoHuntSessions";
import type {
  AgentSkillExecutionApprovalInput,
  IssueExecutionApprovalInput,
  OrganizationMember,
} from "../../types";
import { briarApiUrl } from "../api-config";
import { normalizeIssueAttachmentFile } from "../issue-attachments";
import { canonicalizeIssueAttachmentReferences } from "../issue-markdown";
import { uploadPreparedFiles } from "../upload-client";
import type {
  AgentSkillExecutionProposal,
  ChannelAgentReply,
  ChannelAgentSummary,
  ChannelDelta,
  ChannelExecutionProposal,
  ChannelMember,
  ChannelLinkPreview,
  ChannelMessage,
  ChannelMessageAuthor,
  ChannelMessageBlock,
  ChannelMessageDocumentContent,
  ChannelMessageProposal,
  ChannelReplyStatus,
  ChannelSummary,
  ChannelVisibility,
  ChannelWebhook,
  DeleteChannelMessageResponse,
  DirectMessageParticipant,
} from "../channels-contract";
import {
  organizationAgentFromMessage,
  projectAgentSessionFromMessage,
  skillApprovalPolicyFromProto,
  skillExecutionModeFromProto,
} from "./agent";
import {
  agentProviderFromProto,
  agentProviderToProto,
  issueAttachmentFromProto,
  optionalAgentProviderFromProto,
  optionalTimestamp,
  organizationMemberFromProto,
  requiredMessage,
  requiredTimestamp,
  runStatusFromProto,
  safeNumber,
} from "./mappers";

export { agentProviderToProto } from "./mappers";
import {
  appCallOptions,
  appTransport,
} from "./core";

const channelClient = appTransport
  ? createClient(ChannelService, appTransport)
  : undefined;

const requireChannelClient = () => {
  if (!channelClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return channelClient;
};

const channelVisibilityFromProto = (
  value: ProtoChannelVisibility,
): ChannelVisibility => {
  switch (value) {
    case ProtoChannelVisibility.PUBLIC:
      return "public";
    case ProtoChannelVisibility.PRIVATE:
      return "private";
    default:
      throw new Error(`Unknown channel visibility: ${value}`);
  }
};

const channelVisibilityToProto = (
  value: ChannelVisibility,
): ProtoChannelVisibility => {
  switch (value) {
    case "public":
      return ProtoChannelVisibility.PUBLIC;
    case "private":
      return ProtoChannelVisibility.PRIVATE;
  }
};

const channelKindFromProto = (
  value: ProtoChannelKind,
): NonNullable<ChannelSummary["kind"]> => {
  switch (value) {
    case ProtoChannelKind.CHANNEL:
      return "channel";
    case ProtoChannelKind.DIRECT_MESSAGE:
      return "dm";
    default:
      throw new Error(`Unknown channel kind: ${value}`);
  }
};

const directMessageParticipantFromMessage = (
  value: ChannelSummaryMessage["directMessageParticipants"][number],
): DirectMessageParticipant => {
  const type = (() => {
    switch (value.kind) {
      case ProtoDirectMessageParticipantKind.USER:
        return "user" as const;
      case ProtoDirectMessageParticipantKind.AGENT:
        return "agent" as const;
      default:
        throw new Error(`Unknown direct-message participant kind: ${value.kind}`);
    }
  })();
  return {
    type,
    id: value.id,
    name: value.name,
    image: value.image ?? null,
  };
};

export const channelSummaryFromMessage = (
  value: ChannelSummaryMessage,
): ChannelSummary => ({
  id: value.id,
  organizationId: value.organizationId,
  kind: channelKindFromProto(value.kind),
  slug: value.slug,
  name: value.name,
  topic: value.topic ?? null,
  visibility: channelVisibilityFromProto(value.visibility),
  defaultProjectId: value.defaultProjectId ?? null,
  archivedAt: optionalTimestamp(value.archivedAt),
  memberCount: value.memberCount,
  agentCount: value.agentCount,
  createdByUserId: value.createdByUserId ?? null,
  createdAt: requiredTimestamp(value.createdAt, "channel.createdAt"),
  updatedAt: requiredTimestamp(value.updatedAt, "channel.updatedAt"),
  lastMessageAt: optionalTimestamp(value.lastMessageAt),
  lastMessagePreview: value.lastMessagePreview ?? null,
  lastReadAt: optionalTimestamp(value.lastReadAt),
  hasUnread: value.hasUnread,
  dmParticipants: value.directMessageParticipants.map(
    directMessageParticipantFromMessage,
  ),
});

export const channelMemberFromMessage = (
  value: ChannelMemberMessage,
): ChannelMember => {
  const role = (() => {
    switch (value.role) {
      case ProtoChannelMemberRole.OWNER:
        return "owner" as const;
      case ProtoChannelMemberRole.MEMBER:
        return "member" as const;
      default:
        throw new Error(`Unknown channel member role: ${value.role}`);
    }
  })();
  return {
    userId: value.userId,
    name: value.name,
    email: value.email,
    image: value.image ?? null,
    role,
    createdAt: requiredTimestamp(value.createdAt, "channelMember.createdAt"),
  };
};

export const channelWebhookFromMessage = (
  value: ChannelWebhookMessage,
): ChannelWebhook => ({
  id: value.id,
  channelId: value.channelId,
  name: value.name,
  active: value.active,
  lastUsedAt: optionalTimestamp(value.lastUsedAt),
  createdAt: requiredTimestamp(value.createdAt, "channelWebhook.createdAt"),
  updatedAt: requiredTimestamp(value.updatedAt, "channelWebhook.updatedAt"),
});

const blockTextFromMessage = (value: BlockTextMessage) => {
  switch (value.kind) {
    case ProtoBlockTextKind.PLAIN_TEXT:
      return {
        type: "plain_text" as const,
        text: value.text,
        ...(value.emoji === undefined ? {} : { emoji: value.emoji }),
      };
    case ProtoBlockTextKind.MARKDOWN:
      return {
        type: "mrkdwn" as const,
        text: value.text,
        ...(value.verbatim === undefined
          ? {}
          : { verbatim: value.verbatim }),
      };
    default:
      throw new Error(`Unknown block text kind: ${value.kind}`);
  }
};

const plainBlockTextFromMessage = (value: BlockTextMessage) => {
  const text = blockTextFromMessage(value);
  if (text.type !== "plain_text") {
    throw new Error("Channel header text must be plain text");
  }
  return text;
};

const richTextStyleFromMessage = (value: RichTextStyleMessage) => ({
  ...(value.bold === undefined ? {} : { bold: value.bold }),
  ...(value.italic === undefined ? {} : { italic: value.italic }),
  ...(value.strike === undefined ? {} : { strike: value.strike }),
  ...(value.code === undefined ? {} : { code: value.code }),
});

const richTextInlineFromMessage = (value: RichTextInlineMessage) => {
  switch (value.value.case) {
    case "text":
      return {
        type: "text" as const,
        text: value.value.value.text,
        ...(value.value.value.style
          ? { style: richTextStyleFromMessage(value.value.value.style) }
          : {}),
      };
    case "link":
      return {
        type: "link" as const,
        url: value.value.value.url,
        ...(value.value.value.text === undefined
          ? {}
          : { text: value.value.value.text }),
        ...(value.value.value.style
          ? { style: richTextStyleFromMessage(value.value.value.style) }
          : {}),
      };
    case "emoji":
      return { type: "emoji" as const, name: value.value.value.name };
    case undefined:
      throw new Error("Rich text inline value is missing");
  }
};

const richTextSectionFromMessage = (value: RichTextSectionMessage) => ({
  type: "rich_text_section" as const,
  elements: value.elements.map(richTextInlineFromMessage),
});

const richTextElementFromMessage = (value: RichTextElementMessage) => {
  switch (value.value.case) {
    case "section":
      return richTextSectionFromMessage(value.value.value);
    case "list": {
      const style = (() => {
        switch (value.value.value.style) {
          case ProtoRichTextListStyle.BULLET:
            return "bullet" as const;
          case ProtoRichTextListStyle.ORDERED:
            return "ordered" as const;
          default:
            throw new Error(
              `Unknown rich text list style: ${value.value.value.style}`,
            );
        }
      })();
      return {
        type: "rich_text_list" as const,
        style,
        ...(value.value.value.indent === undefined
          ? {}
          : { indent: value.value.value.indent }),
        ...(value.value.value.offset === undefined
          ? {}
          : { offset: value.value.value.offset }),
        elements: value.value.value.elements.map(richTextSectionFromMessage),
      };
    }
    case "quote":
      return {
        type: "rich_text_quote" as const,
        elements: value.value.value.elements.map(richTextInlineFromMessage),
      };
    case "preformatted":
      return {
        type: "rich_text_preformatted" as const,
        elements: value.value.value.elements.map(richTextInlineFromMessage),
      };
    case undefined:
      throw new Error("Rich text element value is missing");
  }
};

const channelMessageBlockFromMessage = (
  value: MessageBlockMessage,
): ChannelMessageBlock => {
  switch (value.value.case) {
    case "header":
      return {
        type: "header",
        text: plainBlockTextFromMessage(
          requiredMessage(value.value.value.text, "messageBlock.header.text"),
        ),
        ...(value.value.value.blockId === undefined
          ? {}
          : { block_id: value.value.value.blockId }),
      };
    case "section":
      return {
        type: "section",
        text: blockTextFromMessage(
          requiredMessage(value.value.value.text, "messageBlock.section.text"),
        ),
        ...(value.value.value.blockId === undefined
          ? {}
          : { block_id: value.value.value.blockId }),
        ...(value.value.value.expand === undefined
          ? {}
          : { expand: value.value.value.expand }),
      };
    case "markdown":
      return {
        type: "markdown",
        text: value.value.value.text,
        ...(value.value.value.blockId === undefined
          ? {}
          : { block_id: value.value.value.blockId }),
      };
    case "divider":
      return {
        type: "divider",
        ...(value.value.value.blockId === undefined
          ? {}
          : { block_id: value.value.value.blockId }),
      };
    case "context":
      return {
        type: "context",
        elements: value.value.value.elements.map(blockTextFromMessage),
        ...(value.value.value.blockId === undefined
          ? {}
          : { block_id: value.value.value.blockId }),
      };
    case "richText":
      return {
        type: "rich_text",
        elements: value.value.value.elements.map(richTextElementFromMessage),
        ...(value.value.value.blockId === undefined
          ? {}
          : { block_id: value.value.value.blockId }),
      };
    case undefined:
      throw new Error("Channel message block value is missing");
  }
};

const proposalStatusFromProto = (
  value: ProtoProposalStatus,
): ChannelMessageProposal["status"] => {
  switch (value) {
    case ProtoProposalStatus.PENDING:
      return "pending";
    case ProtoProposalStatus.ACCEPTED:
      return "accepted";
    case ProtoProposalStatus.DECLINED:
      return "declined";
    default:
      throw new Error(`Unknown proposal status: ${value}`);
  }
};

export const activeProposalStatusFromProto = (
  value: ProtoProposalStatus,
): ChannelExecutionProposal["status"] => {
  switch (value) {
    case ProtoProposalStatus.PENDING:
      return "pending";
    case ProtoProposalStatus.ACCEPTED:
      return "accepted";
    default:
      throw new Error(`Unknown active proposal status: ${value}`);
  }
};

const proposedIssueFromMessage = (value: ChannelIssueProposalMessage) => {
  const status = runStatusFromProto(value.status);
  if (status !== "backlog" && status !== "queued") {
    throw new Error(`Unknown channel issue proposal status: ${status}`);
  }
  return {
    title: value.title,
    description: value.description ?? null,
    priority: value.priority ?? null,
    status,
  };
};

const channelProposalFromMessage = (
  value: ChannelProposalMessage,
): ChannelMessageProposal => {
  const payload = (() => {
    switch (value.payload.case) {
      case "issue":
        return {
          issue: proposedIssueFromMessage(requiredMessage(
            value.payload.value.issue,
            "channelProposal.issue",
          )),
          executeAfterCreate: value.payload.value.executeAfterCreate,
        };
      case "batch":
        return {
          batch: {
            items: value.payload.value.items.map((item) => ({
              key: item.key,
              issue: proposedIssueFromMessage(requiredMessage(
                item.issue,
                "channelProposal.batch.item.issue",
              )),
            })),
            dependencies: value.payload.value.dependencies.map((dependency) => ({
              prerequisiteKey: dependency.prerequisiteKey,
              dependentKey: dependency.dependentKey,
            })),
          },
          executeAfterCreate: false as const,
        };
      case undefined:
        throw new Error("Channel proposal payload is missing");
    }
  })();
  return {
    id: value.id,
    actionType: "request_issue_create",
    status: proposalStatusFromProto(value.status),
    projectId: value.projectId ?? null,
    payload,
    resultRunId: value.resultRunId ?? null,
    resultItems: value.resultItems.map((item) => ({
      localKey: item.localKey,
      runId: item.runId,
    })),
  };
};

export const issueExecutionProposalFromMessage = (
  value: IssueExecutionProposalMessage,
): ChannelExecutionProposal => ({
  id: value.id,
  type: "request_issue_execute",
  status: activeProposalStatusFromProto(value.status),
  projectId: value.projectId,
  runId: value.runId,
  title: value.title,
  createdAt: requiredTimestamp(value.createdAt, "executionProposal.createdAt"),
  acceptedAt: optionalTimestamp(value.acceptedAt),
  requestedProvider: optionalAgentProviderFromProto(value.requestedProvider),
  requestedModel: value.requestedModel ?? null,
  requestedEffort: value.requestedEffort ?? null,
  requestedWorkerId: value.requestedWorkerId ?? null,
  delegatedByAgentId: value.delegatedByAgentId ?? null,
  delegatedByAgentName: value.delegatedByAgentName ?? null,
});

const skillExecutionStatusFromProto = (
  value: ProtoAgentSkillExecutionStatus,
): AgentSkillExecutionProposal["executionStatus"] => {
  switch (value) {
    case ProtoAgentSkillExecutionStatus.WAITING:
      return "waiting";
    case ProtoAgentSkillExecutionStatus.RUNNING:
      return "running";
    case ProtoAgentSkillExecutionStatus.COMPLETED:
      return "completed";
    case ProtoAgentSkillExecutionStatus.FAILED:
      return "failed";
    default:
      throw new Error(`Unknown Agent Skill execution status: ${value}`);
  }
};

export const agentSkillExecutionProposalFromMessage = (
  value: AgentSkillExecutionProposalMessage,
): AgentSkillExecutionProposal => ({
  id: value.id,
  type: "request_agent_skill_execute",
  status: activeProposalStatusFromProto(value.status),
  projectId: value.projectId,
  agentId: value.agentId,
  agentName: value.agentName,
  skillId: value.skillId,
  skillName: value.skillName,
  provider: agentProviderFromProto(value.provider),
  model: value.model ?? null,
  effort: value.effort ?? null,
  executionMode: skillExecutionModeFromProto(value.executionMode),
  approvalPolicy: skillApprovalPolicyFromProto(value.approvalPolicy),
  executionStatus: skillExecutionStatusFromProto(value.executionStatus),
  request: value.request,
  delegatedByAgentId: value.delegatedByAgentId ?? null,
  delegatedByAgentName: value.delegatedByAgentName ?? null,
  requestedWorkerId: value.requestedWorkerId ?? null,
  requestedWorkerLabel: value.requestedWorkerLabel ?? null,
  resultSessionId: value.resultSessionId ?? null,
  resultMessageId: value.resultMessageId ?? null,
  error: value.error ?? null,
  createdAt: requiredTimestamp(value.createdAt, "skillProposal.createdAt"),
  acceptedAt: optionalTimestamp(value.acceptedAt),
});

const channelMessageAuthorFromMessage = (
  value: ChannelMessageAuthorMessage,
): ChannelMessageAuthor => {
  switch (value.kind) {
    case ProtoChannelMessageAuthorKind.USER:
      return {
        type: "user",
        id: value.id ?? "",
        name: value.name,
        email: value.email ?? "",
        image: value.image ?? null,
      };
    case ProtoChannelMessageAuthorKind.AGENT:
      return {
        type: "agent",
        id: value.id ?? null,
        name: value.name,
        provider: optionalAgentProviderFromProto(value.provider),
        image: value.image ?? null,
      };
    case ProtoChannelMessageAuthorKind.WEBHOOK:
      return {
        type: "webhook",
        id: value.id ?? null,
        name: value.name,
      };
    default:
      throw new Error(`Unknown channel message author kind: ${value.kind}`);
  }
};

export const channelMessageFromMessage = (
  value: ChannelMessageMessage,
): ChannelMessage => ({
  id: value.id,
  channelId: value.channelId,
  parentMessageId: value.parentMessageId ?? null,
  author: channelMessageAuthorFromMessage(requiredMessage(
    value.author,
    "channelMessage.author",
  )),
  body: value.body,
  blocks: value.blocks.map(channelMessageBlockFromMessage),
  mentionedUserIds: [...value.mentionedUserIds],
  mentionedAgentIds: [...value.mentionedAgentIds],
  attachments: value.attachments.map(issueAttachmentFromProto),
  reactions: value.reactions.map((reaction) => ({
    emoji: reaction.emoji,
    count: reaction.count,
    userIds: [...reaction.userIds],
    people: reaction.people.map((person) => ({
      userId: person.userId,
      name: person.name,
      image: person.image ?? null,
    })),
  })),
  replyCount: value.replyCount,
  lastReplyAt: optionalTimestamp(value.lastReplyAt),
  replyAuthors: value.replyAuthors.map(channelMessageAuthorFromMessage),
  subscribers: value.subscribers.map((subscriber) => ({
    userId: subscriber.userId,
    subscribedAt: requiredTimestamp(
      subscriber.subscribedAt,
      "channelMessage.subscriber.subscribedAt",
    ),
  })),
  document: value.document
    ? {
        messageId: value.document.messageId,
        title: value.document.title,
        projectId: value.document.projectId ?? null,
      }
    : null,
  proposal: value.proposal ? channelProposalFromMessage(value.proposal) : null,
  executionProposal: value.executionProposal
    ? issueExecutionProposalFromMessage(value.executionProposal)
    : null,
  skillExecutionProposal: value.skillExecutionProposal
    ? agentSkillExecutionProposalFromMessage(value.skillExecutionProposal)
    : null,
  createdAt: requiredTimestamp(value.createdAt, "channelMessage.createdAt"),
  deletedAt: optionalTimestamp(value.deletedAt),
});

export const channelReplyStatusFromProto = (
  value: ProtoReplyJobStatus,
): ChannelReplyStatus => {
  switch (value) {
    case ProtoReplyJobStatus.QUEUED:
      return "queued";
    case ProtoReplyJobStatus.RUNNING:
      return "running";
    case ProtoReplyJobStatus.COMPLETED:
      return "completed";
    case ProtoReplyJobStatus.FAILED:
      return "failed";
    default:
      throw new Error(`Unknown channel reply status: ${value}`);
  }
};

const channelAgentReplyFromMessage = (
  value: ChannelAgentReplyMessage,
): ChannelAgentReply => ({
  id: value.id,
  agentId: value.agentId,
  channelId: value.channelId,
  triggerMessageId: value.triggerMessageId,
  parentMessageId: value.parentMessageId,
  replyMessageId: value.replyMessageId,
  status: channelReplyStatusFromProto(value.status),
  attempts: value.attempts,
  error: value.error ?? null,
  createdAt: requiredTimestamp(value.createdAt, "channelAgentReply.createdAt"),
  updatedAt: requiredTimestamp(value.updatedAt, "channelAgentReply.updatedAt"),
});

export const cursorToProto = (value: number, field: string): bigint => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} is outside JavaScript's safe integer range`);
  }
  return BigInt(value);
};

const timestampFromIso = (value: string, field: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} is not a valid timestamp`);
  }
  return timestampFromDate(date);
};

export const approvalToMessage = (input: IssueExecutionApprovalInput) => ({
  provider: agentProviderToProto(input.provider),
  model: input.model ?? undefined,
  effort: input.effort ?? undefined,
  workerId: input.workerId ?? undefined,
});

export const approvalOutcomeFromProto = (value: ProtoApprovalOutcome) => {
  switch (value) {
    case ProtoApprovalOutcome.ACCEPTED:
      return "accepted" as const;
    case ProtoApprovalOutcome.ALREADY_ACCEPTED:
      return "already_accepted" as const;
    default:
      throw new Error(`Unknown approval outcome: ${value}`);
  }
};

export const dispatchFromMessage = (value: IssueExecutionDispatchMessage) => {
  const dispatchMode = (() => {
    switch (value.dispatchMode) {
      case ProtoDispatchMode.ANY:
        return "any" as const;
      case ProtoDispatchMode.SPECIFIC:
        return "specific" as const;
      default:
        throw new Error(`Unknown dispatch mode: ${value.dispatchMode}`);
    }
  })();
  const outcome = (() => {
    switch (value.outcome) {
      case ProtoDispatchOutcome.DISPATCHED:
        return "dispatched" as const;
      case ProtoDispatchOutcome.ALREADY_DISPATCHED:
        return "already_dispatched" as const;
      default:
        throw new Error(`Unknown dispatch outcome: ${value.outcome}`);
    }
  })();
  return {
    runId: value.runId,
    agentId: value.agentId ?? null,
    provider: agentProviderFromProto(value.provider),
    model: value.model ?? null,
    effort: value.effort ?? null,
    requestedWorkerId: value.requestedWorkerId ?? null,
    requestedByUserId: value.requestedByUserId,
    dispatchMode,
    dispatchedAt: requiredTimestamp(value.dispatchedAt, "dispatch.dispatchedAt"),
    outcome,
  };
};

export async function listChannels(token: string, organizationId: string) {
  const client = requireChannelClient();
  const response = await client.listChannels(
    { organizationId },
    appCallOptions(token),
  );
  return {
    channels: response.channels.map(channelSummaryFromMessage),
    cursor: safeNumber(response.cursor, "channels.cursor"),
  };
}

export async function listDirectMessageRecipients(
  token: string,
  organizationId: string,
): Promise<{ members: OrganizationMember[]; agents: ChannelAgentSummary[] }> {
  const client = requireChannelClient();
  const response = await client.listDirectMessageRecipients(
    { organizationId },
    appCallOptions(token),
  );
  return {
    members: response.members.map(organizationMemberFromProto),
    agents: response.agents.map(organizationAgentFromMessage),
  };
}

export async function createDirectMessage(
  token: string,
  organizationId: string,
  input: { memberIds: string[]; agentIds: string[] },
) {
  const client = requireChannelClient();
  const response = await client.createDirectMessage(
    { organizationId, memberIds: input.memberIds, agentIds: input.agentIds },
    appCallOptions(token),
  );
  return {
    channel: channelSummaryFromMessage(requiredMessage(
      response.channel,
      "createDirectMessage.channel",
    )),
  };
}

export async function createChannel(
  token: string,
  organizationId: string,
  input: {
    name: string;
    slug?: string;
    topic?: string | null;
    visibility?: ChannelVisibility;
    defaultProjectId?: string | null;
  },
) {
  const client = requireChannelClient();
  const response = await client.createChannel(
    {
      organizationId,
      name: input.name,
      slug: input.slug,
      topic: input.topic ?? undefined,
      visibility: input.visibility === undefined
        ? undefined
        : channelVisibilityToProto(input.visibility),
      defaultProjectId: input.defaultProjectId ?? undefined,
    },
    appCallOptions(token),
  );
  return {
    channel: channelSummaryFromMessage(
      requiredMessage(response.channel, "createChannel.channel"),
    ),
  };
}

export async function updateChannel(
  token: string,
  organizationId: string,
  channelId: string,
  input: {
    name?: string;
    topic?: string | null;
    visibility?: ChannelVisibility;
    defaultProjectId?: string | null;
    archived?: boolean;
  },
) {
  const client = requireChannelClient();
  const response = await client.updateChannel(
    {
      organizationId,
      channelId,
      name: input.name,
      topicUpdate: input.topic === undefined
        ? { case: undefined }
        : input.topic === null
        ? { case: "clearTopic", value: {} }
        : { case: "topic", value: input.topic },
      visibility: input.visibility === undefined
        ? undefined
        : channelVisibilityToProto(input.visibility),
      defaultProjectUpdate: input.defaultProjectId === undefined
        ? { case: undefined }
        : input.defaultProjectId === null
        ? { case: "clearDefaultProject", value: {} }
        : { case: "defaultProjectId", value: input.defaultProjectId },
      archived: input.archived,
    },
    appCallOptions(token),
  );
  return {
    channel: channelSummaryFromMessage(
      requiredMessage(response.channel, "updateChannel.channel"),
    ),
  };
}

export async function deleteChannel(
  token: string,
  organizationId: string,
  channelId: string,
) {
  const client = requireChannelClient();
  const response = await client.deleteChannel(
    { organizationId, channelId },
    appCallOptions(token),
  );
  return { deleted: response.deleted };
}

export async function setChannelAgent(
  token: string,
  organizationId: string,
  channelId: string,
  agentId: string,
  present: boolean,
) {
  const client = requireChannelClient();
  const response = await client.setChannelAgent(
    {
      organizationId,
      channelId,
      agentId,
      membership: present
        ? { case: "add", value: {} }
        : { case: "remove", value: {} },
    },
    appCallOptions(token),
  );
  return { agents: response.agents.map(organizationAgentFromMessage) };
}

export async function setChannelMember(
  token: string,
  organizationId: string,
  channelId: string,
  userId: string,
  present: boolean,
) {
  const client = requireChannelClient();
  const response = await client.setChannelMember(
    {
      organizationId,
      channelId,
      userId,
      membership: present
        ? { case: "add", value: {} }
        : { case: "remove", value: {} },
    },
    appCallOptions(token),
  );
  return { members: response.members.map(channelMemberFromMessage) };
}

export async function listChannelWebhooks(
  token: string,
  organizationId: string,
  channelId: string,
) {
  const client = requireChannelClient();
  const response = await client.listChannelWebhooks(
    { organizationId, channelId },
    appCallOptions(token),
  );
  return { webhooks: response.webhooks.map(channelWebhookFromMessage) };
}

export async function createChannelWebhook(
  token: string,
  organizationId: string,
  channelId: string,
  name: string,
) {
  const client = requireChannelClient();
  const response = await client.createChannelWebhook(
    { organizationId, channelId, name },
    appCallOptions(token),
  );
  return {
    webhook: channelWebhookFromMessage(
      requiredMessage(response.webhook, "createChannelWebhook.webhook"),
    ),
    url: response.url,
  };
}

export async function updateChannelWebhook(
  token: string,
  organizationId: string,
  channelId: string,
  webhookId: string,
  name: string,
) {
  const client = requireChannelClient();
  const response = await client.updateChannelWebhook(
    { organizationId, channelId, webhookId, name },
    appCallOptions(token),
  );
  return {
    webhook: channelWebhookFromMessage(
      requiredMessage(response.webhook, "updateChannelWebhook.webhook"),
    ),
  };
}

export async function rotateChannelWebhook(
  token: string,
  organizationId: string,
  channelId: string,
  webhookId: string,
) {
  const client = requireChannelClient();
  const response = await client.rotateChannelWebhook(
    { organizationId, channelId, webhookId },
    appCallOptions(token),
  );
  return {
    webhook: channelWebhookFromMessage(
      requiredMessage(response.webhook, "rotateChannelWebhook.webhook"),
    ),
    url: response.url,
  };
}

export async function revokeChannelWebhook(
  token: string,
  organizationId: string,
  channelId: string,
  webhookId: string,
) {
  const client = requireChannelClient();
  const response = await client.revokeChannelWebhook(
    { organizationId, channelId, webhookId },
    appCallOptions(token),
  );
  return {
    webhook: channelWebhookFromMessage(
      requiredMessage(response.webhook, "revokeChannelWebhook.webhook"),
    ),
  };
}

export async function loadChannel(
  token: string,
  organizationId: string,
  channelId: string,
  options: { messageLimit?: number; signal?: AbortSignal } = {},
) {
  const client = requireChannelClient();
  const response = await client.getChannel(
    {
      organizationId,
      channelId,
      messageLimit: options.messageLimit,
    },
    appCallOptions(token, options.signal),
  );
  return {
    channel: channelSummaryFromMessage(requiredMessage(
      response.channel,
      "getChannel.channel",
    )),
    members: response.members.map(channelMemberFromMessage),
    agents: response.agents.map(organizationAgentFromMessage),
    messages: response.messages.map(channelMessageFromMessage),
    agentReplies: response.agentReplies.map(channelAgentReplyFromMessage),
    nextCursor: response.nextCursor ?? null,
  };
}

export async function markChannelRead(
  token: string,
  organizationId: string,
  channelId: string,
  input: { lastReadAt?: string } = {},
) {
  const client = requireChannelClient();
  const response = await client.markChannelRead(
    {
      organizationId,
      channelId,
      lastReadAt: input.lastReadAt === undefined
        ? undefined
        : timestampFromIso(input.lastReadAt, "lastReadAt"),
    },
    appCallOptions(token),
  );
  return {
    channel: channelSummaryFromMessage(requiredMessage(
      response.channel,
      "markChannelRead.channel",
    )),
  };
}

export async function listChannelMessages(
  token: string,
  organizationId: string,
  channelId: string,
  parentMessageId?: string,
  page: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
) {
  const client = requireChannelClient();
  const response = await client.listChannelMessages(
    {
      organizationId,
      channelId,
      parentMessageId,
      cursor: page.cursor,
      limit: page.limit,
    },
    appCallOptions(token, page.signal),
  );
  return {
    messages: response.messages.map(channelMessageFromMessage),
    nextCursor: response.nextCursor ?? null,
  };
}

export async function sendChannelMessage(
  token: string,
  organizationId: string,
  channelId: string,
  input: {
    body: string;
    clientMessageId?: string;
    skillId?: string | null;
    parentMessageId?: string | null;
    mentionedUserIds?: string[];
    mentionedAgentIds?: string[];
    preferredDeviceId?: string | null;
    attachments?: File[];
    attachmentReferences?: string[];
  },
) {
  const client = requireChannelClient();
  const clientMessageId = (input.clientMessageId ?? crypto.randomUUID())
    .toLowerCase();
  const attachments = (input.attachments ?? []).map(
    normalizeIssueAttachmentFile,
  );
  const attachmentReferences = input.attachmentReferences ?? [];
  if (
    attachments.length !== attachmentReferences.length ||
    new Set(attachmentReferences).size !== attachmentReferences.length
  ) {
    throw new Error("Channel attachments and local references must match");
  }
  const localFiles = attachments.map((file, index) => ({
    clientId: attachmentReferences[index]!,
    file,
  }));
  const attachmentIds = localFiles.length === 0
    ? []
    : await client.prepareChannelMessageAttachments(
        {
          requestId: crypto.randomUUID(),
          organizationId,
          channelId,
          clientMessageId,
          attachments: await Promise.all(
            localFiles.map(async ({ clientId, file }) => ({
              clientId,
              filename: file.name,
              contentType: file.type,
              byteSize: BigInt(file.size),
              sha256: new Uint8Array(
                await crypto.subtle.digest(
                  "SHA-256",
                  await file.arrayBuffer(),
                ),
              ),
            })),
          ),
        },
        appCallOptions(token),
      ).then((prepared) =>
        uploadPreparedFiles({
          apiUrl: briarApiUrl,
          files: localFiles,
          uploads: prepared.uploads,
          uploadId: (upload) => upload.reference?.uploadId,
        })
      );
  const body = canonicalizeIssueAttachmentReferences(
    input.body,
    attachmentReferences,
    attachmentIds,
  ) ?? input.body;

  return createChannelMessageResultFromMessage(
    await client.createChannelMessage(
      {
        organizationId,
        channelId,
        clientMessageId,
        body,
        parentMessageId: input.parentMessageId ?? undefined,
        mentionedUserIds: input.mentionedUserIds ?? [],
        mentionedAgentIds: input.mentionedAgentIds ?? [],
        skillId: input.skillId ?? undefined,
        preferredDeviceId: input.preferredDeviceId ?? undefined,
        attachments: attachmentIds.map((uploadId) => ({ uploadId })),
      },
      appCallOptions(token),
    ),
  );
}

const createChannelMessageResultFromMessage = (
  response: CreateChannelMessageResponseMessage,
) => ({
  message: channelMessageFromMessage(requiredMessage(
    response.message,
    "createChannelMessage.message",
  )),
  agentReplies: response.agentReplies.map(channelAgentReplyFromMessage),
});

export async function deleteChannelMessage(
  token: string,
  organizationId: string,
  channelId: string,
  messageId: string,
): Promise<DeleteChannelMessageResponse> {
  const client = requireChannelClient();
  const response = await client.deleteChannelMessage(
    { organizationId, channelId, messageId },
    appCallOptions(token),
  );
  return {
    deleted: response.deleted,
    message: response.message
      ? channelMessageFromMessage(response.message)
      : null,
    parentMessage: response.parentMessage
      ? channelMessageFromMessage(response.parentMessage)
      : null,
  };
}

export async function toggleChannelMessageReaction(
  token: string,
  organizationId: string,
  channelId: string,
  messageId: string,
  emoji: string,
) {
  const client = requireChannelClient();
  const response = await client.toggleChannelMessageReaction(
    { organizationId, channelId, messageId, emoji },
    appCallOptions(token),
  );
  return {
    message: channelMessageFromMessage(requiredMessage(
      response.message,
      "toggleChannelMessageReaction.message",
    )),
  };
}

export async function updateChannelThreadSubscription(
  token: string,
  organizationId: string,
  channelId: string,
  messageId: string,
  subscribed: boolean,
) {
  const client = requireChannelClient();
  const response = await client.setChannelThreadSubscription(
    { organizationId, channelId, rootMessageId: messageId, subscribed },
    appCallOptions(token),
  );
  return {
    rootMessageId: response.rootMessageId,
    subscribers: response.subscribers.map((subscriber) => ({
      userId: subscriber.userId,
      subscribedAt: requiredTimestamp(
        subscriber.subscribedAt,
        "channelSubscription.subscribedAt",
      ),
    })),
  };
}

export async function acceptChannelProposal(
  token: string,
  organizationId: string,
  channelId: string,
  proposalId: string,
  projectId: string | null,
  execution: IssueExecutionApprovalInput | null = null,
) {
  const client = requireChannelClient();
  const response = await client.acceptChannelProposal(
    {
      organizationId,
      channelId,
      proposalId,
      projectId: projectId ?? undefined,
      execution: execution ? approvalToMessage(execution) : undefined,
    },
    appCallOptions(token),
  );
  return {
    outcome: approvalOutcomeFromProto(response.outcome),
    projectId: response.projectId,
    resultRunId: response.resultRunId,
    resultItems: response.resultItems.map((item) => ({
      localKey: item.localKey,
      runId: item.runId,
    })),
    executionProposal: response.executionProposal
      ? issueExecutionProposalFromMessage(response.executionProposal)
      : null,
    dispatch: response.dispatch ? dispatchFromMessage(response.dispatch) : null,
  };
}

export async function declineChannelProposal(
  token: string,
  organizationId: string,
  channelId: string,
  proposalId: string,
) {
  const client = requireChannelClient();
  const response = await client.declineChannelProposal(
    { organizationId, channelId, proposalId },
    appCallOptions(token),
  );
  const outcome = (() => {
    switch (response.outcome) {
      case ProtoDeclineOutcome.DECLINED:
        return "declined" as const;
      case ProtoDeclineOutcome.ALREADY_DECLINED:
        return "already_declined" as const;
      default:
        throw new Error(`Unknown decline outcome: ${response.outcome}`);
    }
  })();
  return { outcome };
}

export async function acceptChannelExecutionProposal(
  token: string,
  organizationId: string,
  channelId: string,
  proposalId: string,
  input: IssueExecutionApprovalInput,
) {
  const client = requireChannelClient();
  const response = await client.acceptChannelExecutionProposal(
    {
      organizationId,
      channelId,
      proposalId,
      approval: approvalToMessage(input),
    },
    appCallOptions(token),
  );
  return {
    proposal: issueExecutionProposalFromMessage(requiredMessage(
      response.proposal,
      "acceptChannelExecutionProposal.proposal",
    )),
    outcome: approvalOutcomeFromProto(response.outcome),
    projectId: response.projectId,
    runId: response.runId,
    dispatch: dispatchFromMessage(requiredMessage(
      response.dispatch,
      "acceptChannelExecutionProposal.dispatch",
    )),
  };
}

export const assertPendingAgentSkillExecutionApproval = (
  proposal: AgentSkillExecutionProposal,
  input: AgentSkillExecutionApprovalInput,
) => {
  if (
    proposal.status !== "pending" ||
    proposal.acceptedAt !== null ||
    proposal.requestedWorkerId !== null ||
    proposal.requestedWorkerLabel !== null ||
    proposal.resultSessionId !== null ||
    (proposal.executionMode === "task" &&
      (!input.workerId || input.workerId !== input.workerId.trim())) ||
    (proposal.executionMode === "conversation" && input.workerId !== undefined)
  ) {
    throw new Error(
      "Skill execution approval requires one exact Worker and a pending proposal.",
    );
  }
};

const skillExecutionSnapshotKeys = [
  "id",
  "type",
  "projectId",
  "agentId",
  "agentName",
  "skillId",
  "skillName",
  "request",
  "provider",
  "model",
  "effort",
  "executionMode",
  "approvalPolicy",
  "createdAt",
  "delegatedByAgentId",
  "delegatedByAgentName",
] as const satisfies readonly (keyof AgentSkillExecutionProposal)[];

export const validateAgentSkillExecutionAcceptance = (
  result: {
    proposal: AgentSkillExecutionProposal;
    outcome: "accepted" | "already_accepted";
    projectId: string;
    session: AutoHuntSession | null;
  },
  expected: AgentSkillExecutionProposal,
  input: AgentSkillExecutionApprovalInput,
) => {
  const snapshotChanged = skillExecutionSnapshotKeys.some(
    (key) => result.proposal[key] !== expected[key],
  );
  if (
    snapshotChanged ||
    result.projectId !== expected.projectId ||
    result.proposal.status !== "accepted" ||
    !result.proposal.acceptedAt ||
    !result.proposal.requestedWorkerLabel?.trim() ||
    (expected.executionMode === "conversation"
      ? result.session !== null ||
        !result.proposal.requestedWorkerId ||
        !result.proposal.resultMessageId
      : result.session === null ||
        result.proposal.requestedWorkerId !== input.workerId ||
        result.proposal.resultSessionId !== result.session.id ||
        result.session.projectId !== expected.projectId ||
        result.session.agentId !== expected.agentId ||
        result.session.agentName !== expected.agentName ||
        result.session.skillId !== expected.skillId ||
        result.session.sessionType !== "task" ||
        result.session.trigger !== "manual" ||
        result.session.request !== expected.request ||
        result.session.requestedWorkerId !== input.workerId ||
        result.session.workerId !== input.workerId)
  ) {
    throw new Error(
      "Skill execution approval returned inconsistent immutable evidence.",
    );
  }
  return result;
};

export async function acceptChannelSkillExecutionProposal(
  token: string,
  organizationId: string,
  channelId: string,
  expectedProposal: AgentSkillExecutionProposal,
  input: AgentSkillExecutionApprovalInput,
) {
  assertPendingAgentSkillExecutionApproval(expectedProposal, input);
  const client = requireChannelClient();
  const response = await client.acceptChannelSkillExecutionProposal(
    {
      organizationId,
      channelId,
      proposalId: expectedProposal.id,
      workerId: input.workerId,
    },
    appCallOptions(token),
  );
  const result = {
    proposal: agentSkillExecutionProposalFromMessage(requiredMessage(
      response.proposal,
      "acceptChannelSkillExecutionProposal.proposal",
    )),
    outcome: approvalOutcomeFromProto(response.outcome),
    projectId: response.projectId,
    session: response.session
      ? projectAgentSessionFromMessage(response.session, true)
      : null,
  };
  return validateAgentSkillExecutionAcceptance(result, expectedProposal, input);
}

export async function loadChannelDelta(
  token: string,
  organizationId: string,
  since: number,
  signal?: AbortSignal,
): Promise<ChannelDelta> {
  const client = requireChannelClient();
  const response = await client.syncChannels(
    {
      organizationId,
      cursor: cursorToProto(since, "channels.cursor"),
    },
    appCallOptions(token, signal),
  );
  return channelDeltaFromMessage(response);
}

export const channelDocumentContentFromMessage = (
  value: ChannelDocumentContentMessage,
): ChannelMessageDocumentContent => ({
  messageId: value.messageId,
  title: value.title,
  markdown: value.markdown,
  projectId: value.projectId ?? null,
});

export async function loadChannelMessageDocument(
  token: string,
  organizationId: string,
  channelId: string,
  messageId: string,
) {
  const client = requireChannelClient();
  return ({
    document: channelDocumentContentFromMessage(requiredMessage(
      (await client.getChannelMessageDocument(
        { organizationId, channelId, messageId },
        appCallOptions(token),
      )).document,
      "getChannelMessageDocument.document",
    )),
  });
}

export const channelLinkPreviewFromMessage = (
  value: ChannelLinkPreviewMessage,
): ChannelLinkPreview => ({
  url: value.url,
  title: value.title ?? null,
  description: value.description ?? null,
  imageUrl: value.imageUrl ?? null,
  faviconUrl: value.faviconUrl ?? null,
  siteName: value.siteName ?? null,
});

export async function loadChannelLinkPreview(
  token: string,
  organizationId: string,
  channelId: string,
  targetUrl: string,
) {
  const client = requireChannelClient();
  const response = await client.getChannelLinkPreview(
    { organizationId, channelId, url: targetUrl },
    appCallOptions(token),
  );
  return {
    preview: response.preview
      ? channelLinkPreviewFromMessage(response.preview)
      : null,
  };
}

export const channelDeltaFromMessage = (
  response: SyncChannelsResponseMessage,
): ChannelDelta => ({
  cursor: safeNumber(response.cursor, "channels.cursor"),
  hasMore: response.hasMore,
  reset: response.reset,
  channels: response.channels.map(channelSummaryFromMessage),
  removedChannelIds: [...response.removedChannelIds],
  messages: response.messages.map(channelMessageFromMessage),
  removedMessageIds: [...response.removedMessageIds],
  agentReplies: response.agentReplies.map(channelAgentReplyFromMessage),
});
