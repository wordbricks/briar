-- Allow each saved Agent to pin a model effort alongside its provider/model.
alter table briar_project_agents add column effort text check (
  effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
);
