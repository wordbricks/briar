pragma foreign_keys = on;

-- A natural-language Skill invocation is first answered by a read-only
-- conversational turn. The exact saved Skill and source provenance are then
-- snapshotted here; no writable task or Agent session exists before a member
-- explicitly chooses one Worker.
alter table briar_issue_agent_reply_jobs
  add column skill_id text
    references briar_agent_skills (id) on delete set null;
alter table briar_issue_agent_reply_jobs
  add column selected_skill_id_snapshot text;
alter table briar_issue_agent_reply_jobs
  add column selected_agent_name_snapshot text;
alter table briar_issue_agent_reply_jobs
  add column selected_agent_responsibility_snapshot text;
alter table briar_issue_agent_reply_jobs
  add column selected_skill_name_snapshot text;
alter table briar_issue_agent_reply_jobs
  add column selected_skill_instructions_snapshot text;
alter table briar_issue_agent_reply_jobs
  add column selected_skill_provider_snapshot text;
alter table briar_issue_agent_reply_jobs
  add column selected_skill_kind_snapshot text;
alter table briar_issue_agent_reply_jobs
  add column selected_skill_model_snapshot text;
alter table briar_issue_agent_reply_jobs
  add column selected_skill_effort_snapshot text;
alter table briar_issue_agent_reply_jobs
  add column skill_execution_request_snapshot text;

alter table briar_channel_agent_reply_jobs
  add column selected_agent_name_snapshot text;
alter table briar_channel_agent_reply_jobs
  add column selected_agent_responsibility_snapshot text;
alter table briar_channel_agent_reply_jobs
  add column selected_skill_name_snapshot text;
alter table briar_channel_agent_reply_jobs
  add column selected_skill_instructions_snapshot text;
alter table briar_channel_agent_reply_jobs
  add column selected_skill_provider_snapshot text;
alter table briar_channel_agent_reply_jobs
  add column selected_skill_kind_snapshot text;
alter table briar_channel_agent_reply_jobs
  add column selected_skill_model_snapshot text;
alter table briar_channel_agent_reply_jobs
  add column selected_skill_effort_snapshot text;
alter table briar_channel_agent_reply_jobs
  add column skill_execution_request_snapshot text;

create index briar_issue_agent_reply_jobs_skill_idx
  on briar_issue_agent_reply_jobs (skill_id, status, created_at);

create table briar_agent_skill_execution_proposals (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  source_kind text not null check (source_kind in ('channel', 'issue')),
  channel_id text,
  conversation_run_id text,
  trigger_message_id text not null,
  reply_message_id text not null unique,
  source_reply_job_id text not null,
  delegated_by_reply_job_id text,
  agent_id text not null,
  agent_name text not null check (
    length(trim(agent_name)) between 1 and 100
  ),
  agent_responsibility text not null check (
    length(trim(agent_responsibility)) between 1 and 2000
  ),
  skill_id text not null,
  skill_name text not null check (
    length(trim(skill_name)) between 1 and 100
  ),
  skill_instructions text not null check (length(skill_instructions) <= 10000),
  skill_kind text not null check (skill_kind in ('issue_processing', 'custom')),
  provider text not null
    check (provider in ('codex', 'claude', 'grok', 'opencode')),
  model text check (
    model is null or length(trim(model)) between 1 and 100
  ),
  effort text check (
    effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  request text not null check (length(trim(request)) between 1 and 10000),
  delegated_by_agent_id text,
  delegated_by_agent_name text check (
    delegated_by_agent_name is null
    or length(trim(delegated_by_agent_name)) between 1 and 100
  ),
  generation integer not null default 1 check (generation >= 1),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'invalidated')),
  requested_worker_id text,
  requested_worker_label text,
  result_session_id text unique,
  accepted_by_user_id text references "user" (id) on delete set null,
  accepted_at text,
  created_at text not null,
  updated_at text not null,
  check (
    (source_kind = 'channel' and channel_id is not null
      and conversation_run_id is null)
    or
    (source_kind = 'issue' and channel_id is null
      and conversation_run_id is not null)
  ),
  check (
    (status = 'pending' and requested_worker_id is null
      and requested_worker_label is null and result_session_id is null
      and accepted_by_user_id is null and accepted_at is null)
    or
    (status = 'accepted' and requested_worker_id is not null
      and requested_worker_label is not null and result_session_id is not null
      and accepted_at is not null)
    or status = 'invalidated'
  )
);

create unique index briar_agent_skill_execution_source_job_idx
  on briar_agent_skill_execution_proposals (source_kind, source_reply_job_id);
create index briar_agent_skill_execution_channel_idx
  on briar_agent_skill_execution_proposals (channel_id, created_at, id);
