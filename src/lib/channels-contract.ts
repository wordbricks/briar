import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaTransformation from "effect/SchemaTransformation";
import {
  ModelEffort,
  type ModelEffort as ModelEffortType,
} from "./agent-provider-contract";
import { agentProviders, type AgentProvider } from "./agent-provider";
import { IsoDateTimeWithOffset } from "./date-time-schema";
import {
  agentDescriptionMaxLength,
  agentResponsibilityMaxLength,
  agentSkillInstructionsMaxLength,
  agentSkillsMaxCount,
} from "./agent-limits";

export const channelAgentProviders = agentProviders;
export type ChannelAgentProvider = AgentProvider;

export type ChannelAgentEffort = ModelEffortType;

export const channelAgentSkillKinds = [
  "issue_processing",
  "custom",
] as const;
export type ChannelAgentSkillKind = (typeof channelAgentSkillKinds)[number];

export const channelVisibilities = ["public", "private"] as const;
export type ChannelVisibility = (typeof channelVisibilities)[number];

export const channelActionTypes = [
  "request_issue_create",
  "request_plan_document",
] as const;
export type ChannelActionType = (typeof channelActionTypes)[number];

export const channelReplyStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
] as const;
export type ChannelReplyStatus = (typeof channelReplyStatuses)[number];

export const channelReplyClaimTokenHeader =
  "X-Briar-Channel-Claim-Token";

/** Stable server error used when an Agent mention has no runnable Worker. */
export const channelReplyNoAvailableWorkerError =
  "No available Worker can run this Agent.";

const strictSchemaOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;
const strict = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: strictSchemaOptions });
const mutableArray = <S extends Schema.Top>(item: S) =>
  Schema.mutable(Schema.Array(item));
const defaulted = <S extends Schema.Constraint>(
  schema: S,
  value: S["Type"],
): Schema.withDecodingDefaultType<S> =>
  Schema.withDecodingDefaultType<S>(Effect.succeed(value))(schema);
const defaultedWith = <S extends Schema.Constraint>(
  schema: S,
  value: () => S["Type"],
): Schema.withDecodingDefaultType<S> =>
  Schema.withDecodingDefaultType<S>(Effect.sync(value))(schema);
const nullableDefault = <S extends Schema.Constraint>(schema: S) =>
  defaulted(Schema.NullOr(schema), null);
const between = (minimum: number, maximum: number) =>
  Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(minimum),
    Schema.isLessThanOrEqualTo(maximum),
  );

const Lowercased = Schema.Trim.pipe(
  Schema.decode({
    decode: SchemaGetter.transform((value) => value.toLowerCase()),
    encode: SchemaGetter.transform((value) => value.toLowerCase()),
  }),
);

export const channelSlugSchema = Lowercased.check(
  Schema.isLengthBetween(1, 63),
  Schema.isPattern(/^[a-z0-9-]+$/u),
);
export const channelNameSchema = Schema.Trim.check(
  Schema.isLengthBetween(1, 100),
);
export const channelTopicSchema = Schema.Trim.check(Schema.isMaxLength(500));
export const channelMessageBodySchema = Schema.Trim.check(
  Schema.isLengthBetween(1, 10_000),
);
export const channelWebhookNameSchema = Schema.Trim.check(
  Schema.isLengthBetween(1, 100),
);

const channelBlockIdSchema = Schema.optional(
  Schema.String.check(Schema.isLengthBetween(1, 255)),
);
const channelBlockTextValueSchema = Schema.String.check(
  Schema.isLengthBetween(1, 12_000),
  Schema.makeFilter((value) =>
    value.trim().length > 0 || "Text must not be blank"
  ),
);

const channelPlainTextObjectSchema = strict(Schema.Struct({
  type: Schema.Literal("plain_text"),
  text: channelBlockTextValueSchema,
  emoji: Schema.optional(Schema.Boolean),
}));

const channelMarkdownTextObjectSchema = strict(Schema.Struct({
  type: Schema.Literal("mrkdwn"),
  text: channelBlockTextValueSchema,
  verbatim: Schema.optional(Schema.Boolean),
}));

