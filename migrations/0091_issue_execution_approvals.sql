pragma foreign_keys = on;

-- A combined "create and execute" request is still two approvals. Reserve an
-- opaque execution-proposal identity with the create proposal, but do not
-- materialize it until migration 0090 has atomically created the backlog run.
-- Defaults keep pre-0091 Workers fully compatible with create-only proposals.
alter table briar_channel_action_proposals
  add column execute_after_create integer not null default 0
    check (execute_after_create in (0, 1));
alter table briar_channel_action_proposals
  add column execution_proposal_id text;
alter table briar_issue_action_proposals
  add column execute_after_create integer not null default 0
    check (execute_after_create in (0, 1));
alter table briar_issue_action_proposals
  add column execution_proposal_id text;
alter table briar_channel_agent_reply_jobs
  add column execution_target_ids_json text not null default '[]'
    check (
      json_valid(execution_target_ids_json)
      and json_type(execution_target_ids_json) = 'array'
    );

create unique index briar_channel_action_execution_proposal_idx
  on briar_channel_action_proposals (execution_proposal_id)
  where execution_proposal_id is not null;
create unique index briar_issue_action_execution_proposal_idx
  on briar_issue_action_proposals (execution_proposal_id)
  where execution_proposal_id is not null;

-- Execution approval is deliberately separate from issue creation approval.
-- Selection values and the dispatch identity do not exist until an
-- authenticated member clicks the execution approval component.
create table briar_issue_execution_proposals (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  source_kind text not null check (source_kind in ('channel', 'issue')),
  channel_id text references briar_channels (id) on delete set null,
  conversation_run_id text references briar_hunt_runs (id) on delete set null,
  trigger_message_id text not null,
  reply_message_id text not null unique,
  target_run_id text not null references briar_hunt_runs (id) on delete cascade,
  target_title text not null check (length(trim(target_title)) between 1 and 300),
  target_run_updated_at text not null,
  proposed_by_agent_id text
    references briar_project_agents (id) on delete set null,
  delegated_by_agent_id text
    references briar_project_agents (id) on delete set null,
  delegated_by_agent_name text
    check (
      delegated_by_agent_name is null
      or length(trim(delegated_by_agent_name)) between 1 and 100
    ),
  origin_create_proposal_id text,
  generation integer not null default 1 check (generation >= 1),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'invalidated')),
  approval_reserved_by_user_id text
    references "user" (id) on delete set null,
  approval_reserved_at text,
  requested_provider text check (
    requested_provider is null
    or requested_provider in ('codex', 'claude', 'grok', 'opencode')
  ),
  requested_model text check (
    requested_model is null
    or length(trim(requested_model)) between 1 and 100
  ),
  requested_effort text check (
    requested_effort is null
    or requested_effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  requested_worker_id text
    references briar_execution_workers (id) on delete set null,
  dispatch_request_id text unique,
  accepted_by_user_id text references "user" (id) on delete set null,
  accepted_at text,
  created_at text not null,
  updated_at text not null,
  check (
    status = 'invalidated'
    or (
      source_kind = 'channel' and channel_id is not null
      and conversation_run_id is null
    )
    or (
      source_kind = 'issue' and channel_id is null
      and conversation_run_id is not null
    )
  ),
  check (
    (approval_reserved_at is null
      and requested_provider is null
      and requested_model is null
      and requested_effort is null
      and requested_worker_id is null
      and dispatch_request_id is null)
    or
    (approval_reserved_at is not null
      and requested_provider is not null
      and dispatch_request_id is not null)
  )
);

create index briar_issue_execution_proposals_issue_idx
  on briar_issue_execution_proposals (
    project_id, conversation_run_id, created_at, id
  );
create index briar_issue_execution_proposals_channel_idx
  on briar_issue_execution_proposals (channel_id, created_at, id);
create index briar_issue_execution_proposals_target_idx
  on briar_issue_execution_proposals (target_run_id, status, generation);
create unique index briar_issue_execution_origin_create_idx
  on briar_issue_execution_proposals (source_kind, origin_create_proposal_id)
  where origin_create_proposal_id is not null;

