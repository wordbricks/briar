pragma defer_foreign_keys = on;

CREATE TRIGGER briar_dm_memory_forget_learning_payload after insert on briar_dm_memory_exclusions begin
  insert into briar_dm_memory_purge_documents(space_id, root_document_id, document_id)
  select new.space_id, new.document_id, source.document_id from briar_dm_memory_sources source
  where source.space_id = new.space_id and source.source_type = new.source_type and source.source_id = new.source_id
  on conflict (root_document_id, document_id) do nothing;
  insert into briar_dm_memory_learning_payload_purges(space_id, source_type, source_id)
  values (new.space_id, new.source_type, new.source_id);
  update briar_dm_memory_jobs set request_targets_json = '[]' where space_id = new.space_id
    and exists (select 1 from json_each(request_targets_json) target
      where json_extract(target.value, '$.documentId') in (
        select document_id from briar_dm_memory_purge_documents where space_id = new.space_id));
end;

CREATE TRIGGER briar_dm_memory_edit_learning_source after update of body, deleted_at on briar_channel_messages
when old.body <> new.body or old.deleted_at is not new.deleted_at begin
  insert into briar_dm_memory_learning_payload_purges(space_id, source_type, source_id)
  select distinct space_id, 'message', new.id from briar_dm_memory_learning_inputs
  where source_type = 'message' and source_id = new.id;
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + 1
  where id in (select space_id from briar_dm_memory_learning_inputs where source_type = 'message' and source_id = new.id);
end;

CREATE TRIGGER briar_dm_memory_delete_learning_source before delete on briar_channel_messages begin
  insert into briar_dm_memory_learning_payload_purges(space_id, source_type, source_id)
  select distinct space_id, 'message', old.id from briar_dm_memory_learning_inputs
  where source_type = 'message' and source_id = old.id;
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + 1
  where id in (select space_id from briar_dm_memory_learning_inputs where source_type = 'message' and source_id = old.id);
end;

CREATE TRIGGER briar_dm_memory_forget_derived_content after update of revocation_epoch on briar_dm_memory_spaces
when old.revocation_epoch <> new.revocation_epoch begin
  update briar_dm_memory_documents set status = 'deleted', title = '[deleted]'
  where space_id = new.id and id in (select source.document_id from briar_dm_memory_sources source
    join briar_dm_memory_exclusions excluded on excluded.space_id = source.space_id
      and excluded.source_type = source.source_type and excluded.source_id = source.source_id
    where source.space_id = new.id);
  update briar_dm_memory_commits set payload_hash = null where document_id in (
    select id from briar_dm_memory_documents where space_id = new.id and status = 'deleted');
  delete from briar_dm_memory_revisions where document_id in (
    select id from briar_dm_memory_documents where space_id = new.id and status = 'deleted');
end;

CREATE TRIGGER briar_reply_completion_receipt_immutable_update
before update on briar_reply_completion_receipts
begin
  select raise(abort, 'reply completion receipt is immutable');
end;

CREATE TRIGGER briar_reply_completion_receipt_immutable_delete
before delete on briar_reply_completion_receipts
when exists (
  select 1 from briar_organizations organization
  where organization.id = old.organization_id
)
begin
  select raise(abort, 'reply completion receipt is immutable');
end;

CREATE TRIGGER briar_channel_message_mutation_receipt_insert_guard
before insert on briar_channel_message_mutation_receipts
when not exists (
  select 1 from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = new.message_id and message.channel_id = new.channel_id
    and message.author_user_id = new.user_id
    and channel.organization_id = new.organization_id
)
begin
  select raise(abort, 'invalid channel message receipt');
end;

CREATE TRIGGER briar_channel_message_mutation_receipt_immutable
before update on briar_channel_message_mutation_receipts
begin
  select raise(abort, 'channel message receipt is immutable');
end;

CREATE TRIGGER briar_upload_batch_insert_guard
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

CREATE TRIGGER briar_upload_batch_immutable
before update on briar_upload_batches
begin
  select raise(abort, 'upload batch is immutable');
