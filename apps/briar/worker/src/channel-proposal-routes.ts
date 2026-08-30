import type {
  ChannelExecutionProposalAcceptInput,
} from "../../src/lib/channels-contract";
import { approveAgentSkillExecutionProposal } from "./agent-skill-execution-approval";
import type { BriarAuth } from "./auth";
import {
  approvedIssueCreation,
  assertChannelProposalAuthorScope,
  channelRelatedMessageReference,
  resolveChannelProposalTargetProjectId,
} from "./channel-proposal-helpers";
import { requireChannelAccess } from "./channel-route-access";
import {
  decodeChannelExecutionProposalAcceptInput,
  decodeChannelIssueBatchProposalPayload,
  decodeChannelIssueProposalPayload,
  decodeChannelProposalAcceptInput,
} from "./channel-route-decoders";
import {
  channelExecutionProposalTablesAvailable,
  channelIssueBatchProposalTablesAvailable,
  channelSkillExecutionProposalTablesAvailable,
  getChannelActionProposal,
  declineChannelActionProposal,
  getChannelAgentSkillExecutionProposal,
  getChannelExecutionProposal,
  getOrganizationProject,
  reserveChannelActionProposalApproval,
  reserveChannelExecutionProposalApproval,
  type ChannelRow,
} from "./channels";
import {
  listChannelIssueBatchItems,
  materializeChannelIssueBatch,
} from "./channel-issue-batch-approval";
import { recordHuntEvent } from "./hunt-event-repository";
import { getHuntRunForProject } from "./hunt-run-repository";
import { HttpError, json } from "./http-response";
import type { IssueExecutionProposalRow } from "./issue-execution-proposal-repository";
import {
  decodeAgentSkillExecutionProposalAcceptInput,
  decodeExecutionPreferences,
} from "./issue-request-contract";
import { getProject } from "./project-command-repository";
import type { ProjectRow } from "./project-repository";
import { getProjectSettings } from "./project-settings-repository";
import {
  newChannelBatchProposalIssueSourceKey,
  newChannelProposalIssueSourceKey,
} from "./proposal-issue-source";
import { readJson } from "./request-readers";
import { requireSession } from "./session-auth";
import {
  assertExecutionSelectionAvailable,
  dispatchHuntRun,
  WorkerConflictError,
} from "./workers";

const issueExecutionProposalJson = (proposal: IssueExecutionProposalRow) => {
  if (proposal.status !== "pending" && proposal.status !== "accepted") {
    throw new Error("Invalidated execution proposals cannot be serialized");
  }
  return {
    id: proposal.id,
    type: "request_issue_execute" as const,
    status: proposal.status,
    projectId: proposal.project_id,
    runId: proposal.target_run_id,
    title: proposal.target_title,
    createdAt: proposal.created_at,
    acceptedAt: proposal.accepted_at,
    requestedProvider: proposal.requested_provider,
    requestedModel: proposal.requested_model,
    requestedEffort: proposal.requested_effort,
    requestedWorkerId: proposal.requested_worker_id,
    delegatedByAgentId: proposal.delegated_by_agent_id,
    delegatedByAgentName: proposal.delegated_by_agent_name,
  };
};

const liveIssueExecutionProposalJson = (
  proposal: IssueExecutionProposalRow | null,
) => proposal && (proposal.status === "pending" || proposal.status === "accepted")
  ? issueExecutionProposalJson(proposal)
  : null;