-- Immutable approval evidence is not tied to the mutable proposal or run.
-- Organization erasure removes it and account erasure anonymizes the actor.
create table briar_issue_execution_approval_audit (
  id text primary key not null,
  proposal_id text not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null,
  source_kind text not null check (source_kind in ('channel', 'issue')),
  channel_id text,
  conversation_run_id text,
  run_id text not null,
  generation integer not null,
  approved_by_user_id text references "user" (id) on delete set null,
  approved_at text not null,
  provider text not null
    check (provider in ('codex', 'claude', 'grok', 'opencode')),
  model text,
  effort text check (
    effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  worker_id text,
  dispatch_request_id text not null unique,
  proposed_by_agent_id text,
  delegated_by_agent_id text,
  created_at text not null
);

create index briar_issue_execution_approval_audit_run_idx
  on briar_issue_execution_approval_audit (run_id, approved_at, id);
create index briar_issue_execution_approval_audit_proposal_idx
  on briar_issue_execution_approval_audit (proposal_id, generation);

--> statement-breakpoint
create trigger briar_channel_create_execution_intent_insert_guard
before insert on briar_channel_action_proposals
when not (
  (new.execute_after_create = 0 and new.execution_proposal_id is null)
  or (
    new.execute_after_create = 1
    and new.execution_proposal_id is not null
    and new.action_type = 'request_issue_create'
    and new.status = 'pending'
  )
)
BEGIN
  select raise(abort, 'invalid channel create execution intent');
END;

--> statement-breakpoint
create trigger briar_issue_create_execution_intent_insert_guard
before insert on briar_issue_action_proposals
when not (
  (new.execute_after_create = 0 and new.execution_proposal_id is null)
  or (
    new.execute_after_create = 1
    and new.execution_proposal_id is not null
    and new.action_type = 'request_issue_create'
    and new.status = 'pending'
  )
)
BEGIN
  select raise(abort, 'invalid issue create execution intent');
END;

--> statement-breakpoint
create trigger briar_issue_execution_proposal_insert_guard
before insert on briar_issue_execution_proposals
when not (
  new.status = 'pending' and new.generation = 1
  and new.approval_reserved_by_user_id is null
  and new.approval_reserved_at is null
  and new.requested_provider is null and new.requested_model is null
  and new.requested_effort is null and new.requested_worker_id is null
  and new.dispatch_request_id is null
  and new.accepted_by_user_id is null and new.accepted_at is null
  and exists (
    select 1
    from briar_projects project
    join briar_hunt_runs target
      on target.id = new.target_run_id and target.project_id = project.id
    where project.id = new.project_id
      and project.organization_id = new.organization_id
      and target.title = new.target_title
      and target.updated_at = new.target_run_updated_at
      and target.status = 'backlog' and target.stage = 'queued'
      and target.workflow_stage is null
      and target.worker_id is null and target.requested_worker_id is null
      and target.claim_token_hash is null and target.claimed_by is null
      and target.claimed_at is null and target.lease_expires_at is null
      and target.last_execution_id is null
      and target.dispatch_mode is null and target.dispatch_request_id is null
      and target.dispatched_at is null and target.requested_by_user_id is null
      and target.completed_at is null and target.paused_at is null
      and target.resume_requested_at is null
  )
  and (
    new.proposed_by_agent_id is null
    or exists (
      select 1 from briar_project_agents agent
      where agent.id = new.proposed_by_agent_id
        and agent.project_id = new.project_id
        and agent.organization_id = new.organization_id
    )
  )
  and (
    (
      new.source_kind = 'channel'
      and new.proposed_by_agent_id is not null
      and exists (
        select 1
        from briar_channels channel
        join briar_channel_messages reply
          on reply.id = new.reply_message_id
         and reply.channel_id = channel.id
        join briar_channel_agents roster
          on roster.channel_id = channel.id
         and roster.agent_id = new.proposed_by_agent_id
        where channel.id = new.channel_id
          and channel.organization_id = new.organization_id
          and reply.author_agent_id = new.proposed_by_agent_id
      )
      and (
        (new.origin_create_proposal_id is null)
        or exists (
          select 1 from briar_channel_action_proposals origin
          where origin.id = new.origin_create_proposal_id
            and origin.channel_id = new.channel_id
            and origin.reply_message_id = new.reply_message_id
            and origin.result_run_id = new.target_run_id
            and origin.execution_proposal_id = new.id
            and origin.execute_after_create = 1
            and origin.status = 'accepted'
        )
      )
    )
    or
    (
      new.source_kind = 'issue'
      and exists (
        select 1
        from briar_hunt_runs conversation
        join briar_issue_messages reply
          on reply.id = new.reply_message_id
         and reply.run_id = conversation.id
         and reply.project_id = conversation.project_id
        where conversation.id = new.conversation_run_id
          and conversation.project_id = new.project_id
      )
      and (
        (
          new.origin_create_proposal_id is null
          and new.target_run_id = new.conversation_run_id
        )
        or exists (
          select 1 from briar_issue_action_proposals origin
          where origin.id = new.origin_create_proposal_id
            and origin.conversation_run_id = new.conversation_run_id
            and origin.reply_message_id = new.reply_message_id
            and origin.result_run_id = new.target_run_id
            and origin.execution_proposal_id = new.id
            and origin.execute_after_create = 1
            and origin.status = 'accepted'
        )
      )
    )
  )
)
BEGIN
  select raise(abort, 'invalid issue execution proposal');
END;

--> statement-breakpoint
create trigger briar_issue_execution_reserved_proposal_delete_guard
before delete on briar_issue_execution_proposals
when old.status = 'pending' and old.dispatch_request_id is not null
  and exists (
    select 1 from briar_organizations organization
    where organization.id = old.organization_id
  )
  and exists (
    select 1 from briar_projects project where project.id = old.project_id
  )
  and exists (
    select 1 from briar_hunt_runs run where run.id = old.target_run_id
  )
BEGIN
  select raise(abort, 'reserved execution proposal cannot be deleted');
END;

--> statement-breakpoint
create trigger briar_issue_execution_proposal_identity_immutable
before update on briar_issue_execution_proposals
when new.id is not old.id
  or new.organization_id is not old.organization_id
  or new.project_id is not old.project_id
  or new.source_kind is not old.source_kind
  or not (
    new.channel_id is old.channel_id
    or (
      old.channel_id is not null and new.channel_id is null
      and not exists (
        select 1 from briar_channels channel where channel.id = old.channel_id
      )
    )
  )
  or not (
    new.conversation_run_id is old.conversation_run_id
    or (
      old.conversation_run_id is not null and new.conversation_run_id is null
      and not exists (
        select 1 from briar_hunt_runs run
        where run.id = old.conversation_run_id
      )
    )
  )
  or new.trigger_message_id is not old.trigger_message_id
  or new.reply_message_id is not old.reply_message_id
  or new.target_run_id is not old.target_run_id
  or new.target_title is not old.target_title
  or new.target_run_updated_at is not old.target_run_updated_at
  or not (
    new.proposed_by_agent_id is old.proposed_by_agent_id
    or (old.proposed_by_agent_id is not null
        and new.proposed_by_agent_id is null
        and not exists (
          select 1 from briar_project_agents agent
          where agent.id = old.proposed_by_agent_id
        ))
  )
  or not (
    new.delegated_by_agent_id is old.delegated_by_agent_id
    or (old.delegated_by_agent_id is not null
        and new.delegated_by_agent_id is null
        and not exists (
          select 1 from briar_project_agents agent
          where agent.id = old.delegated_by_agent_id
        ))
  )
  or new.delegated_by_agent_name is not old.delegated_by_agent_name
  or new.origin_create_proposal_id is not old.origin_create_proposal_id
  or new.created_at is not old.created_at
BEGIN
  select raise(abort, 'issue execution proposal identity is immutable');
END;

--> statement-breakpoint
create trigger briar_issue_execution_proposal_status_guard
before update of status, generation on briar_issue_execution_proposals
when not (
  (new.status = old.status and new.generation = old.generation)
  or (
    old.status = 'pending' and new.status = 'accepted'
    and new.generation = old.generation
  )
  or (
    old.status in ('pending', 'accepted')
    and new.status = 'invalidated'
    and new.generation = old.generation + 1
  )
)
BEGIN
  select raise(abort, 'invalid issue execution proposal transition');
END;

--> statement-breakpoint
create trigger briar_issue_execution_proposal_reservation_immutable
before update of approval_reserved_by_user_id, approval_reserved_at,
                 requested_provider, requested_model, requested_effort,
                 requested_worker_id, dispatch_request_id
on briar_issue_execution_proposals
when old.dispatch_request_id is not null
  and not (
    (
      new.approval_reserved_by_user_id is old.approval_reserved_by_user_id
      or (
        old.approval_reserved_by_user_id is not null
        and new.approval_reserved_by_user_id is null
        and not exists (
          select 1 from "user" account
          where account.id = old.approval_reserved_by_user_id
        )
      )
    )
    and new.approval_reserved_at is old.approval_reserved_at
    and new.requested_provider is old.requested_provider
    and new.requested_model is old.requested_model
    and new.requested_effort is old.requested_effort
    and (
      new.requested_worker_id is old.requested_worker_id
      or (
        old.requested_worker_id is not null
        and new.requested_worker_id is null
        and not exists (
          select 1 from briar_execution_workers worker
          where worker.id = old.requested_worker_id
        )
      )
    )
    and new.dispatch_request_id is old.dispatch_request_id
  )
BEGIN
  select raise(abort, 'issue execution approval reservation is immutable');
END;

--> statement-breakpoint
create trigger briar_issue_execution_proposal_deleted_approver_invalidate
after update of approval_reserved_by_user_id
on briar_issue_execution_proposals
when old.approval_reserved_by_user_id is not null
  and new.approval_reserved_by_user_id is null
  and new.status <> 'invalidated'
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where id = new.id and status <> 'invalidated';
END;

--> statement-breakpoint
create trigger briar_issue_execution_proposal_deleted_agent_invalidate
after update of proposed_by_agent_id
on briar_issue_execution_proposals
when old.proposed_by_agent_id is not null
  and new.proposed_by_agent_id is null
  and new.status <> 'invalidated'
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where id = new.id and status <> 'invalidated';
END;

--> statement-breakpoint
create trigger briar_issue_execution_proposal_deleted_delegator_invalidate
after update of delegated_by_agent_id
on briar_issue_execution_proposals
when old.delegated_by_agent_id is not null
  and new.delegated_by_agent_id is null
  and new.status <> 'invalidated'
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where id = new.id and status <> 'invalidated';
END;

--> statement-breakpoint
create trigger briar_issue_execution_proposal_deleted_worker_invalidate
after update of requested_worker_id
on briar_issue_execution_proposals
when old.requested_worker_id is not null
  and new.requested_worker_id is null
  and new.status <> 'invalidated'
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where id = new.id and status <> 'invalidated';
END;

-- Source deletion revokes a still-live execution card but deliberately keeps
-- its opaque dispatch identity. The later FK SET NULL therefore leaves a
-- durable tombstone that the run dispatch guard can reject instead of making
-- its WHEN clause disappear through a cascade.
--> statement-breakpoint
create trigger briar_issue_execution_organization_delete_invalidate
before delete on briar_organizations
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where organization_id = old.id and status <> 'invalidated';
END;

--> statement-breakpoint
create trigger briar_issue_execution_project_delete_invalidate
before delete on briar_projects
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where project_id = old.id and status <> 'invalidated';
END;

--> statement-breakpoint
create trigger briar_issue_execution_channel_delete_invalidate
before delete on briar_channels
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and channel_id = old.id
    and status <> 'invalidated';
END;

--> statement-breakpoint
create trigger briar_issue_execution_conversation_delete_invalidate
before delete on briar_hunt_runs
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'issue' and conversation_run_id = old.id
    and status <> 'invalidated';
END;

--> statement-breakpoint
create trigger briar_issue_execution_channel_roster_remove_invalidate
after delete on briar_channel_agents
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and channel_id = old.channel_id
    and status = 'pending'
    and (
      proposed_by_agent_id = old.agent_id
      or delegated_by_agent_id = old.agent_id
    );
END;

--> statement-breakpoint
create trigger briar_issue_execution_channel_archive_invalidate
after update of archived_at on briar_channels
when old.archived_at is null and new.archived_at is not null
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'channel' and channel_id = new.id
    and status = 'pending';
END;

--> statement-breakpoint
create trigger briar_issue_execution_channel_private_invalidate
after update of visibility on briar_channels
when old.visibility = 'public' and new.visibility = 'private'
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'channel' and channel_id = new.id
    and status = 'pending'
    and approval_reserved_by_user_id is not null
    and not exists (
      select 1 from briar_channel_members member
      where member.channel_id = new.id
        and member.user_id = approval_reserved_by_user_id
    );
END;

--> statement-breakpoint
create trigger briar_issue_execution_org_member_remove_invalidate
after delete on briar_organization_members
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where organization_id = old.organization_id and status = 'pending'
    and approval_reserved_by_user_id = old.user_id;
END;

--> statement-breakpoint
create trigger briar_issue_execution_private_member_remove_invalidate
after delete on briar_channel_members
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and channel_id = old.channel_id
    and status = 'pending'
    and approval_reserved_by_user_id = old.user_id
    and exists (
      select 1 from briar_channels channel
      where channel.id = old.channel_id and channel.visibility = 'private'
    );
END;

-- Removing an identity selected by an already-committed conversational
-- approval must not silently reinterpret that approval. Retryable, unclaimed
-- work returns to a clean backlog before FK actions anonymize the child rows.
--> statement-breakpoint
create trigger briar_issue_execution_agent_delete_run_reset
before delete on briar_project_agents
BEGIN
  update briar_hunt_runs
  set status = 'backlog', stage = 'queued', workflow_stage = null,
      agent_id = null, worker_id = null, requested_worker_id = null,
      claim_token_hash = null, claimed_by = null, claimed_at = null,
      lease_expires_at = null, claim_attempts = 0, last_execution_id = null,
      dispatch_mode = null, dispatch_request_id = null, dispatched_at = null,
      requested_by_user_id = null, requested_agent_provider = null,
      requested_agent_model = null, requested_agent_effort = null,
      paused_at = null, resume_requested_at = null, completed_at = null,
      detail = '승인에 연결된 Agent가 삭제되어 새 실행 승인이 필요합니다.',
      updated_at = datetime('now'), last_event_at = datetime('now')
  where status in ('queued', 'blocked', 'failed')
    and dispatch_request_id is not null
    and (
      exists (
        select 1 from briar_issue_execution_proposals proposal
        where proposal.target_run_id = briar_hunt_runs.id
          and proposal.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and old.id in (
            proposal.proposed_by_agent_id, proposal.delegated_by_agent_id
          )
      )
      or exists (
        select 1 from briar_issue_execution_approval_audit approval
        where approval.run_id = briar_hunt_runs.id
          and approval.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and old.id in (
            approval.proposed_by_agent_id, approval.delegated_by_agent_id
          )
      )
    );
END;

--> statement-breakpoint
create trigger briar_issue_execution_worker_delete_run_reset
before delete on briar_execution_workers
BEGIN
  update briar_hunt_runs
  set status = 'backlog', stage = 'queued', workflow_stage = null,
      agent_id = null, worker_id = null, requested_worker_id = null,
      claim_token_hash = null, claimed_by = null, claimed_at = null,
      lease_expires_at = null, claim_attempts = 0, last_execution_id = null,
      dispatch_mode = null, dispatch_request_id = null, dispatched_at = null,
      requested_by_user_id = null, requested_agent_provider = null,
      requested_agent_model = null, requested_agent_effort = null,
      paused_at = null, resume_requested_at = null, completed_at = null,
      detail = '승인에서 선택한 Worker가 삭제되어 새 실행 승인이 필요합니다.',
      updated_at = datetime('now'), last_event_at = datetime('now')
  where status in ('queued', 'blocked', 'failed')
    and dispatch_request_id is not null
    and (
      exists (
        select 1 from briar_issue_execution_proposals proposal
        where proposal.target_run_id = briar_hunt_runs.id
          and proposal.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and proposal.requested_worker_id = old.id
      )
      or exists (
        select 1 from briar_issue_execution_approval_audit approval
        where approval.run_id = briar_hunt_runs.id
          and approval.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and approval.worker_id = old.id
      )
    );
END;

--> statement-breakpoint
create trigger briar_issue_execution_approver_delete_run_reset
before delete on "user"
BEGIN
  update briar_hunt_runs
  set status = 'backlog', stage = 'queued', workflow_stage = null,
      agent_id = null, worker_id = null, requested_worker_id = null,
      claim_token_hash = null, claimed_by = null, claimed_at = null,
      lease_expires_at = null, claim_attempts = 0, last_execution_id = null,
      dispatch_mode = null, dispatch_request_id = null, dispatched_at = null,
      requested_by_user_id = null, requested_agent_provider = null,
      requested_agent_model = null, requested_agent_effort = null,
      paused_at = null, resume_requested_at = null, completed_at = null,
      detail = '실행 승인 계정이 삭제되어 새 실행 승인이 필요합니다.',
      updated_at = datetime('now'), last_event_at = datetime('now')
  where status in ('queued', 'blocked', 'failed')
    and dispatch_request_id is not null
    and (
      exists (
        select 1 from briar_issue_execution_proposals proposal
        where proposal.target_run_id = briar_hunt_runs.id
          and proposal.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and old.id in (
            proposal.approval_reserved_by_user_id,
            proposal.accepted_by_user_id
          )
      )
      or exists (
        select 1 from briar_issue_execution_approval_audit approval
        where approval.run_id = briar_hunt_runs.id
          and approval.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and approval.approved_by_user_id = old.id
      )
    );
END;

--> statement-breakpoint
create trigger briar_issue_execution_proposal_acceptance_immutable
before update of accepted_by_user_id, accepted_at
on briar_issue_execution_proposals
when not (
  (
    old.status = 'pending' and new.status = 'accepted'
    and old.accepted_by_user_id is null and old.accepted_at is null
    and new.accepted_by_user_id is old.approval_reserved_by_user_id
    and new.accepted_at = old.approval_reserved_at
  )
  or (
    old.status in ('accepted', 'invalidated')
    and new.status = old.status
    and old.accepted_by_user_id is not null
    and new.accepted_by_user_id is null
    and not exists (
      select 1 from "user" account
      where account.id = old.accepted_by_user_id
    )
    and new.accepted_at is old.accepted_at
  )
  or (
    new.accepted_by_user_id is old.accepted_by_user_id
    and new.accepted_at is old.accepted_at
  )
)
BEGIN
  select raise(abort, 'issue execution proposal acceptance is immutable');
END;

--> statement-breakpoint
create trigger briar_issue_execution_approval_audit_insert_guard
before insert on briar_issue_execution_approval_audit
when not exists (
  select 1
  from briar_issue_execution_proposals proposal
  where proposal.id = new.proposal_id
    and proposal.status = 'accepted'
    and new.id = proposal.id || ':approval:' || proposal.generation
    and new.organization_id = proposal.organization_id
    and new.project_id = proposal.project_id
    and new.source_kind = proposal.source_kind
    and new.channel_id is proposal.channel_id
    and new.conversation_run_id is proposal.conversation_run_id
    and new.run_id = proposal.target_run_id
    and new.generation = proposal.generation
    and new.approved_by_user_id is proposal.accepted_by_user_id
    and new.approved_at = proposal.accepted_at
    and new.provider = proposal.requested_provider
    and new.model is proposal.requested_model
    and new.effort is proposal.requested_effort
    and new.worker_id is proposal.requested_worker_id
    and new.dispatch_request_id = proposal.dispatch_request_id
    and new.proposed_by_agent_id is proposal.proposed_by_agent_id
    and new.delegated_by_agent_id is proposal.delegated_by_agent_id
    and new.created_at = proposal.accepted_at
)
BEGIN
  select raise(abort, 'invalid issue execution approval audit');
END;

--> statement-breakpoint
create trigger briar_issue_execution_approval_audit_immutable_update
before update on briar_issue_execution_approval_audit
when not (
  old.approved_by_user_id is not null
  and new.approved_by_user_id is null
  and not exists (
    select 1 from "user" account
    where account.id = old.approved_by_user_id
  )
  and new.id is old.id
  and new.proposal_id is old.proposal_id
  and new.organization_id is old.organization_id
  and new.project_id is old.project_id
  and new.source_kind is old.source_kind
  and new.channel_id is old.channel_id
  and new.conversation_run_id is old.conversation_run_id
  and new.run_id is old.run_id
  and new.generation is old.generation
  and new.approved_at is old.approved_at
  and new.provider is old.provider
  and new.model is old.model
  and new.effort is old.effort
  and new.worker_id is old.worker_id
  and new.dispatch_request_id is old.dispatch_request_id
  and new.proposed_by_agent_id is old.proposed_by_agent_id
  and new.delegated_by_agent_id is old.delegated_by_agent_id
  and new.created_at is old.created_at
)
BEGIN
  select raise(abort, 'issue execution approval audit is immutable');
END;

--> statement-breakpoint
create trigger briar_issue_execution_approval_audit_immutable_delete
before delete on briar_issue_execution_approval_audit
when exists (
  select 1 from briar_organizations organization
  where organization.id = old.organization_id
)
BEGIN
  select raise(abort, 'issue execution approval audit is immutable');
END;

-- A conversational dispatch is claimable only after its immutable approval
-- evidence committed. This keeps a repaired pre-atomic crash gap fail-closed.
--> statement-breakpoint
create trigger briar_issue_execution_claim_approval_guard
before update of claim_token_hash on briar_hunt_runs
when old.claim_token_hash is null and new.claim_token_hash is not null
  and new.dispatch_request_id is not null
  and (
    exists (
      select 1 from briar_issue_execution_proposals proposal
      where proposal.dispatch_request_id = new.dispatch_request_id
    )
    or exists (
      select 1 from briar_issue_execution_approval_audit approval
      where approval.dispatch_request_id = new.dispatch_request_id
    )
  )
  and not exists (
    select 1 from briar_issue_execution_approval_audit approval
    where approval.project_id = new.project_id
      and approval.run_id = new.id
      and approval.dispatch_request_id = new.dispatch_request_id
      and approval.provider = new.requested_agent_provider
      and approval.model is new.requested_agent_model
      and approval.effort is new.requested_agent_effort
      and approval.worker_id is new.requested_worker_id
      and approval.approved_by_user_id is new.requested_by_user_id
      and approval.proposed_by_agent_id is new.agent_id
  )
BEGIN
  select raise(abort, 'conversational execution approval audit is missing');
END;

-- The opaque identity reserved by a create proposal is immutable. An old
-- Worker sees only the default columns and continues to complete create-only
-- approvals without learning or consuming execution authority.
--> statement-breakpoint
create trigger briar_channel_create_execution_intent_immutable
before update of execute_after_create, execution_proposal_id
on briar_channel_action_proposals
when old.execute_after_create <> new.execute_after_create
  or old.execution_proposal_id is not new.execution_proposal_id
BEGIN
  select raise(abort, 'channel create execution intent is immutable');
END;

--> statement-breakpoint
create trigger briar_issue_create_execution_intent_immutable
before update of execute_after_create, execution_proposal_id
on briar_issue_action_proposals
when old.execute_after_create <> new.execute_after_create
  or old.execution_proposal_id is not new.execution_proposal_id
BEGIN
  select raise(abort, 'issue create execution intent is immutable');
END;

-- The migration itself never creates an execution proposal. Only a later
-- pending -> accepted create approval carrying an opaque server identity can
-- materialize one, and it remains pending for a second explicit click.
--> statement-breakpoint
create trigger briar_channel_create_materialize_execution_proposal
after update of status on briar_channel_action_proposals
when old.status = 'pending' and new.status = 'accepted'
  and new.action_type = 'request_issue_create'
  and new.execute_after_create = 1
  and new.execution_proposal_id is not null
  and new.result_run_id is not null
BEGIN
  insert into briar_issue_execution_proposals (
    id, organization_id, project_id, source_kind, channel_id,
    conversation_run_id, trigger_message_id, reply_message_id,
    target_run_id, target_title, target_run_updated_at,
    proposed_by_agent_id, delegated_by_agent_id, delegated_by_agent_name,
    origin_create_proposal_id, created_at, updated_at
  )
  select new.execution_proposal_id, channel.organization_id, new.project_id,
         'channel', new.channel_id, null, new.trigger_message_id,
         new.reply_message_id, run.id, run.title, run.updated_at,
         reply.author_agent_id, parent.agent_id, parent_agent.name,
         new.id, new.accepted_at, new.accepted_at
  from briar_hunt_runs run
  join briar_channels channel on channel.id = new.channel_id
  join briar_channel_messages reply on reply.id = new.reply_message_id
  left join briar_channel_agent_reply_jobs child
    on child.reply_message_id = new.reply_message_id
  left join briar_channel_agent_reply_jobs parent
    on parent.id = child.delegated_by_reply_job_id
  left join briar_project_agents parent_agent on parent_agent.id = parent.agent_id
  where run.id = new.result_run_id and run.project_id = new.project_id
    and run.status = 'backlog' and run.stage = 'queued'
    and run.dispatch_request_id is null and run.claim_token_hash is null
  on conflict (id) do nothing;

  select raise(abort, 'channel execution proposal was not materialized')
  where not exists (
    select 1
    from briar_issue_execution_proposals proposal
    join briar_channels channel on channel.id = new.channel_id
    where proposal.id = new.execution_proposal_id
      and proposal.organization_id = channel.organization_id
      and proposal.project_id = new.project_id
      and proposal.source_kind = 'channel'
      and proposal.channel_id = new.channel_id
      and proposal.conversation_run_id is null
      and proposal.trigger_message_id = new.trigger_message_id
      and proposal.reply_message_id = new.reply_message_id
      and proposal.target_run_id = new.result_run_id
      and proposal.origin_create_proposal_id = new.id
      and proposal.status = 'pending'
      and proposal.dispatch_request_id is null
  );
END;

--> statement-breakpoint
create trigger briar_issue_create_materialize_execution_proposal
after update of status on briar_issue_action_proposals
when old.status = 'pending' and new.status = 'accepted'
  and new.action_type = 'request_issue_create'
  and new.execute_after_create = 1
  and new.execution_proposal_id is not null
  and new.result_run_id is not null
BEGIN
  insert into briar_issue_execution_proposals (
    id, organization_id, project_id, source_kind, channel_id,
    conversation_run_id, trigger_message_id, reply_message_id,
    target_run_id, target_title, target_run_updated_at,
    proposed_by_agent_id, delegated_by_agent_id, delegated_by_agent_name,
    origin_create_proposal_id, created_at, updated_at
  )
  select new.execution_proposal_id, project.organization_id, new.project_id,
         'issue', null, new.conversation_run_id, new.trigger_message_id,
         new.reply_message_id, run.id, run.title, run.updated_at,
         conversation.agent_id, null, null, new.id,
         new.accepted_at, new.accepted_at
  from briar_hunt_runs run
  join briar_hunt_runs conversation
    on conversation.id = new.conversation_run_id
   and conversation.project_id = new.project_id
  join briar_projects project on project.id = new.project_id
  where run.id = new.result_run_id and run.project_id = new.project_id
    and run.status = 'backlog' and run.stage = 'queued'
    and run.dispatch_request_id is null and run.claim_token_hash is null
  on conflict (id) do nothing;

  select raise(abort, 'issue execution proposal was not materialized')
  where not exists (
    select 1
    from briar_issue_execution_proposals proposal
    where proposal.id = new.execution_proposal_id
      and proposal.project_id = new.project_id
      and proposal.source_kind = 'issue'
      and proposal.channel_id is null
      and proposal.conversation_run_id = new.conversation_run_id
      and proposal.trigger_message_id = new.trigger_message_id
      and proposal.reply_message_id = new.reply_message_id
      and proposal.target_run_id = new.result_run_id
      and proposal.origin_create_proposal_id = new.id
      and proposal.status = 'pending'
      and proposal.dispatch_request_id is null
  );
END;

-- A proposal dispatch is permitted only from the exact untouched fresh
-- backlog generation that the Project Agent proposed and the member approved.
--> statement-breakpoint
create trigger briar_issue_execution_proposal_dispatch_guard
before update of dispatch_request_id on briar_hunt_runs
when new.dispatch_request_id is not null
  and new.dispatch_request_id is not old.dispatch_request_id
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
  )
  and not exists (
    select 1
    from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.status = 'pending'
      and proposal.organization_id = (
        select project.organization_id from briar_projects project
        where project.id = old.project_id
      )
      and proposal.project_id = old.project_id
      and proposal.target_run_id = old.id
      and proposal.target_run_updated_at = old.updated_at
      and proposal.approval_reserved_by_user_id is not null
      and proposal.approval_reserved_at is not null
      and proposal.requested_provider is not null
      and old.status = 'backlog' and old.stage = 'queued'
      and old.workflow_stage is null
      and old.worker_id is null and old.requested_worker_id is null
      and old.claim_token_hash is null and old.claimed_by is null
      and old.claimed_at is null and old.lease_expires_at is null
      and old.last_execution_id is null
      and old.dispatch_mode is null and old.dispatch_request_id is null
      and old.dispatched_at is null and old.requested_by_user_id is null
      and old.completed_at is null and old.paused_at is null
      and old.resume_requested_at is null
      and new.status = 'queued' and new.stage = 'queued'
      and new.workflow_stage is null
      and new.requested_by_user_id = proposal.approval_reserved_by_user_id
      and new.requested_agent_provider = proposal.requested_provider
      and new.requested_agent_model is proposal.requested_model
      and new.requested_agent_effort is proposal.requested_effort
      and new.requested_worker_id is proposal.requested_worker_id
      and new.dispatch_mode = iif(
        proposal.requested_worker_id is null, 'any', 'specific'
      )
      and new.dispatched_at = proposal.approval_reserved_at
  )
