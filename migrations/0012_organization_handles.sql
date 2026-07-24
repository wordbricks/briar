alter table briar_organizations add column handle text not null
  default 'organization-pending'
  check (
    length(handle) between 1 and 63
    and handle not glob '*[^a-z0-9-]*'
  );

update briar_organizations
set handle = 'organization-' || lower(replace(id, '-', ''));

create unique index briar_organizations_handle_idx
  on briar_organizations (handle);
