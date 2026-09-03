import { channelExecutionProposalAcceptInputSchema } from "../../src/lib/channels-contract";
import {
  approveAgentSkillExecutionProposal,
} from "./agent-skill-execution-approval";
import { approvedIssueCreation } from "./channel-proposal-helpers";
import {
  acceptIssueCreateProposal,
  acceptIssueReworkProposal,
  acceptIssueUpdateProposal,
  getHuntRunForProject,
  getIssueActionProposal,
  getIssueAgentSkillExecutionProposal,
  getIssueExecutionProposal,
  getIssueReworkProposal,
  getTeam,
  HuntTransitionError,
  listIssueExecutionProposals,
  reserveIssueCreateProposalApproval,
  reserveIssueExecutionProposalApproval,
  reworkHuntRun,
} from "./db";
import { HttpError } from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import {
  issueActionProposalJson,
  issueExecutionProposalJson,
  issueReworkProposalJson,
} from "./issue-conversation-json";
import {
  decodeAgentSkillExecutionProposalAcceptInput,
  decodeExecutionPreferences,
  decodeIssueCreateProposalAction,
  decodeIssueUpdateProposalAction,
} from "./issue-request-contract";
import { createProjectIssue } from "./issue-core-routes";
import { newConversationProposalIssueSourceKey } from "./proposal-issue-source";
import { decodeRequestSync } from "./request-schema";
import { dispatchHuntRun, WorkerConflictError } from "./workers";

const decodeChannelExecutionProposalAcceptInput = decodeRequestSync(
  channelExecutionProposalAcceptInputSchema,
);

type IssueProposalApplicationInput = {
  db: D1Database;
  archivesBucket: R2Bucket;
  projectId: string;
  conversationRunId: string;
  proposalId: string;
  userId: string;
};

async function requireIssueProposalProject(
  input: IssueProposalApplicationInput,
  capability: "issues:execute" | "issues:write",
  deniedMessage: string,
) {
  const project = await getTeam(input.db, input.projectId, input.userId);
  if (!project) throw new HttpError(404, "Project not found");
  if (!hasOrganizationCapability(project.member_role, capability)) {
    throw new HttpError(403, deniedMessage);
  }
  return project;
}

export async function acceptProjectIssueReworkProposal(
  input: IssueProposalApplicationInput,
) {
  const project = await requireIssueProposalProject(
    input,
    "issues:execute",
    "Issue execution permission required",
  );
  const proposal = await getIssueReworkProposal(
    input.db,
    project.id,
    input.conversationRunId,
    input.proposalId,
  );
  if (!proposal) throw new HttpError(404, "Rework proposal not found");
  if (proposal.status === "accepted") {
    return {
      proposal: issueReworkProposalJson(proposal),
      outcome: "already_accepted" as const,
      attempt: proposal.expected_attempt,
      revision: proposal.applied_revision,
      workflowStage: proposal.workflow_stage,
    };
  }
  const acceptedAt = new Date().toISOString();
  try {
    const rework = await reworkHuntRun(input.db, project.id, {
      runId: proposal.run_id,
      workflowStage: proposal.workflow_stage,
      requestId: proposal.id,
      actor: `briar-app:${input.userId}`,
      reason: proposal.reason,
      occurredAt: acceptedAt,
      completed: {
        expectedAttempt: proposal.expected_attempt,
        expectedRevision: proposal.expected_revision,
      },
    });
    if (rework.outcome === "not_found" || rework.revision === null) {
      throw new HttpError(404, "Run not found");
    }
    const accepted = await acceptIssueReworkProposal(input.db, {
      projectId: project.id,
      runId: proposal.run_id,
      proposalId: proposal.id,
      userId: input.userId,
      acceptedAt,
      appliedRevision: rework.revision,
    }) ?? await getIssueReworkProposal(
      input.db,
      project.id,
      proposal.run_id,
      proposal.id,
    );
    if (!accepted) throw new HttpError(409, "Rework proposal changed");
    return {
      proposal: issueReworkProposalJson(accepted),
      outcome: rework.outcome === "already_reworked"
        ? "already_accepted" as const
        : "accepted" as const,
      attempt: rework.attempt,
      revision: rework.revision,
      workflowStage: rework.workflowStage,
    };
  } catch (error) {
    if (error instanceof HuntTransitionError) {
      throw new HttpError(409, error.message, "REWORK_PROPOSAL_CONFLICT");
    }
    throw error;
  }
}

