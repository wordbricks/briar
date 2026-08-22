-- Project Home reads usage by project without scanning every execution
-- attempt in the organization.
create index briar_run_execution_attempts_project_idx
  on briar_run_execution_attempts (project_id, id);
