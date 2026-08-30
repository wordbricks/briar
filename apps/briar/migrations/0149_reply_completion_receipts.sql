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

-- A prepare request owns a normalized metadata set for one exact live claim.
-- Upload bytes stay in R2; D1 stores only their verified identity and lifecycle.
create table briar_reply_attachment_upload_batches (
  request_id text primary key not null,
  reply_kind text not null check (reply_kind in ('issue', 'channel')),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  work_id text not null,
  run_id text not null,
  worker_id text not null,
  device_id text not null,
  claim_token_hash text not null check (
    length(claim_token_hash) = 64
    and claim_token_hash not glob '*[^0-9a-f]*'
  ),
  metadata_hash text not null check (
    length(metadata_hash) = 64
    and metadata_hash not glob '*[^0-9a-f]*'
  ),
  attachment_count integer not null check (attachment_count between 1 and 5),
  creation_nonce text not null unique check (length(creation_nonce) = 36),
  expires_at text not null,
  created_at text not null,
  check (expires_at > created_at)
);

create index briar_reply_attachment_upload_batches_expiry_idx
  on briar_reply_attachment_upload_batches (expires_at, request_id);
create index briar_reply_attachment_upload_batches_claim_idx
  on briar_reply_attachment_upload_batches (
    reply_kind, work_id, worker_id, claim_token_hash
  );

--> statement-breakpoint
create trigger briar_reply_attachment_upload_batch_insert_guard
before insert on briar_reply_attachment_upload_batches
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
        and job.status = 'running'
        and job.claim_token_hash = new.claim_token_hash
        and job.lease_expires_at > new.created_at
        and new.expires_at <= job.lease_expires_at
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
        and job.status = 'running'
        and job.claim_token_hash = new.claim_token_hash
        and job.lease_expires_at > new.created_at
        and new.expires_at <= job.lease_expires_at
    )
  )
)
begin
  select raise(abort, 'invalid reply attachment upload claim');
end;

--> statement-breakpoint
create trigger briar_reply_attachment_upload_batch_immutable
before update on briar_reply_attachment_upload_batches
begin
  select raise(abort, 'reply attachment upload batch is immutable');
end;

create table briar_reply_attachment_uploads (
  attachment_id text primary key not null,
  batch_request_id text not null
    references briar_reply_attachment_upload_batches (request_id)
    on delete cascade,
  client_id text not null check (
    client_id = trim(client_id) and length(client_id) between 1 and 128
  ),
  filename text not null check (length(trim(filename)) between 1 and 255),
  content_type text not null check (content_type in (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'image/svg+xml', 'text/html'
  )),
  byte_size integer not null check (byte_size between 1 and 20971520),
  sha256 blob not null check (typeof(sha256) = 'blob' and length(sha256) = 32),
  object_key text not null unique check (
    object_key = trim(object_key) and length(object_key) between 1 and 500
  ),
  uploaded_at text,
  consumed_at text,
  completion_request_id text
    references briar_reply_completion_receipts (request_id),
  check (
    (consumed_at is null and completion_request_id is null)
    or (uploaded_at is not null and consumed_at is not null
      and completion_request_id is not null)
  ),
  unique (batch_request_id, client_id)
);

create index briar_reply_attachment_uploads_batch_idx
  on briar_reply_attachment_uploads (batch_request_id, client_id);
create index briar_reply_attachment_uploads_completion_idx
  on briar_reply_attachment_uploads (completion_request_id, attachment_id);

--> statement-breakpoint
create trigger briar_reply_attachment_upload_metadata_immutable
before update on briar_reply_attachment_uploads
when new.attachment_id is not old.attachment_id
  or new.batch_request_id is not old.batch_request_id
  or new.client_id is not old.client_id
  or new.filename is not old.filename
  or new.content_type is not old.content_type
  or new.byte_size is not old.byte_size
  or new.sha256 is not old.sha256
  or new.object_key is not old.object_key
  or old.consumed_at is not null
  or (old.uploaded_at is not null and new.uploaded_at is not old.uploaded_at)
  or (old.consumed_at is null and new.consumed_at is null
    and new.completion_request_id is not null)
begin
  select raise(abort, 'reply attachment upload metadata is immutable');
end;

--> statement-breakpoint
create trigger briar_reply_attachment_upload_state_guard
before update on briar_reply_attachment_uploads
when not (
  (
    old.uploaded_at is null and new.uploaded_at is not null
    and new.consumed_at is null and new.completion_request_id is null
    and exists (
      select 1 from briar_reply_attachment_upload_batches batch
      where batch.request_id = old.batch_request_id
        and batch.expires_at > new.uploaded_at
    )
  )
  or
  (
    old.uploaded_at is not null and new.uploaded_at is old.uploaded_at
    and old.consumed_at is null and new.consumed_at is not null
    and new.completion_request_id is not null
    and exists (
      select 1
      from briar_reply_attachment_upload_batches batch
      join briar_reply_completion_receipts receipt
        on receipt.request_id = new.completion_request_id
      where batch.request_id = old.batch_request_id
        and batch.reply_kind = receipt.reply_kind
        and batch.organization_id = receipt.organization_id
        and batch.project_id = receipt.project_id
        and batch.work_id = receipt.work_id
        and batch.run_id = receipt.run_id
        and batch.worker_id = receipt.worker_id
        and batch.device_id = receipt.device_id
        and batch.claim_token_hash = receipt.claim_token_hash
        and batch.expires_at > new.consumed_at
        and receipt.created_at = new.consumed_at
    )
  )
)
begin
  select raise(abort, 'invalid reply attachment upload state transition');
end;

-- Expiry first moves object ownership into a durable cleanup queue in the same
-- transaction that removes the unconsumed upload rows. R2 deletion can then
-- retry safely after crashes without racing a completion that consumes them.
create table briar_reply_upload_cleanup_queue (
  object_key text primary key not null,
  batch_request_id text not null,
  attempts integer not null default 0 check (attempts >= 0),
  generation integer not null default 1 check (generation >= 1),
  queued_at text not null,
  next_attempt_at text not null,
  last_error text
);

create index briar_reply_upload_cleanup_queue_due_idx
  on briar_reply_upload_cleanup_queue (
    next_attempt_at, attempts, queued_at, object_key
  );

--> statement-breakpoint
create trigger briar_reply_attachment_upload_delete_cleanup
before delete on briar_reply_attachment_uploads
when old.consumed_at is null
begin
  insert into briar_reply_upload_cleanup_queue (
    object_key, batch_request_id, queued_at, next_attempt_at
  ) values (
    old.object_key,
    old.batch_request_id,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ) on conflict (object_key) do nothing;
end;