export const channelBlockTextObjectSchema = Schema.Union([
  channelPlainTextObjectSchema,
  channelMarkdownTextObjectSchema,
]);
export type ChannelBlockTextObject =
  typeof channelBlockTextObjectSchema.Type;

const channelRichTextStyleSchema = strict(Schema.Struct({
  bold: Schema.optional(Schema.Boolean),
  italic: Schema.optional(Schema.Boolean),
  strike: Schema.optional(Schema.Boolean),
  code: Schema.optional(Schema.Boolean),
}));

const channelRichTextInlineSchema = Schema.Union([
  strict(Schema.Struct({
    type: Schema.Literal("text"),
    text: channelBlockTextValueSchema,
    style: Schema.optional(channelRichTextStyleSchema),
  })),
  strict(Schema.Struct({
    type: Schema.Literal("link"),
    url: Schema.String.check(
      Schema.isMaxLength(2_048),
      Schema.makeFilter((value) => {
        try {
          return ["http:", "https:", "mailto:"].includes(
            new URL(value).protocol,
          ) || "Link URL must use http, https, or mailto";
        } catch {
          return "Link URL must use http, https, or mailto";
        }
      }),
    ),
    text: Schema.optional(
      Schema.String.check(Schema.isLengthBetween(1, 3_000)),
    ),
    style: Schema.optional(channelRichTextStyleSchema),
  })),
  strict(Schema.Struct({
    type: Schema.Literal("emoji"),
    name: Schema.Trim.check(Schema.isLengthBetween(1, 100)),
  })),
]);

const channelRichTextSectionSchema = strict(Schema.Struct({
  type: Schema.Literal("rich_text_section"),
  elements: mutableArray(channelRichTextInlineSchema).check(
    Schema.isLengthBetween(1, 100),
  ),
}));

const channelRichTextElementSchema = Schema.Union([
  channelRichTextSectionSchema,
  strict(Schema.Struct({
    type: Schema.Literal("rich_text_list"),
    style: Schema.Literals(["bullet", "ordered"]),
    indent: Schema.optional(between(0, 8)),
    offset: Schema.optional(between(0, 10_000)),
    elements: mutableArray(channelRichTextSectionSchema).check(
      Schema.isLengthBetween(1, 50),
    ),
  })),
  strict(Schema.Struct({
    type: Schema.Literal("rich_text_quote"),
    elements: mutableArray(channelRichTextInlineSchema).check(
      Schema.isLengthBetween(1, 100),
    ),
  })),
  strict(Schema.Struct({
    type: Schema.Literal("rich_text_preformatted"),
    elements: mutableArray(channelRichTextInlineSchema).check(
      Schema.isLengthBetween(1, 100),
    ),
  })),
]);

export const channelMessageBlockSchema = Schema.Union([
  strict(Schema.Struct({
    type: Schema.Literal("header"),
    text: strict(channelPlainTextObjectSchema.check(
      Schema.makeFilter(({ text }) =>
        text.length <= 150 ||
        "Header text must contain at most 150 characters"
      ),
    )),
    block_id: channelBlockIdSchema,
  })),
  strict(Schema.Struct({
    type: Schema.Literal("section"),
    text: strict(channelBlockTextObjectSchema.check(
      Schema.makeFilter(({ text }) =>
        text.length <= 3_000 ||
        "Section text must contain at most 3000 characters"
      ),
    )),
    block_id: channelBlockIdSchema,
    expand: Schema.optional(Schema.Boolean),
  })),
  strict(Schema.Struct({
    type: Schema.Literal("markdown"),
    text: channelBlockTextValueSchema,
    block_id: channelBlockIdSchema,
  })),
  strict(Schema.Struct({
    type: Schema.Literal("divider"),
    block_id: channelBlockIdSchema,
  })),
  strict(Schema.Struct({
    type: Schema.Literal("context"),
    elements: mutableArray(channelBlockTextObjectSchema).check(
      Schema.isLengthBetween(1, 10),
    ),
    block_id: channelBlockIdSchema,
  })),
  strict(Schema.Struct({
    type: Schema.Literal("rich_text"),
    elements: mutableArray(channelRichTextElementSchema).check(
      Schema.isLengthBetween(1, 50),
    ),
    block_id: channelBlockIdSchema,
  })),
]);
export type ChannelMessageBlock = typeof channelMessageBlockSchema.Type;