BEGIN
  select raise(abort, 'execution proposal target is stale');
END;

--> statement-breakpoint
create trigger briar_issue_execution_dispatch_agent_guard
before update of dispatch_request_id on briar_hunt_runs
when new.dispatch_request_id is not null
  and new.dispatch_request_id is not old.dispatch_request_id
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
  )
  and not exists (
    select 1
    from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.status = 'pending'
      and (
        proposal.proposed_by_agent_id is null
        or (
          new.agent_id = proposal.proposed_by_agent_id
          and exists (
            select 1 from briar_project_agents agent
            where agent.id = proposal.proposed_by_agent_id
              and agent.project_id = proposal.project_id
              and agent.organization_id = proposal.organization_id
          )
        )
      )
  )
BEGIN
  select raise(abort, 'execution proposal Agent is stale');
END;

--> statement-breakpoint
create trigger briar_issue_execution_dispatch_issue_source_guard
before update of dispatch_request_id on briar_hunt_runs
when new.dispatch_request_id is not null
  and new.dispatch_request_id is not old.dispatch_request_id
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.source_kind = 'issue'
  )
  and not exists (
    select 1
    from briar_issue_execution_proposals proposal
    join briar_hunt_runs conversation
      on conversation.id = proposal.conversation_run_id
     and conversation.project_id = proposal.project_id
    join briar_issue_messages reply
      on reply.id = proposal.reply_message_id
     and reply.run_id = conversation.id
     and reply.project_id = conversation.project_id
    join briar_projects project on project.id = conversation.project_id
    join briar_organization_members membership
      on membership.organization_id = project.organization_id
     and membership.user_id = proposal.approval_reserved_by_user_id
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.status = 'pending' and proposal.source_kind = 'issue'
      and project.organization_id = proposal.organization_id
  )
