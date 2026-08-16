import { z } from "zod";
import {
  agentProviderCapabilityCatalogSchema,
  agentProviders,
  modelEffortSchema,
} from "../../src/lib/agent-provider-contract";
import {
  issueTitleAbsoluteMaxLength,
  issueTitleOverLimitMessage,
} from "../../src/lib/issue-title";
import { channelMessageBlockSchema } from "../../src/lib/channels-contract";

export const mobileClientIds = ["briar-mobile", "briar-android"] as const;
export const mobileClientIdSchema = z.enum(mobileClientIds);
const mobileProviderSchema = z.enum(agentProviders);
const mobileEffortSchema = modelEffortSchema;

export const mobileHealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("briar-api"),
  database: z.string(),
  updates: z.string(),
});

export const mobileDeviceCodeRequestSchema = z.object({
  client_id: mobileClientIdSchema,
  scope: z.literal("openid profile email"),
}).strict();

export const mobileDeviceCodeResponseSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.url(),
  verification_uri_complete: z.url().optional(),
  expires_in: z.number().int().positive().optional(),
  interval: z.number().int().positive().optional(),
});

export const mobileDeviceTokenRequestSchema = z.object({
  grant_type: z.literal("urn:ietf:params:oauth:grant-type:device_code"),
  device_code: z.string().min(1),
  client_id: mobileClientIdSchema,
}).strict();

export const mobileDeviceTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().int().positive().optional(),
});

export const mobileDeviceTokenErrorSchema = z.object({
  error: z.enum([
    "authorization_pending",
    "slow_down",
    "access_denied",
    "expired_token",
  ]),
  error_description: z.string().optional(),
});

export const mobileCurrentUserResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    username: z.string().nullable().optional(),
    name: z.string(),
    email: z.email(),
    image: z.string().nullable().optional(),
  }),
});

export const mobileProjectsResponseSchema = z.object({
  projects: z.array(z.object({
    id: z.uuid(),
    name: z.string(),
    issueKeyPrefix: z.string().regex(/^[A-Z0-9]{1,3}$/u).default("AH"),
    icon: z.string().nullable(),
    organizationId: z.uuid(),
    organizationName: z.string(),
    role: z.enum(["owner", "admin", "member"]),
    createdAt: z.iso.datetime(),
  })),
});

export const mobileIssueAttachmentSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  contentType: z.string(),
  byteSize: z.number().int().nonnegative(),
  url: z.string(),
});

export const mobileMessageAuthorSchema = z.object({
  id: z.string().nullable(),
  name: z.string(),
  image: z.string().nullable(),
  provider: z.string().nullable(),
});

export const mobileOrganizationMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.email(),
  image: z.string().nullable(),
  role: z.enum(["owner", "admin", "member"]),
  createdAt: z.iso.datetime(),
});

export const mobileIssueSubscriberSchema = z.object({
  userId: z.string().min(1),
  subscribedAt: z.iso.datetime(),
});

export const mobileDashboardRunSchema = z.object({
  id: z.uuid(),
  runNumber: z.number().int().positive().optional(),
  currentAttempt: z.number().int().positive().optional(),
  currentRevision: z.number().int().positive().optional(),
  title: z.string(),
  status: z.enum([
    "backlog",
    "queued",
    "running",
    "paused",
    "blocked",
    "failed",
    "completed",
    "cancelled",
  ]),
  workflowStage: z.string().nullable().optional(),
  pausedAt: z.iso.datetime().nullable().optional(),
  resumeRequestedAt: z.iso.datetime().nullable().optional(),
  checkpoint: z.object({
    key: z.string().min(1),
    stage: z.string().min(1),
    stageLabel: z.string().min(1),
    position: z.enum(["before", "after"]),
    attempt: z.number().int().positive(),
    revision: z.number().int().positive(),
    reachedAt: z.iso.datetime().nullable(),
    nextStage: z.string().nullable(),
    nextStageLabel: z.string().nullable(),
    terminalReviewOnly: z.boolean(),
  }).nullable().optional(),
  workflow: z.object({
    version: z.union([z.literal(1), z.literal(2)]),
    stages: z.array(z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      required: z.boolean(),
    }).passthrough()),
  }).passthrough().optional(),
  progress: z.number().min(0).max(100).optional(),
  detail: z.string().nullable().optional(),
  priority: z.number().int().min(1).max(4).nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  createdByUserId: z.string().nullable().optional(),
  subscribers: z.array(mobileIssueSubscriberSchema).optional(),
  issueDescription: z.string().nullable().optional(),
  attachments: z.array(mobileIssueAttachmentSchema).optional(),
  prerequisites: z.array(z.object({
    id: z.uuid(),
    runNumber: z.number().int().positive(),
    title: z.string(),
    status: z.enum(["backlog", "queued", "running", "paused", "blocked", "failed", "completed", "cancelled"]),
  })).optional(),
  dependents: z.array(z.object({
    id: z.uuid(),
    runNumber: z.number().int().positive(),
    title: z.string(),
    status: z.enum(["backlog", "queued", "running", "paused", "blocked", "failed", "completed", "cancelled"]),
  })).optional(),
  executionReadiness: z.enum(["ready", "waiting"]).optional(),
  waitingOnPrerequisiteCount: z.number().int().nonnegative().optional(),
  resultSummary: z.string().nullable().optional(),
  structuredResult: z.object({
    summary: z.string(),
    outcome: z.enum(["completed", "partial", "blocked", "failed"]),
    importance: z.string().optional(),
    urgency: z.string().optional(),
    impact: z.string().optional(),
    humanActionRequired: z.boolean().optional(),
    nextAction: z.string().nullable().optional(),
    dueAt: z.iso.datetime().nullable().optional(),
  }).nullable().optional(),
  resultReviews: z.array(z.object({
    userId: z.string(),
    name: z.string(),
    username: z.string().nullable(),
    image: z.string().nullable(),
    completedAt: z.iso.datetime(),
  })).optional(),
  pullRequestUrls: z.array(z.url()).optional(),
  branch: z.string().nullable().optional(),
  commitSha: z.string().nullable().optional(),
  preferredProvider: mobileProviderSchema.nullable().optional(),
  preferredModel: z.string().nullable().optional(),
  preferredEffort: mobileEffortSchema.nullable().optional(),
  fullAuto: z.boolean().optional(),
  requestedProvider: mobileProviderSchema.nullable().optional(),
  requestedModel: z.string().nullable().optional(),
  requestedEffort: mobileEffortSchema.nullable().optional(),
  requestedWorkerId: z.string().nullable().optional(),
  requestedByUserId: z.string().nullable().optional(),
  dispatchMode: z.enum(["any", "specific"]).nullable().optional(),
  claimedBy: z.string().nullable().optional(),
  claimedAt: z.iso.datetime().nullable().optional(),
  workerId: z.string().nullable().optional(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable().optional(),
  lastEventAt: z.iso.datetime().optional(),
  eventCount: z.number().int().nonnegative().optional(),
});

