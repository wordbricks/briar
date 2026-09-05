-- Managed computers gain a provider. AWS computers are provisioned and
-- reconciled by Briar; sandbox computers are Docker containers a member runs
-- on their own hardware and registers through `briar sandbox up` so their
-- desktop can join the remote-desktop relay. Only AWS rows take part in
-- provisioning, expiry, draining, and pilot capacity accounting.
alter table briar_managed_computers
  add column provider text not null default 'aws'
    check (provider in ('aws', 'sandbox'));

create index briar_managed_computers_provider_idx
  on briar_managed_computers (provider, state);