const richTextInlineFallback = (
  elements: Array<typeof channelRichTextInlineSchema.Type>,
) => elements.map((element) => {
  if (element.type === "text") return element.text;
  if (element.type === "link") return element.text ?? element.url;
  return `:${element.name}:`;
}).join("");

/** Builds the durable plain-text body used by search, alerts, and old clients. */
export function channelMessageBlocksFallback(blocks: ChannelMessageBlock[]) {
  return blocks.map((block) => {
    switch (block.type) {
      case "header":
      case "section":
        return block.text.text;
      case "markdown":
        return block.text;
      case "divider":
        return "";
      case "context":
        return block.elements.map((element) => element.text).join(" ");
      case "rich_text":
        return block.elements.map((element) => {
          if (element.type === "rich_text_section") {
            return richTextInlineFallback(element.elements);
          }
          if (element.type === "rich_text_list") {
            return element.elements.map((section, index) => {
              const marker = element.style === "ordered"
                ? `${(element.offset ?? 0) + index + 1}.`
                : "•";
              return `${marker} ${richTextInlineFallback(section.elements)}`;
            }).join("\n");
          }
          return richTextInlineFallback(element.elements);
        }).join("\n");
    }
  }).filter(Boolean).join("\n").trim().slice(0, 10_000);
}

const Uuid = Schema.String.check(Schema.isUUID());
const AgentProviderSchema = Schema.Literals(channelAgentProviders);
const ChannelAgentSkillKindSchema = Schema.Literals(channelAgentSkillKinds);

const channelAgentSkillInputSourceSchema = strict(Schema.Struct({
  id: Schema.optional(Uuid),
  name: Schema.Trim.check(Schema.isLengthBetween(1, 100)),
  instructions: defaulted(
    Schema.Trim.check(Schema.isMaxLength(agentSkillInstructionsMaxLength)),
    "",
  ),
  provider: AgentProviderSchema,
  model: nullableDefault(
    Schema.Trim.check(Schema.isLengthBetween(1, 100)),
  ),
  effort: nullableDefault(ModelEffort),
  kind: defaulted(ChannelAgentSkillKindSchema, "custom"),
  // Accepted only so clients from before Skill selection was explicit can
  // roll forward without a hard API failure. It has no runtime meaning.
  isDefault: Schema.optional(Schema.Boolean),
  position: defaulted(between(0, 999), 0),
}));

const channelAgentSkillInputTypeSchema = strict(Schema.Struct({
  id: Schema.optional(Uuid),
  name: Schema.String,
  instructions: Schema.String,
  provider: AgentProviderSchema,
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  kind: ChannelAgentSkillKindSchema,
  position: Schema.Int,
}));

export const channelAgentSkillInputSchema =
  channelAgentSkillInputSourceSchema.pipe(
    Schema.decodeTo(
      channelAgentSkillInputTypeSchema,
      SchemaTransformation.transform({
        decode: ({ isDefault: _legacyDefault, ...skill }) => skill,
        encode: (skill) => skill,
      }),
    ),
  );

export type ChannelAgentSkillInput =
  typeof channelAgentSkillInputSchema.Type;

/** Converts a channel name into the restricted alphabet used by URL slugs. */
function handleFromName(name: string) {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 63)
    .replace(/-+$/gu, "");
}

export function channelSlugFromName(name: string, channelId: string) {
  return (
    handleFromName(name) ||
    `channel-${channelId.replace(/[^a-z0-9]/giu, "").toLowerCase().slice(0, 12)}`
  );
}

export const channelInputSchema = strict(Schema.Struct({
  name: channelNameSchema,
  slug: Schema.optional(channelSlugSchema),
  topic: nullableDefault(channelTopicSchema),
  visibility: defaulted(Schema.Literals(channelVisibilities), "public"),
  defaultProjectId: nullableDefault(Uuid),
}));

export const channelUpdateInputSchema = strict(Schema.Struct({
  name: Schema.optional(channelNameSchema),
  topic: Schema.optional(Schema.NullOr(channelTopicSchema)),
  visibility: Schema.optional(Schema.Literals(channelVisibilities)),
  defaultProjectId: Schema.optional(Schema.NullOr(Uuid)),
  archived: Schema.optional(Schema.Boolean),
}));

