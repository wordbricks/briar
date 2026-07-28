alter table briar_organizations
  add column logo text
  check (
    logo is null
    or (
      length(logo) <= 400000
      and substr(logo, 1, 23) = 'data:image/webp;base64,'
    )
  );
