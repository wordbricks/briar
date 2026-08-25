alter table briar_hunt_runs
  add column difficulty text not null default 'normal'
  check (difficulty in ('easy', 'normal', 'hard'));
