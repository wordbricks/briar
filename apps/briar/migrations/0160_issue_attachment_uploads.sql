-- IssueService owns three attachment workflows. Opaque bytes still use the
-- shared short-lived upload capability, while purpose, actor, target, mutation
-- identity, and consumption remain fixed by the owning RPC.
-- Migration 0150 already owns the final shared upload shape. This migration
-- adds only Issue-owned receipts and extends the shared authorization guards.
pragma foreign_keys = on;

drop trigger if exists briar_upload_batch_insert_guard;
drop trigger if exists briar_upload_batch_immutable;
drop trigger if exists briar_upload_metadata_immutable;
drop trigger if exists briar_upload_state_guard;
drop trigger if exists briar_upload_delete_cleanup;

create table briar_issue_create_mutation_receipts (
  client_issue_id text primary key not null
    references briar_hunt_runs (id) on delete cascade check (
      length(client_issue_id) between 1 and 128
      and client_issue_id not glob '*[^0-9A-Za-z_-]*'
    ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  request_hash text not null check (
    length(request_hash) = 64
    and request_hash not glob '*[^0-9a-f]*'
  ),
  attachment_upload_ids_json text not null check (
    length(attachment_upload_ids_json) between 2 and 1024
    and json_valid(attachment_upload_ids_json)
    and json_type(attachment_upload_ids_json) = 'array'
    and json_array_length(attachment_upload_ids_json) between 0 and 5
  ),
  response_json text not null check (
    length(response_json) between 2 and 1000000
    and json_valid(response_json)
    and json_type(response_json) = 'object'
  ),
  created_at text not null check (
    length(created_at) between 17 and 64 and created_at = trim(created_at)
  )
);

create index briar_issue_create_mutation_receipts_scope_idx
  on briar_issue_create_mutation_receipts (
    organization_id, project_id, user_id, client_issue_id
  );

create table briar_issue_update_mutation_receipts (
  request_id text primary key not null check (
    length(request_id) between 1 and 128
    and request_id not glob '*[^0-9A-Za-z_-]*'
  ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade check (
    length(run_id) between 1 and 128
    and run_id not glob '*[^0-9A-Za-z_-]*'
  ),
  user_id text not null references "user" (id) on delete cascade,
  request_hash text not null check (
    length(request_hash) = 64
    and request_hash not glob '*[^0-9a-f]*'
  ),
  attachment_upload_ids_json text not null check (
    length(attachment_upload_ids_json) between 2 and 1024
    and json_valid(attachment_upload_ids_json)
    and json_type(attachment_upload_ids_json) = 'array'
    and json_array_length(attachment_upload_ids_json) between 0 and 5
  ),
  response_json text not null check (
    length(response_json) between 2 and 1000000
    and json_valid(response_json)
    and json_type(response_json) = 'object'
  ),
  created_at text not null check (
    length(created_at) between 17 and 64 and created_at = trim(created_at)
  )
);

create index briar_issue_update_mutation_receipts_scope_idx
  on briar_issue_update_mutation_receipts (
    organization_id, project_id, run_id, user_id, request_id
  );

create table briar_issue_message_mutation_receipts (
  message_id text primary key not null
    references briar_issue_messages (id) on delete cascade check (
      length(message_id) between 1 and 128
      and message_id not glob '*[^0-9A-Za-z_-]*'
    ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade check (
    length(run_id) between 1 and 128
    and run_id not glob '*[^0-9A-Za-z_-]*'
  ),
  user_id text not null references "user" (id) on delete cascade,
  request_hash text not null check (
    length(request_hash) = 64
    and request_hash not glob '*[^0-9a-f]*'
  ),
  attachment_upload_ids_json text not null check (
    length(attachment_upload_ids_json) between 2 and 1024
    and json_valid(attachment_upload_ids_json)
    and json_type(attachment_upload_ids_json) = 'array'
    and json_array_length(attachment_upload_ids_json) between 0 and 5
  ),
  response_json text not null check (
    length(response_json) between 2 and 1000000
    and json_valid(response_json)
    and json_type(response_json) = 'object'
  ),
  created_at text not null check (
    length(created_at) between 17 and 64 and created_at = trim(created_at)
  )
);

create index briar_issue_message_mutation_receipts_scope_idx
  on briar_issue_message_mutation_receipts (
    organization_id, project_id, run_id, user_id, message_id
  );

--> statement-breakpoint
create trigger briar_upload_batch_insert_guard
before insert on briar_upload_batches
when not (
  (
    new.purpose = 'issue_reply'
    and new.channel_id is null and new.user_id is null
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
    and new.channel_id is null and new.user_id is null
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
    and new.channel_id is null and new.user_id is null
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
  or
  (
    new.purpose = 'channel_message'
    and new.project_id is null and new.run_id is null
    and new.worker_id is null and new.device_id is null
    and new.claim_token_hash is null
    and new.channel_id is not null and new.user_id is not null
    and new.work_id is not null
    and exists (
      select 1
      from briar_channels channel
      join briar_organization_members membership
        on membership.organization_id = channel.organization_id
       and membership.user_id = new.user_id
      where channel.id = new.channel_id
        and channel.organization_id = new.organization_id
        and channel.archived_at is null
        and membership.role in ('owner', 'co-owner', 'developer', 'editor')
        and (
          channel.visibility = 'public'
          or exists (
            select 1 from briar_channel_members member
            where member.channel_id = channel.id
              and member.user_id = new.user_id
          )
        )
    )
  )
  or
  (
    new.purpose = 'issue_create'
    and new.channel_id is null and new.run_id is null
    and new.worker_id is null and new.device_id is null
    and new.claim_token_hash is null
    and new.project_id is not null and new.user_id is not null
    and new.work_id is not null
    and exists (
      select 1
      from briar_projects project
      join briar_organization_members membership
        on membership.organization_id = project.organization_id
       and membership.user_id = new.user_id
      where project.id = new.project_id
        and project.organization_id = new.organization_id
        and membership.role in ('owner', 'co-owner', 'developer', 'editor')
        and (
          membership.role in ('owner', 'co-owner')
          or exists (
            select 1 from briar_project_members project_member
            where project_member.project_id = project.id
              and project_member.organization_id = project.organization_id
              and project_member.user_id = new.user_id
          )
        )
    )
  )
  or
  (
    new.purpose = 'issue_update'
    and new.channel_id is null
    and new.worker_id is null and new.device_id is null
    and new.claim_token_hash is null
    and new.project_id is not null and new.user_id is not null
    and new.work_id is not null and new.run_id is not null
    and exists (
      select 1
      from briar_hunt_runs run
      join briar_projects project on project.id = run.project_id
      join briar_organization_members membership
        on membership.organization_id = project.organization_id
       and membership.user_id = new.user_id
      where run.id = new.run_id and run.project_id = new.project_id
        and project.organization_id = new.organization_id
        and membership.role in ('owner', 'co-owner', 'developer', 'editor')
        and (
          membership.role in ('owner', 'co-owner')
          or exists (
            select 1 from briar_project_members project_member
            where project_member.project_id = project.id
              and project_member.organization_id = project.organization_id
              and project_member.user_id = new.user_id
          )
        )
    )
  )
  or
  (
    new.purpose = 'issue_message'
    and new.channel_id is null
    and new.worker_id is null and new.device_id is null
    and new.claim_token_hash is null
    and new.project_id is not null and new.user_id is not null
    and new.work_id is not null and new.run_id is not null
    and exists (
      select 1
      from briar_hunt_runs run
      join briar_projects project on project.id = run.project_id
      join briar_organization_members membership
        on membership.organization_id = project.organization_id
       and membership.user_id = new.user_id
      where run.id = new.run_id and run.project_id = new.project_id
        and project.organization_id = new.organization_id
        and membership.role in ('owner', 'co-owner', 'developer', 'editor')
        and (
          membership.role in ('owner', 'co-owner')
          or exists (
            select 1 from briar_project_members project_member
            where project_member.project_id = project.id
              and project_member.organization_id = project.organization_id
              and project_member.user_id = new.user_id
          )
        )
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
create trigger briar_issue_create_mutation_receipt_insert_guard
before insert on briar_issue_create_mutation_receipts
when exists (
    select 1 from json_each(new.attachment_upload_ids_json)
    where type != 'text'
  )
  or json_array_length(new.attachment_upload_ids_json) != (
    select count(distinct value)
    from json_each(new.attachment_upload_ids_json)
  )
  or json_array_length(new.attachment_upload_ids_json) != (
    select count(*)
    from briar_uploads upload
    join briar_upload_batches batch
      on batch.request_id = upload.batch_request_id
    join briar_issue_attachments attachment
      on attachment.id = upload.upload_id
     and attachment.project_id = new.project_id
     and attachment.run_id = new.client_issue_id
    where batch.purpose = 'issue_create'
      and batch.organization_id = new.organization_id
      and batch.project_id = new.project_id
      and batch.channel_id is null
      and batch.user_id = new.user_id
      and batch.work_id = new.client_issue_id
      and batch.run_id is null
      and batch.worker_id is null and batch.device_id is null
      and batch.claim_token_hash is null
      and batch.expires_at > new.created_at
      and upload.uploaded_at is not null and upload.consumed_at is null
      and exists (
        select 1 from json_each(new.attachment_upload_ids_json) expected
        where expected.value = upload.upload_id
      )
      and attachment.object_key = upload.object_key
      and attachment.filename = upload.filename
      and attachment.content_type = upload.content_type
      and attachment.byte_size = upload.byte_size
  )
  or 1 < (
    select count(distinct upload.batch_request_id)
    from briar_uploads upload
    join briar_upload_batches batch
      on batch.request_id = upload.batch_request_id
    where batch.purpose = 'issue_create'
      and batch.organization_id = new.organization_id
      and batch.project_id = new.project_id
      and batch.user_id = new.user_id
      and batch.work_id = new.client_issue_id
      and exists (
        select 1 from json_each(new.attachment_upload_ids_json) expected
        where expected.value = upload.upload_id
      )
  )
  or not exists (
    select 1
    from briar_hunt_runs run
    join briar_projects project on project.id = run.project_id
    join briar_organization_members membership
      on membership.organization_id = project.organization_id
     and membership.user_id = new.user_id
    where run.id = new.client_issue_id and run.project_id = new.project_id
      and run.created_by_user_id = new.user_id
      and project.organization_id = new.organization_id
      and membership.role in ('owner', 'co-owner', 'developer', 'editor')
      and (
        membership.role in ('owner', 'co-owner')
        or exists (
          select 1 from briar_project_members project_member
          where project_member.project_id = project.id
            and project_member.organization_id = project.organization_id
            and project_member.user_id = new.user_id
        )
      )
  )
begin
  select raise(abort, 'invalid issue create receipt');
end;

--> statement-breakpoint
create trigger briar_issue_update_mutation_receipt_insert_guard
before insert on briar_issue_update_mutation_receipts
when exists (
    select 1 from json_each(new.attachment_upload_ids_json)
    where type != 'text'
  )
  or json_array_length(new.attachment_upload_ids_json) != (
    select count(distinct value)
    from json_each(new.attachment_upload_ids_json)
  )
  or json_array_length(new.attachment_upload_ids_json) != (
    select count(*)
    from briar_uploads upload
    join briar_upload_batches batch
      on batch.request_id = upload.batch_request_id
    join briar_issue_attachments attachment
      on attachment.id = upload.upload_id
     and attachment.project_id = new.project_id
     and attachment.run_id = new.run_id
    where batch.purpose = 'issue_update'
      and batch.organization_id = new.organization_id
      and batch.project_id = new.project_id
      and batch.channel_id is null
      and batch.user_id = new.user_id
      and batch.work_id = new.request_id
      and batch.run_id = new.run_id
      and batch.worker_id is null and batch.device_id is null
      and batch.claim_token_hash is null
      and batch.expires_at > new.created_at
      and upload.uploaded_at is not null and upload.consumed_at is null
      and exists (
        select 1 from json_each(new.attachment_upload_ids_json) expected
        where expected.value = upload.upload_id
      )
      and attachment.object_key = upload.object_key
      and attachment.filename = upload.filename
      and attachment.content_type = upload.content_type
      and attachment.byte_size = upload.byte_size
  )
  or 1 < (
    select count(distinct upload.batch_request_id)
    from briar_uploads upload
    join briar_upload_batches batch
      on batch.request_id = upload.batch_request_id
    where batch.purpose = 'issue_update'
      and batch.organization_id = new.organization_id
      and batch.project_id = new.project_id
      and batch.user_id = new.user_id
      and batch.work_id = new.request_id
      and batch.run_id = new.run_id
      and exists (
        select 1 from json_each(new.attachment_upload_ids_json) expected
        where expected.value = upload.upload_id
      )
  )
  or not exists (
    select 1
    from briar_hunt_runs run
    join briar_projects project on project.id = run.project_id
    join briar_organization_members membership
      on membership.organization_id = project.organization_id
     and membership.user_id = new.user_id
    where run.id = new.run_id and run.project_id = new.project_id
      and project.organization_id = new.organization_id
      and membership.role in ('owner', 'co-owner', 'developer', 'editor')
      and (
        membership.role in ('owner', 'co-owner')
        or exists (
          select 1 from briar_project_members project_member
          where project_member.project_id = project.id
            and project_member.organization_id = project.organization_id
            and project_member.user_id = new.user_id
        )
      )
  )
begin
  select raise(abort, 'invalid issue update receipt');
end;

--> statement-breakpoint
create trigger briar_issue_message_mutation_receipt_insert_guard
before insert on briar_issue_message_mutation_receipts
when exists (
    select 1 from json_each(new.attachment_upload_ids_json)
    where type != 'text'
  )
  or json_array_length(new.attachment_upload_ids_json) != (
    select count(distinct value)
    from json_each(new.attachment_upload_ids_json)
  )
  or json_array_length(new.attachment_upload_ids_json) != (
    select count(*)
    from briar_uploads upload
    join briar_upload_batches batch
      on batch.request_id = upload.batch_request_id
    join briar_issue_attachments attachment
      on attachment.id = upload.upload_id
     and attachment.project_id = new.project_id
     and attachment.run_id = new.run_id
    where batch.purpose = 'issue_message'
      and batch.organization_id = new.organization_id
      and batch.project_id = new.project_id
      and batch.channel_id is null
      and batch.user_id = new.user_id
      and batch.work_id = new.message_id
      and batch.run_id = new.run_id
      and batch.worker_id is null and batch.device_id is null
      and batch.claim_token_hash is null
      and batch.expires_at > new.created_at
      and upload.uploaded_at is not null and upload.consumed_at is null
      and exists (
        select 1 from json_each(new.attachment_upload_ids_json) expected
        where expected.value = upload.upload_id
      )
      and attachment.object_key = upload.object_key
      and attachment.filename = upload.filename
      and attachment.content_type = upload.content_type
      and attachment.byte_size = upload.byte_size
  )
  or 1 < (
    select count(distinct upload.batch_request_id)
    from briar_uploads upload
    join briar_upload_batches batch
      on batch.request_id = upload.batch_request_id
    where batch.purpose = 'issue_message'
      and batch.organization_id = new.organization_id
      and batch.project_id = new.project_id
      and batch.user_id = new.user_id
      and batch.work_id = new.message_id
      and batch.run_id = new.run_id
      and exists (
        select 1 from json_each(new.attachment_upload_ids_json) expected
        where expected.value = upload.upload_id
      )
  )
  or not exists (
    select 1
    from briar_issue_messages message
    join briar_hunt_runs run
      on run.id = message.run_id and run.project_id = message.project_id
    join briar_projects project on project.id = run.project_id
    join briar_organization_members membership
      on membership.organization_id = project.organization_id
     and membership.user_id = new.user_id
    where message.id = new.message_id
      and message.project_id = new.project_id and message.run_id = new.run_id
      and project.organization_id = new.organization_id
      and membership.role in ('owner', 'co-owner', 'developer', 'editor')
      and (
        membership.role in ('owner', 'co-owner')
        or exists (
          select 1 from briar_project_members project_member
          where project_member.project_id = project.id
            and project_member.organization_id = project.organization_id
            and project_member.user_id = new.user_id
        )
      )
  )
begin
  select raise(abort, 'invalid issue message receipt');
end;

--> statement-breakpoint
create trigger briar_issue_create_mutation_receipt_immutable
before update on briar_issue_create_mutation_receipts
begin
  select raise(abort, 'issue create receipt is immutable');
end;

--> statement-breakpoint
create trigger briar_issue_update_mutation_receipt_immutable
before update on briar_issue_update_mutation_receipts
begin
  select raise(abort, 'issue update receipt is immutable');
end;

--> statement-breakpoint
create trigger briar_issue_message_mutation_receipt_immutable
before update on briar_issue_message_mutation_receipts
begin
  select raise(abort, 'issue message receipt is immutable');
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
        and exists (
          select 1 from json_each(evidence.image_upload_ids_json) expected
          where expected.value = old.upload_id
        )
        and batch.expires_at > new.consumed_at
    )
  )
  or
  (
    old.uploaded_at is not null and new.uploaded_at is old.uploaded_at
    and old.consumed_at is null and new.consumed_at is not null
    and new.consumer_kind = 'channel_message'
    and exists (
      select 1
      from briar_upload_batches batch
      join briar_channel_message_mutation_receipts receipt
        on receipt.message_id = new.consumer_id
      join briar_channel_message_attachments attachment
        on attachment.id = old.upload_id
       and attachment.message_id = receipt.message_id
       and attachment.channel_id = receipt.channel_id
       and attachment.organization_id = receipt.organization_id
      where batch.request_id = old.batch_request_id
        and batch.purpose = 'channel_message'
        and batch.organization_id = receipt.organization_id
        and batch.channel_id = receipt.channel_id
        and batch.user_id = receipt.user_id
        and batch.work_id = receipt.message_id
        and batch.expires_at > new.consumed_at
        and receipt.created_at = new.consumed_at
        and attachment.object_key = old.object_key
        and attachment.filename = old.filename
        and attachment.content_type = old.content_type
        and attachment.byte_size = old.byte_size
    )
  )
  or
  (
    old.uploaded_at is not null and new.uploaded_at is old.uploaded_at
    and old.consumed_at is null and new.consumed_at is not null
    and new.consumer_kind = 'issue_create'
    and exists (
      select 1
      from briar_upload_batches batch
      join briar_issue_create_mutation_receipts receipt
        on receipt.client_issue_id = new.consumer_id
      join briar_issue_attachments attachment
        on attachment.id = old.upload_id
       and attachment.run_id = receipt.client_issue_id
       and attachment.project_id = receipt.project_id
      where batch.request_id = old.batch_request_id
        and batch.purpose = 'issue_create'
        and batch.organization_id = receipt.organization_id
        and batch.project_id = receipt.project_id
        and batch.channel_id is null
        and batch.user_id = receipt.user_id
        and batch.work_id = receipt.client_issue_id
        and batch.run_id is null
        and exists (
          select 1
          from json_each(receipt.attachment_upload_ids_json) expected
          where expected.value = old.upload_id
        )
        and batch.expires_at > new.consumed_at
        and receipt.created_at = new.consumed_at
        and attachment.object_key = old.object_key
        and attachment.filename = old.filename
        and attachment.content_type = old.content_type
        and attachment.byte_size = old.byte_size
    )
  )
  or
  (
    old.uploaded_at is not null and new.uploaded_at is old.uploaded_at
    and old.consumed_at is null and new.consumed_at is not null
    and new.consumer_kind = 'issue_update'
    and exists (
      select 1
      from briar_upload_batches batch
      join briar_issue_update_mutation_receipts receipt
        on receipt.request_id = new.consumer_id
      join briar_issue_attachments attachment
        on attachment.id = old.upload_id
       and attachment.run_id = receipt.run_id
       and attachment.project_id = receipt.project_id
      where batch.request_id = old.batch_request_id
        and batch.purpose = 'issue_update'
        and batch.organization_id = receipt.organization_id
        and batch.project_id = receipt.project_id
        and batch.channel_id is null
        and batch.user_id = receipt.user_id
        and batch.work_id = receipt.request_id
        and batch.run_id = receipt.run_id
        and exists (
          select 1
          from json_each(receipt.attachment_upload_ids_json) expected
          where expected.value = old.upload_id
        )
        and batch.expires_at > new.consumed_at
        and receipt.created_at = new.consumed_at
        and attachment.object_key = old.object_key
        and attachment.filename = old.filename
        and attachment.content_type = old.content_type
        and attachment.byte_size = old.byte_size
    )
  )
  or
  (
    old.uploaded_at is not null and new.uploaded_at is old.uploaded_at
    and old.consumed_at is null and new.consumed_at is not null
    and new.consumer_kind = 'issue_message'
    and exists (
      select 1
      from briar_upload_batches batch
      join briar_issue_message_mutation_receipts receipt
        on receipt.message_id = new.consumer_id
      join briar_issue_attachments attachment
        on attachment.id = old.upload_id
       and attachment.run_id = receipt.run_id
       and attachment.project_id = receipt.project_id
      where batch.request_id = old.batch_request_id
        and batch.purpose = 'issue_message'
        and batch.organization_id = receipt.organization_id
        and batch.project_id = receipt.project_id
        and batch.channel_id is null
        and batch.user_id = receipt.user_id
        and batch.work_id = receipt.message_id
        and batch.run_id = receipt.run_id
        and exists (
          select 1
          from json_each(receipt.attachment_upload_ids_json) expected
          where expected.value = old.upload_id
        )
        and batch.expires_at > new.consumed_at
        and receipt.created_at = new.consumed_at
        and attachment.object_key = old.object_key
        and attachment.filename = old.filename
        and attachment.content_type = old.content_type
        and attachment.byte_size = old.byte_size
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
