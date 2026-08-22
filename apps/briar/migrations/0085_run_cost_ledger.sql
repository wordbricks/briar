-- Immutable provider-reported USD costs. Amounts are fixed-point integers:
-- 1 USD = 10,000,000,000 ticks. Replayed reports keep the first observation.
create table briar_run_cost_records (
  execution_id text not null
    references briar_run_execution_attempts (id) on delete cascade,
  cost_key text not null check (length(trim(cost_key)) between 1 and 512),
  usage_key text check (
    usage_key is null or length(trim(usage_key)) between 1 and 512
  ),
  session_id text check (
    session_id is null or length(trim(session_id)) between 1 and 512
  ),
  turn_id text check (
    turn_id is null or length(trim(turn_id)) between 1 and 512
  ),
  scope_id text check (
    scope_id is null or length(trim(scope_id)) between 1 and 512
  ),
  agent_provider text not null check (
    agent_provider in ('codex', 'claude', 'grok', 'opencode')
  ),
  model_provider text check (
    model_provider is null or length(trim(model_provider)) between 1 and 256
  ),
  model text check (
    model is null or length(trim(model)) between 1 and 512
  ),
  canonical_model text check (
    canonical_model is null or length(trim(canonical_model)) between 1 and 512
  ),
  model_source text not null check (
    model_source in (
      'providerReported', 'providerConfig', 'configuredFallback', 'unknown'
    )
  ),
  source text not null check (length(trim(source)) between 1 and 128),
  amount_usd_ticks integer not null check (
    typeof(amount_usd_ticks) = 'integer'
    and amount_usd_ticks >= 0
    and amount_usd_ticks <= 9007199254740991
  ),
  observed_at text not null,
  recorded_at text not null,
  primary key (execution_id, cost_key)
);

create index briar_run_cost_records_observed_idx
  on briar_run_cost_records (observed_at, execution_id);

create index briar_run_cost_records_usage_idx
  on briar_run_cost_records (execution_id, usage_key)
  where usage_key is not null;
