pragma foreign_keys = on;

-- Structured results are user-visible run history. The previous writer used
-- the same Effect schema as the canonical codec, so retain every bounded JSON
-- object and discard only values that cannot be decoded as stored documents.
-- Effect remains the sole field-level contract for future reads and writes.
update briar_hunt_runs
set structured_result_json = null
where structured_result_json is not null
  and case
    when not json_valid(structured_result_json) then 1
    when json_type(structured_result_json) <> 'object' then 1
    when length(cast(structured_result_json as blob)) > 131072 then 1
    else 0
  end;

update briar_project_agent_schedule_runs
set structured_result_json = null
where structured_result_json is not null
  and case
    when not json_valid(structured_result_json) then 1
    when json_type(structured_result_json) <> 'object' then 1
    when length(cast(structured_result_json as blob)) > 131072 then 1
    else 0
  end;

-- D1 owns only the storage envelope. Repeating fields, enums, and refinements
-- here would create a second contract that can drift from the Effect schema.
create trigger briar_hunt_run_structured_result_insert_guard
before insert on briar_hunt_runs
when new.structured_result_json is not null
  and case
    when not json_valid(new.structured_result_json) then 1
    when json_type(new.structured_result_json) <> 'object' then 1
    when length(cast(new.structured_result_json as blob)) > 131072 then 1
    else 0
  end
begin
  select raise(
    abort,
    'structured agent result must be a bounded JSON object'
  );
end;

create trigger briar_hunt_run_structured_result_update_guard
before update of structured_result_json on briar_hunt_runs
when new.structured_result_json is not null
  and case
    when not json_valid(new.structured_result_json) then 1
    when json_type(new.structured_result_json) <> 'object' then 1
    when length(cast(new.structured_result_json as blob)) > 131072 then 1
    else 0
  end
begin
  select raise(
    abort,
    'structured agent result must be a bounded JSON object'
  );
end;

create trigger briar_schedule_run_structured_result_insert_guard
before insert on briar_project_agent_schedule_runs
when new.structured_result_json is not null
  and case
    when not json_valid(new.structured_result_json) then 1
    when json_type(new.structured_result_json) <> 'object' then 1
    when length(cast(new.structured_result_json as blob)) > 131072 then 1
    else 0
  end
begin
  select raise(
    abort,
    'structured agent result must be a bounded JSON object'
  );
end;

create trigger briar_schedule_run_structured_result_update_guard
before update of structured_result_json
on briar_project_agent_schedule_runs
when new.structured_result_json is not null
  and case
    when not json_valid(new.structured_result_json) then 1
    when json_type(new.structured_result_json) <> 'object' then 1
    when length(cast(new.structured_result_json as blob)) > 131072 then 1
    else 0
  end
begin
  select raise(
    abort,
    'structured agent result must be a bounded JSON object'
  );
end;
