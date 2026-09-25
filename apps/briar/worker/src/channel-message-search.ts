import { HttpError } from "./http-response";
import { requireChannelAccess } from "./channel-route-access";
import { agentAnswerCopySql, readableByUser } from "./channels";
import { getWorkspaceRole } from "./workspace-repository";
import { hasWorkspaceCapability } from "./workspace-access";

export interface ChannelMessageSearchHit {
  messageId: string;
  channelId: string;
  rootMessageId: string;
  channelName: string;
  isDirectMessage: boolean;
  isThreadReply: boolean;
  authorName: string;
  body: string;
  createdAt: string;
}

type SearchRow = {
  id: string;
  channel_id: string;
  root_message_id: string;
  channel_name: string;
  kind: string;
  author_name: string;
  body: string;
  created_at: string;
};

/** Two-code-point queries use the bigram index; longer queries use FTS5 trigram. */
export async function searchWorkspaceChannelMessages(input: {
  db: D1Database;
  workspaceId: string;
  userId: string;
  channelId?: string | null;
  kind?: "channel" | "dm" | null;
  query: string;
  cursor?: string | null;
  limit?: number;
}): Promise<{ hits: ChannelMessageSearchHit[]; nextCursor: string | null }> {
  const query = input.query.trim();
  const limit = input.limit ?? 25;
  if (input.kind && input.kind !== "channel" && input.kind !== "dm") {
    throw new HttpError(400, "Invalid conversation kind");
  }
  if ([...query].length < 2 || query.length > 200 || /[\u0000-\u001f]/u.test(query)) {
    throw new HttpError(400, "Search needs 2 to 200 characters");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new HttpError(400, "Search limit must be 1 to 50");
  }
  const isBigram = [...query].length === 2;
  const bigram = query.toLowerCase();
  const escapedQuery = `"${query.replaceAll('"', '""')}"`;
  const matchingRows = isBigram
    ? "select message_rowid from briar_channel_message_bigrams where gram = ?"
    : "select rowid from briar_channel_message_search where briar_channel_message_search match ?";
  const relevance = "case when instr(lower(message.body), lower(?)) = 1 then 0 else 1 end";

  const role = await getWorkspaceRole(input.db, input.workspaceId, input.userId);
  if (!hasWorkspaceCapability(role, "workspace:read")) {
    throw new HttpError(404, "Workspace not found");
  }
  if (input.channelId) {
    await requireChannelAccess(input.db, input.workspaceId, input.channelId, input.userId);
  }
  // A cursor identifies an exact visible message in this workspace and scope.
  // Never accept a caller-supplied timestamp without checking its origin.
  let cursor: { created_at: string; id: string; rank: number } | null = null;
  if (input.cursor) {
    cursor = await input.db.prepare(`
      select message.created_at, message.id,
        ${relevance} as rank
      from briar_channel_messages message
      join briar_channels channel on channel.id = message.channel_id
      where message.id = ? and channel.organization_id = ?
        and (? is null or channel.id = ?)
        and (? is null or channel.kind = ?)
        and ${readableByUser}
        and message.deleted_at is null
        and not ${agentAnswerCopySql("message")}
        and message.rowid in (${matchingRows})
        and instr(lower(message.body), lower(?)) > 0
    `).bind(query, input.cursor, input.workspaceId,
      input.channelId ?? null, input.channelId ?? null,
      input.kind ?? null, input.kind ?? null,
      input.userId, input.userId,
      isBigram ? bigram : escapedQuery, query,
    ).first<{ created_at: string; id: string; rank: number }>();
    if (!cursor) throw new HttpError(400, "Invalid search cursor");
  }
  // FTS narrows the candidate set; the canonical message and current channel
  // ACL are joined again at query time. Never return a deleted message, a DM
  // outside its membership, or an Agent reply copy.
  const rows = await input.db.prepare(`
    select message.id, message.channel_id,
           coalesce(message.parent_message_id, message.id) as root_message_id,
           channel.name as channel_name, channel.kind, message.body,
           coalesce(author.name, message.author_agent_name, message.author_webhook_name, 'Agent') as author_name,
           message.created_at,
           ${relevance} as rank
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    left join "user" author on author.id = message.author_user_id
    where message.rowid in (${matchingRows})
      and instr(lower(message.body), lower(?)) > 0
      and channel.organization_id = ?
      and (? is null or channel.id = ?)
      and (? is null or channel.kind = ?)
      and ${readableByUser}
      and message.deleted_at is null
      and not ${agentAnswerCopySql("message")}
      and (? is null or ${relevance} > ?
        or (${relevance} = ? and message.created_at < ?)
        or (${relevance} = ? and message.created_at = ? and message.id < ?))
    order by rank asc, message.created_at desc, message.id desc
    limit ?
  `).bind(query, isBigram ? bigram : escapedQuery, query, input.workspaceId,
    input.channelId ?? null, input.channelId ?? null,
    input.kind ?? null, input.kind ?? null,
    input.userId, input.userId,
    cursor?.rank ?? null,
    query, cursor?.rank ?? null,
    query, cursor?.rank ?? null, cursor?.created_at ?? null,
    query, cursor?.rank ?? null, cursor?.created_at ?? null, cursor?.id ?? null,
    limit + 1,
  ).all<SearchRow>();
  const page = rows.results.slice(0, limit);
  return {
    hits: page.map((row) => ({
      messageId: row.id,
      channelId: row.channel_id,
      rootMessageId: row.root_message_id,
      channelName: row.channel_name,
      isDirectMessage: row.kind === "dm",
      isThreadReply: row.root_message_id !== row.id,
      authorName: row.author_name,
      body: row.body,
      createdAt: row.created_at,
    })),
    nextCursor: rows.results.length > limit ? page.at(-1)?.id ?? null : null,
  };
}
