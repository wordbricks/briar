-- Issue conversations route replies to validated Project Agent IDs. Keep the
-- agent identity on both the queued job and the durable message so multiple
-- agents can answer the same user message without collapsing into one row.

pragma foreign_keys = off;
pragma legacy_alter_table = on;

alter table briar_issue_messages add column author_agent_id text
  references briar_project_agents (id) on delete set null;
alter table briar_issue_messages add column author_agent_name text;

drop trigger if exists briar_issue_agent_reply_skill_snapshot_immutable;
drop trigger if exists briar_agent_skill_execution_issue_job_invalidate;
drop trigger if exists briar_agent_skill_execution_issue_job_delete_invalidate;
drop trigger if exists briar_agent_skill_execution_insert_guard;
drop trigger if exists briar_agent_skill_execution_accept_guard;
drop trigger if exists briar_dashboard_issue_reply_jobs_insert_sync;
drop trigger if exists briar_dashboard_issue_reply_jobs_update_sync;
drop trigger if exists briar_project_stranded_run_child_delete_guard;
drop view if exists briar_run_child_storage_b_project_mismatches;

-- Keep triggers that live on other tables pointing at the replacement table.
-- With legacy_alter_table enabled, renaming the old table does not rewrite
-- references in their bodies. Create the replacement under the original name
-- before removing the legacy table so those triggers never see a missing
-- briar_issue_agent_reply_jobs table.
alter table briar_issue_agent_reply_jobs
  rename to briar_issue_agent_reply_jobs_legacy;

