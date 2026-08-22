alter table briar_project_agents
  add column avatar text
  check (
    avatar is null
    or (
      length(avatar) <= 400000
      and (
        substr(avatar, 1, 22) = 'data:image/png;base64,'
        or substr(avatar, 1, 23) = 'data:image/jpeg;base64,'
        or substr(avatar, 1, 23) = 'data:image/webp;base64,'
      )
    )
  );