export const mobileInboxReadStatesSchema = z.object({
  readVersions: z.record(z.string().min(1), z.string().min(1)),
});

const mobileInboxMessageBaseSchema = z.object({
  id: z.string().min(1),
  projectId: z.uuid(),
  projectName: z.string(),
  targetId: z.string().min(1),
  title: z.string(),
  occurredAt: z.iso.datetime(),
  version: z.string().min(1),
});

const mobileInboxIssueMessageSchema = mobileInboxMessageBaseSchema.extend({
  kind: z.literal("issue"),
  runNumber: z.number().int().positive(),
  status: z.enum(["paused", "completed", "failed", "blocked"]),
  workflowStage: z.string().nullable(),
  workflowStageLabel: z.string().nullable().optional(),
  priority: z.number().int().min(1).max(4).nullable(),
  structuredResult: mobileDashboardRunSchema.shape.structuredResult,
});

const mobileInboxConversationMessageSchema = mobileInboxMessageBaseSchema.extend({
  kind: z.literal("conversation"),
  messageId: z.uuid(),
  rootMessageId: z.uuid(),
  body: z.string(),
  blocks: z.array(channelMessageBlockSchema).nullable().optional(),
  authorName: z.string(),
  authorImage: z.string().nullable().optional(),
  issueKey: z.string().optional(),
  reason: z.enum(["mention", "thread_reply", "subscription"]),
});

const mobileInboxChannelMessageSchema = mobileInboxMessageBaseSchema.extend({
  kind: z.literal("channel"),
  channelId: z.uuid(),
  channelName: z.string(),
  messageId: z.uuid(),
  rootMessageId: z.uuid(),
  body: z.string(),
  authorName: z.string(),
  authorImage: z.string().nullable().optional(),
  reason: z.enum(["mention", "thread_reply"]),
});

const mobileInboxSessionMessageSchema = mobileInboxMessageBaseSchema.extend({
  kind: z.literal("session"),
  status: z.enum(["completed", "failed"]),
  agentName: z.string().nullable(),
  issueCount: z.number().int().nonnegative(),
  error: z.string().nullable(),
  summary: z.string().nullable(),
  requiresAttention: z.boolean(),
});

export const mobileIssueSubscriptionResponseSchema = z.object({
  runId: z.uuid(),
  subscribers: z.array(mobileIssueSubscriberSchema),
});

export const mobileInboxFeedResponseSchema = z.object({
  messages: z.array(z.discriminatedUnion("kind", [
    mobileInboxIssueMessageSchema,
    mobileInboxConversationMessageSchema,
    mobileInboxChannelMessageSchema,
    mobileInboxSessionMessageSchema,
  ])),
  subscribedIssueIds: z.array(z.uuid()),
  generatedAt: z.iso.datetime(),
});

export const mobileDashboardWorkerSchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.discriminatedUnion("type", [
    z.object({ type: z.literal("emoji"), value: z.string() }),
    z.object({ type: z.literal("image"), value: z.string() }),
  ]).nullable().optional(),
  agentProvider: mobileProviderSchema.optional(),
  providers: z.array(mobileProviderSchema).optional(),
  capabilities: z
    .object({
      providerCapabilities: agentProviderCapabilityCatalogSchema.optional(),
    })
    .catchall(z.unknown())
    .optional(),
  readiness: z.string(),
  acceptingWork: z.boolean(),
  readinessDetail: z.string().nullable(),
  activeSessions: z.number().int().nonnegative(),
  availableSessions: z.number().int().nonnegative(),
});