create index briar_agent_skill_execution_issue_idx
  on briar_agent_skill_execution_proposals (
    project_id, conversation_run_id, created_at, id
  );
create index briar_agent_skill_execution_skill_idx
  on briar_agent_skill_execution_proposals (skill_id, status, created_at);

-- Direct desktop tasks keep this null. Conversational tasks carry the exact
-- proposal identity so claims can require the immutable approval ledger.
alter table briar_project_agent_task_jobs
  add column skill_execution_proposal_id text;
alter table briar_project_agent_task_jobs
  add column result_summary text;
alter table briar_project_agent_task_jobs
  add column result_conversation_id text;

create unique index briar_project_agent_task_skill_execution_idx
  on briar_project_agent_task_jobs (skill_execution_proposal_id)
  where skill_execution_proposal_id is not null;

create table briar_agent_skill_execution_approval_audit (
  id text primary key not null,
  proposal_id text not null unique,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null,
  source_kind text not null check (source_kind in ('channel', 'issue')),
  channel_id text,
  conversation_run_id text,
  trigger_message_id text not null,
  reply_message_id text not null,
  source_reply_job_id text not null,
  delegated_by_reply_job_id text,
  agent_id text not null,
  agent_name text not null,
  agent_responsibility text not null,
  skill_id text not null,
  skill_name text not null,
  skill_instructions text not null,
  skill_kind text not null check (skill_kind in ('issue_processing', 'custom')),
  provider text not null
    check (provider in ('codex', 'claude', 'grok', 'opencode')),
  model text,
  effort text check (
    effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  request text not null,
  worker_id text not null,
  worker_label text not null,
  result_session_id text not null unique,
  approved_by_user_id text references "user" (id) on delete set null,
  approved_at text not null,
  delegated_by_agent_id text,
  delegated_by_agent_name text,
  created_at text not null
);

create index briar_agent_skill_execution_audit_session_idx
  on briar_agent_skill_execution_approval_audit (
    project_id, result_session_id, approved_at
  );

-- Every Worker completion attempt gets one durable receipt before its task
-- transition. The task itself may later be deleted and its canonical session
-- may move to R2, so receipts are scoped only to organization erasure.
create table briar_project_agent_task_completion_receipts (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null,
  task_id text not null,
  skill_execution_proposal_id text,
  worker_id text not null,
  claim_token_hash text not null check (length(claim_token_hash) = 64),
  outcome_status text not null
    check (outcome_status in ('queued', 'completed', 'failed')),
  summary text,
  conversation_id text,
  error text,
  completed_at text not null,
  created_at text not null,
  check (
    (outcome_status = 'completed' and error is null
      and (skill_execution_proposal_id is null or summary is not null))
    or
    (outcome_status in ('queued', 'failed')
      and summary is null and error is not null)
  ),
  unique (project_id, task_id, worker_id, claim_token_hash)
);

create index briar_project_agent_task_completion_receipt_session_idx
  on briar_project_agent_task_completion_receipts (
    project_id, task_id, created_at
  );

--> statement-breakpoint
create trigger briar_project_agent_task_completion_receipt_insert_guard
before insert on briar_project_agent_task_completion_receipts
when not exists (
  select 1
  from briar_project_agent_task_jobs task
  join briar_projects project on project.id = task.project_id
  where task.id = new.task_id and task.project_id = new.project_id
    and project.organization_id = new.organization_id
    and task.status = 'running'
    and task.claimed_worker_id = new.worker_id
    and task.claim_token_hash = new.claim_token_hash
    and task.skill_execution_proposal_id is new.skill_execution_proposal_id
    and (
      (new.error is null and new.outcome_status = 'completed' and (
        new.skill_execution_proposal_id is null or new.summary is not null
      ))
      or (new.error is not null and new.summary is null
        and task.attempts >= 3 and new.outcome_status = 'failed')
      or (new.error is not null and new.summary is null
        and task.attempts < 3 and new.outcome_status = 'queued')
    )
    and new.completed_at = new.created_at
)
BEGIN
  select raise(abort, 'invalid project Agent task completion receipt');
END;

--> statement-breakpoint
create trigger briar_project_agent_task_completion_receipt_immutable_update
before update on briar_project_agent_task_completion_receipts
BEGIN
  select raise(abort, 'project Agent task completion receipt is immutable');
END;

--> statement-breakpoint
create trigger briar_project_agent_task_completion_receipt_immutable_delete
before delete on briar_project_agent_task_completion_receipts
when exists (
  select 1 from briar_organizations organization
  where organization.id = old.organization_id
)
BEGIN
  select raise(abort, 'project Agent task completion receipt is immutable');
END;

--> statement-breakpoint
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
          and run.agent_id = new.agent_id
          and trigger_message.body = new.request
      )
    )
  )
)
BEGIN
  select raise(abort, 'invalid Agent Skill execution proposal');