async function createApprovedChannelProposalIssue(input: {
  db: D1Database;
  project: Pick<ProjectRow, "id" | "name">;
  organizationId: string;
  proposalId: string;
  channelId: string;
  messageId: string;
  rootMessageId: string | null;
  sourceKey: string;
  title: string;
  description: string | null;
  priority: number | null;
  createdByUserId: string;
  occurredAt: string;
}) {
  const settings = await getProjectSettings(input.db, input.project.id);
  const relatedMessage = channelRelatedMessageReference({
    organizationId: input.organizationId,
    channelId: input.channelId,
    messageId: input.messageId,
    rootMessageId: input.rootMessageId,
  });
  // Keep the source message structured so the issue description remains the
  // exact proposal payload while the dashboard can offer an in-app jump back.
  return recordHuntEvent(input.db, input.project.id, {
    source: "issue",
    sourceKey: input.sourceKey,
    title: input.title,
    stage: "queued",
    status: "backlog",
    workflowStage: null,
    eventKey: `${input.sourceKey}:backlog:intake`,
    occurredAt: input.occurredAt,
    actor: "briar-channel",
    repository: settings?.github_repository ?? input.project.name,
    detail: "채널 대화에서 사용자가 승인한 제안으로 생성된 이슈입니다.",
    priority: input.priority,
    difficulty: null,
    assigneeUserId: null,
    issueCheckpoints: [],
    fullAuto: false,
    branch: null,
    commitSha: null,
    tracker: null,
    issueDescription: input.description,
    resultSummary: null,
    structuredResult: null,
    pullRequestUrls: [],
    targetSha: null,
    sourceCreatedAt: input.occurredAt,
    qaStatus: null,
    stagingQaDetail: null,
    productionQaDetail: null,
    context: {
      origin: "briar-channel",
      proposalId: input.proposalId,
      channelId: input.channelId,
      issueId: input.proposalId,
      relatedMessage,
      attachmentCount: 0,
      fullAuto: false,
    },
    createdByUserId: input.createdByUserId,
    preferredAgentProvider: null,
    preferredAgentModel: null,
    preferredAgentEffort: null,
  });
}

type LiveChannelExecutionProposal = NonNullable<
  Awaited<ReturnType<typeof getChannelExecutionProposal>>
>;

async function approveChannelExecutionProposalRequest(input: {
  db: D1Database;
  channel: Pick<ChannelRow, "id" | "organization_id" | "archived_at">;
  project: Pick<ProjectRow, "id" | "organization_id">;
  proposal: LiveChannelExecutionProposal;
  userId: string;
  selection: ChannelExecutionProposalAcceptInput;
}) {
  decodeExecutionPreferences({
    provider: input.selection.provider,
    model: input.selection.model,
    effort: input.selection.effort,
  });
  const run = await getHuntRunForProject(
    input.db,
    input.project.id,
    input.proposal.target_run_id,
  );
  if (input.proposal.status === "accepted") {
    if (
      input.proposal.accepted_by_user_id !== input.userId ||
      input.proposal.requested_provider !== input.selection.provider ||
      input.proposal.requested_model !== input.selection.model ||
      input.proposal.requested_effort !== input.selection.effort ||
      input.proposal.requested_worker_id !== input.selection.workerId
    ) {
      throw new HttpError(
        409,
        "Execution was approved with different settings or by another member",
        "CHANNEL_EXECUTION_PROPOSAL_CONFLICT",
      );
    }
    if (
      !run ||
      !input.proposal.dispatch_request_id ||
      run.dispatch_request_id !== input.proposal.dispatch_request_id
    ) {
      throw new HttpError(
        409,
        "This execution approval is stale; request a new approval",
        "CHANNEL_EXECUTION_PROPOSAL_STALE",
      );
    }
    return {
      proposal: issueExecutionProposalJson(input.proposal),
      outcome: "already_accepted" as const,
      projectId: input.proposal.project_id,
      runId: input.proposal.target_run_id,
      dispatch: {
        runId: input.proposal.target_run_id,
        agentId: input.proposal.proposed_by_agent_id,
        provider: input.proposal.requested_provider!,
        model: input.proposal.requested_model,
        effort: input.proposal.requested_effort,
        requestedWorkerId: input.proposal.requested_worker_id,
        requestedByUserId: input.proposal.accepted_by_user_id!,
        dispatchMode: input.proposal.requested_worker_id ? "specific" : "any",
        dispatchedAt: input.proposal.accepted_at!,
        outcome: "already_dispatched" as const,
      },
    };
  }
  if (input.proposal.status !== "pending" || input.channel.archived_at) {
    throw new HttpError(
      409,
      input.channel.archived_at
        ? "Channel is archived"
        : "This execution proposal is no longer valid",
      "CHANNEL_EXECUTION_PROPOSAL_STALE",
    );
  }
  const acceptedAt = new Date().toISOString();
  const reservation = await reserveChannelExecutionProposalApproval(input.db, {
    organizationId: input.channel.organization_id,
    channelId: input.channel.id,
    proposalId: input.proposal.id,
    userId: input.userId,
    provider: input.selection.provider,
    model: input.selection.model,
    effort: input.selection.effort,
    workerId: input.selection.workerId,
    dispatchRequestId: crypto.randomUUID(),
    reservedAt: acceptedAt,
  });
  if (
    !reservation?.dispatch_request_id ||
    !reservation.approval_reserved_by_user_id ||
    !reservation.approval_reserved_at
  ) {
    throw new HttpError(
      409,
      "The issue or execution approval changed before dispatch",
      "CHANNEL_EXECUTION_PROPOSAL_CONFLICT",
    );
  }
  try {
    const dispatched = await dispatchHuntRun(
      input.db,
      input.project.organization_id,
      input.project.id,
      {
        runId: reservation.target_run_id,
        agentId: reservation.proposed_by_agent_id,
        provider: reservation.requested_provider!,
        model: reservation.requested_model,
        effort: reservation.requested_effort,
        persistPreferences: false,
        workerId: reservation.requested_worker_id,
        requestedByUserId: reservation.approval_reserved_by_user_id,
        requestId: reservation.dispatch_request_id,
        occurredAt: reservation.approval_reserved_at,
      },
    );
    if (!dispatched) throw new HttpError(404, "Run not found");
    const accepted = await getChannelExecutionProposal(input.db, {
      organizationId: reservation.organization_id,
      channelId: reservation.channel_id!,
      proposalId: reservation.id,
      userId: reservation.approval_reserved_by_user_id,
    });
    if (
      !accepted ||
      accepted.status !== "accepted" ||
      accepted.dispatch_request_id !== reservation.dispatch_request_id
    ) {
      throw new HttpError(
        409,
        "Execution approval was not finalized",
        "CHANNEL_EXECUTION_PROPOSAL_CONFLICT",
      );
    }
    return {
      proposal: issueExecutionProposalJson(accepted),
      outcome: "accepted" as const,
      projectId: accepted.project_id,
      runId: accepted.target_run_id,
      dispatch: dispatched,
    };
  } catch (error) {
    if (
      error instanceof WorkerConflictError ||
      (error instanceof Error && error.message.includes("execution proposal"))
    ) {
      throw new HttpError(
        409,
        error.message,
        "CHANNEL_EXECUTION_PROPOSAL_CONFLICT",
      );
    }
    throw error;
  }
}

