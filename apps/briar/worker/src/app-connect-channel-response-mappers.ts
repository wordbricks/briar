import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  AgentSkillApprovalPolicy,
  AgentSkillExecutionMode,
  AgentSkillExecutionProposalSchema,
  AgentSkillExecutionStatus,
  AgentSkillKind,
  OrganizationAgentSchema,
  ProjectAgentSessionEventSchema,
  ProjectAgentSessionEventType,
  ProjectAgentSessionFollowUpSchema,
  ProjectAgentSessionIssueOutcome,
  ProjectAgentSessionIssueSchema,
  ProjectAgentSessionSchema,
  ProjectAgentSessionStatus,
  ProjectAgentSessionTrigger,
  ProjectAgentSessionType,
  ProjectAgentSkillSchema,
} from "@briar/contracts/gen/briar/app/v1/agent_pb";
import {
  ApprovalOutcome,
  BlockText_Kind,
  BlockTextSchema,
  IssueAttachmentSchema,
  IssueSubscriberSchema,
  MessageBlock_ContextSchema,
  MessageBlock_DividerSchema,
  MessageBlock_HeaderSchema,
  MessageBlock_MarkdownSchema,
  MessageBlock_RichTextSchema,
  MessageBlock_SectionSchema,
  MessageBlockSchema,
  ProposalStatus,
  ReplyJobStatus,
  RichTextElement_List_Style,
  RichTextElement_ListSchema,
  RichTextElement_PreformattedSchema,
  RichTextElement_QuoteSchema,
  RichTextElementSchema,
  RichTextInline_EmojiSchema,
  RichTextInline_LinkSchema,
  RichTextInline_TextSchema,
  RichTextInlineSchema,
  RichTextSectionSchema,
  RichTextStyleSchema,
} from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  AcceptChannelExecutionProposalResponseSchema,
  AcceptChannelProposalResponseSchema,
  AcceptChannelSkillExecutionProposalResponseSchema,
  ChannelAgentReplySchema,
  ChannelDocumentSchema,
  ChannelIssueBatchProposalDependencySchema,
  ChannelIssueBatchProposalItemSchema,
  ChannelIssueBatchProposalPayloadSchema,
  ChannelIssueBatchResultItemSchema,
  ChannelIssueProposalPayloadSchema,
  ChannelIssueProposalSchema,
  ChannelKind,
  ChannelMessageAgentAuthorSchema,
  ChannelMessageAuthorSchema,
  ChannelMessageReactionPersonSchema,
  ChannelMessageReactionSchema,
  ChannelMessageSchema,
  ChannelMessageUserAuthorSchema,
  ChannelMessageWebhookAuthorSchema,
  ChannelProposalSchema,
  ChannelSummarySchema,
  ChannelVisibility,
  CreateChannelMessageResponseSchema,
  DirectMessageParticipant_Kind,
  DirectMessageParticipantSchema,
} from "@briar/contracts/gen/briar/app/v1/channel_pb";
import {
  IssueExecutionDispatch_DispatchMode,
  IssueExecutionDispatch_Outcome,
  IssueExecutionDispatchSchema,
  IssueExecutionProposalSchema,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { Code, ConnectError } from "@connectrpc/connect";
import type { AgentProvider as DomainAgentProvider } from "../../src/lib/agent-provider";
import type {
  ChannelAgentReply,
  ChannelAgentSummary,
  ChannelBlockTextObject,
  ChannelExecutionProposal,
  ChannelMessage,
  ChannelMessageAuthor,
  ChannelMessageBlock,
  ChannelMessageProposal,
  ChannelSkillExecutionProposal,
  ChannelSummary,
  ChannelThreadSubscriber,
} from "../../src/lib/channels-contract";
import { decodeTeamAgentSessionInput } from "./team-request-contract";

const internal = (message: string, cause?: unknown): never => {
  throw new ConnectError(message, Code.Internal, undefined, undefined, cause);
};

const requiredTimestamp = (value: string, field: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return internal(`Invalid ${field} timestamp`);
  }
  return timestampFromDate(date);
};

const optionalTimestamp = (
  value: string | null | undefined,
  field: string,
) => value == null ? undefined : requiredTimestamp(value, field);

