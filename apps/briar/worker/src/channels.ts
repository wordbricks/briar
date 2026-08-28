import {
  channelReplyAssignedWorkerUnavailableError,
  channelReplyNoAvailableWorkerError,
  type ChannelReplyUnavailableReason,
  type ChannelActionType,
  type ChannelAgentProvider as AgentProvider,
  type ChannelAgentReply,
  type ChannelExecutionProposal,
  type ChannelIssueBatchProposalPayload,
  type ChannelKind,
  type ChannelMessage,
  type ChannelMessageBlock,
  type ChannelMessageAttachment,
  type ChannelMessageReaction,
  type ChannelMessageReactionPerson,
  type ChannelReplyStatus,
  type ChannelSkillExecutionProposal,
  type ChannelSummary,
  type ChannelThreadSubscriber,
  type ChannelVisibility,
  type ChannelWebhook,
  type DirectMessageParticipant,
} from "../../src/lib/channels-contract";
import { agentReplyDisplayParentMessageId } from "../../src/lib/issue-reply-decision";
import { isWorkerEmoji } from "../../src/lib/worker-icon-validation";
import type { AgentSkillEffort, AgentSkillKind } from "./agent-skills";
import type {
  AgentSkillExecutionProposalRow,
  IssueExecutionProposalRow,
} from "./db";
import {
  channelReplyWorkerAvailability,
  executionWorkerSupportsSelection,
  hasAvailableChannelReplyWorker,
} from "./workers";

export type ChannelRow = {
  id: string;
  organization_id: string;
  kind: ChannelKind;
  dm_key: string | null;
  slug: string;
  name: string;
  topic: string | null;
  visibility: ChannelVisibility;
  default_project_id: string | null;
  archived_at: string | null;
  member_count: number;
  agent_count: number;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  dm_participants_json: string | null;
  last_read_at: string | null;
  last_unread_message_at: string | null;
};

export type ChannelMessageRow = {
  id: string;
  channel_id: string;
  parent_message_id: string | null;
  author_user_id: string | null;
  author_name: string | null;
  author_email: string | null;
  author_image: string | null;
  author_agent_id: string | null;
  author_agent_name: string | null;
  author_agent_provider: AgentProvider | null;
  author_agent_image: string | null;
  author_webhook_id: string | null;
  author_webhook_name: string | null;
  webhook_event_id: string | null;
  body: string;
  blocks_json: string | null;
  deleted_at: string | null;
  reply_count: number;
  last_reply_at: string | null;
  document_message_id: string | null;
  document_title: string | null;
  document_project_id: string | null;
  proposal_id: string | null;
  proposal_action_type: ChannelActionType | null;
  proposal_status: "pending" | "accepted" | null;
  proposal_project_id: string | null;
  proposal_payload_json: string | null;
  proposal_execute_after_create: number | null;
  proposal_result_run_id: string | null;
  proposal_result_items_json: string | null;
  execution_proposal_id: string | null;
  execution_proposal_project_id: string | null;
  execution_proposal_run_id: string | null;
  execution_proposal_title: string | null;
  execution_proposal_status: "pending" | "accepted" | null;
  execution_proposal_created_at: string | null;
  execution_proposal_accepted_at: string | null;
  execution_requested_provider: AgentProvider | null;
  execution_requested_model: string | null;
  execution_requested_effort: AgentSkillEffort | null;
  execution_requested_worker_id: string | null;
  execution_delegated_by_agent_id: string | null;
  execution_delegated_by_agent_name: string | null;
  skill_execution_proposal_id: string | null;
  skill_execution_project_id: string | null;
  skill_execution_agent_id: string | null;
  skill_execution_agent_name: string | null;
  skill_execution_skill_id: string | null;
  skill_execution_skill_name: string | null;
  skill_execution_provider: AgentProvider | null;
  skill_execution_model: string | null;
  skill_execution_effort: AgentSkillEffort | null;
  skill_execution_execution_mode: "conversation" | "task" | null;
  skill_execution_approval_policy: "invoke_is_consent" | "explicit" | null;
  skill_execution_execution_status:
    | "waiting"
    | "running"
    | "completed"
    | "failed"
    | null;
  skill_execution_error: string | null;
  skill_execution_request: string | null;
  skill_execution_status: "pending" | "accepted" | null;
  skill_execution_requested_worker_id: string | null;
  skill_execution_requested_worker_label: string | null;
  skill_execution_result_session_id: string | null;
  skill_execution_result_message_id: string | null;
  skill_execution_created_at: string | null;
  skill_execution_accepted_at: string | null;
  skill_execution_delegated_by_agent_id: string | null;
  skill_execution_delegated_by_agent_name: string | null;
  created_at: string;
};

type ChannelReplyAuthorRow = Pick<
  ChannelMessageRow,
  | "author_user_id"
  | "author_name"
  | "author_email"
  | "author_image"
  | "author_agent_id"
  | "author_agent_name"
  | "author_agent_provider"
  | "author_agent_image"
  | "author_webhook_id"
  | "author_webhook_name"
> & {
  parent_message_id: string;
  last_reply_at: string;
};

export type ChannelWebhookRow = {
  id: string;
  channel_id: string;
  name: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type IncomingChannelWebhookRow = ChannelWebhookRow & {
  organization_id: string;
  channel_archived_at: string | null;
};

export type ChannelMessageAttachmentRow = {
  id: string;
  organization_id: string;
  channel_id: string;
  message_id: string;
  object_key: string;
  filename: string;
  content_type: string;
  byte_size: number;
  created_at: string;
};

export type ChannelMessageDocumentRow = {
  message_id: string;
  channel_id: string;
  project_id: string | null;
  title: string;
  markdown: string;
};

export type ChannelMessageAttachmentInput = Pick<
  ChannelMessageAttachmentRow,
  "id" | "organization_id" | "object_key" | "filename" | "content_type" | "byte_size"
>;

export type ChannelReplyJobRow = {
  id: string;
  organization_id: string;
  channel_id: string;
  project_id: string | null;
  agent_id: string;
  skill_id: string | null;
  trigger_message_id: string;
  parent_message_id: string;
  reply_message_id: string;
  status: ChannelReplyStatus;
  agent_provider: AgentProvider | null;
  preferred_device_id: string | null;
  claimed_device_id: string | null;
  claimed_worker_id: string | null;
  claim_token_hash: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  attempts: number;
  planned_update_resume: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  selected_skill_id_snapshot: string | null;
  selected_agent_name_snapshot?: string | null;
  selected_agent_responsibility_snapshot?: string | null;
  selected_skill_name_snapshot?: string | null;
  selected_skill_instructions_snapshot?: string | null;
  selected_skill_kind_snapshot?: AgentSkillKind | null;
  selected_skill_provider_snapshot?: AgentProvider | null;
  selected_skill_model_snapshot?: string | null;
  selected_skill_effort_snapshot?: AgentSkillEffort | null;
  skill_execution_request_snapshot?: string | null;
  delegated_by_reply_job_id: string | null;
  delegation_request: string | null;
  execution_target_ids_json?: string;
  session_id: string | null;
  approved_skill_execution_proposal_id?: string | null;
};

export type ChannelReplySessionRow = {
  id: string;
  organization_id: string;
  channel_id: string;
  thread_root_message_id: string;
  project_id: string | null;
  agent_id: string;
  provider: AgentProvider;
  model: string | null;
  effort: AgentSkillEffort | null;
  owner_device_id: string | null;
  owner_worker_id: string | null;
  owner_worker_label: string | null;
  conversation_id: string | null;
  last_activity_at: string;
  retained_until: string;
  created_at: string;
  updated_at: string;
};

const MAX_REPLY_ATTEMPTS = 3;
export const CHANNEL_REPLY_SESSION_RETENTION_MS = 6 * 60 * 60 * 1_000;

export function channelReplySessionRetentionUntil(observedAt: string) {
  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Channel reply session activity time is invalid");
  }
  return new Date(timestamp + CHANNEL_REPLY_SESSION_RETENTION_MS).toISOString();
}

/**
 * A queued reply keeps the provider and optional Skill selected when it was
 * created. Runtime configuration is live authority: deleting the Skill or
 * changing either provider revokes that queued/running reply instead of
 * silently falling back to a different configuration.
 */
const liveChannelReplyRuntime = (job: string) => `coalesce((
  (
    ${job}.selected_skill_id_snapshot is null
    and ${job}.skill_id is null
    and exists (
      select 1 from briar_project_agents runtime_agent
      where runtime_agent.id = ${job}.agent_id
        and runtime_agent.organization_id = ${job}.organization_id
        and runtime_agent.project_id is ${job}.project_id
        and runtime_agent.provider = ${job}.agent_provider
    )
  )
  or (
    ${job}.selected_skill_id_snapshot is not null
    and ${job}.skill_id = ${job}.selected_skill_id_snapshot
    and exists (
      select 1
      from briar_project_agents runtime_agent
      join briar_agent_skills runtime_skill
        on runtime_skill.agent_id = runtime_agent.id
      where runtime_agent.id = ${job}.agent_id
        and runtime_agent.organization_id = ${job}.organization_id
        and runtime_agent.project_id is ${job}.project_id
        and runtime_skill.id = ${job}.selected_skill_id_snapshot
        and (
          (
            runtime_skill.execution_mode = 'conversation'
            and exists (
              select 1 from briar_channel_reply_sessions runtime_session
              where runtime_session.id = ${job}.session_id
                and runtime_session.provider = ${job}.agent_provider
            )
          )
          or (
            runtime_skill.execution_mode = 'task'
            and runtime_skill.provider = ${job}.agent_provider
          )
        )
      )
  )
), 0) = 1`;

const channelSelectColumns = `
  select channel.id, channel.organization_id, channel.kind, channel.dm_key,
         channel.slug, channel.name,
         channel.topic, channel.visibility, channel.default_project_id,
         channel.archived_at,
         (select count(*) from briar_channel_members member
          where member.channel_id = channel.id) as member_count,
         (select count(*) from briar_channel_agents agent
          where agent.channel_id = channel.id) as agent_count,
         channel.created_by_user_id,
         channel.created_at, channel.updated_at,
         (select max(message.created_at) from briar_channel_messages message
          where message.channel_id = channel.id) as last_message_at,
         (select message.body from briar_channel_messages message
          where message.channel_id = channel.id
          order by message.created_at desc, message.id desc limit 1)
           as last_message_preview,
         case when channel.kind = 'dm' then (
           select json_group_array(json_object(
             'type', participant.type,
             'id', participant.id,
             'name', participant.name,
             'image', participant.image
           ))
           from (
             select 'user' as type, member.user_id as id,
                    account.name as name, account.image as image,
                    member.created_at as joined_at
             from briar_channel_members member
             join "user" account on account.id = member.user_id
             where member.channel_id = channel.id
             union all
             select 'agent' as type, roster.agent_id as id,
                    agent.name as name, agent.avatar as image,
                    roster.created_at as joined_at
             from briar_channel_agents roster
             join briar_project_agents agent on agent.id = roster.agent_id
             where roster.channel_id = channel.id
             order by joined_at, type, id
           ) participant
         ) else null end as dm_participants_json`;

const channelSelect = `${channelSelectColumns},
         null as last_read_at,
         null as last_unread_message_at
  from briar_channels channel`;

const channelSelectForUser = `${channelSelectColumns},
         (select read_state.last_read_at from briar_channel_read_states read_state
          where read_state.channel_id = channel.id and read_state.user_id = ?)
           as last_read_at,
         (select max(message.created_at) from briar_channel_messages message
          where message.channel_id = channel.id
            and ifnull(message.author_user_id, '') != ?)
           as last_unread_message_at
  from briar_channels channel`;

/**
 * Public channels are readable by every organization member; private channels
 * require an explicit membership row. Organization membership itself is checked
 * by the caller before any of these queries run.
 */
const visibleToUser = `(
  channel.visibility = 'public'
  or exists (
    select 1 from briar_channel_members member
    where member.channel_id = channel.id and member.user_id = ?
  )
)`;

const messageSelect = (
  withExecutionProposals: boolean,
  withSkillExecutionProposals: boolean,
  withIssueBatchProposals: boolean,
) => `
  select message.id, message.channel_id, message.parent_message_id,
         message.author_user_id, author.name as author_name,
         author.email as author_email, author.image as author_image,
         message.author_agent_id, message.author_agent_name,
         message.author_agent_provider, agent.avatar as author_agent_image,
         message.author_webhook_id,
         message.author_webhook_name, message.webhook_event_id, message.body,
         message.blocks_json, message.deleted_at,
         (select count(*) from briar_channel_messages reply
          where reply.parent_message_id = message.id) as reply_count,
         (select max(reply.created_at) from briar_channel_messages reply
          where reply.parent_message_id = message.id) as last_reply_at,
         document.message_id as document_message_id,
         document.title as document_title,
         document.project_id as document_project_id,
         proposal.id as proposal_id,
         proposal.action_type as proposal_action_type,
         proposal.status as proposal_status,
         proposal.project_id as proposal_project_id,
         proposal.payload_json as proposal_payload_json,
         proposal.result_run_id as proposal_result_run_id,
         ${withIssueBatchProposals
           ? `(
             select coalesce(json_group_array(json_object(
               'localKey', batch_item.local_key,
               'runId', batch_item.run_id
             )), '[]')
             from (
               select local_key, run_id
               from briar_channel_issue_batch_items
               where proposal_id = proposal.id
               order by position
             ) batch_item
           )`
           : "null"} as proposal_result_items_json,
         ${withExecutionProposals ? `
         proposal.execute_after_create as proposal_execute_after_create,
         execution.id as execution_proposal_id,
         execution.project_id as execution_proposal_project_id,
         execution.target_run_id as execution_proposal_run_id,
         execution.target_title as execution_proposal_title,
         execution.status as execution_proposal_status,
         execution.created_at as execution_proposal_created_at,
         execution.accepted_at as execution_proposal_accepted_at,
         execution.requested_provider as execution_requested_provider,
         execution.requested_model as execution_requested_model,
         execution.requested_effort as execution_requested_effort,
         execution.requested_worker_id as execution_requested_worker_id,
         execution.delegated_by_agent_id as execution_delegated_by_agent_id,
         execution.delegated_by_agent_name as execution_delegated_by_agent_name
         ` : `
         null as proposal_execute_after_create,
         null as execution_proposal_id,
         null as execution_proposal_project_id,
         null as execution_proposal_run_id,
         null as execution_proposal_title,
         null as execution_proposal_status,
         null as execution_proposal_created_at,
         null as execution_proposal_accepted_at,
         null as execution_requested_provider,
         null as execution_requested_model,
         null as execution_requested_effort,
         null as execution_requested_worker_id,
         null as execution_delegated_by_agent_id,
         null as execution_delegated_by_agent_name
         `},
         ${withSkillExecutionProposals ? `
         skill_execution.id as skill_execution_proposal_id,
         skill_execution.project_id as skill_execution_project_id,
         skill_execution.agent_id as skill_execution_agent_id,
         skill_execution.agent_name as skill_execution_agent_name,
         skill_execution.skill_id as skill_execution_skill_id,
         skill_execution.skill_name as skill_execution_skill_name,
         skill_execution.provider as skill_execution_provider,
         skill_execution.model as skill_execution_model,
         skill_execution.effort as skill_execution_effort,
         skill_execution.execution_mode as skill_execution_execution_mode,
         skill_execution.approval_policy as skill_execution_approval_policy,
         case
           when skill_execution.status = 'pending' then 'waiting'
           when skill_execution.execution_mode = 'task' then coalesce((
             select case task.status when 'completed' then 'completed'
               when 'failed' then 'failed' else 'running' end
             from briar_project_agent_task_jobs task
             where task.id = skill_execution.result_session_id
           ), 'running')
           else coalesce((
             select case result_reply.status when 'completed' then 'completed'
               when 'failed' then 'failed' else 'running' end
             from briar_channel_agent_reply_jobs result_reply
             where result_reply.id = skill_execution.result_reply_job_id
           ), 'running')
         end as skill_execution_execution_status,
         case when skill_execution.execution_mode = 'task' then (
           select task.error from briar_project_agent_task_jobs task
           where task.id = skill_execution.result_session_id
         ) else (
           select result_reply.error from briar_channel_agent_reply_jobs result_reply
           where result_reply.id = skill_execution.result_reply_job_id
         ) end as skill_execution_error,
         skill_execution.request as skill_execution_request,
         skill_execution.status as skill_execution_status,
         skill_execution.requested_worker_id
           as skill_execution_requested_worker_id,
         skill_execution.requested_worker_label
           as skill_execution_requested_worker_label,
         skill_execution.result_session_id
           as skill_execution_result_session_id,
         skill_execution.result_message_id
           as skill_execution_result_message_id,
         skill_execution.created_at as skill_execution_created_at,
         skill_execution.accepted_at as skill_execution_accepted_at,
         skill_execution.delegated_by_agent_id
           as skill_execution_delegated_by_agent_id,
         skill_execution.delegated_by_agent_name
           as skill_execution_delegated_by_agent_name
         ` : `
         null as skill_execution_proposal_id,
         null as skill_execution_project_id,
         null as skill_execution_agent_id,
         null as skill_execution_agent_name,
         null as skill_execution_skill_id,
         null as skill_execution_skill_name,
         null as skill_execution_provider,
         null as skill_execution_model,
         null as skill_execution_effort,
         null as skill_execution_execution_mode,
         null as skill_execution_approval_policy,
         null as skill_execution_execution_status,
         null as skill_execution_error,
         null as skill_execution_request,
         null as skill_execution_status,
         null as skill_execution_requested_worker_id,
         null as skill_execution_requested_worker_label,
         null as skill_execution_result_session_id,
         null as skill_execution_result_message_id,
         null as skill_execution_created_at,
         null as skill_execution_accepted_at,
         null as skill_execution_delegated_by_agent_id,
         null as skill_execution_delegated_by_agent_name
         `},
         message.created_at
  from briar_channel_messages message
  left join "user" author on author.id = message.author_user_id
  left join briar_project_agents agent
    on agent.id = message.author_agent_id
  left join briar_channel_message_documents document
    on document.message_id = message.id
  left join briar_channel_action_proposals proposal
    on proposal.reply_message_id = message.id
  ${withExecutionProposals ? `left join briar_issue_execution_proposals execution
    on execution.reply_message_id = message.id
   and execution.source_kind = 'channel'
   and execution.status in ('pending', 'accepted')` : ""}
  ${withSkillExecutionProposals
    ? `left join briar_agent_skill_execution_proposals skill_execution
    on skill_execution.reply_message_id = message.id
   and skill_execution.source_kind = 'channel'
   and skill_execution.status in ('pending', 'accepted')`
    : ""}`;

export async function channelExecutionProposalTablesAvailable(db: D1Database) {
  return Boolean(await db
    .prepare(
      `select 1 as available from sqlite_master
       where type = 'table' and name = 'briar_issue_execution_proposals'`,
    )
    .first<{ available: number }>());
}

export async function channelSkillExecutionProposalTablesAvailable(
  db: D1Database,
) {
  return Boolean(await db
    .prepare(
      `select 1 as available
       where exists (
         select 1 from sqlite_master
         where type = 'table'
           and name = 'briar_agent_skill_execution_proposals'
       ) and exists (
         select 1 from pragma_table_info(
           'briar_agent_skill_execution_proposals'
         ) where name = 'execution_mode'
       )`,
    )
    .first<{ available: number }>());
}

export async function channelIssueBatchProposalTablesAvailable(
  db: D1Database,
) {
  return Boolean(await db
    .prepare(
      `select 1 as available from sqlite_master
       where type = 'table'
         and name = 'briar_channel_issue_batch_items'`,
    )
    .first<{ available: number }>());
}

const messageSelectFor = async (db: D1Database) => {
  const [execution, skillExecution, issueBatch] = await Promise.all([
    channelExecutionProposalTablesAvailable(db),
    channelSkillExecutionProposalTablesAvailable(db),
    channelIssueBatchProposalTablesAvailable(db),
  ]);
  return messageSelect(execution, skillExecution, issueBatch);
};

const channelExecutionProposalJson = (
  row: ChannelMessageRow,
): ChannelExecutionProposal | null => row.execution_proposal_id
  ? {
      id: row.execution_proposal_id,
      type: "request_issue_execute",
      status: row.execution_proposal_status ?? "pending",
      projectId: row.execution_proposal_project_id ?? "",
      runId: row.execution_proposal_run_id ?? "",
      title: row.execution_proposal_title ?? "",
      createdAt: row.execution_proposal_created_at ?? row.created_at,
      acceptedAt: row.execution_proposal_accepted_at,
      requestedProvider: row.execution_requested_provider,
      requestedModel: row.execution_requested_model,
      requestedEffort: row.execution_requested_effort,
      requestedWorkerId: row.execution_requested_worker_id,
      delegatedByAgentId: row.execution_delegated_by_agent_id,
      delegatedByAgentName: row.execution_delegated_by_agent_name,
    }
  : null;

const channelSkillExecutionProposalJson = (
  row: ChannelMessageRow,
): ChannelSkillExecutionProposal | null => row.skill_execution_proposal_id
  ? {
      id: row.skill_execution_proposal_id,
      type: "request_agent_skill_execute",
      status: row.skill_execution_status ?? "pending",
      projectId: row.skill_execution_project_id ?? "",
      agentId: row.skill_execution_agent_id ?? "",
      agentName: row.skill_execution_agent_name ?? "",
      skillId: row.skill_execution_skill_id ?? "",
      skillName: row.skill_execution_skill_name ?? "",
      provider: row.skill_execution_provider ?? "codex",
      model: row.skill_execution_model,
      effort: row.skill_execution_effort,
      executionMode: row.skill_execution_execution_mode ?? "task",
      approvalPolicy: row.skill_execution_approval_policy ?? "explicit",
      executionStatus: row.skill_execution_execution_status ?? "waiting",
      request: row.skill_execution_request ?? "",
      delegatedByAgentId: row.skill_execution_delegated_by_agent_id,
      delegatedByAgentName: row.skill_execution_delegated_by_agent_name,
      requestedWorkerId: row.skill_execution_requested_worker_id,
      requestedWorkerLabel: row.skill_execution_requested_worker_label,
      resultSessionId: row.skill_execution_result_session_id,
      resultMessageId: row.skill_execution_result_message_id,
      error: row.skill_execution_error,
      createdAt: row.skill_execution_created_at ?? row.created_at,
      acceptedAt: row.skill_execution_accepted_at,
    }
  : null;

