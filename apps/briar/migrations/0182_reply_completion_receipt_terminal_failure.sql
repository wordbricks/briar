pragma foreign_keys = on;

-- A reply attempt can now end as `failed` before the attempt budget is spent:
-- when the provider blocked the turn for a reason no other Worker can serve
-- (the request no longer fits the model, the model does not exist) or when no
-- other Worker is available to take the requeued job, the server fails the
-- job at once and tells the requester why. The receipt guard therefore checks
-- the job status a failure disposition landed in, not the attempt count.
drop trigger briar_reply_completion_receipt_insert_guard;

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
              (new.disposition = 'failed' and job.status = 'failed')
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
              (new.disposition = 'requeued' and job.status = 'queued')
              or
              (new.disposition = 'failed' and job.status = 'failed')
            ))
        )
    )
  )
)
begin
  select raise(abort, 'invalid reply completion receipt');
end;