export type ChannelProposalRouteInput = {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  env: Env;
};

type ChannelProposalApplicationInput = {
  db: D1Database;
  env: Env;
  organizationId: string;
  channelId: string;
  proposalId: string;
  userId: string;
};

export async function declineOrganizationChannelProposal(
  input: ChannelProposalApplicationInput,
) {
  const channel = await requireChannelAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  const proposal = await getChannelActionProposal(
    input.db,
    channel.id,
    input.proposalId,
  );
  if (!proposal) throw new HttpError(404, "Proposal not found");
  if (proposal.action_type !== "request_issue_create") {
    throw new HttpError(409, "This proposal cannot be declined");
  }
  if (proposal.status === "accepted") {
    throw new HttpError(409, "Accepted proposals cannot be declined");
  }
  if (proposal.status === "declined") {
    return { outcome: "already_declined" as const };
  }
  const declined = await declineChannelActionProposal(input.db, {
    channelId: channel.id,
    proposalId: proposal.id,
    userId: input.userId,
    declinedAt: new Date().toISOString(),
  });
  if (!declined) {
    const current = await getChannelActionProposal(
      input.db,
      channel.id,
      proposal.id,
    );
    if (current?.status === "declined") {
      return { outcome: "already_declined" as const };
    }
    throw new HttpError(409, "Proposal changed");
  }
  return { outcome: "declined" as const };
}

