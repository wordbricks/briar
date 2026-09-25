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
  body: string;
  createdAt: string;
}

type SearchRow = {
  id: string;
  channel_id: string;
  root_message_id: string;
  channel_name: string;
  kind: string;
  body: string;
  created_at: string;
};

/** FTS5 trigram queries need three consecutive code points, including Hangul. */
export async function searchWorkspaceChannelMessages(input: {
  db: D1Database;
  workspaceId: string;
  userId: string;
  channelId?: string | null;
  query: string;
  cursor?: string | null;
  limit?: number;
}): Promise<{ hits: ChannelMessageSearchHit[]; nextCursor: string | null }> {
  const query = input.query.trim();
  const limit = input.limit ?? 25;
  if ([...query].length < 3 || query.length > 200 || /[\u0000-\u001f]/u.test(query)) {
    throw new HttpError(400, "Search needs 3 to 200 characters");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new HttpError(400, "Search limit must be 1 to 50");
  }
  const role = await getWorkspaceRole(input.db, input.workspaceId, input.userId);
  if (!hasWorkspaceCapability(role, "workspace:read")) {
    throw new HttpError(404, "Workspace not found");
  }
  if (input.channelId) {
    await requireChannelAccess(input.db, input.workspaceId, input.channelId, input.userId);
  }
  // A cursor identifies an exact visible message in this workspace and scope.
  // Never accept a caller-supplied timestamp without checking its origin.
  let cursor: { created_at: string; id: string } | null = null;
  if (input.cursor) {
    cursor = await input.db.prepare(`
      select message.created_at, message.id
      from briar_channel_messages message
      join briar_channels channel on channel.id = message.channel_id
      where message.id = ? and channel.organization_id = ?
        and (? is null or channel.id = ?)
        and ${readableByUser}
        and message.deleted_at is null
        and not ${agentAnswerCopySql("message")}
        and message.rowid in (select rowid from briar_channel_message_search
          where briar_channel_message_search match ?)
    `).bind(input.cursor, input.workspaceId,
      input.channelId ?? null, input.channelId ?? null,
      input.userId, input.userId,
      `"${query.replaceAll('"', '""')}"`,
    ).first<{ created_at: string; id: string }>();
    if (!cursor) throw new HttpError(400, "Invalid search cursor");
  }
  // FTS narrows the candidate set; the canonical message and current channel
  // ACL are joined again at query time. Never return a deleted message, a DM
  // outside its membership, or an Agent reply copy.
  const rows = await input.db.prepare(`
    select message.id, message.channel_id,
           coalesce(message.parent_message_id, message.id) as root_message_id,
           channel.name as channel_name, channel.kind, message.body,
           message.created_at
    from briar_channel_message_search search_index
    join briar_channel_messages message on message.rowid = search_index.rowid
    join briar_channels channel on channel.id = message.channel_id
    where briar_channel_message_search match ?
      and channel.organization_id = ?
      and (? is null or channel.id = ?)
      and ${readableByUser}
      and message.deleted_at is null
      and not ${agentAnswerCopySql("message")}
      and (? is null or message.created_at < ?
        or (message.created_at = ? and message.id < ?))
    order by message.created_at desc, message.id desc
    limit ?
  `).bind(`"${query.replaceAll('"', '""')}"`, input.workspaceId,
    input.channelId ?? null, input.channelId ?? null,
    input.userId, input.userId,
    cursor?.created_at ?? null, cursor?.created_at ?? null,
    cursor?.created_at ?? null, cursor?.id ?? null, limit + 1,
  ).all<SearchRow>();
  const page = rows.results.slice(0, limit);
  return {
    hits: page.map((row) => ({
      messageId: row.id,
      channelId: row.channel_id,
      rootMessageId: row.root_message_id,
      channelName: row.channel_name,
      isDirectMessage: row.kind === "dm",
      body: row.body,
      createdAt: row.created_at,
    })),
    nextCursor: rows.results.length > limit ? page.at(-1)?.id ?? null : null,
  };
}
