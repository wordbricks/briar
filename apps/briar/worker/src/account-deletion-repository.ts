import { type OrganizationRole } from "./organization-repository";

export type AccountDeletionPlan = {
  blockedOrganizations: Array<{ id: string; name: string }>;
  organizationIds: string[];
  projectIds: string[];
};

export async function planAccountDeletion(
  db: D1Database,
  userId: string,
): Promise<AccountDeletionPlan> {
  const organizationResult = await db
    .prepare(
      `select organization.id, organization.name, membership.role,
              (select count(*)
               from briar_organization_members peer
               where peer.organization_id = organization.id) as member_count,
              exists(
                select 1 from briar_teams project
                where project.organization_id = organization.id
                  and project.owner_user_id = ?
              ) as owns_project,
              exists(
                select 1 from briar_execution_worker_devices device
                where device.organization_id = organization.id
                  and device.owner_user_id = ?
              ) as owns_worker,
              exists(
                select 1 from briar_slack_installations installation
                where installation.organization_id = organization.id
                  and installation.installed_by_user_id = ?
              ) as owns_slack_installation
       from briar_organization_members membership
       join briar_organizations organization
         on organization.id = membership.organization_id
       where membership.user_id = ?
       order by organization.created_at, organization.id`,
    )
    .bind(userId, userId, userId, userId)
    .all<{
      id: string;
      name: string;
      role: OrganizationRole;
      member_count: number;
      owns_project: number;
      owns_worker: number;
      owns_slack_installation: number;
    }>();
  const organizations = organizationResult.results ?? [];
  const blockedOrganizations = organizations
    .filter(
      (organization) =>
        organization.member_count > 1 &&
        (organization.role === "owner" ||
          organization.owns_project > 0 ||
          organization.owns_worker > 0 ||
          organization.owns_slack_installation > 0),
    )
    .map(({ id, name }) => ({ id, name }));
  const organizationIds = organizations
    .filter((organization) => organization.member_count === 1)
    .map((organization) => organization.id);
  const projectResult = await db
    .prepare(
      `select distinct project.id
       from briar_teams project
       where project.owner_user_id = ?
          or project.organization_id in (
            select membership.organization_id
            from briar_organization_members membership
            where membership.user_id = ?
              and 1 = (
                select count(*)
                from briar_organization_members peer
                where peer.organization_id = membership.organization_id
              )
          )
       order by project.id`,
    )
    .bind(userId, userId)
    .all<{ id: string }>();
  return {
    blockedOrganizations,
    organizationIds,
    projectIds: (projectResult.results ?? []).map((project) => project.id),
  };
}

