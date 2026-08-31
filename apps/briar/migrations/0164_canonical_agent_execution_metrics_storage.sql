pragma foreign_keys = on;

-- Effect's AgentExecutionMetrics schema is the authoritative contract. This
-- view mirrors its storage-safe subset once and is shared by cleanup and both
-- future-write guards.
create view briar_agent_execution_metrics_storage_validation as
select cast(null as text) as mode,
       cast(null as text) as row_id,
       cast(null as text) as execution_metrics_json
where 0;

create trigger briar_agent_execution_metrics_storage_validate
instead of insert on briar_agent_execution_metrics_storage_validation
when not (
  new.mode in ('cleanup', 'guard')
  and new.row_id is not null
  and new.execution_metrics_json is not null
  and json_valid(new.execution_metrics_json)
  and case
        when json_valid(new.execution_metrics_json)
          then json_type(new.execution_metrics_json)
        else null
      end = 'object'
  and (
    select count(*)
    from json_each(
      case
        when json_valid(new.execution_metrics_json)
          and json_type(new.execution_metrics_json) = 'object'
          then new.execution_metrics_json
        else '{}'
      end
    )
  ) = 7
  and not exists (
    select 1
    from json_each(
      case
        when json_valid(new.execution_metrics_json)
          and json_type(new.execution_metrics_json) = 'object'
          then new.execution_metrics_json
        else '{}'
      end
    ) field
    where field.key not in (
      'inputTokens', 'outputTokens', 'cacheReadTokens',
      'cacheWriteTokens', 'reasoningOutputTokens', 'totalTokens',
      'durationMs'
    )
  )
  and coalesce(
    json_type(new.execution_metrics_json, '$.inputTokens'), ''
  ) in ('null', 'integer')
  and (
    json_type(new.execution_metrics_json, '$.inputTokens') = 'null'
    or json_extract(new.execution_metrics_json, '$.inputTokens')
      between 0 and 9007199254740991
  )
  and coalesce(
    json_type(new.execution_metrics_json, '$.outputTokens'), ''
  ) in ('null', 'integer')
  and (
    json_type(new.execution_metrics_json, '$.outputTokens') = 'null'
    or json_extract(new.execution_metrics_json, '$.outputTokens')
      between 0 and 9007199254740991
  )
  and coalesce(
    json_type(new.execution_metrics_json, '$.cacheReadTokens'), ''
  ) in ('null', 'integer')
  and (
    json_type(new.execution_metrics_json, '$.cacheReadTokens') = 'null'
    or json_extract(new.execution_metrics_json, '$.cacheReadTokens')
      between 0 and 9007199254740991
  )
  and coalesce(
    json_type(new.execution_metrics_json, '$.cacheWriteTokens'), ''
  ) in ('null', 'integer')
  and (
    json_type(new.execution_metrics_json, '$.cacheWriteTokens') = 'null'
    or json_extract(new.execution_metrics_json, '$.cacheWriteTokens')
      between 0 and 9007199254740991
  )
  and coalesce(
    json_type(new.execution_metrics_json, '$.reasoningOutputTokens'), ''
  ) in ('null', 'integer')
  and (
    json_type(new.execution_metrics_json, '$.reasoningOutputTokens') = 'null'
    or json_extract(new.execution_metrics_json, '$.reasoningOutputTokens')
      between 0 and 9007199254740991
  )
  and coalesce(
    json_type(new.execution_metrics_json, '$.totalTokens'), ''
  ) in ('null', 'integer')
  and (
    json_type(new.execution_metrics_json, '$.totalTokens') = 'null'
    or json_extract(new.execution_metrics_json, '$.totalTokens')
      between 0 and 9007199254740991
  )
  and coalesce(
    json_type(new.execution_metrics_json, '$.durationMs'), ''
  ) = 'integer'
  and json_extract(new.execution_metrics_json, '$.durationMs')
    between 0 and 9007199254740991
)
begin
  -- Metrics are derived telemetry. Invalid history has no trustworthy value,
  -- so null it instead of inventing a partial result.
  update briar_hunt_runs
  set execution_metrics_json = null
  where new.mode = 'cleanup'
    and id = new.row_id;

  select raise(
    abort,
    'agent execution metrics must use the canonical shape'
  ) where new.mode = 'guard';
end;

insert into briar_agent_execution_metrics_storage_validation (
  mode, row_id, execution_metrics_json
)
select 'cleanup', id,
       case when json_valid(execution_metrics_json)
         then execution_metrics_json else '{}'
       end
from briar_hunt_runs
where execution_metrics_json is not null;

create trigger briar_hunt_run_execution_metrics_insert_guard
before insert on briar_hunt_runs
when new.execution_metrics_json is not null
begin
  insert into briar_agent_execution_metrics_storage_validation (
    mode, row_id, execution_metrics_json
  ) values (
    'guard', new.id,
    case when json_valid(new.execution_metrics_json)
      then new.execution_metrics_json else '{}'
    end
  );
end;

create trigger briar_hunt_run_execution_metrics_update_guard
before update of execution_metrics_json on briar_hunt_runs
when new.execution_metrics_json is not null
begin
  insert into briar_agent_execution_metrics_storage_validation (
    mode, row_id, execution_metrics_json
  ) values (
    'guard', new.id,
    case when json_valid(new.execution_metrics_json)
      then new.execution_metrics_json else '{}'
    end
  );
end;
