alter table briar_project_agents
add column computer_use_policy text not null default 'disabled'
check (computer_use_policy in ('disabled', 'unattended'));