export async function acceptProjectIssueActionProposal(
  input: IssueProposalApplicationInput,
) {
  const project = await requireIssueProposalProject(
    input,
    "issues:write",
    "Issue editing permission required",
  );
  const proposal = await getIssueActionProposal(
    input.db,
    project.id,
    input.conversationRunId,
    input.proposalId,
  );
  if (!proposal) throw new HttpError(404, "Issue action proposal not found");
  const acceptedResponse = async (
    accepted: NonNullable<Awaited<ReturnType<typeof getIssueActionProposal>>>,
  ) => {
    const executionProposal = (await listIssueExecutionProposals(
      input.db,
      project.id,
      accepted.conversation_run_id,
    )).find(
      (candidate) => candidate.origin_create_proposal_id === accepted.id,
    ) ?? null;
    return {
      proposal: issueActionProposalJson(accepted),
      executionProposal: executionProposal
        ? issueExecutionProposalJson(executionProposal)
        : null,
      outcome: "already_accepted" as const,
      resultRunId: accepted.result_run_id,
    };
  };
  if (proposal.status === "accepted") return acceptedResponse(proposal);

  const acceptedAt = new Date().toISOString();
  const rawPayload = JSON.parse(proposal.payload_json);
  if (proposal.action_type === "request_issue_update") {
    const action = decodeIssueUpdateProposalAction({
      type: proposal.action_type,
      ...rawPayload,
    });
    const run = await getHuntRunForProject(
      input.db,
      project.id,
      proposal.conversation_run_id,
    );
    if (!run) throw new HttpError(404, "Run not found");
    const hasDescription = Object.hasOwn(action.changes, "description");
    const hasPriority = Object.hasOwn(action.changes, "priority");
    const accepted = await acceptIssueUpdateProposal(input.db, {
      projectId: project.id,
      conversationRunId: proposal.conversation_run_id,
      proposalId: proposal.id,
      userId: input.userId,
      acceptedAt,
      title: action.changes.title ?? run.title,
      description: hasDescription
        ? action.changes.description ?? null
        : run.issue_description,
      priority: hasPriority ? action.changes.priority ?? null : run.priority,
    });
    if (!accepted) {
      throw new HttpError(
        409,
        "The issue changed after this proposal was created",
        "ISSUE_ACTION_PROPOSAL_CONFLICT",
      );
    }
    return {
      proposal: issueActionProposalJson(accepted),
      outcome: "accepted" as const,
      resultRunId: accepted.result_run_id,
    };
  }

  const action = decodeIssueCreateProposalAction({
    type: proposal.action_type,
    ...rawPayload,
    executeAfterCreate: proposal.execute_after_create === 1,
  });
  const reservation = await reserveIssueCreateProposalApproval(input.db, {
    projectId: project.id,
    conversationRunId: proposal.conversation_run_id,
    proposalId: proposal.id,
    userId: input.userId,
    reservedAt: acceptedAt,
    issueSourceKey: newConversationProposalIssueSourceKey(),
  });
  if (!reservation) {
    const latest = await getIssueActionProposal(
      input.db,
      project.id,
      proposal.conversation_run_id,
      proposal.id,
    );
    if (latest?.status === "accepted") return acceptedResponse(latest);
    throw new HttpError(
      409,
      "This issue proposal is being accepted by another member",
      "ISSUE_ACTION_PROPOSAL_CONFLICT",
    );
  }
  if (
    !reservation.issue_source_key ||
    !reservation.approval_reserved_by_user_id
  ) {
    throw new HttpError(
      409,
      "This issue proposal has no approval identity",
      "ISSUE_ACTION_PROPOSAL_CONFLICT",
    );
  }
  let created: Awaited<ReturnType<typeof createProjectIssue>>;
  try {
    created = await createProjectIssue({
      db: input.db,
      projectId: project.id,
      userId: reservation.approval_reserved_by_user_id,
      clientIssueId: proposal.id,
      request: approvedIssueCreation(action.issue),
      attachmentIds: [],
      attribution: {
        sourceKey: reservation.issue_source_key,
        actor: "briar-conversation",
        detail: "대화창에서 사용자가 승인한 제안으로 생성된 이슈입니다.",
        context: {
          origin: "briar-conversation",
          proposalId: proposal.id,
          conversationRunId: proposal.conversation_run_id,
        },
      },
    });
  } catch (error) {
    if (
      error instanceof Error && error.message.includes(
        "conversation proposal no longer belongs to project",
      )
    ) {
      throw new HttpError(
        409,
        "The conversation moved before this proposal could be accepted",
        "ISSUE_ACTION_PROPOSAL_CONFLICT",
      );
    }
    throw error;
  }
  const finalized = await acceptIssueCreateProposal(input.db, {
    projectId: project.id,
    conversationRunId: proposal.conversation_run_id,
    proposalId: proposal.id,
    userId: input.userId,
    acceptedAt,
    resultRunId: created.runId,
  });
  const accepted = finalized ?? await getIssueActionProposal(
    input.db,
    project.id,
    proposal.conversation_run_id,
    proposal.id,
  );
  if (
    !accepted || accepted.status !== "accepted" ||
    accepted.result_run_id !== created.runId
  ) {
    throw new HttpError(
      409,
      "The created issue is not eligible for this approval",
      "ISSUE_ACTION_PROPOSAL_CONFLICT",
    );
  }
  const executionProposal = (await listIssueExecutionProposals(
    input.db,
    project.id,
    accepted.conversation_run_id,
  )).find(
    (candidate) => candidate.origin_create_proposal_id === accepted.id,
  ) ?? null;
  return {
    proposal: issueActionProposalJson(accepted),
    executionProposal: executionProposal
      ? issueExecutionProposalJson(executionProposal)
      : null,
    outcome: accepted.accepted_at !== acceptedAt
      ? "already_accepted" as const
      : "accepted" as const,
    resultRunId: accepted.result_run_id,
  };
}

