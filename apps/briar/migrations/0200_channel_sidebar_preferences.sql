-- Where a conversation sits in the sidebar belongs to the member looking at
-- it, not to the channel: two people in the same DM pin it, file it and hide it
-- independently. Both tables are therefore keyed by user, and the catalog query
-- joins the requesting user's row into their own ChannelSummary, the same way
-- briar_channel_read_states already carries their unread state.
--
-- Sections are per (user, organization) rather than per channel so an empty one
-- survives until its owner deletes it. A conversation filed in a section that
-- is deleted falls back to Unassigned, which is what "on delete set null" says.
create table briar_channel_sidebar_sections (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  position integer not null,
  created_at text not null,
  updated_at text not null
);

create index briar_channel_sidebar_sections_user_idx
  on briar_channel_sidebar_sections (user_id, organization_id, position);

create table briar_channel_sidebar_preferences (
  user_id text not null references "user" (id) on delete cascade,
  channel_id text not null references briar_channels (id) on delete cascade,
  pinned_at text,
  section_id text
    references briar_channel_sidebar_sections (id) on delete set null,
  hidden_at text,
  updated_at text not null,
  primary key (user_id, channel_id)
);

-- Deleting a channel cascades through this table, and the catalog query joins
-- it by channel for the requesting user.
create index briar_channel_sidebar_preferences_channel_idx
  on briar_channel_sidebar_preferences (channel_id);

create index briar_channel_sidebar_preferences_section_idx
  on briar_channel_sidebar_preferences (section_id);
