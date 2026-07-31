alter table briar_execution_worker_devices add column icon_type text
  check (icon_type is null or icon_type in ('emoji', 'image'));

alter table briar_execution_worker_devices add column icon_value text
  check (icon_value is null or length(icon_value) <= 400000);
