import { z } from "zod";
import {
  agentProviders,
  modelEffortSchema,
  type AgentProvider,
  type ModelEffort,
} from "./agent-provider-contract";
import {
  agentDescriptionMaxLength,
  agentResponsibilityMaxLength,
  agentSkillInstructionsMaxLength,
  agentSkillsMaxCount,
} from "./agent-limits";

export const channelAgentProviders = agentProviders;
export type ChannelAgentProvider = AgentProvider;

export type ChannelAgentEffort = ModelEffort;

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

export const channelSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9-]+$/u);
export const channelNameSchema = z.string().trim().min(1).max(100);
export const channelTopicSchema = z.string().trim().max(500);
export const channelMessageBodySchema = z.string().trim().min(1).max(10_000);
export const channelWebhookNameSchema = z.string().trim().min(1).max(100);

const channelBlockIdSchema = z.string().min(1).max(255).optional();
const channelBlockTextValueSchema = z
  .string()
  .min(1)
  .max(12_000)
  .refine((value) => value.trim().length > 0, "Text must not be blank");

const channelPlainTextObjectSchema = z
  .object({
    type: z.literal("plain_text"),
    text: channelBlockTextValueSchema,
    emoji: z.boolean().optional(),
  })
  .strict();

const channelMarkdownTextObjectSchema = z
  .object({
    type: z.literal("mrkdwn"),
    text: channelBlockTextValueSchema,
    verbatim: z.boolean().optional(),
  })
  .strict();

export const channelBlockTextObjectSchema = z.discriminatedUnion("type", [
  channelPlainTextObjectSchema,
  channelMarkdownTextObjectSchema,
]);
export type ChannelBlockTextObject = z.infer<
  typeof channelBlockTextObjectSchema
>;

const channelRichTextStyleSchema = z
  .object({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    strike: z.boolean().optional(),
    code: z.boolean().optional(),
  })
  .strict();

const channelRichTextInlineSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      text: channelBlockTextValueSchema,
      style: channelRichTextStyleSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("link"),
      url: z
        .string()
        .max(2_048)
        .refine((value) => {
          try {
            return ["http:", "https:", "mailto:"].includes(new URL(value).protocol);
          } catch {
            return false;
          }
        }, "Link URL must use http, https, or mailto"),
      text: z.string().min(1).max(3_000).optional(),
      style: channelRichTextStyleSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("emoji"),
      name: z.string().trim().min(1).max(100),
    })
    .strict(),
]);

const channelRichTextSectionSchema = z
  .object({
    type: z.literal("rich_text_section"),
    elements: z.array(channelRichTextInlineSchema).min(1).max(100),
  })
  .strict();

const channelRichTextElementSchema = z.discriminatedUnion("type", [
  channelRichTextSectionSchema,
  z
    .object({
      type: z.literal("rich_text_list"),
      style: z.enum(["bullet", "ordered"]),
      indent: z.number().int().min(0).max(8).optional(),
      offset: z.number().int().min(0).max(10_000).optional(),
      elements: z.array(channelRichTextSectionSchema).min(1).max(50),
    })
    .strict(),
  z
    .object({
      type: z.literal("rich_text_quote"),
      elements: z.array(channelRichTextInlineSchema).min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("rich_text_preformatted"),
      elements: z.array(channelRichTextInlineSchema).min(1).max(100),
    })
    .strict(),
]);

export const channelMessageBlockSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("header"),
      text: channelPlainTextObjectSchema.refine(
        ({ text }) => text.length <= 150,
        "Header text must contain at most 150 characters",
      ),
      block_id: channelBlockIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("section"),
      text: channelBlockTextObjectSchema.refine(
        ({ text }) => text.length <= 3_000,
        "Section text must contain at most 3000 characters",
      ),
      block_id: channelBlockIdSchema,
      expand: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("markdown"),
      text: channelBlockTextValueSchema,
      block_id: channelBlockIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("divider"),
      block_id: channelBlockIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("context"),
      elements: z.array(channelBlockTextObjectSchema).min(1).max(10),
      block_id: channelBlockIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("rich_text"),
      elements: z.array(channelRichTextElementSchema).min(1).max(50),
      block_id: channelBlockIdSchema,
    })
    .strict(),
]);
export type ChannelMessageBlock = z.infer<typeof channelMessageBlockSchema>;

