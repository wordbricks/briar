pragma foreign_keys = on;

-- Refuse to continue if a project or frozen run snapshot is not already v2.
-- Production is audited before this migration; this guard prevents a partial
-- rollout from silently inventing checkpoint semantics for unknown data.
create table _briar_workflow_v2_guard (
  valid integer not null check (valid = 1)
);

insert into _briar_workflow_v2_guard (valid)
select case when not exists (
  select 1 from briar_project_settings
  where not json_valid(workflow_json)
     or json_extract(workflow_json, '$.version') <> 2
     or json_type(workflow_json, '$.execution.checkpoints') <> 'array'
) then 1 else 0 END;

insert into _briar_workflow_v2_guard (valid)
select case when not exists (
  select 1 from briar_hunt_runs
  where not json_valid(workflow_snapshot_json)
     or json_extract(workflow_snapshot_json, '$.version') <> 2
     or json_type(workflow_snapshot_json, '$.execution.checkpoints') <> 'array'
) then 1 else 0 END;

drop table _briar_workflow_v2_guard;

-- Project workflow checkpoints and policies are always project-owned.
update briar_project_settings
set workflow_json = json_set(
  workflow_json,
  '$.execution.checkpoints',
  json(coalesce((
    select json_group_array(json_object(
      'key', 'project-' || json_extract(checkpoint.value, '$.position') || '-' ||
        json_extract(checkpoint.value, '$.stage'),
      'stage', json_extract(checkpoint.value, '$.stage'),
      'position', json_extract(checkpoint.value, '$.position')
    ))
    from json_each(workflow_json, '$.execution.checkpoints') checkpoint
  ), '[]'))
);

update briar_project_settings
set mandatory_checkpoints_json = json(coalesce((
  select json_group_array(json_object(
    'key', 'project-' || json_extract(checkpoint.value, '$.position') || '-' ||
      json_extract(checkpoint.value, '$.stage'),
    'stage', json_extract(checkpoint.value, '$.stage'),
    'position', json_extract(checkpoint.value, '$.position')
  ))
  from json_each(
    case
      when mandatory_checkpoints_json is not null then mandatory_checkpoints_json
      when exists (
        select 1 from json_each(workflow_json, '$.stages') stage
        where json_extract(stage.value, '$.id') = 'repository_workflow_pending'
      ) then json('[]')
      else json_extract(workflow_json, '$.execution.checkpoints')
    END
  ) checkpoint
), '[]'));

update briar_user_workflow_checkpoint_defaults
set checkpoints_json = json(coalesce((
  select json_group_array(json_object(
    'key', 'user-' || json_extract(checkpoint.value, '$.position') || '-' ||
      json_extract(checkpoint.value, '$.stage'),
    'stage', json_extract(checkpoint.value, '$.stage'),
    'position', json_extract(checkpoint.value, '$.position')
  ))
  from json_each(checkpoints_json) checkpoint
), '[]'));

update briar_hunt_runs
set issue_checkpoints_json = json(coalesce((
  select json_group_array(json_object(
    'key', 'issue-' || json_extract(checkpoint.value, '$.position') || '-' ||
      json_extract(checkpoint.value, '$.stage'),
    'stage', json_extract(checkpoint.value, '$.stage'),
    'position', json_extract(checkpoint.value, '$.position')
  ))
  from json_each(issue_checkpoints_json) checkpoint
), '[]'));

-- Frozen run snapshots can contain checkpoints from all three policy layers.
-- Preserve a canonical source prefix and treat any unscoped historical key as
-- a project checkpoint at the same immutable boundary.
update briar_hunt_runs
set workflow_snapshot_json = json_set(
  workflow_snapshot_json,
  '$.execution.checkpoints',
  json(coalesce((
    select json_group_array(json_object(
      'key', case
        when json_extract(checkpoint.value, '$.key') glob 'project-*'
          or json_extract(checkpoint.value, '$.key') glob 'user-*'
          or json_extract(checkpoint.value, '$.key') glob 'issue-*'
          then json_extract(checkpoint.value, '$.key')
        else 'project-' || json_extract(checkpoint.value, '$.position') || '-' ||
          json_extract(checkpoint.value, '$.stage')
      END ,
      'stage', json_extract(checkpoint.value, '$.stage'),
      'position', json_extract(checkpoint.value, '$.position')
    ))
    from json_each(workflow_snapshot_json, '$.execution.checkpoints') checkpoint
  ), '[]'))
);