const enumValue = <Key extends string, Value>(
  values: Readonly<Record<Key, Value>>,
  key: Key,
  field: string,
): Value => {
  const value = values[key];
  return value === undefined
    ? internal(`Invalid ${field} value: ${String(key)}`)
    : value;
};

const agentProvider = {
  codex: AgentProvider.CODEX,
  claude: AgentProvider.CLAUDE,
  cursor: AgentProvider.CURSOR,
  grok: AgentProvider.GROK,
  agy: AgentProvider.AGY,
  opencode: AgentProvider.OPENCODE,
  openrouter: AgentProvider.OPENROUTER,
} as const satisfies Record<DomainAgentProvider, AgentProvider>;

const proposalStatus = {
  pending: ProposalStatus.PENDING,
  accepted: ProposalStatus.ACCEPTED,
  declined: ProposalStatus.DECLINED,
} as const;

const replyJobStatus = {
  queued: ReplyJobStatus.QUEUED,
  running: ReplyJobStatus.RUNNING,
  completed: ReplyJobStatus.COMPLETED,
  failed: ReplyJobStatus.FAILED,
} as const;

const channelVisibility = {
  public: ChannelVisibility.PUBLIC,
  private: ChannelVisibility.PRIVATE,
} as const;

const channelKind = {
  channel: ChannelKind.CHANNEL,
  dm: ChannelKind.DIRECT_MESSAGE,
} as const;

const skillKind = {
  issue_processing: AgentSkillKind.ISSUE_PROCESSING,
  custom: AgentSkillKind.CUSTOM,
} as const;

const skillExecutionMode = {
  conversation: AgentSkillExecutionMode.CONVERSATION,
  task: AgentSkillExecutionMode.TASK,
} as const;

const skillApprovalPolicy = {
  invoke_is_consent: AgentSkillApprovalPolicy.INVOKE_IS_CONSENT,
  explicit: AgentSkillApprovalPolicy.EXPLICIT,
} as const;

const skillExecutionStatus = {
  waiting: AgentSkillExecutionStatus.WAITING,
  running: AgentSkillExecutionStatus.RUNNING,
  completed: AgentSkillExecutionStatus.COMPLETED,
  failed: AgentSkillExecutionStatus.FAILED,
} as const;

const sessionType = {
  task: ProjectAgentSessionType.TASK,
  dispatch: ProjectAgentSessionType.DISPATCH,
} as const;

const sessionTrigger = {
  manual: ProjectAgentSessionTrigger.MANUAL,
  scheduled: ProjectAgentSessionTrigger.SCHEDULED,
} as const;

const sessionStatus = {
  running: ProjectAgentSessionStatus.RUNNING,
  completed: ProjectAgentSessionStatus.COMPLETED,
  failed: ProjectAgentSessionStatus.FAILED,
  skipped: ProjectAgentSessionStatus.SKIPPED,
  interrupted: ProjectAgentSessionStatus.INTERRUPTED,
} as const;

const sessionIssueOutcome = {
  pending: ProjectAgentSessionIssueOutcome.PENDING,
  completed: ProjectAgentSessionIssueOutcome.COMPLETED,
  blocked: ProjectAgentSessionIssueOutcome.BLOCKED,
  failed: ProjectAgentSessionIssueOutcome.FAILED,
  skipped: ProjectAgentSessionIssueOutcome.SKIPPED,
} as const;

const sessionEventType = {
  started: ProjectAgentSessionEventType.STARTED,
  completed: ProjectAgentSessionEventType.COMPLETED,
  failed: ProjectAgentSessionEventType.FAILED,
  skipped: ProjectAgentSessionEventType.SKIPPED,
  interrupted: ProjectAgentSessionEventType.INTERRUPTED,
  stopped: ProjectAgentSessionEventType.STOPPED,
} as const;

const richTextListStyle = {
  bullet: RichTextElement_List_Style.BULLET,
  ordered: RichTextElement_List_Style.ORDERED,
} as const;

const executionDispatchMode = {
  any: IssueExecutionDispatch_DispatchMode.ANY,
  specific: IssueExecutionDispatch_DispatchMode.SPECIFIC,
} as const;

