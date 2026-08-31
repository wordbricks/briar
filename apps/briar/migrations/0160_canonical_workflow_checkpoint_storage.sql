pragma foreign_keys = on;

-- SQLite cannot attach a reusable JSON predicate to existing text columns.
-- Route every future write through one zero-row view instead of copying the
-- checkpoint element contract into six storage triggers.
create view briar_workflow_checkpoint_storage_validation as
select cast(null as text) as owner, cast(null as text) as checkpoints_json
where 0;

create trigger briar_workflow_checkpoint_storage_validate
instead of insert on briar_workflow_checkpoint_storage_validation
when not (
  new.owner in ('project', 'user', 'issue')
  and new.checkpoints_json is not null
  and
  json_valid(new.checkpoints_json)
  and case
        when json_valid(new.checkpoints_json)
          then json_type(new.checkpoints_json)
        else null
      end = 'array'
  and json_array_length(
        case
          when json_valid(new.checkpoints_json)
            then case
              when json_type(new.checkpoints_json) = 'array'
                then new.checkpoints_json
              else '[]'
            end
          else '[]'
        end
      ) <= 100
  and not exists (
    select 1
    from json_each(
      case
        when json_valid(new.checkpoints_json)
          then case
            when json_type(new.checkpoints_json) = 'array'
              then new.checkpoints_json
            else '[]'
          end
        else '[]'
      end
    ) checkpoint
    where checkpoint.type <> 'object'
       or (
         select count(*)
         from json_each(
           case when checkpoint.type = 'object'
             then checkpoint.value else '{}'
           end
         ) field
       ) <> 3
       or coalesce(json_type(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.key'
       ), '') <> 'text'
       or length(json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.key'
       )) not between 1 and 64
       or substr(json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.key'
       ), 1, 1) not glob '[a-z]'
       or json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.key'
       ) glob '*[^a-z0-9_-]*'
       or case new.owner
            when 'project' then json_extract(
              case when checkpoint.type = 'object'
                then checkpoint.value else '{}'
              end,
              '$.key'
            ) not glob 'project-*'
            when 'user' then json_extract(
              case when checkpoint.type = 'object'
                then checkpoint.value else '{}'
              end,
              '$.key'
            ) not glob 'user-*'
            when 'issue' then json_extract(
              case when checkpoint.type = 'object'
                then checkpoint.value else '{}'
              end,
              '$.key'
            ) not glob 'issue-*'
            else 1
          end
       or coalesce(json_type(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.stage'
       ), '') <> 'text'
       or length(json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.stage'
       )) not between 1 and 64
       or substr(json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.stage'
       ), 1, 1) not glob '[a-z]'
       or json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.stage'
       ) glob '*[^a-z0-9_-]*'
       or coalesce(json_type(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.position'
       ), '') <> 'text'
       or json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.position'
       ) not in ('before', 'after')
  )
)
begin
  select raise(abort, 'workflow checkpoints must use the canonical shape');
end;

-- Project policy and frozen issue checkpoints participate in approval and
-- execution decisions. Invalid existing values abort the migration instead
-- of being silently reinterpreted as an empty policy.
insert into briar_workflow_checkpoint_storage_validation (
  owner, checkpoints_json
)
select 'project', mandatory_checkpoints_json
from briar_project_settings;

insert into briar_workflow_checkpoint_storage_validation (
  owner, checkpoints_json
)
select 'issue', issue_checkpoints_json
from briar_hunt_runs;

-- Per-user defaults are optional preferences. Remove malformed legacy rows;
-- their owners can explicitly save a new canonical preference later.
delete from briar_user_workflow_checkpoint_defaults
where not (
  json_valid(checkpoints_json)
  and case
        when json_valid(checkpoints_json) then json_type(checkpoints_json)
        else null
      end = 'array'
  and json_array_length(
        case
          when json_valid(checkpoints_json)
            then case
              when json_type(checkpoints_json) = 'array'
                then checkpoints_json
              else '[]'
            end
          else '[]'
        end
      ) <= 100
  and not exists (
    select 1
    from json_each(
      case
        when json_valid(checkpoints_json)
          then case
            when json_type(checkpoints_json) = 'array'
              then checkpoints_json
            else '[]'
          end
        else '[]'
      end
    ) checkpoint
    where checkpoint.type <> 'object'
       or (
         select count(*)
         from json_each(
           case when checkpoint.type = 'object'
             then checkpoint.value else '{}'
           end
         ) field
       ) <> 3
       or coalesce(json_type(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.key'
       ), '') <> 'text'
       or length(json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.key'
       )) not between 1 and 64
       or substr(json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.key'
       ), 1, 1) not glob '[a-z]'
       or json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.key'
       ) glob '*[^a-z0-9_-]*'
       or json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.key'
       ) not glob 'user-*'
       or coalesce(json_type(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.stage'
       ), '') <> 'text'
       or length(json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.stage'
       )) not between 1 and 64
       or substr(json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.stage'
       ), 1, 1) not glob '[a-z]'
       or json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.stage'
       ) glob '*[^a-z0-9_-]*'
       or coalesce(json_type(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.position'
       ), '') <> 'text'
       or json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.position'
       ) not in ('before', 'after')
  )
);

create trigger briar_project_mandatory_checkpoints_shape_insert
before insert on briar_project_settings
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('project', new.mandatory_checkpoints_json);
end;

create trigger briar_project_mandatory_checkpoints_shape_update
before update of mandatory_checkpoints_json on briar_project_settings
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('project', new.mandatory_checkpoints_json);
end;

create trigger briar_user_default_checkpoints_shape_insert
before insert on briar_user_workflow_checkpoint_defaults
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('user', new.checkpoints_json);
end;

create trigger briar_user_default_checkpoints_shape_update
before update of checkpoints_json on briar_user_workflow_checkpoint_defaults
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('user', new.checkpoints_json);
end;

create trigger briar_issue_checkpoints_shape_insert
before insert on briar_hunt_runs
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('issue', new.issue_checkpoints_json);
end;

create trigger briar_issue_checkpoints_shape_update
before update of issue_checkpoints_json on briar_hunt_runs
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('issue', new.issue_checkpoints_json);
end;