end;

CREATE TRIGGER briar_upload_metadata_immutable
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

CREATE TRIGGER briar_issue_create_mutation_receipt_insert_guard
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

CREATE TRIGGER briar_issue_update_mutation_receipt_insert_guard
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

CREATE TRIGGER briar_issue_message_mutation_receipt_insert_guard
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

CREATE TRIGGER briar_issue_create_mutation_receipt_immutable
before update on briar_issue_create_mutation_receipts
begin
  select raise(abort, 'issue create receipt is immutable');
end;

CREATE TRIGGER briar_issue_update_mutation_receipt_immutable
before update on briar_issue_update_mutation_receipts
begin
  select raise(abort, 'issue update receipt is immutable');
end;

CREATE TRIGGER briar_issue_message_mutation_receipt_immutable
before update on briar_issue_message_mutation_receipts
begin
  select raise(abort, 'issue message receipt is immutable');
end;

CREATE TRIGGER briar_upload_state_guard
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

CREATE TRIGGER briar_upload_delete_cleanup
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

CREATE TRIGGER briar_project_agent_schedule_creator_immutable
before update of created_by_user_id on briar_project_agent_schedules
when new.created_by_user_id is not old.created_by_user_id
  and not (
    old.created_by_user_id is not null
    and new.created_by_user_id is null
    and not exists (
      select 1 from "user" account
      where account.id = old.created_by_user_id
    )
  )
begin
  select raise(abort, 'Agent schedule creator is immutable');
end;

CREATE TRIGGER briar_archive_related_object_keys_insert_guard
before insert on briar_log_archives
when exists (
  select 1 from json_each(new.related_object_keys_json) related
  where related.type <> 'text'
    or related.value <> trim(related.value)
    or length(related.value) not between 1 and 1024
)
begin
  select raise(abort, 'invalid archive related object key');
end;

CREATE TRIGGER briar_archive_related_object_keys_update_guard
before update of related_object_keys_json on briar_log_archives
when exists (
  select 1 from json_each(new.related_object_keys_json) related
  where related.type <> 'text'
    or related.value <> trim(related.value)
    or length(related.value) not between 1 and 1024
)
begin
  select raise(abort, 'invalid archive related object key');
end;

CREATE TRIGGER briar_channel_issue_proposal_payload_immutable
before update of action_type, payload_json on briar_channel_action_proposals
when new.action_type is not old.action_type
  or new.payload_json is not old.payload_json
begin
  select raise(abort, 'channel issue proposal payload is immutable');
end;

CREATE TRIGGER briar_conversation_issue_proposal_payload_immutable
before update of action_type, payload_json on briar_issue_action_proposals
when new.action_type is not old.action_type
  or new.payload_json is not old.payload_json
begin
  select raise(abort, 'conversation issue proposal payload is immutable');
end;

CREATE TRIGGER briar_channel_issue_proposal_current_insert_guard
before insert on briar_channel_action_proposals
when new.action_type = 'request_issue_create'
  and (
    json_type(new.payload_json, '$.issue.status') is not null
    or exists (
      select 1
      from json_each(new.payload_json, '$.batch.items') item
      where json_type(item.value, '$.issue.status') is not null
    )
  )
begin
  select raise(abort, 'channel issue proposal payload cannot include status');
end;

CREATE TRIGGER briar_conversation_issue_proposal_current_insert_guard
before insert on briar_issue_action_proposals
when new.action_type = 'request_issue_create'
  and json_type(new.payload_json, '$.issue.status') is not null
begin
  select raise(abort, 'conversation issue proposal payload cannot include status');
end;

CREATE TRIGGER briar_channel_issue_batch_items_immutable_delete
before delete on briar_channel_issue_batch_items
when exists (
  select 1 from briar_organizations organization
  where organization.id = old.organization_id
)
begin
  select raise(abort, 'channel issue batch mapping is immutable');
end;