BEGIN
  select raise(abort, 'issue execution proposal source is stale');
END;

--> statement-breakpoint
create trigger briar_issue_execution_dispatch_channel_source_guard
before update of dispatch_request_id on briar_hunt_runs
when new.dispatch_request_id is not null
  and new.dispatch_request_id is not old.dispatch_request_id
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.source_kind = 'channel'
  )
  and not exists (
    select 1
    from briar_issue_execution_proposals proposal
    join briar_channels channel on channel.id = proposal.channel_id
    join briar_organization_members membership
      on membership.organization_id = channel.organization_id
     and membership.user_id = proposal.approval_reserved_by_user_id
    join briar_channel_messages reply
      on reply.id = proposal.reply_message_id
     and reply.channel_id = channel.id
    join briar_project_agents agent
      on agent.id = proposal.proposed_by_agent_id
     and agent.id = reply.author_agent_id
     and agent.project_id = proposal.project_id
     and agent.organization_id = proposal.organization_id
    join briar_channel_agents roster
      on roster.channel_id = channel.id and roster.agent_id = agent.id
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.status = 'pending' and proposal.source_kind = 'channel'
      and channel.organization_id = proposal.organization_id
      and channel.archived_at is null
      and (
        channel.visibility = 'public'
        or exists (
          select 1 from briar_channel_members channel_member
          where channel_member.channel_id = channel.id
            and channel_member.user_id = proposal.approval_reserved_by_user_id
        )
      )
      and (
        proposal.delegated_by_agent_id is null
        or exists (
          select 1
          from briar_project_agents source_agent
          join briar_channel_agents source_roster
            on source_roster.channel_id = channel.id
           and source_roster.agent_id = source_agent.id
          join briar_channel_agent_reply_jobs child
            on child.reply_message_id = proposal.reply_message_id
          join briar_channel_agent_reply_jobs parent
            on parent.id = child.delegated_by_reply_job_id
           and parent.agent_id = source_agent.id
          where source_agent.id = proposal.delegated_by_agent_id
            and source_agent.organization_id = proposal.organization_id
            and source_agent.project_id is null
        )
      )
  )
