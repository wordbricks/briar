alter table briar_project_settings add column workflow_json text not null
  default '{"version":1,"stages":[{"id":"repository_workflow_pending","label":"Repository workflow pending","required":true}],"completion":{"requiredStages":["repository_workflow_pending"]},"release":{"enabled":false}}'
  check (json_valid(workflow_json) and json_type(workflow_json) = 'object');

alter table briar_hunt_runs add column status text not null default 'queued'
  check (status in ('queued', 'running', 'blocked', 'failed', 'completed', 'cancelled'));
alter table briar_hunt_runs add column workflow_stage text;
alter table briar_hunt_runs add column workflow_snapshot_json text not null
  default '{"version":1,"stages":[{"id":"repository_workflow_pending","label":"Repository workflow pending","required":true}],"completion":{"requiredStages":["repository_workflow_pending"]},"release":{"enabled":false}}'
  check (json_valid(workflow_snapshot_json) and json_type(workflow_snapshot_json) = 'object');

update briar_hunt_runs
set status = case
      when stage = 'queued' then 'queued'
      when stage in ('blocked', 'failed', 'completed', 'cancelled') then stage
      else 'running'
    end,
    workflow_stage = case
      when stage in ('analyzing', 'implementing', 'pr_open', 'staging_qa', 'production_qa')
        then stage
      else null
    end,
    workflow_snapshot_json = '{"version":1,"stages":[{"id":"analyzing","label":"분석","required":true},{"id":"implementing","label":"구현","required":true},{"id":"pr_open","label":"PR 검증","required":true},{"id":"staging_qa","label":"Stage QA","required":true},{"id":"production_qa","label":"Production QA","required":true}]}';

alter table briar_hunt_events add column status text not null default 'queued'
  check (status in ('queued', 'running', 'blocked', 'failed', 'completed', 'cancelled'));
alter table briar_hunt_events add column workflow_stage text;

update briar_hunt_events
set status = case
      when stage = 'queued' then 'queued'
      when stage in ('blocked', 'failed', 'completed', 'cancelled') then stage
      else 'running'
    end,
    workflow_stage = case
      when stage in ('analyzing', 'implementing', 'pr_open', 'staging_qa', 'production_qa')
        then stage
      else null
    end;

create index briar_hunt_runs_status_idx
  on briar_hunt_runs (project_id, status, last_event_at desc);