export const mobileProjectExecutionWorkerPolicySchema = z.object({
  selectionMode: z.enum(["any", "allowlist"]),
  defaultWorkerId: z.string().nullable(),
  allowedWorkerIds: z.array(z.string()),
  updatedAt: z.iso.datetime().nullable(),
});

export const mobileConversationNotificationSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  runTitle: z.string(),
  rootMessageId: z.uuid(),
  body: z.string(),
  author: mobileMessageAuthorSchema,
  reason: z.enum(["mention", "thread_reply", "subscription"]),
  createdAt: z.iso.datetime(),
});

export const mobileChannelNotificationSchema = z.object({
  id: z.uuid(),
  channelId: z.uuid(),
  channelName: z.string(),
  rootMessageId: z.uuid(),
  body: z.string(),
  author: mobileMessageAuthorSchema,
  reason: z.enum(["mention", "thread_reply"]),
  createdAt: z.iso.datetime(),
});

const mobileDashboardProjectSchema = mobileProjectsResponseSchema.shape.projects.element;

export const mobileDashboardSnapshotSchema = z.object({
  project: mobileDashboardProjectSchema,
  runs: z.array(mobileDashboardRunSchema),
  workers: z.array(mobileDashboardWorkerSchema).optional(),
  organizationProviders: z.array(mobileProviderSchema).optional(),
  executionPolicy: mobileProjectExecutionWorkerPolicySchema.optional(),
  members: z.array(mobileOrganizationMemberSchema).optional(),
  conversationNotifications: z.array(mobileConversationNotificationSchema).optional(),
  channelNotifications: z.array(mobileChannelNotificationSchema).optional(),
  cursor: z.number().int().nonnegative().optional(),
  generatedAt: z.iso.datetime(),
});

export const mobileDashboardDeltaSchema = z.object({
  cursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  runs: z.array(mobileDashboardRunSchema),
  deletedRunIds: z.array(z.uuid()),
  project: mobileDashboardProjectSchema.optional(),
  workers: z.array(mobileDashboardWorkerSchema).optional(),
  organizationProviders: z.array(mobileProviderSchema).optional(),
  executionPolicy: mobileProjectExecutionWorkerPolicySchema.optional(),
  members: z.array(mobileOrganizationMemberSchema).optional(),
  conversationNotifications: z.array(mobileConversationNotificationSchema).optional(),
  channelNotifications: z.array(mobileChannelNotificationSchema).optional(),
  generatedAt: z.iso.datetime(),
});

export const mobileRunEventsResponseSchema = z.object({
  events: z.array(z.object({
    id: z.uuid(),
    status: mobileDashboardRunSchema.shape.status,
    workflowStage: z.string().nullable(),
    detail: z.string().nullable(),
    actor: z.string(),
    occurredAt: z.iso.datetime(),
  })),
});

export const mobileIssueReworkProposalSchema = z.object({
  id: z.uuid(),
  type: z.literal("request_issue_rework"),
  workflowStage: z.string().min(1),
  reason: z.string().min(1),
  status: z.enum(["pending", "accepted"]),
  acceptedAt: z.iso.datetime().nullable(),
  appliedRevision: z.number().int().positive().nullable(),
});

export const mobileIssueUpdateProposalSchema = z.object({
  id: z.uuid(),
  type: z.literal("request_issue_update"),
  changes: z.object({
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    priority: z.number().int().min(1).max(4).nullable().optional(),
  }),
  changedFields: z.array(z.enum(["title", "description", "priority"])),
  status: z.enum(["pending", "accepted"]),
  acceptedAt: z.iso.datetime().nullable(),
  resultRunId: z.uuid().nullable(),
});

export const mobileIssueCreateProposalSchema = z.object({
  id: z.uuid(),
  type: z.literal("request_issue_create"),
  issue: z.object({
    title: z.string(),
    description: z.string().nullable(),
    priority: z.number().int().min(1).max(4).nullable(),
    status: z.enum(["backlog", "queued"]),
  }),
  executeAfterCreate: z.boolean().optional(),
  status: z.enum(["pending", "accepted"]),
  acceptedAt: z.iso.datetime().nullable(),
  resultRunId: z.uuid().nullable(),
});

export const mobileIssueExecutionProposalSchema = z.object({
  id: z.uuid(),
  type: z.literal("request_issue_execute"),
  status: z.enum(["pending", "accepted"]),
  projectId: z.uuid(),
  runId: z.uuid(),
  title: z.string().trim().min(1).max(300),
  createdAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  requestedProvider: mobileProviderSchema.nullable(),
  requestedModel: z.string().nullable(),
  requestedEffort: mobileEffortSchema.nullable(),
  requestedWorkerId: z.string().nullable(),
  delegatedByAgentId: z.uuid().nullable(),
  delegatedByAgentName: z.string().nullable(),
}).strict();

