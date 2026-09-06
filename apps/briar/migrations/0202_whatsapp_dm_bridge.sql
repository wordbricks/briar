create table briar_whatsapp_connections (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  agent_id text not null
    references briar_project_agents (id) on delete restrict,
  phone_number_id text not null check (
    length(phone_number_id) between 1 and 64
    and phone_number_id not glob '*[^0-9]*'
  ),
  waba_id text not null check (
    length(waba_id) between 1 and 64
    and waba_id not glob '*[^0-9]*'
  ),
  encrypted_access_token text not null check (
    length(encrypted_access_token) between 1 and 10000
  ),
  token_iv text not null check (length(token_iv) between 16 and 32),
  verify_token_hash text not null check (
    length(verify_token_hash) = 64
    and verify_token_hash not glob '*[^0-9a-f]*'
  ),
  connected_by_user_id text references "user" (id) on delete set null,
  status text not null check (status in ('connected', 'disconnected')),
  connected_at text not null,
  disconnected_at text,
  updated_at text not null,
  check (
    (status = 'connected' and disconnected_at is null)
    or (status = 'disconnected' and disconnected_at is not null)
  )
);

create unique index briar_whatsapp_connections_active_organization_idx
  on briar_whatsapp_connections (organization_id)
  where status = 'connected';

create unique index briar_whatsapp_connections_active_phone_idx
  on briar_whatsapp_connections (phone_number_id)
  where status = 'connected';

create unique index briar_whatsapp_connections_active_verify_token_idx
  on briar_whatsapp_connections (verify_token_hash)
  where status = 'connected';

create trigger briar_whatsapp_connections_agent_insert
before insert on briar_whatsapp_connections
begin
  select case when not exists (
    select 1 from briar_project_agents agent
    where agent.id = new.agent_id
      and agent.organization_id = new.organization_id
      and agent.project_id is null
  ) then raise(abort, 'WhatsApp representative must be an Organization Agent') end;
end;

create trigger briar_whatsapp_connections_agent_update
before update of organization_id, agent_id on briar_whatsapp_connections
begin
  select case when not exists (
    select 1 from briar_project_agents agent
    where agent.id = new.agent_id
      and agent.organization_id = new.organization_id
      and agent.project_id is null
  ) then raise(abort, 'WhatsApp representative must be an Organization Agent') end;
end;

create table briar_whatsapp_user_links (
  id text primary key not null,
  connection_id text not null
    references briar_whatsapp_connections (id) on delete cascade,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  phone_number text not null check (
    length(phone_number) between 8 and 20
    and phone_number not glob '*[^0-9]*'
  ),
  created_by_user_id text references "user" (id) on delete set null,
  last_inbound_at text,
  created_at text not null,
  updated_at text not null,
  unique (connection_id, user_id),
  unique (connection_id, phone_number)
);

create index briar_whatsapp_user_links_organization_idx
  on briar_whatsapp_user_links (organization_id, user_id);

create trigger briar_whatsapp_user_links_scope_insert
before insert on briar_whatsapp_user_links
begin
  select case when not exists (
    select 1 from briar_whatsapp_connections connection
    where connection.id = new.connection_id
      and connection.organization_id = new.organization_id
      and connection.status = 'connected'
  ) then raise(abort, 'WhatsApp link must use the active organization connection') end;
  select case when not exists (
    select 1 from briar_organization_members member
    where member.organization_id = new.organization_id
      and member.user_id = new.user_id
  ) then raise(abort, 'WhatsApp link user must be an organization member') end;
end;

create trigger briar_whatsapp_user_links_scope_update
before update of connection_id, organization_id, user_id
on briar_whatsapp_user_links
begin
  select case when not exists (
    select 1 from briar_whatsapp_connections connection
    where connection.id = new.connection_id
      and connection.organization_id = new.organization_id
      and connection.status = 'connected'
  ) then raise(abort, 'WhatsApp link must use the active organization connection') end;
  select case when not exists (
    select 1 from briar_organization_members member
    where member.organization_id = new.organization_id
      and member.user_id = new.user_id
  ) then raise(abort, 'WhatsApp link user must be an organization member') end;
end;

create table briar_whatsapp_events (
  connection_id text not null
    references briar_whatsapp_connections (id) on delete cascade,
  wamid text not null check (length(wamid) between 1 and 500),
  message_id text not null unique,
  sender_phone text not null check (
    length(sender_phone) between 8 and 20
    and sender_phone not glob '*[^0-9]*'
  ),
  status text not null check (status in ('processing', 'completed')),
  observed_at text not null,
  claimed_at text not null,
  completed_at text,
  primary key (connection_id, wamid),
  check (
    (status = 'processing' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  )
);

create index briar_whatsapp_events_claim_idx
  on briar_whatsapp_events (status, claimed_at);

create table briar_whatsapp_outbox (
  id text primary key not null,
  connection_id text not null
    references briar_whatsapp_connections (id) on delete cascade,
  channel_message_id text
    references briar_channel_messages (id) on delete cascade,
  source_wamid text,
  part_index integer not null check (part_index >= 0),
  part_count integer not null check (part_count > 0),
  recipient_phone text not null check (
    length(recipient_phone) between 8 and 20
    and recipient_phone not glob '*[^0-9]*'
  ),
  body text not null check (length(body) between 1 and 4096),
  last_customer_message_at text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'dead_letter')),
  next_attempt_at text not null,
  attempts integer not null default 0 check (attempts >= 0),
  claim_token text,
  claimed_at text,
  last_attempt_at text,
  last_error text check (last_error is null or length(last_error) <= 1000),
  dead_lettered_at text,
  dead_letter_reason text check (
    dead_letter_reason is null or length(dead_letter_reason) <= 1000
  ),
  created_at text not null,
  updated_at text not null,
  check (part_index < part_count),
  check (
    (status = 'pending' and claim_token is null and claimed_at is null
      and dead_lettered_at is null and dead_letter_reason is null)
    or (status = 'processing' and claim_token is not null and claimed_at is not null
      and dead_lettered_at is null and dead_letter_reason is null)
    or (status = 'dead_letter' and claim_token is null and claimed_at is null
      and dead_lettered_at is not null and dead_letter_reason is not null)
  ),
  check (
    (channel_message_id is not null and source_wamid is null)
    or (channel_message_id is null and source_wamid is not null)
  )
);

create unique index briar_whatsapp_outbox_message_part_idx
  on briar_whatsapp_outbox (channel_message_id, part_index)
  where channel_message_id is not null;

create unique index briar_whatsapp_outbox_event_part_idx
  on briar_whatsapp_outbox (connection_id, source_wamid, part_index)
  where source_wamid is not null;

create index briar_whatsapp_outbox_due_idx
  on briar_whatsapp_outbox (status, next_attempt_at, created_at, id);
