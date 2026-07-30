pragma foreign_keys = on;

-- Keep repository connections independent per user and computer. The legacy
-- project token remains valid for existing installations, while every new
-- connection receives an additional token that does not rotate older ones.
create table briar_project_agent_tokens (
  token_hash text primary key not null check (
    length(token_hash) = 64
    and token_hash not glob '*[^0-9a-f]*'
  ),
  project_id text not null
    references briar_projects (id) on delete cascade,
  issued_to_user_id text
    references "user" (id) on delete set null,
  created_at text not null
);

create index briar_project_agent_tokens_project_idx
  on briar_project_agent_tokens (project_id, created_at);

insert into briar_project_agent_tokens (
  token_hash, project_id, issued_to_user_id, created_at
)
select agent_token_hash, id, owner_user_id, created_at
from briar_projects;