update briar_run_checkpoint_progress
set checkpoint_key = case
  when checkpoint_key glob 'project-*'
    or checkpoint_key glob 'user-*'
    or checkpoint_key glob 'issue-*'
    then checkpoint_key
  else 'project-' || position || '-' || stage_id
END;

update briar_hunt_runs
set waiting_checkpoint_key = case
  when waiting_checkpoint_key is null then null
  when waiting_checkpoint_key glob 'project-*'
    or waiting_checkpoint_key glob 'user-*'
    or waiting_checkpoint_key glob 'issue-*'
    then waiting_checkpoint_key
  else 'project-' || (
    select checkpoint.position
    from briar_run_checkpoint_progress checkpoint
    where checkpoint.run_id = briar_hunt_runs.id
      and checkpoint.attempt = briar_hunt_runs.current_attempt
      and checkpoint.revision = coalesce(
        briar_hunt_runs.waiting_checkpoint_revision,
        briar_hunt_runs.current_revision
      )
      and checkpoint.stage_id = briar_hunt_runs.workflow_stage
      and checkpoint.state = 'waiting'
    limit 1
  ) || '-' || workflow_stage
END;

-- Repair runs whose status event used to clear the claim at an after-stage
-- boundary before lifecycle completion could commit. Evidence must already
-- satisfy the stage and no other checkpoint may be waiting.
create table _briar_checkpoint_repairs (
  run_id text primary key not null,
  attempt integer not null,
  revision integer not null,
  checkpoint_key text not null,
  paused_at text not null
);

insert into _briar_checkpoint_repairs (
  run_id, attempt, revision, checkpoint_key, paused_at
)
select run.id, run.current_attempt, run.current_revision,
       checkpoint.checkpoint_key, run.paused_at
from briar_hunt_runs run
join briar_run_stage_progress stage
  on stage.run_id = run.id
 and stage.attempt = run.current_attempt
 and stage.revision = run.current_revision
 and stage.stage_id = run.workflow_stage
 and stage.state = 'running'
join briar_run_checkpoint_progress checkpoint
  on checkpoint.run_id = run.id
 and checkpoint.attempt = run.current_attempt
 and checkpoint.revision = run.current_revision
 and checkpoint.stage_id = run.workflow_stage
 and checkpoint.position = 'after'
 and checkpoint.state = 'pending'
where run.status = 'running'
  and run.paused_at is not null
  and run.waiting_checkpoint_key is null
  and run.resume_requested_at is null
  and run.claim_token_hash is null
  and not exists (
    select 1
    from briar_run_checkpoint_progress waiting
    where waiting.run_id = run.id
      and waiting.attempt = run.current_attempt
      and waiting.revision = run.current_revision
      and waiting.state = 'waiting'
  )
  and not exists (
    select 1
    from json_each(run.workflow_snapshot_json, '$.stages') workflow_stage,
         json_each(workflow_stage.value, '$.evidence') requirement
    where json_extract(workflow_stage.value, '$.id') = run.workflow_stage
      and not exists (
        select 1
        from briar_run_evidence evidence
        where evidence.run_id = run.id
          and evidence.attempt = run.current_attempt
          and evidence.revision = run.current_revision
          and evidence.workflow_stage = run.workflow_stage
          and evidence.evidence_type = requirement.value
          and evidence.status in ('passed', 'skipped')
      )
  );

update briar_run_stage_progress
set state = 'completed', finished_at = (
  select repair.paused_at
  from _briar_checkpoint_repairs repair
  where repair.run_id = briar_run_stage_progress.run_id
)
where exists (
  select 1 from _briar_checkpoint_repairs repair
  where repair.run_id = briar_run_stage_progress.run_id
    and repair.attempt = briar_run_stage_progress.attempt
    and repair.revision = briar_run_stage_progress.revision
)
  and stage_id = (
    select run.workflow_stage from briar_hunt_runs run
    where run.id = briar_run_stage_progress.run_id
  );

