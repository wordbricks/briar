alter table briar_execution_worker_devices
  add column max_concurrent_sessions integer not null default 1
  check (max_concurrent_sessions between 1 and 16);