export const mobileAgentSkillExecutionProposalSchema = z.object({
  id: z.uuid(),
  type: z.literal("request_agent_skill_execute"),
  status: z.enum(["pending", "accepted"]),
  projectId: z.uuid(),
  agentId: z.uuid(),
  agentName: z.string().trim().min(1).max(100),
  skillId: z.uuid(),
  skillName: z.string().trim().min(1).max(100),
  provider: mobileProviderSchema,
  model: z.string().nullable(),
  effort: mobileEffortSchema.nullable(),
  request: z.string().trim().min(1).max(10_000),
  delegatedByAgentId: z.uuid().nullable(),
  delegatedByAgentName: z.string().nullable(),
  requestedWorkerId: z.string().nullable(),
  requestedWorkerLabel: z.string().nullable(),
  resultSessionId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
}).strict().superRefine((proposal, context) => {
  const hasAcceptedFields = proposal.requestedWorkerId !== null &&
    proposal.requestedWorkerLabel !== null &&
    proposal.resultSessionId !== null && proposal.acceptedAt !== null;
  if (
    (proposal.status === "accepted") !== hasAcceptedFields ||
    (proposal.status === "pending" && (
      proposal.requestedWorkerId !== null ||
      proposal.requestedWorkerLabel !== null ||
      proposal.resultSessionId !== null || proposal.acceptedAt !== null
    ))
  ) {
    context.addIssue({
      code: "custom",
      message: "Agent Skill execution approval fields do not match status",
    });
  }
});

export const mobileIssueProposedActionSchema = z.discriminatedUnion("type", [
  mobileIssueReworkProposalSchema,
  mobileIssueUpdateProposalSchema,
  mobileIssueCreateProposalSchema,
]);

export const mobileIssueMessagesResponseSchema = z.object({
  messages: z.array(z.object({
    id: z.uuid(),
    runId: z.uuid(),
    parentMessageId: z.uuid().nullable(),
    body: z.string(),
    attachments: z.array(mobileIssueAttachmentSchema).default([]),
    author: mobileMessageAuthorSchema,
    replyCount: z.number().int().nonnegative(),
    proposedAction: mobileIssueProposedActionSchema.nullable().optional(),
    executionProposal: mobileIssueExecutionProposalSchema.nullable().optional(),
    skillExecutionProposal:
      mobileAgentSkillExecutionProposalSchema.nullable().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })),
  agentReplies: z.array(z.lazy(() => mobileAgentReplySchema)).default([]),
});

/**
 * A channel's `defaultProjectId` is also how Home groups it: null means the
 * channel belongs to the whole organization rather than to one project.
 */
export const mobileChannelSummarySchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  topic: z.string().nullable(),
  visibility: z.enum(["public", "private"]),
  defaultProjectId: z.uuid().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  memberCount: z.number().int().nonnegative(),
  agentCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lastMessageAt: z.iso.datetime().nullable().optional(),
  lastReadAt: z.iso.datetime().nullable().optional(),
  hasUnread: z.boolean().optional(),
});

export const mobileChannelIssueProposalPayloadSchema = z.object({
  issue: z.object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(100_000).nullable(),
    priority: z.number().int().min(1).max(4).nullable(),
    status: z.enum(["backlog", "queued"]),
  }).strict(),
  executeAfterCreate: z.boolean().default(false),
}).strict();

const mobileChannelProposalBaseShape = {
  id: z.uuid(),
  status: z.enum(["pending", "accepted"]),
  projectId: z.uuid().nullable(),
  resultRunId: z.uuid().nullable(),
};

export const mobileChannelMessageSchema = z.object({
  id: z.uuid(),
  channelId: z.uuid(),
  parentMessageId: z.uuid().nullable(),
  body: z.string(),
  author: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("user"),
      id: z.string(),
      name: z.string(),
      email: z.string(),
      image: z.string().nullable(),
    }),
    z.object({
      type: z.literal("agent"),
      id: z.uuid().nullable(),
      name: z.string(),
      provider: z.string().nullable(),
      image: z.string().nullable(),
    }),
    z.object({
      type: z.literal("webhook"),
      id: z.uuid().nullable(),
      name: z.string(),
    }),
  ]),
  mentionedUserIds: z.array(z.string()).default([]),
  mentionedAgentIds: z.array(z.uuid()).default([]),
  attachments: z.array(mobileIssueAttachmentSchema).default([]),
  reactions: z
    .array(
      z.object({
        emoji: z.string().min(1).max(32),
        count: z.number().int().positive(),
        userIds: z.array(z.string()).min(1),
      }),
    )
    .default([]),
  replyCount: z.number().int().nonnegative(),
  lastReplyAt: z.iso.datetime().nullable(),
  document: z
    .object({
      messageId: z.uuid(),
      title: z.string(),
      projectId: z.uuid().nullable(),
    })
    .nullable(),
  proposal: z
    .union([
      z.object({
        ...mobileChannelProposalBaseShape,
        actionType: z.literal("request_issue_create"),
        payload: mobileChannelIssueProposalPayloadSchema,
      }),
      // Retain decode compatibility for the never-produced legacy DB action.
      z.object({
        ...mobileChannelProposalBaseShape,
        actionType: z.literal("request_plan_document"),
        payload: z.unknown(),
      }),
    ])
    .nullable(),
  executionProposal: mobileIssueExecutionProposalSchema.nullable().optional(),
  skillExecutionProposal:
    mobileAgentSkillExecutionProposalSchema.nullable().optional(),
  createdAt: z.iso.datetime(),
});

