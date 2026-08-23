alter table briar_organizations
  add column logo_data_url text
  check (
    logo_data_url is null
    or (
      length(logo_data_url) <= 400000
      and (
        substr(logo_data_url, 1, 22) = 'data:image/png;base64,'
        or substr(logo_data_url, 1, 23) = 'data:image/jpeg;base64,'
        or substr(logo_data_url, 1, 23) = 'data:image/webp;base64,'
      )
    )
  );

update briar_organizations
set logo_data_url = logo
where logo is not null;
