import { create } from "@bufbuild/protobuf";
import { timestampDate, timestampFromDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  IssueDifficulty as ProtoIssueDifficulty,
  NotificationReason as ProtoNotificationReason,
  ProjectRole as ProtoProjectRole,
  RunStatus as ProtoRunStatus,
  StructuredRunResult_Impact,
  StructuredRunResult_Importance,
  StructuredRunResult_Outcome,
  StructuredRunResult_Urgency,
  StructuredRunResultSchema,
  type IssueAttachment as IssueAttachmentMessage,
  type MessageAuthor as MessageAuthorMessage,
  type OrganizationMember as OrganizationMemberMessage,
  type RelatedMessageReference as RelatedMessageReferenceMessage,
  type ResultReview as ResultReviewMessage,
  type StructuredRunResult,
} from "@briar/contracts/gen/briar/app/v1/common_pb";
import { AgentProvider as ProtoAgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import type {
  AgentExecutionMetrics as AgentExecutionMetricsMessage,
} from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import type { StructuredAgentResult } from "../agent-result";
import type {
  AgentExecutionMetrics,
} from "../agent-execution-metrics";
import type { AgentProvider } from "../agent-provider";
import type { IssueDifficulty } from "../issue-difficulty";
import type {
  HuntStatus,
  IssueAttachment,
  IssueMessageAuthor,
  IssueResultReview,
  OrganizationMember,
  Project,
  RelatedMessageReference,
} from "../../types";

export const requiredTimestamp = (value: Timestamp | undefined, field: string): string => {
  if (value === undefined) throw new Error(`${field} is missing`);
  return timestampDate(value).toISOString();
};

export const requiredMessage = <T>(value: T | undefined, field: string): T => {
  if (value === undefined) throw new Error(`${field} is missing`);
  return value;
};

export const optionalTimestamp = (value: Timestamp | undefined): string | null =>
  value === undefined ? null : timestampDate(value).toISOString();

export const safeNumber = (value: bigint, field: string): number => {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${field} is outside JavaScript's safe integer range`);
  }
  return result;
};

export const optionalSafeNumber = (
  value: bigint | undefined,
  field: string,
): number | null => value === undefined ? null : safeNumber(value, field);

export const agentExecutionMetricsFromProto = (
  value: AgentExecutionMetricsMessage | undefined,
): AgentExecutionMetrics | null => value === undefined
  ? null
  : {
      inputTokens: optionalSafeNumber(
        value.inputTokens,
        "executionMetrics.inputTokens",
      ),
      outputTokens: optionalSafeNumber(
        value.outputTokens,
        "executionMetrics.outputTokens",
      ),
      cacheReadTokens: optionalSafeNumber(
        value.cacheReadTokens,
        "executionMetrics.cacheReadTokens",
      ),
      cacheWriteTokens: optionalSafeNumber(
        value.cacheWriteTokens,
        "executionMetrics.cacheWriteTokens",
      ),
      reasoningOutputTokens: optionalSafeNumber(
        value.reasoningOutputTokens,
        "executionMetrics.reasoningOutputTokens",
      ),
      totalTokens: optionalSafeNumber(
        value.totalTokens,
        "executionMetrics.totalTokens",
      ),
      durationMs: safeNumber(value.durationMs, "executionMetrics.durationMs"),
    };

export const agentProviderFromProto = (value: ProtoAgentProvider): AgentProvider => {
  switch (value) {
    case ProtoAgentProvider.CODEX:
      return "codex";
    case ProtoAgentProvider.CLAUDE:
      return "claude";
    case ProtoAgentProvider.CURSOR:
      return "cursor";
    case ProtoAgentProvider.GROK:
      return "grok";
    case ProtoAgentProvider.AGY:
      return "agy";
    case ProtoAgentProvider.OPENCODE:
      return "opencode";
    case ProtoAgentProvider.OPENROUTER:
      return "openrouter";
    case ProtoAgentProvider.UNSPECIFIED:
      throw new Error("Agent provider is missing");
    default:
      throw new Error(`Unknown agent provider: ${value}`);
  }
};

export const agentProviderToProto = (value: AgentProvider): ProtoAgentProvider => {
  switch (value) {
    case "codex":
      return ProtoAgentProvider.CODEX;
    case "claude":
      return ProtoAgentProvider.CLAUDE;
    case "cursor":
      return ProtoAgentProvider.CURSOR;
    case "grok":
      return ProtoAgentProvider.GROK;
    case "agy":
      return ProtoAgentProvider.AGY;
    case "opencode":
      return ProtoAgentProvider.OPENCODE;
    case "openrouter":
      return ProtoAgentProvider.OPENROUTER;
  }
};