export const mobileChannelsResponseSchema = z.object({
  channels: z.array(mobileChannelSummarySchema),
  cursor: z.number().int().nonnegative(),
});

export const mobileChannelDetailResponseSchema = z.object({
  channel: mobileChannelSummarySchema,
  members: z.array(z.object({
    userId: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    role: z.enum(["owner", "member"]),
    createdAt: z.iso.datetime(),
  })),
  agents: z.array(z.object({
    agentId: z.uuid(),
    name: z.string(),
    avatar: z.string().nullable(),
    provider: mobileProviderSchema,
    model: z.string().nullable(),
    projectId: z.uuid().nullable(),
    responsibility: z.string(),
    createdAt: z.iso.datetime(),
  })),
  messages: z.array(mobileChannelMessageSchema),
  agentReplies: z.array(z.lazy(() => mobileChannelAgentReplySchema)).default([]),
  nextCursor: z.uuid().nullable(),
});

export const mobileChannelMessagesResponseSchema = z.object({
  messages: z.array(mobileChannelMessageSchema),
  nextCursor: z.uuid().nullable(),
});

export const mobileCreateChannelMessageRequestSchema = z.object({
  body: z.string().min(1),
  clientMessageId: z.uuid().optional(),
  parentMessageId: z.uuid().nullable().default(null),
  mentionedUserIds: z.array(z.string()).default([]),
  mentionedAgentIds: z.array(z.uuid()).default([]),
});

export const mobileToggleChannelMessageReactionRequestSchema = z.object({
  emoji: z.string().trim().min(1).max(32),
});

export const mobileToggleChannelMessageReactionResponseSchema = z.object({
  message: mobileChannelMessageSchema,
});