const richTextInlineFallback = (
  elements: Array<z.infer<typeof channelRichTextInlineSchema>>,
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

export const channelAgentSkillInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(100),
    instructions: z
      .string()
      .trim()
      .max(agentSkillInstructionsMaxLength)
      .default(""),
    provider: z.enum(channelAgentProviders),
    model: z.string().trim().min(1).max(100).nullable().default(null),
    effort: modelEffortSchema.nullable().default(null),
    kind: z.enum(channelAgentSkillKinds).default("custom"),
    // Accepted only so clients from before Skill selection was explicit can
    // roll forward without a hard API failure. It has no runtime meaning.
    isDefault: z.boolean().optional(),
    position: z.number().int().min(0).max(999).default(0),
  })
  .strict()
  .transform(({ isDefault: _legacyDefault, ...skill }) => skill);

export type ChannelAgentSkillInput = z.output<
  typeof channelAgentSkillInputSchema
>;

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

export const channelInputSchema = z
  .object({
    name: channelNameSchema,
    slug: channelSlugSchema.optional(),
    topic: channelTopicSchema.nullable().default(null),
    visibility: z.enum(channelVisibilities).default("public"),
    defaultProjectId: z.string().uuid().nullable().default(null),
  })
  .strict();

export const channelUpdateInputSchema = z
  .object({
    name: channelNameSchema.optional(),
    topic: channelTopicSchema.nullable().optional(),
    visibility: z.enum(channelVisibilities).optional(),
    defaultProjectId: z.string().uuid().nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict();

const canonicalUuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());

export const channelMessageInputSchema = z
  .object({
    body: channelMessageBodySchema,
    clientMessageId: canonicalUuidSchema.optional(),
    parentMessageId: canonicalUuidSchema.nullable().default(null),
    mentionedUserIds: z.array(z.string().min(1).max(64)).max(20).default([]),
    mentionedAgentIds: z.array(canonicalUuidSchema).max(8).default([]),
    preferredDeviceId: canonicalUuidSchema.nullable().default(null),
  })
  .strict();

export const channelWebhookInputSchema = z
  .object({ name: channelWebhookNameSchema })
  .strict();

export const channelIncomingWebhookMessageSchema = z
  .object({
    text: channelMessageBodySchema.optional(),
    blocks: z.array(channelMessageBlockSchema).min(1).max(50).optional(),
    eventId: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.text && !input.blocks) {
      context.addIssue({
        code: "custom",
        message: "Either text or blocks is required",
        path: ["text"],
      });
      return;
    }
    if (!input.text && input.blocks && !channelMessageBlocksFallback(input.blocks)) {
      context.addIssue({
        code: "custom",
        message: "Blocks must contain visible text when text is omitted",
        path: ["blocks"],
      });
    }
    if (input.blocks) {
      const markdownLength = input.blocks.reduce(
        (total, block) => total + (block.type === "markdown" ? block.text.length : 0),
        0,
      );
      if (markdownLength > 12_000) {
        context.addIssue({
          code: "custom",
          message: "Markdown blocks may contain at most 12000 characters in total",
          path: ["blocks"],
        });
      }
    }
  });

export const organizationAgentInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(agentDescriptionMaxLength).optional(),
    provider: z.enum(channelAgentProviders),
    model: z.string().trim().min(1).max(100).nullable().default(null),
    responsibility: z
      .string()
      .trim()
      .min(1)
      .max(agentResponsibilityMaxLength),
    effort: modelEffortSchema.nullable().default(null),
    skills: z
      .array(channelAgentSkillInputSchema)
      .max(agentSkillsMaxCount)
      .optional(),
  })
  .strict();

export const channelMemberInputSchema = z
  .object({ role: z.enum(["owner", "member"]).default("member") })
  .strict();

export const channelProposalAcceptInputSchema = z
  .object({ projectId: canonicalUuidSchema.nullable().default(null) })
  .strict();

