import type { AgentSkillExecutionProposalRow } from "./agent-skill-execution-proposal-repository";
import {
  acceptAgentSkillExecutionProposal,
  acceptConversationAgentSkillExecutionProposal,
  getAgentSkillExecutionApprovalAudit,
} from "./agent-skill-execution-proposal-repository";
import { getArchivedProjectAgentSession } from "./archive";
import { HttpError } from "./http-response";
import { projectAgentSessionJson } from "./project-agent-session-json";
import { decodeStoredProjectAgentSessionPayload } from "./project-request-contract";
import {
  getProjectAgentSession,
  upsertProjectAgentSessionSummary,
} from "./project-agent-session-repository";
import {
  availableExecutionWorkerForAgentSkill,
  listExecutionWorkers,
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
    executionMode: proposal.execution_mode,
    approvalPolicy: proposal.approval_policy,
    executionStatus: proposal.execution_status ??
      (proposal.status === "pending" ? "waiting" : "running"),
    request: proposal.request,
    delegatedByAgentId: proposal.delegated_by_agent_id,
    delegatedByAgentName: proposal.delegated_by_agent_name,
    requestedWorkerId: proposal.requested_worker_id,
    requestedWorkerLabel: proposal.requested_worker_label,
    resultSessionId: proposal.result_session_id,
    resultMessageId: proposal.result_message_id,
    error: proposal.execution_error ?? null,
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
    workerId?: string;
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
      (input.workerId && current.requested_worker_id !== input.workerId)
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
      approval.execution_mode !== current.execution_mode ||
      approval.approval_policy !== current.approval_policy ||
      approval.thread_root_message_id !== current.thread_root_message_id ||
      approval.request !== current.request ||
      approval.worker_id !== current.requested_worker_id ||
      approval.worker_label !== current.requested_worker_label ||
      approval.result_session_id !== current.result_session_id ||
      approval.result_reply_job_id !== current.result_reply_job_id ||
      (current.execution_mode === "conversation" &&
        approval.result_message_id !== current.result_message_id) ||
      approval.approved_by_user_id !== current.accepted_by_user_id ||
      approval.approved_at !== current.accepted_at ||
      approval.delegated_by_agent_id !== current.delegated_by_agent_id ||
      approval.delegated_by_agent_name !== current.delegated_by_agent_name
    ) {
      throw stale("The approved Agent Skill execution audit is invalid");
    }
    if (current.execution_mode === "conversation") {
      const conversation = await db.prepare(
        `select session.id, reply.status as reply_status
         from briar_channel_reply_sessions session
         join briar_channel_agent_reply_jobs reply
           on reply.id = ? and reply.session_id = session.id
         where session.id = ? and session.channel_id = ?
           and session.thread_root_message_id = ? and session.agent_id = ?`,
      ).bind(
        current.result_reply_job_id,
        current.result_session_id,
        current.channel_id,
        current.thread_root_message_id,
        current.agent_id,
      ).first<{ id: string; reply_status: string }>();
      if (!conversation) {
        throw stale("The approved conversation Skill execution was not found");
      }
      return {
        outcome,
        proposal: agentSkillExecutionProposalJson({
          ...current,
          execution_status: conversation.reply_status === "completed"
            ? "completed"
            : conversation.reply_status === "failed"
              ? "failed"
              : "running",
        }),
        projectId: current.project_id,
        session: null,
      };
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
    let sessionPayload: ReturnType<
      typeof decodeStoredProjectAgentSessionPayload
    >;
    try {
      sessionPayload = decodeStoredProjectAgentSessionPayload(
        session.payload_json,
      );
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
  if (
    proposal.execution_mode === "conversation" &&
    (proposal.source_kind !== "channel" || !proposal.channel_id ||
      !proposal.thread_root_message_id)
  ) {
    throw stale(
      "Conversation Skill execution requires its original channel thread context",
    );
  }
  const conversationBinding = proposal.execution_mode === "conversation"
    ? await db.prepare(
      `select session.id as session_id,
              session.owner_worker_id as owner_worker_id,
              source.claimed_worker_id as source_worker_id,
              session.provider as provider,
              session.model as model,
              session.effort as effort
       from briar_channel_agent_reply_jobs source
       join briar_channel_reply_sessions session on session.id = source.session_id
       where source.id = ? and source.status = 'completed'
         and session.channel_id = ? and session.thread_root_message_id = ?
         and session.agent_id = ?`,
    ).bind(
      proposal.source_reply_job_id,
      proposal.channel_id,
      proposal.thread_root_message_id,
      proposal.agent_id,
    ).first<{
      session_id: string;
      owner_worker_id: string | null;
      source_worker_id: string | null;
      provider: AgentSkillExecutionProposalRow["provider"];
      model: string | null;
      effort: AgentSkillExecutionProposalRow["effort"];
    }>()
    : null;
  if (proposal.execution_mode === "conversation" && !conversationBinding) {
    throw stale(
      "The original conversation session is no longer available",
    );
  }
  if (proposal.execution_mode === "task" && !input.workerId) {
    throw stale("Choose a Worker before approving this Agent Skill");
  }
  const candidateWorkerIds = proposal.execution_mode === "conversation"
    ? [...new Set([
      conversationBinding!.owner_worker_id,
      conversationBinding!.source_worker_id,
      ...(await listExecutionWorkers(db, proposal.project_id, acceptedAt))
        .map((candidate) => candidate.id),
    ].filter((candidate): candidate is string => Boolean(candidate)))]
    : [input.workerId!];
  let worker: Awaited<
    ReturnType<typeof availableExecutionWorkerForAgentSkill>
  > | null = null;
  let workerConflict: WorkerConflictError | null = null;
  const runtimeProvider = proposal.execution_mode === "conversation"
    ? conversationBinding!.provider
    : proposal.provider;
  for (const workerId of candidateWorkerIds) {
    try {
      worker = await availableExecutionWorkerForAgentSkill(db, {
        organizationId: proposal.organization_id,
        projectId: proposal.project_id,
        workerId,
        provider: runtimeProvider,
        observedAt: acceptedAt,
      });
      break;
    } catch (error) {
      if (!(error instanceof WorkerConflictError)) throw error;
      workerConflict = error;
    }
  }
  if (!worker) {
    throw conflict(
      workerConflict?.message ??
        "No available Worker can restore this conversation Skill",
    );
  }

  let accepted: AgentSkillExecutionProposalRow | null = null;
  try {
    accepted = proposal.execution_mode === "conversation"
      ? await acceptConversationAgentSkillExecutionProposal(db, {
        proposal,
        userId: input.userId,
        workerId: worker.id,
        workerLabel: worker.label,
        resultSessionId: conversationBinding!.session_id,
        resultReplyJobId: crypto.randomUUID(),
        resultMessageId: crypto.randomUUID(),
        acceptedAt,
      })
      : await acceptAgentSkillExecutionProposal(db, {
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