const executionDispatchOutcome = {
  dispatched: IssueExecutionDispatch_Outcome.DISPATCHED,
  already_dispatched: IssueExecutionDispatch_Outcome.ALREADY_DISPATCHED,
} as const;

const proposalApprovalOutcome = {
  accepted: ApprovalOutcome.ACCEPTED,
  already_accepted: ApprovalOutcome.ALREADY_ACCEPTED,
} as const;

const appDirectMessageParticipant = (
  participant: NonNullable<ChannelSummary["dmParticipants"]>[number],
) => {
  switch (participant.type) {
    case "user":
      return create(DirectMessageParticipantSchema, {
        kind: DirectMessageParticipant_Kind.USER,
        id: participant.id,
        name: participant.name,
        image: participant.image ?? undefined,
      });
    case "agent":
      return create(DirectMessageParticipantSchema, {
        kind: DirectMessageParticipant_Kind.AGENT,
        id: participant.id,
        name: participant.name,
        image: participant.image ?? undefined,
      });
    default:
      return internal("Invalid direct-message participant kind");
  }
};

/** Maps the transport-neutral channel projection to the generated DTO. */
export const appChannelSummaryJson = (channel: ChannelSummary) => {
  if (channel.kind === undefined) {
    return internal("Channel kind is missing");
  }
  return create(ChannelSummarySchema, {
    id: channel.id,
    organizationId: channel.organizationId,
    slug: channel.slug,
    name: channel.name,
    topic: channel.topic ?? undefined,
    visibility: enumValue(
      channelVisibility,
      channel.visibility,
      "channel visibility",
    ),
    defaultProjectId: channel.defaultProjectId ?? undefined,
    archivedAt: optionalTimestamp(channel.archivedAt, "channel archive"),
    memberCount: channel.memberCount,
    agentCount: channel.agentCount,
    createdAt: requiredTimestamp(channel.createdAt, "channel creation"),
    updatedAt: requiredTimestamp(channel.updatedAt, "channel update"),
    kind: enumValue(channelKind, channel.kind, "channel kind"),
    lastMessageAt: optionalTimestamp(
      channel.lastMessageAt,
      "channel last message",
    ),
    lastMessagePreview: channel.lastMessagePreview ?? undefined,
    lastReadAt: optionalTimestamp(channel.lastReadAt, "channel last read"),
    hasUnread: channel.hasUnread,
    directMessageParticipants: channel.dmParticipants.map(
      appDirectMessageParticipant,
    ),
    createdByUserId: channel.createdByUserId ?? undefined,
  });
};

const appChannelAgentSkill = (
  skill: ChannelAgentSummary["skills"][number],
) => create(ProjectAgentSkillSchema, {
  id: skill.id,
  agentId: skill.agentId,
  name: skill.name,
  description: skill.description,
  body: skill.body,
  provider: enumValue(agentProvider, skill.provider, "Agent Skill provider"),
  model: skill.model ?? undefined,
  effort: skill.effort ?? undefined,
  kind: enumValue(skillKind, skill.kind, "Agent Skill kind"),
  executionMode: enumValue(
    skillExecutionMode,
    skill.executionMode,
    "Agent Skill execution mode",
  ),
  approvalPolicy: enumValue(
    skillApprovalPolicy,
    skill.approvalPolicy,
    "Agent Skill approval policy",
  ),
  position: skill.position,
  createdAt: requiredTimestamp(skill.createdAt, "Agent Skill creation"),
  updatedAt: requiredTimestamp(skill.updatedAt, "Agent Skill update"),
});

export const appChannelAgent = (agent: ChannelAgentSummary) =>
  create(OrganizationAgentSchema, {
    agentId: agent.agentId,
    name: agent.name,
    avatar: agent.avatar ?? undefined,
    provider: enumValue(agentProvider, agent.provider, "Agent provider"),
    model: agent.model ?? undefined,
    effort: agent.effort ?? undefined,
    projectId: agent.projectId ?? undefined,
    projectName: agent.projectName ?? undefined,
    description: agent.description || undefined,
    responsibility: agent.responsibility,
    skills: agent.skills.map(appChannelAgentSkill),
    createdAt: requiredTimestamp(agent.createdAt, "Agent creation"),
  });