const canonicalUuidSchema = Uuid.pipe(
  Schema.decode({
    decode: SchemaGetter.transform((value) => value.toLowerCase()),
    encode: SchemaGetter.transform((value) => value.toLowerCase()),
  }),
);

export const channelMessageInputSchema = strict(Schema.Struct({
  body: channelMessageBodySchema,
  clientMessageId: Schema.optional(canonicalUuidSchema),
  parentMessageId: nullableDefault(canonicalUuidSchema),
  mentionedUserIds: defaultedWith(
    mutableArray(
      Schema.String.check(Schema.isLengthBetween(1, 64)),
    ).check(Schema.isMaxLength(20)),
    () => [],
  ),
  mentionedAgentIds: defaultedWith(
    mutableArray(canonicalUuidSchema).check(Schema.isMaxLength(8)),
    () => [],
  ),
  preferredDeviceId: nullableDefault(canonicalUuidSchema),
}));

export const channelWebhookInputSchema = strict(Schema.Struct({
  name: channelWebhookNameSchema,
}));

export const channelIncomingWebhookMessageSchema = strict(Schema.Struct({
  text: Schema.optional(channelMessageBodySchema),
  blocks: Schema.optional(
    mutableArray(channelMessageBlockSchema).check(
      Schema.isLengthBetween(1, 50),
    ),
  ),
  eventId: Schema.optional(
    Schema.Trim.check(Schema.isLengthBetween(1, 200)),
  ),
}).check(
  Schema.makeFilter((input) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (!input.text && !input.blocks) {
      issues.push({
        path: ["text"],
        issue: "Either text or blocks is required",
      });
      return issues;
    }
    if (!input.text && input.blocks && !channelMessageBlocksFallback(input.blocks)) {
      issues.push({
        path: ["blocks"],
        issue: "Blocks must contain visible text when text is omitted",
      });
    }
    if (input.blocks) {
      const markdownLength = input.blocks.reduce(
        (total, block) => total + (block.type === "markdown" ? block.text.length : 0),
        0,
      );
      if (markdownLength > 12_000) {
        issues.push({
          path: ["blocks"],
          issue: "Markdown blocks may contain at most 12000 characters in total",
        });
      }
    }
    return issues;
  }),
));

export const organizationAgentInputSchema = strict(Schema.Struct({
  name: Schema.Trim.check(Schema.isLengthBetween(1, 100)),
  description: Schema.optional(
    Schema.Trim.check(Schema.isMaxLength(agentDescriptionMaxLength)),
  ),
  provider: AgentProviderSchema,
  model: nullableDefault(
    Schema.Trim.check(Schema.isLengthBetween(1, 100)),
  ),
  responsibility: Schema.Trim.check(
    Schema.isLengthBetween(1, agentResponsibilityMaxLength),
  ),
  effort: nullableDefault(ModelEffort),
  skills: Schema.optional(
    mutableArray(channelAgentSkillInputSchema).check(
      Schema.isMaxLength(agentSkillsMaxCount),
    ),
  ),
}));

export const channelMemberInputSchema = strict(Schema.Struct({
  role: defaulted(Schema.Literals(["owner", "member"]), "member"),
}));

export const channelProposalAcceptInputSchema = strict(Schema.Struct({
  projectId: nullableDefault(canonicalUuidSchema),
}));

export const channelExecutionProposalAcceptInputSchema = strict(Schema.Struct({
  provider: AgentProviderSchema,
  model: Schema.NullOr(
    Schema.Trim.check(Schema.isLengthBetween(1, 100)),
  ),
  effort: Schema.NullOr(ModelEffort),
  workerId: Schema.NullOr(
    Schema.Trim.check(Schema.isLengthBetween(1, 128)),
  ),
}));

export type ChannelSummary = {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  topic: string | null;
  visibility: ChannelVisibility;
  defaultProjectId: string | null;
  archivedAt: string | null;
  memberCount: number;
  agentCount: number;
  createdByUserId?: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string | null;
  lastReadAt?: string | null;
  hasUnread?: boolean;
};

