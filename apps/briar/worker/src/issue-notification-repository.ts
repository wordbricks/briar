import { type IssueMessageRow } from "./issue-message-repository";
import { type ProjectAgentProvider } from "./project-agent-model";

export type IssueConversationNotificationRow = IssueMessageRow & {
  run_title: string;
  root_message_id: string;
  notification_reason: "mention" | "thread_reply" | "subscription";
};

export type IssueSubscriptionRow = {
  run_id: string;
  organization_id: string;
  user_id: string;
  created_at: string;
};

export type ChannelConversationNotificationRow = {
  id: string;
  channel_id: string;
  channel_name: string;
  parent_message_id: string | null;
  author_user_id: string | null;
  author_agent_id: string | null;
  author_agent_provider: ProjectAgentProvider | null;
  author_name: string | null;
  author_image: string | null;
  author_agent_image: string | null;
  body: string;
  created_at: string;
  root_message_id: string;
  notification_reason: "mention" | "thread_reply" | "subscription";
};

export async function listIssueConversationNotifications(
  db: D1Database,
  projectId: string,
  userId: string,
) {
  const result = await db
    .prepare(
      `select message.id, message.run_id, message.parent_message_id,
              message.author_user_id, message.author_agent_id,
              message.author_agent_name, message.author_agent_provider,
              coalesce(author.name, message.author_agent_name) as author_name,
              author.image as author_image,
              agent.avatar as author_agent_image,
              message.body, 0 as reply_count, message.created_at,
              message.updated_at, run.title as run_title,
              coalesce(message.parent_message_id, message.id) as root_message_id,
              case
                when mention.user_id is not null then 'mention'
                when message.parent_message_id is not null
                 and root.author_user_id = ? then 'thread_reply'
                else 'subscription'
              end as notification_reason
       from briar_issue_messages message
       join briar_hunt_runs run
         on run.id = message.run_id and run.project_id = message.project_id
       join briar_issue_subscriptions subscription
         on subscription.run_id = run.id and subscription.user_id = ?
       left join "user" author on author.id = message.author_user_id
       left join briar_issue_agent_reply_jobs reply_job
         on reply_job.reply_message_id = message.id
        and reply_job.project_id = message.project_id
        and reply_job.run_id = message.run_id
       left join briar_agent_skills reply_skill
         on reply_skill.id = reply_job.skill_id
       left join briar_project_agents agent
         on agent.id = coalesce(
           reply_job.agent_id, reply_skill.agent_id, run.agent_id
         )
        and agent.project_id = run.project_id
       left join briar_issue_messages root
         on root.id = message.parent_message_id
        and root.project_id = message.project_id
        and root.run_id = message.run_id
       left join briar_issue_message_mentions mention
         on mention.message_id = message.id and mention.user_id = ?
       where message.project_id = ?
         and julianday(message.created_at) >= julianday(subscription.created_at)
         and (message.author_user_id is null or message.author_user_id != ?)
       order by message.created_at desc, message.id desc
       limit 500`,
    )
    .bind(userId, userId, userId, projectId, userId)
    .all<IssueConversationNotificationRow>();
  return result.results;
}

export async function listIssueSubscriptions(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const result = await db
    .prepare(
      `select subscription.run_id, subscription.organization_id,
              subscription.user_id, subscription.created_at
       from briar_issue_subscriptions subscription
       join briar_hunt_runs run on run.id = subscription.run_id
       where run.project_id = ? and run.id = ?
       order by subscription.created_at, subscription.user_id`,
    )
    .bind(projectId, runId)
    .all<IssueSubscriptionRow>();
  return result.results;
}

export async function listOrganizationIssueSubscriptionRunIds(
  db: D1Database,
  organizationId: string,
  userId: string,
) {
  const result = await db
    .prepare(
      `select subscription.run_id
       from briar_issue_subscriptions subscription
       join briar_hunt_runs run on run.id = subscription.run_id
       join briar_projects project on project.id = run.project_id
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = subscription.user_id
       left join briar_project_members project_membership
         on project_membership.project_id = project.id
        and project_membership.organization_id = project.organization_id
        and project_membership.user_id = membership.user_id
       where subscription.organization_id = ? and subscription.user_id = ?
         and (
           membership.role in ('owner', 'co-owner')
           or project_membership.user_id is not null
         )
       order by subscription.created_at, subscription.run_id`,
    )
    .bind(organizationId, userId)
    .all<{ run_id: string }>();
  return result.results.map((row) => row.run_id);
}

export async function subscribeIssue(
  db: D1Database,
  projectId: string,
  runId: string,
  userId: string,
  createdAt: string,
) {
  return db
    .prepare(
      `insert into briar_issue_subscriptions (
         run_id, organization_id, user_id, created_at
       )
       select run.id, project.organization_id, ?, ?
       from briar_hunt_runs run
       join briar_projects project on project.id = run.project_id
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = ?
       left join briar_project_members project_membership
         on project_membership.project_id = project.id
        and project_membership.organization_id = project.organization_id
        and project_membership.user_id = membership.user_id
       where run.id = ? and run.project_id = ?
         and (
           membership.role in ('owner', 'co-owner')
           or project_membership.user_id is not null
         )
       on conflict (run_id, user_id) do nothing
       returning run_id`,
    )
    .bind(userId, createdAt, userId, runId, projectId)
    .first<{ run_id: string }>();
}

export async function unsubscribeIssue(
  db: D1Database,
  projectId: string,
  runId: string,
  userId: string,
) {
  return db
    .prepare(
      `delete from briar_issue_subscriptions
       where run_id = ? and user_id = ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = briar_issue_subscriptions.run_id
             and run.project_id = ?
         )
       returning run_id`,
    )
    .bind(runId, userId, projectId)
    .first<{ run_id: string }>();
}

/**
 * Returns channel messages that require this organization member's attention:
 * direct mentions and replies to root messages they authored. Public channels
 * are organization-visible; private channels require explicit membership.
 */
export async function listChannelConversationNotifications(
  db: D1Database,
  organizationId: string,
  userId: string,
) {
  const result = await db
    .prepare(
      `select message.id, message.channel_id, channel.name as channel_name,
              message.parent_message_id, message.author_user_id,
              message.author_agent_id, message.author_agent_provider,
              coalesce(author.name, message.author_agent_name, '') as author_name,
              author.image as author_image,
              agent.avatar as author_agent_image,
              message.body, message.created_at,
              coalesce(message.parent_message_id, message.id) as root_message_id,
              notification.notification_reason
       from briar_channel_notification_inbox notification
       join briar_channel_messages message on message.id = notification.message_id
       join briar_channels channel on channel.id = message.channel_id
       left join "user" author on author.id = message.author_user_id
       left join briar_project_agents agent
         on agent.id = message.author_agent_id
       where notification.user_id = ?
         and notification.organization_id = ?
         and channel.organization_id = notification.organization_id
         and channel.archived_at is null
         and (
           channel.visibility = 'public'
           or exists (
             select 1 from briar_channel_members member
             where member.channel_id = channel.id and member.user_id = ?
           )
         )
       order by notification.created_at desc, notification.message_id desc
       limit 500`,
    )
    .bind(userId, organizationId, userId)
    .all<ChannelConversationNotificationRow>();
  return result.results;
}
