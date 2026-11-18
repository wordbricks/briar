import { getChannelById, isChannelRootMessage, listChannelMessagePage, type ChannelRow } from "../channels";
import type { AgentWorkspaceScope, ClaimAgent } from "./claim";
import { toolError } from "./errors";
import { onceForRequest, toolRequest } from "./requests";

/*
  `tools channel …` (docs/plans/agent-workspace-tools.md). An agent reads and
  posts in the organization channels whose roster holds it. DMs are never
  listed, read or posted to: a DM belongs to one person's conversation, and the
  agent answers there through its reply.

  A post is a plain agent-authored message: it carries no mentions and enqueues
  no reply job, so it can never start another agent turn. Agent-to-Agent work
  stays on the existing `agentMessage` reply action with its hop and hourly
  limits. Posts have their own per-organization hourly ceiling.
*/

/** Agent channel posts per organization per rolling hour (all agents together). */
export const AGENT_CHANNEL_POST_HOURLY_LIMIT = 30;
const windowMs = 60 * 60 * 1_000;

const maxPostLength = 50_000;
const shownMessageLength = 4_000;
const defaultReadLimit = 20;
const maxReadLimit = 50;

export type AgentChannelSummary = {
  readonly id: string;
  readonly name: string;
  readonly topic: string | null;
  readonly current: boolean;
};

export type AgentChannelMessage = {
  readonly id: string;
  readonly parentMessageId: string | null;
  readonly authorName: string;
  readonly authorIsAgent: boolean;
  readonly body: string;
  readonly createdAt: string;
};

const clip = (text: string, length: number) => text.length > length ? `${text.slice(0, length)}…` : text;

const requireAgent = (scope: AgentWorkspaceScope): ClaimAgent => {
  if (!scope.agent) {
    throw toolError("no_agent", "This run has no assigned Agent, so it is not a member of any channel");
  }
  return scope.agent;
};

const summary = (scope: AgentWorkspaceScope, channel: Pick<ChannelRow, "id" | "name" | "topic">): AgentChannelSummary => ({
  id: channel.id,
  name: channel.name,
  topic: channel.topic,
  current: channel.id === scope.replyChannelId,
});

type MemberChannelRow = { id: string; name: string; slug: string; topic: string | null };

export async function listAgentChannels(db: D1Database, scope: AgentWorkspaceScope) {
  const agent = requireAgent(scope);
  const rows = await db.prepare(`select channel.id, channel.name, channel.slug, channel.topic
    from briar_channels channel
    join briar_channel_agents roster on roster.channel_id = channel.id and roster.agent_id = ?
    where channel.organization_id = ? and channel.kind = 'channel' and channel.archived_at is null
    order by lower(channel.name), channel.id`)
    .bind(agent.id, scope.organizationId).all<MemberChannelRow>();
  return { channels: rows.results.map((row) => summary(scope, row)) };
}

/** A non-DM, unarchived channel of the claim's organization whose roster holds the claim's Agent. */
async function resolveMemberChannel(db: D1Database, scope: AgentWorkspaceScope, reference: string): Promise<ChannelRow> {
  const agent = requireAgent(scope);
  const text = reference.trim().replace(/^#/u, "");
  const byId = await getChannelById(db, scope.organizationId, text);
  const channelId = byId?.id ?? (await db.prepare(`select id from briar_channels
      where organization_id = ? and kind = 'channel' and (slug = ? or lower(name) = lower(?))
      order by archived_at is not null, created_at limit 1`)
    .bind(scope.organizationId, text, text).first<{ id: string }>())?.id;
  const channel = byId ?? (channelId === undefined ? null : await getChannelById(db, scope.organizationId, channelId));
  if (!channel) throw toolError("not_found", `No channel "${clip(text, 80)}" in this organization`);
  if (channel.kind !== "channel") throw toolError("not_allowed", "Direct messages are not available to workspace tools");
  if (channel.archived_at !== null) throw toolError("not_allowed", "The channel is archived");
  const member = await db.prepare(`select 1 as present from briar_channel_agents where channel_id = ? and agent_id = ?`)
    .bind(channel.id, agent.id).first<{ present: number }>();
  if (!member) throw toolError("not_allowed", `${agent.name} is not a member of #${channel.name}`);
  return channel;
}

export async function readAgentChannel(db: D1Database, scope: AgentWorkspaceScope, input: {
  readonly channel: string;
  readonly thread: string | null;
  readonly cursor: string | null;
  readonly limit: number | null;
}) {
  const channel = await resolveMemberChannel(db, scope, input.channel);
  const limit = input.limit ?? defaultReadLimit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxReadLimit) {
    throw toolError("invalid_request", `--limit must be between 1 and ${maxReadLimit}`);
  }
  if (input.thread !== null && !await isChannelRootMessage(db, channel.id, input.thread)) {
    throw toolError("not_found", "No such thread in this channel");
  }
  const page = await listChannelMessagePage(db, {
    channelId: channel.id,
    parentMessageId: input.thread,
    cursor: input.cursor,
    limit,
  });
  if (!page) throw toolError("invalid_request", "The cursor is not one this tool returned");
  return {
    channel: summary(scope, channel),
    messages: page.messages.map((message): AgentChannelMessage => ({
      id: message.id,
      parentMessageId: message.parentMessageId,
      authorName: message.author.name,
      authorIsAgent: message.author.type === "agent",
      body: clip(message.body, shownMessageLength),
      createdAt: message.createdAt,
    })),
    nextCursor: page.nextCursor,
  };
}

