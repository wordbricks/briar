import { cloneAutoHuntWorkflow } from "../../src/lib/auto-hunt-contract";
import {
  defaultProjectAgentCalendarColor,
  defaultProjectAgentCopy,
  projectAgentSkill,
  type ProjectAgentLocale,
} from "../../src/lib/project-agent";
import type { ProjectRow } from "./project-repository";

import { archiveCleanupQueueUpsertSql } from "./archive-cleanup-repository";
import { stableJson } from "./hunt-run-codec";
import { type ProjectAgentRow } from "./project-agent-model";

export async function createProject(
  db: D1Database,
  input: {
    ownerUserId: string;
    organizationId: string;
    name: string;
    agentTokenHash: string;
    locale?: ProjectAgentLocale;
  },
) {
  const createdAt = new Date().toISOString();
  const project: ProjectRow = {
    id: crypto.randomUUID(),
    name: input.name,
    issue_key_prefix: "AH",
    schedule_tab_enabled: 1,
    icon: null,
    organization_id: input.organizationId,
    organization_name: "",
    member_role: "owner",
    created_at: createdAt,
  };
  const locale = input.locale ?? "en";
  const defaultAgentCopy = defaultProjectAgentCopy(locale);
  const defaultAgent: ProjectAgentRow = {
    id: crypto.randomUUID(),
    organization_id: input.organizationId,
    project_id: project.id,
    name: defaultAgentCopy.name,
    avatar: null,
    avatar_pet_json: null,
    avatar_spritesheet_object_key: null,
    provider: "codex",
    model: null,
    effort: null,
    designated_worker_id: null,
    designated_worker_label: null,
    description: defaultAgentCopy.description,
    responsibility: defaultAgentCopy.responsibility,
    skill_markdown: projectAgentSkill({
      name: defaultAgentCopy.name,
      responsibility: defaultAgentCopy.responsibility,
    }),
    calendar_color: defaultProjectAgentCalendarColor,
    created_at: createdAt,
    updated_at: createdAt,
  };
  const initialWorkflow = cloneAutoHuntWorkflow();
  await db.batch([
        db
          .prepare(
            `insert into briar_teams (
               id, owner_user_id, organization_id, name, agent_token_hash,
               created_at, updated_at
             ) values (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            project.id,
            input.ownerUserId,
            input.organizationId,
            project.name,
            input.agentTokenHash,
            createdAt,
            createdAt,
          ),
        db
          .prepare(
            `insert into briar_project_settings (
               project_id, workflow_json, mandatory_checkpoints_json,
               created_at, updated_at
             ) values (?, ?, ?, ?, ?)`,
          )
          .bind(
            project.id,
            stableJson(initialWorkflow),
            stableJson([]),
            createdAt,
            createdAt,
          ),
        db
          .prepare(
            `insert into briar_project_agents (
               id, organization_id, project_id, name, provider, model,
               description, responsibility, skill_markdown, calendar_color, created_at,
               updated_at
             ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            defaultAgent.id,
            input.organizationId,
            defaultAgent.project_id,
            defaultAgent.name,
            defaultAgent.provider,
            defaultAgent.model,
            defaultAgent.description,
            defaultAgent.responsibility,
            defaultAgent.skill_markdown,
            defaultAgent.calendar_color,
            defaultAgent.created_at,
            defaultAgent.updated_at,
          ),
      ]);
  return project;
}

export async function getProject(
  db: D1Database,
  projectId: string,
  userId: string,
) {
  const accessibleProject = () => db.prepare(
      `select project.id, project.name,
              project.issue_key_prefix,
              project.schedule_tab_enabled,
              coalesce(project.icon_data_url_browser, project.icon_data_url) as icon,
              project.organization_id,
              organization.name as organization_name,
              membership.role as member_role, project.created_at
       from briar_teams project
       join briar_organizations organization on organization.id = project.organization_id
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = ?
       left join briar_project_members project_membership
         on project_membership.project_id = project.id
        and project_membership.organization_id = project.organization_id
        and project_membership.user_id = membership.user_id
       where project.id = ?
         and (
           membership.role in ('owner', 'co-owner')
           or project_membership.user_id is not null
         )`,
    )
    .bind(userId, projectId)
    .first<ProjectRow>();
  try {
    return await accessibleProject();
  } catch (error) {
    if (!String(error).includes("no such table: briar_project_members")) {
      throw error;
    }
    return await db
      .prepare(
        `select project.id, project.name,
                project.issue_key_prefix,
                project.schedule_tab_enabled,
                coalesce(project.icon_data_url_browser, project.icon_data_url) as icon,
                project.organization_id,
                organization.name as organization_name,
                membership.role as member_role, project.created_at
         from briar_teams project
         join briar_organizations organization
           on organization.id = project.organization_id
         join briar_organization_members membership
           on membership.organization_id = project.organization_id
          and membership.user_id = ?
         where project.id = ?`,
      )
      .bind(userId, projectId)
      .first<ProjectRow>();
  }
}

export async function updateProjectIcon(
  db: D1Database,
  projectId: string,
  icon: string | null,
) {
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `update briar_teams
       set icon_data_url_browser = ?, icon_data_url = null, updated_at = ?
       where id = ?`,
    )
    .bind(icon, updatedAt, projectId)
    .run();
  return result.meta.changes > 0;
}

