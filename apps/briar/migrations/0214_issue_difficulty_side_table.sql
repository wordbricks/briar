-- Move the issue difficulty off briar_hunt_runs and into a side table, so that
-- adding a difficulty is one insert instead of a rebuild.
--
-- briar_hunt_runs.difficulty carries `check (difficulty in ('easy', 'normal',
-- 'hard'))`. SQLite cannot alter a CHECK in place and D1 blocks every shortcut
-- (see docs/operations/d1-schema-changes.md), so widening that list means
-- rebuilding the table and parking its foreign-key closure. The generated
-- rebuild that did exactly that came to 469 statements / 185 KB and failed the
-- remote D1 import twice with {"D1_RESET_DO":true}; splitting it into parts was
-- worse, because each part imports atomically on its own and a failure
-- mid-sequence would leave backup tables behind an emptied parent. Nothing in
-- this migration is rebuilt, parked, emptied or restored.
--
-- The legacy column stays exactly where it is, CHECK included. SQLite refuses
-- to drop a column named in a CHECK constraint, so dropping it would require
-- the very rebuild this migration exists to avoid. It becomes write-once
-- history: it keeps the value it had, nothing writes it again, and every read
-- and write moves to briar_run_difficulties. New rows leave it NULL, which the
-- old CHECK accepts -- `col in (...)` evaluates to NULL, not false, when col is
-- NULL, and a CHECK only fails on false.
--
-- Row cost: 4 lookup rows plus one backfilled row per run that has a difficulty
-- set, bounded by the 1,011 rows briar_hunt_runs held in production on
-- 2026-09-08. Under 1,100 rows written in total.

pragma foreign_keys = on;

-- The catalog the difficulty column now keys against. Adding a fifth
-- difficulty is one insert here, forever; the derived proto_name keeps the
-- table honest against briar.app.v1.IssueDifficulty.
create table briar_issue_difficulties (
  difficulty text primary key not null,
  proto_name text not null unique
    check (proto_name = 'ISSUE_DIFFICULTY_' || upper(difficulty))
) strict;

insert into briar_issue_difficulties (difficulty, proto_name)
values
  ('easy', 'ISSUE_DIFFICULTY_EASY'),
  ('normal', 'ISSUE_DIFFICULTY_NORMAL'),
  ('hard', 'ISSUE_DIFFICULTY_HARD'),
  ('expert', 'ISSUE_DIFFICULTY_EXPERT');

-- One row per run that has a difficulty; no row means "unset", which is how the
-- clear path works without needing a nullable column. Timestamps are
-- deliberately absent, as on briar_run_stage_revisions: every difficulty write
-- also bumps briar_hunt_runs.updated_at, which is what the dashboard sync
-- trigger watches and what the mutation receipts guard on. A leaf table, so the
-- cascade it adds sits alongside briar_run_stage_progress rather than below it
-- and does not deepen the delete walk D1 caps at 10.
create table briar_run_difficulties (
  run_id text primary key not null
    references briar_hunt_runs (id) on delete cascade,
  difficulty text not null
    references briar_issue_difficulties (difficulty)
) strict;

-- Boards group and filter by difficulty across a project's runs.
create index briar_run_difficulties_difficulty_idx
  on briar_run_difficulties (difficulty);

insert into briar_run_difficulties (run_id, difficulty)
select id, difficulty from briar_hunt_runs where difficulty is not null;
