alter table briar_project_agents
  add column avatar_pet_json text
  check (
    avatar_pet_json is null
    or (
      length(avatar_pet_json) <= 4000
      and json_valid(avatar_pet_json)
    )
  );

alter table briar_project_agents
  add column avatar_spritesheet_object_key text
  check (
    avatar_spritesheet_object_key is null
    or (
      length(avatar_spritesheet_object_key) <= 1000
      and avatar_spritesheet_object_key like 'project-agent-spritesheets/%'
    )
  );
