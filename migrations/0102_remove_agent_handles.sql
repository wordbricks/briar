-- Agent names are now the text shown for channel mentions. Routing continues
-- to use the structured mentioned_agent_ids stored with each message, so the
-- separate organization-unique mention handle is no longer needed.
--
-- Worker deploys apply D1 migrations before publishing the new Worker. Keep
-- the nullable column for compatibility with the previously deployed Worker
-- during that window, but remove its data and uniqueness contract. The new
-- Worker neither selects nor writes this legacy column.
drop index briar_project_agents_handle_idx;

update briar_project_agents set handle = null where handle is not null;
