alter table briar_teams
  add column icon_name text
  check (
    icon_name is null
    or (
      length(icon_name) between 1 and 40
      and icon_name not glob '*[^a-z0-9-]*'
    )
  );

alter table briar_teams
  add column icon_color text
  check (
    icon_color is null
    or (
      length(icon_color) = 7
      and substr(icon_color, 1, 1) = '#'
      and substr(icon_color, 2) not glob '*[^0-9a-f]*'
    )
  );
