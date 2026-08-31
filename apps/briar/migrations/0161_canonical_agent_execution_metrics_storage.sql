pragma foreign_keys = on;

-- Metrics are optional derived telemetry. Drop the pre-contract snapshots at
-- this pre-release cutover instead of preserving parallel historical shapes.
-- The Effect codec owns every future field, numeric bound, and refinement.
update briar_hunt_runs
set execution_metrics_json = null
where execution_metrics_json is not null;

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