export const channelReadInputSchema = strict(Schema.Struct({
  lastReadAt: Schema.optional(IsoDateTimeWithOffset),
}));

export type ChannelMember = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: "owner" | "member";
  createdAt: string;
};

export type ChannelWebhook = {
  id: string;
  channelId: string;
  name: string;
  active: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChannelAgentSkill = {
  id: string;
  agentId: string;
  name: string;
  instructions: string;
  provider: ChannelAgentProvider;
  model: string | null;
  effort: ChannelAgentEffort | null;
  kind: ChannelAgentSkillKind;
  position: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * A roster entry is an Agent that can be mentioned in this channel.
 * `projectId` is null for organization Agents, which have no repository.
 */
export type ChannelAgentSummary = {
  agentId: string;
  name: string;
  description?: string;
  avatar: string | null;
  provider: ChannelAgentProvider;
  model: string | null;
  effort: ChannelAgentEffort | null;
  projectId: string | null;
  projectName: string | null;
  responsibility: string;
  skills: ChannelAgentSkill[];
  createdAt: string;
};

export type ChannelMessageAuthor =
  | {
      type: "user";
      id: string;
      name: string;
      email: string;
      image: string | null;
    }
  | {
      type: "agent";
      id: string | null;
      name: string;
      provider: ChannelAgentProvider | null;
      /** The Agent's configured avatar image, resolved from the live roster. */
      image: string | null;
    }
  | {
      type: "webhook";
      id: string | null;
      name: string;
    };

/** A plan document written by an Agent, stored on the channel message itself. */
export type ChannelMessageDocument = {
  messageId: string;
  title: string;
  projectId: string | null;
};

/** Full document body, loaded only when a member opens the document card. */
export type ChannelMessageDocumentContent = ChannelMessageDocument & {
  markdown: string;
};

export type ChannelMessageProposal = {
  id: string;
  actionType: ChannelActionType;
  status: "pending" | "accepted";
  projectId: string | null;
  payload: unknown;
  resultRunId: string | null;
};

export type ChannelExecutionProposal = {
  id: string;
  type: "request_issue_execute";
  status: "pending" | "accepted";
  projectId: string;
  runId: string;
  title: string;
  createdAt: string;
  acceptedAt: string | null;
  requestedProvider: ChannelAgentProvider | null;
  requestedModel: string | null;
  requestedEffort: ChannelAgentEffort | null;
  requestedWorkerId: string | null;
  delegatedByAgentId: string | null;
  delegatedByAgentName: string | null;
};

/**
 * Immutable wire snapshot for a natural-language request matched to a saved
 * Project Agent Skill. Keeping this in the shared channel contract avoids
 * pulling browser-only application types into the Worker build.
 */
export type AgentSkillExecutionProposal = {
  id: string;
  type: "request_agent_skill_execute";
  status: "pending" | "accepted";
  projectId: string;
  agentId: string;
  agentName: string;
  skillId: string;
  skillName: string;
  provider: AgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  request: string;
  delegatedByAgentId: string | null;
  delegatedByAgentName: string | null;
  requestedWorkerId: string | null;
  requestedWorkerLabel: string | null;
  resultSessionId: string | null;
  createdAt: string;
  acceptedAt: string | null;
};

export type ChannelSkillExecutionProposal = AgentSkillExecutionProposal;

export type ChannelMessageAttachment = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  url: string;
};

/** Aggregated emoji reaction on a channel message. */
export type ChannelMessageReaction = {
  emoji: string;
  count: number;
  userIds: string[];
};

export type ChannelThreadSubscriber = {
  userId: string;
  subscribedAt: string;
};

export type ChannelMessage = {
  id: string;
  channelId: string;
  parentMessageId: string | null;
  author: ChannelMessageAuthor;
  body: string;
  /** Slack-compatible presentation blocks; absent on older API responses. */
  blocks?: ChannelMessageBlock[] | null;
  mentionedUserIds: string[];
  mentionedAgentIds: string[];
  attachments: ChannelMessageAttachment[];
  reactions: ChannelMessageReaction[];
  replyCount: number;
  lastReplyAt: string | null;
  /** Up to three unique reply authors, ordered by their most recent reply. */
  replyAuthors?: ChannelMessageAuthor[];
  /** Present on thread roots. Older API responses omit the field. */
  subscribers?: ChannelThreadSubscriber[];
  document: ChannelMessageDocument | null;
  proposal: ChannelMessageProposal | null;
  executionProposal: ChannelExecutionProposal | null;
  skillExecutionProposal?: ChannelSkillExecutionProposal | null;
  /** Client-only state while a newly sent message awaits its server response. */
  optimistic?: boolean;
  createdAt: string;
};

export function applyChannelThreadSubscribers(
  messages: ChannelMessage[],
  rootMessageId: string,
  subscribers: ChannelThreadSubscriber[],
) {
  return messages.map((message) =>
    message.id === rootMessageId ? { ...message, subscribers } : message,
  );
}

export type ChannelReplyContextAuthor =
  | Pick<
    Extract<ChannelMessageAuthor, { type: "user" }>,
    "type" | "id" | "name"
  >
  | Pick<
    Extract<ChannelMessageAuthor, { type: "agent" }>,
    "type" | "id" | "name"
  >
  | Pick<
    Extract<ChannelMessageAuthor, { type: "webhook" }>,
    "type" | "id" | "name"
  >;

export type ChannelReplyContextMessage = {
  id: string;
  parentMessageId: string | null;
  author: ChannelReplyContextAuthor;
  body: string;
  mentionedUserIds: string[];
  mentionedAgentIds: string[];
  attachments: Array<
    Pick<ChannelMessageAttachment, "id" | "filename" | "contentType" | "byteSize">
  >;
  document: ChannelMessageDocument | null;
  proposal: ChannelMessageProposal | null;
  executionProposal: ChannelExecutionProposal | null;
  skillExecutionProposal: ChannelSkillExecutionProposal | null;
  createdAt: string;
};

/**
 * Project a display-oriented channel message onto the semantic fields an Agent
 * can use when answering. In particular, never copy profile images, email
 * addresses, reactions, presentation blocks, or reply-summary decorations into
 * a model context snapshot.
 */
export function channelReplyContextMessageJson(
  message: ChannelMessage,
): ChannelReplyContextMessage {
  let author: ChannelReplyContextAuthor;
  switch (message.author.type) {
    case "user":
      author = { type: "user", id: message.author.id, name: message.author.name };
      break;
    case "agent":
      author = { type: "agent", id: message.author.id, name: message.author.name };
      break;
    case "webhook":
      author = {
        type: "webhook",
        id: message.author.id,
        name: message.author.name,
      };
      break;
  }
  return {
    id: message.id,
    parentMessageId: message.parentMessageId,
    author,
    body: message.body,
    mentionedUserIds: message.mentionedUserIds,
    mentionedAgentIds: message.mentionedAgentIds,
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      byteSize: attachment.byteSize,
    })),
    document: message.document,
    proposal: message.proposal,
    executionProposal: message.executionProposal,
    skillExecutionProposal: message.skillExecutionProposal ?? null,
    createdAt: message.createdAt,
  };
}