BEGIN
  select raise(abort, 'channel execution proposal source is stale');
END;

-- dispatchHuntRun already writes the run mutation and its durable execution
-- audit in one D1 batch. Validate that audit against the reserved proposal,
-- then use it as the in-transaction commit point for the second approval.
--> statement-breakpoint
create trigger briar_issue_execution_dispatch_audit_guard
before insert on briar_execution_audit_events
when new.request_id is not null
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.request_id
  )
  and not exists (
    select 1
    from briar_issue_execution_proposals proposal
    join briar_hunt_runs run
      on run.id = proposal.target_run_id
     and run.project_id = proposal.project_id
    where proposal.dispatch_request_id = new.request_id
      and proposal.status = 'pending'
      and proposal.approval_reserved_by_user_id is not null
      and proposal.approval_reserved_at is not null
      and new.action = 'dispatched'
      and new.organization_id = proposal.organization_id
      and new.project_id = proposal.project_id
      and new.run_id = proposal.target_run_id
      and new.worker_id is proposal.requested_worker_id
      and new.agent_id is proposal.proposed_by_agent_id
      and new.actor_user_id is proposal.approval_reserved_by_user_id
      and new.occurred_at = proposal.approval_reserved_at
      and run.dispatch_request_id = proposal.dispatch_request_id
      and run.dispatched_at = proposal.approval_reserved_at
      and run.requested_by_user_id = proposal.approval_reserved_by_user_id
      and run.requested_agent_provider = proposal.requested_provider
      and run.requested_agent_model is proposal.requested_model
      and run.requested_agent_effort is proposal.requested_effort
      and run.requested_worker_id is proposal.requested_worker_id
  )
