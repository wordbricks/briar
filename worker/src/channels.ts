import {
  type ChannelActionType,
  type ChannelAgentProvider as AgentProvider,
  type ChannelAgentReply,
  type ChannelMessage,
  type ChannelMessageAttachment,
  type ChannelMessageReaction,
  type ChannelReplyStatus,
  type ChannelSummary,
  type ChannelVisibility,
} from "../../src/lib/channels-contract";
import { isWorkerEmoji } from "../../src/lib/worker-icon-validation";
import type { AgentSkillEffort } from "./agent-skills";

export type ChannelRow = {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  topic: string | null;
  visibility: ChannelVisibility;
  default_project_id: string | null;
  archived_at: string | null;
  member_count: number;
  agent_count: number;
  created_at: string;
  updated_at: string;
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
  body: string;
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
  proposal_result_run_id: string | null;
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
> & {
  parent_message_id: string;
  last_reply_at: string;
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
  claimed_device_id: string | null;
  claimed_worker_id: string | null;
  claim_token_hash: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  selected_skill_id_snapshot: string | null;
  delegated_by_reply_job_id: string | null;
  delegation_request: string | null;
};

const MAX_REPLY_ATTEMPTS = 3;

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
        and runtime_agent.provider = ${job}.agent_provider
    )
  )
  or (
    ${job}.selected_skill_id_snapshot is not null
    and ${job}.skill_id = ${job}.selected_skill_id_snapshot
    and exists (
      select 1 from briar_agent_skills runtime_skill
      where runtime_skill.id = ${job}.selected_skill_id_snapshot
        and runtime_skill.agent_id = ${job}.agent_id
        and runtime_skill.provider = ${job}.agent_provider
    )
  )
), 0) = 1`;

const channelSelect = `
  select channel.id, channel.organization_id, channel.slug, channel.name,
         channel.topic, channel.visibility, channel.default_project_id,
         channel.archived_at,
         (select count(*) from briar_channel_members member
          where member.channel_id = channel.id) as member_count,
         (select count(*) from briar_channel_agents agent
          where agent.channel_id = channel.id) as agent_count,
         channel.created_at, channel.updated_at
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

const messageSelect = `
  select message.id, message.channel_id, message.parent_message_id,
         message.author_user_id, author.name as author_name,
         author.email as author_email, author.image as author_image,
         message.author_agent_id, message.author_agent_name,
         message.author_agent_provider, message.body,
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
         message.created_at
  from briar_channel_messages message
  left join "user" author on author.id = message.author_user_id
  left join briar_channel_message_documents document
    on document.message_id = message.id
  left join briar_channel_action_proposals proposal
    on proposal.reply_message_id = message.id`;

