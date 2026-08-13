pragma foreign_keys = on;

-- People become subscribers when they create an issue, join its conversation,
-- or are mentioned. The membership joins keep subscriptions scoped to the
-- issue's organization, matching manual and assignee subscriptions.
create trigger briar_issue_subscriptions_creator_insert
after insert on briar_hunt_runs
when new.created_by_user_id is not null BEGIN
  insert into briar_issue_subscriptions (
    run_id, organization_id, user_id, created_at
  )
  select new.id, project.organization_id, new.created_by_user_id, new.started_at
  from briar_projects project
  join briar_organization_members membership
    on membership.organization_id = project.organization_id
   and membership.user_id = new.created_by_user_id
  where project.id = new.project_id
  on conflict (run_id, user_id) do nothing;
END;

create trigger briar_issue_subscriptions_message_author_insert
after insert on briar_issue_messages
when new.author_user_id is not null BEGIN
  insert into briar_issue_subscriptions (
    run_id, organization_id, user_id, created_at
  )
  select new.run_id, project.organization_id, new.author_user_id, new.created_at
  from briar_hunt_runs run
  join briar_projects project on project.id = run.project_id
  join briar_organization_members membership
    on membership.organization_id = project.organization_id
   and membership.user_id = new.author_user_id
  where run.id = new.run_id and run.project_id = new.project_id
  on conflict (run_id, user_id) do nothing;
END;

create trigger briar_issue_subscriptions_mention_insert
after insert on briar_issue_message_mentions BEGIN
  insert into briar_issue_subscriptions (
    run_id, organization_id, user_id, created_at
  )
  select message.run_id, project.organization_id, new.user_id, new.created_at
  from briar_issue_messages message
  join briar_projects project on project.id = message.project_id
  join briar_organization_members membership
    on membership.organization_id = project.organization_id
   and membership.user_id = new.user_id
  where message.id = new.message_id
  on conflict (run_id, user_id) do nothing;
END;

-- Existing creators and conversation participants start receiving future
-- notifications after deployment without replaying historical conversation.
insert into briar_issue_subscriptions (
  run_id, organization_id, user_id, created_at
)
select run.id, project.organization_id, run.created_by_user_id,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
from briar_hunt_runs run
join briar_projects project on project.id = run.project_id
join briar_organization_members membership
  on membership.organization_id = project.organization_id
 and membership.user_id = run.created_by_user_id
where run.created_by_user_id is not null
on conflict (run_id, user_id) do nothing;

insert into briar_issue_subscriptions (
  run_id, organization_id, user_id, created_at
)
select distinct message.run_id, project.organization_id, message.author_user_id,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
from briar_issue_messages message
join briar_projects project on project.id = message.project_id
join briar_organization_members membership
  on membership.organization_id = project.organization_id
 and membership.user_id = message.author_user_id
where message.author_user_id is not null
on conflict (run_id, user_id) do nothing;

insert into briar_issue_subscriptions (
  run_id, organization_id, user_id, created_at
)
select distinct message.run_id, project.organization_id, mention.user_id,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
from briar_issue_message_mentions mention
join briar_issue_messages message on message.id = mention.message_id
join briar_projects project on project.id = message.project_id
join briar_organization_members membership
  on membership.organization_id = project.organization_id
 and membership.user_id = mention.user_id
on conflict (run_id, user_id) do nothing;
