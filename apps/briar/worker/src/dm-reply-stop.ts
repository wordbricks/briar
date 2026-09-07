import { mentionHandle } from "../../src/lib/channel-mentions";

/** Only whole commands qualify. Quoted, conditional, and descriptive text does not. */
export function isDmReplyStop(body: string, mentionedAgentNames: readonly string[]) {
  let command = body.trim().toLocaleLowerCase();
  for (const name of mentionedAgentNames) {
    const token = `@${mentionHandle(name)}`;
    if (command.startsWith(`${token} `)) command = command.slice(token.length).trim();
  }
  return /^(?:그만해(?:요)?|그만해\s*주세요|중단해(?:요)?|중단해\s*주세요|여기까지\s*해(?:요)?|여기까지\s*해\s*주세요|stop|please\s+stop|stop\s+please)[.!！。]*$/u.test(command);
}

export type DmReplyStop = {
  organizationId: string;
  channelId: string;
  userId: string;
  rootMessageId: string;
  requestMessageId: string;
  mentionedAgentIds: readonly string[];
  createdAt: string;
};

/** Runs in the message/receipt transaction: retries cannot select newer work. */
export function dmReplyStopStatements(db: D1Database, input: DmReplyStop) {
  const marker = `dm_reply_stopped:${input.requestMessageId}`;
  const mentioned = JSON.stringify([...new Set(input.mentionedAgentIds)]);
  const authorized = `exists (
    select 1 from briar_channels channel
    join briar_channel_members member on member.channel_id = channel.id
    join briar_organization_members organization_member
      on organization_member.organization_id = channel.organization_id
     and organization_member.user_id = member.user_id
    join briar_channel_messages root on root.channel_id = channel.id
    join briar_channel_messages request on request.channel_id = channel.id
    where channel.id = ? and channel.organization_id = ? and channel.kind = 'dm'
      and channel.archived_at is null and member.user_id = ?
      and root.id = ? and root.parent_message_id is null and root.deleted_at is null
      and request.id = ? and request.parent_message_id = root.id
      and request.author_user_id = member.user_id
  )`;
  const authorization = [input.channelId, input.organizationId, input.userId,
    input.rootMessageId, input.requestMessageId];
  return [
    db.prepare(`update briar_channel_agent_reply_jobs
      set status = 'completed', error = ?, completed_at = ?, updated_at = ?,
          claim_token_hash = null, lease_expires_at = null
      where organization_id = ? and channel_id = ? and trigger_message_id = ?
        and status in ('queued', 'running')
        and superseded_by_reply_job_id is null
        and exists (select 1 from briar_channel_agents roster
          where roster.channel_id = briar_channel_agent_reply_jobs.channel_id
            and roster.agent_id = briar_channel_agent_reply_jobs.agent_id)
        and (
          (json_array_length(?) = 1 and agent_id in (select value from json_each(?)))
          or (json_array_length(?) = 0 and (
            select count(distinct original.agent_id)
            from briar_channel_agent_reply_jobs original
            where original.organization_id = ? and original.channel_id = ?
              and original.trigger_message_id = ?
          ) = 1)
        ) and ${authorized}`)
      .bind(marker, input.createdAt, input.createdAt, input.organizationId,
        input.channelId, input.rootMessageId, mentioned, mentioned, mentioned,
        input.organizationId, input.channelId, input.rootMessageId, ...authorization),
    // Drop only the interrupted provider conversation. Queued jobs keep their
    // session/Worker affinity and start a clean provider turn after the abort.
    db.prepare(`update briar_channel_reply_sessions
      set conversation_id = null, updated_at = ?
      where id in (select session_id from briar_channel_agent_reply_jobs
        where channel_id = ? and error = ? and status = 'completed')
        and not exists (select 1 from briar_channel_agent_reply_jobs active
          where active.session_id = briar_channel_reply_sessions.id
            and active.status = 'running')`)
      .bind(input.createdAt, input.channelId, marker),
    db.prepare(`insert into briar_channel_messages (
        id, channel_id, parent_message_id, author_agent_name, body, created_at, updated_at
      ) select ?, ?, ?, 'Briar', case
        when exists (select 1 from briar_channel_agent_reply_jobs
          where channel_id = ? and error = ?)
          then '요청한 Agent 작업을 중단했습니다.'
        when json_array_length(?) > 1 or (json_array_length(?) = 0 and (
          select count(distinct agent_id) from briar_channel_agent_reply_jobs
          where channel_id = ? and trigger_message_id = ?
        ) > 1) then '중단할 Agent 한 명을 @멘션해 답장해 주세요. 작업은 중단하지 않았습니다.'
        else '이 메시지에 연결된 중단 가능한 작업이 없습니다.' end, ?, ?
      where ${authorized}`)
      .bind(crypto.randomUUID(), input.channelId, input.rootMessageId,
        input.channelId, marker, mentioned, mentioned, input.channelId,
        input.rootMessageId, input.createdAt, input.createdAt, ...authorization),
  ];
}