export const channelExecutionProposalAcceptInputSchema = z
  .object({
    provider: z.enum(channelAgentProviders),
    model: z.string().trim().min(1).max(100).nullable(),
    effort: modelEffortSchema.nullable(),
    workerId: z.string().trim().min(1).max(128).nullable(),
  })
  .strict();

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
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string | null;
  lastReadAt?: string | null;
  hasUnread?: boolean;
};

export const channelReadInputSchema = z
  .object({
    lastReadAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

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

export const channelMessageReactionInputSchema = z
  .object({
    emoji: z.string().trim().min(1).max(32),
  })
  .strict();

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
export const channelReplyCompletionSchema = z
  .object({
    body: channelMessageBodySchema,
    document: z
      .object({
        title: z.string().trim().min(1).max(300),
        markdown: z.string().min(1).max(200_000),
        projectId: z.string().uuid().nullable().default(null),
      })
      .strict()
      .nullable()
      .default(null),
    issueProposal: z
      .object({
        projectId: z.string().uuid().nullable().default(null),
        executeAfterCreate: z.boolean().default(false),
        issue: z
          .object({
            title: z.string().trim().min(1).max(300),
            description: z.string().trim().max(100_000).nullable(),
            priority: z.number().int().min(1).max(4).nullable(),
            status: z.literal("backlog"),
          })
          .strict(),
      })
      .strict()
      .nullable()
      .default(null),
    executionProposal: z
      .object({
        projectId: z.string().uuid(),
        runId: z.string().uuid(),
      })
      .strict()
      .nullable()
      .default(null),
    skillExecutionProposal: z
      .object({
        type: z.literal("request_agent_skill_execute"),
      })
      .strict()
      .nullable()
      .default(null),
    /**
     * Organization Agents can hand one repository-specific question to an
     * eligible Project Agent. The server remains authoritative for the target
     * organization, project, channel roster, and recursion boundary.
     */
    delegation: z
      .object({
        projectId: z.string().uuid(),
        agentId: z.string().uuid(),
        request: channelMessageBodySchema,
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((reply, context) => {
    if (
      reply.delegation &&
      (reply.document || reply.issueProposal || reply.executionProposal ||
        reply.skillExecutionProposal)
    ) {
      context.addIssue({
        code: "custom",
        message: "A delegated reply cannot also attach an artifact proposal",
        path: ["delegation"],
      });
    }
    if (reply.issueProposal && reply.executionProposal) {
      context.addIssue({
        code: "custom",
        message: "Use executeAfterCreate for a create-and-execute request",
        path: ["executionProposal"],
      });
    }
    if (
      reply.skillExecutionProposal &&
      (reply.document || reply.issueProposal || reply.executionProposal)
    ) {
      context.addIssue({
        code: "custom",
        message: "A Skill execution cannot be combined with another artifact proposal",
        path: ["skillExecutionProposal"],
      });
    }
  });

export const channelReplyClaimInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    workerId: z.string().trim().min(1).max(64),
  })
  .strict();

export const channelReplyLeaseInputSchema = channelReplyClaimInputSchema.extend(
  { claimToken: z.string().trim().min(1).max(200) },
);

export const channelReplyCompleteInputSchema = channelReplyLeaseInputSchema
  .extend({
    error: z.string().trim().min(1).max(4000).nullable().default(null),
    result: channelReplyCompletionSchema.nullable().default(null),
  })
  .refine((input) => Boolean(input.error) !== Boolean(input.result), {
    message: "Provide either an error or a reply result",
  });

export const channelIssueProposalPayloadSchema = z.object({
  issue: z
    .object({
      title: z.string().trim().min(1).max(300),
      description: z.string().trim().max(100_000).nullable(),
      priority: z.number().int().min(1).max(4).nullable(),
      // Read compatibility for proposals persisted by pre-approval-boundary
      // Workers. Acceptance always normalizes either value to backlog.
      status: z.enum(["backlog", "queued"]),
    })
    .strict(),
  executeAfterCreate: z.boolean().default(false),
});

export const channelExecutionProposalPayloadSchema = z
  .object({
    runId: z.string().uuid(),
    title: z.string().trim().min(1).max(300),
    delegation: z
      .object({
        delegatedByAgentId: z.string().uuid(),
        delegatedByAgentName: z.string().trim().min(1).max(100),
      })
      .strict()
      .nullable(),
  })
  .strict();
