import { z } from "zod";

export const CHANNEL_AGENT_ACTIVITY_VERSION = 1 as const;
export const CHANNEL_AGENT_ACTIVITY_HEADLINE_MAX_LENGTH = 240;
export const CHANNEL_AGENT_ACTIVITY_STALE_MS = 30_000;

export const channelAgentActivityKindSchema = z.enum([
  "message",
  "command",
  "fileChange",
  "webSearch",
  "tool",
]);

export const channelAgentActivityDescriptorSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    kind: channelAgentActivityKindSchema,
    headline: z
      .string()
      .trim()
      .min(1)
      .max(CHANNEL_AGENT_ACTIVITY_HEADLINE_MAX_LENGTH),
  })
  .strict();

export const channelAgentActivityPublishInputSchema = z
  .object({
    // MAX_SAFE_INTEGER is reserved for the server's terminal clear tombstone.
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1),
    activity: channelAgentActivityDescriptorSchema.nullable(),
  })
  .strict();

export const channelAgentActivityFrameSchema = z
  .object({
    version: z.literal(CHANNEL_AGENT_ACTIVITY_VERSION),
    replyJobId: z.uuid(),
    attempt: z.number().int().positive(),
    sequence: z.number().int().positive(),
    agentId: z.uuid(),
    channelId: z.uuid(),
    triggerMessageId: z.uuid(),
    parentMessageId: z.uuid(),
    activity: channelAgentActivityDescriptorSchema.nullable(),
    sentAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export const issueAgentActivityFrameSchema = z
  .object({
    version: z.literal(CHANNEL_AGENT_ACTIVITY_VERSION),
    replyJobId: z.uuid(),
    attempt: z.number().int().positive(),
    sequence: z.number().int().positive(),
    projectId: z.uuid(),
    runId: z.uuid(),
    triggerMessageId: z.uuid(),
    parentMessageId: z.uuid(),
    activity: channelAgentActivityDescriptorSchema.nullable(),
    sentAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export const agentReplyActivityFrameSchema = z.union([
  channelAgentActivityFrameSchema,
  issueAgentActivityFrameSchema,
]);

export type ChannelAgentActivityKind = z.infer<
  typeof channelAgentActivityKindSchema
>;
export type ChannelAgentActivityDescriptor = z.infer<
  typeof channelAgentActivityDescriptorSchema
>;
export type ChannelAgentActivityPublishInput = z.infer<
  typeof channelAgentActivityPublishInputSchema
>;
export type ChannelAgentActivityFrame = z.infer<
  typeof channelAgentActivityFrameSchema
>;
export type IssueAgentActivityFrame = z.infer<
  typeof issueAgentActivityFrameSchema
>;
export type AgentReplyActivityFrame = z.infer<
  typeof agentReplyActivityFrameSchema
>;