export async function acceptOrganizationChannelExecutionProposal(
  input: ChannelProposalApplicationInput & { request: unknown },
) {
  const channel = await requireChannelAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  if (!(await channelExecutionProposalTablesAvailable(input.db))) {
    throw new HttpError(
      503,
      "Issue execution approval is not available during this upgrade",
      "ISSUE_EXECUTION_APPROVAL_UNAVAILABLE",
    );
  }
  const proposal = await getChannelExecutionProposal(input.db, {
    organizationId: channel.organization_id,
    channelId: channel.id,
    proposalId: input.proposalId,
    userId: input.userId,
  });
  if (!proposal) throw new HttpError(404, "Execution proposal not found");
  const request = decodeChannelExecutionProposalAcceptInput(input.request);
  decodeExecutionPreferences({
    provider: request.provider,
    model: request.model,
    effort: request.effort,
  });
  const project = await getProject(input.db, proposal.project_id, input.userId);
  if (!project || project.organization_id !== channel.organization_id) {
    throw new HttpError(404, "Project not found");
  }
  return approveChannelExecutionProposalRequest({
    db: input.db,
    channel,
    project,
    proposal,
    userId: input.userId,
    selection: request,
  });
}

export async function acceptOrganizationChannelSkillExecutionProposal(
  input: ChannelProposalApplicationInput & { request: unknown },
) {
  const channel = await requireChannelAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  if (!(await channelSkillExecutionProposalTablesAvailable(input.db))) {
    throw new HttpError(
      503,
      "Agent Skill execution approval is not available during this upgrade",
      "AGENT_SKILL_EXECUTION_APPROVAL_UNAVAILABLE",
    );
  }
  const loadProposal = () => getChannelAgentSkillExecutionProposal(input.db, {
    organizationId: channel.organization_id,
    channelId: channel.id,
    proposalId: input.proposalId,
    userId: input.userId,
  });
  const proposal = await loadProposal();
  if (!proposal) {
    throw new HttpError(404, "Agent Skill execution proposal not found");
  }
  const request = decodeAgentSkillExecutionProposalAcceptInput(input.request);
  const project = await getProject(input.db, proposal.project_id, input.userId);
  if (!project || project.organization_id !== channel.organization_id) {
    throw new HttpError(404, "Project not found");
  }
  if (proposal.status === "pending" && channel.archived_at) {
    throw new HttpError(
      409,
      "Channel is archived",
      "CHANNEL_SKILL_EXECUTION_PROPOSAL_STALE",
    );
  }
  return approveAgentSkillExecutionProposal(
    input.db,
    input.env.ARCHIVES,
    proposal,
    {
      sourceKind: "channel",
      userId: input.userId,
      workerId: request.workerId,
      staleCode: "CHANNEL_SKILL_EXECUTION_PROPOSAL_STALE",
      conflictCode: "CHANNEL_SKILL_EXECUTION_PROPOSAL_CONFLICT",
      reload: loadProposal,
    },
  );
}

