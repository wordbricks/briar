pragma foreign_keys = on;

-- Production archives must be ported through archive-storage-backfill before
-- the strict runtime decoder deploys. A failed assertion aborts the migration
-- without changing either metadata or the original R2 objects.
create table briar_archive_storage_backfill_guard (
  remaining integer not null check (remaining = 0)
);

insert into briar_archive_storage_backfill_guard (remaining)
select count(*)
from briar_log_archives
where archive_kind = 'project_agent_sessions'
  and status in ('verified', 'complete')
  and instr(object_key, '.canonical-v1-') = 0;

drop table briar_archive_storage_backfill_guard;

-- Archive format 1 remains canonical: the stricter Effect decoder did not
-- change the manifest or record wire shape. Preserve every R2 object and its
-- searchable D1 metadata. Normalize only invalid related-object identities,
-- retaining every valid key so attachment cleanup remains complete.
update briar_log_archives as archive
set related_object_keys_json = coalesce((
  select json_group_array(related.value)
  from json_each(archive.related_object_keys_json) related
  where related.type = 'text'
    and related.value = trim(related.value)
    and length(related.value) between 1 and 1024
), '[]')
where exists (
  select 1 from json_each(archive.related_object_keys_json) related
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