END;

--> statement-breakpoint
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
  or new.selected_skill_effort_snapshot is not
    old.selected_skill_effort_snapshot
  or new.skill_execution_request_snapshot is not
    old.skill_execution_request_snapshot
BEGIN
  select raise(abort, 'issue Agent Skill reply snapshot is immutable');
END;

--> statement-breakpoint
create trigger briar_channel_agent_reply_skill_snapshot_immutable
before update of selected_skill_id_snapshot, selected_agent_name_snapshot,
                 selected_agent_responsibility_snapshot,
                 selected_skill_name_snapshot,
                 selected_skill_instructions_snapshot,
                 selected_skill_kind_snapshot,
                 selected_skill_provider_snapshot,
                 selected_skill_model_snapshot,
                 selected_skill_effort_snapshot,
                 skill_execution_request_snapshot
on briar_channel_agent_reply_jobs
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
  or new.selected_skill_effort_snapshot is not
    old.selected_skill_effort_snapshot
  or new.skill_execution_request_snapshot is not
    old.skill_execution_request_snapshot
BEGIN
  select raise(abort, 'channel Agent Skill reply snapshot is immutable');
END;

--> statement-breakpoint
create trigger briar_channel_action_skill_execution_exclusive
before insert on briar_channel_action_proposals
when exists (
  select 1 from briar_agent_skill_execution_proposals skill_execution
  where skill_execution.reply_message_id = new.reply_message_id
)
BEGIN
  select raise(abort, 'channel proposal conflicts with Agent Skill execution');
END;

--> statement-breakpoint
create trigger briar_issue_action_skill_execution_exclusive
before insert on briar_issue_action_proposals
when exists (
  select 1 from briar_agent_skill_execution_proposals skill_execution
  where skill_execution.reply_message_id = new.reply_message_id
)
BEGIN
  select raise(abort, 'issue proposal conflicts with Agent Skill execution');
END;

--> statement-breakpoint
create trigger briar_issue_rework_skill_execution_exclusive
before insert on briar_issue_rework_proposals
when exists (
  select 1 from briar_agent_skill_execution_proposals skill_execution
  where skill_execution.reply_message_id = new.reply_message_id
)
BEGIN
  select raise(abort, 'rework proposal conflicts with Agent Skill execution');
END;

--> statement-breakpoint
create trigger briar_issue_execution_skill_execution_exclusive
before insert on briar_issue_execution_proposals
when exists (
  select 1 from briar_agent_skill_execution_proposals skill_execution
  where skill_execution.reply_message_id = new.reply_message_id
)
BEGIN
  select raise(abort, 'issue execution conflicts with Agent Skill execution');
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_identity_immutable
before update on briar_agent_skill_execution_proposals
when new.id is not old.id
  or new.organization_id is not old.organization_id
  or new.project_id is not old.project_id
  or new.source_kind is not old.source_kind
  or new.channel_id is not old.channel_id
  or new.conversation_run_id is not old.conversation_run_id
  or new.trigger_message_id is not old.trigger_message_id
  or new.reply_message_id is not old.reply_message_id
  or new.source_reply_job_id is not old.source_reply_job_id
  or new.delegated_by_reply_job_id is not old.delegated_by_reply_job_id
  or new.agent_id is not old.agent_id
  or new.agent_name is not old.agent_name
  or new.agent_responsibility is not old.agent_responsibility
  or new.skill_id is not old.skill_id
  or new.skill_name is not old.skill_name
  or new.skill_instructions is not old.skill_instructions
  or new.skill_kind is not old.skill_kind
  or new.provider is not old.provider
  or new.model is not old.model
  or new.effort is not old.effort
  or new.request is not old.request
  or new.delegated_by_agent_id is not old.delegated_by_agent_id
  or new.delegated_by_agent_name is not old.delegated_by_agent_name
  or new.created_at is not old.created_at
BEGIN
  select raise(abort, 'Agent Skill execution proposal identity is immutable');
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_status_guard
before update of status, generation on briar_agent_skill_execution_proposals
when not (
  (new.status = old.status and new.generation = old.generation)
  or (old.status = 'pending' and new.status = 'accepted'
      and new.generation = old.generation)
  or (old.status = 'pending' and new.status = 'invalidated'
      and new.generation = old.generation + 1)
)
BEGIN
  select raise(abort, 'invalid Agent Skill execution proposal transition');
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_acceptance_immutable
before update of requested_worker_id, requested_worker_label,
                 result_session_id, accepted_by_user_id, accepted_at
