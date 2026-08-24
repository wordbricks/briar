import * as Schema from "effect/Schema";
import {
  AgentProviderCapabilityCatalog,
  ModelEffort as mobileEffortSchema,
} from "../../src/lib/agent-provider-contract";
import { agentProviders } from "../../src/lib/agent-provider";
import {
  IsoDateTimeUtc as isoDateTime,
} from "../../src/lib/date-time-schema";
import {
  issueTitleAbsoluteMaxLength,
  issueTitleOverLimitMessage,
} from "../../src/lib/issue-title";
import { channelMessageBlockSchema } from "../../src/lib/channels-contract";
import {
  defaulted,
  defaultedWith,
  emailString,
  integerBetween,
  mobileSchemaDecodeOptions,
  mutableArray,
  mutableStruct,
  nonEmptyString,
  nonNegativeInteger,
  numberBetween,
  passthrough,
  positiveInteger,
  strict,
  urlString,
  uuidString,
} from "./mobile-contract-schema";

const optionalNullable = <S extends Schema.Constraint>(schema: S) =>
  Schema.optional(Schema.NullOr(schema));
const nullable = <S extends Schema.Constraint>(schema: S) =>
  Schema.NullOr(schema);
const optional = <S extends Schema.Constraint>(schema: S) =>
  Schema.optional(schema);

export const mobileClientIds = ["briar-mobile", "briar-android"] as const;
export const mobileClientIdSchema = Schema.Literals(mobileClientIds);
const mobileProviderSchema = Schema.Literals(agentProviders);

const mobileRoleSchema = Schema.Literals(["owner", "admin", "member"]);
const mobileRunStatusSchema = Schema.Literals([
  "backlog",
  "queued",
  "running",
  "paused",
  "blocked",
  "failed",
  "completed",
  "cancelled",
]);

export const mobileHealthResponseSchema = mutableStruct({
  ok: Schema.Literal(true),
  service: Schema.Literal("briar-api"),
  database: Schema.String,
  updates: Schema.String,
});

export const mobileDeviceCodeRequestSchema = strict(mutableStruct({
  client_id: mobileClientIdSchema,
  scope: Schema.Literal("openid profile email"),
}));

export const mobileDeviceCodeResponseSchema = mutableStruct({
  device_code: nonEmptyString,
  user_code: nonEmptyString,
  verification_uri: urlString,
  verification_uri_complete: optional(urlString),
  expires_in: optional(positiveInteger),
  interval: optional(positiveInteger),
});

export const mobileDeviceTokenRequestSchema = strict(mutableStruct({
  grant_type: Schema.Literal(
    "urn:ietf:params:oauth:grant-type:device_code",
  ),
  device_code: nonEmptyString,
  client_id: mobileClientIdSchema,
}));

export const mobileDeviceTokenResponseSchema = mutableStruct({
  access_token: nonEmptyString,
  token_type: optional(Schema.String),
  expires_in: optional(positiveInteger),
});

export const mobileDeviceTokenErrorSchema = mutableStruct({
  error: Schema.Literals([
    "authorization_pending",
    "slow_down",
    "access_denied",
    "expired_token",
  ]),
  error_description: optional(Schema.String),
});

export const mobileCurrentUserResponseSchema = mutableStruct({
  user: mutableStruct({
    id: Schema.String,
    username: optionalNullable(Schema.String),
    name: Schema.String,
    email: emailString,
    image: optionalNullable(Schema.String),
  }),
});

const mobileDashboardProjectSchema = mutableStruct({
  id: uuidString,
  name: Schema.String,
  issueKeyPrefix: defaulted(
    Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,3}$/u)),
    "AH",
  ),
  scheduleTabEnabled: defaulted(Schema.Boolean, true),
  icon: nullable(Schema.String),
  organizationId: uuidString,
  organizationName: Schema.String,
  role: mobileRoleSchema,
  createdAt: isoDateTime,
});

export const mobileProjectsResponseSchema = mutableStruct({
  projects: mutableArray(mobileDashboardProjectSchema),
});

export const mobileIssueAttachmentSchema = mutableStruct({
  id: uuidString,
  filename: Schema.String,
  contentType: Schema.String,
  byteSize: nonNegativeInteger,
  url: Schema.String,
});

export const mobileMessageAuthorSchema = mutableStruct({
  id: nullable(Schema.String),
  agentId: optionalNullable(uuidString),
  name: Schema.String,
  image: nullable(Schema.String),
  provider: nullable(Schema.String),
});

export const mobileOrganizationMemberSchema = mutableStruct({
  userId: Schema.String,
  name: Schema.String,
  email: emailString,
  image: nullable(Schema.String),
  role: mobileRoleSchema,
  createdAt: isoDateTime,
});

export const mobileIssueSubscriberSchema = mutableStruct({
  userId: nonEmptyString,
  subscribedAt: isoDateTime,
});

const mobileCheckpointSchema = mutableStruct({
  key: nonEmptyString,
  stage: nonEmptyString,
  stageLabel: nonEmptyString,
  position: Schema.Literals(["before", "after"]),
  attempt: positiveInteger,
  revision: positiveInteger,
  reachedAt: nullable(isoDateTime),
  nextStage: nullable(Schema.String),
  nextStageLabel: nullable(Schema.String),
  terminalReviewOnly: Schema.Boolean,
});

const mobileWorkflowStageSchema = passthrough(mutableStruct({
  id: nonEmptyString,
  label: nonEmptyString,
  required: Schema.Boolean,
}));

const mobileWorkflowSchema = passthrough(mutableStruct({
  version: Schema.Literals([1, 2]),
  stages: mutableArray(mobileWorkflowStageSchema),
}));

const mobileRunDependencySchema = mutableStruct({
  id: uuidString,
  runNumber: positiveInteger,
  title: Schema.String,
  status: mobileRunStatusSchema,
});