const appBlockText = (text: ChannelBlockTextObject) => {
  switch (text.type) {
    case "plain_text":
      return create(BlockTextSchema, {
        kind: BlockText_Kind.PLAIN_TEXT,
        text: text.text,
        emoji: text.emoji,
      });
    case "mrkdwn":
      return create(BlockTextSchema, {
        kind: BlockText_Kind.MARKDOWN,
        text: text.text,
        verbatim: text.verbatim,
      });
    default:
      return internal("Invalid block text kind");
  }
};

type RichTextBlock = Extract<ChannelMessageBlock, { type: "rich_text" }>;
type RichTextElement = RichTextBlock["elements"][number];
type RichTextSection = Extract<
  RichTextElement,
  { type: "rich_text_section" }
>;
type RichTextInline = RichTextSection["elements"][number];
type RichTextStyle = NonNullable<
  Extract<RichTextInline, { type: "text" | "link" }>["style"]
>;

const appRichTextStyle = (style: RichTextStyle | undefined) =>
  style === undefined ? undefined : create(RichTextStyleSchema, style);

const appRichTextInline = (inline: RichTextInline) => {
  switch (inline.type) {
    case "text":
      return create(RichTextInlineSchema, {
        value: {
          case: "text",
          value: create(RichTextInline_TextSchema, {
            text: inline.text,
            style: appRichTextStyle(inline.style),
          }),
        },
      });
    case "link":
      return create(RichTextInlineSchema, {
        value: {
          case: "link",
          value: create(RichTextInline_LinkSchema, {
            url: inline.url,
            text: inline.text,
            style: appRichTextStyle(inline.style),
          }),
        },
      });
    case "emoji":
      return create(RichTextInlineSchema, {
        value: {
          case: "emoji",
          value: create(RichTextInline_EmojiSchema, { name: inline.name }),
        },
      });
    default:
      return internal("Invalid rich-text inline oneof");
  }
};

const appRichTextSection = (section: RichTextSection) =>
  create(RichTextSectionSchema, {
    elements: section.elements.map(appRichTextInline),
  });

const appRichTextElement = (element: RichTextElement) => {
  switch (element.type) {
    case "rich_text_section":
      return create(RichTextElementSchema, {
        value: { case: "section", value: appRichTextSection(element) },
      });
    case "rich_text_list":
      return create(RichTextElementSchema, {
        value: {
          case: "list",
          value: create(RichTextElement_ListSchema, {
            style: enumValue(
              richTextListStyle,
              element.style,
              "rich-text list style",
            ),
            indent: element.indent,
            offset: element.offset,
            elements: element.elements.map(appRichTextSection),
          }),
        },
      });
    default:
      return internal("Invalid rich-text element oneof");
    case "rich_text_quote":
      return create(RichTextElementSchema, {
        value: {
          case: "quote",
          value: create(RichTextElement_QuoteSchema, {
            elements: element.elements.map(appRichTextInline),
          }),
        },
      });
    case "rich_text_preformatted":
      return create(RichTextElementSchema, {
        value: {
          case: "preformatted",
          value: create(RichTextElement_PreformattedSchema, {
            elements: element.elements.map(appRichTextInline),
          }),
        },
      });
  }
};

