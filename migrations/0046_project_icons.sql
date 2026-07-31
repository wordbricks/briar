alter table briar_projects
  add column icon_data_url text
  check (
    icon_data_url is null
    or (
      length(icon_data_url) <= 400000
      and substr(icon_data_url, 1, 23) = 'data:image/webp;base64,'
    )
  );