const mobileStructuredResultSchema = mutableStruct({
  summary: Schema.String,
  outcome: Schema.Literals(["completed", "partial", "blocked", "failed"]),
  importance: optional(Schema.String),
  urgency: optional(Schema.String),
  impact: optional(Schema.String),
  humanActionRequired: optional(Schema.Boolean),
  nextAction: optionalNullable(Schema.String),
  dueAt: optionalNullable(isoDateTime),
});

export const mobileResultReviewSchema = mutableStruct({
  userId: Schema.String,
  name: Schema.String,
  username: nullable(Schema.String),
  image: nullable(Schema.String),
  completedAt: isoDateTime,
});

export const mobileDashboardRunSchema = mutableStruct({
  id: uuidString,
  runNumber: optional(positiveInteger),
  currentAttempt: optional(positiveInteger),
  currentRevision: optional(positiveInteger),
  title: Schema.String,
  status: mobileRunStatusSchema,
  workflowStage: optionalNullable(Schema.String),
  pausedAt: optionalNullable(isoDateTime),
  resumeRequestedAt: optionalNullable(isoDateTime),
  checkpoint: optionalNullable(mobileCheckpointSchema),
  workflow: optional(mobileWorkflowSchema),
  progress: optional(numberBetween(0, 100)),
  detail: optionalNullable(Schema.String),
  priority: optionalNullable(integerBetween(1, 4)),
  assigneeUserId: optionalNullable(Schema.String),
  createdByUserId: optionalNullable(Schema.String),
  subscribers: optional(mutableArray(mobileIssueSubscriberSchema)),
  issueDescription: optionalNullable(Schema.String),
  attachments: optional(mutableArray(mobileIssueAttachmentSchema)),
  prerequisites: optional(mutableArray(mobileRunDependencySchema)),
  dependents: optional(mutableArray(mobileRunDependencySchema)),
  executionReadiness: optional(Schema.Literals(["ready", "waiting"])),
  waitingOnPrerequisiteCount: optional(nonNegativeInteger),
  resultSummary: optionalNullable(Schema.String),
  structuredResult: optionalNullable(mobileStructuredResultSchema),
  resultReviews: optional(mutableArray(mobileResultReviewSchema)),
  pullRequestUrls: optional(mutableArray(urlString)),
  branch: optionalNullable(Schema.String),
  commitSha: optionalNullable(Schema.String),
  preferredProvider: optionalNullable(mobileProviderSchema),
  preferredModel: optionalNullable(Schema.String),
  preferredEffort: optionalNullable(mobileEffortSchema),
  fullAuto: optional(Schema.Boolean),
  requestedProvider: optionalNullable(mobileProviderSchema),
  requestedModel: optionalNullable(Schema.String),
  requestedEffort: optionalNullable(mobileEffortSchema),
  requestedWorkerId: optionalNullable(Schema.String),
  requestedByUserId: optionalNullable(Schema.String),
  dispatchMode: optionalNullable(Schema.Literals(["any", "specific"])),
  claimedBy: optionalNullable(Schema.String),
  claimedAt: optionalNullable(isoDateTime),
  workerId: optionalNullable(Schema.String),
  updatedAt: isoDateTime,
  completedAt: optionalNullable(isoDateTime),
  lastEventAt: optional(isoDateTime),
  eventCount: optional(nonNegativeInteger),
});

export const mobileInboxReadStatesSchema = mutableStruct({
  readVersions: Schema.Record(
    Schema.String,
    Schema.mutableKey(nonEmptyString),
  ).check(Schema.makeFilter((readVersions) =>
    Object.keys(readVersions).every((key) => key.length > 0) ||
    "Inbox read state keys must not be empty"
  )),
});

const mobileInboxMessageBaseFields = {
  id: nonEmptyString,
  projectId: uuidString,
  projectName: Schema.String,
  targetId: nonEmptyString,
  title: Schema.String,
  occurredAt: isoDateTime,
  version: nonEmptyString,
} as const;

const mobileInboxIssueMessageSchema = mutableStruct({
  ...mobileInboxMessageBaseFields,
  kind: Schema.Literal("issue"),
  runNumber: positiveInteger,
  status: Schema.Literals(["paused", "completed", "failed", "blocked"]),
  workflowStage: nullable(Schema.String),
  workflowStageLabel: optionalNullable(Schema.String),
  priority: nullable(integerBetween(1, 4)),
  structuredResult: optionalNullable(mobileStructuredResultSchema),
});

const mobileInboxConversationMessageSchema = mutableStruct({
  ...mobileInboxMessageBaseFields,
  kind: Schema.Literal("conversation"),
  messageId: uuidString,
  rootMessageId: uuidString,
  body: Schema.String,
  blocks: optionalNullable(mutableArray(channelMessageBlockSchema)),
  authorName: Schema.String,
  authorImage: optionalNullable(Schema.String),
  issueKey: optional(Schema.String),
  reason: Schema.Literals(["mention", "thread_reply", "subscription"]),
});

const mobileInboxChannelMessageSchema = mutableStruct({
  ...mobileInboxMessageBaseFields,
  kind: Schema.Literal("channel"),
  channelId: uuidString,
  channelName: Schema.String,
  messageId: uuidString,
  rootMessageId: uuidString,
  body: Schema.String,
  authorName: Schema.String,
  authorImage: optionalNullable(Schema.String),
  reason: Schema.Literals(["mention", "thread_reply", "subscription"]),
});

const mobileInboxSessionMessageSchema = mutableStruct({
  ...mobileInboxMessageBaseFields,
  kind: Schema.Literal("session"),
  status: Schema.Literals(["completed", "failed"]),
  agentName: nullable(Schema.String),
  issueCount: nonNegativeInteger,
  error: nullable(Schema.String),
  summary: nullable(Schema.String),
  requiresAttention: Schema.Boolean,
});

