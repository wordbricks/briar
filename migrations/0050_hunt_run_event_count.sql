alter table briar_hunt_runs
  add column event_count integer not null default 0 check (event_count >= 0);

update briar_hunt_runs
set event_count = (
  select count(*)
  from briar_hunt_events event
  where event.run_id = briar_hunt_runs.id
);

create trigger briar_hunt_events_increment_run_event_count
after insert on briar_hunt_events BEGIN
  update briar_hunt_runs
  set event_count = event_count + 1
  where id = new.run_id;
END;

create trigger briar_hunt_events_decrement_run_event_count
after delete on briar_hunt_events BEGIN
  update briar_hunt_runs
  set event_count = max(event_count - 1, 0)
  where id = old.run_id;
END;
