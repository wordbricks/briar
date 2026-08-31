import { type ProjectAgentProvider } from "./project-agent-model";

export type IssueMessageRow = {
  id: string;
  run_id: string;
  parent_message_id: string | null;
  author_user_id: string | null;
  author_agent_id: string | null;
  author_agent_name: string | null;
  author_agent_provider: ProjectAgentProvider | null;
  author_name: string | null;
  author_image: string | null;
  author_agent_image: string | null;
  body: string;
  reply_count: number;
  created_at: string;
  updated_at: string;
};

const issueMessageSelection = `
  message.id, message.run_id, message.parent_message_id,
  message.author_user_id, message.author_agent_id,
  message.author_agent_name, message.author_agent_provider,
  coalesce(author.name, message.author_agent_name) as author_name,
  author.image as author_image, agent.avatar as author_agent_image,
  message.body,
  (select count(*) from briar_issue_messages reply
   where reply.parent_message_id = message.id) as reply_count,
  message.created_at, message.updated_at`;

const issueMessageAuthorJoins = `
  left join "user" author on author.id = message.author_user_id
  left join briar_project_agents agent
    on agent.id = message.author_agent_id
   and agent.project_id = message.project_id`;

export async function listIssueMessages(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const result = await db
    .prepare(
      `select ${issueMessageSelection}
       from briar_issue_messages message
       join briar_hunt_runs run
         on run.id = message.run_id and run.project_id = message.project_id
       ${issueMessageAuthorJoins}
       where message.project_id = ? and message.run_id = ?
       order by message.created_at, message.id
       limit 1000`,
    )
    .bind(projectId, runId)
    .all<IssueMessageRow>();
  return result.results;
}

export async function listIssueThreadMessages(
  db: D1Database,
  projectId: string,
  runId: string,
  messageId: string,
) {
  const result = await db
    .prepare(
      `select ${issueMessageSelection}
       from briar_issue_messages message
       join briar_hunt_runs run
         on run.id = message.run_id and run.project_id = message.project_id
       ${issueMessageAuthorJoins}
       where message.project_id = ? and message.run_id = ?
         and message.id in (
           with recursive thread_path(id, parent_message_id) as (
             select message.id, message.parent_message_id
             from briar_issue_messages message
             where message.project_id = ? and message.run_id = ?
               and message.id = ?
             union all
             select parent.id, parent.parent_message_id
             from briar_issue_messages parent
             join thread_path path on parent.id = path.parent_message_id
           ),
           thread_messages(id) as (
             select id from thread_path where parent_message_id is null
             union all
             select message.id
             from briar_issue_messages message
             join thread_messages thread on message.parent_message_id = thread.id
             where message.project_id = ? and message.run_id = ?
           )
           select id from thread_messages
         )
       order by message.created_at, message.id`,
    )
    .bind(projectId, runId, projectId, runId, messageId, projectId, runId)
    .all<IssueMessageRow>();
  return result.results;
}