export const mobileIssueSubscriptionResponseSchema = mutableStruct({
  runId: uuidString,
  subscribers: mutableArray(mobileIssueSubscriberSchema),
});

export const mobileInboxFeedResponseSchema = mutableStruct({
  messages: mutableArray(Schema.Union([
    mobileInboxIssueMessageSchema,
    mobileInboxConversationMessageSchema,
    mobileInboxChannelMessageSchema,
    mobileInboxSessionMessageSchema,
  ])),
  subscribedIssueIds: mutableArray(uuidString),
  generatedAt: isoDateTime,
});

const mobileWorkerIconSchema = Schema.Union([
  mutableStruct({ type: Schema.Literal("emoji"), value: Schema.String }),
  mutableStruct({ type: Schema.Literal("image"), value: Schema.String }),
]);

const mobileWorkerCapabilitiesSchema = passthrough(mutableStruct({
  providerCapabilities: optional(AgentProviderCapabilityCatalog),
}));

export const mobileDashboardWorkerSchema = mutableStruct({
  id: Schema.String,
  label: Schema.String,
  icon: optionalNullable(mobileWorkerIconSchema),
  agentProvider: optional(mobileProviderSchema),
  providers: optional(mutableArray(mobileProviderSchema)),
  capabilities: optional(mobileWorkerCapabilitiesSchema),
  readiness: Schema.String,
  acceptingWork: Schema.Boolean,
  readinessDetail: nullable(Schema.String),
  activeSessions: nonNegativeInteger,
  availableSessions: nonNegativeInteger,
});

export const mobileProjectExecutionWorkerPolicySchema = mutableStruct({
  selectionMode: Schema.Literals(["any", "allowlist"]),
  defaultWorkerId: nullable(Schema.String),
  allowedWorkerIds: mutableArray(Schema.String),
  updatedAt: nullable(isoDateTime),
});

export const mobileConversationNotificationSchema = mutableStruct({
  id: uuidString,
  runId: uuidString,
  runTitle: Schema.String,
  rootMessageId: uuidString,
  body: Schema.String,
  author: mobileMessageAuthorSchema,
  reason: Schema.Literals(["mention", "thread_reply", "subscription"]),
  createdAt: isoDateTime,
});

export const mobileChannelNotificationSchema = mutableStruct({
  id: uuidString,
  channelId: uuidString,
  channelName: Schema.String,
  rootMessageId: uuidString,
  body: Schema.String,
  author: mobileMessageAuthorSchema,
  reason: Schema.Literals(["mention", "thread_reply", "subscription"]),
  createdAt: isoDateTime,
});

export const mobileDashboardSnapshotSchema = mutableStruct({
  project: mobileDashboardProjectSchema,
  runs: mutableArray(mobileDashboardRunSchema),
  workers: optional(mutableArray(mobileDashboardWorkerSchema)),
  organizationProviders: optional(mutableArray(mobileProviderSchema)),
  executionPolicy: optional(mobileProjectExecutionWorkerPolicySchema),
  members: optional(mutableArray(mobileOrganizationMemberSchema)),
  conversationNotifications: optional(
    mutableArray(mobileConversationNotificationSchema),
  ),
  channelNotifications: optional(mutableArray(mobileChannelNotificationSchema)),
  cursor: optional(nonNegativeInteger),
  generatedAt: isoDateTime,
});

export const mobileDashboardDeltaSchema = mutableStruct({
  cursor: nonNegativeInteger,
  hasMore: Schema.Boolean,
  runs: mutableArray(mobileDashboardRunSchema),
  deletedRunIds: mutableArray(uuidString),
  project: optional(mobileDashboardProjectSchema),
  workers: optional(mutableArray(mobileDashboardWorkerSchema)),
  organizationProviders: optional(mutableArray(mobileProviderSchema)),
  executionPolicy: optional(mobileProjectExecutionWorkerPolicySchema),
  members: optional(mutableArray(mobileOrganizationMemberSchema)),
  conversationNotifications: optional(
    mutableArray(mobileConversationNotificationSchema),
  ),
  channelNotifications: optional(mutableArray(mobileChannelNotificationSchema)),
  generatedAt: isoDateTime,
});

export const mobileRunEventsResponseSchema = mutableStruct({
  events: mutableArray(mutableStruct({
    id: uuidString,
    status: mobileRunStatusSchema,
    workflowStage: nullable(Schema.String),
    detail: nullable(Schema.String),
    actor: Schema.String,
    actorName: optionalNullable(Schema.String),
    occurredAt: isoDateTime,
  })),
});

export const mobileIssueReworkProposalSchema = mutableStruct({
  id: uuidString,
  type: Schema.Literal("request_issue_rework"),
  workflowStage: nonEmptyString,
  reason: nonEmptyString,
  status: Schema.Literals(["pending", "accepted"]),
  acceptedAt: nullable(isoDateTime),
  appliedRevision: nullable(positiveInteger),
});

export const mobileIssueUpdateProposalSchema = mutableStruct({
  id: uuidString,
  type: Schema.Literal("request_issue_update"),
  changes: mutableStruct({
    title: optional(Schema.String),
    description: optionalNullable(Schema.String),
    priority: optionalNullable(integerBetween(1, 4)),
  }),
  changedFields: mutableArray(
    Schema.Literals(["title", "description", "priority"]),
  ),
  status: Schema.Literals(["pending", "accepted"]),
  acceptedAt: nullable(isoDateTime),
  resultRunId: nullable(uuidString),
});

export const mobileIssueCreateProposalSchema = mutableStruct({
  id: uuidString,
  type: Schema.Literal("request_issue_create"),
  issue: mutableStruct({
    title: Schema.String,
    description: nullable(Schema.String),
    priority: nullable(integerBetween(1, 4)),
    status: Schema.Literals(["backlog", "queued"]),
  }),
  executeAfterCreate: optional(Schema.Boolean),
  status: Schema.Literals(["pending", "accepted"]),
  acceptedAt: nullable(isoDateTime),
  resultRunId: nullable(uuidString),
});