const appMessageBlock = (block: ChannelMessageBlock) => {
  switch (block.type) {
    case "header":
      return create(MessageBlockSchema, {
        value: {
          case: "header",
          value: create(MessageBlock_HeaderSchema, {
            text: appBlockText(block.text),
            blockId: block.block_id,
          }),
        },
      });
    case "section":
      return create(MessageBlockSchema, {
        value: {
          case: "section",
          value: create(MessageBlock_SectionSchema, {
            text: appBlockText(block.text),
            blockId: block.block_id,
            expand: block.expand,
          }),
        },
      });
    case "markdown":
      return create(MessageBlockSchema, {
        value: {
          case: "markdown",
          value: create(MessageBlock_MarkdownSchema, {
            text: block.text,
            blockId: block.block_id,
          }),
        },
      });
    case "divider":
      return create(MessageBlockSchema, {
        value: {
          case: "divider",
          value: create(MessageBlock_DividerSchema, {
            blockId: block.block_id,
          }),
        },
      });
    case "context":
      return create(MessageBlockSchema, {
        value: {
          case: "context",
          value: create(MessageBlock_ContextSchema, {
            elements: block.elements.map(appBlockText),
            blockId: block.block_id,
          }),
        },
      });
    case "rich_text":
      return create(MessageBlockSchema, {
        value: {
          case: "richText",
          value: create(MessageBlock_RichTextSchema, {
            elements: block.elements.map(appRichTextElement),
            blockId: block.block_id,
          }),
        },
      });
    default:
      return internal("Invalid message block oneof");
  }
};

const appChannelMessageAuthor = (author: ChannelMessageAuthor) => {
  switch (author.type) {
    case "user":
      return create(ChannelMessageAuthorSchema, {
        author: {
          case: "user",
          value: create(ChannelMessageUserAuthorSchema, {
            id: author.id,
            name: author.name,
            email: author.email,
            image: author.image ?? undefined,
          }),
        },
      });
    case "agent":
      return create(ChannelMessageAuthorSchema, {
        author: {
          case: "agent",
          value: create(ChannelMessageAgentAuthorSchema, {
            id: author.id ?? undefined,
            name: author.name,
            image: author.image ?? undefined,
            provider: author.provider === null
              ? undefined
              : enumValue(agentProvider, author.provider, "message author provider"),
          }),
        },
      });
    case "webhook":
      return create(ChannelMessageAuthorSchema, {
        author: {
          case: "webhook",
          value: create(ChannelMessageWebhookAuthorSchema, {
            id: author.id ?? undefined,
            name: author.name,
          }),
        },
      });
    default:
      return internal("Invalid channel message author kind");
  }
};

const appIssueExecutionProposal = (proposal: ChannelExecutionProposal) =>
  create(IssueExecutionProposalSchema, {
    id: proposal.id,
    status: enumValue(proposalStatus, proposal.status, "proposal status"),
    projectId: proposal.projectId,
    runId: proposal.runId,
    title: proposal.title,
    createdAt: requiredTimestamp(proposal.createdAt, "execution proposal creation"),
    acceptedAt: optionalTimestamp(
      proposal.acceptedAt,
      "execution proposal acceptance",
    ),
    requestedProvider: proposal.requestedProvider === null
      ? undefined
      : enumValue(
          agentProvider,
          proposal.requestedProvider,
          "execution proposal provider",
        ),
    requestedModel: proposal.requestedModel ?? undefined,
    requestedEffort: proposal.requestedEffort ?? undefined,
    requestedWorkerId: proposal.requestedWorkerId ?? undefined,
    delegatedByAgentId: proposal.delegatedByAgentId ?? undefined,
    delegatedByAgentName: proposal.delegatedByAgentName ?? undefined,
  });

const appAgentSkillExecutionProposal = (
  proposal: ChannelSkillExecutionProposal,
) => create(AgentSkillExecutionProposalSchema, {
  id: proposal.id,
  status: enumValue(proposalStatus, proposal.status, "proposal status"),
  projectId: proposal.projectId,
  agentId: proposal.agentId,
  agentName: proposal.agentName,
  skillId: proposal.skillId,
  skillName: proposal.skillName,
  request: proposal.request,
  provider: enumValue(agentProvider, proposal.provider, "Agent Skill provider"),
  model: proposal.model ?? undefined,
  effort: proposal.effort ?? undefined,
  executionMode: enumValue(
    skillExecutionMode,
    proposal.executionMode,
    "Agent Skill execution mode",
  ),
  approvalPolicy: enumValue(
    skillApprovalPolicy,
    proposal.approvalPolicy,
    "Agent Skill approval policy",
  ),
  executionStatus: enumValue(
    skillExecutionStatus,
    proposal.executionStatus,
    "Agent Skill execution status",
  ),
  createdAt: requiredTimestamp(proposal.createdAt, "Agent Skill proposal creation"),
  acceptedAt: optionalTimestamp(
    proposal.acceptedAt,
    "Agent Skill proposal acceptance",
  ),
  requestedWorkerId: proposal.requestedWorkerId ?? undefined,
  requestedWorkerLabel: proposal.requestedWorkerLabel ?? undefined,
  resultSessionId: proposal.resultSessionId ?? undefined,
  resultMessageId: proposal.resultMessageId ?? undefined,
  error: proposal.error ?? undefined,
  delegatedByAgentId: proposal.delegatedByAgentId ?? undefined,
  delegatedByAgentName: proposal.delegatedByAgentName ?? undefined,
});

