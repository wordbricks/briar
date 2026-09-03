create table if not exists briar_production_operation_leases (
  name text primary key not null,
  owner text not null,
  head_sha text not null,
  acquired_at integer not null,
  expires_at integer not null,
  constraint briar_production_operation_leases_name_check
    check (length(name) between 1 and 80),
  constraint briar_production_operation_leases_owner_check
    check (length(owner) between 1 and 80),
  constraint briar_production_operation_leases_head_sha_check
    check (head_sha not glob '*[^0-9a-f]*' and length(head_sha) = 40),
  constraint briar_production_operation_leases_expiry_check
    check (expires_at > acquired_at)
) strict;