export const mobileIssueExecutionProposalSchema = strict(mutableStruct({
  id: uuidString,
  type: Schema.Literal("request_issue_execute"),
  status: Schema.Literals(["pending", "accepted"]),
  projectId: uuidString,
  runId: uuidString,
  title: Schema.Trim.check(Schema.isLengthBetween(1, 300)),
  createdAt: isoDateTime,
  acceptedAt: nullable(isoDateTime),
  requestedProvider: nullable(mobileProviderSchema),
  requestedModel: nullable(Schema.String),
  requestedEffort: nullable(mobileEffortSchema),
  requestedWorkerId: nullable(Schema.String),
  delegatedByAgentId: nullable(uuidString),
  delegatedByAgentName: nullable(Schema.String),
}));

export const mobileAgentSkillExecutionProposalSchema = strict(mutableStruct({
  id: uuidString,
  type: Schema.Literal("request_agent_skill_execute"),
  status: Schema.Literals(["pending", "accepted"]),
  projectId: uuidString,
  agentId: uuidString,
  agentName: Schema.Trim.check(Schema.isLengthBetween(1, 100)),
  skillId: uuidString,
  skillName: Schema.Trim.check(Schema.isLengthBetween(1, 100)),
  provider: mobileProviderSchema,
  model: nullable(Schema.String),
  effort: nullable(mobileEffortSchema),
  request: Schema.Trim.check(Schema.isLengthBetween(1, 10_000)),
  delegatedByAgentId: nullable(uuidString),
  delegatedByAgentName: nullable(Schema.String),
  requestedWorkerId: nullable(Schema.String),
  requestedWorkerLabel: nullable(Schema.String),
  resultSessionId: nullable(Schema.String),
  createdAt: isoDateTime,
  acceptedAt: nullable(isoDateTime),
})).check(Schema.makeFilter((proposal) => {
  const hasAcceptedFields = proposal.requestedWorkerId !== null &&
    proposal.requestedWorkerLabel !== null &&
    proposal.resultSessionId !== null && proposal.acceptedAt !== null;
  return (proposal.status === "accepted") === hasAcceptedFields &&
      !(proposal.status === "pending" && (
        proposal.requestedWorkerId !== null ||
        proposal.requestedWorkerLabel !== null ||
        proposal.resultSessionId !== null || proposal.acceptedAt !== null
      ))
    ? undefined
    : "Agent Skill execution approval fields do not match status";
}));

export const mobileIssueProposedActionSchema = Schema.Union([
  mobileIssueReworkProposalSchema,
  mobileIssueUpdateProposalSchema,
  mobileIssueCreateProposalSchema,
]);

const mobileAgentReplySchema = mutableStruct({
  id: uuidString,
  triggerMessageId: uuidString,
  parentMessageId: uuidString,
  agentId: optionalNullable(uuidString),
  agentName: optionalNullable(Schema.String),
  status: Schema.Literals(["queued", "running", "completed", "failed"]),
  attempts: nonNegativeInteger,
  error: nullable(Schema.String),
});