update briar_run_checkpoint_progress
set state = 'waiting', reached_at = (
  select repair.paused_at
  from _briar_checkpoint_repairs repair
  where repair.run_id = briar_run_checkpoint_progress.run_id
)
where exists (
  select 1 from _briar_checkpoint_repairs repair
  where repair.run_id = briar_run_checkpoint_progress.run_id
    and repair.attempt = briar_run_checkpoint_progress.attempt
    and repair.revision = briar_run_checkpoint_progress.revision
    and repair.checkpoint_key = briar_run_checkpoint_progress.checkpoint_key
);

update briar_hunt_runs
set waiting_checkpoint_key = (
      select repair.checkpoint_key from _briar_checkpoint_repairs repair
      where repair.run_id = briar_hunt_runs.id
    ),
    waiting_checkpoint_revision = current_revision
where id in (select run_id from _briar_checkpoint_repairs);

drop table _briar_checkpoint_repairs;

-- Enforce the v2-only contract even where old SQLite column defaults cannot be
-- altered in place. Runtime writes must provide explicit canonical JSON.
create trigger briar_project_settings_workflow_v2_insert
before insert on briar_project_settings
when not (
  json_valid(new.workflow_json)
  and json_extract(new.workflow_json, '$.version') = 2
  and json_type(new.workflow_json, '$.execution.checkpoints') = 'array'
  and not exists (
    select 1 from json_each(new.workflow_json, '$.execution') field
    where field.key <> 'checkpoints'
  )
  and new.mandatory_checkpoints_json is not null
  and json_valid(new.mandatory_checkpoints_json)
  and json_type(new.mandatory_checkpoints_json) = 'array'
  and not exists (
    select 1 from json_each(new.workflow_json, '$.execution.checkpoints') checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
  )
  and not exists (
    select 1 from json_each(new.mandatory_checkpoints_json) checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
  )
)
begin
  select raise(abort, 'project workflow must use canonical v2 checkpoints');
END;

create trigger briar_project_settings_workflow_v2_update
before update of workflow_json, mandatory_checkpoints_json on briar_project_settings
when not (
  json_valid(new.workflow_json)
  and json_extract(new.workflow_json, '$.version') = 2
  and json_type(new.workflow_json, '$.execution.checkpoints') = 'array'
  and not exists (
    select 1 from json_each(new.workflow_json, '$.execution') field
    where field.key <> 'checkpoints'
  )
  and new.mandatory_checkpoints_json is not null
  and json_valid(new.mandatory_checkpoints_json)
  and json_type(new.mandatory_checkpoints_json) = 'array'
  and not exists (
    select 1 from json_each(new.workflow_json, '$.execution.checkpoints') checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
  )
  and not exists (
    select 1 from json_each(new.mandatory_checkpoints_json) checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
  )
)
begin
  select raise(abort, 'project workflow must use canonical v2 checkpoints');
END;

create trigger briar_hunt_runs_workflow_v2_insert
before insert on briar_hunt_runs
when not (
  json_valid(new.workflow_snapshot_json)
  and json_extract(new.workflow_snapshot_json, '$.version') = 2
  and json_type(new.workflow_snapshot_json, '$.execution.checkpoints') = 'array'
  and not exists (
    select 1 from json_each(new.workflow_snapshot_json, '$.execution') field
    where field.key <> 'checkpoints'
  )
  and not exists (
    select 1 from json_each(new.workflow_snapshot_json, '$.execution.checkpoints') checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
      and json_extract(checkpoint.value, '$.key') not glob 'user-*'
      and json_extract(checkpoint.value, '$.key') not glob 'issue-*'
  )
)
begin
  select raise(abort, 'run workflow must use canonical v2 checkpoints');
END;

create trigger briar_hunt_runs_workflow_v2_update
before update of workflow_snapshot_json on briar_hunt_runs
when not (
  json_valid(new.workflow_snapshot_json)
  and json_extract(new.workflow_snapshot_json, '$.version') = 2
  and json_type(new.workflow_snapshot_json, '$.execution.checkpoints') = 'array'
  and not exists (
    select 1 from json_each(new.workflow_snapshot_json, '$.execution') field
    where field.key <> 'checkpoints'
  )
  and not exists (
    select 1 from json_each(new.workflow_snapshot_json, '$.execution.checkpoints') checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
      and json_extract(checkpoint.value, '$.key') not glob 'user-*'
      and json_extract(checkpoint.value, '$.key') not glob 'issue-*'
  )
)
begin
  select raise(abort, 'run workflow must use canonical v2 checkpoints');
END;
