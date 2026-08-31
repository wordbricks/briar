pragma foreign_keys = on;

-- Structured results are optional derived metadata. Earlier rows were written
-- through several hand-maintained JSON shapes, and this pre-release cutover
-- does not retain that compatibility surface. The Effect codec owns the full
-- document contract for every future writer and reader.
update briar_hunt_runs
set structured_result_json = null
where structured_result_json is not null;

update briar_project_agent_schedule_runs
set structured_result_json = null
where structured_result_json is not null;

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
