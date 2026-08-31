pragma foreign_keys = on;

-- Completion receipts are the durable idempotency authority for reply claims.
-- They deliberately retain the opaque claim-token hash after the mutable job
-- clears its lease, and can only disappear with their organization.
create table briar_reply_completion_receipts (
  request_id text primary key not null,
  reply_kind text not null check (reply_kind in ('issue', 'channel')),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null,
  work_id text not null,
  run_id text not null,
  worker_id text not null,
  device_id text not null,
  claim_token_hash text not null check (
    length(claim_token_hash) = 64
    and claim_token_hash not glob '*[^0-9a-f]*'
  ),
  payload_hash text not null check (
    length(payload_hash) = 64
    and payload_hash not glob '*[^0-9a-f]*'
  ),
  outcome_kind text not null check (outcome_kind in ('success', 'failure')),
  disposition text not null
    check (disposition in ('completed', 'requeued', 'failed')),
  retained_until text,
  created_at text not null,
  check (
    (reply_kind = 'issue' and retained_until is null)
    or reply_kind = 'channel'
  ),
  check (
    (outcome_kind = 'success' and disposition = 'completed')
    or (outcome_kind = 'failure' and disposition in ('requeued', 'failed'))
  ),
  unique (reply_kind, work_id, worker_id, claim_token_hash)
);

create index briar_reply_completion_receipts_work_idx
  on briar_reply_completion_receipts (reply_kind, work_id, created_at);

--> statement-breakpoint
create trigger briar_reply_completion_receipt_insert_guard
before insert on briar_reply_completion_receipts
when not (
  (
    new.reply_kind = 'issue'
    and exists (
      select 1
      from briar_issue_agent_reply_jobs job
      join briar_projects project on project.id = job.project_id
      join briar_execution_workers worker
        on worker.id = job.claimed_worker_id
       and worker.project_id = job.project_id
      where job.id = new.work_id and job.project_id = new.project_id
        and job.run_id = new.run_id
        and project.organization_id = new.organization_id
        and worker.id = new.worker_id and worker.device_id = new.device_id
        and job.claim_token_hash = new.claim_token_hash
        and (
          (new.outcome_kind = 'success'
            and new.disposition = 'completed'
            and job.status = 'completed'
            and job.completed_at = new.created_at)
          or
          (new.outcome_kind = 'failure'
            and job.updated_at = new.created_at
            and (
              (job.attempts < 3 and new.disposition = 'requeued'
                and job.status = 'queued')
              or
              (job.attempts >= 3 and new.disposition = 'failed'
                and job.status = 'failed')
            ))
        )
    )
  )
  or
  (
    new.reply_kind = 'channel'
    and exists (
      select 1
      from briar_channel_agent_reply_jobs job
      join briar_execution_workers worker
        on worker.id = job.claimed_worker_id
       and worker.device_id = job.claimed_device_id
      join briar_projects project on project.id = worker.project_id
      where job.id = new.work_id and job.channel_id = new.run_id
        and job.organization_id = new.organization_id
        and project.id = new.project_id
        and project.organization_id = new.organization_id
        and worker.id = new.worker_id and worker.device_id = new.device_id
        and job.claim_token_hash = new.claim_token_hash
        and (
          (new.outcome_kind = 'success'
            and new.disposition = 'completed'
            and job.status = 'completed'
            and job.completed_at = new.created_at)
          or
          (new.outcome_kind = 'failure'
            and job.updated_at = new.created_at
            and (
              (job.attempts < 3 and new.disposition = 'requeued'
                and job.status = 'queued')
              or
              (job.attempts >= 3 and new.disposition = 'failed'
                and job.status = 'failed')
            ))
        )
    )
  )
)
begin
  select raise(abort, 'invalid reply completion receipt');
end;

--> statement-breakpoint
create trigger briar_reply_completion_receipt_immutable_update
before update on briar_reply_completion_receipts
begin
  select raise(abort, 'reply completion receipt is immutable');
end;

--> statement-breakpoint
create trigger briar_reply_completion_receipt_immutable_delete
before delete on briar_reply_completion_receipts
when exists (
  select 1 from briar_organizations organization
  where organization.id = old.organization_id
)
begin
  select raise(abort, 'reply completion receipt is immutable');
end;