const channelHasUnreadFromRow = (row: ChannelRow) => Boolean(
  row.last_unread_message_at &&
    (!row.last_read_at || row.last_unread_message_at > row.last_read_at),
);

export const channelJson = (row: ChannelRow): ChannelSummary => ({
  id: row.id,
  organizationId: row.organization_id,
  kind: row.kind,
  slug: row.slug,
  name: row.name,
  topic: row.topic,
  visibility: row.visibility,
  defaultProjectId: row.default_project_id,
  archivedAt: row.archived_at,
  memberCount: row.member_count,
  agentCount: row.agent_count,
  createdByUserId: row.created_by_user_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastMessageAt: row.last_message_at,
  lastMessagePreview: row.last_message_preview,
  lastReadAt: row.last_read_at,
  hasUnread: channelHasUnreadFromRow(row),
  dmParticipants: row.dm_participants_json
    ? JSON.parse(row.dm_participants_json) as DirectMessageParticipant[]
    : undefined,
});

export const channelReplyJson = (
  row: ChannelReplyJobRow,
): ChannelAgentReply => ({
  id: row.id,
  agentId: row.agent_id,
  channelId: row.channel_id,
  triggerMessageId: row.trigger_message_id,
  parentMessageId: row.parent_message_id,
  replyMessageId: row.reply_message_id,
  status: row.status,
  attempts: row.attempts,
  error: row.error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const channelMessageAuthorJson = (
  row: Pick<
    ChannelMessageRow,
    | "author_user_id"
    | "author_name"
    | "author_email"
    | "author_image"
    | "author_agent_id"
    | "author_agent_name"
    | "author_agent_provider"
    | "author_agent_image"
    | "author_webhook_id"
    | "author_webhook_name"
  >,
) =>
  row.author_webhook_name
    ? {
        type: "webhook" as const,
        id: row.author_webhook_id,
        name: row.author_webhook_name,
      }
    : row.author_agent_name
    ? {
        type: "agent" as const,
        id: row.author_agent_id,
        name: row.author_agent_name,
        provider: row.author_agent_provider,
        image: row.author_agent_image,
      }
    : {
        type: "user" as const,
        id: row.author_user_id ?? "",
        name: row.author_name ?? "",
        email: row.author_email ?? "",
        image: row.author_image,
      };

export const channelMessageJson = (
  row: ChannelMessageRow,
  mentions: { users: string[]; agents: string[] } = { users: [], agents: [] },
  attachments: ChannelMessageAttachment[] = [],
  reactions: ChannelMessageReaction[] = [],
  replyAuthors: ChannelMessage["replyAuthors"] = [],
  subscribers: ChannelThreadSubscriber[] = [],
): ChannelMessage => ({
  id: row.id,
  channelId: row.channel_id,
  parentMessageId: row.parent_message_id,
  author: channelMessageAuthorJson(row),
  body: row.deleted_at ? "[deleted]" : row.body,
  blocks: !row.deleted_at && row.blocks_json
    ? JSON.parse(row.blocks_json) as ChannelMessageBlock[]
    : null,
  mentionedUserIds: row.deleted_at ? [] : mentions.users,
  mentionedAgentIds: row.deleted_at ? [] : mentions.agents,
  attachments: row.deleted_at ? [] : attachments,
  reactions: row.deleted_at ? [] : reactions,
  replyCount: row.reply_count,
  lastReplyAt: row.last_reply_at,
  replyAuthors,
  subscribers,
  document: !row.deleted_at && row.document_message_id
    ? {
        messageId: row.document_message_id,
        title: row.document_title ?? "",
        projectId: row.document_project_id,
      }
    : null,
  proposal: !row.deleted_at && row.proposal_id
    ? {
        id: row.proposal_id,
        actionType: row.proposal_action_type ?? "request_issue_create",
        status: row.proposal_status ?? "pending",
        projectId: row.proposal_project_id,
        payload: {
          ...JSON.parse(row.proposal_payload_json ?? "{}"),
          executeAfterCreate: row.proposal_execute_after_create === 1,
        },
        resultRunId: row.proposal_result_run_id,
        resultItems: row.proposal_result_items_json
          ? JSON.parse(row.proposal_result_items_json)
          : undefined,
    }
    : null,
  executionProposal: row.deleted_at ? null : channelExecutionProposalJson(row),
  skillExecutionProposal: row.deleted_at
    ? null
    : channelSkillExecutionProposalJson(row),
  createdAt: row.created_at,
  deletedAt: row.deleted_at,
});

/** One grapheme emoji, same rule as Worker icons so flags and ZWJ stay valid. */
export function isChannelReactionEmoji(value: string) {
  return isWorkerEmoji(value);
}

function aggregateReactions(
  rows: Array<{
    message_id: string;
    user_id: string;
    emoji: string;
    created_at: string;
    user_name: string | null;
    user_image: string | null;
  }>,
): Map<string, ChannelMessageReaction[]> {
  const byMessage = new Map<
    string,
    Map<string, {
      userIds: string[];
      people: ChannelMessageReactionPerson[];
      firstCreatedAt: string;
    }>
  >();
  for (const row of rows) {
    let emojiMap = byMessage.get(row.message_id);
    if (!emojiMap) {
      emojiMap = new Map();
      byMessage.set(row.message_id, emojiMap);
    }
    const current = emojiMap.get(row.emoji);
    const person = row.user_name === null
      ? null
      : {
          userId: row.user_id,
          name: row.user_name,
          image: row.user_image,
        } satisfies ChannelMessageReactionPerson;
    if (current) {
      current.userIds.push(row.user_id);
      if (person) current.people.push(person);
    } else {
      emojiMap.set(row.emoji, {
        userIds: [row.user_id],
        people: person ? [person] : [],
        firstCreatedAt: row.created_at,
      });
    }
  }
  const result = new Map<string, ChannelMessageReaction[]>();
  for (const [messageId, emojiMap] of byMessage) {
    const reactions = [...emojiMap.entries()]
      .map(([emoji, value]) => ({
        emoji,
        count: value.userIds.length,
        userIds: value.userIds,
        people: value.people,
        firstCreatedAt: value.firstCreatedAt,
      }))
      .sort((left, right) => {
        if (left.firstCreatedAt !== right.firstCreatedAt) {
          return left.firstCreatedAt.localeCompare(right.firstCreatedAt);
        }
        return left.emoji.localeCompare(right.emoji);
      })
      .map(({ firstCreatedAt: _firstCreatedAt, ...reaction }) => reaction);
    result.set(messageId, reactions);
  }
  return result;
}

export async function listChannels(
  db: D1Database,
  organizationId: string,
  userId: string,
) {
  const rows = await db
    .prepare(
      `${channelSelectForUser}
       where channel.organization_id = ? and ${visibleToUser}
       order by channel.archived_at is not null, channel.name, channel.id`,
    )
    .bind(userId, userId, organizationId, userId)
    .all<ChannelRow>();
  return rows.results;
}

export async function getChannel(
  db: D1Database,
  organizationId: string,
  channelId: string,
  userId: string,
) {
  return db
    .prepare(
      `${channelSelectForUser}
       where channel.organization_id = ? and channel.id = ? and ${visibleToUser}`,
    )
    .bind(userId, userId, organizationId, channelId, userId)
    .first<ChannelRow>();
}

export async function markChannelRead(
  db: D1Database,
  input: {
    userId: string;
    channelId: string;
    lastReadAt: string;
  },
) {
  await db
    .prepare(
      `insert into briar_channel_read_states (
         user_id, channel_id, last_read_at, updated_at
       ) values (?, ?, ?, ?)
       on conflict(user_id, channel_id) do update set
         last_read_at = case
           when excluded.last_read_at > briar_channel_read_states.last_read_at
           then excluded.last_read_at
           else briar_channel_read_states.last_read_at
         end,
         updated_at = excluded.updated_at`,
    )
    .bind(input.userId, input.channelId, input.lastReadAt, input.lastReadAt)
    .run();
}

/** Worker-plane lookup: a claimed job already proves the channel is reachable. */
export async function getChannelById(
  db: D1Database,
  organizationId: string,
  channelId: string,
) {
  return db
    .prepare(
      `${channelSelect} where channel.organization_id = ? and channel.id = ?`,
    )
    .bind(organizationId, channelId)
    .first<ChannelRow>();
}

/**
 * Project Agent tokens identify a project rather than one saved Agent. The
 * project can read a channel when at least one of its Agents is on that
 * channel's roster. This intentionally ignores user visibility: a public
 * channel is not automatically visible to a Project Agent.
 */
export async function getProjectAgentChannel(
  db: D1Database,
  projectId: string,
  channelId: string,
) {
  return db
    .prepare(
      `${channelSelect}
       join briar_projects project
         on project.organization_id = channel.organization_id
       where project.id = ? and channel.id = ?
         and exists (
           select 1
           from briar_channel_agents roster
           join briar_project_agents agent on agent.id = roster.agent_id
           where roster.channel_id = channel.id
             and agent.organization_id = channel.organization_id
             and agent.project_id = project.id
         )`,
    )
    .bind(projectId, channelId)
    .first<ChannelRow>();
}

/** Used to distinguish an inaccessible same-organization channel from 404. */
export async function getProjectOrganizationChannel(
  db: D1Database,
  projectId: string,
  channelId: string,
) {
  return db
    .prepare(
      `${channelSelect}
       join briar_projects project
         on project.organization_id = channel.organization_id
       where project.id = ? and channel.id = ?`,
    )
    .bind(projectId, channelId)
    .first<ChannelRow>();
}

/** Resolves a project only when it belongs to the given organization. */
export async function getOrganizationProject(
  db: D1Database,
  organizationId: string,
  projectId: string,
) {
  return db
    .prepare(
      `select id, name, organization_id from briar_projects
       where id = ? and organization_id = ?`,
    )
    .bind(projectId, organizationId)
    .first<{ id: string; name: string; organization_id: string }>();
}

export async function createChannel(
  db: D1Database,
  input: {
    id: string;
    organizationId: string;
    kind?: ChannelKind;
    dmKey?: string | null;
    slug: string;
    name: string;
    topic: string | null;
    visibility: ChannelVisibility;
    defaultProjectId: string | null;
    createdByUserId: string;
    memberIds?: string[];
    agentIds?: string[];
    createdAt: string;
  },
) {
  const memberIds = [...new Set(input.memberIds ?? [])].filter(
    (userId) => userId !== input.createdByUserId,
  );
  const agentIds = [...new Set(input.agentIds ?? [])];
  const supportsDirectMessages = Boolean(await db.prepare(
    `select 1 as available from pragma_table_info('briar_channels')
     where name = 'kind'`,
  ).first<{ available: number }>());
  if (!supportsDirectMessages) {
    await db.batch([
      db.prepare(
        `insert into briar_channels (
           id, organization_id, slug, name, topic, visibility,
           default_project_id, created_by_user_id, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        input.id,
        input.organizationId,
        input.slug,
        input.name,
        input.topic,
        input.visibility,
        input.defaultProjectId,
        input.createdByUserId,
        input.createdAt,
        input.createdAt,
      ),
      db.prepare(
        `insert into briar_channel_members (
           channel_id, user_id, role, created_at
         ) values (?, ?, 'owner', ?)`,
      ).bind(input.id, input.createdByUserId, input.createdAt),
    ]);
    return null;
  }
  await db.batch([
    db
      .prepare(
        `insert into briar_channels (
           id, organization_id, kind, dm_key, slug, name, topic, visibility,
           default_project_id, created_by_user_id, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.organizationId,
        input.kind ?? "channel",
        input.dmKey ?? null,
        input.slug,
        input.name,
        input.topic,
        input.visibility,
        input.defaultProjectId,
        input.createdByUserId,
        input.createdAt,
        input.createdAt,
      ),
    db
      .prepare(
        `insert into briar_channel_members (
           channel_id, user_id, role, created_at
         ) values (?, ?, 'owner', ?)`,
      )
      .bind(input.id, input.createdByUserId, input.createdAt),
    ...memberIds.map((userId) =>
      db.prepare(
        `insert into briar_channel_members (
           channel_id, user_id, role, created_at
         ) values (?, ?, 'member', ?)`,
      ).bind(input.id, userId, input.createdAt)
    ),
    ...agentIds.map((agentId) =>
      db.prepare(
        `insert into briar_channel_agents (
           channel_id, agent_id, added_by_user_id, created_at
         ) values (?, ?, ?, ?)`,
      ).bind(input.id, agentId, input.createdByUserId, input.createdAt)
    ),
  ]);
  return getChannel(db, input.organizationId, input.id, input.createdByUserId);
}

export async function getDirectMessageByKey(
  db: D1Database,
  organizationId: string,
  dmKey: string,
  userId: string,
) {
  return db
    .prepare(
      `${channelSelectForUser}
       where channel.organization_id = ? and channel.kind = 'dm'
         and channel.dm_key = ? and ${visibleToUser}`,
    )
    .bind(userId, userId, organizationId, dmKey, userId)
    .first<ChannelRow>();
}

export async function updateChannel(
  db: D1Database,
  input: {
    organizationId: string;
    channelId: string;
    userId: string;
    name?: string;
    topic?: string | null;
    visibility?: ChannelVisibility;
    defaultProjectId?: string | null;
    archived?: boolean;
    updatedAt: string;
  },
) {
  const current = await getChannel(
    db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  if (!current) return null;
  await db
    .prepare(
      `update briar_channels
       set name = ?, topic = ?, visibility = ?, default_project_id = ?,
           archived_at = ?, updated_at = ?
       where id = ? and organization_id = ?`,
    )
    .bind(
      input.name ?? current.name,
      input.topic === undefined ? current.topic : input.topic,
      input.visibility ?? current.visibility,
      input.defaultProjectId === undefined
        ? current.default_project_id
        : input.defaultProjectId,
      input.archived === undefined
        ? current.archived_at
        : input.archived
          ? (current.archived_at ?? input.updatedAt)
          : null,
      input.updatedAt,
      input.channelId,
      input.organizationId,
    )
    .run();
  return getChannel(db, input.organizationId, input.channelId, input.userId);
}

export async function deleteChannel(
  db: D1Database,
  organizationId: string,
  channelId: string,
  userId: string,
  observedAt: string,
) {
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', attachment.object_key,
                'channel:' || attachment.channel_id, null, ?
         from briar_channel_message_attachments attachment
         where attachment.organization_id = ? and attachment.channel_id = ?
           and exists (
             select 1 from briar_organization_members membership
             where membership.organization_id = attachment.organization_id
               and membership.user_id = ?
               and (
                 membership.role = 'owner'
                 or attachment.channel_id in (
                   select channel.id from briar_channels channel
                   where channel.id = attachment.channel_id
                     and channel.created_by_user_id = ?
                 )
               )
           )
           and exists (
             select 1 from briar_channels channel
             where channel.id = attachment.channel_id
               and channel.organization_id = attachment.organization_id
           )
         on conflict (bucket, object_key) do update set
           project_id = excluded.project_id,
           run_id = excluded.run_id,
           queued_at = excluded.queued_at,
           attempts = 0,
           last_attempt_at = null,
           last_error = null,
           generation = briar_archive_cleanup_queue.generation + 1,
           next_attempt_at = null,
           dead_lettered_at = null,
           alert_state = 'none',
           alert_detail_json = null`,
      )
      .bind(observedAt, organizationId, channelId, userId, userId),
    db
      .prepare(
        `delete from briar_channels
         where id = ? and organization_id = ?
           and exists (
             select 1 from briar_organization_members membership
             where membership.organization_id = briar_channels.organization_id
               and membership.user_id = ?
               and (
                 membership.role = 'owner'
                 or briar_channels.created_by_user_id = ?
               )
           )
         returning id`,
      )
      .bind(channelId, organizationId, userId, userId),
  ]);
  return (results[1]?.results?.length ?? 0) > 0;
}

export async function listChannelMembers(db: D1Database, channelId: string) {
  const rows = await db
    .prepare(
      `select member.user_id, member.role, member.created_at,
              "user".name, "user".email, "user".image
       from briar_channel_members member
       join "user" on "user".id = member.user_id
       where member.channel_id = ?
       order by member.created_at, member.user_id`,
    )
    .bind(channelId)
    .all<{
      user_id: string;
      role: "owner" | "member";
      created_at: string;
      name: string;
      email: string;
      image: string | null;
    }>();
  return rows.results.map((row) => ({
    userId: row.user_id,
    name: row.name,
    email: row.email,
    image: row.image,
    role: row.role,
    createdAt: row.created_at,
  }));
}

export async function addChannelMember(
  db: D1Database,
  input: {
    channelId: string;
    userId: string;
    role: "owner" | "member";
    createdAt: string;
  },
) {
  await db.batch([
    db.prepare(
      `insert into briar_channel_members (channel_id, user_id, role, created_at)
       values (?, ?, ?, ?)
       on conflict (channel_id, user_id) do update set role = excluded.role`,
    )
      .bind(input.channelId, input.userId, input.role, input.createdAt),
    db.prepare(
      `update briar_channels
       set updated_at = ?,
           dm_key = case
             when kind = 'dm' and (
               (select count(*) from briar_channel_members
                where channel_id = briar_channels.id) +
               (select count(*) from briar_channel_agents
                where channel_id = briar_channels.id)
             ) <> 2 then null
             else dm_key
           end
       where id = ?`,
    ).bind(input.createdAt, input.channelId),
  ]);
}

export async function removeChannelMember(
  db: D1Database,
  channelId: string,
  userId: string,
  removedAt = new Date().toISOString(),
) {
  const results = await db.batch([
    db.prepare(
      `delete from briar_channel_members where channel_id = ? and user_id = ?`,
    )
      .bind(channelId, userId),
    db.prepare(
      `update briar_channels
       set updated_at = ?,
           dm_key = case
             when kind = 'dm' and (
               (select count(*) from briar_channel_members
                where channel_id = briar_channels.id) +
               (select count(*) from briar_channel_agents
                where channel_id = briar_channels.id)
             ) <> 2 then null
             else dm_key
           end
       where id = ?`,
    ).bind(removedAt, channelId),
  ]);
  const result = results[0];
  return (result.meta.changes ?? 0) > 0;
}

export async function listChannelAgents(db: D1Database, channelId: string) {
  const rows = await db
    .prepare(
      `select agent.id, agent.organization_id, agent.project_id,
              project.name as project_name, agent.name, agent.avatar,
              agent.provider, agent.model, agent.description,
              agent.responsibility,
              agent.effort, agent.designated_worker_id,
              agent.designated_worker_label, agent.created_at, agent.updated_at
       from briar_channel_agents roster
       join briar_project_agents agent on agent.id = roster.agent_id
       join briar_channels channel
         on channel.id = roster.channel_id
        and channel.organization_id = agent.organization_id
       left join briar_projects project
         on project.id = agent.project_id
        and project.organization_id = agent.organization_id
       where roster.channel_id = ?
       order by agent.name, agent.id`,
    )
    .bind(channelId)
    .all<{
      id: string;
      organization_id: string;
      project_id: string | null;
      project_name: string | null;
      name: string;
      avatar: string | null;
      provider: AgentProvider;
      model: string | null;
      description: string;
      responsibility: string;
      effort: AgentSkillEffort | null;
      designated_worker_id: string | null;
      designated_worker_label: string | null;
      created_at: string;
      updated_at: string;
    }>();
  return rows.results;
}

export async function addChannelAgent(
  db: D1Database,
  input: {
    channelId: string;
    agentId: string;
    addedByUserId: string;
    createdAt: string;
  },
) {
  await db.batch([
    db.prepare(
      `insert into briar_channel_agents (
         channel_id, agent_id, added_by_user_id, created_at
       ) values (?, ?, ?, ?)
       on conflict (channel_id, agent_id) do nothing`,
    ).bind(
      input.channelId,
      input.agentId,
      input.addedByUserId,
      input.createdAt,
    ),
    db.prepare(
      `update briar_channels
       set updated_at = ?,
           dm_key = case
             when kind = 'dm' and (
               (select count(*) from briar_channel_members
                where channel_id = briar_channels.id) +
               (select count(*) from briar_channel_agents
                where channel_id = briar_channels.id)
             ) <> 2 then null
             else dm_key
           end
       where id = ?`,
    ).bind(input.createdAt, input.channelId),
  ]);
}

export async function removeChannelAgent(
  db: D1Database,
  channelId: string,
  agentId: string,
  removedAt = new Date().toISOString(),
) {
  const results = await db.batch([
    db.prepare(
      `update briar_channel_agent_reply_jobs
       set status = 'failed', error = 'Agent was removed from the channel.',
           claimed_device_id = null, claimed_worker_id = null,
           claim_token_hash = null, lease_expires_at = null,
           completed_at = ?, updated_at = ?
       where channel_id = ? and agent_id = ?
         and status in ('queued', 'running')`,
    ).bind(removedAt, removedAt, channelId, agentId),
    db.prepare(
      `delete from briar_channel_agents where channel_id = ? and agent_id = ?`,
    ).bind(channelId, agentId),
    db.prepare(
      `update briar_channels
       set updated_at = ?,
           dm_key = case
             when kind = 'dm' and (
               (select count(*) from briar_channel_members
                where channel_id = briar_channels.id) +
               (select count(*) from briar_channel_agents
                where channel_id = briar_channels.id)
             ) <> 2 then null
             else dm_key
           end
       where id = ?`,
    ).bind(removedAt, channelId),
  ]);
  const result = results[1];
  return (result.meta.changes ?? 0) > 0;
}

export const channelWebhookJson = (row: ChannelWebhookRow): ChannelWebhook => ({
  id: row.id,
  channelId: row.channel_id,
  name: row.name,
  active: row.revoked_at === null,
  lastUsedAt: row.last_used_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const channelWebhookSelect = `
  select id, channel_id, name, last_used_at, revoked_at,
         created_at, updated_at
  from briar_channel_webhooks`;

export async function listChannelWebhooks(db: D1Database, channelId: string) {
  const rows = await db.prepare(
    `${channelWebhookSelect}
     where channel_id = ? order by revoked_at is not null, created_at, id`,
  ).bind(channelId).all<ChannelWebhookRow>();
  return rows.results;
}

export async function createChannelWebhook(
  db: D1Database,
  input: {
    id: string;
    channelId: string;
    name: string;
    secretHash: string;
    createdByUserId: string;
    createdAt: string;
  },
) {
  return db.prepare(
    `insert into briar_channel_webhooks (
       id, channel_id, name, secret_hash, created_by_user_id,
       created_at, updated_at
     ) values (?, ?, ?, ?, ?, ?, ?)
     returning id, channel_id, name, last_used_at, revoked_at,
               created_at, updated_at`,
  ).bind(
    input.id,
    input.channelId,
    input.name,
    input.secretHash,
    input.createdByUserId,
    input.createdAt,
    input.createdAt,
  ).first<ChannelWebhookRow>();
}

export async function updateChannelWebhook(
  db: D1Database,
  input: { channelId: string; webhookId: string; name: string; updatedAt: string },
) {
  return db.prepare(
    `update briar_channel_webhooks set name = ?, updated_at = ?
     where id = ? and channel_id = ? and revoked_at is null
     returning id, channel_id, name, last_used_at, revoked_at,
               created_at, updated_at`,
  ).bind(
    input.name,
    input.updatedAt,
    input.webhookId,
    input.channelId,
  ).first<ChannelWebhookRow>();
}

export async function rotateChannelWebhook(
  db: D1Database,
  input: {
    channelId: string;
    webhookId: string;
    secretHash: string;
    updatedAt: string;
  },
) {
  return db.prepare(
    `update briar_channel_webhooks
     set secret_hash = ?, updated_at = ?
     where id = ? and channel_id = ? and revoked_at is null
     returning id, channel_id, name, last_used_at, revoked_at,
               created_at, updated_at`,
  ).bind(
    input.secretHash,
    input.updatedAt,
    input.webhookId,
    input.channelId,
  ).first<ChannelWebhookRow>();
}

export async function revokeChannelWebhook(
  db: D1Database,
  input: { channelId: string; webhookId: string; revokedAt: string },
) {
  return db.prepare(
    `update briar_channel_webhooks
     set revoked_at = coalesce(revoked_at, ?), updated_at = ?
     where id = ? and channel_id = ?
     returning id, channel_id, name, last_used_at, revoked_at,
               created_at, updated_at`,
  ).bind(
    input.revokedAt,
    input.revokedAt,
    input.webhookId,
    input.channelId,
  ).first<ChannelWebhookRow>();
}

export async function getIncomingChannelWebhook(
  db: D1Database,
  webhookId: string,
  secretHash: string,
) {
  return db.prepare(
    `select webhook.id, webhook.channel_id, webhook.name,
            webhook.last_used_at, webhook.revoked_at, webhook.created_at,
            webhook.updated_at, channel.organization_id,
            channel.archived_at as channel_archived_at
     from briar_channel_webhooks webhook
     join briar_channels channel on channel.id = webhook.channel_id
     where webhook.id = ? and webhook.secret_hash = ?
       and webhook.revoked_at is null`,
  ).bind(webhookId, secretHash).first<IncomingChannelWebhookRow>();
}

export async function consumeChannelWebhookRateLimit(
  db: D1Database,
  webhookId: string,
  observedAt: string,
  windowCutoff: string,
) {
  const row = await db.prepare(
    `insert into briar_channel_webhook_rate_limits (
       webhook_id, window_started_at, request_count
     ) values (?, ?, 1)
     on conflict (webhook_id) do update set
       window_started_at = case
         when window_started_at <= ? then excluded.window_started_at
         else window_started_at end,
       request_count = case
         when window_started_at <= ? then 1 else request_count + 1 end
     where window_started_at <= ? or request_count < 60
     returning request_count`,
  ).bind(
    webhookId,
    observedAt,
    windowCutoff,
    windowCutoff,
    windowCutoff,
  ).first<{ request_count: number }>();
  return row !== null;
}

const channelMessageAttachmentJson = (
  row: ChannelMessageAttachmentRow,
): ChannelMessageAttachment => ({
  id: row.id,
  filename: row.filename,
  contentType: row.content_type,
  byteSize: row.byte_size,
  url: `/organizations/${row.organization_id}/channels/${row.channel_id}/messages/${row.message_id}/attachments/${row.id}`,
});

async function attachMessageRelations(
  db: D1Database,
  rows: ChannelMessageRow[],
): Promise<ChannelMessage[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const rootIds = rows
    .filter((row) => row.parent_message_id === null)
    .map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const rootPlaceholders = rootIds.map(() => "?").join(", ");
  const [userMentions, agentMentions, attachments, reactions, replyAuthors, subscribers] =
    await Promise.all([
    db
      .prepare(
        `select message_id, user_id from briar_channel_message_mentions
         where message_id in (${placeholders})`,
      )
      .bind(...ids)
      .all<{ message_id: string; user_id: string }>(),
    db
      .prepare(
        `select message_id, agent_id from briar_channel_message_agent_mentions
         where message_id in (${placeholders})`,
      )
      .bind(...ids)
      .all<{ message_id: string; agent_id: string }>(),
    db
      .prepare(
        `select id, organization_id, channel_id, message_id, object_key,
                filename, content_type, byte_size, created_at
         from briar_channel_message_attachments
         where message_id in (${placeholders})
         order by created_at, id`,
      )
      .bind(...ids)
      .all<ChannelMessageAttachmentRow>(),
    db
      .prepare(
        `select reaction.message_id, reaction.user_id, reaction.emoji,
                reaction.created_at,
                case when membership.user_id is null then null
                     else author.name end as user_name,
                case when membership.user_id is null then null
                     else author.image end as user_image
         from briar_channel_message_reactions reaction
         join briar_channel_messages message
          on message.id = reaction.message_id
         join briar_channels channel
          on channel.id = message.channel_id
         left join briar_organization_members membership
          on membership.organization_id = channel.organization_id
         and membership.user_id = reaction.user_id
         left join "user" author on author.id = reaction.user_id
         where reaction.message_id in (${placeholders})
         order by reaction.created_at, reaction.emoji, reaction.user_id`,
      )
      .bind(...ids)
      .all<{
        message_id: string;
        user_id: string;
        emoji: string;
        created_at: string;
        user_name: string | null;
        user_image: string | null;
      }>(),
    db
      .prepare(
        `with reply_authors as (
           select reply.parent_message_id, reply.author_user_id,
                  author.name as author_name, author.email as author_email,
                  author.image as author_image,
                  reply.author_agent_id, reply.author_agent_name,
                  reply.author_agent_provider,
                  agent.avatar as author_agent_image,
                  reply.author_webhook_id,
                  reply.author_webhook_name,
                  max(reply.created_at) as last_reply_at
           from briar_channel_messages reply
           left join "user" author on author.id = reply.author_user_id
           left join briar_project_agents agent
             on agent.id = reply.author_agent_id
           where reply.parent_message_id in (${placeholders})
           group by reply.parent_message_id, reply.author_user_id,
                    author.name, author.email, author.image,
                    reply.author_agent_id, reply.author_agent_name,
                    reply.author_agent_provider, agent.avatar,
                    reply.author_webhook_id,
                    reply.author_webhook_name
         ), ranked_reply_authors as (
           select *, row_number() over (
             partition by parent_message_id
             order by last_reply_at desc,
                      coalesce(author_user_id, author_agent_id,
                               author_webhook_id, author_agent_name,
                               author_webhook_name)
           ) as author_rank
           from reply_authors
         )
         select parent_message_id, author_user_id, author_name, author_email,
                author_image, author_agent_id, author_agent_name,
                author_agent_provider, author_agent_image,
                author_webhook_id,
                author_webhook_name, last_reply_at
         from ranked_reply_authors
         where author_rank <= 3
         order by parent_message_id, author_rank`,
      )
      .bind(...ids)
      .all<ChannelReplyAuthorRow>(),
    rootIds.length === 0
      ? Promise.resolve({
          results: [] as Array<{
            root_message_id: string;
            user_id: string;
            created_at: string;
          }>,
        })
      : db
          .prepare(
            `select root_message_id, user_id, created_at
             from briar_channel_thread_subscriptions
             where root_message_id in (${rootPlaceholders})
             order by created_at, user_id`,
          )
          .bind(...rootIds)
          .all<{
            root_message_id: string;
            user_id: string;
            created_at: string;
          }>(),
  ]);
  const byMessage = new Map<string, { users: string[]; agents: string[] }>();
  for (const row of rows) byMessage.set(row.id, { users: [], agents: [] });
  for (const mention of userMentions.results) {
    byMessage.get(mention.message_id)?.users.push(mention.user_id);
  }
  for (const mention of agentMentions.results) {
    byMessage.get(mention.message_id)?.agents.push(mention.agent_id);
  }
  const attachmentsByMessage = new Map<string, ChannelMessageAttachment[]>();
  for (const attachment of attachments.results) {
    const current = attachmentsByMessage.get(attachment.message_id) ?? [];
    current.push(channelMessageAttachmentJson(attachment));
    attachmentsByMessage.set(attachment.message_id, current);
  }
  const reactionsByMessage = aggregateReactions(reactions.results);
  const replyAuthorsByMessage = new Map<
    string,
    NonNullable<ChannelMessage["replyAuthors"]>
  >();
  for (const replyAuthor of replyAuthors.results) {
    const current = replyAuthorsByMessage.get(replyAuthor.parent_message_id) ?? [];
    current.push(channelMessageAuthorJson(replyAuthor));
    replyAuthorsByMessage.set(replyAuthor.parent_message_id, current);
  }
  const subscribersByRoot = new Map<string, ChannelThreadSubscriber[]>();
  for (const subscriber of subscribers.results) {
    const current = subscribersByRoot.get(subscriber.root_message_id) ?? [];
    current.push({
      userId: subscriber.user_id,
      subscribedAt: subscriber.created_at,
    });
    subscribersByRoot.set(subscriber.root_message_id, current);
  }
  return rows.map((row) =>
    channelMessageJson(
      row,
      byMessage.get(row.id) ?? { users: [], agents: [] },
      attachmentsByMessage.get(row.id) ?? [],
      reactionsByMessage.get(row.id) ?? [],
      replyAuthorsByMessage.get(row.id) ?? [],
      subscribersByRoot.get(row.id) ?? [],
    ),
  );
}

/**
 * Toggle a user's emoji reaction on a channel message. Returns the refreshed
 * message, or null when the message is not in the channel.
 */
export async function toggleChannelMessageReaction(
  db: D1Database,
  input: {
    channelId: string;
    messageId: string;
    userId: string;
    emoji: string;
    createdAt: string;
  },
) {
  const message = await getChannelMessage(db, input.channelId, input.messageId);
  if (!message || message.deletedAt) return null;

  const existing = await db
    .prepare(
      `select 1 as present from briar_channel_message_reactions
       where message_id = ? and user_id = ? and emoji = ?`,
    )
    .bind(input.messageId, input.userId, input.emoji)
    .first<{ present: number }>();

  if (existing) {
    await db
      .prepare(
        `delete from briar_channel_message_reactions
         where message_id = ? and user_id = ? and emoji = ?`,
      )
      .bind(input.messageId, input.userId, input.emoji)
      .run();
  } else {
    await db
      .prepare(
        `insert into briar_channel_message_reactions (
           message_id, user_id, emoji, created_at
         ) values (?, ?, ?, ?)`,
      )
      .bind(input.messageId, input.userId, input.emoji, input.createdAt)
      .run();
  }

  return getChannelMessage(db, input.channelId, input.messageId);
}

export async function listChannelRootMessages(
  db: D1Database,
  channelId: string,
  limit = 200,
) {
  const select = await messageSelectFor(db);
  const rows = await db
    .prepare(
      `${select}
       where message.channel_id = ? and message.parent_message_id is null
       order by message.created_at desc, message.id desc
       limit ?`,
    )
    .bind(channelId, limit)
    .all<ChannelMessageRow>();
  return attachMessageRelations(db, rows.results.reverse());
}

export async function listChannelThreadMessages(
  db: D1Database,
  channelId: string,
  parentMessageId: string,
) {
  const select = await messageSelectFor(db);
  const rows = await db
    .prepare(
      `${select}
       where message.channel_id = ?
         and (message.id = ? or message.parent_message_id = ?)
       order by message.created_at, message.id`,
    )
    .bind(channelId, parentMessageId, parentMessageId)
    .all<ChannelMessageRow>();
  return attachMessageRelations(db, rows.results);
}

export type ChannelMessagePage = {
  messages: ChannelMessage[];
  nextCursor: string | null;
};

/**
 * Read one page from the newest messages towards older history. Messages
 * within a page remain chronological so CLI consumers can render them without
 * re-sorting. A thread view includes its root message, matching the existing
 * channel thread API. Direct messages can opt into one bounded timeline that
 * also includes replies created before DM replies moved to the root level.
 */
export async function listChannelMessagePage(
  db: D1Database,
  input: {
    channelId: string;
    parentMessageId: string | null;
    cursor: string | null;
    limit: number;
    includeRepliesInTimeline?: boolean;
  },
): Promise<ChannelMessagePage | null> {
  const includesReplies =
    input.includeRepliesInTimeline === true && input.parentMessageId === null;
  const cursor = input.cursor
    ? await db
        .prepare(
          `select created_at
           from briar_channel_messages
           where channel_id = ? and id = ?
             and ${
               input.parentMessageId
                 ? `(id = ? or parent_message_id = ?)`
                 : includesReplies
                   ? "1 = 1"
                 : "parent_message_id is null"
             }`,
        )
        .bind(
          input.channelId,
          input.cursor,
          ...(input.parentMessageId
            ? [input.parentMessageId, input.parentMessageId]
            : []),
        )
        .first<{ created_at: string }>()
    : null;
  if (input.cursor && !cursor) return null;

  const select = await messageSelectFor(db);
  const scope = input.parentMessageId
    ? `(message.id = ? or message.parent_message_id = ?)`
    : includesReplies
      ? "1 = 1"
      : "message.parent_message_id is null";
  const before = cursor
    ? `and (message.created_at < ?
            or (message.created_at = ? and message.id < ?))`
    : "";
  const rows = await db
    .prepare(
      `${select}
       where message.channel_id = ? and ${scope}
         ${before}
       order by message.created_at desc, message.id desc
       limit ?`,
    )
    .bind(
      input.channelId,
      ...(input.parentMessageId
        ? [input.parentMessageId, input.parentMessageId]
        : []),
      ...(cursor ? [cursor.created_at, cursor.created_at, input.cursor] : []),
      input.limit + 1,
    )
    .all<ChannelMessageRow>();
  const hasMore = rows.results.length > input.limit;
  const pageRows = rows.results.slice(0, input.limit);
  const nextCursor = hasMore ? (pageRows.at(-1)?.id ?? null) : null;
  return {
    messages: await attachMessageRelations(db, pageRows.reverse()),
    nextCursor,
  };
}

export async function isChannelRootMessage(
  db: D1Database,
  channelId: string,
  messageId: string,
) {
  return Boolean(
    await db
      .prepare(
        `select 1 as present from briar_channel_messages
         where channel_id = ? and id = ? and parent_message_id is null`,
      )
      .bind(channelId, messageId)
      .first<{ present: number }>(),
  );
}

export async function resolveChannelThreadRootId(
  db: D1Database,
  channelId: string,
  messageId: string,
) {
  const row = await db
    .prepare(
      `select id, parent_message_id
       from briar_channel_messages
       where channel_id = ? and id = ?`,
    )
    .bind(channelId, messageId)
    .first<{ id: string; parent_message_id: string | null }>();
  if (!row) return null;
  return row.parent_message_id ?? row.id;
}

export async function listChannelThreadSubscriptions(
  db: D1Database,
  channelId: string,
  rootMessageId: string,
) {
  const result = await db
    .prepare(
      `select user_id, created_at
       from briar_channel_thread_subscriptions
       where channel_id = ? and root_message_id = ?
       order by created_at, user_id`,
    )
    .bind(channelId, rootMessageId)
    .all<{ user_id: string; created_at: string }>();
  return result.results.map((row) => ({
    userId: row.user_id,
    subscribedAt: row.created_at,
  }));
}

export async function subscribeChannelThread(
  db: D1Database,
  channelId: string,
  rootMessageId: string,
  userId: string,
  createdAt: string,
) {
  return db
    .prepare(
      `insert into briar_channel_thread_subscriptions (
         root_message_id, channel_id, organization_id, user_id, created_at
       )
       select message.id, message.channel_id, channel.organization_id, ?, ?
       from briar_channel_messages message
       join briar_channels channel on channel.id = message.channel_id
       join briar_organization_members membership
         on membership.organization_id = channel.organization_id
        and membership.user_id = ?
       where message.id = ? and message.channel_id = ?
         and message.parent_message_id is null
       on conflict (root_message_id, user_id) do nothing
       returning root_message_id`,
    )
    .bind(userId, createdAt, userId, rootMessageId, channelId)
    .first<{ root_message_id: string }>();
}

export async function unsubscribeChannelThread(
  db: D1Database,
  channelId: string,
  rootMessageId: string,
  userId: string,
) {
  return db
    .prepare(
      `delete from briar_channel_thread_subscriptions
       where root_message_id = ? and user_id = ? and channel_id = ?
       returning root_message_id`,
    )
    .bind(rootMessageId, userId, channelId)
    .first<{ root_message_id: string }>();
}

export async function getChannelMessage(
  db: D1Database,
  channelId: string,
  messageId: string,
) {
  const select = await messageSelectFor(db);
  const row = await db
    .prepare(`${select} where message.channel_id = ? and message.id = ?`)
    .bind(channelId, messageId)
    .first<ChannelMessageRow>();
  if (!row) return null;
  const [message] = await attachMessageRelations(db, [row]);
  return message ?? null;
}

type ChannelMessageDeletionTarget = {
  id: string;
  parent_message_id: string | null;
  deleted_at: string | null;
  can_delete: number;
};

async function getChannelMessageDeletionTarget(
  db: D1Database,
  input: {
    organizationId: string;
    channelId: string;
    messageId: string;
    userId: string;
  },
) {
  return db.prepare(
    `select message.id, message.parent_message_id, message.deleted_at,
            case when message.author_user_id = ?
              or exists (
                select 1 from briar_organization_members membership
                where membership.organization_id = channel.organization_id
                  and membership.user_id = ?
                  and membership.role in ('owner', 'admin')
              )
              or exists (
                select 1 from briar_channel_members membership
                where membership.channel_id = channel.id
                  and membership.user_id = ? and membership.role = 'owner'
              ) then 1 else 0 end as can_delete
     from briar_channel_messages message
     join briar_channels channel on channel.id = message.channel_id
     where channel.organization_id = ? and channel.id = ? and message.id = ?`,
  ).bind(
    input.userId,
    input.userId,
    input.userId,
    input.organizationId,
    input.channelId,
    input.messageId,
  ).first<ChannelMessageDeletionTarget>();
}

export type DeleteChannelMessageOutcome = {
  outcome: "deleted" | "already_deleted" | "not_found" | "forbidden";
  message: ChannelMessage | null;
  parentMessage: ChannelMessage | null;
};

/**
 * Delete one message without collapsing a live thread. Root messages with
 * replies become scrubbed tombstones; standalone messages and replies are
 * removed. Every mutating statement repeats the permission predicate so a
 * role change between the route check and the atomic batch cannot authorize a
 * stale request.
 */
export async function deleteChannelMessage(
  db: D1Database,
  input: {
    organizationId: string;
    channelId: string;
    messageId: string;
    userId: string;
    deletedAt: string;
  },
): Promise<DeleteChannelMessageOutcome> {
  const target = await getChannelMessageDeletionTarget(db, input);
  if (!target) {
    return { outcome: "not_found", message: null, parentMessage: null };
  }
  if (!target.can_delete) {
    return { outcome: "forbidden", message: null, parentMessage: null };
  }
  if (target.deleted_at) {
    return {
      outcome: "already_deleted",
      message: await getChannelMessage(db, input.channelId, input.messageId),
      parentMessage: null,
    };
  }

  const authorizedTarget = `exists (
    select 1 from briar_channel_messages target
    join briar_channels channel on channel.id = target.channel_id
    where target.id = ? and target.channel_id = ?
      and channel.organization_id = ? and target.deleted_at is null
      and (
        target.author_user_id = ?
        or exists (
          select 1 from briar_organization_members membership
          where membership.organization_id = channel.organization_id
            and membership.user_id = ?
            and membership.role in ('owner', 'admin')
        )
        or exists (
          select 1 from briar_channel_members membership
          where membership.channel_id = channel.id
            and membership.user_id = ? and membership.role = 'owner'
        )
      )
  )`;
  const authorizationBindings = () => [
    input.messageId,
    input.channelId,
    input.organizationId,
    input.userId,
    input.userId,
    input.userId,
  ] as const;
  const statements = [
    db.prepare(
      `insert into briar_archive_cleanup_queue (
         bucket, object_key, project_id, run_id, queued_at
       )
       select 'attachments', attachment.object_key,
              'channel:' || attachment.channel_id, null, ?
       from briar_channel_message_attachments attachment
       where attachment.organization_id = ? and attachment.channel_id = ?
         and attachment.message_id = ? and ${authorizedTarget}
       on conflict (bucket, object_key) do update set
         project_id = excluded.project_id,
         run_id = excluded.run_id,
         queued_at = excluded.queued_at,
         attempts = 0,
         last_attempt_at = null,
         last_error = null,
         generation = briar_archive_cleanup_queue.generation + 1,
         next_attempt_at = null,
         dead_lettered_at = null,
         alert_state = 'none',
         alert_detail_json = null`,
    ).bind(
      input.deletedAt,
      input.organizationId,
      input.channelId,
      input.messageId,
      ...authorizationBindings(),
    ),
    db.prepare(
      `update briar_issue_execution_proposals
       set status = 'invalidated', generation = generation + 1, updated_at = ?
       where source_kind = 'channel' and status = 'pending'
         and (trigger_message_id = ? or reply_message_id = ?)
         and ${authorizedTarget}`,
    ).bind(
      input.deletedAt,
      input.messageId,
      input.messageId,
      ...authorizationBindings(),
    ),
    db.prepare(
      `update briar_agent_skill_execution_proposals
       set status = 'invalidated', generation = generation + 1, updated_at = ?
       where source_kind = 'channel' and status = 'pending'
         and (trigger_message_id = ? or reply_message_id = ?)
         and ${authorizedTarget}`,
    ).bind(
      input.deletedAt,
      input.messageId,
      input.messageId,
      ...authorizationBindings(),
    ),
    db.prepare(
      `delete from briar_channel_action_proposals
       where channel_id = ? and status = 'pending'
         and (trigger_message_id = ? or reply_message_id = ?)
         and ${authorizedTarget}`,
    ).bind(
      input.channelId,
      input.messageId,
      input.messageId,
      ...authorizationBindings(),
    ),
    db.prepare(
      `delete from briar_channel_agent_reply_jobs
       where channel_id = ?
         and (trigger_message_id = ? or reply_message_id = ?)
         and ${authorizedTarget}`,
    ).bind(
      input.channelId,
      input.messageId,
      input.messageId,
      ...authorizationBindings(),
    ),
    ...[
      "briar_channel_message_mentions",
      "briar_channel_message_agent_mentions",
      "briar_channel_message_reactions",
      "briar_channel_message_documents",
      "briar_channel_message_attachments",
    ].map((table) => db.prepare(
      `delete from ${table} where message_id = ? and ${authorizedTarget}`,
    ).bind(input.messageId, ...authorizationBindings())),
    db.prepare(
      `update briar_channel_messages
       set body = '[deleted]', blocks_json = null, deleted_at = ?, updated_at = ?
       where id = ? and channel_id = ? and parent_message_id is null
         and deleted_at is null
         and exists (
           select 1 from briar_channel_messages reply
           where reply.parent_message_id = briar_channel_messages.id
         )
         and ${authorizedTarget}
       returning id`,
    ).bind(
      input.deletedAt,
      input.deletedAt,
      input.messageId,
      input.channelId,
      ...authorizationBindings(),
    ),
    db.prepare(
      `update briar_channel_messages
       set updated_at = ?
       where id = (
         select parent_message_id from briar_channel_messages target
         where target.id = ? and target.channel_id = ?
       ) and ${authorizedTarget}`,
    ).bind(
      input.deletedAt,
      input.messageId,
      input.channelId,
      ...authorizationBindings(),
    ),
    db.prepare(
      `delete from briar_channel_messages
       where id = ? and channel_id = ? and deleted_at is null
         and (
           parent_message_id is not null
           or not exists (
             select 1 from briar_channel_messages reply
             where reply.parent_message_id = briar_channel_messages.id
           )
         )
         and ${authorizedTarget}
       returning id`,
    ).bind(
      input.messageId,
      input.channelId,
      ...authorizationBindings(),
    ),
  ];
  const tombstoneResultIndex = statements.length - 3;
  const deleteResultIndex = statements.length - 1;
  const results = await db.batch(statements);
  const deleted =
    (results[tombstoneResultIndex]?.results?.length ?? 0) > 0 ||
    (results[deleteResultIndex]?.results?.length ?? 0) > 0;

  if (!deleted) {
    const current = await getChannelMessageDeletionTarget(db, input);
    if (current && !current.can_delete && !current.deleted_at) {
      return { outcome: "forbidden", message: null, parentMessage: null };
    }
    return {
      outcome: current?.deleted_at ? "already_deleted" : "not_found",
      message: current
        ? await getChannelMessage(db, input.channelId, input.messageId)
        : null,
      parentMessage: null,
    };
  }

  return {
    outcome: "deleted",
    message: await getChannelMessage(db, input.channelId, input.messageId),
    parentMessage: target.parent_message_id
      ? await getChannelMessage(db, input.channelId, target.parent_message_id)
      : null,
  };
}

/**
 * Mentions are stored from the structured list the client sends, never by
 * re-parsing the body. The caller validates that each target is reachable from
 * this channel before calling in.
 */
export async function createChannelMessage(
  db: D1Database,
  input: {
    id: string;
    channelId: string;
    parentMessageId: string | null;
    authorUserId: string | null;
    authorAgentId: string | null;
    authorAgentName: string | null;
    authorAgentProvider: AgentProvider | null;
    authorWebhookId?: string | null;
    authorWebhookName?: string | null;
    webhookEventId?: string | null;
    body: string;
    mentionedUserIds: string[];
    mentionedAgentIds: string[];
    attachments?: ChannelMessageAttachmentInput[];
    createdAt: string;
  },
) {
  const statements = [
    db
      .prepare(
        `insert into briar_channel_messages (
           id, channel_id, parent_message_id, author_user_id, author_agent_id,
           author_agent_name, author_agent_provider, author_webhook_id,
           author_webhook_name, webhook_event_id, body, created_at, updated_at
         )
         select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         where exists (select 1 from briar_channels where id = ?)
           and (
             ? is null
             or exists (
               select 1 from briar_channel_messages parent
               where parent.id = ? and parent.channel_id = ?
                 and parent.parent_message_id is null
             )
           )`,
      )
      .bind(
        input.id,
        input.channelId,
        input.parentMessageId,
        input.authorUserId,
        input.authorAgentId,
        input.authorAgentName,
        input.authorAgentProvider,
        input.authorWebhookId ?? null,
        input.authorWebhookName ?? null,
        input.webhookEventId ?? null,
        input.body,
        input.createdAt,
        input.createdAt,
        input.channelId,
        input.parentMessageId,
        input.parentMessageId,
        input.channelId,
      ),
    ...input.mentionedUserIds.map((userId) =>
      db
        .prepare(
          `insert into briar_channel_message_mentions (
             message_id, user_id, created_at
           )
           select ?, ?, ?
           where exists (select 1 from briar_channel_messages where id = ?)
           on conflict (message_id, user_id) do nothing`,
        )
        .bind(input.id, userId, input.createdAt, input.id),
    ),
    ...input.mentionedAgentIds.map((agentId) =>
      db
        .prepare(
          `insert into briar_channel_message_agent_mentions (
             message_id, agent_id, created_at
           )
           select ?, ?, ?
           where exists (select 1 from briar_channel_messages where id = ?)
           on conflict (message_id, agent_id) do nothing`,
        )
        .bind(input.id, agentId, input.createdAt, input.id),
    ),
    ...(input.attachments ?? []).map((attachment) =>
      db
        .prepare(
          `insert into briar_channel_message_attachments (
             id, organization_id, channel_id, message_id, object_key,
             filename, content_type, byte_size, created_at
           ) select ?, ?, ?, ?, ?, ?, ?, ?, ?
             where exists (
               select 1 from briar_channel_messages
               where id = ? and channel_id = ?
             )`,
        )
        .bind(
          attachment.id,
          attachment.organization_id,
          input.channelId,
          input.id,
          attachment.object_key,
          attachment.filename,
          attachment.content_type,
          attachment.byte_size,
          input.createdAt,
          input.id,
          input.channelId,
        ),
    ),
  ];
  await db.batch(statements);
  return getChannelMessage(db, input.channelId, input.id);
}

export async function createIncomingChannelWebhookMessage(
  db: D1Database,
  input: {
    id: string;
    webhookId: string;
    channelId: string;
    webhookName: string;
    eventId: string | null;
    body: string;
    blocks: ChannelMessageBlock[] | null;
    createdAt: string;
  },
) {
  const result = await db.prepare(
    `insert into briar_channel_messages (
       id, channel_id, parent_message_id, author_user_id, author_agent_id,
       author_agent_name, author_agent_provider, author_webhook_id,
       author_webhook_name, webhook_event_id, body, blocks_json,
       created_at, updated_at
     ) values (?, ?, null, null, null, null, null, ?, ?, ?, ?, ?, ?, ?)
     on conflict (author_webhook_id, webhook_event_id) where
       author_webhook_id is not null and webhook_event_id is not null
     do nothing
     returning id`,
  ).bind(
    input.id,
    input.channelId,
    input.webhookId,
    input.webhookName,
    input.eventId,
    input.body,
    input.blocks ? JSON.stringify(input.blocks) : null,
    input.createdAt,
    input.createdAt,
  ).first<{ id: string }>();
  const messageId = result?.id ?? (input.eventId
    ? (await db.prepare(
        `select id from briar_channel_messages
         where author_webhook_id = ? and webhook_event_id = ?`,
      ).bind(input.webhookId, input.eventId).first<{ id: string }>())?.id
    : null);
  if (!messageId) return null;
  await db.prepare(
    `update briar_channel_webhooks set last_used_at = ?, updated_at = ?
     where id = ?`,
  ).bind(input.createdAt, input.createdAt, input.webhookId).run();
  return {
    message: await getChannelMessage(db, input.channelId, messageId),
    created: Boolean(result),
  };
}

export async function getChannelMessageAttachment(
  db: D1Database,
  organizationId: string,
  channelId: string,
  messageId: string,
  attachmentId: string,
) {
  return db
    .prepare(
      `select id, organization_id, channel_id, message_id, object_key,
              filename, content_type, byte_size, created_at
       from briar_channel_message_attachments
       where organization_id = ? and channel_id = ? and message_id = ? and id = ?`,
    )
    .bind(organizationId, channelId, messageId, attachmentId)
    .first<ChannelMessageAttachmentRow>();
}

export async function getChannelMessageDocument(
  db: D1Database,
  channelId: string,
  messageId: string,
) {
  return db
    .prepare(
      `select message_id, channel_id, project_id, title, markdown
       from briar_channel_message_documents
       where channel_id = ? and message_id = ?`,
    )
    .bind(channelId, messageId)
    .first<ChannelMessageDocumentRow>();
}

/**
 * Resolve an image only when it belongs to the message that triggered the
 * active reply claim on this exact Worker device. This keeps a leaked claim
 * token, another channel image ID, or another enrolled device from widening
 * access to private channel files.
 */
export async function getClaimedChannelReplyAttachment(
  db: D1Database,
  input: {
    organizationId: string;
    jobId: string;
    deviceId: string;
    claimTokenHash: string;
    attachmentId: string;
    observedAt: string;
  },
) {
  return db
    .prepare(
      `select attachment.id, attachment.organization_id, attachment.channel_id,
              attachment.message_id, attachment.object_key, attachment.filename,
              attachment.content_type, attachment.byte_size, attachment.created_at
       from briar_channel_agent_reply_jobs job
       join briar_channel_message_attachments attachment
         on attachment.organization_id = job.organization_id
        and attachment.channel_id = job.channel_id
        and attachment.message_id = job.trigger_message_id
       where job.id = ? and job.organization_id = ?
         and job.claimed_device_id = ? and job.claim_token_hash = ?
         and job.status = 'running' and job.lease_expires_at > ?
         and exists (
           select 1 from briar_channel_agents current_roster
           where current_roster.channel_id = job.channel_id
             and current_roster.agent_id = job.agent_id
         )
         and ${liveChannelReplyRuntime("job")}
         and exists (
           select 1 from briar_execution_workers binding
           where binding.id = job.claimed_worker_id
             and binding.device_id = job.claimed_device_id
             and binding.state <> 'disabled'
             and (job.project_id is null or binding.project_id = job.project_id)
         )
         and attachment.id = ?`,
    )
    .bind(
      input.jobId,
      input.organizationId,
      input.deviceId,
      input.claimTokenHash,
      input.observedAt,
      input.attachmentId,
    )
    .first<ChannelMessageAttachmentRow>();
}

/**
 * One job per mentioned agent, so a message that names two agents gets two
 * independent replies. Organization agents leave project_id null, which is what
 * makes them claimable by any device in the organization.
 */
export async function enqueueChannelAgentReplies(
  db: D1Database,
  input: {
    organizationId: string;
    channelId: string;
    triggerMessageId: string;
    parentMessageId: string;
    agents: Array<{
      id: string;
      projectId: string | null;
      skillId?: string | null;
      provider: AgentProvider;
      unavailableReason?: ChannelReplyUnavailableReason | null;
    }>;
    preferredDeviceId?: string | null;
    createdAt: string;
  },
) {
  if (input.agents.length === 0) return [];
  const retainedUntil = channelReplySessionRetentionUntil(input.createdAt);
  const skillSnapshotsAvailable =
    await channelSkillExecutionProposalTablesAvailable(db);
  const skillSnapshotColumns = skillSnapshotsAvailable
    ? `,
       selected_agent_name_snapshot,
       selected_agent_responsibility_snapshot,
       selected_skill_name_snapshot, selected_skill_instructions_snapshot,
       selected_skill_kind_snapshot,
       selected_skill_provider_snapshot, selected_skill_model_snapshot,
       selected_skill_effort_snapshot, skill_execution_request_snapshot`
    : "";
  const skillSnapshotValues = skillSnapshotsAvailable
    ? `,
       case when current_skill.id is null then null else current_agent.name end,
       case when current_skill.id is null then null
         else current_agent.responsibility end,
       current_skill.name, current_skill.body, current_skill.kind,
       current_skill.provider,
       current_skill.model, current_skill.effort,
       case when current_skill.id is null then null else trigger_message.body end`
    : "";
  await db.batch(
    input.agents.flatMap((agent) => {
      const sessionId = crypto.randomUUID();
      return [
        db.prepare(
          `insert into briar_channel_reply_sessions (
             id, organization_id, channel_id, thread_root_message_id,
             project_id, agent_id, provider, model, effort,
             owner_device_id, owner_worker_id, owner_worker_label,
             last_activity_at, retained_until, created_at, updated_at
           )
           select ?, ?, ?, ?, ?, ?,
                  case when current_skill.id is null
                    then current_agent.provider
                    when current_skill.execution_mode = 'conversation'
                      and existing_session.retained_until > ?
                    then existing_session.provider
                    when current_skill.execution_mode = 'conversation'
                    then current_agent.provider
                    else current_skill.provider end,
                  case when current_skill.id is null
                    then current_agent.model
                    when current_skill.execution_mode = 'conversation'
                      and existing_session.retained_until > ?
                    then existing_session.model
                    when current_skill.execution_mode = 'conversation'
                    then current_agent.model
                    else current_skill.model end,
                  case when current_skill.id is null
                    then current_agent.effort
                    when current_skill.execution_mode = 'conversation'
                      and existing_session.retained_until > ?
                    then existing_session.effort
                    when current_skill.execution_mode = 'conversation'
                    then current_agent.effort
                    else current_skill.effort end,
                  designated_worker.device_id, designated_worker.id,
                  current_agent.designated_worker_label,
                  ?, ?, ?, ?
           from briar_channel_agents roster
           join briar_project_agents current_agent
             on current_agent.id = roster.agent_id
           left join briar_agent_skills current_skill
             on current_skill.id = ? and current_skill.agent_id = current_agent.id
           left join briar_channel_reply_sessions existing_session
             on existing_session.channel_id = ?
            and existing_session.thread_root_message_id = ?
            and existing_session.agent_id = current_agent.id
           left join briar_execution_workers designated_worker
             on designated_worker.id = current_agent.designated_worker_id
            and designated_worker.project_id = current_agent.project_id
           where roster.channel_id = ? and roster.agent_id = ?
             and current_agent.organization_id = ?
             and current_agent.project_id is ?
             and (
               (? is null and current_agent.provider = ?)
               or (
                 current_skill.id = ?
                 and (
                   current_skill.execution_mode = 'conversation'
                   or current_skill.provider = ?
                 )
               )
             )
           on conflict (channel_id, thread_root_message_id, agent_id)
           do update set
             project_id = excluded.project_id,
             conversation_id = case
               when briar_channel_reply_sessions.retained_until <=
                      excluded.last_activity_at
                 or briar_channel_reply_sessions.provider <> excluded.provider
                 or briar_channel_reply_sessions.model is not excluded.model
                 or briar_channel_reply_sessions.effort is not excluded.effort
               then null else briar_channel_reply_sessions.conversation_id end,
             owner_device_id = case
               when briar_channel_reply_sessions.retained_until <=
                      excluded.last_activity_at
               then excluded.owner_device_id
               else briar_channel_reply_sessions.owner_device_id end,
             owner_worker_id = case
               when briar_channel_reply_sessions.retained_until <=
                      excluded.last_activity_at
               then excluded.owner_worker_id
               else briar_channel_reply_sessions.owner_worker_id end,
             owner_worker_label = case
               when briar_channel_reply_sessions.retained_until <=
                      excluded.last_activity_at
               then excluded.owner_worker_label
               else briar_channel_reply_sessions.owner_worker_label end,
             provider = excluded.provider, model = excluded.model,
             effort = excluded.effort,
             last_activity_at = excluded.last_activity_at,
             retained_until = excluded.retained_until,
             updated_at = excluded.updated_at`,
        ).bind(
          sessionId,
          input.organizationId,
          input.channelId,
          input.parentMessageId,
          agent.projectId,
          agent.id,
          input.createdAt,
          input.createdAt,
          input.createdAt,
          input.createdAt,
          retainedUntil,
          input.createdAt,
          input.createdAt,
          agent.skillId ?? null,
          input.channelId,
          input.parentMessageId,
          input.channelId,
          agent.id,
          input.organizationId,
          agent.projectId,
          agent.skillId ?? null,
          agent.provider,
          agent.skillId ?? null,
          agent.provider,
        ),
        db.prepare(
          `insert into briar_channel_agent_reply_jobs (
             id, organization_id, channel_id, project_id, agent_id, skill_id,
             selected_skill_id_snapshot${skillSnapshotColumns},
             session_id, trigger_message_id, parent_message_id, reply_message_id,
             agent_provider, preferred_device_id, status, error, completed_at,
             created_at, updated_at
           )
           select ?, ?, ?, ?, ?, ?, ?${skillSnapshotValues}, session.id,
                  ?, ?, ?,
                  case when current_skill.id is null
                    or current_skill.execution_mode = 'conversation'
                    then session.provider else current_skill.provider end,
                  ?, ?, ?, ?, ?, ?
           from briar_channel_agents roster
           join briar_project_agents current_agent
             on current_agent.id = roster.agent_id
           left join briar_agent_skills current_skill
             on current_skill.id = ? and current_skill.agent_id = current_agent.id
           join briar_channels channel
             on channel.id = roster.channel_id
            and channel.organization_id = current_agent.organization_id
           join briar_channel_messages trigger_message
             on trigger_message.id = ?
            and trigger_message.channel_id = channel.id
           join briar_channel_reply_sessions session
             on session.channel_id = channel.id
            and session.thread_root_message_id = ?
            and session.agent_id = current_agent.id
           where roster.channel_id = ? and roster.agent_id = ?
             and current_agent.organization_id = ?
             and current_agent.project_id is ?
             and (
               (? is null and current_agent.provider = ?)
               or (
                 current_skill.id = ?
                 and (
                   current_skill.execution_mode = 'conversation'
                   or current_skill.provider = ?
                 )
               )
             )
           on conflict (channel_id, trigger_message_id, agent_id) do nothing`,
        ).bind(
          crypto.randomUUID(),
          input.organizationId,
          input.channelId,
          agent.projectId,
          agent.id,
          agent.skillId ?? null,
          agent.skillId ?? null,
          input.triggerMessageId,
          input.parentMessageId,
          crypto.randomUUID(),
          input.preferredDeviceId ?? null,
          agent.unavailableReason ? "failed" : "queued",
          agent.unavailableReason ?? null,
          agent.unavailableReason ? input.createdAt : null,
          input.createdAt,
          input.createdAt,
          agent.skillId ?? null,
          input.triggerMessageId,
          input.parentMessageId,
          input.channelId,
          agent.id,
          input.organizationId,
          agent.projectId,
          agent.skillId ?? null,
          agent.provider,
          agent.skillId ?? null,
          agent.provider,
        ),
        db.prepare(
          `insert into briar_channel_reply_session_events (
             id, session_id, reply_job_id, event_type, reason,
             retained_until, detail_json, occurred_at
           )
           select ?, session.id, job.id, 'ttl_renewed', 'message_enqueued',
                  ?, '{}', ?
           from briar_channel_reply_sessions session
           join briar_channel_agent_reply_jobs job
             on job.session_id = session.id and job.trigger_message_id = ?
           where session.channel_id = ?
             and session.thread_root_message_id = ? and session.agent_id = ?`,
        ).bind(
          crypto.randomUUID(),
          retainedUntil,
          input.createdAt,
          input.triggerMessageId,
          input.channelId,
          input.parentMessageId,
          agent.id,
        ),
      ];
    }),
  );
  const rows = await db
    .prepare(
      `select * from briar_channel_agent_reply_jobs
       where channel_id = ? and trigger_message_id = ?
       order by created_at, id`,
    )
    .bind(input.channelId, input.triggerMessageId)
    .all<ChannelReplyJobRow>();
  return rows.results;
}

export async function listChannelAgentReplies(
  db: D1Database,
  channelId: string,
  triggerMessageId: string,
) {
  const rows = await db
    .prepare(
      `select * from briar_channel_agent_reply_jobs
       where channel_id = ? and trigger_message_id = ?
       order by created_at, id`,
    )
    .bind(channelId, triggerMessageId)
    .all<ChannelReplyJobRow>();
  return rows.results;
}

export async function listActiveChannelAgentReplies(
  db: D1Database,
  channelId: string,
) {
  const rows = await db
    .prepare(
      `select * from briar_channel_agent_reply_jobs
       where channel_id = ? and status in ('queued', 'running')
       order by created_at, id`,
    )
    .bind(channelId)
    .all<ChannelReplyJobRow>();
  return rows.results;
}

export async function getChannelAgentReplyJob(
  db: D1Database,
  organizationId: string,
  jobId: string,
) {
  return db
    .prepare(
      `select * from briar_channel_agent_reply_jobs
       where id = ? and organization_id = ?`,
    )
    .bind(jobId, organizationId)
    .first<ChannelReplyJobRow>();
}

export async function getChannelReplySession(
  db: D1Database,
  sessionId: string,
) {
  return db.prepare(
    `select * from briar_channel_reply_sessions where id = ?`,
  ).bind(sessionId).first<ChannelReplySessionRow>();
}

export async function getChannelReplySessionForThread(
  db: D1Database,
  input: { channelId: string; threadRootMessageId: string; agentId: string },
) {
  return db.prepare(
    `select * from briar_channel_reply_sessions
     where channel_id = ? and thread_root_message_id = ? and agent_id = ?`,
  ).bind(
    input.channelId,
    input.threadRootMessageId,
    input.agentId,
  ).first<ChannelReplySessionRow>();
}

export async function checkpointChannelReplySession(
  db: D1Database,
  input: {
    jobId: string;
    deviceId: string;
    workerId: string;
    claimTokenHash: string;
    conversationId: string | null;
    observedAt: string;
  },
) {
  const retainedUntil = channelReplySessionRetentionUntil(input.observedAt);
  const [updated] = await db.batch([
    db.prepare(
      `update briar_channel_reply_sessions
       set conversation_id = ?, last_activity_at = ?, retained_until = ?,
           updated_at = ?
       where owner_device_id = ? and owner_worker_id = ?
         and exists (
           select 1 from briar_channel_agent_reply_jobs job
           where job.id = ? and job.session_id =
                 briar_channel_reply_sessions.id
             and job.claimed_device_id = ? and job.claimed_worker_id = ?
             and job.claim_token_hash = ? and job.status = 'running'
             and job.lease_expires_at > ?
         )
       returning *`,
    ).bind(
      input.conversationId,
      input.observedAt,
      retainedUntil,
      input.observedAt,
      input.deviceId,
      input.workerId,
      input.jobId,
      input.deviceId,
      input.workerId,
      input.claimTokenHash,
      input.observedAt,
    ),
    db.prepare(
      `insert into briar_channel_reply_session_events (
         id, session_id, reply_job_id, event_type, reason,
         from_worker_id, to_worker_id, retained_until, detail_json,
         occurred_at
       )
       select ?, session.id, job.id, 'checkpointed', ?, ?, ?, ?, '{}', ?
       from briar_channel_reply_sessions session
       join briar_channel_agent_reply_jobs job on job.session_id = session.id
       where job.id = ? and job.claimed_device_id = ?
         and job.claimed_worker_id = ? and job.claim_token_hash = ?
         and job.status = 'running' and job.lease_expires_at > ?
         and session.updated_at = ? and session.owner_worker_id = ?`,
    ).bind(
      crypto.randomUUID(),
      input.conversationId ? "provider_conversation_saved" : "provider_conversation_reset",
      input.workerId,
      input.workerId,
      retainedUntil,
      input.observedAt,
      input.jobId,
      input.deviceId,
      input.workerId,
      input.claimTokenHash,
      input.observedAt,
      input.observedAt,
      input.workerId,
    ),
  ]);
  return (updated.results[0] as ChannelReplySessionRow | undefined) ?? null;
}

/** Clears expired ownership and provider state, but never while a live reply
 * lease exists. The stable row preserves thread isolation and its audit trail.
 */
export async function cleanupExpiredChannelReplySessions(
  db: D1Database,
  input: { observedAt: string; limit?: number },
) {
  const limit = Math.min(500, Math.max(1, input.limit ?? 100));
  const candidates = await db.prepare(
    `select id from briar_channel_reply_sessions session
     where retained_until <= ?
       and (owner_worker_id is not null or conversation_id is not null)
       and not exists (
         select 1 from briar_channel_agent_reply_jobs job
         where job.session_id = session.id and job.status = 'running'
           and job.lease_expires_at > ?
       )
     order by retained_until, id limit ?`,
  ).bind(input.observedAt, input.observedAt, limit).all<{ id: string }>();
  const cleaned: ChannelReplySessionRow[] = [];
  for (const candidate of candidates.results) {
    const [updated] = await db.batch([
      db.prepare(
        `update briar_channel_reply_sessions
         set owner_device_id = null, owner_worker_id = null,
             owner_worker_label = null, conversation_id = null, updated_at = ?
         where id = ? and retained_until <= ?
           and not exists (
             select 1 from briar_channel_agent_reply_jobs job
             where job.session_id = briar_channel_reply_sessions.id
               and job.status = 'running' and job.lease_expires_at > ?
           )
         returning *`,
      ).bind(
        input.observedAt,
        candidate.id,
        input.observedAt,
        input.observedAt,
      ),
      db.prepare(
        `insert into briar_channel_reply_session_events (
           id, session_id, event_type, reason, retained_until,
           detail_json, occurred_at
         )
         select ?, id, 'cleaned', 'ttl_expired', retained_until, '{}', ?
         from briar_channel_reply_sessions
         where id = ? and updated_at = ? and owner_worker_id is null
           and conversation_id is null`,
      ).bind(
        crypto.randomUUID(),
        input.observedAt,
        candidate.id,
        input.observedAt,
      ),
    ]);
    const row = updated.results[0] as ChannelReplySessionRow | undefined;
    if (row) cleaned.push(row);
  }
  return cleaned;
}

/**
 * Any enabled binding may host an organization job. A Project Agent job may
 * only be claimed by the exact binding for that project; device identity alone
 * is insufficient because one device can run several project loops.
 */
export async function claimNextChannelAgentReply(
  db: D1Database,
  organizationId: string,
  input: {
    deviceId: string;
    workerId: string;
    providers: AgentProvider[];
    workerAgentProvider?: AgentProvider;
    workerCapabilitiesJson?: string;
    supportsOrganizationAgentContext: boolean;
    claimTokenHash: string;
    claimedAt: string;
    leaseExpiresAt: string;
  },
) {
  // Migration 0092 is a deployment prerequisite, so every claim enforces the
  // saved-Skill snapshot without a runtime compatibility branch.
  const liveSkillSnapshot = (job: string) => `(
         ${job}.selected_skill_id_snapshot is null
         or (
           ${job}.skill_id = ${job}.selected_skill_id_snapshot
           and exists (
             select 1
             from briar_project_agents snapshot_agent
             join briar_agent_skills snapshot_skill
               on snapshot_skill.agent_id = snapshot_agent.id
             join briar_channel_messages snapshot_trigger
               on snapshot_trigger.id = ${job}.trigger_message_id
              and snapshot_trigger.channel_id = ${job}.channel_id
             where snapshot_agent.id = ${job}.agent_id
               and snapshot_agent.organization_id = ${job}.organization_id
               and snapshot_agent.project_id is ${job}.project_id
               and snapshot_agent.name = ${job}.selected_agent_name_snapshot
               and snapshot_agent.responsibility =
                 ${job}.selected_agent_responsibility_snapshot
               and snapshot_skill.id = ${job}.selected_skill_id_snapshot
               and snapshot_skill.name = ${job}.selected_skill_name_snapshot
               and snapshot_skill.body =
                 ${job}.selected_skill_instructions_snapshot
               and snapshot_skill.kind = ${job}.selected_skill_kind_snapshot
               and (
                 snapshot_skill.execution_mode = 'conversation'
                 or (
                   snapshot_skill.provider =
                     ${job}.selected_skill_provider_snapshot
                   and snapshot_skill.model is
                     ${job}.selected_skill_model_snapshot
                   and snapshot_skill.effort is
                     ${job}.selected_skill_effort_snapshot
                 )
               )
               and (
                 (${job}.approved_skill_execution_proposal_id is not null
                   and exists (
                     select 1
                     from briar_agent_skill_execution_proposals approved
                     where approved.id =
                         ${job}.approved_skill_execution_proposal_id
                       and approved.status = 'accepted'
                       and approved.execution_mode = 'conversation'
                       and approved.result_reply_job_id = ${job}.id
                       and approved.result_message_id = ${job}.reply_message_id
                       and approved.result_session_id = ${job}.session_id
                       and approved.reply_message_id = ${job}.trigger_message_id
                       and approved.channel_id = ${job}.channel_id
                       and approved.thread_root_message_id =
                         ${job}.parent_message_id
                       and approved.agent_id = ${job}.agent_id
                       and approved.skill_id = ${job}.skill_id
                       and approved.request =
                         ${job}.skill_execution_request_snapshot
                   ))
                 or
                 (${job}.approved_skill_execution_proposal_id is null
                   and ${job}.delegated_by_reply_job_id is null
                   and ${job}.skill_execution_request_snapshot =
                     snapshot_trigger.body)
                 or
                 (${job}.approved_skill_execution_proposal_id is null
                   and ${job}.delegated_by_reply_job_id is not null
                   and ${job}.skill_execution_request_snapshot =
                     ${job}.delegation_request)
               )
             )
         )
       )`;
  await db
    .prepare(
      `update briar_channel_agent_reply_jobs
       set status = 'failed',
           error = 'Agent provider or selected Skill changed before reply execution.',
           claimed_device_id = null, claimed_worker_id = null,
           claim_token_hash = null, lease_expires_at = null,
           completed_at = ?, updated_at = ?
       where organization_id = ? and status in ('queued', 'running')
         and not (
           ${liveChannelReplyRuntime("briar_channel_agent_reply_jobs")}
           and ${liveSkillSnapshot("briar_channel_agent_reply_jobs")}
         )`,
    )
    .bind(input.claimedAt, input.claimedAt, organizationId)
    .run();
  await db
    .prepare(
      `update briar_channel_agent_reply_jobs
       set status = 'failed',
           error = coalesce(error, 'Channel reply lease expired repeatedly.'),
           claimed_device_id = null, claimed_worker_id = null,
           claim_token_hash = null, lease_expires_at = null, updated_at = ?
       where organization_id = ? and status = 'running' and attempts >= ?
         and lease_expires_at <= ?`,
    )
    .bind(input.claimedAt, organizationId, MAX_REPLY_ATTEMPTS, input.claimedAt)
    .run();
  const assignedJobs = await db.prepare(
    `select job.id, job.project_id,
            case when current_skill.execution_mode = 'conversation'
              then session.provider else job.agent_provider end as agent_provider,
            case when job.selected_skill_id_snapshot is null
              then agent.model
              when current_skill.execution_mode = 'conversation'
              then session.model else job.selected_skill_model_snapshot end as runtime_model,
            case when job.selected_skill_id_snapshot is null
              then agent.effort
              when current_skill.execution_mode = 'conversation'
              then session.effort else job.selected_skill_effort_snapshot end as runtime_effort,
            session.owner_device_id, session.owner_worker_id,
            session.owner_worker_label
     from briar_channel_agent_reply_jobs job
     join briar_project_agents agent on agent.id = job.agent_id
     join briar_channel_reply_sessions session on session.id = job.session_id
     left join briar_agent_skills current_skill
       on current_skill.id = job.skill_id and current_skill.agent_id = job.agent_id
     where job.organization_id = ? and session.owner_worker_id is not null
       and (job.status = 'queued'
         or (job.status = 'running' and job.lease_expires_at <= ?))`,
  ).bind(organizationId, input.claimedAt).all<{
    id: string;
    project_id: string | null;
    agent_provider: AgentProvider | null;
    runtime_model: string | null;
    runtime_effort: AgentSkillEffort | null;
    owner_device_id: string | null;
    owner_worker_id: string;
    owner_worker_label: string | null;
  }>();
  for (const assigned of assignedJobs.results) {
    if (!assigned.agent_provider) continue;
    const availability = await channelReplyWorkerAvailability(db, {
      organizationId,
      projectId: assigned.project_id,
      preferredDeviceId: assigned.owner_device_id,
      preferredWorkerId: assigned.owner_worker_id,
      provider: assigned.agent_provider,
      model: assigned.runtime_model,
      effort: assigned.runtime_effort,
      observedAt: input.claimedAt,
    });
    if (availability === "available") continue;
    const error = channelReplyAssignedWorkerUnavailableError(
      assigned.owner_worker_label ?? assigned.owner_worker_id,
    );
    await db.prepare(
      `update briar_channel_agent_reply_jobs
       set status = 'failed', error = ?, completed_at = ?, updated_at = ?,
           claimed_device_id = null, claimed_worker_id = null,
           claim_token_hash = null, lease_expires_at = null
       where id = ? and organization_id = ?
         and (status = 'queued'
           or (status = 'running' and lease_expires_at <= ?))
         and exists (
           select 1 from briar_channel_reply_sessions session
           where session.id = briar_channel_agent_reply_jobs.session_id
             and session.owner_worker_id = ?
         )`,
    ).bind(
      error,
      input.claimedAt,
      input.claimedAt,
      assigned.id,
      organizationId,
      input.claimedAt,
      assigned.owner_worker_id,
    ).run();
  }
  const claimingWorker = await db.prepare(
    `select label from briar_execution_workers
     where id = ? and device_id = ?`,
  ).bind(input.workerId, input.deviceId).first<{ label: string }>();
  if (!claimingWorker) return null;
  const candidates = await db.prepare(
    `select job.*,
            session.owner_device_id as session_owner_device_id,
            session.owner_worker_id as session_owner_worker_id,
            session.conversation_id as session_conversation_id,
            session.retained_until as session_retained_until,
            session.created_at as session_created_at,
            session.updated_at as session_updated_at,
            session.provider as session_provider,
            session.model as session_model,
            session.effort as session_effort,
            case when job.selected_skill_id_snapshot is null
              then current_agent.model
              when current_skill.execution_mode = 'conversation'
              then session.model
              else job.selected_skill_model_snapshot end as runtime_model,
            case when job.selected_skill_id_snapshot is null
              then current_agent.effort
              when current_skill.execution_mode = 'conversation'
              then session.effort
              else job.selected_skill_effort_snapshot end as runtime_effort
     from briar_channel_agent_reply_jobs job
     join briar_project_agents current_agent on current_agent.id = job.agent_id
     join briar_channel_reply_sessions session on session.id = job.session_id
     left join briar_agent_skills current_skill
       on current_skill.id = job.skill_id and current_skill.agent_id = job.agent_id
     where job.organization_id = ? and job.attempts < ?
       and (job.status = 'queued'
         or (job.status = 'running' and job.lease_expires_at <= ?))
       and not exists (
         select 1 from briar_channel_agent_reply_jobs active_job
         where active_job.session_id = job.session_id
           and active_job.id <> job.id and active_job.status = 'running'
           and active_job.lease_expires_at > ?
       )
       and exists (
         select 1 from briar_channel_agents current_roster
         where current_roster.channel_id = job.channel_id
           and current_roster.agent_id = job.agent_id
       )
       and ${liveChannelReplyRuntime("job")}
       and ${liveSkillSnapshot("job")}
       and (job.project_id is not null or ? = 1)
       and ((job.agent_provider = 'codex' and ? = 1)
         or (job.agent_provider = 'claude' and ? = 1)
         or (job.agent_provider = 'cursor' and ? = 1)
         or (job.agent_provider = 'grok' and ? = 1)
         or (job.agent_provider = 'agy' and ? = 1)
         or (job.agent_provider = 'opencode' and ? = 1)
         or (job.agent_provider = 'openrouter' and ? = 1))
       and exists (
         select 1 from briar_execution_workers binding
         where binding.id = ? and binding.device_id = ?
           and binding.state <> 'disabled'
           and (job.project_id is null or binding.project_id = job.project_id)
           and (
             job.project_id is null
             or not exists (
               select 1 from briar_project_execution_worker_policies policy
               where policy.project_id = job.project_id
                 and policy.selection_mode = 'allowlist'
             )
             or exists (
               select 1 from briar_project_execution_worker_allowlist allowed
               where allowed.project_id = job.project_id
                 and allowed.worker_id = binding.id
             )
           )
           and (
             job.project_id is not null
             or (
               json_valid(binding.capabilities_json)
               and json_type(
                 binding.capabilities_json,
                 '$.organizationAgentContext'
               ) = 'object'
               and json_type(
                 binding.capabilities_json,
                 '$.organizationAgentContext.protocol'
               ) = 'integer'
               and json_extract(
                 binding.capabilities_json,
                 '$.organizationAgentContext.protocol'
               ) = 1
             )
           )
       )
     order by job.created_at, job.id`,
  ).bind(
    organizationId,
    MAX_REPLY_ATTEMPTS,
    input.claimedAt,
    input.claimedAt,
    input.supportsOrganizationAgentContext ? 1 : 0,
    input.providers.includes("codex") ? 1 : 0,
    input.providers.includes("claude") ? 1 : 0,
    input.providers.includes("cursor") ? 1 : 0,
    input.providers.includes("grok") ? 1 : 0,
    input.providers.includes("agy") ? 1 : 0,
    input.providers.includes("opencode") ? 1 : 0,
    input.providers.includes("openrouter") ? 1 : 0,
    input.workerId,
    input.deviceId,
  ).all<ChannelReplyJobRow & {
    runtime_model: string | null;
    runtime_effort: AgentSkillEffort | null;
    session_owner_device_id: string | null;
    session_owner_worker_id: string | null;
    session_conversation_id: string | null;
    session_retained_until: string;
    session_created_at: string;
    session_updated_at: string;
    session_provider: AgentProvider;
    session_model: string | null;
    session_effort: AgentSkillEffort | null;
  }>();

  const preferredAvailability = new Map<string, boolean>();
  for (const candidate of candidates.results) {
    if (!candidate.agent_provider) continue;
    const supportsSelection = input.workerCapabilitiesJson &&
        input.workerAgentProvider
      ? executionWorkerSupportsSelection(
          {
            agent_provider: input.workerAgentProvider,
            capabilities_json: input.workerCapabilitiesJson,
          },
          candidate.agent_provider,
          candidate.runtime_model,
          candidate.runtime_effort,
        )
      // Direct database callers predate capability snapshots. The production
      // claim route always supplies them; retain provider-only compatibility
      // for those internal callers while enforcing exact selection at the API.
      : input.providers.includes(candidate.agent_provider);
    if (!supportsSelection) continue;

    const sessionExpired = candidate.session_retained_until <= input.claimedAt;
    if (
      candidate.session_owner_worker_id &&
      candidate.session_owner_worker_id !== input.workerId
    ) continue;
    const claimingWorkerOwnsSession =
      candidate.session_owner_worker_id === input.workerId;

    // A healthy live session owner is the elected claimant. Reapplying a
    // conflicting message-level device preference here would make the owner
    // and preferred device yield to each other indefinitely.
    if (
      !claimingWorkerOwnsSession &&
      candidate.preferred_device_id &&
      candidate.preferred_device_id !== input.deviceId
    ) {
      const preferenceKey = JSON.stringify([
        candidate.preferred_device_id,
        candidate.project_id,
        candidate.agent_provider,
        candidate.runtime_model,
        candidate.runtime_effort,
      ]);
      let available = preferredAvailability.get(preferenceKey);
      if (available === undefined) {
        available = await hasAvailableChannelReplyWorker(db, {
          organizationId,
          projectId: candidate.project_id,
          preferredDeviceId: candidate.preferred_device_id,
          provider: candidate.agent_provider,
          model: candidate.runtime_model,
          effort: candidate.runtime_effort,
          observedAt: input.claimedAt,
        });
        preferredAvailability.set(preferenceKey, available);
      }
      if (available) continue;
    }

    const runtimeChanged = candidate.session_provider !== candidate.agent_provider ||
      candidate.session_model !== candidate.runtime_model ||
      candidate.session_effort !== candidate.runtime_effort;
    const claimReason = sessionExpired
      ? "ttl_expired_reactivated"
      : candidate.session_owner_worker_id === input.workerId
      ? candidate.attempts === 0 &&
          candidate.session_created_at === candidate.session_updated_at
        ? "designated_worker_claimed"
        : runtimeChanged ? "worker_reused_runtime_changed" : "worker_reused"
      : "session_created";
    const retainedUntil = channelReplySessionRetentionUntil(input.claimedAt);
    const [claimResult, sessionResult] = await db.batch([
      db.prepare(
        `update briar_channel_agent_reply_jobs
       set status = 'running', claimed_device_id = ?, claimed_worker_id = ?,
           claim_token_hash = ?, claimed_at = ?, lease_expires_at = ?,
           attempts = attempts + case when planned_update_resume = 1 then 0 else 1 end,
           planned_update_resume = 0, error = null, updated_at = ?
       where id = ? and organization_id = ? and attempts < ?
         and session_id = ?
         and (status = 'queued'
           or (status = 'running' and lease_expires_at <= ?))
         and not exists (
           select 1 from briar_channel_agent_reply_jobs active_job
           where active_job.session_id = briar_channel_agent_reply_jobs.session_id
             and active_job.id <> briar_channel_agent_reply_jobs.id
             and active_job.status = 'running'
             and active_job.lease_expires_at > ?
         )
         and exists (
           select 1 from briar_channel_reply_sessions session
           where session.id = briar_channel_agent_reply_jobs.session_id
             and session.updated_at = ?
             and session.owner_worker_id is ?
         )
         and exists (
           select 1 from briar_channel_agents current_roster
           where current_roster.channel_id = briar_channel_agent_reply_jobs.channel_id
             and current_roster.agent_id = briar_channel_agent_reply_jobs.agent_id
         )
         and ${liveChannelReplyRuntime("briar_channel_agent_reply_jobs")}
         and ${liveSkillSnapshot("briar_channel_agent_reply_jobs")}
         and exists (
           select 1 from briar_execution_workers binding
           where binding.id = ? and binding.device_id = ?
             and binding.state <> 'disabled'
             and (
               briar_channel_agent_reply_jobs.project_id is null
               or binding.project_id = briar_channel_agent_reply_jobs.project_id
             )
             and (
               briar_channel_agent_reply_jobs.project_id is null
               or not exists (
                 select 1 from briar_project_execution_worker_policies policy
                 where policy.project_id = briar_channel_agent_reply_jobs.project_id
                   and policy.selection_mode = 'allowlist'
               )
               or exists (
                 select 1 from briar_project_execution_worker_allowlist allowed
                 where allowed.project_id = briar_channel_agent_reply_jobs.project_id
                   and allowed.worker_id = binding.id
               )
             )
         )
       returning *`,
      ).bind(
        input.deviceId,
        input.workerId,
        input.claimTokenHash,
        input.claimedAt,
        input.leaseExpiresAt,
        input.claimedAt,
        candidate.id,
        organizationId,
        MAX_REPLY_ATTEMPTS,
        candidate.session_id,
        input.claimedAt,
        input.claimedAt,
        candidate.session_updated_at,
        candidate.session_owner_worker_id,
        input.workerId,
        input.deviceId,
      ),
      db.prepare(
        `update briar_channel_reply_sessions
         set owner_device_id = ?, owner_worker_id = ?, owner_worker_label = ?,
             provider = ?,
             model = ?, effort = ?,
             conversation_id = case
               when retained_until > ? and provider = ? and model is ?
                 and effort is ? then conversation_id else null end,
             last_activity_at = ?, retained_until = ?, updated_at = ?
         where id = ? and updated_at = ? and owner_worker_id is ?
           and exists (
             select 1 from briar_channel_agent_reply_jobs job
             where job.id = ? and job.session_id =
                   briar_channel_reply_sessions.id
               and job.claimed_device_id = ? and job.claimed_worker_id = ?
               and job.claim_token_hash = ? and job.claimed_at = ?
               and job.status = 'running'
           )
         returning *`,
      ).bind(
        input.deviceId,
        input.workerId,
        claimingWorker.label,
        candidate.agent_provider,
        candidate.runtime_model,
        candidate.runtime_effort,
        input.claimedAt,
        candidate.agent_provider,
        candidate.runtime_model,
        candidate.runtime_effort,
        input.claimedAt,
        retainedUntil,
        input.claimedAt,
        candidate.session_id,
        candidate.session_updated_at,
        candidate.session_owner_worker_id,
        candidate.id,
        input.deviceId,
        input.workerId,
        input.claimTokenHash,
        input.claimedAt,
      ),
      db.prepare(
        `insert into briar_channel_reply_session_events (
           id, session_id, reply_job_id, event_type, reason,
           from_worker_id, to_worker_id, retained_until, detail_json,
           occurred_at
         )
         select ?, session.id, job.id, 'claimed', ?, ?, ?, ?, ?, ?
         from briar_channel_reply_sessions session
         join briar_channel_agent_reply_jobs job on job.session_id = session.id
         where session.id = ? and session.owner_worker_id = ?
           and session.updated_at = ? and job.id = ?
           and job.claim_token_hash = ? and job.status = 'running'`,
      ).bind(
        crypto.randomUUID(),
        claimReason,
        candidate.session_owner_worker_id,
        input.workerId,
        retainedUntil,
        JSON.stringify({
          conversationReused: Boolean(
            !sessionExpired && !runtimeChanged &&
              candidate.session_conversation_id,
          ),
        }),
        input.claimedAt,
        candidate.session_id,
        input.workerId,
        input.claimedAt,
        candidate.id,
        input.claimTokenHash,
      ),
    ]);
    const claimed = claimResult.results[0] as ChannelReplyJobRow | undefined;
    const session = sessionResult.results[0] as ChannelReplySessionRow | undefined;
    if (claimed && session) {
      return { ...claimed, channel_reply_session: session, session_claim_reason: claimReason };
    }
  }
  return null;
}

export type ChannelReplyExecutionTargetRow = {
  id: string;
  run_number: number;
  source_key: string;
  title: string;
  status: "backlog";
};

/**
 * Freezes the bounded target allowlist before it is returned to the Agent.
 * Completion checks this durable list as well as the run's current fresh
 * backlog state, so a later rank shift can never expand the Agent's authority.
 */
export async function snapshotChannelReplyExecutionTargets(
  db: D1Database,
  input: {
    jobId: string;
    deviceId: string;
    workerId: string;
    claimTokenHash: string;
    claimedAt: string;
  },
) {
  // D1 batches run in one transaction. Keeping the snapshot mutation and its
  // projection in the same batch guarantees that every stored ID is either
  // disclosed in this response or the whole operation rolls back.
  const [snapshot, projection] = await db.batch([
    db.prepare(
      `update briar_channel_agent_reply_jobs as job
       set execution_target_ids_json = coalesce((
         select json_group_array(target.id)
         from (
           select run.id
           from briar_hunt_runs run
           where run.project_id = job.project_id
             and run.status = 'backlog' and run.stage = 'queued'
             and run.workflow_stage is null
             and run.worker_id is null and run.requested_worker_id is null
             and run.claim_token_hash is null and run.claimed_by is null
             and run.claimed_at is null and run.lease_expires_at is null
             and run.last_execution_id is null
             and run.dispatch_mode is null
             and run.dispatch_request_id is null
             and run.dispatched_at is null
             and run.requested_by_user_id is null
             and run.completed_at is null and run.paused_at is null
             and run.resume_requested_at is null
           order by run.run_number desc
           limit 100
         ) target
       ), '[]')
       where job.id = ? and job.project_id is not null
         and job.claimed_device_id = ? and job.claimed_worker_id = ?
         and job.claim_token_hash = ? and job.status = 'running'
         and job.claimed_at = ? and job.lease_expires_at > ?
       returning execution_target_ids_json`,
    ).bind(
      input.jobId,
      input.deviceId,
      input.workerId,
      input.claimTokenHash,
      input.claimedAt,
      input.claimedAt,
    ),
    db.prepare(
      `select run.id, run.run_number, run.source_key, run.title, run.status
       from briar_channel_agent_reply_jobs job
       join json_each(job.execution_target_ids_json) target
       join briar_hunt_runs run
         on run.id = target.value and run.project_id = job.project_id
       where job.id = ? and job.claimed_device_id = ?
         and job.claimed_worker_id = ? and job.claim_token_hash = ?
         and job.status = 'running' and job.claimed_at = ?
         and job.lease_expires_at > ?
         and run.status = 'backlog' and run.stage = 'queued'
         and run.workflow_stage is null
         and run.worker_id is null and run.requested_worker_id is null
         and run.claim_token_hash is null and run.claimed_by is null
         and run.claimed_at is null and run.lease_expires_at is null
         and run.last_execution_id is null
         and run.dispatch_mode is null and run.dispatch_request_id is null
         and run.dispatched_at is null and run.requested_by_user_id is null
         and run.completed_at is null and run.paused_at is null
         and run.resume_requested_at is null
       order by run.run_number desc`,
    ).bind(
      input.jobId,
      input.deviceId,
      input.workerId,
      input.claimTokenHash,
      input.claimedAt,
      input.claimedAt,
    ),
  ]);
  if ((snapshot?.results.length ?? 0) !== 1) return null;
  return (projection?.results ?? []) as ChannelReplyExecutionTargetRow[];
}

/**
 * Revalidates the complete authority chain for one Organization Agent context
 * page. A valid token alone is insufficient: the claim, Worker binding,
 * device, organization scope, Agent scope, and live lease must still agree.
 */
export async function getActiveOrganizationChannelReplyContextClaim(
  db: D1Database,
  input: {
    organizationId: string;
    jobId: string;
    deviceId: string;
    workerId: string;
    claimTokenHash: string;
    observedAt: string;
  },
) {
  return db.prepare(
    `select job.*
     from briar_channel_agent_reply_jobs job
     join briar_project_agents agent on agent.id = job.agent_id
     join briar_execution_workers binding
       on binding.id = job.claimed_worker_id
      and binding.device_id = job.claimed_device_id
     join briar_execution_worker_devices device
       on device.id = binding.device_id
     join briar_projects binding_project
       on binding_project.id = binding.project_id
     where job.id = ? and job.organization_id = ?
       and job.project_id is null
       and agent.organization_id = job.organization_id
       and agent.project_id is null
       and exists (
         select 1 from briar_channel_agents current_roster
         where current_roster.channel_id = job.channel_id
           and current_roster.agent_id = job.agent_id
       )
       and ${liveChannelReplyRuntime("job")}
       and job.claimed_device_id = ? and job.claimed_worker_id = ?
       and job.claim_token_hash = ? and job.status = 'running'
       and job.lease_expires_at > ?
       and binding.state <> 'disabled'
       and json_valid(binding.capabilities_json)
       and json_type(
         binding.capabilities_json,
         '$.organizationAgentContext'
       ) = 'object'
       and json_type(
         binding.capabilities_json,
         '$.organizationAgentContext.protocol'
       ) = 'integer'
       and json_extract(
         binding.capabilities_json,
         '$.organizationAgentContext.protocol'
       ) = 1
       and device.organization_id = job.organization_id
       and device.state <> 'disabled'
       and binding_project.organization_id = job.organization_id`,
  ).bind(
    input.jobId,
    input.organizationId,
    input.deviceId,
    input.workerId,
    input.claimTokenHash,
    input.observedAt,
  ).first<ChannelReplyJobRow>();
}

export async function getClaimedChannelReply(
  db: D1Database,
  input: {
    jobId: string;
    deviceId: string;
    workerId: string;
    claimTokenHash: string;
    observedAt: string;
  },
) {
  const claimed = await db
    .prepare(
      `select job.* from briar_channel_agent_reply_jobs job
       where job.id = ? and job.claimed_device_id = ?
         and job.claimed_worker_id = ?
         and job.claim_token_hash = ? and job.status = 'running'
         and job.lease_expires_at > ?
         and exists (
           select 1 from briar_channel_agents current_roster
           where current_roster.channel_id = job.channel_id
             and current_roster.agent_id = job.agent_id
         )
         and ${liveChannelReplyRuntime("job")}
         and exists (
           select 1 from briar_execution_workers binding
           where binding.id = job.claimed_worker_id
             and binding.device_id = job.claimed_device_id
             and binding.state <> 'disabled'
             and (job.project_id is null or binding.project_id = job.project_id)
         )`,
    )
    .bind(
      input.jobId,
      input.deviceId,
      input.workerId,
      input.claimTokenHash,
      input.observedAt,
    )
    .first<ChannelReplyJobRow>();
  // A null worker binding is never adoptable. It can mean either a pre-scope
  // deployment claim or a binding removed through ON DELETE SET NULL; both
  // must expire and requeue instead of transferring a live claim token.
  return claimed;
}

export async function renewChannelReplyLease(
  db: D1Database,
  input: {
    jobId: string;
    deviceId: string;
    workerId: string;
    claimTokenHash: string;
    observedAt: string;
    leaseExpiresAt: string;
  },
) {
  const claimed = await getClaimedChannelReply(db, input);
  if (!claimed) return null;
  const retainedUntil = channelReplySessionRetentionUntil(input.observedAt);
  const [renewed] = await db.batch([
    db.prepare(
      `update briar_channel_agent_reply_jobs
       set lease_expires_at = ?
       where id = ? and claimed_device_id = ? and claimed_worker_id = ?
         and claim_token_hash = ? and status = 'running'
         and lease_expires_at > ?
         and exists (
           select 1 from briar_channel_agents current_roster
           where current_roster.channel_id = briar_channel_agent_reply_jobs.channel_id
             and current_roster.agent_id = briar_channel_agent_reply_jobs.agent_id
         )
         and ${liveChannelReplyRuntime("briar_channel_agent_reply_jobs")}
         and exists (
           select 1 from briar_execution_workers binding
           where binding.id = briar_channel_agent_reply_jobs.claimed_worker_id
             and binding.device_id = briar_channel_agent_reply_jobs.claimed_device_id
             and binding.state <> 'disabled'
             and (
               briar_channel_agent_reply_jobs.project_id is null
               or binding.project_id = briar_channel_agent_reply_jobs.project_id
             )
         )
       returning *`,
    ).bind(
      input.leaseExpiresAt,
      input.jobId,
      input.deviceId,
      input.workerId,
      input.claimTokenHash,
      input.observedAt,
    ),
    db.prepare(
      `update briar_channel_reply_sessions
       set last_activity_at = ?, retained_until = ?, updated_at = ?
       where id = ? and owner_device_id = ? and owner_worker_id = ?
         and exists (
           select 1 from briar_channel_agent_reply_jobs job
           where job.id = ? and job.session_id =
                 briar_channel_reply_sessions.id
             and job.claim_token_hash = ? and job.status = 'running'
             and job.lease_expires_at = ?
         )`,
    ).bind(
      input.observedAt,
      retainedUntil,
      input.observedAt,
      claimed.session_id,
      input.deviceId,
      input.workerId,
      input.jobId,
      input.claimTokenHash,
      input.leaseExpiresAt,
    ),
    db.prepare(
      `insert into briar_channel_reply_session_events (
         id, session_id, reply_job_id, event_type, reason,
         from_worker_id, to_worker_id, retained_until, detail_json,
         occurred_at
       )
       select ?, session.id, job.id, 'ttl_renewed', 'lease_renewed',
              ?, ?, ?, '{}', ?
       from briar_channel_reply_sessions session
       join briar_channel_agent_reply_jobs job on job.session_id = session.id
       where job.id = ? and job.claim_token_hash = ?
         and job.status = 'running' and job.lease_expires_at = ?
         and session.updated_at = ?`,
    ).bind(
      crypto.randomUUID(),
      input.workerId,
      input.workerId,
      retainedUntil,
      input.observedAt,
      input.jobId,
      input.claimTokenHash,
      input.leaseExpiresAt,
      input.observedAt,
    ),
  ]);
  return (renewed.results[0] as ChannelReplyJobRow | undefined) ?? null;
}

export async function failChannelReply(
  db: D1Database,
  input: {
    jobId: string;
    deviceId: string;
    workerId: string;
    claimTokenHash: string;
    error: string;
    updatedAt: string;
  },
) {
  const claimed = await getClaimedChannelReply(db, {
    ...input,
    observedAt: input.updatedAt,
  });
  if (!claimed) return null;
  const retainedUntil = channelReplySessionRetentionUntil(input.updatedAt);
  const [failed] = await db.batch([
    db.prepare(
      `update briar_channel_agent_reply_jobs
       set status = case when attempts >= ? then 'failed' else 'queued' end,
           error = ?, claimed_device_id = null, claimed_worker_id = null,
           preferred_device_id = null,
           claim_token_hash = null, lease_expires_at = null,
           updated_at = ?
       where id = ? and claimed_device_id = ? and claimed_worker_id = ?
         and claim_token_hash = ? and status = 'running'
         and lease_expires_at > ?
         and exists (
           select 1 from briar_channel_agents current_roster
           where current_roster.channel_id = briar_channel_agent_reply_jobs.channel_id
             and current_roster.agent_id = briar_channel_agent_reply_jobs.agent_id
         )
       returning *`,
    ).bind(
      MAX_REPLY_ATTEMPTS,
      input.error.slice(0, 4000),
      input.updatedAt,
      input.jobId,
      input.deviceId,
      input.workerId,
      input.claimTokenHash,
      input.updatedAt,
    ),
    db.prepare(
      `update briar_channel_reply_sessions
       set last_activity_at = ?, retained_until = ?, updated_at = ?
       where id = ? and owner_device_id = ? and owner_worker_id = ?
         and exists (
           select 1 from briar_channel_agent_reply_jobs job
           where job.id = ? and job.session_id =
                 briar_channel_reply_sessions.id
             and job.updated_at = ? and job.status in ('queued', 'failed')
         )`,
    ).bind(
      input.updatedAt,
      retainedUntil,
      input.updatedAt,
      claimed.session_id,
      input.deviceId,
      input.workerId,
      input.jobId,
      input.updatedAt,
    ),
    db.prepare(
      `insert into briar_channel_reply_session_events (
         id, session_id, reply_job_id, event_type, reason,
         from_worker_id, to_worker_id, retained_until, detail_json,
         occurred_at
       )
       select ?, session.id, job.id, 'ttl_renewed', 'reply_failed',
              ?, ?, ?, '{}', ?
       from briar_channel_reply_sessions session
       join briar_channel_agent_reply_jobs job on job.session_id = session.id
       where job.id = ? and job.updated_at = ?
         and job.status in ('queued', 'failed') and session.updated_at = ?`,
    ).bind(
      crypto.randomUUID(),
      input.workerId,
      input.workerId,
      retainedUntil,
      input.updatedAt,
      input.jobId,
      input.updatedAt,
      input.updatedAt,
    ),
  ]);
  return (failed.results[0] as ChannelReplyJobRow | undefined) ?? null;
}

export type ChannelReplyCompletionInput = {
  jobId: string;
  deviceId: string;
  workerId: string;
  claimTokenHash: string;
  body: string;
  document: { title: string; markdown: string; projectId: string | null } | null;
  issueProposal: {
    projectId: string | null;
    issue: Record<string, unknown>;
    executeAfterCreate: boolean;
  } | null;
  issueBatchProposal?: {
    projectId: string | null;
    batch: ChannelIssueBatchProposalPayload["batch"];
  } | null;
  executionProposal: {
    projectId: string;
    runId: string;
  } | null;
  skillExecutionProposal?: boolean;
  delegation?: {
    projectId: string;
    agentId: string;
    skillId: string | null;
    provider: AgentProvider;
    request: string;
  } | null;
  agentName: string;
  agentProvider: AgentProvider;
  completedAt: string;
  conversationId?: string | null;
  attachments?: ChannelMessageAttachmentInput[];
};

/**
 * The reply message, optional artifact proposal, and optional delegated child
 * land together so a partially applied completion can never be observed.
 */
export async function completeChannelReply(
  db: D1Database,
  job: ChannelReplyJobRow,
  input: ChannelReplyCompletionInput,
) {
  const channel = await getChannelById(
    db,
    job.organization_id,
    job.channel_id,
  );
  if (!channel) return null;
  const replyParentMessageId = agentReplyDisplayParentMessageId(
    channel.kind,
    {
      id: job.trigger_message_id,
      parentMessageId: job.parent_message_id,
    },
  );
  const executionApprovalsAvailable =
    await channelExecutionProposalTablesAvailable(db);
  const skillExecutionApprovalsAvailable =
    await channelSkillExecutionProposalTablesAvailable(db);
  const issueBatchProposalsAvailable =
    await channelIssueBatchProposalTablesAvailable(db);
  if (
    !executionApprovalsAvailable &&
    (input.executionProposal || input.issueProposal?.executeAfterCreate)
  ) {
    throw new Error("issue execution approval schema is unavailable");
  }
  if (input.skillExecutionProposal && !skillExecutionApprovalsAvailable) {
    throw new Error("Agent Skill execution approval schema is unavailable");
  }
  if (input.issueBatchProposal && !issueBatchProposalsAvailable) {
    throw new Error("channel issue batch approval schema is unavailable");
  }
  const delegation = input.delegation ?? null;
  if (
    job.project_id !== null &&
    [
      input.document?.projectId,
      input.issueProposal?.projectId,
      input.issueBatchProposal?.projectId,
      input.executionProposal?.projectId,
    ].some(
      (projectId) => projectId !== undefined && projectId !== job.project_id,
    )
  ) {
    throw new Error("Project Agent output must target its claimed project");
  }
  if (delegation && (job.project_id !== null || job.delegated_by_reply_job_id)) {
    throw new Error("Only a top-level Organization Agent reply can delegate");
  }
  if (delegation && (
    input.document || input.issueProposal || input.issueBatchProposal ||
    input.executionProposal || input.skillExecutionProposal
  )) {
    throw new Error("A delegated reply cannot also create an artifact proposal");
  }
  if (input.executionProposal && job.project_id === null) {
    throw new Error("Only a Project Agent can propose issue execution");
  }
  if (input.skillExecutionProposal && job.project_id === null) {
    throw new Error("Only a Project Agent can propose Agent Skill execution");
  }
  if (
    input.skillExecutionProposal &&
    (!job.skill_id || job.selected_skill_id_snapshot !== job.skill_id)
  ) {
    throw new Error("Agent Skill execution requires an exact selected Skill");
  }
  if (input.issueProposal?.executeAfterCreate && job.project_id === null) {
    throw new Error(
      "An Organization Agent must delegate create-and-execute requests",
    );
  }
  if (input.issueProposal && input.executionProposal) {
    throw new Error("Use executeAfterCreate for a create-and-execute request");
  }
  if (
    input.issueBatchProposal &&
    (input.issueProposal || input.executionProposal ||
      input.skillExecutionProposal || delegation)
  ) {
    throw new Error(
      "An issue batch cannot be combined with another proposal",
    );
  }
  if (
    input.skillExecutionProposal &&
    (input.document || input.issueProposal || input.issueBatchProposal ||
      input.executionProposal || delegation)
  ) {
    throw new Error(
      "Agent Skill execution cannot be combined with another proposal",
    );
  }
  const delegationGuardBindings = delegation
    ? [
        1,
        delegation.agentId,
        delegation.projectId,
        delegation.skillId,
        delegation.provider,
        delegation.skillId,
        delegation.provider,
      ]
    : [0, null, null, null, null, null, null];
  const executionGuardSql = executionApprovalsAvailable
    ? `and (
         ? = 0
         or (
           briar_channel_agent_reply_jobs.project_id = ?
           and exists (
             select 1
             from json_each(
               briar_channel_agent_reply_jobs.execution_target_ids_json
             ) allowed
             join briar_hunt_runs target on target.id = allowed.value
             where target.id = ?
               and target.project_id =
                 briar_channel_agent_reply_jobs.project_id
               and target.status = 'backlog' and target.stage = 'queued'
               and target.workflow_stage is null
               and target.worker_id is null
               and target.requested_worker_id is null
               and target.claim_token_hash is null
               and target.claimed_by is null and target.claimed_at is null
               and target.lease_expires_at is null
               and target.last_execution_id is null
               and target.dispatch_mode is null
               and target.dispatch_request_id is null
               and target.dispatched_at is null
               and target.requested_by_user_id is null
               and target.completed_at is null and target.paused_at is null
               and target.resume_requested_at is null
           )
         )
       )`
    : "and ? = 0";
  const executionGuardBindings = executionApprovalsAvailable
    ? input.executionProposal
      ? [
          1,
          input.executionProposal.projectId,
          input.executionProposal.runId,
        ]
      : [0, null, null]
    : [0];
  const skillExecutionGuardSql = skillExecutionApprovalsAvailable
    ? `and (
         ? = 0
         or exists (
           select 1
           from briar_project_agents snapshot_agent
           join briar_agent_skills snapshot_skill
             on snapshot_skill.agent_id = snapshot_agent.id
           join briar_channel_messages snapshot_trigger
             on snapshot_trigger.id =
               briar_channel_agent_reply_jobs.trigger_message_id
            and snapshot_trigger.channel_id =
               briar_channel_agent_reply_jobs.channel_id
           join briar_channel_agents snapshot_roster
             on snapshot_roster.agent_id = snapshot_agent.id
            and snapshot_roster.channel_id =
              briar_channel_agent_reply_jobs.channel_id
           where snapshot_agent.id = briar_channel_agent_reply_jobs.agent_id
             and briar_channel_agent_reply_jobs
               .approved_skill_execution_proposal_id is null
             and snapshot_agent.organization_id =
               briar_channel_agent_reply_jobs.organization_id
             and snapshot_agent.project_id =
               briar_channel_agent_reply_jobs.project_id
             and snapshot_agent.name =
               briar_channel_agent_reply_jobs.selected_agent_name_snapshot
             and snapshot_agent.responsibility =
               briar_channel_agent_reply_jobs
                 .selected_agent_responsibility_snapshot
             and snapshot_skill.id =
               briar_channel_agent_reply_jobs.selected_skill_id_snapshot
             and snapshot_skill.id = briar_channel_agent_reply_jobs.skill_id
             and snapshot_skill.name =
               briar_channel_agent_reply_jobs.selected_skill_name_snapshot
             and snapshot_skill.body =
               briar_channel_agent_reply_jobs
                 .selected_skill_instructions_snapshot
             and snapshot_skill.kind =
               briar_channel_agent_reply_jobs.selected_skill_kind_snapshot
             and (
               snapshot_skill.execution_mode = 'conversation'
               or (
                 snapshot_skill.provider =
                   briar_channel_agent_reply_jobs.selected_skill_provider_snapshot
                 and snapshot_skill.model is
                   briar_channel_agent_reply_jobs.selected_skill_model_snapshot
                 and snapshot_skill.effort is
                   briar_channel_agent_reply_jobs.selected_skill_effort_snapshot
               )
             )
             and (
               snapshot_skill.execution_mode = 'task'
               or snapshot_skill.approval_policy = 'explicit'
             )
             and (
               (briar_channel_agent_reply_jobs.delegated_by_reply_job_id is null
                 and briar_channel_agent_reply_jobs
                   .skill_execution_request_snapshot = snapshot_trigger.body)
               or
               (briar_channel_agent_reply_jobs
                   .delegated_by_reply_job_id is not null
                 and briar_channel_agent_reply_jobs
                   .skill_execution_request_snapshot =
                     briar_channel_agent_reply_jobs.delegation_request)
             )
         )
       )`
    : "and ? = 0";
  const skillExecutionGuardBindings = [
    input.skillExecutionProposal ? 1 : 0,
  ];
  const retainedUntil = channelReplySessionRetentionUntil(input.completedAt);
  const skillExecutionProposalId = input.skillExecutionProposal
    ? crypto.randomUUID()
    : null;
  const consentTaskSessionId = input.skillExecutionProposal
    ? crypto.randomUUID()
    : null;
  const statements = [
    db
      .prepare(
        `update briar_channel_agent_reply_jobs
         set status = 'completed', completed_at = ?, updated_at = ?
         where id = ? and claimed_device_id = ? and claimed_worker_id = ?
           and claim_token_hash = ? and status = 'running'
           and lease_expires_at > ?
           and exists (
             select 1 from briar_channel_agents current_roster
             where current_roster.channel_id = briar_channel_agent_reply_jobs.channel_id
               and current_roster.agent_id = briar_channel_agent_reply_jobs.agent_id
           )
           and ${liveChannelReplyRuntime("briar_channel_agent_reply_jobs")}
           and exists (
             select 1 from briar_execution_workers binding
             where binding.id = briar_channel_agent_reply_jobs.claimed_worker_id
               and binding.device_id = briar_channel_agent_reply_jobs.claimed_device_id
               and binding.state <> 'disabled'
               and (
                 briar_channel_agent_reply_jobs.project_id is null
                 or binding.project_id = briar_channel_agent_reply_jobs.project_id
               )
           )
           and (
             ? = 0
             or (
               briar_channel_agent_reply_jobs.project_id is null
               and briar_channel_agent_reply_jobs.delegated_by_reply_job_id is null
               and exists (
                 select 1 from briar_project_agents source_agent
                 where source_agent.id = briar_channel_agent_reply_jobs.agent_id
                   and source_agent.organization_id = briar_channel_agent_reply_jobs.organization_id
                   and source_agent.project_id is null
               )
               and exists (
                 select 1
                 from briar_project_agents target
                 join briar_channel_agents roster
                   on roster.agent_id = target.id
                  and roster.channel_id = briar_channel_agent_reply_jobs.channel_id
                 where target.id = ?
                   and target.organization_id = briar_channel_agent_reply_jobs.organization_id
                   and target.project_id = ?
                   and (
                     (? is null and target.provider = ?)
                     or exists (
                       select 1 from briar_agent_skills target_skill
                       where target_skill.id = ?
                         and target_skill.agent_id = target.id
                         and (
                           target_skill.execution_mode = 'conversation'
                           or target_skill.provider = ?
                         )
                     )
                   )
               )
             )
           )
           ${executionGuardSql}
           ${skillExecutionGuardSql}
         returning *`,
      )
      .bind(
        input.completedAt,
        input.completedAt,
        input.jobId,
        input.deviceId,
        input.workerId,
        input.claimTokenHash,
        input.completedAt,
        ...delegationGuardBindings,
        ...executionGuardBindings,
        ...skillExecutionGuardBindings,
      ),
    db
      .prepare(
        `insert into briar_channel_messages (
           id, channel_id, parent_message_id, author_user_id, author_agent_id,
           author_agent_name, author_agent_provider, body, created_at, updated_at
         )
         select ?, ?, ?, null, ?, ?, ?, ?, ?, ?
         from briar_channel_agent_reply_jobs claim
         where claim.id = ? and claim.claimed_device_id = ?
           and claim.claimed_worker_id = ? and claim.claim_token_hash = ?
           and claim.status = 'completed' and claim.completed_at = ?`,
      )
      .bind(
        job.reply_message_id,
        job.channel_id,
        replyParentMessageId,
        job.agent_id,
        input.agentName,
        input.agentProvider,
        input.body,
        input.completedAt,
        input.completedAt,
        input.jobId,
        input.deviceId,
        input.workerId,
        input.claimTokenHash,
        input.completedAt,
      ),
  ];
  for (const attachment of input.attachments ?? []) {
    statements.push(
      db
        .prepare(
          `insert into briar_channel_message_attachments (
             id, organization_id, channel_id, message_id, object_key,
             filename, content_type, byte_size, created_at
           )
           select ?, ?, ?, ?, ?, ?, ?, ?, ?
           from briar_channel_agent_reply_jobs claim
           where claim.id = ? and claim.claimed_device_id = ?
             and claim.claimed_worker_id = ? and claim.claim_token_hash = ?
             and claim.status = 'completed' and claim.completed_at = ?
             and exists (
               select 1 from briar_channel_messages
               where id = ? and channel_id = ?
             )`,
        )
        .bind(
          attachment.id,
          attachment.organization_id,
          job.channel_id,
          job.reply_message_id,
          attachment.object_key,
          attachment.filename,
          attachment.content_type,
          attachment.byte_size,
          input.completedAt,
          input.jobId,
          input.deviceId,
          input.workerId,
          input.claimTokenHash,
          input.completedAt,
          job.reply_message_id,
          job.channel_id,
        ),
    );
  }
  if (input.document) {
    statements.push(
      db
        .prepare(
          `insert into briar_channel_message_documents (
             message_id, channel_id, project_id, title, markdown,
             created_at, updated_at
           )
           select ?, ?, ?, ?, ?, ?, ?
           from briar_channel_agent_reply_jobs claim
           where claim.id = ? and claim.claimed_device_id = ?
             and claim.claimed_worker_id = ? and claim.claim_token_hash = ?
             and claim.status = 'completed' and claim.completed_at = ?`,
        )
        .bind(
          job.reply_message_id,
          job.channel_id,
          input.document.projectId,
          input.document.title,
          input.document.markdown,
          input.completedAt,
          input.completedAt,
          input.jobId,
          input.deviceId,
          input.workerId,
          input.claimTokenHash,
          input.completedAt,
        ),
    );
  }
  if (input.issueProposal) {
    const executionProposalId = input.issueProposal.executeAfterCreate
      ? crypto.randomUUID()
      : null;
    statements.push(
      db
        .prepare(
          executionApprovalsAvailable
            ? `insert into briar_channel_action_proposals (
             id, channel_id, project_id, trigger_message_id, reply_message_id,
             action_type, payload_json, execute_after_create,
             execution_proposal_id, created_at, updated_at
           )
           select ?, ?, ?, ?, ?, 'request_issue_create', ?, ?, ?, ?, ?
           from briar_channel_agent_reply_jobs claim
           where claim.id = ? and claim.claimed_device_id = ?
             and claim.claimed_worker_id = ? and claim.claim_token_hash = ?
             and claim.status = 'completed' and claim.completed_at = ?
           on conflict (channel_id, trigger_message_id) do nothing`
            : `insert into briar_channel_action_proposals (
             id, channel_id, project_id, trigger_message_id, reply_message_id,
             action_type, payload_json, created_at, updated_at
           )
           select ?, ?, ?, ?, ?, 'request_issue_create', ?, ?, ?
           from briar_channel_agent_reply_jobs claim
           where claim.id = ? and claim.claimed_device_id = ?
             and claim.claimed_worker_id = ? and claim.claim_token_hash = ?
             and claim.status = 'completed' and claim.completed_at = ?
           on conflict (channel_id, trigger_message_id) do nothing`,
        )
        .bind(...(
          executionApprovalsAvailable
            ? [
                crypto.randomUUID(),
                job.channel_id,
                input.issueProposal.projectId,
                job.trigger_message_id,
                job.reply_message_id,
                JSON.stringify({ issue: input.issueProposal.issue }),
                input.issueProposal.executeAfterCreate ? 1 : 0,
                executionProposalId,
                input.completedAt,
                input.completedAt,
                input.jobId,
                input.deviceId,
                input.workerId,
                input.claimTokenHash,
                input.completedAt,
              ]
            : [
                crypto.randomUUID(),
                job.channel_id,
                input.issueProposal.projectId,
                job.trigger_message_id,
                job.reply_message_id,
                JSON.stringify({ issue: input.issueProposal.issue }),
                input.completedAt,
                input.completedAt,
                input.jobId,
                input.deviceId,
                input.workerId,
                input.claimTokenHash,
                input.completedAt,
              ]
        )),
    );
  }
  if (input.issueBatchProposal) {
    statements.push(
      db
        .prepare(
          `insert into briar_channel_action_proposals (
             id, channel_id, project_id, trigger_message_id, reply_message_id,
             action_type, payload_json, execute_after_create,
             execution_proposal_id, created_at, updated_at
           )
           select ?, ?, ?, ?, ?, 'request_issue_create', ?, 0, null, ?, ?
           from briar_channel_agent_reply_jobs claim
           where claim.id = ? and claim.claimed_device_id = ?
             and claim.claimed_worker_id = ? and claim.claim_token_hash = ?
             and claim.status = 'completed' and claim.completed_at = ?
           on conflict (channel_id, trigger_message_id) do nothing`,
        )
        .bind(
          crypto.randomUUID(),
          job.channel_id,
          input.issueBatchProposal.projectId,
          job.trigger_message_id,
          job.reply_message_id,
          JSON.stringify({ batch: input.issueBatchProposal.batch }),
          input.completedAt,
          input.completedAt,
          input.jobId,
          input.deviceId,
          input.workerId,
          input.claimTokenHash,
          input.completedAt,
        ),
    );
  }
  if (input.executionProposal) {
    statements.push(
      db
        .prepare(
          `insert into briar_issue_execution_proposals (
             id, organization_id, project_id, source_kind, channel_id,
             conversation_run_id, trigger_message_id, reply_message_id,
             target_run_id, target_title, target_run_updated_at,
             proposed_by_agent_id, delegated_by_agent_id,
             delegated_by_agent_name, created_at, updated_at
           )
           select ?, job.organization_id, job.project_id, 'channel',
                  job.channel_id, null, job.trigger_message_id,
                  job.reply_message_id, run.id, run.title, run.updated_at,
                  job.agent_id, parent.agent_id, parent_agent.name, ?, ?
           from briar_channel_agent_reply_jobs job
           join briar_hunt_runs run
             on run.id = ? and run.project_id = job.project_id
           join briar_project_agents agent
             on agent.id = job.agent_id and agent.project_id = job.project_id
            and agent.organization_id = job.organization_id
           join briar_channel_agents roster
             on roster.channel_id = job.channel_id and roster.agent_id = agent.id
           left join briar_channel_agent_reply_jobs parent
             on parent.id = job.delegated_by_reply_job_id
           left join briar_project_agents parent_agent
             on parent_agent.id = parent.agent_id
            and parent_agent.organization_id = job.organization_id
            and parent_agent.project_id is null
           where job.id = ? and job.claimed_device_id = ?
             and job.claimed_worker_id = ? and job.claim_token_hash = ?
             and job.status = 'completed' and job.completed_at = ?
             and job.project_id = ?
             and run.status = 'backlog' and run.stage = 'queued'
             and run.workflow_stage is null
             and run.worker_id is null and run.requested_worker_id is null
             and run.claim_token_hash is null and run.claimed_by is null
             and run.claimed_at is null and run.lease_expires_at is null
             and run.last_execution_id is null
             and run.dispatch_mode is null and run.dispatch_request_id is null
             and run.dispatched_at is null and run.requested_by_user_id is null
             and run.completed_at is null and run.paused_at is null
             and run.resume_requested_at is null
           on conflict (reply_message_id) do nothing`,
        )
        .bind(
          crypto.randomUUID(),
          input.completedAt,
          input.completedAt,
          input.executionProposal.runId,
          input.jobId,
          input.deviceId,
          input.workerId,
          input.claimTokenHash,
          input.completedAt,
          input.executionProposal.projectId,
        ),
    );
  }
  if (input.skillExecutionProposal) {
    statements.push(
      db
        .prepare(
          `insert into briar_agent_skill_execution_proposals (
             id, organization_id, project_id, source_kind, channel_id,
             conversation_run_id, trigger_message_id, reply_message_id,
             source_reply_job_id, delegated_by_reply_job_id,
             agent_id, agent_name, agent_responsibility,
             skill_id, skill_name, skill_instructions, skill_kind,
             provider, model, effort, execution_mode, approval_policy,
             thread_root_message_id,
             request, delegated_by_agent_id, delegated_by_agent_name,
             created_at, updated_at
           )
           select ?, job.organization_id, job.project_id, 'channel',
                  job.channel_id, null, job.trigger_message_id,
                  job.reply_message_id, job.id, job.delegated_by_reply_job_id,
                  agent.id, job.selected_agent_name_snapshot,
                  job.selected_agent_responsibility_snapshot,
                  skill.id, job.selected_skill_name_snapshot,
                  job.selected_skill_instructions_snapshot,
                  job.selected_skill_kind_snapshot,
                  job.selected_skill_provider_snapshot,
                  job.selected_skill_model_snapshot,
                  job.selected_skill_effort_snapshot,
                  skill.execution_mode, skill.approval_policy,
                  job.parent_message_id,
                  job.skill_execution_request_snapshot,
                  parent_agent.id, parent_agent.name, ?, ?
           from briar_channel_agent_reply_jobs job
           join briar_project_agents agent
             on agent.id = job.agent_id and agent.project_id = job.project_id
            and agent.organization_id = job.organization_id
           join briar_agent_skills skill
             on skill.id = job.skill_id and skill.agent_id = agent.id
            and job.selected_skill_id_snapshot = skill.id
           join briar_channel_messages trigger_message
             on trigger_message.id = job.trigger_message_id
            and trigger_message.channel_id = job.channel_id
           join briar_channel_agents roster
             on roster.channel_id = job.channel_id and roster.agent_id = agent.id
           left join briar_channel_agent_reply_jobs parent
             on parent.id = job.delegated_by_reply_job_id
           left join briar_project_agents parent_agent
             on parent_agent.id = parent.agent_id
            and parent_agent.organization_id = job.organization_id
            and parent_agent.project_id is null
           where job.id = ? and job.claimed_device_id = ?
             and job.claimed_worker_id = ? and job.claim_token_hash = ?
             and job.status = 'completed' and job.completed_at = ?
             and agent.name = job.selected_agent_name_snapshot
             and agent.responsibility =
               job.selected_agent_responsibility_snapshot
             and skill.name = job.selected_skill_name_snapshot
             and skill.body = job.selected_skill_instructions_snapshot
             and skill.kind = job.selected_skill_kind_snapshot
             and (
               skill.execution_mode = 'conversation'
               or (
                 skill.provider = job.selected_skill_provider_snapshot
                 and skill.model is job.selected_skill_model_snapshot
                 and skill.effort is job.selected_skill_effort_snapshot
               )
             )
             and job.approved_skill_execution_proposal_id is null
             and (
               skill.execution_mode = 'task'
               or skill.approval_policy = 'explicit'
             )
             and (
               (job.delegated_by_reply_job_id is null
                 and trigger_message.body = job.skill_execution_request_snapshot)
               or (job.delegated_by_reply_job_id is not null
                 and job.delegation_request =
                   job.skill_execution_request_snapshot)
             )`,
        )
        .bind(
          skillExecutionProposalId,
          input.completedAt,
          input.completedAt,
          input.jobId,
          input.deviceId,
          input.workerId,
          input.claimTokenHash,
          input.completedAt,
        ),
    );
    statements.push(
      db.prepare(
        `update briar_agent_skill_execution_proposals
         set status = 'accepted',
             requested_worker_id = (
               select job.claimed_worker_id
               from briar_channel_agent_reply_jobs job
               where job.id = source_reply_job_id
             ),
             requested_worker_label = (
               select worker.label
               from briar_channel_agent_reply_jobs job
               join briar_execution_workers worker
                 on worker.id = job.claimed_worker_id
                and worker.device_id = job.claimed_device_id
               where job.id = source_reply_job_id
             ),
             result_session_id = ?,
             accepted_by_user_id = (
               select trigger_message.author_user_id
               from briar_channel_agent_reply_jobs job
               join briar_channel_messages trigger_message
                 on trigger_message.id = job.trigger_message_id
                and trigger_message.channel_id = job.channel_id
               where job.id = source_reply_job_id
             ),
             accepted_at = ?, updated_at = ?
         where id = ? and status = 'pending' and execution_mode = 'task'
           and approval_policy = 'invoke_is_consent'
           and exists (
             select 1 from briar_channel_agent_reply_jobs job
             join briar_channel_messages trigger_message
               on trigger_message.id = job.trigger_message_id
              and trigger_message.channel_id = job.channel_id
             join briar_execution_workers worker
               on worker.id = job.claimed_worker_id
              and worker.device_id = job.claimed_device_id
             where job.id = source_reply_job_id
               and trigger_message.author_user_id is not null
           )`,
      ).bind(
        consentTaskSessionId,
        input.completedAt,
        input.completedAt,
        skillExecutionProposalId,
      ),
    );
  }
  if (delegation) {
    const delegatedSessionId = crypto.randomUUID();
    const delegatedJobId = crypto.randomUUID();
    const delegatedSkillSnapshotColumns = skillExecutionApprovalsAvailable
      ? `,
         selected_agent_name_snapshot,
         selected_agent_responsibility_snapshot,
         selected_skill_name_snapshot, selected_skill_instructions_snapshot,
         selected_skill_kind_snapshot,
         selected_skill_provider_snapshot, selected_skill_model_snapshot,
         selected_skill_effort_snapshot, skill_execution_request_snapshot`
      : "";
    const delegatedSkillSnapshotValues = skillExecutionApprovalsAvailable
      ? `,
         case when target_skill.id is null then null else target.name end,
         case when target_skill.id is null then null
           else target.responsibility end,
         target_skill.name, target_skill.body, target_skill.kind,
         target_skill.provider,
         target_skill.model, target_skill.effort,
         case when target_skill.id is null then null else ? end`
      : "";
    statements.push(
      db.prepare(
        `insert into briar_channel_reply_sessions (
           id, organization_id, channel_id, thread_root_message_id,
           project_id, agent_id, provider, model, effort,
           owner_device_id, owner_worker_id, owner_worker_label,
           last_activity_at, retained_until, created_at, updated_at
         )
         select ?, parent.organization_id, parent.channel_id,
                parent.parent_message_id, target.project_id, target.id,
                case when target_skill.id is null
                  or target_skill.execution_mode = 'task'
                  then target.provider
                  when existing_session.retained_until > ?
                  then existing_session.provider
                  else target.provider end,
                case when target_skill.id is null
                  or target_skill.execution_mode = 'task'
                  then target.model
                  when existing_session.retained_until > ?
                  then existing_session.model
                  else target.model end,
                case when target_skill.id is null
                  or target_skill.execution_mode = 'task'
                  then target.effort
                  when existing_session.retained_until > ?
                  then existing_session.effort
                  else target.effort end,
                designated_worker.device_id, designated_worker.id,
                target.designated_worker_label,
                ?, ?, ?, ?
         from briar_channel_agent_reply_jobs parent
         join briar_project_agents target on target.id = ?
         left join briar_agent_skills target_skill
           on target_skill.id = ? and target_skill.agent_id = target.id
         left join briar_channel_reply_sessions existing_session
           on existing_session.channel_id = parent.channel_id
          and existing_session.thread_root_message_id = parent.parent_message_id
          and existing_session.agent_id = target.id
         left join briar_execution_workers designated_worker
           on designated_worker.id = target.designated_worker_id
          and designated_worker.project_id = target.project_id
         join briar_channel_agents roster
           on roster.agent_id = target.id and roster.channel_id = parent.channel_id
         where parent.id = ? and parent.claimed_device_id = ?
           and parent.claimed_worker_id = ? and parent.claim_token_hash = ?
           and parent.status = 'completed' and parent.completed_at = ?
           and parent.project_id is null
           and parent.delegated_by_reply_job_id is null
           and target.organization_id = parent.organization_id
           and target.project_id = ?
           and (
             (? is null and target.provider = ?)
             or (
               target_skill.id = ?
               and (
                 target_skill.execution_mode = 'conversation'
                 or target_skill.provider = ?
               )
             )
           )
         on conflict (channel_id, thread_root_message_id, agent_id)
         do update set
           project_id = excluded.project_id,
           conversation_id = case
             when briar_channel_reply_sessions.retained_until <=
                    excluded.last_activity_at
               or briar_channel_reply_sessions.provider <> excluded.provider
               or briar_channel_reply_sessions.model is not excluded.model
               or briar_channel_reply_sessions.effort is not excluded.effort
             then null else briar_channel_reply_sessions.conversation_id end,
           owner_device_id = case
             when briar_channel_reply_sessions.retained_until <=
                    excluded.last_activity_at
             then excluded.owner_device_id
             else briar_channel_reply_sessions.owner_device_id end,
           owner_worker_id = case
             when briar_channel_reply_sessions.retained_until <=
                    excluded.last_activity_at
             then excluded.owner_worker_id
             else briar_channel_reply_sessions.owner_worker_id end,
           owner_worker_label = case
             when briar_channel_reply_sessions.retained_until <=
                    excluded.last_activity_at
             then excluded.owner_worker_label
             else briar_channel_reply_sessions.owner_worker_label end,
           provider = excluded.provider, model = excluded.model,
           effort = excluded.effort,
           last_activity_at = excluded.last_activity_at,
           retained_until = excluded.retained_until,
           updated_at = excluded.updated_at`,
      ).bind(
        delegatedSessionId,
        input.completedAt,
        input.completedAt,
        input.completedAt,
        input.completedAt,
        retainedUntil,
        input.completedAt,
        input.completedAt,
        delegation.agentId,
        delegation.skillId,
        input.jobId,
        input.deviceId,
        input.workerId,
        input.claimTokenHash,
        input.completedAt,
        delegation.projectId,
        delegation.skillId,
        delegation.provider,
        delegation.skillId,
        delegation.provider,
      ),
      db
        .prepare(
          `insert into briar_channel_agent_reply_jobs (
             id, organization_id, channel_id, project_id, agent_id, skill_id,
             selected_skill_id_snapshot${delegatedSkillSnapshotColumns},
             session_id, trigger_message_id, parent_message_id, reply_message_id,
             agent_provider, delegated_by_reply_job_id, delegation_request,
             created_at, updated_at
           )
           select ?, parent.organization_id, parent.channel_id,
                  target.project_id, target.id, ?, ?${delegatedSkillSnapshotValues},
                  session.id, parent.trigger_message_id,
                  parent.parent_message_id, ?,
                  case when target_skill.id is null
                    or target_skill.execution_mode = 'conversation'
                    then session.provider else target_skill.provider end,
                  parent.id, ?, ?, ?
           from briar_channel_agent_reply_jobs parent
           join briar_project_agents target on target.id = ?
           left join briar_agent_skills target_skill
             on target_skill.id = ? and target_skill.agent_id = target.id
           join briar_channel_agents roster
             on roster.agent_id = target.id and roster.channel_id = parent.channel_id
           join briar_channel_reply_sessions session
             on session.channel_id = parent.channel_id
            and session.thread_root_message_id = parent.parent_message_id
            and session.agent_id = target.id
           where parent.id = ? and parent.claimed_device_id = ?
             and parent.claimed_worker_id = ? and parent.claim_token_hash = ?
             and parent.status = 'completed' and parent.completed_at = ?
             and parent.project_id is null
             and parent.delegated_by_reply_job_id is null
             and exists (
               select 1 from briar_channel_agents source_roster
               where source_roster.channel_id = parent.channel_id
                 and source_roster.agent_id = parent.agent_id
             )
             and exists (
               select 1 from briar_project_agents source_agent
               where source_agent.id = parent.agent_id
                 and source_agent.organization_id = parent.organization_id
                 and source_agent.project_id is null
             )
             and target.organization_id = parent.organization_id
             and target.project_id = ?
             and (
               (? is null and target.provider = ?)
               or (
                 target_skill.id = ?
                 and (
                   target_skill.execution_mode = 'conversation'
                   or target_skill.provider = ?
                 )
               )
             )
           on conflict (channel_id, trigger_message_id, agent_id) do nothing`,
        )
        .bind(
          delegatedJobId,
          delegation.skillId,
          delegation.skillId,
          ...(skillExecutionApprovalsAvailable ? [delegation.request] : []),
          crypto.randomUUID(),
          delegation.request,
          input.completedAt,
          input.completedAt,
          delegation.agentId,
          delegation.skillId,
          input.jobId,
          input.deviceId,
          input.workerId,
          input.claimTokenHash,
          input.completedAt,
          delegation.projectId,
          delegation.skillId,
          delegation.provider,
          delegation.skillId,
          delegation.provider,
        ),
      db.prepare(
        `insert into briar_channel_reply_session_events (
           id, session_id, reply_job_id, event_type, reason,
           retained_until, detail_json, occurred_at
         )
         select ?, session.id, job.id, 'ttl_renewed', 'delegation_enqueued',
                ?, '{}', ?
         from briar_channel_agent_reply_jobs job
         join briar_channel_reply_sessions session on session.id = job.session_id
         where job.id = ?`,
      ).bind(
        crypto.randomUUID(),
        retainedUntil,
        input.completedAt,
        delegatedJobId,
      ),
    );
  }
  statements.push(
    db.prepare(
      `update briar_channel_reply_sessions
       set conversation_id = coalesce(?, conversation_id),
           last_activity_at = ?, retained_until = ?, updated_at = ?
       where id = ? and owner_device_id = ? and owner_worker_id = ?
         and exists (
           select 1 from briar_channel_agent_reply_jobs job
           where job.id = ? and job.session_id =
                 briar_channel_reply_sessions.id
             and job.claimed_device_id = ? and job.claimed_worker_id = ?
             and job.claim_token_hash = ? and job.status = 'completed'
             and job.completed_at = ?
         )`,
    ).bind(
      input.conversationId ?? null,
      input.completedAt,
      retainedUntil,
      input.completedAt,
      job.session_id,
      input.deviceId,
      input.workerId,
      input.jobId,
      input.deviceId,
      input.workerId,
      input.claimTokenHash,
      input.completedAt,
    ),
    db.prepare(
      `insert into briar_channel_reply_session_events (
         id, session_id, reply_job_id, event_type, reason,
         from_worker_id, to_worker_id, retained_until, detail_json,
         occurred_at
       )
       select ?, session.id, job.id, 'ttl_renewed', 'reply_completed',
              ?, ?, ?, '{}', ?
       from briar_channel_reply_sessions session
       join briar_channel_agent_reply_jobs job on job.session_id = session.id
       where job.id = ? and job.claimed_device_id = ?
         and job.claimed_worker_id = ? and job.claim_token_hash = ?
         and job.status = 'completed' and job.completed_at = ?
         and session.updated_at = ?`,
    ).bind(
      crypto.randomUUID(),
      input.workerId,
      input.workerId,
      retainedUntil,
      input.completedAt,
      input.jobId,
      input.deviceId,
      input.workerId,
      input.claimTokenHash,
      input.completedAt,
      input.completedAt,
    ),
    db
      .prepare(
        `update briar_channel_agent_reply_jobs
         set claim_token_hash = null, lease_expires_at = null
         where id = ? and claimed_device_id = ? and claimed_worker_id = ?
           and claim_token_hash = ? and status = 'completed'
           and completed_at = ?`,
      )
      .bind(
        input.jobId,
        input.deviceId,
        input.workerId,
        input.claimTokenHash,
        input.completedAt,
      ),
  );
  const results = await db.batch(statements);
  // AFTER UPDATE channel-sync triggers inflate meta.changes, so ownership is
  // proven by the guarded UPDATE's RETURNING row. Avoid a second immediate D1
  // read as well: Miniflare can expose that read across a visibility boundary
  // even though the batch has committed successfully.
  const transitioned = results[0]?.results[0] as ChannelReplyJobRow | undefined;
  return transitioned
    ? {
        ...transitioned,
        claim_token_hash: null,
        lease_expires_at: null,
      }
    : null;
}

export async function getChannelActionProposal(
  db: D1Database,
  channelId: string,
  proposalId: string,
) {
  return db
    .prepare(
      `select proposal.*,
              reply.parent_message_id as reply_parent_message_id,
              reply.author_agent_id as reply_author_agent_id,
              agent.organization_id as reply_author_agent_organization_id,
              agent.project_id as reply_author_agent_project_id
       from briar_channel_action_proposals proposal
       join briar_channel_messages reply
         on reply.id = proposal.reply_message_id
        and reply.channel_id = proposal.channel_id
       left join briar_project_agents agent
         on agent.id = reply.author_agent_id
       where proposal.id = ? and proposal.channel_id = ?`,
    )
    .bind(proposalId, channelId)
    .first<{
      id: string;
      channel_id: string;
      project_id: string | null;
      trigger_message_id: string;
      reply_message_id: string;
      reply_parent_message_id: string | null;
      action_type: ChannelActionType;
      payload_json: string;
      status: "pending" | "accepted";
      accepted_by_user_id: string | null;
      accepted_at: string | null;
      issue_source_key: string | null;
      execute_after_create: number;
      execution_proposal_id: string | null;
      result_run_id: string | null;
      reply_author_agent_id: string | null;
      reply_author_agent_organization_id: string | null;
      reply_author_agent_project_id: string | null;
      created_at: string;
      updated_at: string;
    }>();
}

/**
 * Records the member's approval target before creating the issue. The guarded
 * update is the serialization point for organization Agent proposals whose
 * project is chosen at approval time: two members may retry the same target,
 * but they can never create the proposal in two different projects.
 *
 * The proposal deliberately remains `pending` until issue creation succeeds.
 * A failed request can therefore be retried without losing the approval, while
 * `accepted_by_user_id` keeps the original approver authoritative for audit
 * metadata even when another member completes that retry. If an ON DELETE SET
 * NULL breaks a reserved project/approver tuple before finalization, the next
 * explicit click replaces the whole reservation instead of leaving the card
 * permanently unapprovable or reinterpreting the earlier click.
 */
export async function reserveChannelActionProposalApproval(
  db: D1Database,
  input: {
    organizationId: string;
    channelId: string;
    proposalId: string;
    projectId: string;
    userId: string;
    approvedAt: string;
    issueSourceKey: string;
  },
) {
  return db
    .prepare(
      `update briar_channel_action_proposals
       set project_id = ?,
           accepted_by_user_id = case
             when project_id = ? and accepted_by_user_id is not null
               and accepted_at is not null and issue_source_key is not null
             then accepted_by_user_id else ? end,
           accepted_at = case
             when project_id = ? and accepted_by_user_id is not null
               and accepted_at is not null and issue_source_key is not null
             then accepted_at else ? end,
           issue_source_key = case
             when project_id = ? and accepted_by_user_id is not null
               and accepted_at is not null and issue_source_key is not null
             then issue_source_key else ? end,
           updated_at = ?
       where id = ? and channel_id = ? and status = 'pending'
         and action_type = 'request_issue_create'
         and (project_id is null or project_id = ?)
         and not exists (
           select 1 from briar_hunt_runs legacy_run
           where legacy_run.source = 'issue'
             and legacy_run.source_key =
               'briar-channel-proposal:' || briar_channel_action_proposals.id
             and not exists (
               select 1 from briar_channel_issue_approval_reconciliation finding
               where finding.run_id = legacy_run.id
             )
         )
         and exists (
           select 1
           from briar_channels channel
           join briar_organization_members membership
             on membership.organization_id = channel.organization_id
            and membership.user_id = ?
           join briar_projects target_project
             on target_project.id = ?
            and target_project.organization_id = channel.organization_id
           join briar_channel_messages reply
             on reply.id = briar_channel_action_proposals.reply_message_id
            and reply.channel_id = channel.id
           join briar_project_agents agent
             on agent.id = reply.author_agent_id
            and agent.organization_id = channel.organization_id
           where channel.id = briar_channel_action_proposals.channel_id
             and channel.organization_id = ?
             and channel.archived_at is null
             and (
               channel.visibility = 'public'
               or exists (
                 select 1 from briar_channel_members channel_member
                 where channel_member.channel_id = channel.id
                   and channel_member.user_id = ?
               )
             )
             and (agent.project_id is null or agent.project_id = ?)
         )
       returning id, project_id, status, accepted_by_user_id, accepted_at,
                 issue_source_key`,
    )
    .bind(
      input.projectId,
      input.projectId,
      input.userId,
      input.projectId,
      input.approvedAt,
      input.projectId,
      input.issueSourceKey,
      input.approvedAt,
      input.proposalId,
      input.channelId,
      input.projectId,
      input.userId,
      input.projectId,
      input.organizationId,
      input.userId,
      input.projectId,
    )
    .first<{
      id: string;
      project_id: string;
      status: "pending";
      accepted_by_user_id: string;
      accepted_at: string;
      issue_source_key: string;
    }>();
}

export async function acceptChannelActionProposal(
  db: D1Database,
  input: {
    channelId: string;
    proposalId: string;
    projectId: string;
    userId: string;
    resultRunId: string;
    issueSourceKey: string;
    acceptedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_channel_action_proposals
       set status = 'accepted',
           accepted_by_user_id = coalesce(accepted_by_user_id, ?),
           accepted_at = coalesce(accepted_at, ?),
           project_id = ?, result_run_id = ?, updated_at = ?
       where id = ? and channel_id = ? and status = 'pending'
         and action_type = 'request_issue_create'
         and project_id = ?
         and issue_source_key = ?
         and accepted_by_user_id is not null and accepted_at is not null
         and exists (
           select 1 from briar_hunt_runs result
           where result.id = ? and result.project_id = ?
             and result.source = 'issue' and result.source_key = ?
         )
       returning *`,
    )
    .bind(
      input.userId,
      input.acceptedAt,
      input.projectId,
      input.resultRunId,
      input.acceptedAt,
      input.proposalId,
      input.channelId,
      input.projectId,
      input.issueSourceKey,
      input.resultRunId,
      input.projectId,
      input.issueSourceKey,
    )
    .first<{ id: string; status: "pending" | "accepted" }>();
}

export async function getChannelExecutionProposal(
  db: D1Database,
  input: {
    organizationId: string;
    channelId: string;
    proposalId: string;
    userId: string;
  },
) {
  return db
    .prepare(
      `select proposal.*
       from briar_issue_execution_proposals proposal
       join briar_channels channel on channel.id = proposal.channel_id
       where proposal.id = ? and proposal.source_kind = 'channel'
         and proposal.organization_id = ? and proposal.channel_id = ?
         and channel.organization_id = proposal.organization_id
         and (
           channel.visibility = 'public'
           or exists (
             select 1 from briar_channel_members member
             where member.channel_id = channel.id and member.user_id = ?
           )
         )`,
    )
    .bind(
      input.proposalId,
      input.organizationId,
      input.channelId,
      input.userId,
    )
    .first<IssueExecutionProposalRow>();
}

export async function getChannelAgentSkillExecutionProposal(
  db: D1Database,
  input: {
    organizationId: string;
    channelId: string;
    proposalId: string;
    userId: string;
  },
) {
  return db
    .prepare(
      `select proposal.*,
              case
                when proposal.status = 'pending' then 'waiting'
                when proposal.execution_mode = 'task' then coalesce((
                  select case task.status when 'completed' then 'completed'
                    when 'failed' then 'failed' else 'running' end
                  from briar_project_agent_task_jobs task
                  where task.id = proposal.result_session_id
                ), 'running')
                else coalesce((
                  select case reply.status when 'completed' then 'completed'
                    when 'failed' then 'failed' else 'running' end
                  from briar_channel_agent_reply_jobs reply
                  where reply.id = proposal.result_reply_job_id
                ), 'running')
              end as execution_status,
              case when proposal.execution_mode = 'task' then (
                select task.error from briar_project_agent_task_jobs task
                where task.id = proposal.result_session_id
              ) else (
                select reply.error from briar_channel_agent_reply_jobs reply
                where reply.id = proposal.result_reply_job_id
              ) end as execution_error
       from briar_agent_skill_execution_proposals proposal
       join briar_channels channel on channel.id = proposal.channel_id
       where proposal.id = ? and proposal.source_kind = 'channel'
         and proposal.organization_id = ? and proposal.channel_id = ?
         and channel.organization_id = proposal.organization_id
         and (
           channel.visibility = 'public'
           or exists (
             select 1 from briar_channel_members member
             where member.channel_id = channel.id and member.user_id = ?
           )
         )`,
    )
    .bind(
      input.proposalId,
      input.organizationId,
      input.channelId,
      input.userId,
    )
    .first<AgentSkillExecutionProposalRow>();
}

export async function reserveChannelExecutionProposalApproval(
  db: D1Database,
  input: {
    organizationId: string;
    channelId: string;
    proposalId: string;
    userId: string;
    provider: AgentProvider;
    model: string | null;
    effort: AgentSkillEffort | null;
    workerId: string | null;
    dispatchRequestId: string;
    reservedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_issue_execution_proposals
       set approval_reserved_by_user_id = coalesce(
             approval_reserved_by_user_id, ?
           ),
           approval_reserved_at = coalesce(approval_reserved_at, ?),
           requested_provider = coalesce(requested_provider, ?),
           requested_model = case
             when dispatch_request_id is null then ? else requested_model end,
           requested_effort = case
             when dispatch_request_id is null then ? else requested_effort end,
           requested_worker_id = case
             when dispatch_request_id is null then ? else requested_worker_id end,
           dispatch_request_id = coalesce(dispatch_request_id, ?),
           updated_at = case
             when dispatch_request_id is null then ? else updated_at end
       where id = ? and source_kind = 'channel' and status = 'pending'
         and organization_id = ? and channel_id = ?
         and (
           dispatch_request_id is null
           or (
             approval_reserved_by_user_id = ?
             and requested_provider = ? and requested_model is ?
             and requested_effort is ? and requested_worker_id is ?
           )
         )
         and exists (
           select 1
           from briar_channels channel
           join briar_organization_members membership
             on membership.organization_id = channel.organization_id
            and membership.user_id = ?
           join briar_projects project
             on project.id = briar_issue_execution_proposals.project_id
            and project.organization_id = channel.organization_id
           join briar_hunt_runs run
             on run.id = briar_issue_execution_proposals.target_run_id
            and run.project_id = project.id
           join briar_channel_messages reply
             on reply.id = briar_issue_execution_proposals.reply_message_id
            and reply.channel_id = channel.id
           join briar_project_agents agent
             on agent.id = briar_issue_execution_proposals.proposed_by_agent_id
            and agent.id = reply.author_agent_id
            and agent.project_id = project.id
            and agent.organization_id = channel.organization_id
           join briar_channel_agents roster
             on roster.channel_id = channel.id and roster.agent_id = agent.id
           where channel.id = briar_issue_execution_proposals.channel_id
             and channel.archived_at is null
             and (
               channel.visibility = 'public'
               or exists (
                 select 1 from briar_channel_members channel_member
                 where channel_member.channel_id = channel.id
                   and channel_member.user_id = ?
               )
             )
             and run.updated_at =
               briar_issue_execution_proposals.target_run_updated_at
             and run.status = 'backlog' and run.stage = 'queued'
             and run.workflow_stage is null
             and run.worker_id is null and run.requested_worker_id is null
             and run.claim_token_hash is null and run.claimed_by is null
             and run.claimed_at is null and run.lease_expires_at is null
             and run.last_execution_id is null
             and run.dispatch_mode is null and run.dispatch_request_id is null
             and run.dispatched_at is null and run.requested_by_user_id is null
             and run.completed_at is null and run.paused_at is null
             and run.resume_requested_at is null
         )
       returning *`,
    )
    .bind(
      input.userId,
      input.reservedAt,
      input.provider,
      input.model,
      input.effort,
      input.workerId,
      input.dispatchRequestId,
      input.reservedAt,
      input.proposalId,
      input.organizationId,
      input.channelId,
      input.userId,
      input.provider,
      input.model,
      input.effort,
      input.workerId,
      input.userId,
      input.userId,
    )
    .first<IssueExecutionProposalRow>();
}

export async function getChannelSyncCursor(
  db: D1Database,
  organizationId: string,
) {
  const row = await db
    .prepare(
      `select current_version from briar_channel_sync_state
       where organization_id = ?`,
    )
    .bind(organizationId)
    .first<{ current_version: number }>();
  return row?.current_version ?? 0;
}

/**
 * Channel deltas answer "what changed for this member" rather than "what
 * changed in the organization": changes in channels the caller cannot see are
 * consumed by the cursor but never returned.
 */
export async function loadChannelDelta(
  db: D1Database,
  organizationId: string,
  userId: string,
  since: number,
  limit = 200,
) {
  const currentCursor = await getChannelSyncCursor(db, organizationId);
  if (currentCursor <= since) {
    return {
      cursor: since,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [],
      removedMessageIds: [],
      agentReplies: [],
    };
  }
  const changes = await db
    .prepare(
      `select version, channel_id, entity_type, entity_id, operation
       from briar_channel_changes
       where organization_id = ? and version > ?
       order by version limit ?`,
    )
    .bind(organizationId, since, limit + 1)
    .all<{
      version: number;
      channel_id: string;
      entity_type: "channel" | "message" | "reply_job" | "proposal";
      entity_id: string | null;
      operation: "upsert" | "delete";
    }>();
  const hasMore = changes.results.length > limit;
  const rows = hasMore ? changes.results.slice(0, limit) : changes.results;
  const cursor = rows.at(-1)?.version ?? since;

  if (rows.length === 0) {
    return {
      cursor,
      hasMore,
      channels: [],
      removedChannelIds: [],
      messages: [],
      removedMessageIds: [],
      agentReplies: [],
    };
  }

  const executionProposalsAvailable =
    await channelExecutionProposalTablesAvailable(db);
  const skillExecutionProposalsAvailable =
    await channelSkillExecutionProposalTablesAvailable(db);

  const visible = new Set(
    (
      await db
        .prepare(
          `select channel.id from briar_channels channel
           where channel.organization_id = ? and ${visibleToUser}`,
        )
        .bind(organizationId, userId)
        .all<{ id: string }>()
    ).results.map((row) => row.id),
  );
  const channelIds = new Set<string>();
  const messageIds = new Set<string>();
  const replyJobIds = new Set<string>();
  const removedChannelIds: string[] = [];
  const removedMessageIds: string[] = [];
  for (const change of rows) {
    if (change.entity_type === "channel") {
      if (change.operation === "delete") removedChannelIds.push(change.channel_id);
      else if (visible.has(change.channel_id)) channelIds.add(change.channel_id);
      continue;
    }
    if (!visible.has(change.channel_id) || !change.entity_id) continue;
    if (change.entity_type === "message") {
      if (change.operation === "delete") removedMessageIds.push(change.entity_id);
      else messageIds.add(change.entity_id);
      channelIds.add(change.channel_id);
    } else if (change.entity_type === "reply_job") {
      replyJobIds.add(change.entity_id);
    } else if (change.entity_type === "proposal") {
      // A proposal is rendered on its reply message, so refresh that message.
      const proposalSelects = [
        `select reply_message_id from briar_channel_action_proposals
         where id = ?`,
        ...(executionProposalsAvailable
          ? [`select reply_message_id from briar_issue_execution_proposals
              where id = ? and source_kind = 'channel'`]
          : []),
        ...(skillExecutionProposalsAvailable
          ? [`select reply_message_id
              from briar_agent_skill_execution_proposals
              where id = ? and source_kind = 'channel'`]
          : []),
      ];
      const proposal = await db
        .prepare(
          `${proposalSelects.join("\nunion all\n")}\nlimit 1`,
        )
        .bind(...proposalSelects.map(() => change.entity_id))
        .first<{ reply_message_id: string }>();
      if (proposal) messageIds.add(proposal.reply_message_id);
    }
  }

  const channels = channelIds.size
    ? (
        await db
          .prepare(
            `${channelSelectForUser} where channel.organization_id = ?
             and channel.id in (${[...channelIds].map(() => "?").join(", ")})`,
          )
          .bind(userId, userId, organizationId, ...channelIds)
          .all<ChannelRow>()
      ).results
    : [];
  if (messageIds.size) {
    const changedMessageIds = [...messageIds];
    const parentRows = await db
      .prepare(
        `select distinct parent_message_id
         from briar_channel_messages
         where id in (${changedMessageIds.map(() => "?").join(", ")})
           and parent_message_id is not null`,
      )
      .bind(...changedMessageIds)
      .all<{ parent_message_id: string }>();
    for (const row of parentRows.results) messageIds.add(row.parent_message_id);
  }
  const messageRows = messageIds.size
    ? (
        await db
          .prepare(
            `${await messageSelectFor(db)} where message.id in (${[...messageIds]
              .map(() => "?")
              .join(", ")})`,
          )
          .bind(...messageIds)
          .all<ChannelMessageRow>()
      ).results
    : [];
  const agentReplies = replyJobIds.size
    ? (
        await db
          .prepare(
            `select * from briar_channel_agent_reply_jobs
             where id in (${[...replyJobIds].map(() => "?").join(", ")})`,
          )
          .bind(...replyJobIds)
          .all<ChannelReplyJobRow>()
      ).results
    : [];

  return {
    cursor,
    hasMore,
    channels: channels.map(channelJson),
    removedChannelIds,
    messages: await attachMessageRelations(db, messageRows),
    removedMessageIds,
    agentReplies: agentReplies.map(channelReplyJson),
  };
}