on briar_agent_skill_execution_proposals
when not (
  (
    old.status = 'pending' and new.status = 'accepted'
    and old.requested_worker_id is null
    and old.requested_worker_label is null
    and old.result_session_id is null
    and old.accepted_by_user_id is null and old.accepted_at is null
    and new.requested_worker_id is not null
    and new.requested_worker_label is not null
    and new.result_session_id is not null
    and new.accepted_by_user_id is not null and new.accepted_at is not null
  )
  or (
    new.requested_worker_id is old.requested_worker_id
    and new.requested_worker_label is old.requested_worker_label
    and new.result_session_id is old.result_session_id
    and new.accepted_by_user_id is old.accepted_by_user_id
    and new.accepted_at is old.accepted_at
  )
  or (
    old.status = 'accepted' and new.status = 'accepted'
    and old.accepted_by_user_id is not null
    and new.accepted_by_user_id is null
    and not exists (
      select 1 from "user" account where account.id = old.accepted_by_user_id
    )
    and new.requested_worker_id is old.requested_worker_id
    and new.requested_worker_label is old.requested_worker_label
    and new.result_session_id is old.result_session_id
    and new.accepted_at is old.accepted_at
  )
)
BEGIN
  select raise(abort, 'Agent Skill execution acceptance is immutable');
END;

--> statement-breakpoint
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
          and run.agent_id = new.agent_id
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
BEGIN
  select raise(abort, 'Agent Skill execution proposal is stale');
END;