const decodedProposalPayload = (proposal: ChannelMessageProposal) => {
  if ("batch" in proposal.payload) {
    const payload = proposal.payload;
    return {
      case: "batch" as const,
      value: create(ChannelIssueBatchProposalPayloadSchema, {
        items: payload.batch.items.map((item) =>
          create(ChannelIssueBatchProposalItemSchema, {
            key: item.key,
            issue: create(ChannelIssueProposalSchema, {
              title: item.issue.title,
              description: item.issue.description ?? undefined,
              priority: item.issue.priority ?? undefined,
            }),
          })
        ),
        dependencies: payload.batch.dependencies.map((dependency) =>
          create(ChannelIssueBatchProposalDependencySchema, dependency)
        ),
      }),
    };
  }
  const payload = proposal.payload;
  return {
    case: "issue" as const,
    value: create(ChannelIssueProposalPayloadSchema, {
      issue: create(ChannelIssueProposalSchema, {
        title: payload.issue.title,
        description: payload.issue.description ?? undefined,
        priority: payload.issue.priority ?? undefined,
      }),
      executeAfterCreate: payload.executeAfterCreate,
    }),
  };
};

const appChannelProposal = (proposal: ChannelMessageProposal) =>
  create(ChannelProposalSchema, {
    id: proposal.id,
    status: enumValue(proposalStatus, proposal.status, "proposal status"),
    projectId: proposal.projectId ?? undefined,
    payload: decodedProposalPayload(proposal),
    resultRunId: proposal.resultRunId ?? undefined,
    resultItems: proposal.resultItems.map((item) =>
      create(ChannelIssueBatchResultItemSchema, item)
    ),
  });

export const appChannelSubscriber = (subscriber: ChannelThreadSubscriber) =>
  create(IssueSubscriberSchema, {
    userId: subscriber.userId,
    subscribedAt: requiredTimestamp(
      subscriber.subscribedAt,
      "channel subscription",
    ),
  });

export const appChannelMessage = (message: ChannelMessage) =>
  create(ChannelMessageSchema, {
    id: message.id,
    channelId: message.channelId,
    parentMessageId: message.parentMessageId ?? undefined,
    body: message.body,
    blocks: message.blocks.map(appMessageBlock),
    author: appChannelMessageAuthor(message.author),
    mentionedUserIds: message.mentionedUserIds,
    mentionedAgentIds: message.mentionedAgentIds,
    attachments: message.attachments.map((attachment) =>
      create(IssueAttachmentSchema, {
        id: attachment.id,
        filename: attachment.filename,
        contentType: attachment.contentType,
        byteSize: BigInt(attachment.byteSize),
        url: attachment.url,
      })
    ),
    reactions: message.reactions.map((reaction) =>
      create(ChannelMessageReactionSchema, {
        emoji: reaction.emoji,
        count: reaction.count,
        userIds: reaction.userIds,
        people: (reaction.people ?? []).map((person) =>
          create(ChannelMessageReactionPersonSchema, {
            userId: person.userId,
            name: person.name,
            image: person.image ?? undefined,
          })
        ),
      })
    ),
    replyCount: message.replyCount,
    lastReplyAt: optionalTimestamp(message.lastReplyAt, "channel last reply"),
    replyAuthors: message.replyAuthors.map(appChannelMessageAuthor),
    document: message.document
      ? create(ChannelDocumentSchema, {
          messageId: message.document.messageId,
          title: message.document.title,
          projectId: message.document.projectId ?? undefined,
        })
      : undefined,
    proposal: message.proposal ? appChannelProposal(message.proposal) : undefined,
    executionProposal: message.executionProposal
      ? appIssueExecutionProposal(message.executionProposal)
      : undefined,
    skillExecutionProposal: message.skillExecutionProposal
      ? appAgentSkillExecutionProposal(message.skillExecutionProposal)
      : undefined,
    subscribers: message.subscribers.map(appChannelSubscriber),
    createdAt: requiredTimestamp(message.createdAt, "channel message creation"),
    deletedAt: optionalTimestamp(message.deletedAt, "channel message deletion"),
    memoryCitations: (message.memoryCitations ?? []).map((reference) => ({
      documentId: reference.documentId,
      version: reference.version,
    })),
  });

