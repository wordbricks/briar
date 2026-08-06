-- Ideas become organization-scoped. A null project_id marks an organization
-- idea: it is owned by the organization, drafted without repository context,
-- and names a target project only when its plan is converted into issues.
--
-- Idea jobs follow the same rule. Organization jobs are claimed by any online
-- device in the organization; project jobs keep requiring a project binding.
pragma defer_foreign_keys = on;

create table briar_ideas_new (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  -- Null means an organization idea with no repository context.
  project_id text references briar_projects (id) on delete cascade,
  author_user_id text not null references "user" (id) on delete cascade,
  title text not null default 'New idea'
    check (length(trim(title)) between 1 and 300),
  title_is_auto integer not null default 1 check (title_is_auto in (0, 1)),
  document_markdown text not null default ''
    check (length(document_markdown) <= 200000),
  status text not null default 'draft' check (status in (
    'draft', 'refining', 'ready', 'issues_created', 'archived'
  )),
  provider text not null check (provider in (
    'codex', 'claude', 'grok', 'opencode'
  )),
  model text check (
    model is null or length(trim(model)) between 1 and 100
  ),
  version integer not null default 1 check (version >= 1),
  replacement_lock_until text,
  created_at text not null,
  updated_at text not null
);

insert into briar_ideas_new (
  id, organization_id, project_id, author_user_id, title, title_is_auto,
  document_markdown, status, provider, model, version, replacement_lock_until,
  created_at, updated_at
)
select idea.id, project.organization_id, idea.project_id, idea.author_user_id,
       idea.title, idea.title_is_auto, idea.document_markdown, idea.status,
       idea.provider, idea.model, idea.version, idea.replacement_lock_until,
       idea.created_at, idea.updated_at
from briar_ideas idea
join briar_projects project on project.id = idea.project_id;

drop table briar_ideas;
alter table briar_ideas_new rename to briar_ideas;

create index briar_ideas_project_idx
  on briar_ideas (project_id, updated_at desc, id);
create index briar_ideas_author_idx
  on briar_ideas (author_user_id, updated_at desc);
create index briar_ideas_organization_idx
  on briar_ideas (organization_id, updated_at desc, id);

create table briar_idea_jobs_new (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text references briar_projects (id) on delete cascade,
  idea_id text not null references briar_ideas (id) on delete cascade,
  kind text not null check (kind in ('chat', 'issue_plan')),
  trigger_message_id text references briar_idea_messages (id) on delete cascade,
  reply_message_id text,
  expected_version integer not null check (expected_version >= 1),
  provider text not null check (provider in (
    'codex', 'claude', 'grok', 'opencode'
  )),
  model text check (model is null or length(trim(model)) between 1 and 100),
  status text not null default 'queued' check (status in (
    'queued', 'running', 'completed', 'failed'
  )),
  claimed_worker_id text
    references briar_execution_workers (id) on delete set null,
  -- Organization jobs are attributed to a device instead of a project binding.
  claimed_device_id text
    references briar_execution_worker_devices (id) on delete set null,
  claim_token_hash text,
  claimed_at text,
  lease_expires_at text,
  attempts integer not null default 0 check (attempts >= 0),
  error text check (error is null or length(error) <= 4000),
  created_at text not null,
  updated_at text not null,
  completed_at text
);

insert into briar_idea_jobs_new (
  id, organization_id, project_id, idea_id, kind, trigger_message_id,
  reply_message_id, expected_version, provider, model, status,
  claimed_worker_id, claimed_device_id, claim_token_hash, claimed_at,
  lease_expires_at, attempts, error, created_at, updated_at, completed_at
)
select job.id, project.organization_id, job.project_id, job.idea_id, job.kind,
       job.trigger_message_id, job.reply_message_id, job.expected_version,
       job.provider, job.model, job.status, job.claimed_worker_id, null,
       job.claim_token_hash, job.claimed_at, job.lease_expires_at,
       job.attempts, job.error, job.created_at, job.updated_at,
       job.completed_at
from briar_idea_jobs job
join briar_projects project on project.id = job.project_id;

drop table briar_idea_jobs;
alter table briar_idea_jobs_new rename to briar_idea_jobs;

create unique index briar_idea_jobs_active_idx
  on briar_idea_jobs (idea_id)
  where status in ('queued', 'running');
create index briar_idea_jobs_claim_idx
  on briar_idea_jobs (project_id, status, created_at);
create index briar_idea_jobs_organization_claim_idx
  on briar_idea_jobs (organization_id, status, project_id, created_at);

pragma defer_foreign_keys = off;
