import { issueAttachmentReferences } from "../../src/lib/issue-markdown";
import { agentProviderLabels } from "../../src/lib/agent-provider";
import { agentSkillExecutionProposalJson } from "./agent-skill-execution-approval";
import type {
  AgentSkillExecutionProposalRow,
  ChannelConversationNotificationRow,
  IssueActionProposalRow,
  IssueAgentReplyJobRow,
  IssueAttachmentRow,
  IssueConversationNotificationRow,
  IssueExecutionProposalRow,
  IssueMessageRow,
  IssueReworkProposalRow,
} from "./db";

export const issueAttachmentJson = (attachment: IssueAttachmentRow) => ({
  id: attachment.id,
  filename: attachment.filename,
  contentType: attachment.content_type,
  byteSize: attachment.byte_size,
  url: `/projects/${attachment.project_id}/runs/${attachment.run_id}/attachments/${attachment.id}`,
});

export const issueReworkProposalJson = (proposal: IssueReworkProposalRow) => ({
  id: proposal.id,
  type: "request_issue_rework" as const,
  workflowStage: proposal.workflow_stage,
  reason: proposal.reason,
  status: proposal.status,
  acceptedAt: proposal.accepted_at,
  appliedRevision: proposal.applied_revision,
});

export const issueActionProposalJson = (proposal: IssueActionProposalRow) => {
  const payload = JSON.parse(proposal.payload_json) as Record<string, unknown>;
  return {
    id: proposal.id,
    type: proposal.action_type,
    ...payload,
    ...(proposal.action_type === "request_issue_update" && payload.changes &&
      typeof payload.changes === "object" && !Array.isArray(payload.changes)
      ? { changedFields: Object.keys(payload.changes) }
      : {}),
    status: proposal.status,
    ...(proposal.action_type === "request_issue_create"
      ? { executeAfterCreate: proposal.execute_after_create === 1 }
      : {}),
    acceptedAt: proposal.accepted_at,
    resultRunId: proposal.result_run_id,
  };
};

export const issueExecutionProposalJson = (
  proposal: IssueExecutionProposalRow,
) => {
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

export const liveIssueExecutionProposalJson = (
  proposal: IssueExecutionProposalRow | null,
) => proposal && (proposal.status === "pending" || proposal.status === "accepted")
  ? issueExecutionProposalJson(proposal)
  : null;

export const liveAgentSkillExecutionProposalJson = (
  proposal: AgentSkillExecutionProposalRow | null,
) => proposal && (proposal.status === "pending" || proposal.status === "accepted")
  ? agentSkillExecutionProposalJson(proposal)
  : null;

export type IssueProposalRow = IssueReworkProposalRow | IssueActionProposalRow;

export const issueProposalJson = (proposal: IssueProposalRow) =>
  "action_type" in proposal
    ? issueActionProposalJson(proposal)
    : issueReworkProposalJson(proposal);

export const issueMessageJson = (
  message: IssueMessageRow,
  attachments: IssueAttachmentRow[] = [],
  proposal: IssueProposalRow | null = null,
  executionProposal: IssueExecutionProposalRow | null = null,
  skillExecutionProposal: AgentSkillExecutionProposalRow | null = null,
) => ({
  id: message.id,
  runId: message.run_id,
  parentMessageId: message.parent_message_id,
  body: message.body,
  attachments: attachments
    .filter((attachment) =>
      issueAttachmentReferences(message.body).has(attachment.id)
    )
    .map(issueAttachmentJson),
  author: {
    id: message.author_agent_id ?? message.author_user_id,
    name: message.author_agent_id
      ? (message.author_agent_name ?? message.author_name ?? "Project Agent")
      : message.author_agent_provider
        ? `Agent · ${agentProviderLabels[message.author_agent_provider]}`
        : (message.author_name ?? "알 수 없는 사용자"),
    image: message.author_agent_id
      ? message.author_agent_image
      : message.author_agent_provider
        ? null
        : message.author_image,
    agentId: message.author_agent_id,
    provider: message.author_agent_provider,
  },
  replyCount: message.reply_count,
  proposedAction: proposal ? issueProposalJson(proposal) : null,
  executionProposal: executionProposal
    ? issueExecutionProposalJson(executionProposal)
    : null,
  skillExecutionProposal: skillExecutionProposal
    ? agentSkillExecutionProposalJson(skillExecutionProposal)
    : null,
  createdAt: message.created_at,
  updatedAt: message.updated_at,
});

export const issueAgentReplyJson = (job: IssueAgentReplyJobRow) => ({
  id: job.id,
  triggerMessageId: job.trigger_message_id,
  parentMessageId: job.parent_message_id,
  agentId: job.agent_id,
  agentName: job.agent_name_snapshot,
  status: job.status,
  attempts: job.attempts,
  workerId: job.claimed_worker_id,
  provider: job.agent_provider,
  error: job.status === "failed" ? job.error : null,
  updatedAt: job.updated_at,
});

export const issueConversationNotificationJson = (
  notification: IssueConversationNotificationRow,
) => ({
  id: notification.id,
  runId: notification.run_id,
  runTitle: notification.run_title,
  rootMessageId: notification.root_message_id,
  body: notification.body,
  author: {
    ...issueMessageJson(notification).author,
    image: notification.author_agent_id
      ? notification.author_agent_image
      : notification.author_image,
  },
  reason: notification.notification_reason,
  createdAt: notification.created_at,
});

export const channelConversationNotificationJson = (
  notification: ChannelConversationNotificationRow,
) => ({
  id: notification.id,
  channelId: notification.channel_id,
  channelName: notification.channel_name,
  rootMessageId: notification.root_message_id,
  body: notification.body,
  author: {
    id: notification.author_agent_id ?? notification.author_user_id,
    name: notification.author_name ?? "",
    image: notification.author_agent_id
      ? notification.author_agent_image
      : notification.author_image,
    provider: notification.author_agent_provider,
  },
  reason: notification.notification_reason,
  createdAt: notification.created_at,
});

export const claimConversationJson = (
  messages: IssueMessageRow[],
  attachments: IssueAttachmentRow[] = [],
) => messages.map((message) => issueMessageJson(message, attachments));
