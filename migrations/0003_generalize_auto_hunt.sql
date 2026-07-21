pragma foreign_keys = on;

create table briar_project_settings (
  project_id text primary key not null
    references briar_projects (id) on delete cascade,
  velen_org text check (
    velen_org is null or (
      velen_org = trim(velen_org)
      and length(velen_org) between 1 and 100
    )
  ),
  data_source text check (
    data_source is null or (
      data_source = trim(data_source)
      and length(data_source) between 1 and 300
    )
  ),
  linear_enabled integer not null default 0
    check (linear_enabled in (0, 1)),
  linear_source text check (
    linear_source is null or (
      linear_source like 'linear://%'
      and length(linear_source) between 10 and 300
    )
  ),
  linear_team_key text check (
    linear_team_key is null or (
      linear_team_key = trim(linear_team_key)
      and length(linear_team_key) between 1 and 100
    )
  ),
  github_repository text check (
    github_repository is null or (
      github_repository = trim(github_repository)
      and length(github_repository) between 1 and 300
    )
  ),
  created_at text not null,
  updated_at text not null,
  check (
    linear_enabled = 0
    or (linear_source is not null and velen_org is not null)
  )
);

alter table briar_hunt_runs add column priority integer
  check (priority is null or priority between 1 and 4);
alter table briar_hunt_runs add column tracker_provider text
  check (tracker_provider is null or length(trim(tracker_provider)) between 1 and 50);
alter table briar_hunt_runs add column tracker_issue_id text
  check (tracker_issue_id is null or length(trim(tracker_issue_id)) between 1 and 200);
alter table briar_hunt_runs add column tracker_issue_identifier text
  check (tracker_issue_identifier is null or length(trim(tracker_issue_identifier)) between 1 and 100);
alter table briar_hunt_runs add column tracker_issue_url text
  check (tracker_issue_url is null or length(trim(tracker_issue_url)) between 1 and 1000);
alter table briar_hunt_runs add column tracker_issue_state text
  check (tracker_issue_state is null or length(trim(tracker_issue_state)) between 1 and 100);
alter table briar_hunt_runs add column issue_description text
  check (issue_description is null or length(issue_description) <= 100000);
alter table briar_hunt_runs add column result_summary text
  check (result_summary is null or length(result_summary) <= 100000);
alter table briar_hunt_runs add column pull_request_urls text not null default '[]'
  check (json_valid(pull_request_urls) and json_type(pull_request_urls) = 'array');
alter table briar_hunt_runs add column target_sha text
  check (target_sha is null or (
    length(target_sha) between 7 and 64
    and target_sha not glob '*[^0-9a-f]*'
  ));
alter table briar_hunt_runs add column source_created_at text;
alter table briar_hunt_runs add column staging_qa_status text
  check (staging_qa_status is null or staging_qa_status in ('pending', 'passed', 'skipped'));
alter table briar_hunt_runs add column production_qa_status text
  check (production_qa_status is null or production_qa_status in ('pending', 'passed', 'skipped'));
alter table briar_hunt_runs add column staging_qa_detail text
  check (staging_qa_detail is null or length(staging_qa_detail) <= 100000);
alter table briar_hunt_runs add column production_qa_detail text
  check (production_qa_detail is null or length(production_qa_detail) <= 100000);
alter table briar_hunt_runs add column context_json text
  check (context_json is null or (json_valid(context_json) and json_type(context_json) = 'object'));

alter table briar_hunt_events add column qa_status text
  check (qa_status is null or qa_status in ('pending', 'passed', 'skipped'));
alter table briar_hunt_events add column tracker_issue_state text
  check (tracker_issue_state is null or length(trim(tracker_issue_state)) between 1 and 100);
alter table briar_hunt_events add column pull_request_urls text not null default '[]'
  check (json_valid(pull_request_urls) and json_type(pull_request_urls) = 'array');
alter table briar_hunt_events add column target_sha text
  check (target_sha is null or (
    length(target_sha) between 7 and 64
    and target_sha not glob '*[^0-9a-f]*'
  ));

create index briar_hunt_runs_attention_idx
  on briar_hunt_runs (project_id, last_event_at desc)
  where stage in ('blocked', 'failed');
create index briar_hunt_runs_tracker_issue_idx
  on briar_hunt_runs (project_id, tracker_provider, tracker_issue_id)
  where tracker_issue_id is not null;
create unique index briar_hunt_runs_tracker_issue_unique_idx
  on briar_hunt_runs (project_id, tracker_provider, tracker_issue_id)
  where tracker_provider is not null and tracker_issue_id is not null;

