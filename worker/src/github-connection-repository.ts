export type GithubConnectionStatus = "connected" | "disconnected";

export type GithubConnectionRow = {
  installation_id: number;
  organization_id: string;
  installation_account_id: number;
  account_login: string;
  account_avatar_url: string;
  authorized_github_user_id: number;
  authorized_github_user_login: string;
  connected_by_user_id: string | null;
  status: GithubConnectionStatus;
  connected_at: string;
  disconnected_at: string | null;
  updated_at: string;
};

export type GithubConnectionRepositoryRow = {
  installation_id: number;
  repository_id: number;
  owner: string;
  name: string;
  full_name: string;
  created_at: string;
  updated_at: string;
};

export type GithubOAuthStateRow = {
  state_hash: string;
  organization_id: string;
  user_id: string;
  pkce_verifier: string;
  installation_id: number | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export async function createGithubOAuthState(
  db: D1Database,
  input: {
    stateHash: string;
    organizationId: string;
    userId: string;
    pkceVerifier: string;
    installationId?: number | null;
    expiresAt: string;
    createdAt: string;
  },
) {
  await db.batch([
    db
      .prepare(`delete from briar_github_oauth_states where expires_at <= ?`)
      .bind(input.createdAt),
    db
      .prepare(
        `insert into briar_github_oauth_states (
           state_hash, organization_id, user_id, pkce_verifier,
           installation_id, expires_at, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.stateHash,
        input.organizationId,
        input.userId,
        input.pkceVerifier,
        input.installationId ?? null,
        input.expiresAt,
        input.createdAt,
        input.createdAt,
      ),
  ]);
}

export async function consumeGithubInstallState(
  db: D1Database,
  stateHash: string,
  now: string,
) {
  const state = await db
    .prepare(
      `select state_hash, organization_id, user_id, pkce_verifier,
              installation_id, expires_at, created_at, updated_at
       from briar_github_oauth_states
       where state_hash = ? and expires_at > ?
         and installation_id is null`,
    )
    .bind(stateHash, now)
    .first<GithubOAuthStateRow>();
  if (!state) return null;
  const deleted = await db
    .prepare(`delete from briar_github_oauth_states where state_hash = ?`)
    .bind(stateHash)
    .run();
  return (deleted.meta.changes ?? 0) > 0 ? state : null;
}

export async function consumeGithubOAuthState(
  db: D1Database,
  stateHash: string,
  now: string,
) {
  const state = await db
    .prepare(
      `select state_hash, organization_id, user_id, pkce_verifier,
              installation_id, expires_at, created_at, updated_at
       from briar_github_oauth_states
       where state_hash = ? and expires_at > ?
         and installation_id is not null`,
    )
    .bind(stateHash, now)
    .first<GithubOAuthStateRow>();
  if (!state) return null;
  const deleted = await db
    .prepare(`delete from briar_github_oauth_states where state_hash = ?`)
    .bind(stateHash)
    .run();
  return (deleted.meta.changes ?? 0) > 0 ? state : null;
}

export async function getGithubConnectionByInstallation(
  db: D1Database,
  installationId: number,
) {
  return db
    .prepare(
      `select installation_id, organization_id, installation_account_id,
              account_login, account_avatar_url, authorized_github_user_id,
              authorized_github_user_login, connected_by_user_id, status,
              connected_at, disconnected_at, updated_at
       from briar_github_connections
       where installation_id = ?`,
    )
    .bind(installationId)
    .first<GithubConnectionRow>();
}

export async function getGithubConnectionForOrganization(
  db: D1Database,
  organizationId: string,
) {
  return db
    .prepare(
      `select installation_id, organization_id, installation_account_id,
              account_login, account_avatar_url, authorized_github_user_id,
              authorized_github_user_login, connected_by_user_id, status,
              connected_at, disconnected_at, updated_at
       from briar_github_connections
       where organization_id = ? and status = 'connected'
       order by updated_at desc
       limit 1`,
    )
    .bind(organizationId)
    .first<GithubConnectionRow>();
}

export async function listGithubConnectionRepositories(
  db: D1Database,
  installationId: number,
) {
  const result = await db
    .prepare(
      `select installation_id, repository_id, owner, name, full_name,
              created_at, updated_at
       from briar_github_connection_repositories
       where installation_id = ?
       order by lower(full_name), repository_id`,
    )
    .bind(installationId)
    .all<GithubConnectionRepositoryRow>();
  return result.results;
}

export async function syncGithubConnectionRepositories(
  db: D1Database,
  input: {
    installationId: number;
    added: Array<{
      id: number;
      owner: string;
      name: string;
      fullName: string;
    }>;
    removedIds: number[];
    observedAt: string;
  },
) {
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_github_connection_repositories (
           installation_id, repository_id, owner, name, full_name,
           created_at, updated_at
         )
         select ?,
                cast(json_extract(repository.value, '$.id') as integer),
                json_extract(repository.value, '$.owner'),
                json_extract(repository.value, '$.name'),
                json_extract(repository.value, '$.fullName'),
                ?, ?
         from json_each(?) repository
         where exists (
           select 1 from briar_github_connections connection
           where connection.installation_id = ?
             and connection.status = 'connected'
         )
         on conflict(installation_id, repository_id) do update set
           owner = excluded.owner,
           name = excluded.name,
           full_name = excluded.full_name,
           updated_at = excluded.updated_at`,
      )
      .bind(
        input.installationId,
        input.observedAt,
        input.observedAt,
        JSON.stringify(input.added),
        input.installationId,
      ),
    db
      .prepare(
        `delete from briar_github_connection_repositories
         where installation_id = ? and repository_id in (
           select cast(value as integer) from json_each(?)
         ) and exists (
           select 1 from briar_github_connections connection
           where connection.installation_id = ?
             and connection.status = 'connected'
         )`,
      )
      .bind(
        input.installationId,
        JSON.stringify(input.removedIds),
        input.installationId,
      ),
    db
      .prepare(
        `update briar_github_connections set updated_at = ?
         where installation_id = ? and status = 'connected'`,
      )
      .bind(input.observedAt, input.installationId),
  ]);
  return (results[2]?.meta.changes ?? 0) > 0;
}

export async function connectGithubInstallation(
  db: D1Database,
  input: {
    organizationId: string;
    installationId: number;
    installationAccountId: number;
    accountLogin: string;
    accountAvatarUrl: string;
    authorizedGithubUserId: number;
    authorizedGithubUserLogin: string;
    connectedByUserId: string;
    repositories: Array<{
      id: number;
      owner: string;
      name: string;
      fullName: string;
    }>;
    observedAt: string;
  },
) {
  const statements = [
    db
      .prepare(
        `insert into briar_github_connections (
           installation_id, organization_id, installation_account_id,
           account_login, account_avatar_url, authorized_github_user_id,
           authorized_github_user_login, connected_by_user_id, status,
           connected_at, disconnected_at, updated_at
         )
         select ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, null, ?
         where not exists (
           select 1 from briar_github_connections active
           where active.organization_id = ? and active.status = 'connected'
             and active.installation_id <> ?
         )
         on conflict(installation_id) do update set
           organization_id = excluded.organization_id,
           installation_account_id = excluded.installation_account_id,
           account_login = excluded.account_login,
           account_avatar_url = excluded.account_avatar_url,
           authorized_github_user_id = excluded.authorized_github_user_id,
           authorized_github_user_login = excluded.authorized_github_user_login,
           connected_by_user_id = excluded.connected_by_user_id,
           status = 'connected',
           connected_at = excluded.connected_at,
           disconnected_at = null,
           updated_at = excluded.updated_at
         where briar_github_connections.status = 'disconnected'
            or briar_github_connections.organization_id = excluded.organization_id`,
      )
      .bind(
        input.installationId,
        input.organizationId,
        input.installationAccountId,
        input.accountLogin,
        input.accountAvatarUrl,
        input.authorizedGithubUserId,
        input.authorizedGithubUserLogin,
        input.connectedByUserId,
        input.observedAt,
        input.observedAt,
        input.organizationId,
        input.installationId,
      ),
    db
      .prepare(
        `delete from briar_github_connection_repositories
         where installation_id = ? and exists (
           select 1 from briar_github_connections connection
           where connection.installation_id = ?
             and connection.organization_id = ?
             and connection.status = 'connected'
             and connection.updated_at = ?
         )`,
      )
      .bind(
        input.installationId,
        input.installationId,
        input.organizationId,
        input.observedAt,
      ),
    db
      .prepare(
        `insert into briar_github_connection_repositories (
           installation_id, repository_id, owner, name, full_name,
           created_at, updated_at
         )
         select ?,
                cast(json_extract(repository.value, '$.id') as integer),
                json_extract(repository.value, '$.owner'),
                json_extract(repository.value, '$.name'),
                json_extract(repository.value, '$.fullName'),
                ?, ?
         from json_each(?) repository
         where exists (
           select 1 from briar_github_connections connection
           where connection.installation_id = ?
             and connection.organization_id = ?
             and connection.status = 'connected'
             and connection.updated_at = ?
         )`,
      )
      .bind(
        input.installationId,
        input.observedAt,
        input.observedAt,
        JSON.stringify(input.repositories),
        input.installationId,
        input.organizationId,
        input.observedAt,
      ),
  ];
  await db.batch(statements);
  const connection = await getGithubConnectionByInstallation(
    db,
    input.installationId,
  );
  if (
    connection?.status === "connected" &&
    connection.organization_id === input.organizationId
  ) {
    return { outcome: "connected" as const };
  }
  if (connection?.status === "connected") {
    return { outcome: "installation_conflict" as const };
  }
  const activeForOrganization = await getGithubConnectionForOrganization(
    db,
    input.organizationId,
  );
  if (
    activeForOrganization &&
    activeForOrganization.installation_id !== input.installationId
  ) {
    return { outcome: "organization_conflict" as const };
  }
  throw new Error("GitHub connection could not be persisted");
}

export async function disconnectGithubInstallation(
  db: D1Database,
  organizationId: string,
  observedAt: string,
) {
  const connection = await getGithubConnectionForOrganization(
    db,
    organizationId,
  );
  if (!connection) return false;
  const results = await db.batch([
    db
      .prepare(
        `update briar_github_connections
         set status = 'disconnected', disconnected_at = ?, updated_at = ?
         where organization_id = ? and installation_id = ?
           and status = 'connected'`,
      )
      .bind(
        observedAt,
        observedAt,
        organizationId,
        connection.installation_id,
      ),
    db
      .prepare(
        `delete from briar_github_connection_repositories
         where installation_id = ?`,
      )
      .bind(connection.installation_id),
    db
      .prepare(
        `delete from briar_github_pull_requests where installation_id = ?`,
      )
      .bind(connection.installation_id),
    db
      .prepare(
        `update briar_run_pull_requests
         set state = 'unknown', draft = null, head_sha = null,
             base_sha = null, merge_commit_sha = null, opened_at = null,
             closed_at = null, merged_at = null, provider_updated_at = null,
             last_delivery_id = null, updated_at = ?
         where installation_id = ?`,
      )
      .bind(observedAt, connection.installation_id),
  ]);
  return (results[0]?.meta.changes ?? 0) > 0;
}

export async function disconnectGithubInstallationById(
  db: D1Database,
  installationId: number,
  observedAt: string,
) {
  const results = await db.batch([
    db
      .prepare(
        `update briar_github_connections
         set status = 'disconnected', disconnected_at = ?, updated_at = ?
         where installation_id = ? and status = 'connected'`,
      )
      .bind(observedAt, observedAt, installationId),
    db
      .prepare(
        `delete from briar_github_connection_repositories
         where installation_id = ?`,
      )
      .bind(installationId),
    db
      .prepare(
        `delete from briar_github_pull_requests where installation_id = ?`,
      )
      .bind(installationId),
    db
      .prepare(
        `update briar_run_pull_requests
         set state = 'unknown', draft = null, head_sha = null,
             base_sha = null, merge_commit_sha = null, opened_at = null,
             closed_at = null, merged_at = null, provider_updated_at = null,
             last_delivery_id = null, updated_at = ?
         where installation_id = ?`,
      )
      .bind(observedAt, installationId),
  ]);
  return (results[0]?.meta.changes ?? 0) > 0;
}

export async function disconnectGithubInstallationsByAuthorizedUser(
  db: D1Database,
  githubUserId: number,
  observedAt: string,
) {
  const connected = await db
    .prepare(
      `select installation_id
       from briar_github_connections
       where authorized_github_user_id = ? and status = 'connected'`,
    )
    .bind(githubUserId)
    .all<{ installation_id: number }>();
  if (connected.results.length === 0) return 0;
  const installationIds = connected.results.map((row) => row.installation_id);
  const placeholders = installationIds.map(() => "?").join(", ");
  const results = await db.batch([
    db
      .prepare(
        `update briar_github_connections
         set status = 'disconnected', disconnected_at = ?, updated_at = ?
         where authorized_github_user_id = ? and status = 'connected'`,
      )
      .bind(observedAt, observedAt, githubUserId),
    db
      .prepare(
        `delete from briar_github_connection_repositories
         where installation_id in (${placeholders})`,
      )
      .bind(...installationIds),
    db
      .prepare(
        `delete from briar_github_pull_requests
         where installation_id in (${placeholders})`,
      )
      .bind(...installationIds),
    db
      .prepare(
        `update briar_run_pull_requests
         set state = 'unknown', draft = null, head_sha = null,
             base_sha = null, merge_commit_sha = null, opened_at = null,
             closed_at = null, merged_at = null, provider_updated_at = null,
             last_delivery_id = null, updated_at = ?
         where installation_id in (${placeholders})`,
      )
      .bind(observedAt, ...installationIds),
  ]);
  return results[0]?.meta.changes ?? 0;
}

export async function claimGithubDelivery(
  db: D1Database,
  input: {
    deliveryId: string;
    eventName: string;
    action: string | null;
    claimedAt: string;
    staleBefore: string;
  },
) {
  const retentionBefore = new Date(
    Date.parse(input.claimedAt) - 30 * 24 * 60 * 60_000,
  ).toISOString();
  await db
    .prepare(
      `delete from briar_github_deliveries
       where coalesce(completed_at, claimed_at) < ?`,
    )
    .bind(retentionBefore)
    .run();
  const result = await db
    .prepare(
      `insert into briar_github_deliveries (
         delivery_id, event_name, action, status, claimed_at, completed_at
       ) values (?, ?, ?, 'processing', ?, null)
       on conflict(delivery_id) do update set
         event_name = excluded.event_name,
         action = excluded.action,
         status = 'processing',
         claimed_at = excluded.claimed_at,
         completed_at = null
       where briar_github_deliveries.status = 'processing'
         and briar_github_deliveries.claimed_at < ?`,
    )
    .bind(
      input.deliveryId,
      input.eventName,
      input.action,
      input.claimedAt,
      input.staleBefore,
    )
    .run();
  return result.meta.changes > 0;
}

export async function completeGithubDelivery(
  db: D1Database,
  deliveryId: string,
  claimedAt: string,
  completedAt: string,
) {
  const result = await db
    .prepare(
      `update briar_github_deliveries
       set status = 'completed', completed_at = ?
       where delivery_id = ? and status = 'processing' and claimed_at = ?`,
    )
    .bind(completedAt, deliveryId, claimedAt)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function releaseGithubDelivery(
  db: D1Database,
  deliveryId: string,
  claimedAt: string,
) {
  const result = await db
    .prepare(
      `delete from briar_github_deliveries
       where delivery_id = ? and status = 'processing' and claimed_at = ?`,
    )
    .bind(deliveryId, claimedAt)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
