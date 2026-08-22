import type { AgentSkillExecutionProposalRow } from "./agent-skill-execution-proposal-repository";
import {
  acceptAgentSkillExecutionProposal,
  getAgentSkillExecutionApprovalAudit,
} from "./agent-skill-execution-proposal-repository";
import { getArchivedProjectAgentSession } from "./archive";
import { HttpError } from "./http-response";
import { projectAgentSessionJson } from "./project-agent-session-json";
import {
  getProjectAgentSession,
  upsertProjectAgentSessionSummary,
} from "./project-agent-session-repository";
import {
  availableExecutionWorkerForAgentSkill,
  WorkerConflictError,
} from "./workers";

export const agentSkillExecutionProposalJson = (
  proposal: AgentSkillExecutionProposalRow,
) => {
  if (proposal.status !== "pending" && proposal.status !== "accepted") {
    throw new Error(
      "Invalidated Agent Skill execution proposals cannot be serialized",
    );
  }
  return {
    id: proposal.id,
    type: "request_agent_skill_execute" as const,
    status: proposal.status,
    projectId: proposal.project_id,
    agentId: proposal.agent_id,
    agentName: proposal.agent_name,
    skillId: proposal.skill_id,
    skillName: proposal.skill_name,
    provider: proposal.provider,
    model: proposal.model,
    effort: proposal.effort,
    request: proposal.request,
    delegatedByAgentId: proposal.delegated_by_agent_id,
    delegatedByAgentName: proposal.delegated_by_agent_name,
    requestedWorkerId: proposal.requested_worker_id,
    requestedWorkerLabel: proposal.requested_worker_label,
    resultSessionId: proposal.result_session_id,
    createdAt: proposal.created_at,
    acceptedAt: proposal.accepted_at,
  };
};