-- One accepted update is the transaction commit point. Its trigger creates the
-- existing writable task, canonical session, context membership, and immutable
-- audit together. Any failure aborts the whole D1 batch/statement.
--> statement-breakpoint
create trigger briar_agent_skill_execution_materialize
after update of status on briar_agent_skill_execution_proposals
when old.status = 'pending' and new.status = 'accepted'
BEGIN
  insert into briar_project_agent_task_jobs (
    id, project_id, agent_id, skill_id, request, request_id, status,
    preferred_worker_id, skill_execution_proposal_id, created_at, updated_at
  ) values (
    new.result_session_id, new.project_id, new.agent_id, new.skill_id,
    new.request, new.id, 'queued', new.requested_worker_id, new.id,
    new.accepted_at, new.accepted_at
  );

  insert into briar_project_agent_session_context_membership (
    project_id, session_id, visible_at
  ) values (new.project_id, new.result_session_id, new.accepted_at);

  insert into briar_project_agent_sessions (
    project_id, id, agent_id, status, session_type, payload_json,
    started_at, completed_at, updated_at
  ) values (
    new.project_id, new.result_session_id, new.agent_id, 'running', 'task',
    json_object(
      'dispatchGroupId', new.result_session_id,
      'agentId', new.agent_id,
      'agentName', new.agent_name,
      'skillId', new.skill_id,
      'sessionType', 'task',
      'trigger', 'manual',
      'scheduleId', null,
      'scheduleRunId', null,
      'parentSessionId', null,
      'request', new.request,
      'followUps', json('[]'),
      'status', 'running',
      'issues', json('[]'),
      'startedAt', new.accepted_at,
      'completedAt', null,
      'conversationId', null,
      'requestedWorkerId', new.requested_worker_id,
      'workerId', new.requested_worker_id,
      'summary', null,
      'error', null,
      'events', json_array(json_object(
        'id', lower(hex(randomblob(16))),
        'type', 'started',
        'occurredAt', new.accepted_at
      )),
      'updatedAt', new.accepted_at
    ),
    new.accepted_at, null, new.accepted_at
  );

  insert into briar_agent_skill_execution_approval_audit (
    id, proposal_id, organization_id, project_id, source_kind, channel_id,
    conversation_run_id, trigger_message_id, reply_message_id,
    source_reply_job_id, delegated_by_reply_job_id, agent_id, agent_name,
    agent_responsibility,
    skill_id, skill_name, skill_instructions, skill_kind,
    provider, model, effort, request,
    worker_id, worker_label, result_session_id, approved_by_user_id,
    approved_at, delegated_by_agent_id, delegated_by_agent_name, created_at
  ) values (
    new.id || ':approval:' || new.generation, new.id, new.organization_id,
    new.project_id, new.source_kind, new.channel_id, new.conversation_run_id,
    new.trigger_message_id, new.reply_message_id, new.source_reply_job_id,
    new.delegated_by_reply_job_id, new.agent_id, new.agent_name,
    new.agent_responsibility, new.skill_id,
    new.skill_name, new.skill_instructions, new.skill_kind,
    new.provider, new.model, new.effort,
    new.request, new.requested_worker_id, new.requested_worker_label,
    new.result_session_id, new.accepted_by_user_id, new.accepted_at,
    new.delegated_by_agent_id, new.delegated_by_agent_name, new.accepted_at
  );
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_audit_insert_guard
before insert on briar_agent_skill_execution_approval_audit
when not exists (
  select 1 from briar_agent_skill_execution_proposals proposal
  where proposal.id = new.proposal_id and proposal.status = 'accepted'
    and new.id = proposal.id || ':approval:' || proposal.generation
    and new.organization_id = proposal.organization_id
    and new.project_id = proposal.project_id
    and new.source_kind = proposal.source_kind
    and new.channel_id is proposal.channel_id
    and new.conversation_run_id is proposal.conversation_run_id
    and new.trigger_message_id = proposal.trigger_message_id
    and new.reply_message_id = proposal.reply_message_id
    and new.source_reply_job_id = proposal.source_reply_job_id
    and new.delegated_by_reply_job_id is proposal.delegated_by_reply_job_id
    and new.agent_id = proposal.agent_id and new.agent_name = proposal.agent_name
    and new.agent_responsibility = proposal.agent_responsibility
    and new.skill_id = proposal.skill_id and new.skill_name = proposal.skill_name
    and new.skill_instructions = proposal.skill_instructions
    and new.skill_kind = proposal.skill_kind
    and new.provider = proposal.provider and new.model is proposal.model
    and new.effort is proposal.effort and new.request = proposal.request
    and new.worker_id = proposal.requested_worker_id
    and new.worker_label = proposal.requested_worker_label
    and new.result_session_id = proposal.result_session_id
    and new.approved_by_user_id is proposal.accepted_by_user_id
    and new.approved_at = proposal.accepted_at
    and new.delegated_by_agent_id is proposal.delegated_by_agent_id
    and new.delegated_by_agent_name is proposal.delegated_by_agent_name
    and new.created_at = proposal.accepted_at
)
BEGIN
  select raise(abort, 'invalid Agent Skill execution approval audit');
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_audit_immutable_update
before update on briar_agent_skill_execution_approval_audit
when not (
  old.approved_by_user_id is not null and new.approved_by_user_id is null
  and not exists (
    select 1 from "user" account where account.id = old.approved_by_user_id
  )
  and new.id is old.id and new.proposal_id is old.proposal_id
  and new.organization_id is old.organization_id
  and new.project_id is old.project_id and new.source_kind is old.source_kind
  and new.channel_id is old.channel_id
  and new.conversation_run_id is old.conversation_run_id
  and new.trigger_message_id is old.trigger_message_id
  and new.reply_message_id is old.reply_message_id
  and new.source_reply_job_id is old.source_reply_job_id
  and new.delegated_by_reply_job_id is old.delegated_by_reply_job_id
  and new.agent_id is old.agent_id and new.agent_name is old.agent_name
  and new.agent_responsibility is old.agent_responsibility
  and new.skill_id is old.skill_id and new.skill_name is old.skill_name
  and new.skill_instructions is old.skill_instructions
  and new.skill_kind is old.skill_kind
  and new.provider is old.provider and new.model is old.model
  and new.effort is old.effort and new.request is old.request
  and new.worker_id is old.worker_id and new.worker_label is old.worker_label
  and new.result_session_id is old.result_session_id
  and new.approved_at is old.approved_at
  and new.delegated_by_agent_id is old.delegated_by_agent_id
  and new.delegated_by_agent_name is old.delegated_by_agent_name
  and new.created_at is old.created_at
)
BEGIN
  select raise(abort, 'Agent Skill execution approval audit is immutable');
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_audit_immutable_delete
before delete on briar_agent_skill_execution_approval_audit
when exists (
  select 1 from briar_organizations organization
  where organization.id = old.organization_id
)
BEGIN
  select raise(abort, 'Agent Skill execution approval audit is immutable');
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_task_claim_guard
before update of claim_token_hash on briar_project_agent_task_jobs
when new.claim_token_hash is not null
  and new.claim_token_hash is not old.claim_token_hash
  and new.skill_execution_proposal_id is not null
  and not exists (
    select 1
    from briar_agent_skill_execution_approval_audit approval
    join briar_project_agents agent
      on agent.id = approval.agent_id and agent.project_id = approval.project_id
     and agent.organization_id = approval.organization_id
    join briar_agent_skills skill
      on skill.id = approval.skill_id and skill.agent_id = approval.agent_id
    join briar_execution_workers worker
      on worker.id = new.claimed_worker_id
     and worker.project_id = approval.project_id
    join briar_execution_worker_devices device
      on device.id = worker.device_id
     and device.organization_id = approval.organization_id
    join briar_organization_members worker_owner
      on worker_owner.organization_id = device.organization_id
     and worker_owner.user_id = device.owner_user_id
    where approval.proposal_id = new.skill_execution_proposal_id
      and approval.project_id = new.project_id
      and approval.result_session_id = new.id
      and approval.agent_id = new.agent_id
      and approval.skill_id = new.skill_id
      and approval.request = new.request
      and approval.proposal_id = new.request_id
      and approval.worker_id = new.preferred_worker_id
      and approval.worker_id = new.claimed_worker_id
      and agent.name = approval.agent_name
      and agent.responsibility = approval.agent_responsibility
      and skill.name = approval.skill_name
      and skill.instructions = approval.skill_instructions
      and skill.kind = approval.skill_kind
      and skill.provider = approval.provider
      and skill.model is approval.model and skill.effort is approval.effort
      and worker.state <> 'disabled' and device.state <> 'disabled'
      and worker.accepting_work = 1
      and worker.readiness_state <> 'needs_attention'
      and julianday(worker.last_heartbeat_at) >=
        julianday(new.claimed_at, '-3 minutes')
      and julianday(device.last_heartbeat_at) >=
        julianday(new.claimed_at, '-3 minutes')
      and coalesce(json_extract(
        worker.capabilities_json,
        '$.providerHealth.' || approval.provider || '.healthy'
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
           and run.lease_expires_at > new.claimed_at
           and run.status not in (
             'backlog', 'completed', 'cancelled', 'blocked', 'failed'
           ))
        +
        (select count(*)
         from briar_project_agent_task_jobs task
         join briar_execution_workers holder
           on holder.id = task.claimed_worker_id
         where holder.device_id = device.id and task.status = 'running'
           and task.lease_expires_at > new.claimed_at)
        < device.max_concurrent_sessions
      )
  )
