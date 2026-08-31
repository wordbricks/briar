pragma foreign_keys = on;

-- SQLite cannot attach a reusable JSON predicate to existing text columns.
-- Route both cleanup and future writes through one zero-row validation view so
-- the SQL safety net does not become another parallel field contract.
create view briar_structured_agent_result_storage_validation as
select cast(null as text) as mode,
       cast(null as text) as owner,
       cast(null as text) as row_id,
       cast(null as text) as structured_result_json
where 0;

create trigger briar_structured_agent_result_storage_validate
instead of insert on briar_structured_agent_result_storage_validation
when not (
  new.mode in ('cleanup', 'guard')
  and new.owner in ('hunt', 'schedule')
  and new.row_id is not null
  and new.structured_result_json is not null
  and json_valid(new.structured_result_json)
  and case
        when json_valid(new.structured_result_json)
          then json_type(new.structured_result_json)
        else null
      end = 'object'
  and (
    select count(*)
    from json_each(
      case
        when json_valid(new.structured_result_json)
          then case
            when json_type(new.structured_result_json) = 'object'
              then new.structured_result_json
            else '{}'
          end
        else '{}'
      end
    )
  ) = 8
  and not exists (
    select 1
    from json_each(
      case
        when json_valid(new.structured_result_json)
          then case
            when json_type(new.structured_result_json) = 'object'
              then new.structured_result_json
            else '{}'
          end
        else '{}'
      end
    ) field
    where field.key not in (
      'summary', 'outcome', 'importance', 'urgency', 'impact',
      'humanActionRequired', 'nextAction', 'dueAt'
    )
  )
  and coalesce(json_type(
    case
      when json_valid(new.structured_result_json)
        then new.structured_result_json
      else '{}'
    end,
    '$.summary'
  ), '') = 'text'
  and length(json_extract(new.structured_result_json, '$.summary'))
    between 1 and 100000
  and json_extract(new.structured_result_json, '$.summary') =
    trim(json_extract(new.structured_result_json, '$.summary'))
  and coalesce(json_type(new.structured_result_json, '$.outcome'), '')
    = 'text'
  and json_extract(new.structured_result_json, '$.outcome') in (
    'completed', 'partial', 'blocked', 'failed'
  )
  and coalesce(json_type(new.structured_result_json, '$.importance'), '')
    = 'text'
  and json_extract(new.structured_result_json, '$.importance') in (
    'routine', 'important', 'critical'
  )
  and coalesce(json_type(new.structured_result_json, '$.urgency'), '')
    = 'text'
  and json_extract(new.structured_result_json, '$.urgency') in (
    'normal', 'time_sensitive', 'immediate'
  )
  and coalesce(json_type(new.structured_result_json, '$.impact'), '')
    = 'text'
  and json_extract(new.structured_result_json, '$.impact') in (
    'issue', 'project', 'organization'
  )
  and coalesce(json_type(
    new.structured_result_json,
    '$.humanActionRequired'
  ), '') in ('true', 'false')
  and coalesce(json_type(new.structured_result_json, '$.nextAction'), '')
    in ('null', 'text')
  and (
    json_type(new.structured_result_json, '$.nextAction') = 'null'
    or (
      length(json_extract(new.structured_result_json, '$.nextAction'))
        between 1 and 4000
      and json_extract(new.structured_result_json, '$.nextAction') =
        trim(json_extract(new.structured_result_json, '$.nextAction'))
    )
  )
  and (
    json_type(new.structured_result_json, '$.humanActionRequired') = 'false'
    or json_type(new.structured_result_json, '$.nextAction') = 'text'
  )
  and coalesce(json_type(new.structured_result_json, '$.dueAt'), '')
    in ('null', 'text')
  and (
    json_type(new.structured_result_json, '$.dueAt') = 'null'
    or (
      length(json_extract(new.structured_result_json, '$.dueAt')) >= 17
      and json_extract(new.structured_result_json, '$.dueAt') =
        trim(json_extract(new.structured_result_json, '$.dueAt'))
      and substr(
        json_extract(new.structured_result_json, '$.dueAt'), 5, 1
      ) = '-'
      and substr(
        json_extract(new.structured_result_json, '$.dueAt'), 8, 1
      ) = '-'
      and substr(
        json_extract(new.structured_result_json, '$.dueAt'), 11, 1
      ) = 'T'
      and substr(
        json_extract(new.structured_result_json, '$.dueAt'), 14, 1
      ) = ':'
      and (
        substr(json_extract(new.structured_result_json, '$.dueAt'), -1) = 'Z'
        or (
          substr(
            json_extract(new.structured_result_json, '$.dueAt'), -6, 1
          ) in ('+', '-')
          and substr(
            json_extract(new.structured_result_json, '$.dueAt'), -3, 1
          ) = ':'
        )
      )
    )
  )
)
begin
  -- The structured payload is optional. Keep result_summary while retiring
  -- malformed historical metadata at the cutover boundary.
  update briar_hunt_runs
  set structured_result_json = null
  where new.mode = 'cleanup'
    and new.owner = 'hunt'
    and id = new.row_id;

  update briar_project_agent_schedule_runs
  set structured_result_json = null
  where new.mode = 'cleanup'
    and new.owner = 'schedule'
    and id = new.row_id;

  select raise(
    abort,
    'structured agent result must use the canonical shape'
  ) where new.mode = 'guard';
end;

insert into briar_structured_agent_result_storage_validation (
  mode, owner, row_id, structured_result_json
)
select 'cleanup', 'hunt', id,
       case when json_valid(structured_result_json)
         then structured_result_json else '{}'
       end
from briar_hunt_runs
where structured_result_json is not null;

insert into briar_structured_agent_result_storage_validation (
  mode, owner, row_id, structured_result_json
)
select 'cleanup', 'schedule', id,
       case when json_valid(structured_result_json)
         then structured_result_json else '{}'
       end
from briar_project_agent_schedule_runs
where structured_result_json is not null;

create trigger briar_hunt_run_structured_result_insert_guard
before insert on briar_hunt_runs
when new.structured_result_json is not null
begin
  insert into briar_structured_agent_result_storage_validation (
    mode, owner, row_id, structured_result_json
  ) values (
    'guard', 'hunt', new.id,
    case when json_valid(new.structured_result_json)
      then new.structured_result_json else '{}'
    end
  );
end;

create trigger briar_hunt_run_structured_result_update_guard
before update of structured_result_json on briar_hunt_runs
when new.structured_result_json is not null
begin
  insert into briar_structured_agent_result_storage_validation (
    mode, owner, row_id, structured_result_json
  ) values (
    'guard', 'hunt', new.id,
    case when json_valid(new.structured_result_json)
      then new.structured_result_json else '{}'
    end
  );
end;

create trigger briar_schedule_run_structured_result_insert_guard
before insert on briar_project_agent_schedule_runs
when new.structured_result_json is not null
begin
  insert into briar_structured_agent_result_storage_validation (
    mode, owner, row_id, structured_result_json
  ) values (
    'guard', 'schedule', new.id,
    case when json_valid(new.structured_result_json)
      then new.structured_result_json else '{}'
    end
  );
end;

create trigger briar_schedule_run_structured_result_update_guard
before update of structured_result_json
on briar_project_agent_schedule_runs
when new.structured_result_json is not null
begin
  insert into briar_structured_agent_result_storage_validation (
    mode, owner, row_id, structured_result_json
  ) values (
    'guard', 'schedule', new.id,
    case when json_valid(new.structured_result_json)
      then new.structured_result_json else '{}'
    end
  );
end;
