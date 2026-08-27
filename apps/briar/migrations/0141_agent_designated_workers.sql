-- Pin new channel reply sessions to an explicitly selected project Worker.
-- The Worker reference is restrictive so normal Worker deletion cannot
-- silently turn an Agent back into automatic placement.
alter table briar_project_agents add column designated_worker_id text
  references briar_execution_workers (id) on delete restrict;

-- Keep the user-facing name durable for unavailable and deletion errors.
alter table briar_project_agents add column designated_worker_label text
  check (
    designated_worker_label is null
    or length(trim(designated_worker_label)) between 1 and 100
  );

create index briar_project_agents_designated_worker_idx
  on briar_project_agents (designated_worker_id, project_id);

-- Session ownership outlives Agent setting changes. The label lets the server
-- explain which retained execution environment is unavailable.
alter table briar_channel_reply_sessions add column owner_worker_label text
  check (
    owner_worker_label is null
    or length(trim(owner_worker_label)) between 1 and 100
  );

update briar_channel_reply_sessions
set owner_worker_label = (
  select worker.label
  from briar_execution_workers worker
  where worker.id = briar_channel_reply_sessions.owner_worker_id
)
where owner_worker_id is not null;