BEGIN
  select raise(abort, 'invalid issue execution dispatch audit');
END;

--> statement-breakpoint
create trigger briar_issue_execution_dispatch_finalize
after insert on briar_execution_audit_events
when new.action = 'dispatched' and new.request_id is not null
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.request_id
  )
BEGIN
  update briar_issue_execution_proposals
  set status = 'accepted',
      accepted_by_user_id = approval_reserved_by_user_id,
      accepted_at = approval_reserved_at,
      updated_at = approval_reserved_at
  where dispatch_request_id = new.request_id and status = 'pending'
    and organization_id = new.organization_id
    and project_id = new.project_id and target_run_id = new.run_id
    and approval_reserved_by_user_id is new.actor_user_id
    and approval_reserved_at = new.occurred_at;

  select raise(abort, 'execution approval was not finalized')
  where changes() <> 1;
END;

--> statement-breakpoint
create trigger briar_issue_execution_proposal_accept_guard
before update of status on briar_issue_execution_proposals
when old.status = 'pending' and new.status = 'accepted'
  and not (
    old.approval_reserved_by_user_id is not null
    and old.approval_reserved_at is not null
    and old.dispatch_request_id is not null
    and new.accepted_by_user_id is old.approval_reserved_by_user_id
    and new.accepted_at = old.approval_reserved_at
    and new.generation = old.generation
    and exists (
      select 1 from briar_hunt_runs run
      where run.id = old.target_run_id and run.project_id = old.project_id
        and run.dispatch_request_id = old.dispatch_request_id
        and run.dispatched_at = old.approval_reserved_at
        and run.requested_by_user_id = old.approval_reserved_by_user_id
        and run.requested_agent_provider = old.requested_provider
        and run.requested_agent_model is old.requested_model
        and run.requested_agent_effort is old.requested_effort
        and run.requested_worker_id is old.requested_worker_id
    )
    and exists (
      select 1 from briar_execution_audit_events audit
      where audit.organization_id = old.organization_id
        and audit.project_id = old.project_id
        and audit.run_id = old.target_run_id
        and audit.request_id = old.dispatch_request_id
        and audit.actor_user_id is old.approval_reserved_by_user_id
        and audit.action = 'dispatched'
    )
  )
