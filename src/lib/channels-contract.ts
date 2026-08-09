import { z } from "zod";

/**
 * Declared here rather than imported from project-llm: this contract is shared
 * with the Cloudflare Worker, which cannot pull in browser-coupled modules.
 */
export const channelAgentProviders = [
  "codex",
  "claude",
  "grok",
  "opencode",
] as const;
export type ChannelAgentProvider = (typeof channelAgentProviders)[number];

export const channelAgentEfforts = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;
export type ChannelAgentEffort = (typeof channelAgentEfforts)[number];

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
    isDefault: z.boolean().default(false),
    position: z.number().int().min(0).max(999).default(0),
  })
  .strict();

export type ChannelAgentSkillInput = z.input<
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
  isDefault: boolean;
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
  provider: ChannelAgentProvider;
  model: string | null;
  effort: ChannelAgentEffort | null;
  projectId: string | null;
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

export type ChannelMessage = {
  id: string;
  channelId: string;
  parentMessageId: string | null;
  author: ChannelMessageAuthor;
  body: string;
  mentionedUserIds: string[];
  mentionedAgentIds: string[];
  attachments: ChannelMessageAttachment[];
  replyCount: number;
  lastReplyAt: string | null;
  document: ChannelMessageDocument | null;
  proposal: ChannelMessageProposal | null;
  createdAt: string;
};

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
            status: z.enum(["backlog", "queued"]),
          })
          .strict(),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();

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
      status: z.enum(["backlog", "queued"]),
    })
    .strict(),
});

export type ChannelReplyCompletion = z.infer<
  typeof channelReplyCompletionSchema
>;