export const optionalAgentProviderFromProto = (
  value: ProtoAgentProvider | undefined,
): AgentProvider | null => (value === undefined ? null : agentProviderFromProto(value));

export const projectRoleFromProto = (value: ProtoProjectRole): Project["role"] => {
  switch (value) {
    case ProtoProjectRole.OWNER:
      return "owner";
    case ProtoProjectRole.CO_OWNER:
      return "co-owner";
    case ProtoProjectRole.DEVELOPER:
      return "developer";
    case ProtoProjectRole.EDITOR:
      return "editor";
    case ProtoProjectRole.VIEWER:
      return "viewer";
    case ProtoProjectRole.UNSPECIFIED:
      throw new Error("Project role is missing");
    default:
      throw new Error(`Unknown project role: ${value}`);
  }
};

export const runStatusFromProto = (value: ProtoRunStatus): HuntStatus => {
  switch (value) {
    case ProtoRunStatus.BACKLOG:
      return "backlog";
    case ProtoRunStatus.QUEUED:
      return "queued";
    case ProtoRunStatus.RUNNING:
      return "running";
    case ProtoRunStatus.PAUSED:
      return "paused";
    case ProtoRunStatus.BLOCKED:
      return "blocked";
    case ProtoRunStatus.FAILED:
      return "failed";
    case ProtoRunStatus.COMPLETED:
      return "completed";
    case ProtoRunStatus.CANCELLED:
      return "cancelled";
    case ProtoRunStatus.UNSPECIFIED:
      throw new Error("Run status is missing");
    default:
      throw new Error(`Unknown run status: ${value}`);
  }
};

export const issueDifficultyFromProto = (
  value: ProtoIssueDifficulty | undefined,
): IssueDifficulty | null => {
  switch (value) {
    case undefined:
      return null;
    case ProtoIssueDifficulty.EASY:
      return "easy";
    case ProtoIssueDifficulty.NORMAL:
      return "normal";
    case ProtoIssueDifficulty.HARD:
      return "hard";
    case ProtoIssueDifficulty.UNSPECIFIED:
      throw new Error("Issue difficulty is missing");
    default:
      throw new Error(`Unknown issue difficulty: ${value}`);
  }
};

export const notificationReasonFromProto = (
  value: ProtoNotificationReason,
): "mention" | "thread_reply" | "subscription" => {
  switch (value) {
    case ProtoNotificationReason.MENTION:
      return "mention";
    case ProtoNotificationReason.THREAD_REPLY:
      return "thread_reply";
    case ProtoNotificationReason.SUBSCRIPTION:
      return "subscription";
    case ProtoNotificationReason.UNSPECIFIED:
      throw new Error("Notification reason is missing");
    default:
      throw new Error(`Unknown notification reason: ${value}`);
  }
};

const structuredOutcome = (
  value: StructuredRunResult_Outcome,
): StructuredAgentResult["outcome"] => {
  switch (value) {
    case StructuredRunResult_Outcome.COMPLETED:
      return "completed";
    case StructuredRunResult_Outcome.PARTIAL:
      return "partial";
    case StructuredRunResult_Outcome.BLOCKED:
      return "blocked";
    case StructuredRunResult_Outcome.FAILED:
      return "failed";
    default:
      throw new Error(`Unknown structured result outcome: ${value}`);
  }
};

const structuredImportance = (
  value: StructuredRunResult_Importance,
): StructuredAgentResult["importance"] => {
  switch (value) {
    case StructuredRunResult_Importance.ROUTINE:
      return "routine";
    case StructuredRunResult_Importance.IMPORTANT:
      return "important";
    case StructuredRunResult_Importance.CRITICAL:
      return "critical";
    default:
      throw new Error(`Unknown structured result importance: ${value}`);
  }
};

const structuredUrgency = (
  value: StructuredRunResult_Urgency,
): StructuredAgentResult["urgency"] => {
  switch (value) {
    case StructuredRunResult_Urgency.NORMAL:
      return "normal";
    case StructuredRunResult_Urgency.TIME_SENSITIVE:
      return "time_sensitive";
    case StructuredRunResult_Urgency.IMMEDIATE:
      return "immediate";
    default:
      throw new Error(`Unknown structured result urgency: ${value}`);
  }
};