export const mobileIssueMessageSchema = mutableStruct({
  id: uuidString,
  runId: uuidString,
  parentMessageId: nullable(uuidString),
  body: Schema.String,
  attachments: defaultedWith(
    mutableArray(mobileIssueAttachmentSchema),
    () => [],
  ),
  author: mobileMessageAuthorSchema,
  replyCount: nonNegativeInteger,
  proposedAction: optionalNullable(mobileIssueProposedActionSchema),
  executionProposal: optionalNullable(mobileIssueExecutionProposalSchema),
  skillExecutionProposal: optionalNullable(
    mobileAgentSkillExecutionProposalSchema,
  ),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const mobileIssueMessagesResponseSchema = mutableStruct({
  messages: mutableArray(mobileIssueMessageSchema),
  agentReplies: defaultedWith(
    mutableArray(Schema.suspend(() => mobileAgentReplySchema)),
    () => [],
  ),
});

/**
 * A channel's `defaultProjectId` is also how Home groups it: null means the
 * channel belongs to the whole organization rather than to one project.
 */
export const mobileChannelSummarySchema = mutableStruct({
  id: uuidString,
  organizationId: uuidString,
  slug: Schema.String,
  name: Schema.String,
  topic: nullable(Schema.String),
  visibility: Schema.Literals(["public", "private"]),
  defaultProjectId: nullable(uuidString),
  archivedAt: nullable(isoDateTime),
  memberCount: nonNegativeInteger,
  agentCount: nonNegativeInteger,
  createdByUserId: optionalNullable(Schema.String),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  lastMessageAt: optionalNullable(isoDateTime),
  lastReadAt: optionalNullable(isoDateTime),
  hasUnread: optional(Schema.Boolean),
});

export const mobileChannelIssueProposalPayloadSchema = strict(mutableStruct({
  issue: strict(mutableStruct({
    title: Schema.Trim.check(Schema.isLengthBetween(1, 300)),
    description: nullable(
      Schema.Trim.check(Schema.isMaxLength(100_000)),
    ),
    priority: nullable(integerBetween(1, 4)),
    status: Schema.Literals(["backlog", "queued"]),
  })),
  executeAfterCreate: defaulted(Schema.Boolean, false),
}));

const mobileChannelProposalBaseFields = {
  id: uuidString,
  status: Schema.Literals(["pending", "accepted"]),
  projectId: nullable(uuidString),
  resultRunId: nullable(uuidString),
} as const;

const mobileChannelMessageAuthorSchema = Schema.Union([
  mutableStruct({
    type: Schema.Literal("user"),
    id: Schema.String,
    name: Schema.String,
    email: Schema.String,
    image: nullable(Schema.String),
  }),
  mutableStruct({
    type: Schema.Literal("agent"),
    id: nullable(uuidString),
    name: Schema.String,
    provider: nullable(Schema.String),
    image: nullable(Schema.String),
  }),
  mutableStruct({
    type: Schema.Literal("webhook"),
    id: nullable(uuidString),
    name: Schema.String,
  }),
]);

const mobileChannelProposalSchema = Schema.Union([
  mutableStruct({
    ...mobileChannelProposalBaseFields,
    actionType: Schema.Literal("request_issue_create"),
    payload: mobileChannelIssueProposalPayloadSchema,
  }),
  // Retain decode compatibility for the never-produced legacy DB action.
  mutableStruct({
    ...mobileChannelProposalBaseFields,
    actionType: Schema.Literal("request_plan_document"),
    payload: Schema.Unknown,
  }),
]);

export const mobileChannelMessageSchema = mutableStruct({
  id: uuidString,
  channelId: uuidString,
  parentMessageId: nullable(uuidString),
  body: Schema.String,
  author: mobileChannelMessageAuthorSchema,
  mentionedUserIds: defaultedWith(mutableArray(Schema.String), () => []),
  mentionedAgentIds: defaultedWith(mutableArray(uuidString), () => []),
  attachments: defaultedWith(
    mutableArray(mobileIssueAttachmentSchema),
    () => [],
  ),
  reactions: defaultedWith(
    mutableArray(mutableStruct({
      emoji: Schema.String.check(Schema.isLengthBetween(1, 32)),
      count: positiveInteger,
      userIds: mutableArray(Schema.String).check(Schema.isMinLength(1)),
    })),
    () => [],
  ),
  replyCount: nonNegativeInteger,
  lastReplyAt: nullable(isoDateTime),
  document: nullable(mutableStruct({
    messageId: uuidString,
    title: Schema.String,
    projectId: nullable(uuidString),
  })),
  proposal: nullable(mobileChannelProposalSchema),
  executionProposal: optionalNullable(mobileIssueExecutionProposalSchema),
  skillExecutionProposal: optionalNullable(
    mobileAgentSkillExecutionProposalSchema,
  ),
  subscribers: optional(mutableArray(mobileIssueSubscriberSchema)),
  createdAt: isoDateTime,
  deletedAt: optionalNullable(isoDateTime),
});

export const mobileChannelsResponseSchema = mutableStruct({
  channels: mutableArray(mobileChannelSummarySchema),
  cursor: nonNegativeInteger,
});

export const mobileChannelAgentReplySchema = mutableStruct({
  id: uuidString,
  agentId: uuidString,
  channelId: uuidString,
  triggerMessageId: uuidString,
  parentMessageId: uuidString,
  replyMessageId: uuidString,
  status: Schema.Literals(["queued", "running", "completed", "failed"]),
  attempts: nonNegativeInteger,
  error: nullable(Schema.String),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const mobileChannelDetailResponseSchema = mutableStruct({
  channel: mobileChannelSummarySchema,
  members: mutableArray(mutableStruct({
    userId: Schema.String,
    name: Schema.String,
    email: Schema.String,
    image: nullable(Schema.String),
    role: Schema.Literals(["owner", "member"]),
    createdAt: isoDateTime,
  })),
  agents: mutableArray(mutableStruct({
    agentId: uuidString,
    name: Schema.String,
    avatar: nullable(Schema.String),
    provider: mobileProviderSchema,
    model: nullable(Schema.String),
    projectId: nullable(uuidString),
    description: defaulted(Schema.String, ""),
    responsibility: Schema.String,
    createdAt: isoDateTime,
  })),
  messages: mutableArray(mobileChannelMessageSchema),
  agentReplies: defaultedWith(
    mutableArray(Schema.suspend(() => mobileChannelAgentReplySchema)),
    () => [],
  ),
  nextCursor: nullable(uuidString),
});

export const mobileChannelMessagesResponseSchema = mutableStruct({
  messages: mutableArray(mobileChannelMessageSchema),
  nextCursor: nullable(uuidString),
});

export const mobileCreateChannelMessageRequestSchema = mutableStruct({
  body: nonEmptyString,
  clientMessageId: optional(uuidString),
  parentMessageId: defaulted(nullable(uuidString), null),
  mentionedUserIds: defaultedWith(mutableArray(Schema.String), () => []),
  mentionedAgentIds: defaultedWith(mutableArray(uuidString), () => []),
});

export const mobileToggleChannelMessageReactionRequestSchema = mutableStruct({
  emoji: Schema.Trim.check(Schema.isLengthBetween(1, 32)),
});

export const mobileToggleChannelMessageReactionResponseSchema = mutableStruct({
  message: mobileChannelMessageSchema,
});

export const mobileDeleteChannelMessageResponseSchema = mutableStruct({
  deleted: Schema.Boolean,
  message: nullable(mobileChannelMessageSchema),
  parentMessage: nullable(mobileChannelMessageSchema),
});

export const mobileChannelThreadSubscriptionResponseSchema = mutableStruct({
  rootMessageId: uuidString,
  subscribers: mutableArray(mobileIssueSubscriberSchema),
});

export const mobileCreateChannelMessageResponseSchema = mutableStruct({
  message: mobileChannelMessageSchema,
  agentReplies: mutableArray(mobileChannelAgentReplySchema),
});

export const mobileChannelDeltaResponseSchema = mutableStruct({
  cursor: nonNegativeInteger,
  hasMore: Schema.Boolean,
  channels: mutableArray(mobileChannelSummarySchema),
  removedChannelIds: mutableArray(uuidString),
  messages: mutableArray(mobileChannelMessageSchema),
  removedMessageIds: mutableArray(uuidString),
  agentReplies: mutableArray(mobileChannelAgentReplySchema),
});

export const mobileAcceptChannelProposalRequestSchema = strict(mutableStruct({
  projectId: nullable(uuidString),
}));

export const mobileAcceptChannelProposalResponseSchema = mutableStruct({
  outcome: Schema.Literals(["accepted", "already_accepted"]),
  projectId: uuidString,
  resultRunId: uuidString,
  executionProposal: optionalNullable(mobileIssueExecutionProposalSchema),
});

export const mobileIssueExecutionApprovalRequestSchema = strict(mutableStruct({
  provider: mobileProviderSchema,
  model: nullable(Schema.String),
  effort: nullable(mobileEffortSchema),
  workerId: nullable(Schema.String),
}));

export const mobileAgentSkillExecutionApprovalRequestSchema = strict(
  mutableStruct({
    workerId: Schema.String.check(
      Schema.isLengthBetween(1, 128),
      Schema.makeFilter((workerId) =>
        workerId === workerId.trim() ||
        "workerId cannot contain leading or trailing whitespace"
      ),
    ),
  }),
);

export const mobileRunEvidenceResponseSchema = mutableStruct({
  evidence: mutableArray(mutableStruct({
    key: Schema.String,
    attempt: positiveInteger,
    revision: positiveInteger,
    stage: Schema.String,
    type: Schema.String,
    status: Schema.Literals(["pending", "passed", "failed", "skipped"]),
    detail: nullable(Schema.String),
    url: nullable(urlString),
    actor: Schema.String,
    observedAt: isoDateTime,
    images: optional(mutableArray(mutableStruct({
      id: uuidString,
      filename: Schema.String,
      contentType: Schema.String,
      byteSize: nonNegativeInteger,
      url: Schema.String,
    }))),
    canonical: Schema.Boolean,
  })),
});

export const mobileDashboardCursorExpiredSchema = mutableStruct({
  code: Schema.Literal("dashboard_cursor_expired"),
  message: Schema.String,
});

const mobilePlacementStatusSchema = Schema.Literals([
  "backlog",
  "queued",
  "running",
  "blocked",
  "failed",
  "completed",
  "cancelled",
]);

const requestIdFields = { requestId: uuidString } as const;

const mobileIssueTitleSchema = Schema.Trim.check(
  Schema.isLengthBetween(1, issueTitleAbsoluteMaxLength),
  Schema.makeFilter((title) => issueTitleOverLimitMessage(title) ?? undefined),
);

const mobileIssueWriteFields = {
  title: mobileIssueTitleSchema,
  description: nullable(
    Schema.String.check(Schema.isMaxLength(100_000)),
  ),
  priority: nullable(integerBetween(1, 4)),
  assigneeUserId: nullable(Schema.String),
  status: Schema.Literals(["backlog", "queued"]),
  preferredProvider: optionalNullable(mobileProviderSchema),
  preferredModel: optionalNullable(Schema.String),
  preferredEffort: optionalNullable(mobileEffortSchema),
  fullAuto: defaulted(Schema.Boolean, false),
} as const;

export const mobileCreateIssueRequestSchema = strict(
  mutableStruct(mobileIssueWriteFields),
).check(Schema.makeFilter((input) => {
  const issues: Array<string> = [];
  if (input.preferredModel && !input.preferredProvider) {
    issues.push("A provider is required for a model preference");
  }
  if (input.preferredEffort && !input.preferredProvider) {
    issues.push("A provider is required for an effort preference");
  }
  if (input.preferredEffort && !input.preferredModel) {
    issues.push("A model is required for an effort preference");
  }
  return issues;
}));

export const mobileCreateIssueResponseSchema = mutableStruct({
  runId: uuidString,
  sourceKey: Schema.String,
  stage: Schema.Literal("queued"),
  status: Schema.Literals(["backlog", "queued"]),
  assigneeUserId: nullable(Schema.String),
  createdByUserId: Schema.String,
  attachments: mutableArray(mobileIssueAttachmentSchema),
});

export const mobileUpdateIssueRequestSchema = strict(mutableStruct({
  title: mobileIssueTitleSchema,
  description: nullable(
    Schema.String.check(Schema.isMaxLength(100_000)),
  ),
  priority: nullable(integerBetween(1, 4)),
  assigneeUserId: nullable(Schema.String),
}));

export const mobileUpdateIssueResponseSchema = mutableStruct({
  runId: uuidString,
  title: Schema.String,
  description: nullable(Schema.String),
  priority: nullable(integerBetween(1, 4)),
  assigneeUserId: nullable(Schema.String),
});

const mobilePreferencesFields = {
  provider: nullable(mobileProviderSchema),
  model: nullable(Schema.String),
  effort: nullable(mobileEffortSchema),
} as const;

export const mobilePreferencesSchema = strict(
  mutableStruct(mobilePreferencesFields),
);

export const mobilePreferencesResponseSchema = strict(mutableStruct({
  ...mobilePreferencesFields,
  runId: uuidString,
}));

export const mobileDependencyResponseSchema = mutableStruct({
  prerequisiteRunId: uuidString,
  dependentRunId: uuidString,
  outcome: Schema.Literals(["created", "already_exists"]),
});

export const mobileMoveRunRequestSchema = mutableStruct({
  ...requestIdFields,
  status: mobilePlacementStatusSchema,
  workflowStage: nullable(Schema.String),
});

export const mobileMoveRunResponseSchema = mutableStruct({
  runId: uuidString,
  outcome: Schema.Literals(["moved", "unchanged", "already_moved"]),
  status: mobilePlacementStatusSchema,
  workflowStage: nullable(Schema.String),
});

export const mobileRecoveryRequestSchema = mutableStruct({
  ...requestIdFields,
  reason: nullable(Schema.String),
});

export const mobileRecoveryResponseSchema = mutableStruct({
  runId: uuidString,
  outcome: Schema.String,
  attempt: positiveInteger,
  stage: Schema.Literals(["queued", "cancelled"]),
});

export const mobileResumeRequestSchema = mutableStruct({
  ...requestIdFields,
  checkpointKey: nonEmptyString,
  attempt: positiveInteger,
  revision: positiveInteger,
});

export const mobileResumeResponseSchema = mutableStruct({
  runId: uuidString,
  outcome: Schema.Literals([
    "approved",
    "already_approved",
    "resumed",
    "already_resumed",
  ]),
  workflowStage: nullable(Schema.String),
  startStage: nullable(Schema.String),
  checkpointKey: nullable(Schema.String),
  attempt: nullable(positiveInteger),
  revision: nullable(positiveInteger),
  terminalReviewOnly: Schema.Boolean,
});

export const mobileDispatchRequestSchema = mutableStruct({
  ...requestIdFields,
  provider: mobileProviderSchema,
  model: nullable(Schema.String),
  effort: nullable(mobileEffortSchema),
  persistPreferences: Schema.Boolean,
  workerId: nullable(Schema.String),
});

export const mobileDispatchResponseSchema = mutableStruct({
  runId: uuidString,
  agentId: nullable(uuidString),
  provider: mobileProviderSchema,
  model: nullable(Schema.String),
  effort: nullable(mobileEffortSchema),
  requestedWorkerId: nullable(Schema.String),
  requestedByUserId: Schema.String,
  dispatchMode: Schema.Literals(["any", "specific"]),
  dispatchedAt: isoDateTime,
  outcome: Schema.Literals(["dispatched", "already_dispatched"]),
});

export const mobileIssueExecutionApprovalResponseSchema = strict(mutableStruct({
  proposal: mobileIssueExecutionProposalSchema,
  outcome: Schema.Literals(["accepted", "already_accepted"]),
  projectId: uuidString,
  runId: uuidString,
  dispatch: mobileDispatchResponseSchema,
}));

export const mobileCreateMessageRequestSchema = strict(mutableStruct({
  body: Schema.Trim.check(Schema.isLengthBetween(1, 10_000)),
  clientMessageId: optional(uuidString),
  parentMessageId: nullable(uuidString),
  mentionedUserIds: mutableArray(Schema.String),
  mentionedAgentIds: defaultedWith(mutableArray(uuidString), () => []),
  agentConversationId: nullable(Schema.String),
}));

export const mobileCreateMessageResponseSchema = mutableStruct({
  message: mobileIssueMessageSchema,
  agentReply: nullable(mobileAgentReplySchema),
  agentReplies: defaultedWith(mutableArray(mobileAgentReplySchema), () => []),
});

export const mobileAgentReplyResponseSchema = mutableStruct({
  agentReply: mobileAgentReplySchema,
  message: nullable(mobileIssueMessageSchema),
  agentReplies: defaultedWith(mutableArray(mobileAgentReplySchema), () => []),
  messages: defaultedWith(mutableArray(mobileIssueMessageSchema), () => []),
});

export const mobileAcceptIssueReworkProposalResponseSchema = mutableStruct({
  proposal: mobileIssueReworkProposalSchema,
  outcome: Schema.Literals(["accepted", "already_accepted"]),
  attempt: positiveInteger,
  revision: positiveInteger,
  workflowStage: nonEmptyString,
});

export const mobileAcceptIssueActionProposalResponseSchema = mutableStruct({
  proposal: Schema.Union([
    mobileIssueUpdateProposalSchema,
    mobileIssueCreateProposalSchema,
  ]),
  outcome: Schema.Literals(["accepted", "already_accepted"]),
  resultRunId: nullable(uuidString),
  executionProposal: optionalNullable(mobileIssueExecutionProposalSchema),
});

export const mobileProjectAgentSkillSchema = mutableStruct({
  id: uuidString,
  agentId: uuidString,
  name: Schema.String,
  instructions: Schema.String,
  provider: mobileProviderSchema,
  model: nullable(Schema.String),
  effort: nullable(mobileEffortSchema),
  kind: Schema.Literals(["issue_processing", "custom"]),
  position: nonNegativeInteger,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const mobileProjectAgentSchema = mutableStruct({
  id: uuidString,
  projectId: uuidString,
  name: Schema.String,
  avatar: nullable(Schema.String),
  codexPet: optionalNullable(mutableStruct({
    slug: Schema.String,
    name: Schema.String,
    author: Schema.String,
    license: Schema.String,
    spriteVersion: Schema.Int,
    spriteSheetUrl: optionalNullable(Schema.String),
  })),
  provider: mobileProviderSchema,
  model: nullable(Schema.String),
  description: defaulted(Schema.String, ""),
  responsibility: Schema.String,
  skill: Schema.String,
  skills: mutableArray(mobileProjectAgentSkillSchema),
  calendarColor: Schema.String,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const mobileProjectAgentsResponseSchema = mutableStruct({
  agents: mutableArray(mobileProjectAgentSchema),
});

const mobileProjectAgentSessionIssueSchema = mutableStruct({
  runId: Schema.String,
  runNumber: Schema.Int,
  sourceKey: Schema.String,
  title: Schema.String,
  outcome: Schema.Literals([
    "pending",
    "completed",
    "blocked",
    "failed",
    "skipped",
  ]),
  summary: nullable(Schema.String),
});

const mobileProjectAgentSessionEventSchema = mutableStruct({
  id: Schema.String,
  type: Schema.Literals([
    "started",
    "completed",
    "failed",
    "skipped",
    "interrupted",
    "stopped",
  ]),
  occurredAt: Schema.String,
});

export const mobileProjectAgentSessionSchema = mutableStruct({
  id: Schema.String,
  projectId: uuidString,
  dispatchGroupId: optional(Schema.String),
  agentId: optionalNullable(uuidString),
  agentName: optionalNullable(Schema.String),
  skillId: optionalNullable(uuidString),
  sessionType: optional(Schema.Literals(["task", "dispatch"])),
  trigger: optionalNullable(Schema.Literals(["manual", "scheduled"])),
  scheduleId: optionalNullable(Schema.String),
  scheduleRunId: optionalNullable(Schema.String),
  parentSessionId: optionalNullable(Schema.String),
  request: optionalNullable(Schema.String),
  status: Schema.Literals([
    "running",
    "completed",
    "failed",
    "skipped",
    "interrupted",
  ]),
  issues: mutableArray(mobileProjectAgentSessionIssueSchema),
  startedAt: Schema.String,
  completedAt: nullable(Schema.String),
  conversationId: optionalNullable(Schema.String),
  workspaceRoot: optional(Schema.Null),
  requestedWorkerId: optionalNullable(Schema.String),
  workerId: optionalNullable(Schema.String),
  requestedByUserId: optionalNullable(Schema.String),
  summary: optionalNullable(Schema.String),
  error: optionalNullable(Schema.String),
  events: optional(mutableArray(mobileProjectAgentSessionEventSchema)),
  dispatchEvents: optional(mutableArray(Schema.Unknown)),
  workers: optional(mutableArray(Schema.Unknown)),
  updatedAt: optional(Schema.String),
});

export const mobileProjectAgentSessionsResponseSchema = mutableStruct({
  sessions: mutableArray(mobileProjectAgentSessionSchema),
});

export const mobileProjectAgentTaskRequestSchema = mutableStruct({
  agentId: uuidString,
  skillId: uuidString,
  request: Schema.Trim.check(Schema.isLengthBetween(1, 50_000)),
  workerId: Schema.Trim.check(Schema.isLengthBetween(1, 128)),
  requestId: uuidString,
});

export const mobileProjectAgentTaskResponseSchema = mutableStruct({
  session: mobileProjectAgentSessionSchema,
});

export const mobileAgentSkillExecutionApprovalResponseSchema = strict(
  mutableStruct({
    outcome: Schema.Literals(["accepted", "already_accepted"]),
    proposal: mobileAgentSkillExecutionProposalSchema,
    projectId: uuidString,
    session: mobileProjectAgentSessionSchema,
  }),
).check(Schema.makeFilter((response) => {
  const proposal = response.proposal;
  const session = response.session;
  return proposal.status === "accepted" &&
      proposal.resultSessionId !== null &&
      proposal.requestedWorkerId !== null &&
      proposal.requestedWorkerLabel !== null &&
      proposal.acceptedAt !== null &&
      response.projectId === proposal.projectId &&
      session.id === proposal.resultSessionId &&
      session.projectId === proposal.projectId &&
      session.agentId === proposal.agentId &&
      session.agentName === proposal.agentName &&
      session.skillId === proposal.skillId &&
      session.sessionType === "task" &&
      session.trigger === "manual" &&
      session.request === proposal.request &&
      session.requestedWorkerId === proposal.requestedWorkerId &&
      session.workerId === proposal.requestedWorkerId
    ? undefined
    : "Approved Agent Skill execution response is not canonical";
}));

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
  createIssue: {
    request: mobileCreateIssueRequestSchema,
    response: mobileCreateIssueResponseSchema,
  },
  updateIssue: {
    request: mobileUpdateIssueRequestSchema,
    response: mobileUpdateIssueResponseSchema,
  },
  putIssueSubscription: { response: mobileIssueSubscriptionResponseSchema },
  deleteIssueSubscription: { response: mobileIssueSubscriptionResponseSchema },
  deleteIssue: { response: Schema.Null },
  updateIssuePreferences: {
    request: mobilePreferencesSchema,
    response: mobilePreferencesResponseSchema,
  },
  addIssueDependency: { response: mobileDependencyResponseSchema },
  removeIssueDependency: { response: Schema.Null },
  moveRun: {
    request: mobileMoveRunRequestSchema,
    response: mobileMoveRunResponseSchema,
  },
  retryRun: {
    request: mobileRecoveryRequestSchema,
    response: mobileRecoveryResponseSchema,
  },
  cancelRun: {
    request: mobileRecoveryRequestSchema,
    response: mobileRecoveryResponseSchema,
  },
  resumeRun: {
    request: mobileResumeRequestSchema,
    response: mobileResumeResponseSchema,
  },
  dispatchRun: {
    request: mobileDispatchRequestSchema,
    response: mobileDispatchResponseSchema,
  },
  reassignRun: {
    request: mobileDispatchRequestSchema,
    response: mobileDispatchResponseSchema,
  },
  completeResultReview: { response: mobileResultReviewSchema },
  createIssueMessage: {
    request: mobileCreateMessageRequestSchema,
    response: mobileCreateMessageResponseSchema,
  },
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
  listProjectAgentSessions: {
    response: mobileProjectAgentSessionsResponseSchema,
  },
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
  deleteChannelMessage: {
    response: mobileDeleteChannelMessageResponseSchema,
  },
  toggleChannelMessageReaction: {
    request: mobileToggleChannelMessageReactionRequestSchema,
    response: mobileToggleChannelMessageReactionResponseSchema,
  },
  putChannelThreadSubscription: {
    response: mobileChannelThreadSubscriptionResponseSchema,
  },
  deleteChannelThreadSubscription: {
    response: mobileChannelThreadSubscriptionResponseSchema,
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

export const decodeMobileHealthResponse = Schema.decodeUnknownSync(
  mobileHealthResponseSchema,
  mobileSchemaDecodeOptions,
);
export const decodeMobileCurrentUserResponse = Schema.decodeUnknownSync(
  mobileCurrentUserResponseSchema,
  mobileSchemaDecodeOptions,
);
export const decodeMobileProjectsResponse = Schema.decodeUnknownSync(
  mobileProjectsResponseSchema,
  mobileSchemaDecodeOptions,
);

export const isMobileClientId = Schema.is(mobileClientIdSchema);