export const appChannelAgentReply = (reply: ChannelAgentReply) =>
  create(ChannelAgentReplySchema, {
    id: reply.id,
    agentId: reply.agentId,
    channelId: reply.channelId,
    triggerMessageId: reply.triggerMessageId,
    parentMessageId: reply.parentMessageId,
    replyMessageId: reply.replyMessageId,
    status: enumValue(replyJobStatus, reply.status, "channel reply status"),
    attempts: reply.attempts,
    error: reply.error ?? undefined,
    createdAt: requiredTimestamp(reply.createdAt, "channel reply creation"),
    updatedAt: requiredTimestamp(reply.updatedAt, "channel reply update"),
  });

export const appCreateChannelMessageResponse = (result: {
  message: ChannelMessage;
  agentReplies: ChannelAgentReply[];
}) =>
  create(CreateChannelMessageResponseSchema, {
    message: appChannelMessage(result.message),
    agentReplies: result.agentReplies.map(appChannelAgentReply),
  });

type ExecutionApprovalResult = Awaited<
  ReturnType<
    typeof import("./channel-proposal-routes").acceptOrganizationChannelExecutionProposal
  >
>;

const appExecutionDispatch = (
  dispatch: ExecutionApprovalResult["dispatch"],
) => create(IssueExecutionDispatchSchema, {
  runId: dispatch.runId,
  agentId: dispatch.agentId ?? undefined,
  provider: enumValue(agentProvider, dispatch.provider, "dispatch provider"),
  model: dispatch.model ?? undefined,
  effort: dispatch.effort ?? undefined,
  requestedWorkerId: dispatch.requestedWorkerId ?? undefined,
  requestedByUserId: dispatch.requestedByUserId,
  dispatchMode: enumValue(
    executionDispatchMode,
    dispatch.dispatchMode,
    "execution dispatch mode",
  ),
  dispatchedAt: requiredTimestamp(dispatch.dispatchedAt, "execution dispatch"),
  outcome: enumValue(
    executionDispatchOutcome,
    dispatch.outcome,
    "execution dispatch outcome",
  ),
});

const approvalOutcome = (outcome: "accepted" | "already_accepted") =>
  enumValue(proposalApprovalOutcome, outcome, "proposal approval outcome");

type ProposalApprovalResult = Awaited<
  ReturnType<
    typeof import("./channel-proposal-routes").acceptOrganizationChannelProposal
  >
>;

export const appAcceptChannelProposal = (result: ProposalApprovalResult) =>
  create(AcceptChannelProposalResponseSchema, {
    outcome: approvalOutcome(result.outcome),
    projectId: result.projectId,
    resultRunId: result.resultRunId,
    resultItems: "resultItems" in result
      ? result.resultItems.map((item) =>
          create(ChannelIssueBatchResultItemSchema, item)
        )
      : [],
    executionProposal: result.executionProposal
      ? appIssueExecutionProposal(result.executionProposal)
      : undefined,
    dispatch: "dispatch" in result && result.dispatch
      ? appExecutionDispatch(result.dispatch)
      : undefined,
  });

export const appAcceptChannelExecutionProposal = (
  result: ExecutionApprovalResult,
) => create(AcceptChannelExecutionProposalResponseSchema, {
  proposal: appIssueExecutionProposal(result.proposal),
  outcome: approvalOutcome(result.outcome),
  projectId: result.projectId,
  runId: result.runId,
  dispatch: appExecutionDispatch(result.dispatch),
});

