import { createClient } from "@connectrpc/connect";
import {
  IssueChangedField as ProtoIssueChangedField,
  IssueService,
  MoveRunResponse_Outcome as ProtoMoveOutcome,
  ReworkRunResponse_Outcome as ProtoReworkOutcome,
  ResumeRunResponse_Outcome as ProtoResumeOutcome,
  RunEvidence_Status as ProtoRunEvidenceStatus,
  SetIssueDependencyResponse_Outcome as ProtoDependencyOutcome,
  TransferIssueResponse_Outcome as ProtoTransferOutcome,
  UnassignRunResponse_Outcome as ProtoUnassignOutcome,
  type CreateIssueResponse as CreateIssueResponseMessage,
  type IssueAgentReply as IssueAgentReplyMessage,
  type IssueCreateProposal as IssueCreateProposalMessage,
  type IssueMessage as IssueMessageMessage,
  type IssueReworkProposal as IssueReworkProposalMessage,
  type IssueUpdateProposal as IssueUpdateProposalMessage,
  type RunEvidence as RunEvidenceMessage,
  type SyncIssueMessagesResponse as SyncIssueMessagesResponseMessage,
  type ReworkRunResponse as ReworkRunResponseMessage,
  type UnassignRunResponse as UnassignRunResponseMessage,
  type UpdateIssueMessageResponse as UpdateIssueMessageResponseMessage,
  type UpdateIssueResponse as UpdateIssueResponseMessage,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import {
  IssueDifficulty as ProtoIssueDifficulty,
  RunStatus as ProtoRunStatus,
} from "@briar/contracts/gen/briar/app/v1/common_pb";
import type { AutoHuntSession } from "../../hooks/useAutoHuntSessions";
import type {
  AgentSkillExecutionApprovalInput,
  AgentSkillExecutionProposal,
  CreateIssueInput,
  HuntRunPlacement,
  HuntStatus,
  IssueAgentReplyState,
  IssueConversationDelta,
  IssueConversationSnapshot,
  IssueCreateProposal,
  IssueExecutionApprovalInput,
  IssueExecutionPreferences,
  IssueMessage,
  IssueProposedAction,
  IssueResultReview,
  IssueReworkProposal,
  IssueUpdateProposal,
  RunEvidence,
  UpdateIssueInput,
  UpdateIssueResult,
} from "../../types";
import type { AutoHuntWorkflowCheckpoint } from "../auto-hunt-contract";
import type { AgentProvider } from "../agent-provider";
import { request } from "../api/request";
import { validateIssueAttachments } from "../issue-attachments";
import { projectAgentSessionFromMessage } from "./agent";
import {
  activeProposalStatusFromProto,
  agentProviderToProto,
  agentSkillExecutionProposalFromMessage,
  approvalOutcomeFromProto,
  approvalToMessage,
  assertPendingAgentSkillExecutionApproval,
  channelReplyStatusFromProto,
  cursorToProto,
  dispatchFromMessage,
  issueExecutionProposalFromMessage,
  validateAgentSkillExecutionAcceptance,
} from "./channel";
import {
  issueAttachmentFromProto,
  issueDifficultyFromProto,
  messageAuthorFromProto,
  optionalAgentProviderFromProto,
  optionalTimestamp,
  requiredMessage,
  requiredTimestamp,
  resultReviewFromProto,
  runStatusFromProto,
  safeNumber,
} from "./mappers";
import { appCallOptions, appRpc, appTransport } from "./core";
import {
  workflowCheckpointFromProto,
  workflowCheckpointToProto,
} from "./project-configuration-mappers";

const issueClient = appTransport
  ? createClient(IssueService, appTransport)
  : undefined;

const requireIssueClient = () => {
  if (!issueClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return issueClient;
};

const runStatusToProto = (status: HuntStatus): ProtoRunStatus => {
  switch (status) {
    case "backlog":
      return ProtoRunStatus.BACKLOG;
    case "queued":
      return ProtoRunStatus.QUEUED;
    case "running":
      return ProtoRunStatus.RUNNING;
    case "paused":
      return ProtoRunStatus.PAUSED;
    case "blocked":
      return ProtoRunStatus.BLOCKED;
    case "failed":
      return ProtoRunStatus.FAILED;
    case "completed":
      return ProtoRunStatus.COMPLETED;
    case "cancelled":
      return ProtoRunStatus.CANCELLED;
  }
};

const issueDifficultyToProto = (
  difficulty: CreateIssueInput["difficulty"],
): ProtoIssueDifficulty | undefined => {
  switch (difficulty) {
    case "easy":
      return ProtoIssueDifficulty.EASY;
    case "normal":
      return ProtoIssueDifficulty.NORMAL;
    case "hard":
      return ProtoIssueDifficulty.HARD;
    case null:
      return undefined;
  }
};

export const issueMutationTransport = (
  attachments: readonly File[],
): "connect" | "multipart" =>
  attachments.length === 0 ? "connect" : "multipart";

export const createIssueRequestFromInput = (
  projectId: string,
  input: CreateIssueInput,
) => ({
  projectId,
  title: input.title,
  description: input.description ?? undefined,
  priority: input.priority ?? undefined,
  difficulty: issueDifficultyToProto(input.difficulty),
  assigneeUserId: input.assigneeUserId ?? undefined,
  status: runStatusToProto(input.status),
  preferredProvider: input.preferredProvider == null
    ? undefined
    : agentProviderToProto(input.preferredProvider),
  preferredModel: input.preferredModel ?? undefined,
  preferredEffort: input.preferredEffort ?? undefined,
  fullAuto: input.fullAuto ?? false,
  checkpoints: (input.checkpoints ?? []).map(workflowCheckpointToProto),
  attachmentReferences: input.attachmentReferences ?? [],
});

export type CreateIssueResult = {
  runId: string;
  sourceKey: string;
  stage: "queued";
  status: "backlog" | "queued";
  assigneeUserId: string | null;
  createdByUserId: string;
  difficulty: CreateIssueInput["difficulty"];
  attachments: UpdateIssueResult["attachments"];
};

const createIssueResultFromMessage = (
  response: CreateIssueResponseMessage,
): CreateIssueResult => {
  const status = runStatusFromProto(response.status);
  if (status !== "backlog" && status !== "queued") {
    throw new Error(`Unknown created issue status: ${status}`);
  }
  if (response.stage !== "queued") {
    throw new Error(`Unknown created issue stage: ${response.stage}`);
  }
  return {
    runId: response.runId,
    sourceKey: response.sourceKey,
    stage: response.stage,
    status,
    assigneeUserId: response.assigneeUserId ?? null,
    createdByUserId: response.createdByUserId,
    difficulty: issueDifficultyFromProto(response.difficulty),
    attachments: response.attachments.map(issueAttachmentFromProto),
  };
};

const createIssueMultipart = async (
  token: string,
  projectId: string,
  input: CreateIssueInput,
) => {
  const attachmentError = validateIssueAttachments(input.attachments);
  if (attachmentError) throw new Error(attachmentError);
  const form = new FormData();
  form.set("title", input.title);
  form.set("description", input.description ?? "");
  form.set("priority", input.priority === null ? "" : String(input.priority));
  form.set("difficulty", input.difficulty ?? "");
  if (input.assigneeUserId !== undefined) {
    form.set("assigneeUserId", input.assigneeUserId ?? "");
  }
  form.set("status", input.status);
  form.set("preferredProvider", input.preferredProvider ?? "");
  form.set("preferredModel", input.preferredModel ?? "");
  form.set("preferredEffort", input.preferredEffort ?? "");
  form.set("fullAuto", input.fullAuto ? "true" : "false");
  if (input.checkpoints?.length) {
    form.set("checkpoints", JSON.stringify(input.checkpoints));
  }
  if (input.attachmentReferences?.length) {
    form.set(
      "attachmentReferences",
      JSON.stringify(input.attachmentReferences),
    );
  }
  for (const attachment of input.attachments) {
    form.append("attachments", attachment, attachment.name);
  }
  return request<CreateIssueResult>(`/projects/${projectId}/issues`, token, {
    method: "POST",
    body: form,
  });
};

export async function createIssue(
  token: string,
  projectId: string,
  input: CreateIssueInput,
): Promise<CreateIssueResult> {
  if (issueMutationTransport(input.attachments) === "multipart") {
    return createIssueMultipart(token, projectId, input);
  }
  const client = requireIssueClient();
  return appRpc(async () => createIssueResultFromMessage(
    await client.createIssue(
      createIssueRequestFromInput(projectId, input),
      appCallOptions(token),
    ),
  ));
}

export const updateIssueRequestFromInput = (
  projectId: string,
  runId: string,
  input: UpdateIssueInput,
) => ({
  projectId,
  runId,
  title: input.title,
  description: input.description ?? undefined,
  priority: input.priority ?? undefined,
  difficulty: issueDifficultyToProto(input.difficulty),
  assigneeUpdate: input.assigneeUserId === undefined
    ? { case: undefined }
    : input.assigneeUserId === null
    ? { case: "clearAssignee" as const, value: {} }
    : { case: "assigneeUserId" as const, value: input.assigneeUserId },
  attachmentReferences: input.attachmentReferences ?? [],
  keptAttachmentIds: input.keptAttachmentIds === undefined
    ? undefined
    : { values: input.keptAttachmentIds },
});

const updateIssueResultFromMessage = (
  response: UpdateIssueResponseMessage,
): UpdateIssueResult => ({
  runId: response.runId,
  title: response.title,
  description: response.description ?? null,
  priority: response.priority ?? null,
  difficulty: issueDifficultyFromProto(response.difficulty),
  assigneeUserId: response.assigneeUserId ?? null,
  attachments: response.attachments.map(issueAttachmentFromProto),
});

const updateIssueMultipart = async (
  token: string,
  projectId: string,
  runId: string,
  input: UpdateIssueInput,
) => {
  const attachmentError = validateIssueAttachments(input.attachments);
  if (attachmentError) throw new Error(attachmentError);
  const form = new FormData();
  form.set("title", input.title);
  form.set("description", input.description ?? "");
  form.set("priority", input.priority === null ? "" : String(input.priority));
  form.set("difficulty", input.difficulty ?? "");
  if (input.assigneeUserId !== undefined) {
    form.set("assigneeUserId", input.assigneeUserId ?? "");
  }
  if (input.attachmentReferences?.length) {
    form.set(
      "attachmentReferences",
      JSON.stringify(input.attachmentReferences),
    );
  }
  if (input.keptAttachmentIds !== undefined) {
    form.set("keptAttachmentIds", JSON.stringify(input.keptAttachmentIds));
  }
  for (const attachment of input.attachments) {
    form.append("attachments", attachment, attachment.name);
  }
  return request<UpdateIssueResult>(
    `/projects/${projectId}/runs/${runId}`,
    token,
    { method: "PATCH", body: form },
  );
};

export async function updateIssue(
  token: string,
  projectId: string,
  runId: string,
  input: UpdateIssueInput,
) {
  if (issueMutationTransport(input.attachments) === "multipart") {
    return updateIssueMultipart(token, projectId, runId, input);
  }
  const client = requireIssueClient();
  return appRpc(async () => updateIssueResultFromMessage(
    await client.updateIssue(
      updateIssueRequestFromInput(projectId, runId, input),
      appCallOptions(token),
    ),
  ));
}

export async function deleteIssue(
  token: string,
  projectId: string,
  runId: string,
) {
  const client = requireIssueClient();
  const response = await appRpc(() => client.deleteIssue(
    { projectId, runId },
    appCallOptions(token),
  ));
  if (!response.deleted) throw new Error("Issue deletion was not confirmed");
}

export type TransferIssueResult = {
  runId: string;
  sourceProjectId: string;
  targetProjectId: string;
  outcome: "transferred" | "already_transferred";
};

export async function transferIssue(
  token: string,
  projectId: string,
  runId: string,
  targetProjectId: string,
): Promise<TransferIssueResult> {
  const client = requireIssueClient();
  return appRpc(async () => {
    const response = await client.transferIssue(
      { projectId, runId, targetProjectId },
      appCallOptions(token),
    );
    const outcome = (() => {
      switch (response.outcome) {
        case ProtoTransferOutcome.TRANSFERRED:
          return "transferred" as const;
        case ProtoTransferOutcome.ALREADY_TRANSFERRED:
          return "already_transferred" as const;
        default:
          throw new Error(`Unknown issue transfer outcome: ${response.outcome}`);
      }
    })();
    return {
      runId: response.runId,
      sourceProjectId: response.sourceProjectId,
      targetProjectId: response.targetProjectId,
      outcome,
    };
  });
}

export async function updateIssueSubscription(
  token: string,
  projectId: string,
  runId: string,
  subscribed: boolean,
) {
  const client = requireIssueClient();
  return appRpc(async () => {
    const response = await client.setIssueSubscription(
      { projectId, runId, subscribed },
      appCallOptions(token),
    );
    return {
      runId: response.runId,
      subscribers: response.subscribers.map((subscriber) => ({
        userId: subscriber.userId,
        subscribedAt: requiredTimestamp(
          subscriber.subscribedAt,
          "issueSubscriber.subscribedAt",
        ),
      })),
    };
  });
}

export async function updateIssueExecutionPreferences(
  token: string,
  projectId: string,
  runId: string,
  input: IssueExecutionPreferences,
) {
  const client = requireIssueClient();
  return appRpc(async () => {
    const response = await client.updateIssuePreferences(
      {
        projectId,
        runId,
        provider: input.provider === null
          ? undefined
          : agentProviderToProto(input.provider),
        model: input.model ?? undefined,
        effort: input.effort ?? undefined,
      },
      appCallOptions(token),
    );
    return {
      runId: response.runId,
      provider: optionalAgentProviderFromProto(response.provider),
      model: response.model ?? null,
      effort: response.effort ?? null,
    };
  });
}

export async function updateIssueCheckpoints(
  token: string,
  projectId: string,
  runId: string,
  checkpoints: AutoHuntWorkflowCheckpoint[],
) {
  const client = requireIssueClient();
  return appRpc(async () => {
    const response = await client.updateIssueCheckpoints(
      {
        projectId,
        runId,
        checkpoints: checkpoints.map(workflowCheckpointToProto),
      },
      appCallOptions(token),
    );
    return {
      runId: response.runId,
      checkpoints: response.checkpoints.map(workflowCheckpointFromProto),
    };
  });
}

const setIssueDependency = async (
  token: string,
  projectId: string,
  dependentRunId: string,
  prerequisiteRunId: string,
  enabled: boolean,
) => {
  const client = requireIssueClient();
  return appRpc(() => client.setIssueDependency(
    {
      projectId,
      runId: dependentRunId,
      prerequisiteRunId,
      enabled,
    },
    appCallOptions(token),
  ));
};

export async function addIssueDependency(
  token: string,
  projectId: string,
  dependentRunId: string,
  prerequisiteRunId: string,
) {
  const response = await setIssueDependency(
    token,
    projectId,
    dependentRunId,
    prerequisiteRunId,
    true,
  );
  const outcome = (() => {
    switch (response.outcome) {
      case ProtoDependencyOutcome.CREATED:
        return "created" as const;
      case ProtoDependencyOutcome.ALREADY_EXISTS:
        return "already_exists" as const;
      default:
        throw new Error(`Unknown added issue dependency outcome: ${response.outcome}`);
    }
  })();
  return {
    prerequisiteRunId: response.prerequisiteRunId,
    dependentRunId: response.dependentRunId,
    outcome,
  };
}

export async function removeIssueDependency(
  token: string,
  projectId: string,
  dependentRunId: string,
  prerequisiteRunId: string,
) {
  const response = await setIssueDependency(
    token,
    projectId,
    dependentRunId,
    prerequisiteRunId,
    false,
  );
  if (
    response.outcome !== ProtoDependencyOutcome.REMOVED &&
    response.outcome !== ProtoDependencyOutcome.ALREADY_REMOVED
  ) {
    throw new Error(`Unknown removed issue dependency outcome: ${response.outcome}`);
  }
}

export type HuntMoveResult = {
  runId: string;
  outcome: "moved" | "unchanged" | "already_moved";
  status: HuntRunPlacement["status"];
  workflowStage: string | null;
};

export async function moveHuntRun(
  token: string,
  projectId: string,
  runId: string,
  placement: HuntRunPlacement,
): Promise<HuntMoveResult> {
  const client = requireIssueClient();
  return appRpc(async () => {
    const response = await client.moveRun(
      {
        projectId,
        runId,
        requestId: crypto.randomUUID(),
        status: runStatusToProto(placement.status),
        workflowStage: placement.workflowStage ?? undefined,
      },
      appCallOptions(token),
    );
    const outcome = (() => {
      switch (response.outcome) {
        case ProtoMoveOutcome.MOVED:
          return "moved" as const;
        case ProtoMoveOutcome.UNCHANGED:
          return "unchanged" as const;
        case ProtoMoveOutcome.ALREADY_MOVED:
          return "already_moved" as const;
        default:
          throw new Error(`Unknown move outcome: ${response.outcome}`);
      }
    })();
    const status = runStatusFromProto(response.status);
    if (status === "paused") {
      throw new Error("Move returned unsupported paused status");
    }
    return {
      runId: response.runId,
      outcome,
      status,
      workflowStage: response.workflowStage ?? null,
    };
  });
}

export type HuntRecoveryResult = {
  runId: string;
  outcome: "retried" | "cancelled" | "already_retried" | "already_cancelled";
  attempt: number;
  stage: "queued" | "cancelled";
};

const recoverHuntRun = async (
  token: string,
  projectId: string,
  runId: string,
  action: "retry" | "cancel",
  reason: string | null,
): Promise<HuntRecoveryResult> => {
  const client = requireIssueClient();
  return appRpc(async () => {
    const input = {
      projectId,
      runId,
      requestId: crypto.randomUUID(),
      reason: reason ?? undefined,
    };
    const response = action === "retry"
      ? await client.retryRun(input, appCallOptions(token))
      : await client.cancelRun(input, appCallOptions(token));
    const outcome: HuntRecoveryResult["outcome"] = (() => {
      if (action === "retry") {
        switch (response.outcome) {
          case "retried":
            return "retried";
          case "already_retried":
            return "already_retried";
          default:
            throw new Error(`Unknown retry outcome: ${response.outcome}`);
        }
      }
      switch (response.outcome) {
        case "cancelled":
          return "cancelled";
        case "already_cancelled":
          return "already_cancelled";
        default:
          throw new Error(`Unknown cancel outcome: ${response.outcome}`);
      }
    })();
    const status = runStatusFromProto(response.status);
    const expectedStatus = action === "retry" ? "queued" : "cancelled";
    if (status !== expectedStatus) {
      throw new Error(`Unknown ${action} status: ${status}`);
    }
    return {
      runId: response.runId,
      outcome,
      attempt: response.attempt,
      stage: expectedStatus,
    };
  });
};

export const retryHuntRun = (
  token: string,
  projectId: string,
  runId: string,
  reason: string | null = null,
) => recoverHuntRun(token, projectId, runId, "retry", reason);

export const cancelHuntRun = (
  token: string,
  projectId: string,
  runId: string,
  reason: string | null = null,
) => recoverHuntRun(token, projectId, runId, "cancel", reason);

export type HuntResumeResult = {
  runId: string;
  outcome:
    | "resumed"
    | "already_resumed"
    | "approved"
    | "already_approved";
  workflowStage: string | null;
  startStage: string | null;
  checkpointKey: string | null;
  attempt: number | null;
  revision: number | null;
  terminalReviewOnly: boolean;
};

export async function resumeHuntRun(
  token: string,
  projectId: string,
  runId: string,
  checkpoint: { key: string; attempt: number; revision: number },
  requestId: string = crypto.randomUUID(),
): Promise<HuntResumeResult> {
  const client = requireIssueClient();
  return appRpc(async () => {
    const response = await client.resumeRun(
      {
        projectId,
        runId,
        requestId,
        checkpointKey: checkpoint.key,
        attempt: checkpoint.attempt,
        revision: checkpoint.revision,
      },
      appCallOptions(token),
    );
    const outcome = (() => {
      switch (response.outcome) {
        case ProtoResumeOutcome.RESUMED:
          return "resumed" as const;
        case ProtoResumeOutcome.ALREADY_RESUMED:
          return "already_resumed" as const;
        case ProtoResumeOutcome.APPROVED:
          return "approved" as const;
        case ProtoResumeOutcome.ALREADY_APPROVED:
          return "already_approved" as const;
        default:
          throw new Error(`Unknown resume outcome: ${response.outcome}`);
      }
    })();
    return {
      runId: response.runId,
      outcome,
      workflowStage: response.workflowStage ?? null,
      startStage: response.startStage ?? null,
      checkpointKey: response.checkpointKey ?? null,
      attempt: response.attempt ?? null,
      revision: response.revision ?? null,
      terminalReviewOnly: response.terminalReviewOnly,
    };
  });
}

export type HuntReworkResult = {
  runId: string;
  outcome: "reworked" | "already_reworked";
  attempt: number;
  revision: number;
  workflowStage: string;
};

export const reworkRunResultFromMessage = (
  response: ReworkRunResponseMessage,
): HuntReworkResult => {
  const outcome = (() => {
    switch (response.outcome) {
      case ProtoReworkOutcome.REWORKED:
        return "reworked" as const;
      case ProtoReworkOutcome.ALREADY_REWORKED:
        return "already_reworked" as const;
      default:
        throw new Error(`Unknown rework outcome: ${response.outcome}`);
    }
  })();
  return {
    runId: response.runId,
    outcome,
    attempt: response.attempt,
    revision: response.revision,
    workflowStage: response.workflowStage,
  };
};

export async function reworkPausedHuntRun(
  token: string,
  projectId: string,
  runId: string,
  input: {
    workflowStage: string;
    reason: string;
    checkpoint: {
      key: string;
      attempt: number;
      revision: number;
    };
  },
  requestId: string = crypto.randomUUID(),
): Promise<HuntReworkResult> {
  const client = requireIssueClient();
  return appRpc(async () => reworkRunResultFromMessage(
    await client.reworkRun(
      {
        projectId,
        runId,
        requestId,
        workflowStage: input.workflowStage,
        reason: input.reason,
        checkpoint: {
          key: input.checkpoint.key,
          attempt: input.checkpoint.attempt,
          revision: input.checkpoint.revision,
        },
      },
      appCallOptions(token),
    ),
  ));
}

export const unassignRunResultFromMessage = (
  response: UnassignRunResponseMessage,
) => {
  const outcome = (() => {
    switch (response.outcome) {
      case ProtoUnassignOutcome.UNASSIGNED:
        return "unassigned" as const;
      case ProtoUnassignOutcome.NOT_ASSIGNED:
        return "not_assigned" as const;
      default:
        throw new Error(`Unknown unassign outcome: ${response.outcome}`);
    }
  })();
  return { runId: response.runId, outcome };
};

export async function unassignHuntRun(
  token: string,
  projectId: string,
  runId: string,
) {
  const client = requireIssueClient();
  return appRpc(async () => unassignRunResultFromMessage(
    await client.unassignRun(
      { projectId, runId, requestId: crypto.randomUUID() },
      appCallOptions(token),
    ),
  ));
}

export type HuntDispatchResult = ReturnType<typeof dispatchFromMessage>;

export async function dispatchHuntRun(
  token: string,
  projectId: string,
  runId: string,
  input: {
    agentId?: string | null;
    provider: AgentProvider;
    model: string | null;
    effort: string | null;
    workerId: string | null;
    reassign?: boolean;
    persistPreferences?: boolean;
  },
): Promise<HuntDispatchResult> {
  const client = requireIssueClient();
  return appRpc(async () => {
    const requestMessage = {
      projectId,
      runId,
      dispatch: {
        requestId: crypto.randomUUID(),
        agentId: input.agentId ?? undefined,
        provider: agentProviderToProto(input.provider),
        model: input.model ?? undefined,
        effort: input.effort ?? undefined,
        persistPreferences: input.persistPreferences ?? false,
        workerId: input.workerId ?? undefined,
      },
    };
    const response = input.reassign
      ? await client.reassignRun(requestMessage, appCallOptions(token))
      : await client.dispatchRun(requestMessage, appCallOptions(token));
    return dispatchFromMessage(requiredMessage(
      response.dispatch,
      "dispatchRun.dispatch",
    ));
  });
}

export async function completeIssueResultReview(
  token: string,
  projectId: string,
  runId: string,
): Promise<IssueResultReview> {
  const client = requireIssueClient();
  return appRpc(async () => {
    const response = await client.completeResultReview(
      { projectId, runId },
      appCallOptions(token),
    );
    return resultReviewFromProto(requiredMessage(
      response.review,
      "completeResultReview.review",
    ));
  });
}

const issueChangedFieldFromProto = (
  value: ProtoIssueChangedField,
): "title" | "description" | "priority" => {
  switch (value) {
    case ProtoIssueChangedField.TITLE:
      return "title";
    case ProtoIssueChangedField.DESCRIPTION:
      return "description";
    case ProtoIssueChangedField.PRIORITY:
      return "priority";
    default:
      throw new Error(`Unknown issue changed field: ${value}`);
  }
};

const issueReworkProposalFromMessage = (
  value: IssueReworkProposalMessage,
): IssueReworkProposal => ({
  id: value.id,
  type: "request_issue_rework",
  workflowStage: value.workflowStage,
  reason: value.reason,
  status: activeProposalStatusFromProto(value.status),
  acceptedAt: optionalTimestamp(value.acceptedAt),
  appliedRevision: value.appliedRevision ?? null,
});

export const issueUpdateProposalFromMessage = (
  value: IssueUpdateProposalMessage,
): IssueUpdateProposal => {
  const changedFields = value.changedFields.map(issueChangedFieldFromProto);
  const changed = new Set(changedFields);
  const source = requiredMessage(value.changes, "issueUpdateProposal.changes");
  const changes: IssueUpdateProposal["changes"] = {};
  if (changed.has("title")) {
    changes.title = requiredMessage(source.title, "issueUpdateProposal.changes.title");
  }
  if (changed.has("description")) {
    changes.description = source.description ?? null;
  }
  if (changed.has("priority")) {
    changes.priority = source.priority ?? null;
  }
  return {
    id: value.id,
    type: "request_issue_update",
    changes,
    changedFields,
    status: activeProposalStatusFromProto(value.status),
    acceptedAt: optionalTimestamp(value.acceptedAt),
    resultRunId: value.resultRunId ?? null,
  };
};

const issueCreateProposalFromMessage = (
  value: IssueCreateProposalMessage,
): IssueCreateProposal => {
  const issue = requiredMessage(value.issue, "issueCreateProposal.issue");
  const status = runStatusFromProto(issue.status);
  if (status !== "backlog" && status !== "queued") {
    throw new Error(`Unknown proposed issue status: ${status}`);
  }
  return {
    id: value.id,
    type: "request_issue_create",
    issue: {
      title: issue.title,
      description: issue.description ?? null,
      priority: issue.priority ?? null,
      status,
    },
    executeAfterCreate: value.executeAfterCreate,
    status: activeProposalStatusFromProto(value.status),
    acceptedAt: optionalTimestamp(value.acceptedAt),
    resultRunId: value.resultRunId ?? null,
  };
};

const proposedActionFromMessage = (
  value: IssueMessageMessage["proposedAction"],
): IssueProposedAction | null => {
  switch (value.case) {
    case "reworkProposal":
      return issueReworkProposalFromMessage(value.value);
    case "updateProposal":
      return issueUpdateProposalFromMessage(value.value);
    case "createProposal":
      return issueCreateProposalFromMessage(value.value);
    case undefined:
      return null;
  }
};

export const issueMessageFromMessage = (
  value: IssueMessageMessage,
): IssueMessage => ({
  id: value.id,
  runId: value.runId,
  parentMessageId: value.parentMessageId ?? null,
  body: value.body,
  attachments: value.attachments.map(issueAttachmentFromProto),
  author: messageAuthorFromProto(requiredMessage(
    value.author,
    "issueMessage.author",
  )),
  replyCount: value.replyCount,
  proposedAction: proposedActionFromMessage(value.proposedAction),
  executionProposal: value.executionProposal
    ? issueExecutionProposalFromMessage(value.executionProposal)
    : null,
  skillExecutionProposal: value.skillExecutionProposal
    ? agentSkillExecutionProposalFromMessage(value.skillExecutionProposal)
    : null,
  createdAt: requiredTimestamp(value.createdAt, "issueMessage.createdAt"),
  updatedAt: requiredTimestamp(value.updatedAt, "issueMessage.updatedAt"),
});

const issueAgentReplyFromMessage = (
  value: IssueAgentReplyMessage,
): IssueAgentReplyState => ({
  id: value.id,
  triggerMessageId: value.triggerMessageId,
  parentMessageId: value.parentMessageId,
  agentId: value.agentId ?? null,
  agentName: value.agentName ?? null,
  status: channelReplyStatusFromProto(value.status),
  attempts: value.attempts,
  workerId: value.workerId ?? null,
  provider: optionalAgentProviderFromProto(value.provider),
  error: value.error ?? null,
  updatedAt: requiredTimestamp(value.updatedAt, "issueAgentReply.updatedAt"),
});

export async function loadIssueMessages(
  token: string,
  projectId: string,
  runId: string,
) {
  return (await loadIssueConversationSnapshot(token, projectId, runId)).messages;
}

export async function loadIssueConversationSnapshot(
  token: string,
  projectId: string,
  runId: string,
): Promise<IssueConversationSnapshot> {
  const client = requireIssueClient();
  return appRpc(async () => {
    const response = await client.listIssueMessages(
      { projectId, runId },
      appCallOptions(token),
    );
    return {
      cursor: safeNumber(response.cursor, "issueConversation.cursor"),
      messages: response.messages.map(issueMessageFromMessage),
      agentReplies: response.agentReplies.map(issueAgentReplyFromMessage),
    };
  });
}

export const issueConversationDeltaFromMessage = (
  response: SyncIssueMessagesResponseMessage,
): IssueConversationDelta => ({
  cursor: safeNumber(response.cursor, "issueConversationDelta.cursor"),
  hasMore: response.hasMore,
  changed: response.changed,
  reset: response.reset,
  messages: response.messages.map(issueMessageFromMessage),
  agentReplies: response.agentReplies.map(issueAgentReplyFromMessage),
});

export async function loadIssueConversationDelta(
  token: string,
  projectId: string,
  runId: string,
  cursor: number,
): Promise<IssueConversationDelta> {
  const client = requireIssueClient();
  return appRpc(async () => issueConversationDeltaFromMessage(
    await client.syncIssueMessages(
      {
        projectId,
        runId,
        cursor: cursorToProto(cursor, "issueConversation.cursor"),
      },
      appCallOptions(token),
    ),
  ));
}

type CreateIssueMessageInput = {
  body: string;
  clientMessageId?: string;
  parentMessageId: string | null;
  mentionedUserIds?: string[];
  mentionedAgentIds?: string[];
  agentConversationId?: string | null;
  attachments?: File[];
  attachmentReferences?: string[];
};

export const createIssueMessageRequestFromInput = (
  projectId: string,
  runId: string,
  input: CreateIssueMessageInput,
) => ({
  projectId,
  runId,
  clientMessageId: (input.clientMessageId ?? crypto.randomUUID()).toLowerCase(),
  body: input.body,
  parentMessageId: input.parentMessageId?.toLowerCase() ?? undefined,
  mentionedUserIds: input.mentionedUserIds ?? [],
  mentionedAgentIds: input.mentionedAgentIds ?? [],
  agentConversationId: input.agentConversationId ?? undefined,
  attachmentReferences: input.attachmentReferences ?? [],
});

const createIssueMessageMultipart = async (
  token: string,
  projectId: string,
  runId: string,
  input: CreateIssueMessageInput,
) => {
  const attachments = input.attachments ?? [];
  const attachmentError = validateIssueAttachments(attachments);
  if (attachmentError) throw new Error(attachmentError);
  const clientMessageId = input.clientMessageId?.toLowerCase();
  const parentMessageId = input.parentMessageId?.toLowerCase() ?? null;
  const form = new FormData();
  form.set("body", input.body);
  if (clientMessageId) form.set("clientMessageId", clientMessageId);
  form.set("parentMessageId", parentMessageId ?? "");
  form.set("mentionedUserIds", JSON.stringify(input.mentionedUserIds ?? []));
  form.set("mentionedAgentIds", JSON.stringify(input.mentionedAgentIds ?? []));
  form.set("agentConversationId", input.agentConversationId ?? "");
  form.set(
    "attachmentReferences",
    JSON.stringify(input.attachmentReferences ?? []),
  );
  for (const attachment of attachments) {
    form.append("attachments", attachment, attachment.name);
  }
  return request<{
    message: IssueMessage;
    agentReply: IssueAgentReplyState | null;
    agentReplies?: IssueAgentReplyState[];
  }>(`/projects/${projectId}/runs/${runId}/messages`, token, {
    method: "POST",
    body: form,
  });
};

export async function createIssueMessage(
  token: string,
  projectId: string,
  runId: string,
  input: CreateIssueMessageInput,
) {
  const attachments = input.attachments ?? [];
  if (issueMutationTransport(attachments) === "multipart") {
    return createIssueMessageMultipart(token, projectId, runId, input);
  }
  const client = requireIssueClient();
  return appRpc(async () => {
    const response = await client.createIssueMessage(
      createIssueMessageRequestFromInput(projectId, runId, input),
      appCallOptions(token),
    );
    return {
      message: issueMessageFromMessage(requiredMessage(
        response.message,
        "createIssueMessage.message",
      )),
      agentReply: response.agentReply
        ? issueAgentReplyFromMessage(response.agentReply)
        : null,
      agentReplies: response.agentReplies.map(issueAgentReplyFromMessage),
    };
  });
}

export const updatedIssueMessageFromMessage = (
  response: UpdateIssueMessageResponseMessage,
) => issueMessageFromMessage(requiredMessage(
  response.message,
  "updateIssueMessage.message",
));

export async function editIssueMessage(
  token: string,
  projectId: string,
  runId: string,
  messageId: string,
  input: {
    body: string;
    mentionedUserIds?: string[];
  },
) {
  const client = requireIssueClient();
  return appRpc(async () => updatedIssueMessageFromMessage(
    await client.updateIssueMessage(
      {
        projectId,
        runId,
        messageId,
        body: input.body,
        mentionedUserIds: input.mentionedUserIds ?? [],
      },
      appCallOptions(token),
    ),
  ));
}

export async function deleteIssueMessage(
  token: string,
  projectId: string,
  runId: string,
  messageId: string,
) {
  const client = requireIssueClient();
  const response = await appRpc(() => client.deleteIssueMessage(
    { projectId, runId, messageId },
    appCallOptions(token),
  ));
  if (!response.deleted) {
    throw new Error("Issue message deletion was not confirmed");
  }
}

export async function loadIssueAgentReply(
  token: string,
  projectId: string,
  runId: string,
  triggerMessageId: string,
) {
  const client = requireIssueClient();
  return appRpc(async () => {
    const response = await client.getIssueAgentReply(
      { projectId, runId, triggerMessageId },
      appCallOptions(token),
    );
    return {
      agentReply: issueAgentReplyFromMessage(requiredMessage(
        response.agentReply,
        "getIssueAgentReply.agentReply",
      )),
      agentReplies: response.agentReplies.map(issueAgentReplyFromMessage),
      messages: response.messages.map(issueMessageFromMessage),
      message: response.message
        ? issueMessageFromMessage(response.message)
        : null,
    };
  });
}

const evidenceStatusFromProto = (
  value: ProtoRunEvidenceStatus,
): RunEvidence["status"] => {
  switch (value) {
    case ProtoRunEvidenceStatus.PENDING:
      return "pending";
    case ProtoRunEvidenceStatus.PASSED:
      return "passed";
    case ProtoRunEvidenceStatus.FAILED:
      return "failed";
    case ProtoRunEvidenceStatus.SKIPPED:
      return "skipped";
    default:
      throw new Error(`Unknown run evidence status: ${value}`);
  }
};

const runEvidenceFromMessage = (value: RunEvidenceMessage): RunEvidence => ({
  key: value.key,
  attempt: value.attempt,
  revision: value.revision,
  stage: value.stage,
  type: value.type,
  status: evidenceStatusFromProto(value.status),
  detail: value.detail ?? null,
  command: value.command ?? null,
  url: value.url ?? null,
  metadata: value.metadata ?? null,
  actor: value.actor,
  observedAt: requiredTimestamp(value.observedAt, "runEvidence.observedAt"),
  recordedAt: requiredTimestamp(value.recordedAt, "runEvidence.recordedAt"),
  images: value.images.map((image) => ({
    id: image.id,
    filename: image.filename,
    contentType: image.contentType,
    byteSize: safeNumber(image.byteSize, "runEvidence.image.byteSize"),
    sha256: image.sha256,
    position: image.position,
    url: image.url,
  })),
  requiredRevision: value.requiredRevision,
  canonical: value.canonical,
});

export async function loadRunEvidence(
  token: string,
  projectId: string,
  runId: string,
) {
  const client = requireIssueClient();
  return appRpc(async () => {
    const response = await client.listRunEvidence(
      { projectId, runId },
      appCallOptions(token),
    );
    return response.evidence.map(runEvidenceFromMessage);
  });
}

export async function acceptIssueReworkProposal(
  token: string,
  projectId: string,
  runId: string,
  proposalId: string,
) {
  const client = requireIssueClient();
  return appRpc(async () => {
    const response = await client.acceptIssueReworkProposal(
      { projectId, runId, proposalId },
      appCallOptions(token),
    );
    return {
      proposal: issueReworkProposalFromMessage(requiredMessage(
        response.proposal,
        "acceptIssueReworkProposal.proposal",
      )),
      outcome: approvalOutcomeFromProto(response.outcome),
      attempt: response.attempt,
      revision: response.revision,
      workflowStage: response.workflowStage,
    };
  });
}

export async function acceptIssueActionProposal(
  token: string,
  projectId: string,
  runId: string,
  proposalId: string,
) {
  const client = requireIssueClient();
  return appRpc(async () => {
    const response = await client.acceptIssueActionProposal(
      { projectId, runId, proposalId },
      appCallOptions(token),
    );
    const proposal = (() => {
      switch (response.proposal.case) {
        case "update":
          return issueUpdateProposalFromMessage(response.proposal.value);
        case "create":
          return issueCreateProposalFromMessage(response.proposal.value);
        case undefined:
          throw new Error("Accepted issue action proposal is missing");
      }
    })();
    return {
      proposal,
      executionProposal: response.executionProposal
        ? issueExecutionProposalFromMessage(response.executionProposal)
        : null,
      outcome: approvalOutcomeFromProto(response.outcome),
      resultRunId: response.resultRunId ?? null,
    };
  });
}

export async function acceptIssueExecutionProposal(
  token: string,
  projectId: string,
  conversationRunId: string,
  proposalId: string,
  input: IssueExecutionApprovalInput,
) {
  const client = requireIssueClient();
  return appRpc(async () => {
    const response = await client.acceptIssueExecutionProposal(
      {
        projectId,
        conversationRunId,
        proposalId,
        approval: approvalToMessage(input),
      },
      appCallOptions(token),
    );
    return {
      proposal: issueExecutionProposalFromMessage(requiredMessage(
        response.proposal,
        "acceptIssueExecutionProposal.proposal",
      )),
      outcome: approvalOutcomeFromProto(response.outcome),
      projectId: response.projectId,
      runId: response.runId,
      dispatch: dispatchFromMessage(requiredMessage(
        response.dispatch,
        "acceptIssueExecutionProposal.dispatch",
      )),
    };
  });
}

export async function acceptIssueSkillExecutionProposal(
  token: string,
  projectId: string,
  conversationRunId: string,
  expectedProposal: AgentSkillExecutionProposal,
  input: AgentSkillExecutionApprovalInput,
) {
  assertPendingAgentSkillExecutionApproval(expectedProposal, input);
  const client = requireIssueClient();
  const result: {
    proposal: AgentSkillExecutionProposal;
    outcome: "accepted" | "already_accepted";
    projectId: string;
    session: AutoHuntSession | null;
  } = await appRpc(async () => {
    const response = await client.acceptIssueSkillExecutionProposal(
      {
        projectId,
        conversationRunId,
        proposalId: expectedProposal.id,
        workerId: input.workerId,
      },
      appCallOptions(token),
    );
    return {
      proposal: agentSkillExecutionProposalFromMessage(requiredMessage(
        response.proposal,
        "acceptIssueSkillExecutionProposal.proposal",
      )),
      outcome: approvalOutcomeFromProto(response.outcome),
      projectId: response.projectId,
      session: response.session
        ? projectAgentSessionFromMessage(response.session, true)
        : null,
    };
  });
  return validateAgentSkillExecutionAcceptance(result, expectedProposal, input);
}