export async function acceptOrganizationChannelProposal(
  input: ChannelProposalApplicationInput & { request: unknown },
) {
  const channel = await requireChannelAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  const proposal = await getChannelActionProposal(
    input.db,
    channel.id,
    input.proposalId,
  );
  if (!proposal) throw new HttpError(404, "Proposal not found");
  if (proposal.action_type !== "request_issue_create") {
    throw new HttpError(409, "This proposal cannot create an issue");
  }
  if (proposal.status === "declined") {
    throw new HttpError(409, "Declined proposals cannot create an issue");
  }
  assertChannelProposalAuthorScope({
    channelOrganizationId: channel.organization_id,
    proposedProjectId: proposal.project_id,
    replyAuthorAgentId: proposal.reply_author_agent_id,
    replyAuthorAgentOrganizationId: proposal.reply_author_agent_organization_id,
    replyAuthorAgentProjectId: proposal.reply_author_agent_project_id,
  });
  const request = decodeChannelProposalAcceptInput(input.request);
  const rawProposalPayload: unknown = JSON.parse(proposal.payload_json);
  // A batch marker is authoritative even if its contents are malformed. It
  // must never fall through to the single-issue decoder.
  const isBatchPayload = typeof rawProposalPayload === "object" &&
    rawProposalPayload !== null && "batch" in rawProposalPayload;
  const batchPayload = isBatchPayload
    ? decodeChannelIssueBatchProposalPayload(rawProposalPayload)
    : null;
  if (batchPayload && request.execution) {
    throw new HttpError(400, "Issue batches cannot be executed on creation");
  }
  if (
    batchPayload &&
    !(await channelIssueBatchProposalTablesAvailable(input.db))
  ) {
    throw new HttpError(
      503,
      "Issue batch approval is not available during this upgrade",
      "ISSUE_BATCH_APPROVAL_UNAVAILABLE",
    );
  }
  if (request.execution && proposal.execute_after_create !== 1) {
    throw new HttpError(
      400,
      "Execution settings require a create-and-execute proposal",
    );
  }
  if (
    request.execution &&
    !(await channelExecutionProposalTablesAvailable(input.db))
  ) {
    throw new HttpError(
      503,
      "Issue execution approval is not available during this upgrade",
      "ISSUE_EXECUTION_APPROVAL_UNAVAILABLE",
    );
  }
  const targetProjectId = resolveChannelProposalTargetProjectId({
    requestedProjectId: request.projectId,
    proposedProjectId: proposal.project_id,
    defaultProjectId: channel.default_project_id,
  });
  if (!targetProjectId) {
    throw new HttpError(400, "A target project is required");
  }
  const organizationProject = await getOrganizationProject(
    input.db,
    channel.organization_id,
    targetProjectId,
  );
  if (!organizationProject) throw new HttpError(404, "Project not found");
  const project = await getProject(input.db, targetProjectId, input.userId);
  if (!project || project.organization_id !== channel.organization_id) {
    throw new HttpError(404, "Project not found");
  }
  if (batchPayload) {
    const acceptedBatchResponse = async (
      current: NonNullable<Awaited<ReturnType<typeof getChannelActionProposal>>>,
      outcome: "accepted" | "already_accepted",
    ) => {
      if (!current.project_id || !current.result_run_id) {
        throw new HttpError(409, "Accepted batch proposal is missing its result");
      }
      const resultItems = await listChannelIssueBatchItems(input.db, current.id);
      if (
        resultItems.length !== batchPayload.batch.items.length ||
        resultItems.some((item, index) =>
          item.localKey !== batchPayload.batch.items[index]?.key
        )
      ) {
        throw new HttpError(409, "Accepted batch proposal mapping is incomplete");
      }
      return {
        outcome,
        projectId: current.project_id,
        resultRunId: current.result_run_id,
        resultItems,
        executionProposal: null,
      };
    };
    if (proposal.status === "accepted") {
      return acceptedBatchResponse(proposal, "already_accepted");
    }
    if (channel.archived_at) {
      throw new HttpError(409, "Channel is archived");
    }
    const approvedAt = new Date().toISOString();
    const reservation = await reserveChannelActionProposalApproval(input.db, {
      organizationId: channel.organization_id,
      channelId: channel.id,
      proposalId: proposal.id,
      projectId: project.id,
      userId: input.userId,
      approvedAt,
      issueSourceKey: newChannelBatchProposalIssueSourceKey(),
    });
    if (!reservation) {
      const current = await getChannelActionProposal(
        input.db,
        channel.id,
        proposal.id,
      );
      if (current?.status === "accepted") {
        return acceptedBatchResponse(current, "already_accepted");
      }
      if (
        current?.status === "pending" && current.project_id &&
        current.project_id !== project.id
      ) {
        throw new HttpError(
          409,
          "The proposal was already approved for another project",
        );
      }
      throw new HttpError(409, "Proposal changed");
    }
    try {
      await materializeChannelIssueBatch({
        db: input.db,
        project,
        organizationId: channel.organization_id,
        channelId: channel.id,
        proposalId: proposal.id,
        messageId: proposal.reply_message_id,
        rootMessageId: proposal.reply_parent_message_id,
        proposalPayloadJson: proposal.payload_json,
        proposalCreatedAt: proposal.created_at,
        approvedAt: reservation.accepted_at,
        approvedByUserId: reservation.accepted_by_user_id,
        reservationSourceKey: reservation.issue_source_key,
        batch: batchPayload.batch,
      });
    } catch (error) {
      const current = await getChannelActionProposal(
        input.db,
        channel.id,
        proposal.id,
      );
      if (current?.status === "accepted") {
        return acceptedBatchResponse(current, "already_accepted");
      }
      throw error;
    }
    const finalized = await getChannelActionProposal(
      input.db,
      channel.id,
      proposal.id,
    );
    if (
      finalized?.status !== "accepted" ||
      finalized.project_id !== project.id ||
      finalized.issue_source_key !== reservation.issue_source_key
    ) {
      throw new HttpError(409, "Batch proposal approval was not finalized");
    }
    return acceptedBatchResponse(finalized, "accepted");
  }
  if (proposal.status === "accepted") {
    if (!proposal.project_id || !proposal.result_run_id) {
      throw new HttpError(409, "Accepted proposal is missing its result");
    }
    const executionProposal = proposal.execution_proposal_id
      ? await getChannelExecutionProposal(input.db, {
          organizationId: channel.organization_id,
          channelId: channel.id,
          proposalId: proposal.execution_proposal_id,
          userId: input.userId,
        })
      : null;
    if (request.execution) {
      if (!executionProposal) {
        throw new HttpError(
          409,
          "The created issue has no retryable execution proposal",
          "CHANNEL_EXECUTION_PROPOSAL_STALE",
        );
      }
      const execution = await approveChannelExecutionProposalRequest({
        db: input.db,
        channel,
        project,
        proposal: executionProposal,
        userId: input.userId,
        selection: request.execution,
      });
      return {
        outcome: "already_accepted" as const,
        projectId: proposal.project_id,
        resultRunId: proposal.result_run_id,
        executionProposal: execution.proposal,
        dispatch: execution.dispatch,
      };
    }
    return {
      outcome: "already_accepted" as const,
      projectId: proposal.project_id,
      resultRunId: proposal.result_run_id,
      executionProposal: liveIssueExecutionProposalJson(executionProposal),
    };
  }
  if (channel.archived_at) {
    throw new HttpError(409, "Channel is archived");
  }
  const payload = decodeChannelIssueProposalPayload(rawProposalPayload);
  const approvedAt = new Date().toISOString();
  if (request.execution) {
    decodeExecutionPreferences({
      provider: request.execution.provider,
      model: request.execution.model,
      effort: request.execution.effort,
    });
    try {
      await assertExecutionSelectionAvailable(
        input.db,
        channel.organization_id,
        project.id,
        { ...request.execution, observedAt: approvedAt },
      );
    } catch (error) {
      if (error instanceof WorkerConflictError) {
        throw new HttpError(
          409,
          error.message,
          "CHANNEL_EXECUTION_PROPOSAL_CONFLICT",
        );
      }
      throw error;
    }
  }
  const reservation = await reserveChannelActionProposalApproval(input.db, {
    organizationId: channel.organization_id,
    channelId: channel.id,
    proposalId: proposal.id,
    projectId: project.id,
    userId: input.userId,
    approvedAt,
    issueSourceKey: newChannelProposalIssueSourceKey(),
  });
  if (!reservation) {
    const current = await getChannelActionProposal(
      input.db,
      channel.id,
      proposal.id,
    );
    if (
      current?.status === "accepted" &&
      current.project_id &&
      current.result_run_id
    ) {
      const executionProposal = current.execution_proposal_id
        ? await getChannelExecutionProposal(input.db, {
            organizationId: channel.organization_id,
            channelId: channel.id,
            proposalId: current.execution_proposal_id,
            userId: input.userId,
          })
        : null;
      if (request.execution) {
        if (!executionProposal) {
          throw new HttpError(
            409,
            "The created issue has no retryable execution proposal",
            "CHANNEL_EXECUTION_PROPOSAL_STALE",
          );
        }
        const execution = await approveChannelExecutionProposalRequest({
          db: input.db,
          channel,
          project,
          proposal: executionProposal,
          userId: input.userId,
          selection: request.execution,
        });
        return {
          outcome: "already_accepted" as const,
          projectId: current.project_id,
          resultRunId: current.result_run_id,
          executionProposal: execution.proposal,
          dispatch: execution.dispatch,
        };
      }
      return {
        outcome: "already_accepted" as const,
        projectId: current.project_id,
        resultRunId: current.result_run_id,
        executionProposal: liveIssueExecutionProposalJson(executionProposal),
      };
    }
    if (
      current?.status === "pending" && current.project_id &&
      current.project_id !== project.id
    ) {
      throw new HttpError(
        409,
        "The proposal was already approved for another project",
      );
    }
    throw new HttpError(409, "Proposal changed");
  }
  const approvedIssue = approvedIssueCreation(payload.issue);
  const resultRunId = await createApprovedChannelProposalIssue({
    db: input.db,
    project,
    organizationId: channel.organization_id,
    sourceKey: reservation.issue_source_key,
    proposalId: proposal.id,
    channelId: channel.id,
    messageId: proposal.reply_message_id,
    rootMessageId: proposal.reply_parent_message_id,
    title: approvedIssue.title,
    description: approvedIssue.description,
    priority: approvedIssue.priority,
    createdByUserId: reservation.accepted_by_user_id,
    occurredAt: proposal.created_at,
  });
  const finalized = await getChannelActionProposal(
    input.db,
    channel.id,
    proposal.id,
  );
  if (
    finalized?.status !== "accepted" ||
    finalized.project_id !== project.id ||
    finalized.result_run_id !== resultRunId ||
    finalized.issue_source_key !== reservation.issue_source_key
  ) {
    throw new HttpError(409, "Proposal approval was not finalized");
  }
  const executionProposal = finalized.execution_proposal_id
    ? await getChannelExecutionProposal(input.db, {
        organizationId: channel.organization_id,
        channelId: channel.id,
        proposalId: finalized.execution_proposal_id,
        userId: input.userId,
      })
    : null;
  if (request.execution) {
    if (!executionProposal) {
      throw new HttpError(
        409,
        "The created issue has no execution proposal",
        "CHANNEL_EXECUTION_PROPOSAL_STALE",
      );
    }
    const execution = await approveChannelExecutionProposalRequest({
      db: input.db,
      channel,
      project,
      proposal: executionProposal,
      userId: input.userId,
      selection: request.execution,
    });
    return {
      outcome: "accepted" as const,
      projectId: project.id,
      resultRunId,
      executionProposal: execution.proposal,
      dispatch: execution.dispatch,
    };
  }
  return {
    outcome: "accepted" as const,
    projectId: project.id,
    resultRunId,
    executionProposal: liveIssueExecutionProposalJson(executionProposal),
  };
}

