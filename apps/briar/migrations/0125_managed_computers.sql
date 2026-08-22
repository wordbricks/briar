-- Managed computers use an entitlement boundary that is deliberately separate
-- from billing. The pilot approves entitlements through a server-validated
-- promotion; a later Stripe approval can create the same entitlement shape.
create table briar_managed_computer_campaigns (
  id text primary key not null,
  code_key text not null unique check (
    code_key = lower(trim(code_key)) and length(code_key) between 1 and 80
  ),
  name text not null check (length(trim(name)) between 1 and 160),
  active integer not null default 1 check (active in (0, 1)),
  created_at text not null,
  updated_at text not null
);

insert into briar_managed_computer_campaigns (
  id, code_key, name, active, created_at, updated_at
) values (
  'getbriar-pilot', 'getbriar-pilot', 'GETBRIAR managed computer pilot', 1,
  '2026-08-21T00:00:00.000Z', '2026-08-21T00:00:00.000Z'
);

create table briar_managed_computer_entitlements (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  requester_user_id text not null references "user" (id) on delete restrict,
  source text not null check (source in ('free_promotion', 'payment')),
  source_reference text not null check (length(trim(source_reference)) > 0),
  request_id text not null check (length(trim(request_id)) between 1 and 200),
  status text not null default 'approved'
    check (status in ('approved', 'revoked', 'expired')),
  approved_at text not null,
  revoked_at text,
  expires_at text,
  created_at text not null,
  updated_at text not null,
  unique (organization_id, request_id)
);

create index briar_managed_computer_entitlements_requester_idx
  on briar_managed_computer_entitlements
    (requester_user_id, approved_at desc);

create table briar_managed_computers (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  requester_user_id text not null references "user" (id) on delete restrict,
  entitlement_id text not null unique
    references briar_managed_computer_entitlements (id) on delete restrict,
  state text not null default 'requested' check (state in (
    'requested', 'provisioning', 'bootstrapping', 'needs_setup', 'ready',
    'failed', 'draining', 'stopped', 'terminated'
  )),
  aws_account_id text,
  aws_region text not null check (length(trim(aws_region)) between 1 and 40),
  aws_instance_type text not null
    check (length(trim(aws_instance_type)) between 1 and 80),
  aws_instance_id text unique,
  aws_volume_id text,
  aws_launch_template_id text not null
    check (length(trim(aws_launch_template_id)) between 1 and 200),
  aws_launch_template_version text not null
    check (length(trim(aws_launch_template_version)) between 1 and 40),
  bootstrap_api_origin text not null
    check (bootstrap_api_origin like 'https://%'),
  briar_device_id text unique
    references briar_execution_worker_devices (id) on delete set null,
  provisioning_job_id text not null unique,
  enrollment_nonce_hash text not null unique check (
    length(enrollment_nonce_hash) = 64
    and enrollment_nonce_hash not glob '*[^0-9a-f]*'
  ),
  enrollment_expires_at text not null,
  enrollment_consumed_at text,
  enrollment_identity_hash text check (
    enrollment_identity_hash is null or (
      length(enrollment_identity_hash) = 64
      and enrollment_identity_hash not glob '*[^0-9a-f]*'
    )
  ),
  error_code text,
  error_detail text,
  retry_count integer not null default 0 check (retry_count between 0 and 3),
  created_at text not null,
  state_updated_at text not null,
  expires_at text not null,
  last_retry_at text,
  drained_at text,
  stopped_at text,
  terminated_at text,
  updated_at text not null
);

create index briar_managed_computers_organization_idx
  on briar_managed_computers (organization_id, created_at desc);
create index briar_managed_computers_fleet_idx
  on briar_managed_computers (state, created_at);
create index briar_managed_computers_expiry_idx
  on briar_managed_computers (expires_at, state);
create index briar_managed_computers_device_idx
  on briar_managed_computers (briar_device_id, state);

create table briar_managed_computer_promotion_redemptions (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  user_id text not null references "user" (id) on delete restrict,
  managed_computer_id text not null unique
    references briar_managed_computers (id) on delete restrict,
  campaign_id text not null
    references briar_managed_computer_campaigns (id) on delete restrict,
  request_id text not null check (
    length(trim(request_id)) between 1 and 200
  ),
  redeemed_at text not null,
  unique (organization_id, request_id),
  unique (organization_id, campaign_id),
  unique (user_id, campaign_id)
);

create index briar_managed_computer_redemptions_campaign_idx
  on briar_managed_computer_promotion_redemptions
    (campaign_id, redeemed_at desc);

create table briar_managed_computer_provisioning_jobs (
  id text primary key not null,
  managed_computer_id text not null
    references briar_managed_computers (id) on delete cascade,
  workflow_instance_id text not null unique,
  idempotency_key text not null unique,
  status text not null default 'requested'
    check (status in ('requested', 'running', 'succeeded', 'failed')),
  attempt integer not null default 1 check (attempt between 1 and 4),
  error_code text,
  error_detail text,
  started_at text,
  completed_at text,
  created_at text not null,
  updated_at text not null,
  unique (managed_computer_id, attempt)
);

create index briar_managed_computer_jobs_status_idx
  on briar_managed_computer_provisioning_jobs (status, created_at);

create table briar_managed_computer_audit_events (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  managed_computer_id text
    references briar_managed_computers (id) on delete cascade,
  actor_user_id text references "user" (id) on delete set null,
  action text not null check (action in (
    'promotion_validated', 'entitlement_approved', 'requested',
    'provisioning_started', 'instance_created', 'bootstrapping_started',
    'enrolled', 'ready', 'provisioning_failed', 'retry_requested',
    'draining_started', 'stopped', 'terminated', 'orphan_detected',
    'reconciled'
  )),
  request_id text,
  detail_json text not null default '{}'
    check (json_valid(detail_json) and json_type(detail_json) = 'object'),
  occurred_at text not null
);

create index briar_managed_computer_audit_organization_idx
  on briar_managed_computer_audit_events
    (organization_id, occurred_at desc);
create index briar_managed_computer_audit_computer_idx
  on briar_managed_computer_audit_events
    (managed_computer_id, occurred_at desc);

-- Keep lifecycle updates explicit. Repeated writes to the same state are
-- allowed so reconciliation remains idempotent.
create trigger briar_managed_computers_state_transition
before update of state on briar_managed_computers
when new.state != old.state and not (
  (old.state = 'requested' and new.state in ('provisioning', 'failed', 'draining')) or
  (old.state = 'provisioning' and new.state in ('bootstrapping', 'failed', 'draining')) or
  (old.state = 'bootstrapping' and new.state in ('needs_setup', 'failed', 'draining')) or
  (old.state = 'needs_setup' and new.state in ('ready', 'failed', 'draining')) or
  (old.state = 'ready' and new.state in ('failed', 'draining')) or
  (old.state = 'failed' and new.state in ('requested', 'draining', 'terminated')) or
  (old.state = 'draining' and new.state in ('stopped', 'failed')) or
  (old.state = 'stopped' and new.state in ('terminated', 'failed'))
)
begin
  select raise(abort, 'invalid managed computer state transition');
end;