export async function acceptProjectIssueSkillExecutionProposal(
  input: IssueProposalApplicationInput & { request: unknown },
) {
  const project = await requireIssueProposalProject(
    input,
    "issues:execute",
    "Issue execution permission required",
  );
  const loadProposal = () => getIssueAgentSkillExecutionProposal(
    input.db,
    project.id,
    input.conversationRunId,
    input.proposalId,
  );
  const proposal = await loadProposal();
  if (!proposal) {
    throw new HttpError(404, "Agent Skill execution proposal not found");
  }
  const request = decodeAgentSkillExecutionProposalAcceptInput(input.request);
  return approveAgentSkillExecutionProposal(
    input.db,
    input.archivesBucket,
    proposal,
    {
      sourceKind: "issue",
      userId: input.userId,
      workerId: request.workerId,
      staleCode: "ISSUE_SKILL_EXECUTION_PROPOSAL_STALE",
      conflictCode: "ISSUE_SKILL_EXECUTION_PROPOSAL_CONFLICT",
      reload: loadProposal,
    },
  );
}

export async function acceptProjectIssueExecutionProposal(
  input: IssueProposalApplicationInput & { request: unknown },
) {
  const project = await requireIssueProposalProject(
    input,
    "issues:execute",
    "Issue execution permission required",
  );
  const proposal = await getIssueExecutionProposal(
    input.db,
    project.id,
    input.conversationRunId,
    input.proposalId,
  );
  if (!proposal) throw new HttpError(404, "Execution proposal not found");
  const request = decodeChannelExecutionProposalAcceptInput(input.request);
  decodeExecutionPreferences({
    provider: request.provider,
    model: request.model,
    effort: request.effort,
  });
  const run = await getHuntRunForProject(
    input.db,
    project.id,
    proposal.target_run_id,
  );
  if (proposal.status === "accepted") {
    if (
      proposal.accepted_by_user_id !== input.userId ||
      proposal.requested_provider !== request.provider ||
      proposal.requested_model !== request.model ||
      proposal.requested_effort !== request.effort ||
      proposal.requested_worker_id !== request.workerId
    ) {
      throw new HttpError(
        409,
        "Execution was approved with different settings or by another member",
        "ISSUE_EXECUTION_PROPOSAL_CONFLICT",
      );
    }
    if (
      !run || !proposal.dispatch_request_id ||
      run.dispatch_request_id !== proposal.dispatch_request_id
    ) {
      throw new HttpError(
        409,
        "This execution approval is stale; request a new approval",
        "ISSUE_EXECUTION_PROPOSAL_STALE",
      );
    }
    return {
      proposal: issueExecutionProposalJson(proposal),
      outcome: "already_accepted" as const,
      projectId: proposal.project_id,
      runId: proposal.target_run_id,
      dispatch: {
        runId: proposal.target_run_id,
        agentId: proposal.proposed_by_agent_id,
        provider: proposal.requested_provider,
        model: proposal.requested_model,
        effort: proposal.requested_effort,
        requestedWorkerId: proposal.requested_worker_id,
        requestedByUserId: proposal.accepted_by_user_id,
        dispatchMode: proposal.requested_worker_id ? "specific" : "any",
        dispatchedAt: proposal.accepted_at,
        outcome: "already_dispatched" as const,
      },
    };
  }
  if (proposal.status !== "pending") {
    throw new HttpError(
      409,
      "This execution proposal is no longer valid",
      "ISSUE_EXECUTION_PROPOSAL_STALE",
    );
  }
  const acceptedAt = new Date().toISOString();
  const reservation = await reserveIssueExecutionProposalApproval(input.db, {
    projectId: project.id,
    conversationRunId: proposal.conversation_run_id!,
    proposalId: proposal.id,
    userId: input.userId,
    provider: request.provider,
    model: request.model,
    effort: request.effort,
    workerId: request.workerId,
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
      "ISSUE_EXECUTION_PROPOSAL_CONFLICT",
    );
  }
  try {
    const dispatched = await dispatchHuntRun(
      input.db,
      project.organization_id,
      project.id,
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
    const accepted = await getIssueExecutionProposal(
      input.db,
      reservation.project_id,
      reservation.conversation_run_id!,
      reservation.id,
    );
    if (
      !accepted || accepted.status !== "accepted" ||
      accepted.dispatch_request_id !== reservation.dispatch_request_id
    ) {
      throw new HttpError(
        409,
        "Execution approval was not finalized",
        "ISSUE_EXECUTION_PROPOSAL_CONFLICT",
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
        "ISSUE_EXECUTION_PROPOSAL_CONFLICT",
      );
    }
    throw error;
  }
}