BEGIN
  select raise(abort, 'Agent Skill execution approval audit is missing or stale');
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_task_link_immutable
before update of skill_execution_proposal_id on briar_project_agent_task_jobs
when old.skill_execution_proposal_id is not null
  and new.skill_execution_proposal_id is not old.skill_execution_proposal_id
BEGIN
  select raise(abort, 'Agent Skill execution task linkage is immutable');
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_task_core_immutable
before update of id, project_id, agent_id, skill_id, request, request_id,
                 preferred_worker_id, created_at
on briar_project_agent_task_jobs
when old.skill_execution_proposal_id is not null
  and (
    new.id is not old.id or new.project_id is not old.project_id
    or new.agent_id is not old.agent_id or new.skill_id is not old.skill_id
    or new.request is not old.request or new.request_id is not old.request_id
    or new.preferred_worker_id is not old.preferred_worker_id
    or new.created_at is not old.created_at
  )
BEGIN
  select raise(abort, 'Agent Skill execution task core is immutable');
END;

-- Linked task terminal state and its canonical session are one durable
-- projection. The guard keeps a failed session write from consuming the
-- Worker's one-shot claim, while the AFTER trigger commits both together.
--> statement-breakpoint
create trigger briar_agent_skill_execution_task_terminal_guard
before update of status on briar_project_agent_task_jobs
when old.skill_execution_proposal_id is not null
  and old.status in ('queued', 'running')
  and new.status in ('completed', 'failed')
  and not exists (
    select 1
    from briar_agent_skill_execution_approval_audit approval
    join briar_project_agent_sessions session
      on session.project_id = approval.project_id
     and session.id = approval.result_session_id
    where approval.proposal_id = old.skill_execution_proposal_id
      and approval.project_id = old.project_id
      and approval.result_session_id = old.id
      and approval.agent_id = old.agent_id
      and approval.skill_id = old.skill_id
      and approval.request = old.request
      and approval.worker_id = old.preferred_worker_id
      and session.agent_id = approval.agent_id
      and session.session_type = 'task'
      and json_valid(session.payload_json)
      and json_extract(session.payload_json, '$.dispatchGroupId') = old.id
      and json_extract(session.payload_json, '$.agentId') = approval.agent_id
      and json_extract(session.payload_json, '$.agentName') = approval.agent_name
      and json_extract(session.payload_json, '$.skillId') = approval.skill_id
      and json_extract(session.payload_json, '$.sessionType') = 'task'
      and json_extract(session.payload_json, '$.trigger') = 'manual'
      and json_extract(session.payload_json, '$.request') = approval.request
      and json_extract(session.payload_json, '$.requestedWorkerId') =
        approval.worker_id
      and json_extract(session.payload_json, '$.workerId') = approval.worker_id
  )
BEGIN
  select raise(abort, 'Agent Skill execution session is missing or invalid');
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_task_terminal_project
after update of status on briar_project_agent_task_jobs
when old.skill_execution_proposal_id is not null
  and old.status in ('queued', 'running')
  and new.status in ('completed', 'failed')
