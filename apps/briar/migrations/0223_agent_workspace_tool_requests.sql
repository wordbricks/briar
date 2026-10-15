-- Agent workspace tools (docs/plans/agent-workspace-tools.md).
--
-- New table only: no table rebuild, no backfill, no existing row touched.
-- Rows written by this migration: 0.
--
-- One row per write an agent made through `tools issue …` / `tools channel …`.
-- It is the idempotency record (a repeated request key returns the stored
-- result) and, for channel posts, the per-organization hourly rate-limit
-- counter. `operation` names a tool command; it is free text with a length
-- bound, never a CHECK list, so a new tool is not a schema change.
create table briar_agent_workspace_tool_requests (
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  work_id text not null check (length(work_id) between 1 and 200),
  request_key text not null check (length(request_key) between 1 and 128),
  operation text not null check (length(operation) between 1 and 32),
  payload_hash text not null
    check (length(payload_hash) = 64 and payload_hash not glob '*[^0-9a-f]*'),
  agent_id text references briar_project_agents (id) on delete set null,
  result_json text not null check (json_valid(result_json)),
  created_at text not null,
  primary key (organization_id, work_id, request_key)
) strict;

create index briar_agent_workspace_tool_requests_channel_post_rate
on briar_agent_workspace_tool_requests (organization_id, created_at)
where operation = 'channel.post';
