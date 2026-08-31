export type SlackInstallationRow = {
  team_id: string;
  team_name: string;
  organization_id: string;
  default_project_id: string | null;
  default_project_name: string | null;
  bot_user_id: string;
  encrypted_bot_token: string;
  token_iv: string;
  installed_by_user_id: string;
  created_at: string;
  updated_at: string;
};

export type SlackRevocationQueueRow = {
  id: string;
  team_id: string;
  encrypted_bot_token: string;
  token_iv: string;
  queued_at: string;
  next_attempt_at: string;
  attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
  dead_lettered_at: string | null;
  dead_letter_reason: string | null;
};

export type SlackOAuthStateRow = {
  state_hash: string;
  organization_id: string;
  default_project_id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
};

export async function listSlackRevocationQueue(
  db: D1Database,
  observedAt: string,
  limit = 100,
) {
  const result = await db
    .prepare(
      `select id, team_id, encrypted_bot_token, token_iv, queued_at,
              next_attempt_at, attempts, last_attempt_at, last_error,
              dead_lettered_at, dead_letter_reason
       from briar_slack_revocation_queue
       where dead_lettered_at is null and next_attempt_at <= ?
       order by next_attempt_at, queued_at, id
       limit ?`,
    )
    .bind(observedAt, Math.max(1, Math.min(limit, 1_000)))
    .all<SlackRevocationQueueRow>();
  return result.results ?? [];
}

export async function completeSlackRevocation(
  db: D1Database,
  id: string,
) {
  await db
    .prepare(`delete from briar_slack_revocation_queue where id = ?`)
    .bind(id)
    .run();
}

export async function failSlackRevocation(
  db: D1Database,
  id: string,
  observedAt: string,
  nextAttemptAt: string,
  error: string,
) {
  const result = await db
    .prepare(
      `update briar_slack_revocation_queue
       set attempts = attempts + 1, last_attempt_at = ?,
           next_attempt_at = ?, last_error = ?
       where id = ? and dead_lettered_at is null`,
    )
    .bind(observedAt, nextAttemptAt, error.slice(0, 1_000), id)
    .run();
  return result.meta.changes > 0;
}

export async function deadLetterSlackRevocation(
  db: D1Database,
  id: string,
  observedAt: string,
  error: string,
) {
  const reason = error.slice(0, 1_000);
  const result = await db
    .prepare(
      `update briar_slack_revocation_queue
       set attempts = attempts + 1, last_attempt_at = ?, last_error = ?,
           dead_lettered_at = ?, dead_letter_reason = ?
       where id = ? and dead_lettered_at is null`,
    )
    .bind(observedAt, reason, observedAt, reason, id)
    .run();
  return result.meta.changes > 0;
}

