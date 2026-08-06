pragma foreign_keys = on;

-- A product is the user-facing unit of planning. Projects remain the
-- repository-scoped execution boundary and belong to exactly one product.
create table briar_products (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  created_at text not null,
  updated_at text not null
);

create index briar_products_organization_idx
  on briar_products (organization_id, created_at, id);

alter table briar_projects add column product_id text
  references briar_products (id) on delete cascade;

-- Every existing repository project starts in a same-named product. Reusing
-- the project UUID keeps the migration deterministic and retry-friendly.
insert into briar_products (id, organization_id, name, created_at, updated_at)
select id, organization_id, name, created_at, updated_at
from briar_projects;

update briar_projects set product_id = id where product_id is null;

create index briar_projects_product_idx
  on briar_projects (product_id, created_at, id);

-- Older clients and a few operational scripts can still create a project
-- without sending product_id. Keep those writes valid by creating the same
-- backwards-compatible one-project product used by the migration above.
create trigger briar_projects_default_product
after insert on briar_projects
when new.product_id is null
begin
  insert into briar_products (
    id, organization_id, name, created_at, updated_at
  ) values (
    new.id, new.organization_id, new.name, new.created_at, new.updated_at
  );
  update briar_projects set product_id = new.id where id = new.id;
end;

create table briar_product_work_items (
  id text primary key not null,
  product_id text not null references briar_products (id) on delete cascade,
  source text not null default 'issue'
    check (source in ('issue', 'error', 'feedback')),
  source_key text not null check (
    source_key = trim(source_key) and length(source_key) between 1 and 200
  ),
  title text not null check (length(trim(title)) between 1 and 300),
  description text check (description is null or length(description) <= 100000),
  priority integer check (priority is null or priority between 1 and 4),
  assignee_user_id text references "user" (id) on delete set null,
  status text not null check (status in (
    'backlog', 'queued', 'in_progress', 'blocked', 'failed',
    'ready_for_review', 'completed', 'cancelled'
  )),
  created_by_user_id text references "user" (id) on delete set null,
  completed_at text,
  created_at text not null,
  updated_at text not null,
  unique (product_id, source, source_key),
  check (
    (status in ('completed', 'cancelled') and completed_at is not null)
    or (status not in ('completed', 'cancelled') and completed_at is null)
  )
);

create index briar_product_work_items_product_idx
  on briar_product_work_items (product_id, updated_at desc, id);

create table briar_product_work_item_runs (
  work_item_id text not null
    references briar_product_work_items (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null unique references briar_hunt_runs (id) on delete cascade,
  required integer not null default 1 check (required in (0, 1)),
  position integer not null check (position >= 0),
  created_at text not null,
  primary key (work_item_id, project_id),
  unique (work_item_id, position)
);

create index briar_product_work_item_runs_project_idx
  on briar_product_work_item_runs (project_id, created_at, run_id);

-- Dependencies here may cross repository projects, unlike the legacy
-- project-local dependency table.
create table briar_product_work_item_dependencies (
  work_item_id text not null
    references briar_product_work_items (id) on delete cascade,
  prerequisite_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  dependent_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  created_by_user_id text references "user" (id) on delete set null,
  created_at text not null,
  primary key (prerequisite_run_id, dependent_run_id),
  check (prerequisite_run_id <> dependent_run_id)
);

create index briar_product_work_item_dependencies_item_idx
  on briar_product_work_item_dependencies (
    work_item_id, dependent_run_id, created_at
  );

-- Product status is an aggregate of required child runs. Completion remains a
-- deliberate product-level acceptance step after every required run finishes.
create trigger briar_product_work_item_status_refresh
after update of status, paused_at on briar_hunt_runs
when exists (
  select 1 from briar_product_work_item_runs link where link.run_id = new.id
)
begin
  update briar_product_work_items
  set status = case
        when status = 'cancelled' then status
        when status = 'completed' and not exists (
          select 1
          from briar_product_work_item_runs link
          join briar_hunt_runs run on run.id = link.run_id
          where link.work_item_id = (
            select work_item_id from briar_product_work_item_runs
            where run_id = new.id
          ) and link.required = 1 and run.status != 'completed'
        ) then status
        when not exists (
          select 1
          from briar_product_work_item_runs link
          join briar_hunt_runs run on run.id = link.run_id
          where link.work_item_id = (
            select work_item_id from briar_product_work_item_runs
            where run_id = new.id
          ) and link.required = 1 and run.status != 'completed'
        ) then 'ready_for_review'
        when exists (
          select 1
          from briar_product_work_item_runs link
          join briar_hunt_runs run on run.id = link.run_id
          where link.work_item_id = (
            select work_item_id from briar_product_work_item_runs
            where run_id = new.id
          ) and link.required = 1 and run.status = 'running'
        ) then 'in_progress'
        when exists (
          select 1
          from briar_product_work_item_runs link
          join briar_hunt_runs run on run.id = link.run_id
          where link.work_item_id = (
            select work_item_id from briar_product_work_item_runs
            where run_id = new.id
          ) and link.required = 1 and run.status = 'blocked'
        ) then 'blocked'
        when exists (
          select 1
          from briar_product_work_item_runs link
          join briar_hunt_runs run on run.id = link.run_id
          where link.work_item_id = (
            select work_item_id from briar_product_work_item_runs
            where run_id = new.id
          ) and link.required = 1 and run.status = 'failed'
        ) then 'failed'
        when exists (
          select 1
          from briar_product_work_item_runs link
          join briar_hunt_runs run on run.id = link.run_id
          where link.work_item_id = (
            select work_item_id from briar_product_work_item_runs
            where run_id = new.id
          ) and link.required = 1 and run.status = 'queued'
        ) then 'queued'
        else 'backlog'
      end,
      completed_at = case
        when status = 'completed' and not exists (
          select 1
          from briar_product_work_item_runs link
          join briar_hunt_runs run on run.id = link.run_id
          where link.work_item_id = (
            select work_item_id from briar_product_work_item_runs
            where run_id = new.id
          ) and link.required = 1 and run.status != 'completed'
        ) then completed_at
        else null
      end,
      updated_at = datetime('now')
  where id = (
    select work_item_id from briar_product_work_item_runs where run_id = new.id
  );
end;