type SkillApprovalResult = Awaited<
  ReturnType<
    typeof import("./channel-proposal-routes").acceptOrganizationChannelSkillExecutionProposal
  >
>;

type SkillApprovalSession = NonNullable<SkillApprovalResult["session"]>;

const appProjectAgentSession = (session: SkillApprovalSession) => {
  const source: Readonly<Record<string, unknown>> = session;
  let payload: ReturnType<typeof decodeTeamAgentSessionInput>;
  try {
    payload = decodeTeamAgentSessionInput({
      dispatchGroupId: source.dispatchGroupId,
      agentId: source.agentId,
      agentName: source.agentName,
      skillId: source.skillId,
      sessionType: source.sessionType,
      trigger: source.trigger,
      scheduleId: source.scheduleId,
      scheduleRunId: source.scheduleRunId,
      parentSessionId: source.parentSessionId,
      request: source.request,
      followUps: source.followUps,
      status: source.status,
      issues: source.issues,
      startedAt: source.startedAt,
      completedAt: source.completedAt,
      conversationId: source.conversationId,
      summary: source.summary,
      error: source.error,
      requestedWorkerId: source.requestedWorkerId,
      workerId: source.workerId,
      events: source.events,
      updatedAt: source.updatedAt,
    });
  } catch (error) {
    return internal("Invalid Project Agent session", error);
  }
  return create(ProjectAgentSessionSchema, {
    id: session.id,
    projectId: session.projectId,
    dispatchGroupId: payload.dispatchGroupId,
    agentId: payload.agentId ?? undefined,
    agentName: payload.agentName ?? undefined,
    skillId: payload.skillId ?? undefined,
    sessionType: enumValue(sessionType, payload.sessionType, "session type"),
    trigger: payload.trigger
      ? enumValue(sessionTrigger, payload.trigger, "session trigger")
      : undefined,
    scheduleId: payload.scheduleId ?? undefined,
    scheduleRunId: payload.scheduleRunId ?? undefined,
    parentSessionId: payload.parentSessionId ?? undefined,
    request: payload.request ?? undefined,
    followUps: payload.followUps.map((followUp) =>
      create(ProjectAgentSessionFollowUpSchema, {
        id: followUp.id,
        message: followUp.message,
        sentAt: requiredTimestamp(followUp.sentAt, "Agent session follow-up"),
      })
    ),
    status: enumValue(sessionStatus, payload.status, "session status"),
    issues: payload.issues.map((issue) =>
      create(ProjectAgentSessionIssueSchema, {
        runId: issue.runId,
        runNumber: issue.runNumber,
        sourceKey: issue.sourceKey,
        title: issue.title,
        outcome: enumValue(
          sessionIssueOutcome,
          issue.outcome,
          "session issue outcome",
        ),
        summary: issue.summary ?? undefined,
      })
    ),
    startedAt: requiredTimestamp(payload.startedAt, "Agent session start"),
    completedAt: optionalTimestamp(
      payload.completedAt,
      "Agent session completion",
    ),
    conversationId: payload.conversationId ?? undefined,
    requestedWorkerId: payload.requestedWorkerId ?? undefined,
    workerId: payload.workerId ?? undefined,
    requestedByUserId: session.requestedByUserId ?? undefined,
    summary: payload.summary ?? undefined,
    error: payload.error ?? undefined,
    events: payload.events.map((event) =>
      create(ProjectAgentSessionEventSchema, {
        id: event.id,
        type: enumValue(sessionEventType, event.type, "session event type"),
        occurredAt: requiredTimestamp(
          event.occurredAt,
          "Agent session event",
        ),
      })
    ),
    updatedAt: requiredTimestamp(payload.updatedAt, "Agent session update"),
    archived: false,
  });
};

export const appAcceptChannelSkillExecutionProposal = (
  result: SkillApprovalResult,
) => create(AcceptChannelSkillExecutionProposalResponseSchema, {
  outcome: approvalOutcome(result.outcome),
  proposal: appAgentSkillExecutionProposal(result.proposal),
  projectId: result.projectId,
  session: result.session ? appProjectAgentSession(result.session) : undefined,
});
