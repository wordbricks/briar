import {
  type CreateChannelMessageRequest,
} from "@briar/contracts/gen/briar/app/v1/channel_pb";
import {
  IssueDifficulty,
  RunStatus,
} from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  type CreateIssueMessageRequest,
  type CreateIssueRequest,
  type UpdateIssueRequest,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import {
  WorkflowCheckpoint_Position,
} from "@briar/contracts/gen/briar/types/v1/workflow_pb";
import { channelMessageInputSchema } from "../../src/lib/channels-contract";
import {
  decodeIssueInput,
  decodeIssueMessageInput,
  decodeIssueUpdateInput,
} from "./issue-request-contract";
import { HttpError } from "./http-response";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";

const decodeUuid = decodeRequestSync(UuidString);

export const canonicalAppUuid = (value: string) =>
  decodeUuid(value).toLowerCase();

export const appAgentProviderFromProto = (provider: AgentProvider) => {
  switch (provider) {
    case AgentProvider.CODEX:
      return "codex" as const;
    case AgentProvider.CLAUDE:
      return "claude" as const;
    case AgentProvider.CURSOR:
      return "cursor" as const;
    case AgentProvider.GROK:
      return "grok" as const;
    case AgentProvider.AGY:
      return "agy" as const;
    case AgentProvider.OPENCODE:
      return "opencode" as const;
    case AgentProvider.OPENROUTER:
      return "openrouter" as const;
    case AgentProvider.UNSPECIFIED:
      return undefined;
    default:
      throw new HttpError(400, "Unknown agent provider");
  }
};

export const requiredAppAgentProviderFromProto = (provider: AgentProvider) => {
  const value = appAgentProviderFromProto(provider);
  if (value === undefined) {
    throw new HttpError(400, "Agent provider is required");
  }
  return value;
};

export const appRunStatus = (status: RunStatus) => {
  switch (status) {
    case RunStatus.BACKLOG:
      return "backlog" as const;
    case RunStatus.QUEUED:
      return "queued" as const;
    case RunStatus.RUNNING:
      return "running" as const;
    case RunStatus.PAUSED:
      return "paused" as const;
    case RunStatus.BLOCKED:
      return "blocked" as const;
    case RunStatus.FAILED:
      return "failed" as const;
    case RunStatus.COMPLETED:
      return "completed" as const;
    case RunStatus.CANCELLED:
      return "cancelled" as const;
    case RunStatus.UNSPECIFIED:
      throw new HttpError(400, "Run status is required");
    default:
      throw new HttpError(400, "Unknown run status");
  }
};

export const appIssueDifficulty = (
  difficulty: IssueDifficulty | undefined,
) => {
  switch (difficulty) {
    case IssueDifficulty.EASY:
      return "easy" as const;
    case IssueDifficulty.NORMAL:
      return "normal" as const;
    case IssueDifficulty.HARD:
      return "hard" as const;
    case IssueDifficulty.UNSPECIFIED:
    case undefined:
      return null;
    default:
      throw new HttpError(400, "Unknown issue difficulty");
  }
};

export const appCheckpointPosition = (
  position: WorkflowCheckpoint_Position,
) => {
  switch (position) {
    case WorkflowCheckpoint_Position.BEFORE:
      return "before" as const;
    case WorkflowCheckpoint_Position.AFTER:
      return "after" as const;
    case WorkflowCheckpoint_Position.UNSPECIFIED:
      throw new HttpError(400, "Checkpoint position is required");
    default:
      throw new HttpError(400, "Unknown checkpoint position");
  }
};

export const createIssueApplicationRequest = (
  request: CreateIssueRequest,
) => decodeIssueInput({
  title: request.title,
  description: request.description ?? null,
  priority: request.priority ?? null,
  difficulty: appIssueDifficulty(request.difficulty),
  assigneeUserId: request.assigneeUserId ?? null,
  status: appRunStatus(request.status),
  preferredProvider: request.preferredProvider === undefined
    ? null
    : appAgentProviderFromProto(request.preferredProvider) ?? null,
  preferredModel: request.preferredModel ?? null,
  preferredEffort: request.preferredEffort ?? null,
  fullAuto: request.fullAuto,
  checkpoints: request.checkpoints.map((checkpoint) => ({
    key: checkpoint.key,
    stage: checkpoint.stage,
    position: appCheckpointPosition(checkpoint.position),
  })),
});

export const updateIssueApplicationRequest = (
  request: UpdateIssueRequest,
) => decodeIssueUpdateInput({
  title: request.title,
  description: request.description ?? null,
  priority: request.priority ?? null,
  difficulty: appIssueDifficulty(request.difficulty),
  ...(request.assigneeUpdate.case === "assigneeUserId"
    ? { assigneeUserId: request.assigneeUpdate.value }
    : request.assigneeUpdate.case === "clearAssignee"
    ? { assigneeUserId: null }
    : {}),
});

export const createIssueMessageApplicationRequest = (
  request: CreateIssueMessageRequest,
) => decodeIssueMessageInput({
  clientMessageId: canonicalAppUuid(request.clientMessageId),
  body: request.body,
  parentMessageId: request.parentMessageId
    ? canonicalAppUuid(request.parentMessageId)
    : null,
  mentionedUserIds: request.mentionedUserIds,
  mentionedAgentIds: request.mentionedAgentIds.map(canonicalAppUuid),
  agentConversationId: request.agentConversationId ?? null,
});

export const decodeChannelMessageApplicationInput = decodeRequestSync(
  channelMessageInputSchema,
);

export const createChannelMessageApplicationRequest = (
  request: CreateChannelMessageRequest,
) => decodeChannelMessageApplicationInput({
  clientMessageId: canonicalAppUuid(request.clientMessageId),
  body: request.body,
  parentMessageId: request.parentMessageId ?? null,
  mentionedUserIds: request.mentionedUserIds,
  mentionedAgentIds: request.mentionedAgentIds,
  skillId: request.skillId ?? null,
  preferredDeviceId: request.preferredDeviceId ?? null,
});
