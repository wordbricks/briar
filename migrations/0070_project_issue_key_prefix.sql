alter table briar_projects
  add column issue_key_prefix text not null default 'AH'
  check (
    issue_key_prefix = upper(trim(issue_key_prefix))
    and length(issue_key_prefix) between 1 and 3
    and issue_key_prefix not glob '*[^A-Z0-9]*'
  );
