import { type AgentSkillKind } from "./agent-skills";

import { agentSkillExecutionApprovalTablesAvailable } from "./execution-approval-schema-repository";
import {
  type ModelEffort,
  type ProjectAgentProvider,
} from "./project-agent-model";

export type AgentSkillExecutionProposalRow = {
  id: string;
  organization_id: string;
  project_id: string;
  source_kind: "channel" | "issue";
  channel_id: string | null;
  conversation_run_id: string | null;
  trigger_message_id: string;
  reply_message_id: string;
  source_reply_job_id: string;
  delegated_by_reply_job_id: string | null;
  agent_id: string;
  agent_name: string;
  agent_responsibility: string;
  skill_id: string;
  skill_name: string;
  skill_instructions: string;
  skill_kind: AgentSkillKind;
  provider: ProjectAgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  request: string;
  delegated_by_agent_id: string | null;
  delegated_by_agent_name: string | null;
  generation: number;
  status: "pending" | "accepted" | "invalidated";
  requested_worker_id: string | null;
  requested_worker_label: string | null;
  result_session_id: string | null;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentSkillExecutionApprovalAuditRow = {
  id: string;
  proposal_id: string;
  organization_id: string;
  project_id: string;
  source_kind: "channel" | "issue";
  channel_id: string | null;
  conversation_run_id: string | null;
  trigger_message_id: string;
  reply_message_id: string;
  source_reply_job_id: string;
  delegated_by_reply_job_id: string | null;
  agent_id: string;
  agent_name: string;
  agent_responsibility: string;
  skill_id: string;
  skill_name: string;
  skill_instructions: string;
  skill_kind: AgentSkillKind;
  provider: ProjectAgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  request: string;
  worker_id: string;
  worker_label: string;
  result_session_id: string;
  approved_by_user_id: string | null;
  approved_at: string;
  delegated_by_agent_id: string | null;
  delegated_by_agent_name: string | null;
  created_at: string;
};

export async function listIssueAgentSkillExecutionProposals(
  db: D1Database,
  projectId: string,
  conversationRunId: string,
) {
  if (!(await agentSkillExecutionApprovalTablesAvailable(db))) return [];
  const rows = await db
    .prepare(
      `select proposal.*
       from briar_agent_skill_execution_proposals proposal
       join briar_hunt_runs conversation
         on conversation.id = proposal.conversation_run_id
        and conversation.project_id = proposal.project_id
       where proposal.source_kind = 'issue'
         and proposal.project_id = ? and proposal.conversation_run_id = ?
         and proposal.status in ('pending', 'accepted')
       order by proposal.created_at, proposal.id`,
    )
    .bind(projectId, conversationRunId)
    .all<AgentSkillExecutionProposalRow>();
  return rows.results;
}

export async function getIssueAgentSkillExecutionProposal(
  db: D1Database,
  projectId: string,
  conversationRunId: string,
  proposalId: string,
) {
  return db
    .prepare(
      `select proposal.*
       from briar_agent_skill_execution_proposals proposal
       join briar_hunt_runs conversation
         on conversation.id = proposal.conversation_run_id
        and conversation.project_id = proposal.project_id
       where proposal.id = ? and proposal.source_kind = 'issue'
         and proposal.project_id = ? and proposal.conversation_run_id = ?`,
    )
    .bind(proposalId, projectId, conversationRunId)
    .first<AgentSkillExecutionProposalRow>();
}

export async function getAgentSkillExecutionApprovalAudit(
  db: D1Database,
  projectId: string,
  proposalId: string,
) {
  return db
    .prepare(
      `select * from briar_agent_skill_execution_approval_audit
       where project_id = ? and proposal_id = ?`,
    )
    .bind(projectId, proposalId)
    .first<AgentSkillExecutionApprovalAuditRow>();
}

export async function acceptAgentSkillExecutionProposal(
  db: D1Database,
  input: {
    proposalId: string;
    sourceKind: "channel" | "issue";
    organizationId: string;
    projectId: string;
    channelId: string | null;
    conversationRunId: string | null;
    userId: string;
    workerId: string;
    workerLabel: string;
    resultSessionId: string;
    acceptedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_agent_skill_execution_proposals
       set status = 'accepted', requested_worker_id = ?,
           requested_worker_label = ?, result_session_id = ?,
           accepted_by_user_id = ?, accepted_at = ?, updated_at = ?
       where id = ? and source_kind = ? and organization_id = ?
         and project_id = ? and channel_id is ? and conversation_run_id is ?
         and status = 'pending'
       returning *`,
    )
    .bind(
      input.workerId,
      input.workerLabel,
      input.resultSessionId,
      input.userId,
      input.acceptedAt,
      input.acceptedAt,
      input.proposalId,
      input.sourceKind,
      input.organizationId,
      input.projectId,
      input.channelId,
      input.conversationRunId,
    )
    .first<AgentSkillExecutionProposalRow>();
}