BEGIN
  update briar_project_agent_sessions
  set status = new.status,
      payload_json = json_insert(
        json_set(
          payload_json,
          '$.status', new.status,
          '$.summary', new.result_summary,
          '$.conversationId', new.result_conversation_id,
          '$.error', new.error,
          '$.completedAt', coalesce(new.completed_at, new.updated_at),
          '$.updatedAt', new.updated_at
        ),
        '$.events[#]', json_object(
          'id', lower(hex(randomblob(16))),
          'type', new.status,
          'occurredAt', new.updated_at
        )
      ),
      completed_at = coalesce(new.completed_at, new.updated_at),
      updated_at = new.updated_at
  where project_id = new.project_id and id = new.id;
END;

-- A direct or cascading removal must not leave the immutable approved session
-- looking active after its only executable task disappears.
--> statement-breakpoint
create trigger briar_agent_skill_execution_task_delete_reconcile
before delete on briar_project_agent_task_jobs
when old.skill_execution_proposal_id is not null
  and old.status in ('queued', 'running')
BEGIN
  update briar_project_agent_sessions
  set status = 'failed',
      payload_json = json_insert(
        json_set(
          payload_json,
          '$.status', 'failed',
          '$.summary', null,
          '$.conversationId', null,
          '$.error', 'Approved Agent Skill execution authority was removed.',
          '$.completedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          '$.updatedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        '$.events[#]', json_object(
          'id', lower(hex(randomblob(16))),
          'type', 'failed',
          'occurredAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        )
      ),
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where project_id = old.project_id and id = old.id;
END;

-- Organization cascades may remove the immutable audit before the Skill's
-- ON DELETE SET NULL action runs. Remove linked task projections first so the
-- task core guard cannot turn organization/account erasure into a deadlock.
--> statement-breakpoint
create trigger briar_agent_skill_execution_organization_delete_reconcile
before delete on briar_organizations
BEGIN
  delete from briar_project_agent_task_jobs
  where skill_execution_proposal_id in (
    select proposal_id
    from briar_agent_skill_execution_approval_audit
    where organization_id = old.id
  );
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_worker_delete_reconcile
before delete on briar_execution_workers
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker binding was removed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where preferred_worker_id = old.id and status in ('queued', 'running')
    and skill_execution_proposal_id is not null;
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_worker_binding_reconcile
after update of project_id, device_id on briar_execution_workers
when new.project_id is not old.project_id or new.device_id is not old.device_id
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker binding changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where preferred_worker_id = new.id and status in ('queued', 'running')
    and skill_execution_proposal_id is not null;
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_worker_disable_reconcile
after update of state on briar_execution_workers
when old.state <> 'disabled' and new.state = 'disabled'
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker was disabled before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where preferred_worker_id = new.id and status in ('queued', 'running')
    and skill_execution_proposal_id is not null;
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_worker_membership_reconcile
before delete on briar_organization_members
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker owner lost organization access.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where status in ('queued', 'running')
    and skill_execution_proposal_id is not null
    and preferred_worker_id in (
      select worker.id
      from briar_execution_workers worker
      join briar_execution_worker_devices device on device.id = worker.device_id
      where device.organization_id = old.organization_id
        and device.owner_user_id = old.user_id
    );
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_device_authority_reconcile
after update of organization_id, owner_user_id on briar_execution_worker_devices
when new.organization_id is not old.organization_id
  or new.owner_user_id is not old.owner_user_id
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker device authority changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where status in ('queued', 'running')
    and skill_execution_proposal_id is not null
    and preferred_worker_id in (
      select id from briar_execution_workers where device_id = new.id
    );
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_device_disable_reconcile
after update of state on briar_execution_worker_devices
when old.state <> 'disabled' and new.state = 'disabled'
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker device was disabled before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where status in ('queued', 'running')
    and skill_execution_proposal_id is not null
    and preferred_worker_id in (
      select id from briar_execution_workers where device_id = new.id
    );
END;

-- Any pre-approval source or runtime change invalidates the card. Accepted
-- history remains immutable and retains Worker/Agent/Skill labels and IDs.
--> statement-breakpoint
create trigger briar_agent_skill_execution_skill_update_invalidate
after update on briar_agent_skills
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where skill_id = old.id and status = 'pending'
    and (new.agent_id <> agent_id or new.name <> skill_name
      or new.instructions <> skill_instructions or new.kind <> skill_kind
      or new.provider <> provider
      or new.model is not model or new.effort is not effort);

  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Skill changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where status in ('queued', 'running')
    and skill_execution_proposal_id in (
      select proposal_id
      from briar_agent_skill_execution_approval_audit
      where skill_id = old.id
        and (new.agent_id <> agent_id or new.name <> skill_name
          or new.instructions <> skill_instructions or new.kind <> skill_kind
          or new.provider <> provider or new.model is not model
          or new.effort is not effort)
    );
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_skill_delete_invalidate
before delete on briar_agent_skills
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where skill_id = old.id and status = 'pending';

  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Skill was removed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where status in ('queued', 'running')
    and skill_id = old.id
    and skill_execution_proposal_id is not null
    and exists (
      select 1 from briar_agent_skill_execution_approval_audit approval
      where approval.proposal_id = skill_execution_proposal_id
    );

  delete from briar_project_agent_task_jobs
  where skill_id = old.id and skill_execution_proposal_id is not null;
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_agent_delete_invalidate
before delete on briar_project_agents
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where (agent_id = old.id or delegated_by_agent_id = old.id)
    and status = 'pending';

  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Agent was removed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where status in ('queued', 'running')
    and skill_execution_proposal_id in (
      select proposal_id
      from briar_agent_skill_execution_approval_audit
      where agent_id = old.id
    );
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_agent_update_invalidate
after update of organization_id, project_id, name, responsibility
on briar_project_agents
when new.organization_id is not old.organization_id
  or new.project_id is not old.project_id
  or new.name <> old.name
  or new.responsibility <> old.responsibility
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where (agent_id = old.id or delegated_by_agent_id = old.id)
    and status = 'pending';

  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Agent changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where status in ('queued', 'running')
    and skill_execution_proposal_id in (
      select proposal_id
      from briar_agent_skill_execution_approval_audit
      where agent_id = old.id
        and (new.organization_id is not organization_id
          or new.project_id is not project_id
          or new.name <> agent_name
          or new.responsibility <> agent_responsibility)
    );
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_channel_archive_invalidate
after update of archived_at on briar_channels
when old.archived_at is null and new.archived_at is not null
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'channel' and channel_id = new.id and status = 'pending';
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_channel_roster_invalidate
after delete on briar_channel_agents
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and channel_id = old.channel_id
    and status = 'pending'
    and (agent_id = old.agent_id or delegated_by_agent_id = old.agent_id);
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_channel_message_invalidate
after update of body on briar_channel_messages
when new.body <> old.body
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'channel' and trigger_message_id = new.id
    and status = 'pending';
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_channel_message_delete_invalidate
before delete on briar_channel_messages
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and status = 'pending'
    and old.id in (trigger_message_id, reply_message_id);
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_channel_job_invalidate
after update of organization_id, channel_id, project_id, agent_id, skill_id,
                selected_skill_id_snapshot, trigger_message_id,
                reply_message_id, delegated_by_reply_job_id,
                delegation_request, status
on briar_channel_agent_reply_jobs
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'channel'
    and (source_reply_job_id = old.id or delegated_by_reply_job_id = old.id)
    and status = 'pending'
    and (new.organization_id is not old.organization_id
      or new.channel_id is not old.channel_id
      or new.project_id is not old.project_id
      or new.agent_id is not old.agent_id
      or new.skill_id is not old.skill_id
      or new.selected_skill_id_snapshot is not old.selected_skill_id_snapshot
      or new.trigger_message_id is not old.trigger_message_id
      or new.reply_message_id is not old.reply_message_id
      or new.delegated_by_reply_job_id is not old.delegated_by_reply_job_id
      or new.delegation_request is not old.delegation_request
      or new.status <> 'completed');
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_channel_job_delete_invalidate
before delete on briar_channel_agent_reply_jobs
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and status = 'pending'
    and (source_reply_job_id = old.id or delegated_by_reply_job_id = old.id);
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_issue_message_invalidate
after update of body on briar_issue_messages
when new.body <> old.body
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'issue' and trigger_message_id = new.id
    and status = 'pending';
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_issue_message_delete_invalidate
before delete on briar_issue_messages
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'issue' and status = 'pending'
    and old.id in (trigger_message_id, reply_message_id);
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_issue_job_invalidate
after update of project_id, run_id, trigger_message_id, reply_message_id,
                skill_id, selected_skill_id_snapshot, status
on briar_issue_agent_reply_jobs
BEGIN
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
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_issue_job_delete_invalidate
before delete on briar_issue_agent_reply_jobs
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'issue' and source_reply_job_id = old.id
    and status = 'pending';
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_issue_assignment_invalidate
after update of agent_id, project_id on briar_hunt_runs
when new.agent_id is not old.agent_id or new.project_id <> old.project_id
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'issue' and conversation_run_id = new.id
    and status = 'pending';
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_channel_sync_insert
after insert on briar_agent_skill_execution_proposals
when new.source_kind = 'channel'
BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'proposal', new.id, 'upsert',
    datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;

--> statement-breakpoint
create trigger briar_agent_skill_execution_channel_sync_update
after update on briar_agent_skill_execution_proposals
when new.source_kind = 'channel' and new.channel_id is not null
BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'proposal', new.id, 'upsert',
    datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