export async function postAgentChannelMessage(db: D1Database, scope: AgentWorkspaceScope, input: {
  readonly requestKey: string;
  readonly channel: string;
  readonly thread: string | null;
  readonly body: string;
}, options: { readonly hourlyLimit?: number; readonly now?: () => Date } = {}) {
  const agent = requireAgent(scope);
  const channel = await resolveMemberChannel(db, scope, input.channel);
  if (channel.id === scope.replyChannelId) {
    throw toolError("not_allowed", "This is the channel you are replying in; put this in your reply instead");
  }
  const body = input.body.trim();
  if (body.length < 1 || body.length > maxPostLength) {
    throw toolError("invalid_request", `The message must be 1-${maxPostLength} characters`);
  }
  if (input.thread !== null && !await isChannelRootMessage(db, channel.id, input.thread)) {
    throw toolError("not_found", "No such thread in this channel; reply to a thread's root message");
  }
  const request = await toolRequest(scope, "channel.post", input.requestKey,
    { channelId: channel.id, thread: input.thread, body });
  const hourlyLimit = options.hourlyLimit ?? AGENT_CHANNEL_POST_HOURLY_LIMIT;
  const { result, replayed } = await onceForRequest<{ messageId: string; channelId: string }>(db, request, async () => {
    const stored = { messageId: crypto.randomUUID(), channelId: channel.id };
    const now = (options.now ?? (() => new Date()))();
    const createdAt = now.toISOString();
    const windowStart = new Date(now.getTime() - windowMs).toISOString();
    // The request rows are the rate-limit counter. The message is inserted
    // only under the ceiling, and its request row only when the message was.
    const [posted] = await db.batch([
      db.prepare(`insert into briar_channel_messages (
          id, channel_id, parent_message_id, author_user_id, author_agent_id, author_agent_name,
          author_agent_provider, body, created_at, updated_at)
        select ?, channel.id, ?, null, ?, ?, ?, ?, ?, ?
        from briar_channels channel
        join briar_channel_agents roster on roster.channel_id = channel.id and roster.agent_id = ?
        where channel.id = ? and channel.organization_id = ? and channel.kind = 'channel'
          and channel.archived_at is null
          and (? is null or exists (select 1 from briar_channel_messages root
            where root.id = ? and root.channel_id = channel.id and root.parent_message_id is null))
          and (select count(*) from briar_agent_workspace_tool_requests
            where organization_id = ? and operation = 'channel.post' and created_at > ?) < ?
        returning id`)
        .bind(stored.messageId, input.thread, agent.id, agent.name, scope.provider, body, createdAt, createdAt,
          agent.id, channel.id, scope.organizationId, input.thread, input.thread,
          scope.organizationId, windowStart, hourlyLimit),
      db.prepare(`insert into briar_agent_workspace_tool_requests (
          organization_id, work_id, request_key, operation, payload_hash, agent_id, result_json, created_at)
        select ?, ?, ?, 'channel.post', ?, ?, ?, ?
        where exists (select 1 from briar_channel_messages where id = ?)`)
        .bind(scope.organizationId, scope.workId, input.requestKey, request.payloadHash, agent.id,
          JSON.stringify(stored), createdAt, stored.messageId),
    ]);
    if ((posted?.results.length ?? 0) !== 1) {
      const recent = await db.prepare(`select count(*) as posts from briar_agent_workspace_tool_requests
        where organization_id = ? and operation = 'channel.post' and created_at > ?`)
        .bind(scope.organizationId, windowStart).first<{ posts: number }>();
      if ((recent?.posts ?? 0) >= hourlyLimit) {
        throw toolError("rate_limited",
          `Agents in this organization have posted ${hourlyLimit} channel messages in the last hour; try again later or put it in your reply`);
      }
      throw toolError("conflict", "The channel or thread changed while posting; read it again");
    }
    return stored;
  });
  const current = await getChannelById(db, scope.organizationId, result.channelId);
  if (!current) throw toolError("not_found", "The channel no longer exists");
  return { messageId: result.messageId, channel: summary(scope, current), replayed };
}