export async function createSlackOAuthState(
  db: D1Database,
  input: {
    stateHash: string;
    organizationId: string;
    defaultProjectId: string;
    userId: string;
    expiresAt: string;
    createdAt: string;
  },
) {
  await db.batch([
    db
      .prepare(`delete from briar_slack_oauth_states where expires_at <= ?`)
      .bind(input.createdAt),
    db
      .prepare(
        `insert into briar_slack_oauth_states (
           state_hash, organization_id, default_project_id, user_id,
           expires_at, created_at
         ) values (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.stateHash,
        input.organizationId,
        input.defaultProjectId,
        input.userId,
        input.expiresAt,
        input.createdAt,
      ),
  ]);
}

export async function consumeSlackOAuthState(
  db: D1Database,
  stateHash: string,
  now: string,
) {
  const state = await db
    .prepare(
      `select state_hash, organization_id, default_project_id, user_id,
              expires_at, created_at
       from briar_slack_oauth_states
       where state_hash = ? and expires_at > ?`,
    )
    .bind(stateHash, now)
    .first<SlackOAuthStateRow>();
  if (!state) return null;
  const deleted = await db
    .prepare(`delete from briar_slack_oauth_states where state_hash = ?`)
    .bind(stateHash)
    .run();
  return deleted.meta.changes > 0 ? state : null;
}

export async function upsertSlackInstallation(
  db: D1Database,
  input: {
    teamId: string;
    teamName: string;
    organizationId: string;
    defaultProjectId: string;
    botUserId: string;
    encryptedBotToken: string;
    tokenIv: string;
    installedByUserId: string;
    observedAt: string;
  },
) {
  await db
    .prepare(
      `insert into briar_slack_installations (
         team_id, team_name, organization_id, default_project_id, bot_user_id,
         encrypted_bot_token, token_iv, installed_by_user_id,
         created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(team_id) do update set
         team_name = excluded.team_name,
         organization_id = excluded.organization_id,
         default_project_id = excluded.default_project_id,
         bot_user_id = excluded.bot_user_id,
         encrypted_bot_token = excluded.encrypted_bot_token,
         token_iv = excluded.token_iv,
         installed_by_user_id = excluded.installed_by_user_id,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.teamId,
      input.teamName,
      input.organizationId,
      input.defaultProjectId,
      input.botUserId,
      input.encryptedBotToken,
      input.tokenIv,
      input.installedByUserId,
      input.observedAt,
      input.observedAt,
    )
    .run();
}

const slackInstallationSelect = `
  select installation.team_id, installation.team_name,
         installation.organization_id, installation.default_project_id,
         project.name as default_project_name, installation.bot_user_id,
         installation.encrypted_bot_token, installation.token_iv,
         installation.installed_by_user_id, installation.created_at,
         installation.updated_at
  from briar_slack_installations installation
  left join briar_teams project on project.id = installation.default_project_id
`;

export async function getSlackInstallation(
  db: D1Database,
  teamId: string,
) {
  return db
    .prepare(`${slackInstallationSelect} where installation.team_id = ?`)
    .bind(teamId)
    .first<SlackInstallationRow>();
}

export async function listSlackInstallations(
  db: D1Database,
  organizationId: string,
) {
  const result = await db
    .prepare(
      `${slackInstallationSelect}
       where installation.organization_id = ?
       order by installation.created_at`,
    )
    .bind(organizationId)
    .all<SlackInstallationRow>();
  return result.results;
}

export async function updateSlackInstallationProject(
  db: D1Database,
  organizationId: string,
  teamId: string,
  projectId: string,
) {
  const result = await db
    .prepare(
      `update briar_slack_installations
       set default_project_id = ?, updated_at = ?
       where organization_id = ? and team_id = ?
         and exists (
           select 1 from briar_teams
           where id = ? and organization_id = ?
         )`,
    )
    .bind(
      projectId,
      new Date().toISOString(),
      organizationId,
      teamId,
      projectId,
      organizationId,
    )
    .run();
  return result.meta.changes > 0;
}

export async function deleteSlackInstallation(
  db: D1Database,
  input: {
    organizationId: string;
    teamId: string;
    actorUserId: string;
    observedAt: string;
  },
) {
  const queueId = Array.from(
    crypto.getRandomValues(new Uint8Array(32)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_slack_revocation_queue (
           id, team_id, encrypted_bot_token, token_iv, queued_at,
           next_attempt_at
         )
         select ?, installation.team_id, installation.encrypted_bot_token,
                installation.token_iv, ?, ?
         from briar_slack_installations installation
         where installation.organization_id = ?
           and installation.team_id = ?
           and exists (
             select 1 from briar_organization_members membership
             where membership.organization_id = installation.organization_id
               and membership.user_id = ?
               and membership.role in ('owner', 'co-owner')
           )`,
      )
      .bind(
        queueId,
        input.observedAt,
        input.observedAt,
        input.organizationId,
        input.teamId,
        input.actorUserId,
      ),
    db
      .prepare(
        `delete from briar_slack_installations
         where organization_id = ? and team_id = ?
           and exists (
             select 1 from briar_slack_revocation_queue queue
             where queue.id = ? and queue.team_id = briar_slack_installations.team_id
           )`,
      )
      .bind(input.organizationId, input.teamId, queueId),
    db
      .prepare(
        `select 1 as present from briar_slack_installations
         where organization_id = ? and team_id = ?`,
      )
      .bind(input.organizationId, input.teamId),
  ]);
  if ((results[1]?.meta.changes ?? 0) > 0) return "deleted" as const;
  return (results[2]?.results?.length ?? 0) > 0
    ? ("forbidden" as const)
    : ("not_found" as const);
}

export async function claimSlackEvent(
  db: D1Database,
  teamId: string,
  eventId: string,
  claimedAt: string,
  staleBefore: string,
) {
  const retentionBefore = new Date(
    Date.parse(claimedAt) - 30 * 24 * 60 * 60_000,
  ).toISOString();
  await db
    .prepare(
      `delete from briar_slack_events
       where coalesce(completed_at, claimed_at) < ?`,
    )
    .bind(retentionBefore)
    .run();
  const result = await db
    .prepare(
      `insert into briar_slack_events (
         team_id, event_id, status, claimed_at, completed_at
       ) values (?, ?, 'processing', ?, null)
       on conflict(team_id, event_id) do update set
         status = 'processing', claimed_at = excluded.claimed_at,
         completed_at = null
       where briar_slack_events.status = 'processing'
         and briar_slack_events.claimed_at < ?`,
    )
    .bind(teamId, eventId, claimedAt, staleBefore)
    .run();
  return result.meta.changes > 0;
}

export async function completeSlackEvent(
  db: D1Database,
  teamId: string,
  eventId: string,
  completedAt: string,
) {
  await db
    .prepare(
      `update briar_slack_events
       set status = 'completed', completed_at = ?
       where team_id = ? and event_id = ?`,
    )
    .bind(completedAt, teamId, eventId)
    .run();
}

export async function releaseSlackEvent(
  db: D1Database,
  teamId: string,
  eventId: string,
) {
  await db
    .prepare(
      `delete from briar_slack_events
       where team_id = ? and event_id = ? and status = 'processing'`,
    )
    .bind(teamId, eventId)
    .run();
}