BEGIN
  select raise(abort, 'execution proposal acceptance requires dispatch audit');
END;

--> statement-breakpoint
create trigger briar_issue_execution_proposal_audit_insert
after update of status on briar_issue_execution_proposals
when old.status = 'pending' and new.status = 'accepted'
BEGIN
  insert into briar_issue_execution_approval_audit (
    id, proposal_id, organization_id, project_id, source_kind, channel_id,
    conversation_run_id, run_id, generation, approved_by_user_id,
    approved_at, provider, model, effort, worker_id, dispatch_request_id,
    proposed_by_agent_id, delegated_by_agent_id, created_at
  ) values (
    new.id || ':approval:' || new.generation, new.id, new.organization_id,
    new.project_id, new.source_kind, new.channel_id,
    new.conversation_run_id, new.target_run_id, new.generation,
    new.accepted_by_user_id, new.accepted_at, new.requested_provider,
    new.requested_model, new.requested_effort, new.requested_worker_id,
    new.dispatch_request_id, new.proposed_by_agent_id,
    new.delegated_by_agent_id, new.accepted_at
  );
END;

-- Rolling old Workers must not erase a conversational dispatch while leaving
-- the issue executable. Both a reserved proposal (partial old flow) and the
-- immutable approval audit (committed flow) are authoritative evidence.
--> statement-breakpoint
create trigger briar_issue_execution_dispatch_clear_guard
before update of dispatch_request_id, status on briar_hunt_runs
when old.dispatch_request_id is not null
  and new.dispatch_request_id is null
  and new.status not in ('completed', 'cancelled')
  and (
    exists (
      select 1 from briar_issue_execution_proposals proposal
      where proposal.target_run_id = old.id
        and proposal.project_id = old.project_id
        and proposal.dispatch_request_id = old.dispatch_request_id
    )
    or exists (
      select 1 from briar_issue_execution_approval_audit approval
      where approval.run_id = old.id
        and approval.project_id = old.project_id
        and approval.dispatch_request_id = old.dispatch_request_id
    )
  )
  and not (
    new.status = 'backlog' and new.stage = 'queued'
    and new.workflow_stage is null
    and new.agent_id is null
    and new.worker_id is null and new.requested_worker_id is null
    and new.claim_token_hash is null and new.claimed_by is null
    and new.claimed_at is null and new.lease_expires_at is null
    and new.last_execution_id is null
    and new.dispatch_mode is null and new.dispatched_at is null
    and new.requested_by_user_id is null
    and new.requested_agent_provider is null
    and new.requested_agent_model is null
    and new.requested_agent_effort is null
    and new.paused_at is null and new.resume_requested_at is null
    and new.completed_at is null
  )