export async function handleChannelProposalRoute(
  routeInput: ChannelProposalRouteInput,
): Promise<Response | undefined> {
  const { request, url, auth, db, env } = routeInput;
  const { pathname } = url;

  const channelProposalDeclineMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/proposals\/([0-9a-f-]+)\/decline$/u,
  );
  if (channelProposalDeclineMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    return json(await declineOrganizationChannelProposal({
      db,
      env,
      organizationId: channelProposalDeclineMatch[1],
      channelId: channelProposalDeclineMatch[2],
      proposalId: channelProposalDeclineMatch[3],
      userId: session.user.id,
    }));
  }

  const channelProposalAcceptMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/proposals\/([0-9a-f-]+)\/accept$/u,
  );
  if (channelProposalAcceptMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    return json(await acceptOrganizationChannelProposal({
      db,
      env,
      organizationId: channelProposalAcceptMatch[1],
      channelId: channelProposalAcceptMatch[2],
      proposalId: channelProposalAcceptMatch[3],
      userId: session.user.id,
      request: await readJson(request),
    }));
  }

  const channelSkillExecutionProposalAcceptMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/skill-execution-proposals\/([0-9a-f-]+)\/accept$/u,
  );
  if (channelSkillExecutionProposalAcceptMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    return json(await acceptOrganizationChannelSkillExecutionProposal({
      db,
      env,
      organizationId: channelSkillExecutionProposalAcceptMatch[1],
      channelId: channelSkillExecutionProposalAcceptMatch[2],
      proposalId: channelSkillExecutionProposalAcceptMatch[3],
      userId: session.user.id,
      request: await readJson(request),
    }));
  }

  const channelExecutionProposalAcceptMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/proposals\/([0-9a-f-]+)\/accept-execution$/u,
  );
  if (channelExecutionProposalAcceptMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    return json(await acceptOrganizationChannelExecutionProposal({
      db,
      env,
      organizationId: channelExecutionProposalAcceptMatch[1],
      channelId: channelExecutionProposalAcceptMatch[2],
      proposalId: channelExecutionProposalAcceptMatch[3],
      userId: session.user.id,
      request: await readJson(request),
    }));
  }

  return undefined;
}