/** Quick-react chips shown on hover; order matches Slack-like defaults. */
export const channelQuickReactionEmojis = [
  "👍",
  "❤️",
  "😂",
  "🎉",
] as const;

export const channelMessageReactionInputSchema = strict(Schema.Struct({
  emoji: Schema.Trim.check(Schema.isLengthBetween(1, 32)),
}));

export type ChannelAgentReply = {
  id: string;
  agentId: string;
  channelId: string;
  triggerMessageId: string;
  parentMessageId: string;
  replyMessageId: string;
  status: ChannelReplyStatus;
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChannelDelta = {
  cursor: number;
  hasMore: boolean;
  channels: ChannelSummary[];
  removedChannelIds: string[];
  messages: ChannelMessage[];
  removedMessageIds: string[];
  agentReplies: ChannelAgentReply[];
};

/**
 * A plan document is attached directly: writing markdown changes no project
 * state. Creating an issue does, so it lands as a proposal that a member has to
 * accept, matching the issue conversation rules in migration 0068.
 */
const channelReplyDocumentSchema = strict(Schema.Struct({
  title: Schema.Trim.check(Schema.isLengthBetween(1, 300)),
  markdown: Schema.String.check(Schema.isLengthBetween(1, 200_000)),
  projectId: nullableDefault(Uuid),
}));

const channelReplyIssueProposalSchema = strict(Schema.Struct({
  projectId: nullableDefault(Uuid),
  executeAfterCreate: defaulted(Schema.Boolean, false),
  issue: strict(Schema.Struct({
    title: Schema.Trim.check(Schema.isLengthBetween(1, 300)),
    description: Schema.NullOr(
      Schema.Trim.check(Schema.isMaxLength(100_000)),
    ),
    priority: Schema.NullOr(between(1, 4)),
    status: Schema.Literal("backlog"),
  })),
}));

const channelReplyExecutionProposalSchema = strict(Schema.Struct({
  projectId: Uuid,
  runId: Uuid,
}));

const channelReplySkillExecutionProposalSchema = strict(Schema.Struct({
  type: Schema.Literal("request_agent_skill_execute"),
}));

const channelReplyDelegationSchema = strict(Schema.Struct({
  projectId: Uuid,
  agentId: Uuid,
  request: channelMessageBodySchema,
}));

export const channelReplyCompletionSchema = strict(Schema.Struct({
  body: channelMessageBodySchema,
  document: nullableDefault(channelReplyDocumentSchema),
  issueProposal: nullableDefault(channelReplyIssueProposalSchema),
  executionProposal: nullableDefault(channelReplyExecutionProposalSchema),
  skillExecutionProposal: nullableDefault(
    channelReplySkillExecutionProposalSchema,
  ),
    /**
     * Organization Agents can hand one repository-specific question to an
     * eligible Project Agent. The server remains authoritative for the target
     * organization, project, channel roster, and recursion boundary.
     */
  delegation: nullableDefault(channelReplyDelegationSchema),
}).check(
  Schema.makeFilter((reply) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (
      reply.delegation &&
      (reply.document || reply.issueProposal || reply.executionProposal ||
        reply.skillExecutionProposal)
    ) {
      issues.push({
        path: ["delegation"],
        issue: "A delegated reply cannot also attach an artifact proposal",
      });
    }
    if (reply.issueProposal && reply.executionProposal) {
      issues.push({
        path: ["executionProposal"],
        issue: "Use executeAfterCreate for a create-and-execute request",
      });
    }
    if (
      reply.skillExecutionProposal &&
      (reply.document || reply.issueProposal || reply.executionProposal)
    ) {
      issues.push({
        path: ["skillExecutionProposal"],
        issue: "A Skill execution cannot be combined with another artifact proposal",
      });
    }
    return issues;
  }),
));