const structuredImpact = (value: StructuredRunResult_Impact): StructuredAgentResult["impact"] => {
  switch (value) {
    case StructuredRunResult_Impact.ISSUE:
      return "issue";
    case StructuredRunResult_Impact.PROJECT:
      return "project";
    case StructuredRunResult_Impact.ORGANIZATION:
      return "organization";
    default:
      throw new Error(`Unknown structured result impact: ${value}`);
  }
};

export const structuredResultFromProto = (
  value: StructuredRunResult | undefined,
): StructuredAgentResult | null =>
  value === undefined
    ? null
    : {
        summary: value.summary,
        outcome: structuredOutcome(value.outcome),
        importance: structuredImportance(value.importance),
        urgency: structuredUrgency(value.urgency),
        impact: structuredImpact(value.impact),
        humanActionRequired: value.humanActionRequired,
        nextAction: value.nextAction ?? null,
        dueAt: optionalTimestamp(value.dueAt),
      };

const structuredOutcomeToProto = {
  completed: StructuredRunResult_Outcome.COMPLETED,
  partial: StructuredRunResult_Outcome.PARTIAL,
  blocked: StructuredRunResult_Outcome.BLOCKED,
  failed: StructuredRunResult_Outcome.FAILED,
} as const satisfies Record<StructuredAgentResult["outcome"], StructuredRunResult_Outcome>;

const structuredImportanceToProto = {
  routine: StructuredRunResult_Importance.ROUTINE,
  important: StructuredRunResult_Importance.IMPORTANT,
  critical: StructuredRunResult_Importance.CRITICAL,
} as const satisfies Record<StructuredAgentResult["importance"], StructuredRunResult_Importance>;

const structuredUrgencyToProto = {
  normal: StructuredRunResult_Urgency.NORMAL,
  time_sensitive: StructuredRunResult_Urgency.TIME_SENSITIVE,
  immediate: StructuredRunResult_Urgency.IMMEDIATE,
} as const satisfies Record<StructuredAgentResult["urgency"], StructuredRunResult_Urgency>;

const structuredImpactToProto = {
  issue: StructuredRunResult_Impact.ISSUE,
  project: StructuredRunResult_Impact.PROJECT,
  organization: StructuredRunResult_Impact.ORGANIZATION,
} as const satisfies Record<StructuredAgentResult["impact"], StructuredRunResult_Impact>;

export const structuredResultToProto = (value: StructuredAgentResult) =>
  create(StructuredRunResultSchema, {
    summary: value.summary,
    outcome: structuredOutcomeToProto[value.outcome],
    importance: structuredImportanceToProto[value.importance],
    urgency: structuredUrgencyToProto[value.urgency],
    impact: structuredImpactToProto[value.impact],
    humanActionRequired: value.humanActionRequired,
    nextAction: value.nextAction ?? undefined,
    dueAt: value.dueAt ? timestampFromDate(new Date(value.dueAt)) : undefined,
  });

export const issueAttachmentFromProto = (value: IssueAttachmentMessage): IssueAttachment => ({
  id: value.id,
  filename: value.filename,
  contentType: value.contentType,
  byteSize: safeNumber(value.byteSize, "attachment.byteSize"),
  url: value.url,
});

export const relatedMessageFromProto = (
  value: RelatedMessageReferenceMessage,
): RelatedMessageReference => ({
  organizationId: value.organizationId,
  channelId: value.channelId,
  messageId: value.messageId,
  rootMessageId: value.rootMessageId,
});

export const messageAuthorFromProto = (value: MessageAuthorMessage): IssueMessageAuthor => ({
  id: value.id ?? null,
  agentId: value.agentId ?? null,
  name: value.name,
  image: value.image ?? null,
  provider: optionalAgentProviderFromProto(value.provider),
});

export const resultReviewFromProto = (value: ResultReviewMessage): IssueResultReview => ({
  userId: value.userId,
  name: value.name,
  username: value.username ?? null,
  image: value.image ?? null,
  completedAt: requiredTimestamp(value.completedAt, "resultReview.completedAt"),
});

export const organizationMemberFromProto = (
  value: OrganizationMemberMessage,
): OrganizationMember => ({
  userId: value.userId,
  name: value.name,
  email: value.email,
  image: value.image ?? null,
  role: projectRoleFromProto(value.role),
  projectIds: value.projectIds,
  createdAt: requiredTimestamp(value.createdAt, "organizationMember.createdAt"),
});
