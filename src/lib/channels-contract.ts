import { z } from "zod";
import {
  agentProviders,
  modelEfforts,
  type AgentProvider,
  type ModelEffort,
} from "./agent-provider-contract";

export const channelAgentProviders = agentProviders;
export type ChannelAgentProvider = AgentProvider;

export const channelAgentEfforts = modelEfforts;
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
export const agentHandleSchema = channelSlugSchema;

export const channelAgentSkillInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(100),
    instructions: z.string().trim().max(10_000).default(""),
    provider: z.enum(channelAgentProviders),
    model: z.string().trim().min(1).max(100).nullable().default(null),
    effort: z.enum(channelAgentEfforts).nullable().default(null),
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

/**
 * Handles never carry meaning beyond identity, so anything outside the handle
 * alphabet collapses to a separator. Names written in a non-Latin script leave
 * nothing behind, which is why callers must fall back to a generated handle
 * rather than trusting this to always produce one.
 */
export function handleFromName(name: string) {
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

export const channelMessageInputSchema = z
  .object({
    body: channelMessageBodySchema,
    parentMessageId: z.string().uuid().nullable().default(null),
    mentionedUserIds: z.array(z.string().min(1).max(64)).max(20).default([]),
    mentionedAgentIds: z.array(z.string().uuid()).max(8).default([]),
  })
  .strict();

export const organizationAgentInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    handle: agentHandleSchema.optional(),
    provider: z.enum(channelAgentProviders),
    model: z.string().trim().min(1).max(100).nullable().default(null),
    responsibility: z.string().trim().min(1).max(2000),
    effort: z.enum(channelAgentEfforts).nullable().default(null),
    skills: z.array(channelAgentSkillInputSchema).min(1).max(50).optional(),
  })
  .strict();

export const channelMemberInputSchema = z
  .object({ role: z.enum(["owner", "member"]).default("member") })
  .strict();

export const channelProposalAcceptInputSchema = z
  .object({ projectId: z.string().uuid().nullable().default(null) })
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
};

export type ChannelMember = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: "owner" | "member";
  createdAt: string;
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
  handle: string | null;
  name: string;
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

export type ChannelMessage = {
  id: string;
  channelId: string;
  parentMessageId: string | null;
  author: ChannelMessageAuthor;
  body: string;
  mentionedUserIds: string[];
  mentionedAgentIds: string[];
  attachments: ChannelMessageAttachment[];
  reactions: ChannelMessageReaction[];
  replyCount: number;
  lastReplyAt: string | null;
  /** Up to three unique reply authors, ordered by their most recent reply. */
  replyAuthors?: ChannelMessageAuthor[];
  document: ChannelMessageDocument | null;
  proposal: ChannelMessageProposal | null;
  createdAt: string;
};

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
    if (reply.delegation && (reply.document || reply.issueProposal)) {
      context.addIssue({
        code: "custom",
        message: "A delegated reply cannot also attach a document or issue proposal",
        path: ["delegation"],
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
});