export async function createIssueMessage(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    runId: string;
    parentMessageId: string | null;
    authorUserId: string | null;
    authorAgentId?: string | null;
    authorAgentName?: string | null;
    authorAgentProvider: ProjectAgentProvider | null;
    body: string;
    mentionedUserIds?: string[];
    createdAt: string;
  },
) {
  const parentMessageId = input.parentMessageId?.toLowerCase() ?? null;
  const result = await db
    .prepare(
      `insert into briar_issue_messages (
         id, project_id, run_id, parent_message_id, author_user_id,
         author_agent_id, author_agent_name, author_agent_provider,
         body, created_at, updated_at
       )
       select ?, run.project_id, run.id, parent.id, ?, ?, ?, ?, ?, ?, ?
       from briar_hunt_runs run
       left join briar_issue_messages parent
         on parent.id = ?
        and parent.project_id = run.project_id
        and parent.run_id = run.id
       where run.id = ? and run.project_id = ?
         and (? is null or parent.id is not null)`,
    )
    .bind(
      input.id,
      input.authorUserId,
      input.authorAgentId ?? null,
      input.authorAgentName ?? null,
      input.authorAgentProvider,
      input.body,
      input.createdAt,
      input.createdAt,
      parentMessageId,
      input.runId,
      input.projectId,
      parentMessageId,
    )
    .run();
  if (result.meta.changes < 1) return null;
  const mentionedUserIds = [...new Set(input.mentionedUserIds ?? [])];
  if (mentionedUserIds.length > 0) {
    await db.batch(
      mentionedUserIds.map((userId) =>
        db
          .prepare(
            `insert into briar_issue_message_mentions (
               message_id, user_id, created_at
             )
             select message.id, membership.user_id, ?
             from briar_issue_messages message
             join briar_projects project on project.id = message.project_id
             join briar_organization_members membership
               on membership.organization_id = project.organization_id
              and membership.user_id = ?
             where message.id = ?
               and (message.author_user_id is null
                 or message.author_user_id != membership.user_id)
             on conflict (message_id, user_id) do nothing`,
          )
          .bind(input.createdAt, userId, input.id),
      ),
    );
  }
  const messages = await listIssueMessages(db, input.projectId, input.runId);
  return messages.find((message) => message.id === input.id) ?? null;
}

export async function getIssueMessage(
  db: D1Database,
  projectId: string,
  runId: string,
  messageId: string,
) {
  return await db
    .prepare(
      `select ${issueMessageSelection}
       from briar_issue_messages message
       ${issueMessageAuthorJoins}
       where message.project_id = ? and message.run_id = ? and message.id = ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = message.run_id
             and run.project_id = message.project_id
         )`,
    )
    .bind(projectId, runId, messageId)
    .first<IssueMessageRow>();
}

export async function updateIssueMessage(
  db: D1Database,
  projectId: string,
  runId: string,
  messageId: string,
  input: {
    body: string;
    mentionedUserIds?: string[];
    updatedAt: string;
  },
) {
  const updated = await db
    .prepare(
      `update briar_issue_messages
       set body = ?, updated_at = ?
       where project_id = ? and run_id = ? and id = ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = briar_issue_messages.run_id
             and run.project_id = briar_issue_messages.project_id
         )`,
    )
    .bind(input.body, input.updatedAt, projectId, runId, messageId)
    .run();
  if (updated.meta.changes < 1) return null;
  const mentionedUserIds = [...new Set(input.mentionedUserIds ?? [])];
  await db.batch([
    db
      .prepare(`delete from briar_issue_message_mentions where message_id = ?`)
      .bind(messageId),
    ...mentionedUserIds.map((userId) =>
      db
        .prepare(
          `insert into briar_issue_message_mentions (
             message_id, user_id, created_at
           )
           select message.id, membership.user_id, ?
           from briar_issue_messages message
           join briar_projects project on project.id = message.project_id
           join briar_organization_members membership
             on membership.organization_id = project.organization_id
            and membership.user_id = ?
           where message.id = ?
             and (message.author_user_id is null
               or message.author_user_id != membership.user_id)
           on conflict (message_id, user_id) do nothing`,
        )
        .bind(input.updatedAt, userId, messageId),
    ),
  ]);
  const messages = await listIssueMessages(db, projectId, runId);
  return messages.find((message) => message.id === messageId) ?? null;
}

export async function deleteIssueMessage(
  db: D1Database,
  projectId: string,
  runId: string,
  messageId: string,
) {
  const result = await db
    .prepare(
      `with recursive descendants(id) as (
         select message.id
         from briar_issue_messages message
         where message.project_id = ? and message.run_id = ? and message.id = ?
         union all
         select reply.id
         from briar_issue_messages reply
         join descendants parent on reply.parent_message_id = parent.id
         where reply.project_id = ? and reply.run_id = ?
       )
       delete from briar_issue_messages
       where id in (select id from descendants)
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = briar_issue_messages.run_id
             and run.project_id = briar_issue_messages.project_id
         )`,
    )
    .bind(projectId, runId, messageId, projectId, runId)
    .run();
  return result.meta.changes > 0;
}