export async function approveAgentSkillExecutionProposal(
  db: D1Database,
  archives: Parameters<typeof getArchivedProjectAgentSession>[1],
  proposal: AgentSkillExecutionProposalRow,
  input: {
    sourceKind: "channel" | "issue";
    userId: string;
    workerId: string;
    staleCode:
      | "CHANNEL_SKILL_EXECUTION_PROPOSAL_STALE"
      | "ISSUE_SKILL_EXECUTION_PROPOSAL_STALE";
    conflictCode:
      | "CHANNEL_SKILL_EXECUTION_PROPOSAL_CONFLICT"
      | "ISSUE_SKILL_EXECUTION_PROPOSAL_CONFLICT";
    reload: () => Promise<AgentSkillExecutionProposalRow | null>;
  },
) {
  const stale = (message = "This Agent Skill execution proposal is stale") =>
    new HttpError(409, message, input.staleCode);
  const conflict = (
    message = "Agent Skill execution was approved by another member or Worker",
  ) => new HttpError(409, message, input.conflictCode);
  const acceptedResponse = async (
    current: AgentSkillExecutionProposalRow,
    outcome: "accepted" | "already_accepted",
  ) => {
    if (
      current.status !== "accepted" ||
      current.accepted_by_user_id !== input.userId ||
      current.requested_worker_id !== input.workerId
    ) {
      throw conflict();
    }
    if (!current.result_session_id || !current.requested_worker_label) {
      throw stale("The approved Agent Skill execution lost its task session");
    }
    const approval = await getAgentSkillExecutionApprovalAudit(
      db,
      current.project_id,
      current.id,
    );
    if (
      !approval ||
      approval.organization_id !== current.organization_id ||
      approval.source_kind !== current.source_kind ||
      approval.channel_id !== current.channel_id ||
      approval.conversation_run_id !== current.conversation_run_id ||
      approval.trigger_message_id !== current.trigger_message_id ||
      approval.reply_message_id !== current.reply_message_id ||
      approval.source_reply_job_id !== current.source_reply_job_id ||
      approval.delegated_by_reply_job_id !== current.delegated_by_reply_job_id ||
      approval.agent_id !== current.agent_id ||
      approval.agent_name !== current.agent_name ||
      approval.agent_responsibility !== current.agent_responsibility ||
      approval.skill_id !== current.skill_id ||
      approval.skill_name !== current.skill_name ||
      approval.skill_instructions !== current.skill_instructions ||
      approval.skill_kind !== current.skill_kind ||
      approval.provider !== current.provider ||
      approval.model !== current.model ||
      approval.effort !== current.effort ||
      approval.request !== current.request ||
      approval.worker_id !== current.requested_worker_id ||
      approval.worker_label !== current.requested_worker_label ||
      approval.result_session_id !== current.result_session_id ||
      approval.approved_by_user_id !== current.accepted_by_user_id ||
      approval.approved_at !== current.accepted_at ||
      approval.delegated_by_agent_id !== current.delegated_by_agent_id ||
      approval.delegated_by_agent_name !== current.delegated_by_agent_name
    ) {
      throw stale("The approved Agent Skill execution audit is invalid");
    }
    const session = await getProjectAgentSession(
      db,
      current.project_id,
      current.result_session_id,
    ) ?? await getArchivedProjectAgentSession(
      db,
      archives,
      current.project_id,
      current.result_session_id,
    );
    if (!session) {
      throw stale("The approved Agent Skill execution session was not found");
    }
    let sessionPayload: Record<string, unknown>;
    try {
      sessionPayload = JSON.parse(session.payload_json) as Record<
        string,
        unknown
      >;
    } catch {
      throw stale("The approved Agent Skill execution session is invalid");
    }
    if (
      session.id !== current.result_session_id ||
      session.project_id !== current.project_id ||
      session.agent_id !== current.agent_id ||
      session.requested_by_user_id !== current.accepted_by_user_id ||
      session.session_type !== "task" ||
      sessionPayload.dispatchGroupId !== current.result_session_id ||
      sessionPayload.agentId !== current.agent_id ||
      sessionPayload.agentName !== current.agent_name ||
      sessionPayload.skillId !== current.skill_id ||
      sessionPayload.sessionType !== "task" ||
      sessionPayload.trigger !== "manual" ||
      sessionPayload.request !== current.request ||
      sessionPayload.requestedWorkerId !== current.requested_worker_id ||
      sessionPayload.workerId !== current.requested_worker_id ||
      sessionPayload.requestedByUserId !== current.accepted_by_user_id
    ) {
      throw stale(
        "The approved Agent Skill execution session lost its Worker binding",
      );
    }
    await upsertProjectAgentSessionSummary(db, session, false);
    return {
      outcome,
      proposal: agentSkillExecutionProposalJson(current),
      projectId: current.project_id,
      session: projectAgentSessionJson(session),
    };
  };

  if (proposal.status === "accepted") {
    return acceptedResponse(proposal, "already_accepted");
  }
  if (proposal.status !== "pending") throw stale();

  const acceptedAt = new Date().toISOString();
  let worker: Awaited<ReturnType<typeof availableExecutionWorkerForAgentSkill>>;
  try {
    worker = await availableExecutionWorkerForAgentSkill(db, {
      organizationId: proposal.organization_id,
      projectId: proposal.project_id,
      workerId: input.workerId,
      provider: proposal.provider,
      observedAt: acceptedAt,
    });
  } catch (error) {
    if (error instanceof WorkerConflictError) {
      throw conflict(error.message);
    }
    throw error;
  }

  let accepted: AgentSkillExecutionProposalRow | null = null;
  try {
    accepted = await acceptAgentSkillExecutionProposal(db, {
      proposalId: proposal.id,
      sourceKind: input.sourceKind,
      organizationId: proposal.organization_id,
      projectId: proposal.project_id,
      channelId: proposal.channel_id,
      conversationRunId: proposal.conversation_run_id,
      userId: input.userId,
      workerId: worker.id,
      workerLabel: worker.label,
      resultSessionId: crypto.randomUUID(),
      acceptedAt,
    });
  } catch (error) {
    const current = await input.reload();
    if (current?.status === "accepted") {
      return acceptedResponse(current, "already_accepted");
    }
    if (
      error instanceof Error &&
      error.message.includes("Agent Skill execution proposal is stale")
    ) {
      throw stale(error.message);
    }
    if (error instanceof WorkerConflictError) {
      throw conflict(error.message);
    }
    throw error;
  }
  if (!accepted) {
    const current = await input.reload();
    if (current?.status === "accepted") {
      return acceptedResponse(current, "already_accepted");
    }
    throw stale("The Agent Skill execution proposal changed before approval");
  }
  return acceptedResponse(accepted, "accepted");
}
