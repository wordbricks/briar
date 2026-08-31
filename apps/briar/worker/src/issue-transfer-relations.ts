export const transferredIssueRelationStatements = (
  db: D1Database,
  input: {
    sourceProjectId: string;
    targetProjectId: string;
    runId: string;
    observedAt: string;
  },
) => {
  const statements = [
    db
      .prepare(
        `insert into briar_dashboard_changes (
           project_id, entity_type, entity_id, operation, created_at
         )
         select ?, 'run', ?, 'delete', datetime('now')
         where exists (
           select 1 from briar_hunt_runs run
           where run.id = ? and run.project_id = ?
         )`,
      )
      .bind(
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `insert into briar_dashboard_sync_state (project_id, current_version)
         select ?, max(version) from briar_dashboard_changes
         where project_id = ?
         having max(version) is not null
         on conflict (project_id) do update set
           current_version = excluded.current_version`,
      )
      .bind(input.sourceProjectId, input.sourceProjectId),
    db
      .prepare(
        `delete from briar_issue_dependencies
         where project_id = ?
           and (prerequisite_run_id = ? or dependent_run_id = ?)
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_issue_attachments
         set project_id = ?
         where project_id = ? and run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_issue_messages
         set project_id = ?
         where project_id = ? and run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_run_evidence
         set project_id = ?
         where project_id = ? and run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_run_evidence_images
         set project_id = ?
         where project_id = ? and run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_issue_agent_reply_jobs
         set project_id = ?, preferred_worker_id = null, claimed_worker_id = null
         where project_id = ? and run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_log_archives
         set project_id = ?
         where project_id = ? and run_id = ?
           and archive_kind <> 'execution_audit'
           and (
             archive_kind <> 'agent_transcript'
             or not exists (
               select 1 from briar_channel_issue_transfer_quarantine quarantine
               where quarantine.entity_kind = 'agent_transcript_archive'
                 and quarantine.entity_id = briar_log_archives.id
             )
           )
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_archive_cleanup_queue
         set project_id = ?
         where project_id = ? and run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_run_pull_requests
         set project_id = ?
         where project_id = ? and run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_agent_transcript_sessions
         set project_id = ?
         where project_id = ? and run_id = ?
           and not exists (
             select 1 from briar_channel_issue_transfer_quarantine quarantine
             where quarantine.entity_kind = 'agent_transcript_session'
               and quarantine.entity_id = briar_agent_transcript_sessions.session_id
           )
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
  ];
  statements.push(
    // Issue conversation proposals are run-scoped authorization records. Move
    // them with the conversation so the source project cannot read or accept a
    // stale proposal after transfer.
    db
      .prepare(
        `update briar_issue_rework_proposals
         set project_id = ?, updated_at = ?
         where project_id = ? and run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.observedAt,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_issue_action_proposals
         set project_id = ?, updated_at = ?
         where project_id = ? and conversation_run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.observedAt,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
  );
  // Channel proposal cards point at the accepted issue. Keep their target
  // project aligned so retries and "View issue" deep links survive transfer;
  // the proposal UPDATE trigger also publishes a channel delta.
  statements.push(
    db
      .prepare(
        `update briar_channel_action_proposals
         set project_id = ?, updated_at = ?
         where result_run_id = ? and status = 'accepted'
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.observedAt,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
  );
  return statements;
};
