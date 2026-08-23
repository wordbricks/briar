alter table briar_projects
  add column icon_data_url_browser text
  check (
    icon_data_url_browser is null
    or (
      length(icon_data_url_browser) <= 400000
      and (
        substr(icon_data_url_browser, 1, 22) = 'data:image/png;base64,'
        or substr(icon_data_url_browser, 1, 23) = 'data:image/jpeg;base64,'
        or substr(icon_data_url_browser, 1, 23) = 'data:image/webp;base64,'
      )
    )
  );

update briar_projects
set icon_data_url_browser = icon_data_url,
    icon_data_url = null
where icon_data_url is not null;
