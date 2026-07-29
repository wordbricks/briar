create table briar_slack_installations (
  team_id text primary key not null check (
    team_id = trim(team_id) and length(team_id) between 1 and 64
  ),
  team_name text not null check (
    team_name = trim(team_name) and length(team_name) between 1 and 200
  ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  default_project_id text
    references briar_projects (id) on delete set null,
  bot_user_id text not null check (
    bot_user_id = trim(bot_user_id) and length(bot_user_id) between 1 and 64
  ),
  encrypted_bot_token text not null,
  token_iv text not null,
  installed_by_user_id text not null references "user" (id) on delete cascade,
  created_at text not null,
  updated_at text not null
);

create index briar_slack_installations_organization_idx
  on briar_slack_installations (organization_id, created_at);

create table briar_slack_oauth_states (
  state_hash text primary key not null check (
    length(state_hash) = 64 and state_hash not glob '*[^0-9a-f]*'
  ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  default_project_id text not null
    references briar_projects (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  expires_at text not null,
  created_at text not null
);

create index briar_slack_oauth_states_expiry_idx
  on briar_slack_oauth_states (expires_at);

create table briar_slack_events (
  team_id text not null,
  event_id text not null,
  status text not null check (status in ('processing', 'completed')),
  claimed_at text not null,
  completed_at text,
  primary key (team_id, event_id)
);

create index briar_slack_events_claimed_idx
  on briar_slack_events (status, claimed_at);