export const channelReplyClaimInputSchema = strict(Schema.Struct({
  organizationId: Uuid,
  workerId: Schema.Trim.check(Schema.isLengthBetween(1, 64)),
}));

export const channelReplyLeaseInputSchema = strict(Schema.Struct({
  ...channelReplyClaimInputSchema.fields,
  claimToken: Schema.Trim.check(Schema.isLengthBetween(1, 200)),
}));

export const channelReplyCompleteInputSchema = strict(Schema.Struct({
  ...channelReplyLeaseInputSchema.fields,
  error: nullableDefault(
    Schema.Trim.check(Schema.isLengthBetween(1, 4_000)),
  ),
  result: nullableDefault(channelReplyCompletionSchema),
}).check(
  Schema.makeFilter((input) =>
    Boolean(input.error) !== Boolean(input.result) ||
    "Provide either an error or a reply result"
  ),
));

export const channelIssueProposalPayloadSchema = Schema.Struct({
  issue: strict(Schema.Struct({
    title: Schema.Trim.check(Schema.isLengthBetween(1, 300)),
    description: Schema.NullOr(
      Schema.Trim.check(Schema.isMaxLength(100_000)),
    ),
    priority: Schema.NullOr(between(1, 4)),
      // Read compatibility for proposals persisted by pre-approval-boundary
      // Workers. Acceptance always normalizes either value to backlog.
    status: Schema.Literals(["backlog", "queued"]),
  })),
  executeAfterCreate: defaulted(Schema.Boolean, false),
});
export const decodeChannelIssueProposalPayloadOption =
  Schema.decodeUnknownOption(channelIssueProposalPayloadSchema);