export const channelJson = (row: ChannelRow): ChannelSummary => ({
  id: row.id,
  organizationId: row.organization_id,
  slug: row.slug,
  name: row.name,
  topic: row.topic,
  visibility: row.visibility,
  defaultProjectId: row.default_project_id,
  archivedAt: row.archived_at,
  memberCount: row.member_count,
  agentCount: row.agent_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
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
  >,
) =>
  row.author_agent_name
    ? {
        type: "agent" as const,
        id: row.author_agent_id,
        name: row.author_agent_name,
        provider: row.author_agent_provider,
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
): ChannelMessage => ({
  id: row.id,
  channelId: row.channel_id,
  parentMessageId: row.parent_message_id,
  author: channelMessageAuthorJson(row),
  body: row.body,
  mentionedUserIds: mentions.users,
  mentionedAgentIds: mentions.agents,
  attachments,
  reactions,
  replyCount: row.reply_count,
  lastReplyAt: row.last_reply_at,
  replyAuthors,
  document: row.document_message_id
    ? {
        messageId: row.document_message_id,
        title: row.document_title ?? "",
        projectId: row.document_project_id,
      }
    : null,
  proposal: row.proposal_id
    ? {
        id: row.proposal_id,
        actionType: row.proposal_action_type ?? "request_issue_create",
        status: row.proposal_status ?? "pending",
        projectId: row.proposal_project_id,
        payload: JSON.parse(row.proposal_payload_json ?? "{}"),
        resultRunId: row.proposal_result_run_id,
      }
    : null,
  createdAt: row.created_at,
});

/** One grapheme emoji, same rule as Worker icons so flags and ZWJ stay valid. */
export function isChannelReactionEmoji(value: string) {
  return isWorkerEmoji(value);
}

function aggregateReactions(
  rows: Array<{ message_id: string; user_id: string; emoji: string; created_at: string }>,
): Map<string, ChannelMessageReaction[]> {
  const byMessage = new Map<
    string,
    Map<string, { userIds: string[]; firstCreatedAt: string }>
  >();
  for (const row of rows) {
    let emojiMap = byMessage.get(row.message_id);
    if (!emojiMap) {
      emojiMap = new Map();
      byMessage.set(row.message_id, emojiMap);
    }
    const current = emojiMap.get(row.emoji);
    if (current) {
      current.userIds.push(row.user_id);
    } else {
      emojiMap.set(row.emoji, {
        userIds: [row.user_id],
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
      `${channelSelect}
       where channel.organization_id = ? and ${visibleToUser}
       order by channel.archived_at is not null, channel.name, channel.id`,
    )
    .bind(organizationId, userId)
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
      `${channelSelect}
       where channel.organization_id = ? and channel.id = ? and ${visibleToUser}`,
    )
    .bind(organizationId, channelId, userId)
    .first<ChannelRow>();
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
    slug: string;
    name: string;
    topic: string | null;
    visibility: ChannelVisibility;
    defaultProjectId: string | null;
    createdByUserId: string;
    createdAt: string;
  },
) {
  await db.batch([
    db
      .prepare(
        `insert into briar_channels (
           id, organization_id, slug, name, topic, visibility,
           default_project_id, created_by_user_id, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
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
    db
      .prepare(
        `insert into briar_channel_members (
           channel_id, user_id, role, created_at
         ) values (?, ?, 'owner', ?)`,
      )
      .bind(input.id, input.createdByUserId, input.createdAt),
  ]);
  return getChannel(db, input.organizationId, input.id, input.createdByUserId);
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
               and membership.role in ('owner', 'admin')
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
      .bind(observedAt, organizationId, channelId, userId),
    db
      .prepare(
        `delete from briar_channels
         where id = ? and organization_id = ?
           and exists (
             select 1 from briar_organization_members membership
             where membership.organization_id = briar_channels.organization_id
               and membership.user_id = ?
               and membership.role in ('owner', 'admin')
           )
         returning id`,
      )
      .bind(channelId, organizationId, userId),
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
  await db
    .prepare(
      `insert into briar_channel_members (channel_id, user_id, role, created_at)
       values (?, ?, ?, ?)
       on conflict (channel_id, user_id) do update set role = excluded.role`,
    )
    .bind(input.channelId, input.userId, input.role, input.createdAt)
    .run();
}

export async function removeChannelMember(
  db: D1Database,
  channelId: string,
  userId: string,
) {
  const result = await db
    .prepare(
      `delete from briar_channel_members where channel_id = ? and user_id = ?`,
    )
    .bind(channelId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function listChannelAgents(db: D1Database, channelId: string) {
  const rows = await db
    .prepare(
      `select agent.id, agent.organization_id, agent.project_id, agent.handle,
              project.name as project_name, agent.name, agent.avatar,
              agent.provider, agent.model, agent.responsibility,
              agent.effort, agent.created_at, agent.updated_at
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
      handle: string | null;
      name: string;
      avatar: string | null;
      provider: AgentProvider;
      model: string | null;
      responsibility: string;
      effort: AgentSkillEffort | null;
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
  await db
    .prepare(
      `insert into briar_channel_agents (
         channel_id, agent_id, added_by_user_id, created_at
       ) values (?, ?, ?, ?)
       on conflict (channel_id, agent_id) do nothing`,
    )
    .bind(
      input.channelId,
      input.agentId,
      input.addedByUserId,
      input.createdAt,
    )
    .run();
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
  ]);
  const result = results[1];
  return (result.meta.changes ?? 0) > 0;
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
  const placeholders = ids.map(() => "?").join(", ");
  const [userMentions, agentMentions, attachments, reactions, replyAuthors] = await Promise.all([
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
        `select message_id, user_id, emoji, created_at
         from briar_channel_message_reactions
         where message_id in (${placeholders})
         order by created_at, emoji, user_id`,
      )
      .bind(...ids)
      .all<{
        message_id: string;
        user_id: string;
        emoji: string;
        created_at: string;
      }>(),
    db
      .prepare(
        `with reply_authors as (
           select reply.parent_message_id, reply.author_user_id,
                  author.name as author_name, author.email as author_email,
                  author.image as author_image,
                  reply.author_agent_id, reply.author_agent_name,
                  reply.author_agent_provider,
                  max(reply.created_at) as last_reply_at
           from briar_channel_messages reply
           left join "user" author on author.id = reply.author_user_id
           where reply.parent_message_id in (${placeholders})
           group by reply.parent_message_id, reply.author_user_id,
                    author.name, author.email, author.image,
                    reply.author_agent_id, reply.author_agent_name,
                    reply.author_agent_provider
         ), ranked_reply_authors as (
           select *, row_number() over (
             partition by parent_message_id
             order by last_reply_at desc,
                      coalesce(author_user_id, author_agent_id, author_agent_name)
           ) as author_rank
           from reply_authors
         )
         select parent_message_id, author_user_id, author_name, author_email,
                author_image, author_agent_id, author_agent_name,
                author_agent_provider, last_reply_at
         from ranked_reply_authors
         where author_rank <= 3
         order by parent_message_id, author_rank`,
      )
      .bind(...ids)
      .all<ChannelReplyAuthorRow>(),
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
  return rows.map((row) =>
    channelMessageJson(
      row,
      byMessage.get(row.id) ?? { users: [], agents: [] },
      attachmentsByMessage.get(row.id) ?? [],
      reactionsByMessage.get(row.id) ?? [],
      replyAuthorsByMessage.get(row.id) ?? [],
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
  if (!message) return null;

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
  const rows = await db
    .prepare(
      `${messageSelect}
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
  const rows = await db
    .prepare(
      `${messageSelect}
       where message.channel_id = ?
         and (message.id = ? or message.parent_message_id = ?)
       order by message.created_at, message.id`,
    )
    .bind(channelId, parentMessageId, parentMessageId)
    .all<ChannelMessageRow>();
  return attachMessageRelations(db, rows.results);
}

export async function getChannelMessage(
  db: D1Database,
  channelId: string,
  messageId: string,
) {
  const row = await db
    .prepare(`${messageSelect} where message.channel_id = ? and message.id = ?`)
    .bind(channelId, messageId)
    .first<ChannelMessageRow>();
  if (!row) return null;
  const [message] = await attachMessageRelations(db, [row]);
  return message ?? null;
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
           author_agent_name, author_agent_provider, body, created_at, updated_at
         )
         select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
    }>;
    createdAt: string;
  },
) {
  if (input.agents.length === 0) return [];
  await db.batch(
    input.agents.map((agent) =>
      db
        .prepare(
          `insert into briar_channel_agent_reply_jobs (
             id, organization_id, channel_id, project_id, agent_id, skill_id,
             selected_skill_id_snapshot,
             trigger_message_id, parent_message_id, reply_message_id,
             agent_provider, created_at, updated_at
           )
           select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           from briar_channel_agents roster
           join briar_project_agents current_agent
             on current_agent.id = roster.agent_id
           join briar_channels channel
             on channel.id = roster.channel_id
            and channel.organization_id = current_agent.organization_id
           where roster.channel_id = ? and roster.agent_id = ?
             and current_agent.organization_id = ?
             and current_agent.project_id is ?
             and (
               (? is null and current_agent.provider = ?)
               or exists (
                 select 1 from briar_agent_skills current_skill
                 where current_skill.id = ?
                   and current_skill.agent_id = current_agent.id
                   and current_skill.provider = ?
               )
             )
           on conflict (channel_id, trigger_message_id, agent_id) do nothing`,
        )
        .bind(
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
          agent.provider,
          input.createdAt,
          input.createdAt,
          input.channelId,
          agent.id,
          input.organizationId,
          agent.projectId,
          agent.skillId ?? null,
          agent.provider,
          agent.skillId ?? null,
          agent.provider,
        ),
    ),
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
    supportsOrganizationAgentContext: boolean;
    claimTokenHash: string;
    claimedAt: string;
    leaseExpiresAt: string;
  },
) {
  await db
    .prepare(
      `update briar_channel_agent_reply_jobs
       set status = 'failed',
           error = 'Agent provider or selected Skill changed before reply execution.',
           claimed_device_id = null, claimed_worker_id = null,
           claim_token_hash = null, lease_expires_at = null,
           completed_at = ?, updated_at = ?
       where organization_id = ? and status in ('queued', 'running')
         and not (${liveChannelReplyRuntime("briar_channel_agent_reply_jobs")})`,
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
  return db
    .prepare(
      `update briar_channel_agent_reply_jobs
       set status = 'running', claimed_device_id = ?, claimed_worker_id = ?,
           claim_token_hash = ?,
           claimed_at = ?, lease_expires_at = ?, attempts = attempts + 1,
           error = null, updated_at = ?
       where id = (
         select job.id from briar_channel_agent_reply_jobs job
         where job.organization_id = ? and job.attempts < ?
           and (job.status = 'queued'
             or (job.status = 'running' and job.lease_expires_at <= ?))
           and exists (
             select 1 from briar_channel_agents current_roster
             where current_roster.channel_id = job.channel_id
               and current_roster.agent_id = job.agent_id
           )
           and ${liveChannelReplyRuntime("job")}
           and (job.project_id is not null or ? = 1)
           and ((job.agent_provider = 'codex' and ? = 1)
             or (job.agent_provider = 'claude' and ? = 1)
             or (job.agent_provider = 'grok' and ? = 1)
             or (job.agent_provider = 'opencode' and ? = 1))
           and exists (
             select 1 from briar_execution_workers binding
             where binding.id = ? and binding.device_id = ?
               and binding.state <> 'disabled'
               and (
                 job.project_id is null
                 or binding.project_id = job.project_id
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
         order by job.created_at, job.id limit 1
       ) returning *`,
    )
    .bind(
      input.deviceId,
      input.workerId,
      input.claimTokenHash,
      input.claimedAt,
      input.leaseExpiresAt,
      input.claimedAt,
      organizationId,
      MAX_REPLY_ATTEMPTS,
      input.claimedAt,
      input.supportsOrganizationAgentContext ? 1 : 0,
      input.providers.includes("codex") ? 1 : 0,
      input.providers.includes("claude") ? 1 : 0,
      input.providers.includes("grok") ? 1 : 0,
      input.providers.includes("opencode") ? 1 : 0,
      input.workerId,
      input.deviceId,
    )
    .first<ChannelReplyJobRow>();
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
  return db
    .prepare(
      `update briar_channel_agent_reply_jobs
       set lease_expires_at = ?, updated_at = ?
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
    )
    .bind(
      input.leaseExpiresAt,
      input.leaseExpiresAt,
      input.jobId,
      input.deviceId,
      input.workerId,
      input.claimTokenHash,
      input.observedAt,
    )
    .first<ChannelReplyJobRow>();
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
  return db
    .prepare(
      `update briar_channel_agent_reply_jobs
       set status = case when attempts >= ? then 'failed' else 'queued' end,
           error = ?, claimed_device_id = null, claimed_worker_id = null,
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
    )
    .bind(
      MAX_REPLY_ATTEMPTS,
      input.error.slice(0, 4000),
      input.updatedAt,
      input.jobId,
      input.deviceId,
      input.workerId,
      input.claimTokenHash,
      input.updatedAt,
    )
    .first<ChannelReplyJobRow>();
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
  } | null;
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
  const delegation = input.delegation ?? null;
  if (
    job.project_id !== null &&
    [input.document?.projectId, input.issueProposal?.projectId].some(
      (projectId) => projectId !== undefined && projectId !== job.project_id,
    )
  ) {
    throw new Error("Project Agent output must target its claimed project");
  }
  if (delegation && (job.project_id !== null || job.delegated_by_reply_job_id)) {
    throw new Error("Only a top-level Organization Agent reply can delegate");
  }
  if (delegation && (input.document || input.issueProposal)) {
    throw new Error("A delegated reply cannot also create an artifact proposal");
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
                         and target_skill.provider = ?
                     )
                   )
               )
             )
           )
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
        job.parent_message_id,
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
    statements.push(
      db
        .prepare(
          `insert into briar_channel_action_proposals (
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
        .bind(
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
        ),
    );
  }
  if (delegation) {
    statements.push(
      db
        .prepare(
          `insert into briar_channel_agent_reply_jobs (
             id, organization_id, channel_id, project_id, agent_id, skill_id,
             selected_skill_id_snapshot,
             trigger_message_id, parent_message_id, reply_message_id,
             agent_provider, delegated_by_reply_job_id, delegation_request,
             created_at, updated_at
           )
           select ?, parent.organization_id, parent.channel_id,
                  target.project_id, target.id, ?, ?, parent.trigger_message_id,
                  parent.parent_message_id, ?, ?, parent.id, ?, ?, ?
           from briar_channel_agent_reply_jobs parent
           join briar_project_agents target on target.id = ?
           join briar_channel_agents roster
             on roster.agent_id = target.id and roster.channel_id = parent.channel_id
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
               or exists (
                 select 1 from briar_agent_skills target_skill
                 where target_skill.id = ? and target_skill.agent_id = target.id
                   and target_skill.provider = ?
               )
             )
           on conflict (channel_id, trigger_message_id, agent_id) do nothing`,
        )
        .bind(
          crypto.randomUUID(),
          delegation.skillId,
          delegation.skillId,
          crypto.randomUUID(),
          delegation.provider,
          delegation.request,
          input.completedAt,
          input.completedAt,
          delegation.agentId,
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
    );
  }
  statements.push(
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
      action_type: ChannelActionType;
      payload_json: string;
      status: "pending" | "accepted";
      accepted_by_user_id: string | null;
      accepted_at: string | null;
      issue_source_key: string | null;
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

  const visible = new Set(
    (await listChannels(db, organizationId, userId)).map((row) => row.id),
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
    } else if (change.entity_type === "reply_job") {
      replyJobIds.add(change.entity_id);
    } else if (change.entity_type === "proposal") {
      // A proposal is rendered on its reply message, so refresh that message.
      const proposal = await db
        .prepare(
          `select reply_message_id from briar_channel_action_proposals
           where id = ?`,
        )
        .bind(change.entity_id)
        .first<{ reply_message_id: string }>();
      if (proposal) messageIds.add(proposal.reply_message_id);
    }
  }

  const channels = channelIds.size
    ? (
        await db
          .prepare(
            `${channelSelect} where channel.organization_id = ?
             and channel.id in (${[...channelIds].map(() => "?").join(", ")})`,
          )
          .bind(organizationId, ...channelIds)
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
            `${messageSelect} where message.id in (${[...messageIds]
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
