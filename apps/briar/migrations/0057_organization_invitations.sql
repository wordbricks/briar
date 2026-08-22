pragma foreign_keys = on;

create table briar_organization_invitations (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  initial_project_id text not null
    references briar_projects (id) on delete cascade,
  email_normalized text not null
    check (
      length(email_normalized) between 3 and 320
      and email_normalized = lower(trim(email_normalized))
    ),
  role text not null check (role in ('admin', 'member')),
  token_hash text not null unique check (
    length(token_hash) = 64
    and token_hash not glob '*[^0-9a-f]*'
  ),
  invited_by_user_id text references "user" (id) on delete set null,
  expires_at text not null,
  accepted_at text,
  accepted_by_user_id text references "user" (id) on delete set null,
  revoked_at text,
  created_at text not null,
  updated_at text not null,
  check (accepted_at is null or revoked_at is null)
);

create index briar_organization_invitations_org_idx
  on briar_organization_invitations (
    organization_id, accepted_at, revoked_at, created_at desc
  );

create index briar_organization_invitations_email_idx
  on briar_organization_invitations (
    email_normalized, accepted_at, revoked_at, expires_at
  );

create unique index briar_organization_invitations_pending_idx
  on briar_organization_invitations (organization_id, email_normalized)
  where accepted_at is null and revoked_at is null;
