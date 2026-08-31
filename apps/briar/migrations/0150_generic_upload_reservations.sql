pragma foreign_keys = on;

-- Upload reservations are transport infrastructure. Owning application
-- services authorize a concrete purpose before creating a batch; raw bytes
-- are accepted only through the short-lived capability for one reserved row.
create table briar_upload_batches (
  request_id text primary key not null,
  purpose text not null check (
    purpose in ('issue_reply', 'channel_reply', 'run_evidence')
  ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text references briar_projects (id) on delete cascade,
  work_id text,
  run_id text,
  worker_id text,
  device_id text,
  claim_token_hash text check (
    claim_token_hash is null or (
      length(claim_token_hash) = 64
      and claim_token_hash not glob '*[^0-9a-f]*'
    )
  ),
  metadata_hash text not null check (
    length(metadata_hash) = 64
    and metadata_hash not glob '*[^0-9a-f]*'
  ),
  file_count integer not null check (file_count between 1 and 5),
  creation_nonce text not null unique check (length(creation_nonce) = 36),
  expires_at text not null,
  created_at text not null,
  check (expires_at > created_at)
);

create index briar_upload_batches_expiry_idx
  on briar_upload_batches (expires_at, request_id);
create index briar_upload_batches_scope_idx
  on briar_upload_batches (
    purpose, organization_id, project_id, work_id, run_id, claim_token_hash
  );

create table briar_uploads (
  upload_id text primary key not null,
  batch_request_id text not null
    references briar_upload_batches (request_id) on delete cascade,
  client_id text not null check (
    client_id = trim(client_id) and length(client_id) between 1 and 128
  ),
  position integer not null check (position between 0 and 4),
  filename text not null check (length(trim(filename)) between 1 and 255),
  content_type text not null check (
    content_type = trim(content_type)
    and length(content_type) between 1 and 255
  ),
  byte_size integer not null check (byte_size between 1 and 20971520),
  sha256 blob not null check (typeof(sha256) = 'blob' and length(sha256) = 32),
  object_key text not null unique check (
    object_key = trim(object_key) and length(object_key) between 1 and 500
  ),
  uploaded_at text,
  consumed_at text,
  consumer_kind text,
  consumer_id text,
  check (
    (consumed_at is null and consumer_kind is null and consumer_id is null)
    or (
      uploaded_at is not null and consumed_at is not null
      and consumer_kind is not null and consumer_id is not null
    )
  ),
  unique (batch_request_id, client_id),
  unique (batch_request_id, position)
);

create index briar_uploads_batch_idx
  on briar_uploads (batch_request_id, position, upload_id);
create index briar_uploads_consumer_idx
  on briar_uploads (consumer_kind, consumer_id, upload_id);

create table briar_upload_cleanup_queue (
  object_key text primary key not null,
  batch_request_id text not null,
  attempts integer not null default 0 check (attempts >= 0),
  generation integer not null default 1 check (generation >= 1),
  queued_at text not null,
  next_attempt_at text not null,
  last_error text
);

create index briar_upload_cleanup_queue_due_idx
  on briar_upload_cleanup_queue (
    next_attempt_at, attempts, queued_at, object_key
  );

insert or ignore into briar_upload_cleanup_queue (
  object_key, batch_request_id, attempts, generation, queued_at,
  next_attempt_at, last_error
)
select object_key, batch_request_id, attempts, generation, queued_at,
       next_attempt_at, last_error
from briar_reply_upload_cleanup_queue;

-- Pending capabilities are deliberately not migrated. They belong to the
-- removed reply-only protocol. Preserve only deletion ownership for objects
-- that were uploaded but never consumed; completed aggregate attachments have
-- their own durable metadata and must not enter cleanup.
insert or ignore into briar_upload_cleanup_queue (
  object_key, batch_request_id, queued_at, next_attempt_at
)
select object_key, batch_request_id,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
from briar_reply_attachment_uploads
where consumed_at is null;

drop table briar_reply_upload_cleanup_queue;
drop table briar_reply_attachment_uploads;
drop table briar_reply_attachment_upload_batches;

--> statement-breakpoint
create trigger briar_upload_batch_insert_guard
before insert on briar_upload_batches
when not (
  (
    new.purpose = 'issue_reply'
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
    new.purpose = 'channel_reply'
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
  or
  (
    new.purpose = 'run_evidence'
    and new.work_id = new.run_id
    and exists (
      select 1
      from briar_hunt_runs run
      join briar_projects project on project.id = run.project_id
      where run.id = new.run_id and run.project_id = new.project_id
        and project.organization_id = new.organization_id
        and run.claim_token_hash = new.claim_token_hash
        and run.lease_expires_at > new.created_at
        and new.expires_at <= run.lease_expires_at
        and run.status not in ('completed', 'cancelled', 'blocked', 'failed')
    )
  )
)
begin
  select raise(abort, 'invalid upload authorization');
end;

--> statement-breakpoint
create trigger briar_upload_batch_immutable
before update on briar_upload_batches
begin
  select raise(abort, 'upload batch is immutable');
end;

--> statement-breakpoint
create trigger briar_upload_metadata_immutable
before update on briar_uploads
when new.upload_id is not old.upload_id
  or new.batch_request_id is not old.batch_request_id
  or new.client_id is not old.client_id
  or new.position is not old.position
  or new.filename is not old.filename
  or new.content_type is not old.content_type
  or new.byte_size is not old.byte_size
  or new.sha256 is not old.sha256
  or new.object_key is not old.object_key
  or old.consumed_at is not null
  or (old.uploaded_at is not null and new.uploaded_at is not old.uploaded_at)
begin
  select raise(abort, 'upload metadata is immutable');
end;

--> statement-breakpoint
create trigger briar_upload_state_guard
before update on briar_uploads
when not (
  (
    old.uploaded_at is null and new.uploaded_at is not null
    and new.consumed_at is null
    and new.consumer_kind is null and new.consumer_id is null
    and exists (
      select 1 from briar_upload_batches batch
      where batch.request_id = old.batch_request_id
        and batch.expires_at > new.uploaded_at
    )
  )
  or
  (
    old.uploaded_at is not null and new.uploaded_at is old.uploaded_at
    and old.consumed_at is null and new.consumed_at is not null
    and new.consumer_kind = 'reply_completion'
    and exists (
      select 1
      from briar_upload_batches batch
      join briar_reply_completion_receipts receipt
        on receipt.request_id = new.consumer_id
      where batch.request_id = old.batch_request_id
        and batch.purpose = receipt.reply_kind || '_reply'
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
  or
  (
    old.uploaded_at is not null and new.uploaded_at is old.uploaded_at
    and old.consumed_at is null and new.consumed_at is not null
    and new.consumer_kind = 'run_evidence'
    and exists (
      select 1
      from briar_upload_batches batch
      join briar_run_evidence evidence on evidence.id = new.consumer_id
      where batch.request_id = old.batch_request_id
        and batch.purpose = 'run_evidence'
        and batch.project_id = evidence.project_id
        and batch.run_id = evidence.run_id
        and batch.expires_at > new.consumed_at
    )
  )
)
begin
  select raise(abort, 'invalid upload state transition');
end;

--> statement-breakpoint
create trigger briar_upload_delete_cleanup
before delete on briar_uploads
when old.consumed_at is null
begin
  insert into briar_upload_cleanup_queue (
    object_key, batch_request_id, queued_at, next_attempt_at
  ) values (
    old.object_key,
    old.batch_request_id,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ) on conflict (object_key) do nothing;
end;
