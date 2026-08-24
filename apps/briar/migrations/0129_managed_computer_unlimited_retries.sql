-- Manual managed-computer retries remain user initiated and idempotent. Remove
-- the original pilot cap while preserving the retry count and every job for
-- audit history.
pragma defer_foreign_keys = on;

drop trigger if exists briar_managed_computers_state_transition;

-- D1 keeps foreign keys enabled during migrations. Rebuilding the parent
-- computer table therefore cascades its child rows, so preserve and restore
-- every direct child in dependency order.
create table briar_0129_promotion_redemptions as
select * from briar_managed_computer_promotion_redemptions;
create table briar_0129_provisioning_jobs as
select * from briar_managed_computer_provisioning_jobs;
create table briar_0129_audit_events as
select * from briar_managed_computer_audit_events;
create table briar_0129_remote_sessions as
select * from briar_managed_computer_remote_sessions;
create table briar_0129_remote_audit_events as
select * from briar_managed_computer_remote_audit_events;

delete from briar_managed_computer_remote_audit_events;
delete from briar_managed_computer_remote_sessions;
delete from briar_managed_computer_audit_events;
delete from briar_managed_computer_provisioning_jobs;
delete from briar_managed_computer_promotion_redemptions;

create table briar_managed_computers_new (
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
  retry_count integer not null default 0 check (retry_count >= 0),
  created_at text not null,
  state_updated_at text not null,
  expires_at text not null,
  last_retry_at text,
  drained_at text,
  stopped_at text,
  terminated_at text,
  updated_at text not null
);

insert into briar_managed_computers_new (
  id, organization_id, requester_user_id, entitlement_id, state,
  aws_account_id, aws_region, aws_instance_type, aws_instance_id,
  aws_volume_id, aws_launch_template_id, aws_launch_template_version,
  bootstrap_api_origin, briar_device_id, provisioning_job_id,
  enrollment_nonce_hash, enrollment_expires_at, enrollment_consumed_at,
  enrollment_identity_hash, error_code, error_detail, retry_count, created_at,
  state_updated_at, expires_at, last_retry_at, drained_at, stopped_at,
  terminated_at, updated_at
)
select
  id, organization_id, requester_user_id, entitlement_id, state,
  aws_account_id, aws_region, aws_instance_type, aws_instance_id,
  aws_volume_id, aws_launch_template_id, aws_launch_template_version,
  bootstrap_api_origin, briar_device_id, provisioning_job_id,
  enrollment_nonce_hash, enrollment_expires_at, enrollment_consumed_at,
  enrollment_identity_hash, error_code, error_detail, retry_count, created_at,
  state_updated_at, expires_at, last_retry_at, drained_at, stopped_at,
  terminated_at, updated_at
from briar_managed_computers;

drop table briar_managed_computers;
alter table briar_managed_computers_new rename to briar_managed_computers;

create index briar_managed_computers_organization_idx
  on briar_managed_computers (organization_id, created_at desc);
create index briar_managed_computers_fleet_idx
  on briar_managed_computers (state, created_at);
create index briar_managed_computers_expiry_idx
  on briar_managed_computers (expires_at, state);
create index briar_managed_computers_device_idx
  on briar_managed_computers (briar_device_id, state);

create table briar_managed_computer_provisioning_jobs_new (
  id text primary key not null,
  managed_computer_id text not null
    references briar_managed_computers (id) on delete cascade,
  workflow_instance_id text not null unique,
  idempotency_key text not null unique,
  status text not null default 'requested'
    check (status in ('requested', 'running', 'succeeded', 'failed')),
  attempt integer not null default 1 check (attempt >= 1),
  error_code text,
  error_detail text,
  started_at text,
  completed_at text,
  created_at text not null,
  updated_at text not null,
  unique (managed_computer_id, attempt)
);

insert into briar_managed_computer_provisioning_jobs_new (
  id, managed_computer_id, workflow_instance_id, idempotency_key, status,
  attempt, error_code, error_detail, started_at, completed_at, created_at,
  updated_at
)
select
  id, managed_computer_id, workflow_instance_id, idempotency_key, status,
  attempt, error_code, error_detail, started_at, completed_at, created_at,
  updated_at
from briar_0129_provisioning_jobs;

drop table briar_managed_computer_provisioning_jobs;
alter table briar_managed_computer_provisioning_jobs_new
  rename to briar_managed_computer_provisioning_jobs;

create index briar_managed_computer_jobs_status_idx
  on briar_managed_computer_provisioning_jobs (status, created_at);

insert into briar_managed_computer_promotion_redemptions
select * from briar_0129_promotion_redemptions;
insert into briar_managed_computer_audit_events
select * from briar_0129_audit_events;
insert into briar_managed_computer_remote_sessions
select * from briar_0129_remote_sessions;
insert into briar_managed_computer_remote_audit_events
select * from briar_0129_remote_audit_events;

drop table briar_0129_promotion_redemptions;
drop table briar_0129_provisioning_jobs;
drop table briar_0129_audit_events;
drop table briar_0129_remote_sessions;
drop table briar_0129_remote_audit_events;

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

pragma defer_foreign_keys = off;