export const mobileChannelAgentReplySchema = z.object({
  id: z.uuid(),
  agentId: z.uuid(),
  channelId: z.uuid(),
  triggerMessageId: z.uuid(),
  parentMessageId: z.uuid(),
  replyMessageId: z.uuid(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  attempts: z.number().int().nonnegative(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const mobileCreateChannelMessageResponseSchema = z.object({
  message: mobileChannelMessageSchema,
  agentReplies: z.array(mobileChannelAgentReplySchema),
});

export const mobileChannelDeltaResponseSchema = z.object({
  cursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  channels: z.array(mobileChannelSummarySchema),
  removedChannelIds: z.array(z.uuid()),
  messages: z.array(mobileChannelMessageSchema),
  removedMessageIds: z.array(z.uuid()),
  agentReplies: z.array(mobileChannelAgentReplySchema),
});

export const mobileAcceptChannelProposalRequestSchema = z.object({
  projectId: z.uuid().nullable(),
}).strict();

export const mobileAcceptChannelProposalResponseSchema = z.object({
  outcome: z.enum(["accepted", "already_accepted"]),
  projectId: z.uuid(),
  resultRunId: z.uuid(),
  executionProposal: mobileIssueExecutionProposalSchema.nullable().optional(),
});

export const mobileIssueExecutionApprovalRequestSchema = z.object({
  provider: mobileProviderSchema,
  model: z.string().nullable(),
  effort: mobileEffortSchema.nullable(),
  workerId: z.string().nullable(),
}).strict();

export const mobileAgentSkillExecutionApprovalRequestSchema = z.object({
  workerId: z.string().min(1).max(128).refine(
    (workerId) => workerId === workerId.trim(),
    { message: "workerId cannot contain leading or trailing whitespace" },
  ),
}).strict();

export const mobileRunEvidenceResponseSchema = z.object({
  evidence: z.array(z.object({
    key: z.string(),
    attempt: z.number().int().positive(),
    revision: z.number().int().positive(),
    stage: z.string(),
    type: z.string(),
    status: z.enum(["pending", "passed", "failed", "skipped"]),
    detail: z.string().nullable(),
    url: z.url().nullable(),
    actor: z.string(),
    observedAt: z.iso.datetime(),
    images: z.array(z.object({
      id: z.uuid(),
      filename: z.string(),
      contentType: z.string(),
      byteSize: z.number().int().nonnegative(),
      url: z.string(),
    })).optional(),
    canonical: z.boolean(),
  })),
});

export const mobileDashboardCursorExpiredSchema = z.object({
  code: z.literal("dashboard_cursor_expired"),
  message: z.string(),
});

const mobileRunStatusSchema = mobileDashboardRunSchema.shape.status;
const mobilePlacementStatusSchema = z.enum([
  "backlog",
  "queued",
  "running",
  "blocked",
  "failed",
  "completed",
  "cancelled",
]);
const requestIdSchema = z.object({ requestId: z.uuid() });

const mobileIssueTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(issueTitleAbsoluteMaxLength)
  .superRefine((title, context) => {
    const message = issueTitleOverLimitMessage(title);
    if (message) {
      context.addIssue({ code: "custom", message });
    }
  });

const mobileIssueWriteBaseSchema = z
  .object({
    title: mobileIssueTitleSchema,
    description: z.string().max(100_000).nullable(),
    priority: z.number().int().min(1).max(4).nullable(),
    assigneeUserId: z.string().nullable(),
    status: z.enum(["backlog", "queued"]),
    preferredProvider: mobileProviderSchema.nullable().optional(),
    preferredModel: z.string().nullable().optional(),
    preferredEffort: mobileEffortSchema.nullable().optional(),
    fullAuto: z.boolean().default(false),
  })
  .strict();

export const mobileCreateIssueRequestSchema = mobileIssueWriteBaseSchema
  .superRefine((input, context) => {
    if (input.preferredModel && !input.preferredProvider) {
      context.addIssue({
        code: "custom",
        message: "A provider is required for a model preference",
      });
    }
    if (input.preferredEffort && !input.preferredProvider) {
      context.addIssue({
        code: "custom",
        message: "A provider is required for an effort preference",
      });
    }
    if (input.preferredEffort && !input.preferredModel) {
      context.addIssue({
        code: "custom",
        message: "A model is required for an effort preference",
      });
    }
  });
export const mobileCreateIssueResponseSchema = z.object({
  runId: z.uuid(),
  sourceKey: z.string(),
  stage: z.literal("queued"),
  status: z.enum(["backlog", "queued"]),
  assigneeUserId: z.string().nullable(),
  createdByUserId: z.string(),
  attachments: z.array(mobileIssueAttachmentSchema),
});
export const mobileUpdateIssueRequestSchema = z
  .object({
    title: mobileIssueTitleSchema,
    description: z.string().max(100_000).nullable(),
    priority: z.number().int().min(1).max(4).nullable(),
    assigneeUserId: z.string().nullable(),
  })
  .strict();
export const mobileUpdateIssueResponseSchema = z.object({
  runId: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.number().int().min(1).max(4).nullable(),
  assigneeUserId: z.string().nullable(),
});
export const mobilePreferencesSchema = z.object({
  provider: mobileProviderSchema.nullable(),
  model: z.string().nullable(),
  effort: mobileEffortSchema.nullable(),
}).strict();
export const mobilePreferencesResponseSchema = mobilePreferencesSchema.extend({ runId: z.uuid() });
export const mobileDependencyResponseSchema = z.object({
  prerequisiteRunId: z.uuid(),
  dependentRunId: z.uuid(),
  outcome: z.enum(["created", "already_exists"]),
});
export const mobileMoveRunRequestSchema = requestIdSchema.extend({
  status: mobilePlacementStatusSchema,
  workflowStage: z.string().nullable(),
});
export const mobileMoveRunResponseSchema = z.object({
  runId: z.uuid(),
  outcome: z.enum(["moved", "unchanged", "already_moved"]),
  status: mobilePlacementStatusSchema,
  workflowStage: z.string().nullable(),
});
export const mobileRecoveryRequestSchema = requestIdSchema.extend({ reason: z.string().nullable() });
export const mobileRecoveryResponseSchema = z.object({
  runId: z.uuid(),
  outcome: z.string(),
  attempt: z.number().int().positive(),
  stage: z.enum(["queued", "cancelled"]),
});
export const mobileResumeRequestSchema = requestIdSchema.extend({
  checkpointKey: z.string().min(1),
  attempt: z.number().int().positive(),
  revision: z.number().int().positive(),
});
export const mobileResumeResponseSchema = z.object({
  runId: z.uuid(),
  outcome: z.enum(["approved", "already_approved", "resumed", "already_resumed"]),
  workflowStage: z.string().nullable(),
  startStage: z.string().nullable(),
  checkpointKey: z.string().nullable(),
  attempt: z.number().int().positive().nullable(),
  revision: z.number().int().positive().nullable(),
  terminalReviewOnly: z.boolean(),
});
export const mobileDispatchRequestSchema = requestIdSchema.extend({
  provider: mobileProviderSchema,
  model: z.string().nullable(),
  effort: mobileEffortSchema.nullable(),
  persistPreferences: z.boolean(),
  workerId: z.string().nullable(),
});
export const mobileDispatchResponseSchema = z.object({
  runId: z.uuid(),
  agentId: z.uuid().nullable(),
  provider: mobileProviderSchema,
  model: z.string().nullable(),
  effort: mobileEffortSchema.nullable(),
  requestedWorkerId: z.string().nullable(),
  requestedByUserId: z.string(),
  dispatchMode: z.enum(["any", "specific"]),
  dispatchedAt: z.iso.datetime(),
  outcome: z.enum(["dispatched", "already_dispatched"]),
});
export const mobileIssueExecutionApprovalResponseSchema = z.object({
  proposal: mobileIssueExecutionProposalSchema,
  outcome: z.enum(["accepted", "already_accepted"]),
  projectId: z.uuid(),
  runId: z.uuid(),
  dispatch: mobileDispatchResponseSchema,
}).strict();
export const mobileIssueMessageSchema = mobileIssueMessagesResponseSchema.shape.messages.element;
export const mobileCreateMessageRequestSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  clientMessageId: z.uuid().optional(),
  parentMessageId: z.uuid().nullable(),
  mentionedUserIds: z.array(z.string()),
  agentConversationId: z.string().nullable(),
}).strict();
const mobileAgentReplySchema = z.object({
  id: z.uuid(),
  triggerMessageId: z.uuid(),
  parentMessageId: z.uuid(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  attempts: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export const mobileCreateMessageResponseSchema = z.object({
  message: mobileIssueMessageSchema,
  agentReply: mobileAgentReplySchema.nullable(),
});
export const mobileAgentReplyResponseSchema = z.object({
  agentReply: mobileAgentReplySchema,
  message: mobileIssueMessageSchema.nullable(),
});
export const mobileAcceptIssueReworkProposalResponseSchema = z.object({
  proposal: mobileIssueReworkProposalSchema,
  outcome: z.enum(["accepted", "already_accepted"]),
  attempt: z.number().int().positive(),
  revision: z.number().int().positive(),
  workflowStage: z.string().min(1),
});
export const mobileAcceptIssueActionProposalResponseSchema = z.object({
  proposal: z.union([
    mobileIssueUpdateProposalSchema,
    mobileIssueCreateProposalSchema,
  ]),
  outcome: z.enum(["accepted", "already_accepted"]),
  resultRunId: z.uuid().nullable(),
  executionProposal: mobileIssueExecutionProposalSchema.nullable().optional(),
});
export const mobileResultReviewSchema = mobileDashboardRunSchema.shape.resultReviews.unwrap().element;

export const mobileProjectAgentSkillSchema = z.object({
  id: z.uuid(),
  agentId: z.uuid(),
  name: z.string(),
  instructions: z.string(),
  provider: mobileProviderSchema,
  model: z.string().nullable(),
  effort: mobileEffortSchema.nullable(),
  kind: z.enum(["issue_processing", "custom"]),
  position: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const mobileProjectAgentSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  avatar: z.string().nullable(),
  codexPet: z.object({
    slug: z.string(),
    name: z.string(),
    author: z.string(),
    license: z.string(),
    spriteVersion: z.number().int(),
    spriteSheetUrl: z.string().nullable().optional(),
  }).nullable().optional(),
  provider: mobileProviderSchema,
  model: z.string().nullable(),
  responsibility: z.string(),
  skill: z.string(),
  skills: z.array(mobileProjectAgentSkillSchema),
  calendarColor: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const mobileProjectAgentsResponseSchema = z.object({
  agents: z.array(mobileProjectAgentSchema),
});

export const mobileProjectAgentSessionSchema = z.object({
  id: z.string(),
  projectId: z.uuid(),
  dispatchGroupId: z.string().optional(),
  agentId: z.uuid().nullable().optional(),
  agentName: z.string().nullable().optional(),
  skillId: z.uuid().nullable().optional(),
  sessionType: z.enum(["task", "dispatch"]).optional(),
  trigger: z.enum(["manual", "scheduled"]).nullable().optional(),
  scheduleId: z.string().nullable().optional(),
  scheduleRunId: z.string().nullable().optional(),
  parentSessionId: z.string().nullable().optional(),
  request: z.string().nullable().optional(),
  status: z.enum(["running", "completed", "failed", "skipped", "interrupted"]),
  issues: z.array(z.object({
    runId: z.string(),
    runNumber: z.number().int(),
    sourceKey: z.string(),
    title: z.string(),
    outcome: z.enum(["pending", "completed", "blocked", "failed", "skipped"]),
    summary: z.string().nullable(),
  })),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  conversationId: z.string().nullable().optional(),
  workspaceRoot: z.null().optional(),
  requestedWorkerId: z.string().nullable().optional(),
  workerId: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  events: z.array(z.object({
    id: z.string(),
    type: z.enum([
      "started",
      "completed",
      "failed",
      "skipped",
      "interrupted",
      "stopped",
    ]),
    occurredAt: z.string(),
  })).optional(),
  dispatchEvents: z.array(z.unknown()).optional(),
  workers: z.array(z.unknown()).optional(),
  updatedAt: z.string().optional(),
});

export const mobileProjectAgentSessionsResponseSchema = z.object({
  sessions: z.array(mobileProjectAgentSessionSchema),
});

export const mobileProjectAgentTaskRequestSchema = z.object({
  agentId: z.uuid(),
  skillId: z.uuid(),
  request: z.string().trim().min(1).max(50_000),
  workerId: z.string().trim().min(1).max(128),
  requestId: z.uuid(),
});

export const mobileProjectAgentTaskResponseSchema = z.object({
  session: mobileProjectAgentSessionSchema,
});

export const mobileAgentSkillExecutionApprovalResponseSchema = z.object({
  outcome: z.enum(["accepted", "already_accepted"]),
  proposal: mobileAgentSkillExecutionProposalSchema,
  projectId: z.uuid(),
  session: mobileProjectAgentSessionSchema,
}).strict().superRefine((response, context) => {
  const proposal = response.proposal;
  const session = response.session;
  if (
    proposal.status !== "accepted" ||
    proposal.resultSessionId === null ||
    proposal.requestedWorkerId === null ||
    proposal.requestedWorkerLabel === null ||
    proposal.acceptedAt === null ||
    response.projectId !== proposal.projectId ||
    session.id !== proposal.resultSessionId ||
    session.projectId !== proposal.projectId ||
    session.agentId !== proposal.agentId ||
    session.agentName !== proposal.agentName ||
    session.skillId !== proposal.skillId ||
    session.sessionType !== "task" ||
    session.trigger !== "manual" ||
    session.request !== proposal.request ||
    session.requestedWorkerId !== proposal.requestedWorkerId ||
    session.workerId !== proposal.requestedWorkerId
  ) {
    context.addIssue({
      code: "custom",
      message: "Approved Agent Skill execution response is not canonical",
    });
  }
});

export const mobileOperationSchemas = {
  getHealth: { response: mobileHealthResponseSchema },
  beginDeviceAuthorization: {
    request: mobileDeviceCodeRequestSchema,
    response: mobileDeviceCodeResponseSchema,
  },
  pollDeviceToken: {
    request: mobileDeviceTokenRequestSchema,
    response: mobileDeviceTokenResponseSchema,
    errorResponse: mobileDeviceTokenErrorSchema,
  },
  getCurrentUser: { response: mobileCurrentUserResponseSchema },
  listProjects: { response: mobileProjectsResponseSchema },
  getInboxFeed: { response: mobileInboxFeedResponseSchema },
  getInboxReadStates: { response: mobileInboxReadStatesSchema },
  putInboxReadStates: {
    request: mobileInboxReadStatesSchema,
    response: mobileInboxReadStatesSchema,
  },
  getDashboardSnapshot: { response: mobileDashboardSnapshotSchema },
  getDashboardDelta: {
    response: mobileDashboardDeltaSchema,
    errorResponse: mobileDashboardCursorExpiredSchema,
  },
  listRunEvents: { response: mobileRunEventsResponseSchema },
  listIssueMessages: { response: mobileIssueMessagesResponseSchema },
  listRunEvidence: { response: mobileRunEvidenceResponseSchema },
  createIssue: { request: mobileCreateIssueRequestSchema, response: mobileCreateIssueResponseSchema },
  updateIssue: { request: mobileUpdateIssueRequestSchema, response: mobileUpdateIssueResponseSchema },
  putIssueSubscription: { response: mobileIssueSubscriptionResponseSchema },
  deleteIssueSubscription: { response: mobileIssueSubscriptionResponseSchema },
  deleteIssue: { response: z.null() },
  updateIssuePreferences: { request: mobilePreferencesSchema, response: mobilePreferencesResponseSchema },
  addIssueDependency: { response: mobileDependencyResponseSchema },
  removeIssueDependency: { response: z.null() },
  moveRun: { request: mobileMoveRunRequestSchema, response: mobileMoveRunResponseSchema },
  retryRun: { request: mobileRecoveryRequestSchema, response: mobileRecoveryResponseSchema },
  cancelRun: { request: mobileRecoveryRequestSchema, response: mobileRecoveryResponseSchema },
  resumeRun: { request: mobileResumeRequestSchema, response: mobileResumeResponseSchema },
  dispatchRun: { request: mobileDispatchRequestSchema, response: mobileDispatchResponseSchema },
  reassignRun: { request: mobileDispatchRequestSchema, response: mobileDispatchResponseSchema },
  completeResultReview: { response: mobileResultReviewSchema },
  createIssueMessage: { request: mobileCreateMessageRequestSchema, response: mobileCreateMessageResponseSchema },
  getIssueAgentReply: { response: mobileAgentReplyResponseSchema },
  acceptIssueReworkProposal: {
    response: mobileAcceptIssueReworkProposalResponseSchema,
  },
  acceptIssueActionProposal: {
    response: mobileAcceptIssueActionProposalResponseSchema,
  },
  acceptIssueExecutionProposal: {
    request: mobileIssueExecutionApprovalRequestSchema,
    response: mobileIssueExecutionApprovalResponseSchema,
  },
  acceptIssueSkillExecutionProposal: {
    request: mobileAgentSkillExecutionApprovalRequestSchema,
    response: mobileAgentSkillExecutionApprovalResponseSchema,
  },
  listProjectAgents: { response: mobileProjectAgentsResponseSchema },
  listProjectAgentSessions: { response: mobileProjectAgentSessionsResponseSchema },
  runProjectAgentTask: {
    request: mobileProjectAgentTaskRequestSchema,
    response: mobileProjectAgentTaskResponseSchema,
  },
  listChannels: { response: mobileChannelsResponseSchema },
  getChannelDelta: { response: mobileChannelDeltaResponseSchema },
  getChannel: { response: mobileChannelDetailResponseSchema },
  listChannelMessages: { response: mobileChannelMessagesResponseSchema },
  createChannelMessage: {
    request: mobileCreateChannelMessageRequestSchema,
    response: mobileCreateChannelMessageResponseSchema,
  },
  toggleChannelMessageReaction: {
    request: mobileToggleChannelMessageReactionRequestSchema,
    response: mobileToggleChannelMessageReactionResponseSchema,
  },
  acceptChannelProposal: {
    request: mobileAcceptChannelProposalRequestSchema,
    response: mobileAcceptChannelProposalResponseSchema,
  },
  acceptChannelExecutionProposal: {
    request: mobileIssueExecutionApprovalRequestSchema,
    response: mobileIssueExecutionApprovalResponseSchema,
  },
  acceptChannelSkillExecutionProposal: {
    request: mobileAgentSkillExecutionApprovalRequestSchema,
    response: mobileAgentSkillExecutionApprovalResponseSchema,
  },
} as const;

export function isMobileClientId(value: string) {
  return mobileClientIdSchema.safeParse(value).success;
}