BEGIN
  select raise(
    abort, 'conversational execution cancellation requires backlog reset'
  );
END;

--> statement-breakpoint
create trigger briar_issue_execution_retryable_transfer_guard
before update of project_id, status on briar_hunt_runs
when old.status in ('queued', 'blocked', 'failed')
  and new.project_id <> old.project_id
  and old.dispatch_request_id is not null
  and (
    exists (
      select 1 from briar_issue_execution_proposals proposal
      where proposal.target_run_id = old.id
        and proposal.project_id = old.project_id
        and proposal.dispatch_request_id = old.dispatch_request_id
    )
    or exists (
      select 1 from briar_issue_execution_approval_audit approval
      where approval.run_id = old.id
        and approval.project_id = old.project_id
        and approval.dispatch_request_id = old.dispatch_request_id
    )
  )
  and not (
    new.status = 'backlog' and new.stage = 'queued'
    and new.workflow_stage is null
    and new.agent_id is null
    and new.worker_id is null and new.requested_worker_id is null
    and new.claim_token_hash is null and new.claimed_by is null
    and new.claimed_at is null and new.lease_expires_at is null
    and new.last_execution_id is null
    and new.dispatch_mode is null and new.dispatch_request_id is null
    and new.dispatched_at is null and new.requested_by_user_id is null
    and new.requested_agent_provider is null
    and new.requested_agent_model is null
    and new.requested_agent_effort is null
    and new.paused_at is null and new.resume_requested_at is null
    and new.completed_at is null
  )
BEGIN
  select raise(
    abort, 'conversational execution transfer requires backlog reset'
  );
END;

--> statement-breakpoint
create trigger briar_issue_execution_terminal_transfer_guard
before update of project_id on briar_hunt_runs
when old.status in ('completed', 'cancelled')
  and new.project_id <> old.project_id
  and exists (
    select 1 from briar_issue_execution_approval_audit approval
    where approval.run_id = old.id
      and approval.project_id = old.project_id
  )
BEGIN
  select raise(
    abort, 'conversationally approved terminal issue transfer is not allowed'
  );
END;

--> statement-breakpoint
create trigger briar_issue_execution_terminal_reactivation_guard
before update of status on briar_hunt_runs
when old.status in ('completed', 'cancelled')
  and new.status not in ('completed', 'cancelled')
  and exists (
    select 1 from briar_issue_execution_approval_audit approval
    where approval.run_id = old.id
      and approval.project_id = old.project_id
  )
BEGIN
  select raise(
    abort, 'conversational execution reactivation requires fresh approval'
  );
END;

--> statement-breakpoint
create trigger briar_issue_execution_target_mutation_invalidate
after update of updated_at on briar_hunt_runs
when new.updated_at is not old.updated_at
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where target_run_id = new.id and status = 'pending'
    and target_run_updated_at is not new.updated_at
    and not (
      dispatch_request_id is not null
      and new.project_id = project_id
      and new.dispatch_request_id = dispatch_request_id
      and new.dispatched_at = approval_reserved_at
      and new.requested_by_user_id = approval_reserved_by_user_id
      and new.requested_agent_provider = requested_provider
      and new.requested_agent_model is requested_model
      and new.requested_agent_effort is requested_effort
      and new.requested_worker_id is requested_worker_id
      and new.status = 'queued' and new.stage = 'queued'
      and new.workflow_stage is null
    );
END;

-- Transfer never carries conversational execution authority into another
-- project. Keep the immutable audit, invalidate every card generation, and
-- require a new Project Agent proposal in the destination project.
--> statement-breakpoint
create trigger briar_issue_execution_proposal_transfer_invalidate
after update of project_id on briar_hunt_runs
when new.project_id <> old.project_id
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where target_run_id = new.id and status <> 'invalidated';
END;

--> statement-breakpoint
create trigger briar_issue_execution_proposal_unassign_invalidate
after update of dispatch_request_id on briar_hunt_runs
when old.dispatch_request_id is not null and new.dispatch_request_id is null
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where target_run_id = new.id and status <> 'invalidated'
    and dispatch_request_id = old.dispatch_request_id;
END;

-- Execution cards participate in the existing channel proposal delta stream.
--> statement-breakpoint
create trigger briar_channel_execution_proposals_insert_sync
after insert on briar_issue_execution_proposals
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
create trigger briar_channel_execution_proposals_update_sync
after update on briar_issue_execution_proposals
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
