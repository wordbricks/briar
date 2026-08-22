-- Keep every detached execution claim as immutable provenance for usage.
-- `current_attempt` tracks workflow retries while `claim_attempts` tracks
-- worker lease/claim attempts, so both values are recorded.
create table briar_run_execution_attempts (
  id text primary key not null check (
    length(id) = 36
    and substr(id, 9, 1) = '-'
    and substr(id, 14, 1) = '-'
    and substr(id, 19, 1) = '-'
    and substr(id, 24, 1) = '-'
  ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  -- Immutable project snapshot. Do not cascade from the source project: a
  -- transferred run can outlive that project while retaining its provenance.
  project_id text not null,
  run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  run_attempt integer not null check (run_attempt > 0),
  claim_attempt integer not null check (claim_attempt > 0),
  worker_id text,
  claimed_by text,
  claimed_at text not null,
  recorded_at text not null
);

create index briar_run_execution_attempts_org_claimed_idx
  on briar_run_execution_attempts (
    organization_id, claimed_at desc, run_id, claim_attempt
  );

create index briar_run_execution_attempts_worker_idx
  on briar_run_execution_attempts (worker_id, project_id, id);

create index briar_run_execution_attempts_run_idx
  on briar_run_execution_attempts (run_id, organization_id, claimed_at);

alter table briar_hunt_runs add column last_execution_id text;

-- Rows are already reduced to chargeable deltas by the runtime collector.
-- Input/cache token columns are deliberately disjoint so current pricing can
-- be applied later without double-counting cached input.
create table briar_run_usage_records (
  execution_id text not null
    references briar_run_execution_attempts (id) on delete cascade,
  usage_key text not null check (length(trim(usage_key)) between 1 and 512),
  session_id text,
  turn_id text,
  scope_id text,
  agent_provider text not null check (
    agent_provider in ('codex', 'claude', 'grok', 'opencode')
  ),
  model_provider text,
  model text,
  canonical_model text,
  model_source text not null check (
    model_source in (
      'providerReported', 'providerConfig', 'configuredFallback', 'unknown'
    )
  ),
  source text not null check (length(trim(source)) between 1 and 128),
  uncached_input_tokens integer check (
    uncached_input_tokens is null or uncached_input_tokens >= 0
  ),
  cache_read_tokens integer check (
    cache_read_tokens is null or cache_read_tokens >= 0
  ),
  cache_write_tokens integer check (
    cache_write_tokens is null or cache_write_tokens >= 0
  ),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  reasoning_output_tokens integer check (
    reasoning_output_tokens is null or reasoning_output_tokens >= 0
  ),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  observed_at text not null,
  recorded_at text not null,
  check (
    uncached_input_tokens is not null
    or cache_read_tokens is not null
    or cache_write_tokens is not null
    or output_tokens is not null
    or reasoning_output_tokens is not null
    or total_tokens is not null
  ),
  check (
    reasoning_output_tokens is null
    or (
      output_tokens is not null
      and reasoning_output_tokens <= output_tokens
    )
  ),
  -- Do not require total equality: provider total semantics are not uniform.
  primary key (execution_id, usage_key)
);

create index briar_run_usage_records_observed_idx
  on briar_run_usage_records (observed_at, execution_id);

create index briar_agent_transcript_sessions_project_run_idx
  on briar_agent_transcript_sessions (
    project_id, run_id, last_event_at desc, started_at desc, session_id desc
  );