CREATE TRIGGER briar_channel_issue_proposal_action_insert_guard
before insert on briar_channel_action_proposals
when new.action_type <> 'request_issue_create'
begin
  select raise(abort, 'channel proposals must create issues');
end;

CREATE TRIGGER briar_channel_issue_proposal_action_update_guard
before update of action_type on briar_channel_action_proposals
when new.action_type <> 'request_issue_create'
begin
  select raise(abort, 'channel proposals must create issues');
end;

CREATE TRIGGER briar_channel_message_blocks_array_insert
before insert on briar_channel_messages
when new.blocks_json is not null
  and case
    when not json_valid(new.blocks_json) then 1
    when json_type(new.blocks_json) <> 'array' then 1
    when json_array_length(new.blocks_json) not between 1 and 50 then 1
    when length(cast(new.blocks_json as blob)) > 1048576 then 1
    else 0
  end
begin
  select raise(abort, 'channel message blocks must be a bounded JSON array');
end;

CREATE TRIGGER briar_channel_message_blocks_array_update
before update of blocks_json on briar_channel_messages
when new.blocks_json is not null
  and case
    when not json_valid(new.blocks_json) then 1
    when json_type(new.blocks_json) <> 'array' then 1
    when json_array_length(new.blocks_json) not between 1 and 50 then 1
    when length(cast(new.blocks_json as blob)) > 1048576 then 1
    else 0
  end
begin
  select raise(abort, 'channel message blocks must be a bounded JSON array');
end;

CREATE TRIGGER briar_workflow_checkpoint_storage_validate
instead of insert on briar_workflow_checkpoint_storage_validation
when not (
  new.owner in ('project', 'user', 'issue')
  and new.checkpoints_json is not null
  and
  json_valid(new.checkpoints_json)
  and case
        when json_valid(new.checkpoints_json)
          then json_type(new.checkpoints_json)
        else null
      end = 'array'
  and json_array_length(
        case
          when json_valid(new.checkpoints_json)
            then case
              when json_type(new.checkpoints_json) = 'array'
                then new.checkpoints_json
              else '[]'
            end
          else '[]'
        end
      ) <= 100
  and not exists (
    select 1
    from json_each(
      case
        when json_valid(new.checkpoints_json)
          then case
            when json_type(new.checkpoints_json) = 'array'
              then new.checkpoints_json
            else '[]'
          end
        else '[]'
      end
    ) checkpoint
    where checkpoint.type <> 'object'
       or (
         select count(*)
         from json_each(
           case when checkpoint.type = 'object'
             then checkpoint.value else '{}'
           end
         ) field
       ) <> 3
       or coalesce(json_type(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.key'
       ), '') <> 'text'
       or length(json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.key'
       )) not between 1 and 64
       or substr(json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.key'
       ), 1, 1) not glob '[a-z]'
       or json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.key'
       ) glob '*[^a-z0-9_-]*'
       or case new.owner
            when 'project' then json_extract(
              case when checkpoint.type = 'object'
                then checkpoint.value else '{}'
              end,
              '$.key'
            ) not glob 'project-*'
            when 'user' then json_extract(
              case when checkpoint.type = 'object'
                then checkpoint.value else '{}'
              end,
              '$.key'
            ) not glob 'user-*'
            when 'issue' then json_extract(
              case when checkpoint.type = 'object'
                then checkpoint.value else '{}'
              end,
              '$.key'
            ) not glob 'issue-*'
            else 1
          end
       or coalesce(json_type(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.stage'
       ), '') <> 'text'
       or length(json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.stage'
       )) not between 1 and 64
       or substr(json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.stage'
       ), 1, 1) not glob '[a-z]'
       or json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.stage'
       ) glob '*[^a-z0-9_-]*'
       or coalesce(json_type(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.position'
       ), '') <> 'text'
       or json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.position'
       ) not in ('before', 'after')
  )
)
begin
  select raise(abort, 'workflow checkpoints must use the canonical shape');
end;

pragma defer_foreign_keys = off;