export async function updateProjectIssueKeyPrefix(
  db: D1Database,
  projectId: string,
  issueKeyPrefix: string,
) {
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `update briar_teams
       set issue_key_prefix = ?, updated_at = ?
       where id = ?`,
    )
    .bind(issueKeyPrefix, updatedAt, projectId)
    .run();
  return result.meta.changes > 0;
}

export async function updateProjectScheduleTabEnabled(
  db: D1Database,
  projectId: string,
  scheduleTabEnabled: boolean,
) {
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `update briar_teams
       set schedule_tab_enabled = ?, updated_at = ?
       where id = ?`,
    )
    .bind(scheduleTabEnabled ? 1 : 0, updatedAt, projectId)
    .run();
  return result.meta.changes > 0;
}

export async function deleteProject(
  db: D1Database,
  projectId: string,
  userId: string,
  observedAt = new Date().toISOString(),
) {
  const authorizedProject = `exists (
    select 1
    from briar_teams target
    join briar_organization_members membership
      on membership.organization_id = target.organization_id
    where target.id = ? and membership.user_id = ?
      and membership.role in ('owner', 'co-owner')
  )`;
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'archives', archive.object_key, ?, null, ?
         from briar_log_archives archive
         where (
           archive.project_id = ?
           or exists (
             select 1 from briar_hunt_runs run
             where run.id = archive.run_id and run.project_id = ?
           )
         ) and ${authorizedProject}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(
        projectId,
        observedAt,
        projectId,
        projectId,
        projectId,
        userId,
      ),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', related.value, ?, null, ?
         from briar_log_archives archive,
              json_each(archive.related_object_keys_json) related
         where related.type = 'text'
           and (
             archive.project_id = ?
             or exists (
               select 1 from briar_hunt_runs run
               where run.id = archive.run_id and run.project_id = ?
             )
           ) and ${authorizedProject}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(
        projectId,
        observedAt,
        projectId,
        projectId,
        projectId,
        userId,
      ),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', attachment.object_key, ?, null, ?
         from briar_issue_attachments attachment
         where (
           attachment.project_id = ?
           or exists (
             select 1 from briar_hunt_runs run
             where run.id = attachment.run_id and run.project_id = ?
           )
         ) and ${authorizedProject}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(
        projectId,
        observedAt,
        projectId,
        projectId,
        projectId,
        userId,
      ),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', image.object_key, ?, null, ?
         from briar_run_evidence_images image
         where (
           image.project_id = ?
           or exists (
             select 1 from briar_hunt_runs run
             where run.id = image.run_id and run.project_id = ?
           )
         ) and ${authorizedProject}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(
        projectId,
        observedAt,
        projectId,
        projectId,
        projectId,
        userId,
      ),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', agent.avatar_spritesheet_object_key, ?, null, ?
         from briar_project_agents agent
         where agent.project_id = ?
           and agent.avatar_spritesheet_object_key is not null
           and ${authorizedProject}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(projectId, observedAt, projectId, projectId, userId),
    db
      .prepare(
        `delete from briar_teams
         where id = ? and organization_id in (
           select organization_id from briar_organization_members
           where user_id = ? and role in ('owner', 'co-owner')
         )
         returning id`,
      )
      .bind(projectId, userId),
  ]);
  return (results.at(-1)?.results?.length ?? 0) > 0;
}

export async function getProjectRunChildMismatch(
  db: D1Database,
  projectId: string,
) {
  type Mismatch = {
      stale_project_id: string;
      current_project_id: string;
      run_id: string;
      entity_kind: string;
      entity_id: string;
  };
  for (const view of [
    "briar_run_child_storage_a_project_mismatches",
    "briar_run_child_storage_b_project_mismatches",
    "briar_run_child_relation_a_project_mismatches",
    "briar_run_child_relation_b_project_mismatches",
  ]) {
    const mismatch = await db
      .prepare(
        `select stale_project_id, current_project_id, run_id, entity_kind,
                entity_id
         from ${view}
         where stale_project_id = ? or current_project_id = ?
         order by entity_kind, entity_id
         limit 1`,
      )
      .bind(projectId, projectId)
      .first<Mismatch>();
    if (mismatch) return mismatch;
  }
  return null;
}
