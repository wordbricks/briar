-- Related archive object keys are cleanup identities, not best-effort metadata.
-- Retire any malformed v2 metadata through the retryable cleanup queue before
-- requiring every current element to satisfy the queue's object-key invariant.
insert into briar_archive_cleanup_queue (
  bucket, object_key, project_id, run_id, queued_at
)
select 'archives', archive.object_key, archive.project_id, archive.run_id,
       datetime('now')
from briar_log_archives archive
where exists (
  select 1 from json_each(archive.related_object_keys_json) related
  where related.type <> 'text'
    or related.value <> trim(related.value)
    or length(related.value) not between 1 and 1024
)
on conflict (bucket, object_key) do update set
  project_id = excluded.project_id,
  run_id = excluded.run_id,
  queued_at = excluded.queued_at,
  attempts = 0,
  last_attempt_at = null,
  last_error = null,
  generation = briar_archive_cleanup_queue.generation + 1,
  next_attempt_at = null,
  dead_lettered_at = null,
  alert_state = 'none',
  alert_detail_json = null;

insert into briar_archive_cleanup_queue (
  bucket, object_key, project_id, run_id, queued_at
)
select 'attachments', related.value, archive.project_id, archive.run_id,
       datetime('now')
from briar_log_archives archive
join json_each(archive.related_object_keys_json) related
  on related.type = 'text'
 and related.value = trim(related.value)
 and length(related.value) between 1 and 1024
where exists (
  select 1 from json_each(archive.related_object_keys_json) invalid
  where invalid.type <> 'text'
    or invalid.value <> trim(invalid.value)
    or length(invalid.value) not between 1 and 1024
)
and not exists (
  select 1
  from briar_log_archives retained
  join json_each(retained.related_object_keys_json) retained_related
    on retained_related.type = 'text'
   and retained_related.value = related.value
  where retained.id <> archive.id
    and not exists (
      select 1 from json_each(retained.related_object_keys_json) invalid
      where invalid.type <> 'text'
        or invalid.value <> trim(invalid.value)
        or length(invalid.value) not between 1 and 1024
    )
)
on conflict (bucket, object_key) do update set
  project_id = excluded.project_id,
  run_id = excluded.run_id,
  queued_at = excluded.queued_at,
  attempts = 0,
  last_attempt_at = null,
  last_error = null,
  generation = briar_archive_cleanup_queue.generation + 1,
  next_attempt_at = null,
  dead_lettered_at = null,
  alert_state = 'none',
  alert_detail_json = null;

delete from briar_log_archives
where exists (
  select 1 from json_each(related_object_keys_json) related
  where related.type <> 'text'
    or related.value <> trim(related.value)
    or length(related.value) not between 1 and 1024
);

create trigger briar_archive_related_object_keys_insert_guard
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

create trigger briar_archive_related_object_keys_update_guard
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