export async function deleteAccountData(
  db: D1Database,
  input: {
    userId: string;
    email: string;
    emailRateLimitIdentifierHash?: string;
    observedAt: string;
  },
) {
  const jobId = crypto.randomUUID();
  const cleanupUpsert = `
    on conflict (bucket, object_key) do update set
      project_id = excluded.project_id,
      run_id = excluded.run_id,
      queued_at = excluded.queued_at,
      attempts = 0,
      last_attempt_at = null,
      last_error = null,
      generation = briar_archive_cleanup_queue.generation + 1,
      next_attempt_at = null,
      dead_lettered_at = null,
      alert_state = 'none',
      alert_detail_json = null`;
  const statements: D1PreparedStatement[] = [
    // This authoritative guard deliberately recomputes the current state. A
    // preview plan is useful UI, but it is never permission to erase an
    // organization that gained another member or user-owned resource later.
    db
      .prepare(
        `insert into briar_account_deletion_jobs (
           id, user_id, email, created_at
         )
         select ?, account.id, ?, ?
         from "user" account
         where account.id = ?
           and not exists (
             select 1
             from briar_organization_members membership
             where membership.user_id = account.id
               and membership.role = 'owner'
               and 1 < (
                 select count(*)
                 from briar_organization_members peer
                 where peer.organization_id = membership.organization_id
               )
           )
           and not exists (
             select 1 from briar_teams project
             where project.owner_user_id = account.id
               and not exists (
                 select 1
                 from briar_organization_members membership
                 where membership.organization_id = project.organization_id
                   and membership.user_id = account.id
                   and 1 = (
                     select count(*)
                     from briar_organization_members peer
                     where peer.organization_id = project.organization_id
                   )
               )
           )
           and not exists (
             select 1 from briar_execution_worker_devices device
             where device.owner_user_id = account.id
               and not exists (
                 select 1
                 from briar_organization_members membership
                 where membership.organization_id = device.organization_id
                   and membership.user_id = account.id
                   and 1 = (
                     select count(*)
                     from briar_organization_members peer
                     where peer.organization_id = device.organization_id
                   )
               )
           )
           and not exists (
             select 1 from briar_slack_installations installation
             where installation.installed_by_user_id = account.id
               and not exists (
                 select 1
                 from briar_organization_members membership
                 where membership.organization_id = installation.organization_id
                   and membership.user_id = account.id
                   and 1 = (
                     select count(*)
                     from briar_organization_members peer
                     where peer.organization_id = installation.organization_id
                   )
               )
           )
         returning id`,
      )
      .bind(jobId, input.email, input.observedAt, input.userId),
    db
      .prepare(
        `insert into briar_account_deletion_job_organizations (
           job_id, organization_id
         )
         select job.id, membership.organization_id
         from briar_account_deletion_jobs job
         join briar_organization_members membership
           on membership.user_id = job.user_id
         where job.id = ?
           and 1 = (
             select count(*) from briar_organization_members peer
             where peer.organization_id = membership.organization_id
           )`,
      )
      .bind(jobId),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'archives', archive.object_key,
                case when current_scope.organization_id is not null
                     then current_project.id else stored_project.id end,
                null, ?
         from briar_log_archives archive
         left join briar_teams stored_project
           on stored_project.id = archive.project_id
         left join briar_account_deletion_job_organizations stored_scope
           on stored_scope.job_id = ?
          and stored_scope.organization_id = stored_project.organization_id
         left join briar_hunt_runs run on run.id = archive.run_id
         left join briar_teams current_project
           on current_project.id = run.project_id
         left join briar_account_deletion_job_organizations current_scope
           on current_scope.job_id = ?
          and current_scope.organization_id = current_project.organization_id
         where stored_scope.organization_id is not null
            or current_scope.organization_id is not null
         ${cleanupUpsert}`,
      )
      .bind(input.observedAt, jobId, jobId),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', related.value,
                case when current_scope.organization_id is not null
                     then current_project.id else stored_project.id end,
                null, ?
         from briar_log_archives archive
         join json_each(archive.related_object_keys_json) related
           on related.type = 'text'
         left join briar_teams stored_project
           on stored_project.id = archive.project_id
         left join briar_account_deletion_job_organizations stored_scope
           on stored_scope.job_id = ?
          and stored_scope.organization_id = stored_project.organization_id
         left join briar_hunt_runs run on run.id = archive.run_id
         left join briar_teams current_project
           on current_project.id = run.project_id
         left join briar_account_deletion_job_organizations current_scope
           on current_scope.job_id = ?
          and current_scope.organization_id = current_project.organization_id
         where stored_scope.organization_id is not null
            or current_scope.organization_id is not null
         ${cleanupUpsert}`,
      )
      .bind(input.observedAt, jobId, jobId),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', attachment.object_key,
                case when current_scope.organization_id is not null
                     then current_project.id else stored_project.id end,
                null, ?
         from briar_issue_attachments attachment
         left join briar_teams stored_project
           on stored_project.id = attachment.project_id
         left join briar_account_deletion_job_organizations stored_scope
           on stored_scope.job_id = ?
          and stored_scope.organization_id = stored_project.organization_id
         left join briar_hunt_runs run on run.id = attachment.run_id
         left join briar_teams current_project
           on current_project.id = run.project_id
         left join briar_account_deletion_job_organizations current_scope
           on current_scope.job_id = ?
          and current_scope.organization_id = current_project.organization_id
         where stored_scope.organization_id is not null
            or current_scope.organization_id is not null
         ${cleanupUpsert}`,
      )
      .bind(input.observedAt, jobId, jobId),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', image.object_key,
                case when current_scope.organization_id is not null
                     then current_project.id else stored_project.id end,
                null, ?
         from briar_run_evidence_images image
         left join briar_teams stored_project
           on stored_project.id = image.project_id
         left join briar_account_deletion_job_organizations stored_scope
           on stored_scope.job_id = ?
          and stored_scope.organization_id = stored_project.organization_id
         left join briar_hunt_runs run on run.id = image.run_id
         left join briar_teams current_project
           on current_project.id = run.project_id
         left join briar_account_deletion_job_organizations current_scope
           on current_scope.job_id = ?
          and current_scope.organization_id = current_project.organization_id
         where stored_scope.organization_id is not null
            or current_scope.organization_id is not null
         ${cleanupUpsert}`,
      )
      .bind(input.observedAt, jobId, jobId),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', agent.avatar_spritesheet_object_key,
                'organization:' || agent.organization_id, null, ?
         from briar_project_agents agent
         join briar_account_deletion_job_organizations scope
           on scope.job_id = ?
          and scope.organization_id = agent.organization_id
         where agent.avatar_spritesheet_object_key is not null
         ${cleanupUpsert}`,
      )
      .bind(input.observedAt, jobId),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', attachment.object_key,
                'organization:' || attachment.organization_id, null, ?
         from briar_channel_message_attachments attachment
         join briar_account_deletion_job_organizations scope
           on scope.job_id = ?
          and scope.organization_id = attachment.organization_id
         ${cleanupUpsert}`,
      )
      .bind(input.observedAt, jobId),
    db
      .prepare(
        `insert into briar_slack_revocation_queue (
           id, team_id, encrypted_bot_token, token_iv, queued_at,
           next_attempt_at
         )
         select lower(hex(randomblob(32))), installation.team_id,
                installation.encrypted_bot_token, installation.token_iv, ?, ?
         from briar_slack_installations installation
         join briar_account_deletion_job_organizations scope
           on scope.job_id = ?
          and scope.organization_id = installation.organization_id`,
      )
      .bind(input.observedAt, input.observedAt, jobId),
  ];
  statements.push(
    db
      .prepare(
        `delete from verification
         where (
           lower(identifier) = lower(?)
           or lower(identifier) = lower('sign-in-otp-' || ?)
         )
           and exists (
             select 1 from briar_account_deletion_jobs where id = ?
           )`,
      )
      .bind(input.email, input.email, jobId),
    db
      .prepare(
        `delete from deviceCode
         where userId = ?
           and exists (
             select 1 from briar_account_deletion_jobs where id = ?
           )`,
      )
      .bind(input.userId, jobId),
    // issued_to_user_id is ON DELETE SET NULL, so revoke these credentials
    // before deleting the user while the authoritative job guard still exists.
    db
      .prepare(
        `delete from briar_project_agent_tokens
         where issued_to_user_id = ?
           and exists (
             select 1 from briar_account_deletion_jobs where id = ?
           )`,
      )
      .bind(input.userId, jobId),
  );
  if (input.emailRateLimitIdentifierHash) {
    statements.push(
      db
        .prepare(
          `delete from briar_auth_email_rate_limits
           where identifier_hash = ?
             and exists (
               select 1 from briar_account_deletion_jobs where id = ?
             )`,
        )
        .bind(input.emailRateLimitIdentifierHash, jobId),
    );
  }
  const userDeleteIndex = statements.length;
  statements.push(
    db
      .prepare(
        `delete from "user"
         where id = ? and exists (
           select 1 from briar_account_deletion_jobs where id = ?
         )
         returning id`,
      )
      .bind(input.userId, jobId),
    db
      .prepare(
        `delete from briar_organizations
         where id in (
           select organization_id
           from briar_account_deletion_job_organizations
           where job_id = ?
         )
         and not exists (select 1 from "user" where id = ?)`,
      )
      .bind(jobId, input.userId),
    db.prepare(`delete from briar_account_deletion_jobs where id = ?`).bind(jobId),
    db.prepare(`select 1 as present from "user" where id = ?`).bind(input.userId),
  );
  const results = await db.batch(statements);
  if ((results[userDeleteIndex]?.results?.length ?? 0) > 0) {
    return "deleted" as const;
  }
  return (results.at(-1)?.results?.length ?? 0) > 0
    ? ("blocked" as const)
    : ("not_found" as const);
}