create table briar_issue_agent_reply_jobs (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  trigger_message_id text not null
    references briar_issue_messages (id) on delete cascade,
  parent_message_id text not null
    references briar_issue_messages (id) on delete cascade,
  reply_message_id text not null unique,
  agent_id text references briar_project_agents (id) on delete set null,
  requires_preferred_worker integer not null default 0
    check (requires_preferred_worker in (0, 1)),
  agent_name_snapshot text,
  agent_responsibility_snapshot text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  preferred_worker_id text
    references briar_execution_workers (id) on delete set null,
  claimed_worker_id text
    references briar_execution_workers (id) on delete set null,
  preferred_provider text
    check (preferred_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor')),
  agent_provider text
    check (agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor')),
  claim_token_hash text,
  claimed_at text,
  lease_expires_at text,
  attempts integer not null default 0 check (attempts >= 0),
  error text,
  created_at text not null,
  updated_at text not null,
  completed_at text,
  skill_id text references briar_agent_skills (id) on delete set null,
  selected_skill_id_snapshot text,
  selected_agent_name_snapshot text,
  selected_agent_responsibility_snapshot text,
  selected_skill_name_snapshot text,
  selected_skill_instructions_snapshot text,
  selected_skill_provider_snapshot text,
  selected_skill_kind_snapshot text,
  selected_skill_model_snapshot text,
  selected_skill_effort_snapshot text,
  skill_execution_request_snapshot text,
  unique (project_id, trigger_message_id, agent_id)
);

insert into briar_issue_agent_reply_jobs (
  id, project_id, run_id, trigger_message_id, parent_message_id,
  reply_message_id, agent_id, requires_preferred_worker,
  agent_name_snapshot, agent_responsibility_snapshot, status,
  preferred_worker_id, claimed_worker_id, preferred_provider, agent_provider,
  claim_token_hash, claimed_at, lease_expires_at, attempts, error,
  created_at, updated_at, completed_at, skill_id,
  selected_skill_id_snapshot, selected_agent_name_snapshot,
  selected_agent_responsibility_snapshot, selected_skill_name_snapshot,
  selected_skill_instructions_snapshot, selected_skill_provider_snapshot,
  selected_skill_kind_snapshot, selected_skill_model_snapshot,
  selected_skill_effort_snapshot, skill_execution_request_snapshot
)
select job.id, job.project_id, job.run_id, job.trigger_message_id,
       job.parent_message_id, job.reply_message_id, run.agent_id,
       case when run.worker_id is null then 0 else 1 end,
       agent.name, agent.responsibility, job.status,
       job.preferred_worker_id, job.claimed_worker_id, job.preferred_provider,
       job.agent_provider, job.claim_token_hash, job.claimed_at,
       job.lease_expires_at, job.attempts, job.error, job.created_at,
       job.updated_at, job.completed_at, job.skill_id,
       job.selected_skill_id_snapshot, job.selected_agent_name_snapshot,
       job.selected_agent_responsibility_snapshot, job.selected_skill_name_snapshot,
       job.selected_skill_instructions_snapshot, job.selected_skill_provider_snapshot,
       job.selected_skill_kind_snapshot, job.selected_skill_model_snapshot,
       job.selected_skill_effort_snapshot, job.skill_execution_request_snapshot
from briar_issue_agent_reply_jobs_legacy job
join briar_hunt_runs run
  on run.id = job.run_id and run.project_id = job.project_id
left join briar_project_agents agent
  on agent.id = run.agent_id and agent.project_id = run.project_id;

drop table briar_issue_agent_reply_jobs_legacy;

create index briar_issue_agent_reply_jobs_queue_idx
  on briar_issue_agent_reply_jobs (
    project_id, status, preferred_worker_id, lease_expires_at, created_at
  );
create index briar_issue_agent_reply_jobs_run_idx
  on briar_issue_agent_reply_jobs (run_id, created_at desc);
create index briar_issue_agent_reply_jobs_skill_idx
  on briar_issue_agent_reply_jobs (skill_id, status, created_at);
create index briar_issue_agent_reply_jobs_agent_idx
  on briar_issue_agent_reply_jobs (agent_id, status, created_at);

create trigger briar_issue_agent_reply_skill_snapshot_immutable
before update of selected_skill_id_snapshot, selected_agent_name_snapshot,
                 selected_agent_responsibility_snapshot,
                 selected_skill_name_snapshot,
                 selected_skill_instructions_snapshot,
                 selected_skill_kind_snapshot,
                 selected_skill_provider_snapshot,
                 selected_skill_model_snapshot,
                 selected_skill_effort_snapshot,
                 skill_execution_request_snapshot
on briar_issue_agent_reply_jobs
when new.selected_skill_id_snapshot is not old.selected_skill_id_snapshot
  or new.selected_agent_name_snapshot is not old.selected_agent_name_snapshot
  or new.selected_agent_responsibility_snapshot is not
    old.selected_agent_responsibility_snapshot
  or new.selected_skill_name_snapshot is not old.selected_skill_name_snapshot
  or new.selected_skill_instructions_snapshot is not
    old.selected_skill_instructions_snapshot
  or new.selected_skill_kind_snapshot is not old.selected_skill_kind_snapshot
  or new.selected_skill_provider_snapshot is not
    old.selected_skill_provider_snapshot
  or new.selected_skill_model_snapshot is not old.selected_skill_model_snapshot
  or new.selected_skill_effort_snapshot is not old.selected_skill_effort_snapshot
  or new.skill_execution_request_snapshot is not
    old.skill_execution_request_snapshot
begin
  select raise(abort, 'issue Agent Skill reply snapshot is immutable');
end;

create trigger briar_agent_skill_execution_accept_guard
before update of status on briar_agent_skill_execution_proposals
when old.status = 'pending' and new.status = 'accepted' and not (
  old.requested_worker_id is null and old.requested_worker_label is null
  and old.result_session_id is null
  and old.accepted_by_user_id is null and old.accepted_at is null
  and new.requested_worker_id is not null
  and new.requested_worker_label is not null
  and new.result_session_id is not null
  and new.accepted_by_user_id is not null and new.accepted_at is not null
  and new.updated_at = new.accepted_at
  and exists (
    select 1
    from briar_organization_members membership
    join briar_projects project
      on project.id = new.project_id
     and project.organization_id = membership.organization_id
    join briar_project_agents agent
      on agent.id = new.agent_id and agent.project_id = project.id
     and agent.organization_id = project.organization_id
    join briar_agent_skills skill
      on skill.id = new.skill_id and skill.agent_id = agent.id
    join briar_execution_workers worker
      on worker.id = new.requested_worker_id
     and worker.project_id = new.project_id
    join briar_execution_worker_devices device
      on device.id = worker.device_id
     and device.organization_id = new.organization_id
    join briar_organization_members worker_owner
      on worker_owner.organization_id = device.organization_id
     and worker_owner.user_id = device.owner_user_id
    where membership.organization_id = new.organization_id
      and membership.user_id = new.accepted_by_user_id
      and agent.name = new.agent_name
      and agent.responsibility = new.agent_responsibility
      and skill.name = new.skill_name
      and skill.instructions = new.skill_instructions
      and skill.kind = new.skill_kind
      and skill.provider = new.provider
      and skill.model is new.model and skill.effort is new.effort
      and worker.label = new.requested_worker_label
      and worker.state <> 'disabled' and device.state <> 'disabled'
      and worker.accepting_work = 1
      and worker.readiness_state <> 'needs_attention'
      and julianday(worker.last_heartbeat_at) >=
        julianday(new.accepted_at, '-3 minutes')
      and julianday(device.last_heartbeat_at) >=
        julianday(new.accepted_at, '-3 minutes')
      and coalesce(json_extract(
        worker.capabilities_json,
        '$.providerHealth.' || new.provider || '.healthy'
      ), 0) = 1
      and (
        not exists (
          select 1 from briar_project_execution_worker_policies policy
          where policy.project_id = new.project_id
            and policy.selection_mode = 'allowlist'
        )
        or exists (
          select 1 from briar_project_execution_worker_allowlist allowed
          where allowed.project_id = new.project_id
            and allowed.worker_id = worker.id
        )
      )
      and (
        (select count(*)
         from briar_hunt_runs run
         join briar_execution_workers holder on holder.id = run.worker_id
         where holder.device_id = device.id
           and run.claim_token_hash is not null
           and run.lease_expires_at > new.accepted_at
           and run.status not in (
             'backlog', 'completed', 'cancelled', 'blocked', 'failed'
           ))
        +
        (select count(*)
         from briar_project_agent_task_jobs task
         join briar_execution_workers holder
           on holder.id = task.claimed_worker_id
         where holder.device_id = device.id and task.status = 'running'
           and task.lease_expires_at > new.accepted_at)
        < device.max_concurrent_sessions
      )
  )
  and (
    (
      new.source_kind = 'channel'
      and exists (
        select 1
        from briar_channels channel
        join briar_channel_messages trigger_message
          on trigger_message.id = new.trigger_message_id
         and trigger_message.channel_id = channel.id
        join briar_channel_messages reply
          on reply.id = new.reply_message_id
         and reply.channel_id = channel.id
         and reply.author_agent_id = new.agent_id
        join briar_channel_agent_reply_jobs job
          on job.id = new.source_reply_job_id
         and job.channel_id = channel.id
         and job.trigger_message_id = trigger_message.id
         and job.reply_message_id = reply.id
        join briar_channel_agents roster
          on roster.channel_id = channel.id and roster.agent_id = new.agent_id
        where channel.id = new.channel_id
          and channel.organization_id = new.organization_id
          and channel.archived_at is null
          and job.organization_id = new.organization_id
          and job.project_id = new.project_id
          and job.agent_id = new.agent_id
          and job.skill_id = new.skill_id
          and job.selected_skill_id_snapshot = new.skill_id
          and job.selected_agent_name_snapshot = new.agent_name
          and job.selected_agent_responsibility_snapshot =
            new.agent_responsibility
          and job.selected_skill_name_snapshot = new.skill_name
          and job.selected_skill_instructions_snapshot = new.skill_instructions
          and job.selected_skill_kind_snapshot = new.skill_kind
          and job.selected_skill_provider_snapshot = new.provider
          and job.selected_skill_model_snapshot is new.model
          and job.selected_skill_effort_snapshot is new.effort
          and job.skill_execution_request_snapshot = new.request
          and job.status = 'completed'
          and (
            (job.delegated_by_reply_job_id is null
              and new.request = trigger_message.body)
            or
            (job.delegated_by_reply_job_id is not null
              and new.request = job.delegation_request)
          )
          and new.delegated_by_reply_job_id is job.delegated_by_reply_job_id
          and (
            channel.visibility = 'public'
            or exists (
              select 1 from briar_channel_members member
              where member.channel_id = channel.id
                and member.user_id = new.accepted_by_user_id
            )
          )
          and (
            job.delegated_by_reply_job_id is null
            or exists (
              select 1
              from briar_channel_agent_reply_jobs parent
              join briar_project_agents parent_agent
                on parent_agent.id = parent.agent_id
               and parent_agent.project_id is null
               and parent_agent.organization_id = new.organization_id
              join briar_channel_agents parent_roster
                on parent_roster.channel_id = channel.id
               and parent_roster.agent_id = parent_agent.id
              where parent.id = job.delegated_by_reply_job_id
                and parent.organization_id = new.organization_id
                and parent.channel_id = channel.id
                and parent.trigger_message_id = job.trigger_message_id
                and parent.project_id is null
                and parent.delegated_by_reply_job_id is null
                and parent.status = 'completed'
                and new.delegated_by_agent_id = parent_agent.id
                and new.delegated_by_agent_name = parent_agent.name
            )
          )
      )
    )
    or
    (
      new.source_kind = 'issue'
      and exists (
        select 1
        from briar_hunt_runs run
        join briar_issue_messages trigger_message
          on trigger_message.id = new.trigger_message_id
         and trigger_message.project_id = run.project_id
         and trigger_message.run_id = run.id
        join briar_issue_messages reply
          on reply.id = new.reply_message_id
         and reply.project_id = run.project_id and reply.run_id = run.id
        join briar_issue_agent_reply_jobs job
          on job.id = new.source_reply_job_id
         and job.project_id = run.project_id and job.run_id = run.id
         and job.trigger_message_id = trigger_message.id
         and job.reply_message_id = reply.id
        where run.id = new.conversation_run_id
          and run.project_id = new.project_id
          and coalesce(job.agent_id, run.agent_id) = new.agent_id
          and job.status = 'completed'
          and job.skill_id = new.skill_id
          and job.selected_skill_id_snapshot = new.skill_id
          and job.selected_agent_name_snapshot = new.agent_name
          and job.selected_agent_responsibility_snapshot =
            new.agent_responsibility
          and job.selected_skill_name_snapshot = new.skill_name
          and job.selected_skill_instructions_snapshot = new.skill_instructions
          and job.selected_skill_kind_snapshot = new.skill_kind
          and job.selected_skill_provider_snapshot = new.provider
          and job.selected_skill_model_snapshot is new.model
          and job.selected_skill_effort_snapshot is new.effort
          and job.skill_execution_request_snapshot = new.request
          and trigger_message.body = new.request
      )
    )
  )
)
begin
  select raise(abort, 'Agent Skill execution proposal is stale');
end;

create trigger briar_agent_skill_execution_issue_job_invalidate
after update of project_id, run_id, trigger_message_id, reply_message_id,
                skill_id, selected_skill_id_snapshot, status
on briar_issue_agent_reply_jobs
begin
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'issue' and source_reply_job_id = old.id
    and status = 'pending'
    and (new.project_id is not old.project_id
      or new.run_id is not old.run_id
      or new.trigger_message_id is not old.trigger_message_id
      or new.reply_message_id is not old.reply_message_id
      or new.skill_id is not old.skill_id
      or new.selected_skill_id_snapshot is not old.selected_skill_id_snapshot
      or new.status <> 'completed');
end;

create trigger briar_agent_skill_execution_issue_job_delete_invalidate
before delete on briar_issue_agent_reply_jobs
begin
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'issue' and source_reply_job_id = old.id
    and status = 'pending';
end;

create trigger briar_dashboard_issue_reply_jobs_insert_sync
after insert on briar_issue_agent_reply_jobs begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.trigger_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_issue_reply_jobs_update_sync
after update of status, claimed_worker_id, agent_provider, error, completed_at
on briar_issue_agent_reply_jobs begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.trigger_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create view briar_run_child_storage_b_project_mismatches as
select child.project_id as stale_project_id,
       run.project_id as current_project_id,
       run.id as run_id, 'issue_reply_job' as entity_kind,
       child.id as entity_id
from briar_issue_agent_reply_jobs child
join briar_hunt_runs run on run.id = child.run_id
where child.project_id <> run.project_id
union all
select child.project_id, run.project_id, run.id, 'log_archive', child.id
from briar_log_archives child
join briar_hunt_runs run on run.id = child.run_id
where child.archive_kind <> 'execution_audit'
  and child.project_id <> run.project_id
  and not exists (
    select 1 from briar_channel_issue_transfer_quarantine quarantine
    where quarantine.entity_kind = 'agent_transcript_archive'
      and quarantine.entity_id = child.id
  )
union all
select child.project_id, run.project_id, run.id, 'archive_cleanup',
       child.bucket || ':' || child.object_key
from briar_archive_cleanup_queue child
join briar_hunt_runs run on run.id = child.run_id
where child.run_id is not null and child.project_id <> run.project_id;

create trigger briar_project_stranded_run_child_delete_guard
before delete on briar_projects
when exists (
  select 1 from briar_run_child_storage_a_project_mismatches mismatch
  where mismatch.stale_project_id = old.id
     or mismatch.current_project_id = old.id
)
or exists (
  select 1 from briar_run_child_storage_b_project_mismatches mismatch
  where mismatch.stale_project_id = old.id
     or mismatch.current_project_id = old.id
)
or exists (
  select 1 from briar_run_child_relation_a_project_mismatches mismatch
  where mismatch.stale_project_id = old.id
     or mismatch.current_project_id = old.id
)
or exists (
  select 1 from briar_run_child_relation_b_project_mismatches mismatch
  where mismatch.stale_project_id = old.id
     or mismatch.current_project_id = old.id
)
begin
  select raise(abort, 'project has stranded transferred issue data');
end;

-- Recreate the proposal guards after the job-table swap. The issue branch
-- resolves the executing Agent from the reply job first, so a run can have
-- several explicitly mentioned Project Agents even when its run-level agent
-- is null or different.
create trigger briar_agent_skill_execution_insert_guard
before insert on briar_agent_skill_execution_proposals
when not (
  new.status = 'pending' and new.generation = 1
  and new.requested_worker_id is null
  and new.requested_worker_label is null
  and new.result_session_id is null
  and new.accepted_by_user_id is null and new.accepted_at is null
  and exists (
    select 1
    from briar_projects project
    join briar_project_agents agent
      on agent.id = new.agent_id and agent.project_id = project.id
     and agent.organization_id = project.organization_id
    join briar_agent_skills skill
      on skill.id = new.skill_id and skill.agent_id = agent.id
    where project.id = new.project_id
      and project.organization_id = new.organization_id
      and agent.name = new.agent_name
      and agent.responsibility = new.agent_responsibility
      and skill.name = new.skill_name
      and skill.instructions = new.skill_instructions
      and skill.kind = new.skill_kind
      and skill.provider = new.provider
      and skill.model is new.model
      and skill.effort is new.effort
  )
  and not exists (
    select 1 from briar_issue_execution_proposals execution
    where execution.reply_message_id = new.reply_message_id
  )
  and not exists (
    select 1 from briar_channel_action_proposals action
    where new.source_kind = 'channel'
      and action.reply_message_id = new.reply_message_id
  )
  and not exists (
    select 1 from briar_issue_action_proposals action
    where new.source_kind = 'issue'
      and action.reply_message_id = new.reply_message_id
  )
  and not exists (
    select 1 from briar_issue_rework_proposals rework
    where new.source_kind = 'issue'
      and rework.reply_message_id = new.reply_message_id
  )
  and (
    (
      new.source_kind = 'channel'
      and exists (
        select 1
        from briar_channel_agent_reply_jobs job
        join briar_channels channel
          on channel.id = job.channel_id
         and channel.organization_id = job.organization_id
        join briar_channel_messages trigger_message
          on trigger_message.id = job.trigger_message_id
         and trigger_message.channel_id = job.channel_id
        join briar_channel_messages reply
          on reply.id = job.reply_message_id
         and reply.channel_id = job.channel_id
         and reply.author_agent_id = job.agent_id
        join briar_channel_agents roster
          on roster.channel_id = job.channel_id and roster.agent_id = job.agent_id
        where job.id = new.source_reply_job_id
          and job.organization_id = new.organization_id
          and job.channel_id = new.channel_id
          and job.project_id = new.project_id
          and job.agent_id = new.agent_id
          and job.skill_id = new.skill_id
          and job.selected_skill_id_snapshot = new.skill_id
          and job.selected_agent_name_snapshot = new.agent_name
          and job.selected_agent_responsibility_snapshot =
            new.agent_responsibility
          and job.selected_skill_name_snapshot = new.skill_name
          and job.selected_skill_instructions_snapshot = new.skill_instructions
          and job.selected_skill_kind_snapshot = new.skill_kind
          and job.selected_skill_provider_snapshot = new.provider
          and job.selected_skill_model_snapshot is new.model
          and job.selected_skill_effort_snapshot is new.effort
          and job.skill_execution_request_snapshot = new.request
          and job.trigger_message_id = new.trigger_message_id
          and job.reply_message_id = new.reply_message_id
          and job.status = 'completed'
          and channel.archived_at is null
          and (
            (job.delegated_by_reply_job_id is null
              and new.request = trigger_message.body)
            or
            (job.delegated_by_reply_job_id is not null
              and new.request = job.delegation_request)
          )
          and new.delegated_by_reply_job_id is job.delegated_by_reply_job_id
          and (
            (job.delegated_by_reply_job_id is null
              and new.delegated_by_agent_id is null
              and new.delegated_by_agent_name is null)
            or exists (
              select 1
              from briar_channel_agent_reply_jobs parent
              join briar_project_agents parent_agent
                on parent_agent.id = parent.agent_id
               and parent_agent.organization_id = job.organization_id
               and parent_agent.project_id is null
              join briar_channel_agents parent_roster
                on parent_roster.channel_id = job.channel_id
               and parent_roster.agent_id = parent_agent.id
              where parent.id = job.delegated_by_reply_job_id
                and parent.organization_id = job.organization_id
                and parent.channel_id = job.channel_id
                and parent.trigger_message_id = job.trigger_message_id
                and parent.project_id is null
                and parent.delegated_by_reply_job_id is null
                and parent.status = 'completed'
                and new.delegated_by_agent_id = parent_agent.id
                and new.delegated_by_agent_name = parent_agent.name
            )
          )
      )
    )
    or
    (
      new.source_kind = 'issue'
      and new.delegated_by_reply_job_id is null
      and new.delegated_by_agent_id is null
      and new.delegated_by_agent_name is null
      and exists (
        select 1
        from briar_issue_agent_reply_jobs job
        join briar_hunt_runs run
          on run.id = job.run_id and run.project_id = job.project_id
        join briar_issue_messages trigger_message
          on trigger_message.id = job.trigger_message_id
         and trigger_message.run_id = job.run_id
         and trigger_message.project_id = job.project_id
        join briar_issue_messages reply
          on reply.id = job.reply_message_id
         and reply.run_id = job.run_id and reply.project_id = job.project_id
        where job.id = new.source_reply_job_id
          and job.project_id = new.project_id
          and job.run_id = new.conversation_run_id
          and job.trigger_message_id = new.trigger_message_id
          and job.reply_message_id = new.reply_message_id
          and job.status = 'completed'
          and job.skill_id = new.skill_id
          and job.selected_skill_id_snapshot = new.skill_id
          and job.selected_agent_name_snapshot = new.agent_name
          and job.selected_agent_responsibility_snapshot =
            new.agent_responsibility
          and job.selected_skill_name_snapshot = new.skill_name
          and job.selected_skill_instructions_snapshot = new.skill_instructions
          and job.selected_skill_kind_snapshot = new.skill_kind
          and job.selected_skill_provider_snapshot = new.provider
          and job.selected_skill_model_snapshot is new.model
          and job.selected_skill_effort_snapshot is new.effort
          and job.skill_execution_request_snapshot = new.request
          and coalesce(job.agent_id, run.agent_id) = new.agent_id
          and trigger_message.body = new.request
      )
    )
  )
)
begin
  select raise(abort, 'invalid Agent Skill execution proposal');
end;

pragma foreign_keys = on;
pragma legacy_alter_table = off;
