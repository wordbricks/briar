pragma foreign_keys = on;

-- Metrics remain useful historical telemetry. The previous writer used the
-- same Effect model, so retain every bounded JSON object and remove only values
-- that are not valid storage envelopes. Effect owns all field-level rules.
update briar_hunt_runs
set execution_metrics_json = null
where execution_metrics_json is not null
  and case
    when not json_valid(execution_metrics_json) then 1
    when json_type(execution_metrics_json) <> 'object' then 1
    when length(cast(execution_metrics_json as blob)) > 4096 then 1
    else 0
  end;

-- D1 owns only the storage envelope. Full field validation belongs to the
-- Effect encoder on write and strict decoder on read.
create trigger briar_hunt_run_execution_metrics_insert_guard
before insert on briar_hunt_runs
when new.execution_metrics_json is not null
  and case
    when not json_valid(new.execution_metrics_json) then 1
    when json_type(new.execution_metrics_json) <> 'object' then 1
    when length(cast(new.execution_metrics_json as blob)) > 4096 then 1
    else 0
  end
begin
  select raise(
    abort,
    'agent execution metrics must be a bounded JSON object'
  );
end;

create trigger briar_hunt_run_execution_metrics_update_guard
before update of execution_metrics_json on briar_hunt_runs
when new.execution_metrics_json is not null
  and case
    when not json_valid(new.execution_metrics_json) then 1
    when json_type(new.execution_metrics_json) <> 'object' then 1
    when length(cast(new.execution_metrics_json as blob)) > 4096 then 1
    else 0
  end
begin
  select raise(
    abort,
    'agent execution metrics must be a bounded JSON object'
  );
end;
