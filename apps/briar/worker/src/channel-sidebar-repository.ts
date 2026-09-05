/*
  The user-owned half of a conversation row: whether it is pinned, which of the
  member's own sections it sits in, and whether it is hidden from the list.

  It is stored per (user, channel) rather than on the channel because two people
  in the same DM arrange their sidebars independently, and it is stored on the
  server rather than in the browser so a reinstall keeps it and a second device
  agrees with the first.

  The change feed is written here in TypeScript instead of by a trigger on these
  tables. `briar_channel_changes` is trigger-written everywhere else, but
  workerd caps SQLite's trigger nesting at ten *statically reachable* levels
  (see migration 0184), and both tables sit under cascades that already run
  deep: `on delete cascade` from a channel, and the `on delete set null` a
  section deletion performs. Writing the two rows explicitly keeps the cascade
  depth exactly where it was while still advancing the organization's cursor,
  which is what makes another device refetch the summary.
*/

export type ChannelSidebarSectionRow = {
  id: string;
  organization_id: string;
  user_id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
};

export type ChannelSidebarSection = {
  id: string;
  organizationId: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export const channelSidebarSectionJson = (
  row: ChannelSidebarSectionRow,
): ChannelSidebarSection => ({
  id: row.id,
  organizationId: row.organization_id,
  name: row.name,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * Records that one channel's summary changed and moves the organization's
 * channel cursor forward, so `SyncChannels` hands the channel back to every
 * device that asks. `version` is the change table's autoincrement id, and the
 * greatest one an organization has is exactly what `last_insert_rowid()` gives
 * the triggers that do this in SQL.
 */
export async function recordChannelSummaryChange(
  db: D1Database,
  organizationId: string,
  channelId: string,
): Promise<void> {
  await db
    .prepare(
      `insert into briar_channel_changes (
         organization_id, channel_id, entity_type, entity_id, operation,
         created_at
       ) values (?, ?, 'channel', ?, 'upsert', datetime('now'))`,
    )
    .bind(organizationId, channelId, channelId)
    .run();
  await db
    .prepare(
      `insert into briar_channel_sync_state (organization_id, current_version)
       select ?, coalesce(max(version), 0) from briar_channel_changes
       where organization_id = ?
       on conflict (organization_id) do update
         set current_version = excluded.current_version`,
    )
    .bind(organizationId, organizationId)
    .run();
}

export async function listChannelSidebarSections(
  db: D1Database,
  organizationId: string,
  userId: string,
) {
  const rows = await db
    .prepare(
      `select id, organization_id, user_id, name, position, created_at,
              updated_at
       from briar_channel_sidebar_sections
       where organization_id = ? and user_id = ?
       order by position, created_at, id`,
    )
    .bind(organizationId, userId)
    .all<ChannelSidebarSectionRow>();
  return rows.results;
}

export async function getChannelSidebarSection(
  db: D1Database,
  organizationId: string,
  userId: string,
  sectionId: string,
) {
  return db
    .prepare(
      `select id, organization_id, user_id, name, position, created_at,
              updated_at
       from briar_channel_sidebar_sections
       where id = ? and organization_id = ? and user_id = ?`,
    )
    .bind(sectionId, organizationId, userId)
    .first<ChannelSidebarSectionRow>();
}

export async function createChannelSidebarSection(
  db: D1Database,
  input: {
    id: string;
    organizationId: string;
    userId: string;
    name: string;
    createdAt: string;
  },
) {
  return db
    .prepare(
      `insert into briar_channel_sidebar_sections (
         id, organization_id, user_id, name, position, created_at, updated_at
       )
       select ?, ?, ?, ?,
              coalesce((
                select max(existing.position) + 1
                from briar_channel_sidebar_sections existing
                where existing.organization_id = ? and existing.user_id = ?
              ), 0),
              ?, ?
       returning id, organization_id, user_id, name, position, created_at,
                 updated_at`,
    )
    .bind(
      input.id,
      input.organizationId,
      input.userId,
      input.name,
      input.organizationId,
      input.userId,
      input.createdAt,
      input.createdAt,
    )
    .first<ChannelSidebarSectionRow>();
}

export async function renameChannelSidebarSection(
  db: D1Database,
  input: {
    sectionId: string;
    organizationId: string;
    userId: string;
    name: string;
    updatedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_channel_sidebar_sections
       set name = ?, updated_at = ?
       where id = ? and organization_id = ? and user_id = ?
       returning id, organization_id, user_id, name, position, created_at,
                 updated_at`,
    )
    .bind(
      input.name,
      input.updatedAt,
      input.sectionId,
      input.organizationId,
      input.userId,
    )
    .first<ChannelSidebarSectionRow>();
}

/**
 * Deletes one section. The conversations filed in it fall back to Unassigned
 * through the preference table's `on delete set null`; the channel ids are
 * returned so the caller can record a change for each one.
 */
export async function deleteChannelSidebarSection(
  db: D1Database,
  input: { sectionId: string; organizationId: string; userId: string },
) {
  const affected = await db
    .prepare(
      `select channel_id from briar_channel_sidebar_preferences
       where user_id = ? and section_id = ?`,
    )
    .bind(input.userId, input.sectionId)
    .all<{ channel_id: string }>();
  const deleted = await db
    .prepare(
      `delete from briar_channel_sidebar_sections
       where id = ? and organization_id = ? and user_id = ?
       returning id`,
    )
    .bind(input.sectionId, input.organizationId, input.userId)
    .first<{ id: string }>();
  return {
    deleted: deleted !== null,
    channelIds: affected.results.map((row) => row.channel_id),
  };
}

export type ChannelSidebarPreferenceUpdate = {
  readonly pinned?: boolean;
  readonly hidden?: boolean;
  readonly section?: { readonly case: "clear" } | {
    readonly case: "set";
    readonly sectionId: string;
  };
};

/**
 * Writes the fields the menu action actually changed and leaves the rest of the
 * row alone. `pinned_at` and `hidden_at` are timestamps rather than flags so the
 * pinned group can order by when the pin happened.
 */
export async function upsertChannelSidebarPreference(
  db: D1Database,
  input: {
    userId: string;
    channelId: string;
    update: ChannelSidebarPreferenceUpdate;
    now: string;
  },
) {
  const { update } = input;
  const pinnedAt = update.pinned === undefined
    ? null
    : update.pinned
    ? input.now
    : null;
  const hiddenAt = update.hidden === undefined
    ? null
    : update.hidden
    ? input.now
    : null;
  const sectionId = update.section === undefined || update.section.case === "clear"
    ? null
    : update.section.sectionId;
  await db
    .prepare(
      `insert into briar_channel_sidebar_preferences (
         user_id, channel_id, pinned_at, section_id, hidden_at, updated_at
       ) values (?, ?, ?, ?, ?, ?)
       on conflict (user_id, channel_id) do update set
         pinned_at = case when ?
           then excluded.pinned_at
           else briar_channel_sidebar_preferences.pinned_at end,
         section_id = case when ?
           then excluded.section_id
           else briar_channel_sidebar_preferences.section_id end,
         hidden_at = case when ?
           then excluded.hidden_at
           else briar_channel_sidebar_preferences.hidden_at end,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.userId,
      input.channelId,
      pinnedAt,
      sectionId,
      hiddenAt,
      input.now,
      update.pinned === undefined ? 0 : 1,
      update.section === undefined ? 0 : 1,
      update.hidden === undefined ? 0 : 1,
    )
    .run();
}

/**
 * Makes a conversation unread again by dropping the caller's read state. The
 * summary computes `has_unread` from "is there a message by somebody else newer
 * than my last read", so with no read state every such conversation is unread
 * and stays that way until the next `MarkChannelRead`.
 *
 * A conversation nobody else has written in has no such message, so it cannot
 * be made unread; the caller returns it untouched.
 */
export async function clearChannelReadState(
  db: D1Database,
  input: { userId: string; channelId: string },
): Promise<void> {
  await db
    .prepare(
      `delete from briar_channel_read_states
       where user_id = ? and channel_id = ?`,
    )
    .bind(input.userId, input.channelId)
    .run();
}

/** The newest message in the channel written by anybody but this user. */
export async function latestForeignChannelMessageAt(
  db: D1Database,
  input: { userId: string; channelId: string },
) {
  const row = await db
    .prepare(
      `select max(created_at) as created_at from briar_channel_messages
       where channel_id = ? and ifnull(author_user_id, '') != ?`,
    )
    .bind(input.channelId, input.userId)
    .first<{ created_at: string | null }>();
  return row?.created_at ?? null;
}
