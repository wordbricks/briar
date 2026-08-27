create table briar_hunt_runs_difficulty_backup (
  id text primary key not null,
  difficulty text
);

insert into briar_hunt_runs_difficulty_backup (id, difficulty)
  select id, difficulty from briar_hunt_runs;

alter table briar_hunt_runs drop column difficulty;

alter table briar_hunt_runs
  add column difficulty text
  check (difficulty in ('easy', 'normal', 'hard'));

update briar_hunt_runs
set difficulty = (
  select difficulty
  from briar_hunt_runs_difficulty_backup
  where briar_hunt_runs_difficulty_backup.id = briar_hunt_runs.id
);

drop table briar_hunt_runs_difficulty_backup;
