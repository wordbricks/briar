import {
  type ChannelActionType,
  type ChannelAgentProvider as AgentProvider,
  type ChannelAgentReply,
  type ChannelMessage,
  type ChannelReplyStatus,
  type ChannelSummary,
  type ChannelVisibility,
} from "../../src/lib/channels-contract";

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
  document_idea_id: string | null;
  document_title: string | null;
  document_status: string | null;
  document_version: number | null;
  document_project_id: string | null;
  proposal_id: string | null;
  proposal_action_type: ChannelActionType | null;
  proposal_status: "pending" | "accepted" | null;
  proposal_project_id: string | null;
  proposal_payload_json: string | null;
  proposal_result_run_id: string | null;
  proposal_result_idea_id: string | null;
  created_at: string;
};

export type ChannelReplyJobRow = {
  id: string;
  organization_id: string;
  channel_id: string;
  project_id: string | null;
  agent_id: string;
  trigger_message_id: string;
  parent_message_id: string;
  reply_message_id: string;
  status: ChannelReplyStatus;
  agent_provider: AgentProvider | null;
  claimed_device_id: string | null;
  claim_token_hash: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

const MAX_REPLY_ATTEMPTS = 3;

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
         document.idea_id as document_idea_id,
         idea.title as document_title, idea.status as document_status,
         idea.version as document_version,
         idea.project_id as document_project_id,
         proposal.id as proposal_id,
         proposal.action_type as proposal_action_type,
         proposal.status as proposal_status,
         proposal.project_id as proposal_project_id,
         proposal.payload_json as proposal_payload_json,
         proposal.result_run_id as proposal_result_run_id,
         proposal.result_idea_id as proposal_result_idea_id,
         message.created_at
  from briar_channel_messages message
  left join "user" author on author.id = message.author_user_id
  left join briar_channel_message_documents document
    on document.message_id = message.id
  left join briar_ideas idea on idea.id = document.idea_id
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

export const channelMessageJson = (
  row: ChannelMessageRow,
  mentions: { users: string[]; agents: string[] } = { users: [], agents: [] },
): ChannelMessage => ({
  id: row.id,
  channelId: row.channel_id,
  parentMessageId: row.parent_message_id,
  author: row.author_agent_name
    ? {
        type: "agent",
        id: row.author_agent_id,
        name: row.author_agent_name,
        provider: row.author_agent_provider,
      }
    : {
        type: "user",
        id: row.author_user_id ?? "",
        name: row.author_name ?? "",
        email: row.author_email ?? "",
        image: row.author_image,
      },
  body: row.body,
  mentionedUserIds: mentions.users,
  mentionedAgentIds: mentions.agents,
  replyCount: row.reply_count,
  lastReplyAt: row.last_reply_at,
  document: row.document_idea_id
    ? {
        ideaId: row.document_idea_id,
        title: row.document_title ?? "",
        status: row.document_status ?? "draft",
        version: row.document_version ?? 1,
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
        resultIdeaId: row.proposal_result_idea_id,
      }
    : null,
  createdAt: row.created_at,
});

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

/**
 * Organization Agents get project names and ids so they can suggest where an
 * issue belongs. Project contents stay out of the snapshot.
 */
export async function listOrganizationProjectTargets(
  db: D1Database,
  organizationId: string,
) {
  const rows = await db
    .prepare(
      `select id, name from briar_projects where organization_id = ?
       order by name, id`,
    )
    .bind(organizationId)
    .all<{ id: string; name: string }>();
  return rows.results;
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
) {
  const result = await db
    .prepare(`delete from briar_channels where id = ? and organization_id = ?`)
    .bind(channelId, organizationId)
    .run();
  return (result.meta.changes ?? 0) > 0;
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
              agent.name, agent.provider, agent.model, agent.responsibility,
              agent.effort, agent.created_at, agent.updated_at
       from briar_channel_agents roster
       join briar_project_agents agent on agent.id = roster.agent_id
       where roster.channel_id = ?
       order by agent.name, agent.id`,
    )
    .bind(channelId)
    .all<{
      id: string;
      organization_id: string;
      project_id: string | null;
      handle: string | null;
      name: string;
      provider: AgentProvider;
      model: string | null;
      responsibility: string;
      effort: string | null;
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
) {
  const result = await db
    .prepare(
      `delete from briar_channel_agents where channel_id = ? and agent_id = ?`,
    )
    .bind(channelId, agentId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

async function attachMentions(
  db: D1Database,
  rows: ChannelMessageRow[],
): Promise<ChannelMessage[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const [userMentions, agentMentions] = await Promise.all([
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
  ]);
  const byMessage = new Map<string, { users: string[]; agents: string[] }>();
  for (const row of rows) byMessage.set(row.id, { users: [], agents: [] });
  for (const mention of userMentions.results) {
    byMessage.get(mention.message_id)?.users.push(mention.user_id);
  }
  for (const mention of agentMentions.results) {
    byMessage.get(mention.message_id)?.agents.push(mention.agent_id);
  }
  return rows.map((row) =>
    channelMessageJson(row, byMessage.get(row.id) ?? { users: [], agents: [] }),
  );
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
  return attachMentions(db, rows.results.reverse());
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
  return attachMentions(db, rows.results);
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
  const [message] = await attachMentions(db, [row]);
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
  ];
  await db.batch(statements);
  return getChannelMessage(db, input.channelId, input.id);
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
             id, organization_id, channel_id, project_id, agent_id,
             trigger_message_id, parent_message_id, reply_message_id,
             agent_provider, created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict (channel_id, trigger_message_id, agent_id) do nothing`,
        )
        .bind(
          crypto.randomUUID(),
          input.organizationId,
          input.channelId,
          agent.projectId,
          agent.id,
          input.triggerMessageId,
          input.parentMessageId,
          crypto.randomUUID(),
          agent.provider,
          input.createdAt,
          input.createdAt,
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
 * A device may take an organization job on behalf of any agent without a
 * project. A project agent's job additionally requires that this device holds
 * an enabled binding to that project.
 */
export async function claimNextChannelAgentReply(
  db: D1Database,
  organizationId: string,
  input: {
    deviceId: string;
    providers: AgentProvider[];
    claimTokenHash: string;
    claimedAt: string;
    leaseExpiresAt: string;
  },
) {
  await db
    .prepare(
      `update briar_channel_agent_reply_jobs
       set status = 'failed',
           error = coalesce(error, 'Channel reply lease expired repeatedly.'),
           claim_token_hash = null, lease_expires_at = null, updated_at = ?
       where organization_id = ? and status = 'running' and attempts >= ?
         and lease_expires_at <= ?`,
    )
    .bind(input.claimedAt, organizationId, MAX_REPLY_ATTEMPTS, input.claimedAt)
    .run();
  return db
    .prepare(
      `update briar_channel_agent_reply_jobs
       set status = 'running', claimed_device_id = ?, claim_token_hash = ?,
           claimed_at = ?, lease_expires_at = ?, attempts = attempts + 1,
           error = null, updated_at = ?
       where id = (
         select job.id from briar_channel_agent_reply_jobs job
         where job.organization_id = ? and job.attempts < ?
           and (job.status = 'queued'
             or (job.status = 'running' and job.lease_expires_at <= ?))
           and ((job.agent_provider = 'codex' and ? = 1)
             or (job.agent_provider = 'claude' and ? = 1)
             or (job.agent_provider = 'grok' and ? = 1)
             or (job.agent_provider = 'opencode' and ? = 1))
           and (
             job.project_id is null
             or exists (
               select 1 from briar_execution_workers binding
               where binding.device_id = ?
                 and binding.project_id = job.project_id
                 and binding.state <> 'disabled'
             )
           )
         order by job.created_at, job.id limit 1
       ) returning *`,
    )
    .bind(
      input.deviceId,
      input.claimTokenHash,
      input.claimedAt,
      input.leaseExpiresAt,
      input.claimedAt,
      organizationId,
      MAX_REPLY_ATTEMPTS,
      input.claimedAt,
      input.providers.includes("codex") ? 1 : 0,
      input.providers.includes("claude") ? 1 : 0,
      input.providers.includes("grok") ? 1 : 0,
      input.providers.includes("opencode") ? 1 : 0,
      input.deviceId,
    )
    .first<ChannelReplyJobRow>();
}

export async function getClaimedChannelReply(
  db: D1Database,
  jobId: string,
  claimTokenHash: string,
) {
  return db
    .prepare(
      `select * from briar_channel_agent_reply_jobs
       where id = ? and claim_token_hash = ? and status = 'running'`,
    )
    .bind(jobId, claimTokenHash)
    .first<ChannelReplyJobRow>();
}

export async function renewChannelReplyLease(
  db: D1Database,
  input: { jobId: string; claimTokenHash: string; leaseExpiresAt: string },
) {
  return db
    .prepare(
      `update briar_channel_agent_reply_jobs
       set lease_expires_at = ?, updated_at = ?
       where id = ? and claim_token_hash = ? and status = 'running'
       returning *`,
    )
    .bind(
      input.leaseExpiresAt,
      input.leaseExpiresAt,
      input.jobId,
      input.claimTokenHash,
    )
    .first<ChannelReplyJobRow>();
}

export async function failChannelReply(
  db: D1Database,
  input: {
    jobId: string;
    claimTokenHash: string;
    error: string;
    updatedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_channel_agent_reply_jobs
       set status = case when attempts >= ? then 'failed' else 'queued' end,
           error = ?, claim_token_hash = null, lease_expires_at = null,
           updated_at = ?
       where id = ? and claim_token_hash = ? and status = 'running'
       returning *`,
    )
    .bind(
      MAX_REPLY_ATTEMPTS,
      input.error.slice(0, 4000),
      input.updatedAt,
      input.jobId,
      input.claimTokenHash,
    )
    .first<ChannelReplyJobRow>();
}

export type ChannelReplyCompletionInput = {
  jobId: string;
  claimTokenHash: string;
  body: string;
  document: { title: string; markdown: string; projectId: string | null } | null;
  issueProposal: {
    projectId: string | null;
    issue: Record<string, unknown>;
  } | null;
  agentName: string;
  agentProvider: AgentProvider;
  completedAt: string;
};

/**
 * The reply message, its plan document, and its issue proposal land together so
 * a partially applied completion can never be observed.
 */
export async function completeChannelReply(
  db: D1Database,
  job: ChannelReplyJobRow,
  input: ChannelReplyCompletionInput,
) {
  const statements = [
    db
      .prepare(
        `insert into briar_channel_messages (
           id, channel_id, parent_message_id, author_user_id, author_agent_id,
           author_agent_name, author_agent_provider, body, created_at, updated_at
         ) values (?, ?, ?, null, ?, ?, ?, ?, ?, ?)`,
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
      ),
  ];
  let ideaId: string | null = null;
  if (input.document) {
    ideaId = crypto.randomUUID();
    statements.push(
      db
        .prepare(
          `insert into briar_ideas (
             id, organization_id, project_id, author_user_id, title,
             title_is_auto, document_markdown, status, provider, model,
             version, created_at, updated_at
           )
           select ?, ?, ?, channel.created_by_user_id, ?, 0, ?, 'ready', ?,
                  null, 1, ?, ?
           from briar_channels channel where channel.id = ?`,
        )
        .bind(
          ideaId,
          job.organization_id,
          input.document.projectId,
          input.document.title,
          input.document.markdown,
          input.agentProvider,
          input.completedAt,
          input.completedAt,
          job.channel_id,
        ),
      db
        .prepare(
          `insert into briar_channel_message_documents (
             message_id, idea_id, created_at
           ) values (?, ?, ?)`,
        )
        .bind(job.reply_message_id, ideaId, input.completedAt),
    );
  }
  if (input.issueProposal) {
    statements.push(
      db
        .prepare(
          `insert into briar_channel_action_proposals (
             id, channel_id, project_id, trigger_message_id, reply_message_id,
             action_type, payload_json, created_at, updated_at
           ) values (?, ?, ?, ?, ?, 'request_issue_create', ?, ?, ?)
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
        ),
    );
  }
  statements.push(
    db
      .prepare(
        `update briar_channel_agent_reply_jobs
         set status = 'completed', claim_token_hash = null,
             lease_expires_at = null, completed_at = ?, updated_at = ?
         where id = ? and claim_token_hash = ? and status = 'running'`,
      )
      .bind(
        input.completedAt,
        input.completedAt,
        input.jobId,
        input.claimTokenHash,
      ),
  );
  await db.batch(statements);
  return getChannelAgentReplyJob(db, job.organization_id, job.id);
}

export async function getChannelActionProposal(
  db: D1Database,
  channelId: string,
  proposalId: string,
) {
  return db
    .prepare(
      `select * from briar_channel_action_proposals
       where id = ? and channel_id = ?`,
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
      result_run_id: string | null;
      result_idea_id: string | null;
      created_at: string;
      updated_at: string;
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
    acceptedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_channel_action_proposals
       set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
           project_id = ?, result_run_id = ?, updated_at = ?
       where id = ? and channel_id = ? and status = 'pending'
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
    messages: await attachMentions(db, messageRows),
    removedMessageIds,
    agentReplies: agentReplies.map(channelReplyJson),
  };
}
