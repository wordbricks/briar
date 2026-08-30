pragma foreign_keys = on;

-- Repository names can change and can later be reused. Keep the immutable
-- GitHub database ID beside owner/name so clone, PR, status, and merge
-- operations can prove that they still target the repository selected through
-- the organization's GitHub App installation.
alter table briar_project_settings
  add column github_repository_id integer
    check (github_repository_id is null or github_repository_id > 0);
