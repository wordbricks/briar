-- Add vertex to every persisted Agent provider constraint.

-- Generated from the fully migrated schema so columns, indexes, triggers,

-- and dependent rows remain byte-for-byte compatible with the prior schema.

pragma defer_foreign_keys = on;

drop trigger if exists "briar_dashboard_settings_update_sync";

drop trigger if exists "briar_dashboard_projects_update_sync";

drop trigger if exists "briar_channel_changes_channels_insert_sync";

drop trigger if exists "briar_channel_changes_channels_delete_sync";

drop trigger if exists "briar_project_settings_workflow_v2_insert";

drop trigger if exists "briar_project_settings_workflow_v2_update";

drop trigger if exists "briar_channel_issue_approval_audit_immutable_update";

drop trigger if exists "briar_project_agent_task_completion_receipt_immutable_update";

drop trigger if exists "briar_project_agent_task_completion_receipt_immutable_delete";

drop trigger if exists "briar_project_agent_session_summaries_insert_sync";

drop trigger if exists "briar_project_agent_session_summaries_update_sync";

drop trigger if exists "briar_project_agent_session_summaries_delete_sync";

drop trigger if exists "briar_inbox_organizations_delete_sync";

drop trigger if exists "briar_inbox_projects_insert_sync";

drop trigger if exists "briar_inbox_projects_delete_sync";

drop trigger if exists "briar_inbox_dashboard_state_insert_sync";

drop trigger if exists "briar_inbox_dashboard_state_update_sync";

drop trigger if exists "briar_inbox_agent_session_state_insert_sync";

drop trigger if exists "briar_inbox_agent_session_state_update_sync";

drop trigger if exists "briar_inbox_channel_members_insert_sync";

drop trigger if exists "briar_inbox_channel_members_delete_sync";

drop trigger if exists "briar_inbox_user_name_update_sync";

drop trigger if exists "briar_inbox_realtime_state_delete";

drop trigger if exists "briar_dashboard_worker_policy_insert_sync";

drop trigger if exists "briar_dashboard_worker_policy_update_sync";

drop trigger if exists "briar_dashboard_worker_allowlist_insert_sync";

drop trigger if exists "briar_dashboard_worker_allowlist_delete_sync";

drop trigger if exists "briar_dashboard_dependencies_insert_sync";

drop trigger if exists "briar_dashboard_dependencies_delete_sync";

drop trigger if exists "briar_dashboard_messages_insert_sync";

drop trigger if exists "briar_dashboard_messages_update_sync";

drop trigger if exists "briar_dashboard_messages_delete_sync";

drop trigger if exists "briar_dashboard_workers_insert_sync";

drop trigger if exists "briar_dashboard_workers_delete_sync";

drop trigger if exists "briar_dashboard_events_insert_sync";

drop trigger if exists "briar_dashboard_events_update_sync";

drop trigger if exists "briar_dashboard_events_delete_sync";

drop trigger if exists "briar_dashboard_mentions_insert_sync";

drop trigger if exists "briar_dashboard_mentions_delete_sync";

drop trigger if exists "briar_hunt_events_increment_run_event_count";

drop trigger if exists "briar_hunt_events_decrement_run_event_count";

drop trigger if exists "briar_issue_result_reviews_insert_sync";

drop trigger if exists "briar_issue_result_reviews_delete_sync";

drop trigger if exists "briar_dashboard_worker_devices_update_sync";

drop trigger if exists "briar_quarantined_transcript_session_project_guard";

drop trigger if exists "briar_quarantined_transcript_archive_project_guard";

drop trigger if exists "briar_mismatched_transcript_archive_quarantine";

drop trigger if exists "briar_mismatched_transcript_archive_verify_guard";

drop trigger if exists "briar_mismatched_run_archive_insert_guard";

drop trigger if exists "briar_transcript_session_run_insert_guard";

drop trigger if exists "briar_transcript_session_run_update_guard";

drop trigger if exists "briar_conversation_issue_creation_finalize_guard";

drop trigger if exists "briar_conversation_issue_reservation_immutable";

drop trigger if exists "briar_conversation_issue_approval_audit_insert";

drop trigger if exists "briar_channel_changes_proposals_insert_sync";

drop trigger if exists "briar_channel_changes_proposals_update_sync";

drop trigger if exists "briar_channel_create_execution_intent_insert_guard";

drop trigger if exists "briar_issue_create_execution_intent_insert_guard";

drop trigger if exists "briar_issue_execution_organization_delete_invalidate";

drop trigger if exists "briar_issue_execution_project_delete_invalidate";

drop trigger if exists "briar_issue_execution_channel_delete_invalidate";

drop trigger if exists "briar_issue_execution_channel_archive_invalidate";

drop trigger if exists "briar_issue_execution_channel_private_invalidate";

drop trigger if exists "briar_issue_execution_private_member_remove_invalidate";

drop trigger if exists "briar_issue_execution_worker_delete_run_reset";

drop trigger if exists "briar_issue_execution_approver_delete_run_reset";

drop trigger if exists "briar_issue_execution_approval_audit_insert_guard";

drop trigger if exists "briar_issue_execution_approval_audit_immutable_update";

drop trigger if exists "briar_issue_execution_approval_audit_immutable_delete";

drop trigger if exists "briar_channel_create_execution_intent_immutable";

drop trigger if exists "briar_issue_create_execution_intent_immutable";

drop trigger if exists "briar_issue_create_materialize_execution_proposal";

drop trigger if exists "briar_agent_skill_execution_audit_immutable_update";

drop trigger if exists "briar_agent_skill_execution_audit_immutable_delete";

drop trigger if exists "briar_inbox_channel_mentions_insert_sync";

drop trigger if exists "briar_inbox_channel_mentions_delete_sync";

drop trigger if exists "briar_channel_changes_reactions_insert_sync";

drop trigger if exists "briar_channel_changes_reactions_delete_sync";

drop trigger if exists "briar_dashboard_issue_rework_proposals_insert_sync";

drop trigger if exists "briar_dashboard_issue_rework_proposals_update_sync";

drop trigger if exists "briar_dashboard_issue_action_proposals_insert_sync";

drop trigger if exists "briar_dashboard_issue_action_proposals_update_sync";

drop trigger if exists "briar_issue_subscriptions_message_author_insert";

drop trigger if exists "briar_issue_subscriptions_mention_insert";

drop trigger if exists "briar_dashboard_runs_insert_sync";

drop trigger if exists "briar_dashboard_runs_delete_sync";

drop trigger if exists "briar_hunt_runs_workflow_v2_insert";

drop trigger if exists "briar_hunt_runs_workflow_v2_update";

drop trigger if exists "briar_channel_reply_skill_snapshot_update";

drop trigger if exists "briar_conversation_issue_creation_finalize";

drop trigger if exists "briar_conversation_issue_acceptance_transfer_guard";

drop trigger if exists "briar_verified_run_archive_transfer_guard";

drop trigger if exists "briar_issue_execution_reserved_proposal_delete_guard";

drop trigger if exists "briar_issue_execution_proposal_identity_immutable";

drop trigger if exists "briar_issue_execution_proposal_status_guard";

drop trigger if exists "briar_issue_execution_proposal_reservation_immutable";

drop trigger if exists "briar_issue_execution_proposal_deleted_approver_invalidate";

drop trigger if exists "briar_issue_execution_proposal_deleted_agent_invalidate";

drop trigger if exists "briar_issue_execution_proposal_deleted_delegator_invalidate";

drop trigger if exists "briar_issue_execution_proposal_deleted_worker_invalidate";

drop trigger if exists "briar_issue_execution_conversation_delete_invalidate";

drop trigger if exists "briar_issue_execution_channel_roster_remove_invalidate";

drop trigger if exists "briar_issue_execution_agent_delete_run_reset";

drop trigger if exists "briar_issue_execution_proposal_acceptance_immutable";

drop trigger if exists "briar_issue_execution_claim_approval_guard";

drop trigger if exists "briar_issue_execution_proposal_dispatch_guard";

drop trigger if exists "briar_issue_execution_dispatch_agent_guard";

drop trigger if exists "briar_issue_execution_dispatch_issue_source_guard";

drop trigger if exists "briar_issue_execution_dispatch_audit_guard";

drop trigger if exists "briar_issue_execution_dispatch_finalize";

drop trigger if exists "briar_issue_execution_proposal_accept_guard";

drop trigger if exists "briar_issue_execution_proposal_audit_insert";

drop trigger if exists "briar_issue_execution_dispatch_clear_guard";

drop trigger if exists "briar_issue_execution_retryable_transfer_guard";

drop trigger if exists "briar_issue_execution_terminal_transfer_guard";

drop trigger if exists "briar_issue_execution_terminal_reactivation_guard";

drop trigger if exists "briar_issue_execution_target_mutation_invalidate";

drop trigger if exists "briar_issue_execution_proposal_transfer_invalidate";

drop trigger if exists "briar_issue_execution_proposal_unassign_invalidate";

drop trigger if exists "briar_channel_execution_proposals_insert_sync";

drop trigger if exists "briar_channel_execution_proposals_update_sync";

drop trigger if exists "briar_project_agent_task_completion_receipt_insert_guard";

drop trigger if exists "briar_channel_agent_reply_skill_snapshot_immutable";

drop trigger if exists "briar_channel_action_skill_execution_exclusive";

drop trigger if exists "briar_issue_action_skill_execution_exclusive";

drop trigger if exists "briar_issue_rework_skill_execution_exclusive";

drop trigger if exists "briar_issue_execution_skill_execution_exclusive";

drop trigger if exists "briar_agent_skill_execution_identity_immutable";

drop trigger if exists "briar_agent_skill_execution_status_guard";

drop trigger if exists "briar_agent_skill_execution_acceptance_immutable";

drop trigger if exists "briar_agent_skill_execution_audit_insert_guard";

drop trigger if exists "briar_agent_skill_execution_task_link_immutable";

drop trigger if exists "briar_agent_skill_execution_task_core_immutable";

drop trigger if exists "briar_agent_skill_execution_task_terminal_guard";

drop trigger if exists "briar_agent_skill_execution_task_delete_reconcile";

drop trigger if exists "briar_agent_skill_execution_organization_delete_reconcile";

drop trigger if exists "briar_agent_skill_execution_worker_delete_reconcile";

drop trigger if exists "briar_agent_skill_execution_worker_binding_reconcile";

drop trigger if exists "briar_agent_skill_execution_worker_disable_reconcile";

drop trigger if exists "briar_agent_skill_execution_device_authority_reconcile";

drop trigger if exists "briar_agent_skill_execution_device_disable_reconcile";

drop trigger if exists "briar_agent_skill_execution_skill_delete_invalidate";

drop trigger if exists "briar_agent_skill_execution_agent_delete_invalidate";

drop trigger if exists "briar_agent_skill_execution_agent_update_invalidate";

drop trigger if exists "briar_agent_skill_execution_channel_archive_invalidate";

drop trigger if exists "briar_agent_skill_execution_channel_roster_invalidate";

drop trigger if exists "briar_agent_skill_execution_channel_job_invalidate";

drop trigger if exists "briar_agent_skill_execution_issue_message_invalidate";

drop trigger if exists "briar_agent_skill_execution_issue_message_delete_invalidate";

drop trigger if exists "briar_agent_skill_execution_issue_assignment_invalidate";

drop trigger if exists "briar_agent_skill_execution_channel_sync_insert";

drop trigger if exists "briar_agent_skill_execution_channel_sync_update";

drop trigger if exists "briar_dashboard_runs_update_sync";

drop trigger if exists "briar_channel_changes_reply_jobs_update_sync";

drop trigger if exists "briar_issue_subscriptions_run_insert";

drop trigger if exists "briar_issue_subscriptions_assignee_update";

drop trigger if exists "briar_channel_changes_messages_insert_sync";

drop trigger if exists "briar_channel_changes_messages_delete_sync";

drop trigger if exists "briar_agent_skill_execution_channel_message_invalidate";

drop trigger if exists "briar_agent_skill_execution_channel_message_delete_invalidate";

drop trigger if exists "briar_channel_changes_reply_jobs_insert_sync";

drop trigger if exists "briar_channel_reply_skill_snapshot_insert";

drop trigger if exists "briar_agent_skill_execution_channel_job_delete_invalidate";

drop trigger if exists "briar_issue_execution_proposal_insert_guard";

drop trigger if exists "briar_channel_create_materialize_execution_proposal";

drop trigger if exists "briar_issue_execution_dispatch_channel_source_guard";

drop trigger if exists "briar_dashboard_issue_execution_proposals_insert_sync";

drop trigger if exists "briar_dashboard_issue_execution_proposals_update_sync";

drop trigger if exists "briar_dashboard_issue_skill_proposals_insert_sync";

drop trigger if exists "briar_dashboard_issue_skill_proposals_update_sync";

drop trigger if exists "briar_issue_subscriptions_creator_insert";

drop trigger if exists "briar_agent_skills_max_count_insert";

drop trigger if exists "briar_agent_skills_max_count_update";

drop trigger if exists "briar_channel_thread_subscriptions_author_insert";

drop trigger if exists "briar_channel_thread_subscriptions_mention_insert";

drop trigger if exists "briar_channel_notification_message_insert";

drop trigger if exists "briar_channel_notification_mention_insert";

drop trigger if exists "briar_channel_notification_mention_delete";

drop trigger if exists "briar_issue_agent_reply_skill_snapshot_immutable";

drop trigger if exists "briar_agent_skill_execution_issue_job_invalidate";

drop trigger if exists "briar_agent_skill_execution_issue_job_delete_invalidate";

drop trigger if exists "briar_dashboard_issue_reply_jobs_insert_sync";

drop trigger if exists "briar_dashboard_issue_reply_jobs_update_sync";

drop trigger if exists "briar_project_stranded_run_child_delete_guard";

drop trigger if exists "briar_agent_skill_execution_insert_guard";

drop trigger if exists "briar_project_agent_session_requester_immutable";

drop trigger if exists "briar_managed_computers_state_transition";

drop trigger if exists "briar_channel_issue_batch_items_immutable_update";

drop trigger if exists "briar_agent_transcript_segments_totals_after_insert";

drop trigger if exists "briar_agent_transcript_segments_totals_after_delete";

drop trigger if exists "briar_agent_transcript_segments_totals_after_update";

drop trigger if exists "briar_agent_skill_execution_mode_insert_guard";

drop trigger if exists "briar_agent_skill_execution_result_job_insert_guard";

drop trigger if exists "briar_agent_skill_execution_result_job_origin_immutable";

drop trigger if exists "briar_agent_skill_execution_result_job_failure_publish";

drop trigger if exists "briar_agent_skill_execution_mode_immutable";

drop trigger if exists "briar_agent_skill_execution_result_origin_immutable";

drop trigger if exists "briar_channel_issue_proposal_decline_guard";

drop trigger if exists "briar_channel_issue_proposal_declined_accept_guard";

drop trigger if exists "briar_dashboard_attachments_insert_sync";

drop trigger if exists "briar_dashboard_attachments_delete_sync";

drop trigger if exists "briar_dashboard_members_insert_sync";

drop trigger if exists "briar_dashboard_members_update_sync";

drop trigger if exists "briar_dashboard_members_delete_sync";

drop trigger if exists "briar_issue_execution_org_member_remove_invalidate";

drop trigger if exists "briar_agent_skill_execution_worker_membership_reconcile";

drop trigger if exists "briar_project_members_insert_sync";

drop trigger if exists "briar_project_members_delete_sync";

drop trigger if exists "briar_issue_subscriptions_insert_sync";

drop trigger if exists "briar_issue_subscriptions_delete_sync";

drop trigger if exists "briar_channel_thread_subscriptions_insert_sync";

drop trigger if exists "briar_channel_thread_subscriptions_delete_sync";

drop trigger if exists "briar_mobile_push_outbox_sync_delete";

drop trigger if exists "briar_projects_sync_team_after_insert";

drop trigger if exists "briar_projects_sync_team_after_update";

drop trigger if exists "briar_projects_sync_team_after_delete";

drop trigger if exists "briar_teams_sync_legacy_after_insert";

drop trigger if exists "briar_teams_sync_legacy_after_update";

drop trigger if exists "briar_teams_sync_legacy_after_delete";

drop trigger if exists "briar_teams_delete_issues_before_projects";

drop trigger if exists "briar_hunt_runs_assign_default_project";

drop trigger if exists "briar_hunt_runs_validate_team_insert";

drop trigger if exists "briar_hunt_runs_sync_team_after_insert";

drop trigger if exists "briar_hunt_runs_validate_team_update";

drop trigger if exists "briar_hunt_runs_validate_project_insert";

drop trigger if exists "briar_hunt_runs_validate_project_update";

drop trigger if exists "briar_hunt_runs_reclassify_after_team_transfer";

drop trigger if exists "briar_teams_create_default_project_after_insert";

drop trigger if exists "briar_planning_projects_validate_lead_insert";

drop trigger if exists "briar_planning_projects_validate_lead_update";

drop trigger if exists "briar_agent_skill_execution_skill_update_invalidate";

drop trigger if exists "briar_agent_skill_execution_task_terminal_project";

drop trigger if exists "briar_channel_changes_channels_update_sync";

drop trigger if exists "briar_channel_changes_messages_update_sync";

drop trigger if exists "briar_dm_memory_close_roster";

drop trigger if exists "briar_dm_memory_member_added";

drop trigger if exists "briar_dm_memory_member_removed";

drop trigger if exists "briar_dm_memory_agent_added";

drop trigger if exists "briar_dm_memory_agent_removed";

drop trigger if exists "briar_dm_memory_member_replaced";

drop trigger if exists "briar_dm_memory_agent_replaced";

drop trigger if exists "briar_dm_memory_agent_scope_changed";

drop trigger if exists "briar_dm_memory_channel_changed";

drop trigger if exists "briar_dm_memory_channel_deleted";

drop trigger if exists "briar_dm_memory_owner_removed";

drop trigger if exists "briar_dm_memory_role_changed";

drop trigger if exists "briar_dm_memory_project_access_removed";

drop trigger if exists "briar_dm_memory_cancel_revoked";

drop trigger if exists "briar_dm_memory_message_changed";

drop trigger if exists "briar_dm_memory_message_deleted";

drop trigger if exists "briar_dm_memory_chunk_purge";

drop trigger if exists "briar_dm_memory_document_projection_update";

drop trigger if exists "briar_dm_memory_space_projection_update";

drop trigger if exists "briar_dm_memory_expiry_epoch";

drop trigger if exists "briar_issue_hierarchy_validate_insert";

drop trigger if exists "briar_issue_hierarchy_validate_update";

drop trigger if exists "briar_issue_relations_validate_insert";

drop trigger if exists "briar_issue_relations_validate_update";

drop trigger if exists "briar_dashboard_hierarchy_insert_sync";

drop trigger if exists "briar_dashboard_hierarchy_update_sync";

drop trigger if exists "briar_dashboard_hierarchy_delete_sync";

drop trigger if exists "briar_dashboard_relations_insert_sync";

drop trigger if exists "briar_dashboard_relations_update_sync";

drop trigger if exists "briar_dashboard_relations_delete_sync";

drop trigger if exists "briar_dm_memory_reply_revoked";

drop trigger if exists "briar_dm_memory_reply_space_deleted";

drop trigger if exists "briar_dm_memory_lookup_revision_changed";

drop trigger if exists "briar_dm_memory_lookup_claim_ended";

drop trigger if exists "briar_dm_memory_citations_forgotten";

drop trigger if exists "briar_dm_memory_invalidate_derived_versions";

drop trigger if exists "briar_dm_memory_capture_message";

drop trigger if exists "briar_dm_memory_capture_observation";

drop trigger if exists "briar_dm_memory_begin_opt_in";

drop trigger if exists "briar_dm_memory_learning_cancel";

drop trigger if exists "briar_dm_memory_purge_learning_payload";

drop trigger if exists "briar_dm_memory_forget_learning_payload";

drop trigger if exists "briar_dm_memory_edit_learning_source";

drop trigger if exists "briar_dm_memory_delete_learning_source";

drop trigger if exists "briar_dm_memory_forget_derived_content";

drop trigger if exists "briar_reply_completion_receipt_immutable_update";

drop trigger if exists "briar_reply_completion_receipt_immutable_delete";

drop trigger if exists "briar_channel_message_mutation_receipt_insert_guard";

drop trigger if exists "briar_channel_message_mutation_receipt_immutable";

drop trigger if exists "briar_upload_batch_insert_guard";

drop trigger if exists "briar_upload_batch_immutable";

drop trigger if exists "briar_upload_metadata_immutable";

drop trigger if exists "briar_issue_create_mutation_receipt_insert_guard";

drop trigger if exists "briar_issue_update_mutation_receipt_insert_guard";

drop trigger if exists "briar_issue_message_mutation_receipt_insert_guard";

drop trigger if exists "briar_issue_create_mutation_receipt_immutable";

drop trigger if exists "briar_issue_update_mutation_receipt_immutable";

drop trigger if exists "briar_issue_message_mutation_receipt_immutable";

drop trigger if exists "briar_upload_state_guard";

drop trigger if exists "briar_upload_delete_cleanup";

drop trigger if exists "briar_project_agent_schedule_creator_immutable";

drop trigger if exists "briar_archive_related_object_keys_insert_guard";

drop trigger if exists "briar_archive_related_object_keys_update_guard";

drop trigger if exists "briar_channel_issue_proposal_payload_immutable";

drop trigger if exists "briar_conversation_issue_proposal_payload_immutable";

drop trigger if exists "briar_channel_issue_proposal_current_insert_guard";

drop trigger if exists "briar_conversation_issue_proposal_current_insert_guard";

drop trigger if exists "briar_channel_issue_batch_items_immutable_delete";

drop trigger if exists "briar_channel_issue_proposal_action_insert_guard";

drop trigger if exists "briar_channel_issue_proposal_action_update_guard";

drop trigger if exists "briar_channel_message_blocks_array_insert";

drop trigger if exists "briar_channel_message_blocks_array_update";

drop trigger if exists "briar_workflow_checkpoint_storage_validate";

drop trigger if exists "briar_project_mandatory_checkpoints_shape_insert";

drop trigger if exists "briar_project_mandatory_checkpoints_shape_update";

drop trigger if exists "briar_user_default_checkpoints_shape_insert";

drop trigger if exists "briar_user_default_checkpoints_shape_update";

drop trigger if exists "briar_issue_checkpoints_shape_insert";

drop trigger if exists "briar_issue_checkpoints_shape_update";

drop trigger if exists "briar_execution_worker_runtime_insert_guard";

drop trigger if exists "briar_agent_skill_execution_task_claim_guard";

drop trigger if exists "briar_agent_skill_execution_accept_guard";

drop trigger if exists "briar_execution_worker_runtime_update_guard";

drop trigger if exists "briar_dashboard_workers_update_sync";

drop trigger if exists "briar_hunt_run_structured_result_insert_guard";

drop trigger if exists "briar_hunt_run_structured_result_update_guard";

drop trigger if exists "briar_schedule_run_structured_result_insert_guard";

drop trigger if exists "briar_schedule_run_structured_result_update_guard";

drop trigger if exists "briar_hunt_run_execution_metrics_insert_guard";

drop trigger if exists "briar_hunt_run_execution_metrics_update_guard";

drop trigger if exists "briar_project_agent_session_payload_insert_guard";

drop trigger if exists "briar_project_agent_session_payload_update_guard";

drop trigger if exists "briar_project_agent_session_summary_insert_guard";

drop trigger if exists "briar_project_agent_session_summary_update_guard";

drop trigger if exists "briar_agent_skill_execution_payload_insert_guard";

drop trigger if exists "briar_agent_skill_execution_payload_update_guard";

drop trigger if exists "briar_agent_skill_execution_payload_accept_guard";

drop trigger if exists "briar_agent_skill_execution_materialize";

drop trigger if exists "briar_conversation_issue_creation_project_guard";

drop trigger if exists "briar_hunt_runs_channel_proposal_reservation_required";

drop trigger if exists "briar_hunt_runs_finalize_channel_proposal_approval";

drop trigger if exists "briar_channel_issue_approval_audit_atomic_insert_guard";

drop trigger if exists "briar_channel_issue_approval_audit_atomic_update_guard";

drop trigger if exists "briar_channel_issue_approval_finalize_guard";

drop trigger if exists "briar_channel_approved_backlog_event_guard";

drop trigger if exists "briar_channel_approved_backlog_context_guard";

drop trigger if exists "briar_channel_approved_retryable_transfer_guard";

drop trigger if exists "briar_channel_approved_terminal_transfer_guard";

drop trigger if exists "briar_channel_approved_terminal_reactivation_guard";

drop trigger if exists "briar_channel_approved_dispatch_clear_guard";

drop trigger if exists "briar_channel_approved_dispatch_preference_snapshot";

drop trigger if exists "briar_channel_approved_dispatch_preference_guard";

drop trigger if exists "briar_hunt_runs_channel_proposal_project_guard";

drop trigger if exists "briar_hunt_runs_channel_proposal_reservation_guard";

drop trigger if exists "briar_hunt_runs_context_policy_insert_guard";

drop trigger if exists "briar_hunt_runs_context_policy_update_guard";

drop trigger if exists "briar_reply_completion_receipt_insert_guard";

drop trigger if exists "briar_channel_reply_session_events_immutable_update";

drop view if exists "briar_execution_worker_healthy_providers";

drop view if exists "briar_invalid_execution_worker_runtime";

-- Production held seven rows whose parent run was already gone, so
-- re-inserting them during the rebuild fails the deferred foreign key check
-- at commit. Every constraint on these child tables is on delete cascade,
-- which means the schema says the rows should not exist; drop them while the
-- parent table is still intact and every trigger is already removed.
delete from briar_hunt_events where run_id is not null and not exists (
  select 1 from briar_hunt_runs parent where parent.id = briar_hunt_events.run_id
);

delete from briar_issue_attachments where run_id is not null and not exists (
  select 1 from briar_hunt_runs parent where parent.id = briar_issue_attachments.run_id
);

delete from briar_issue_subscriptions where run_id is not null and not exists (
  select 1 from briar_hunt_runs parent where parent.id = briar_issue_subscriptions.run_id
);

create table "briar_provider_backup_agent_skill_execution_approval_audit" as select * from "briar_agent_skill_execution_approval_audit";

create table "briar_provider_backup_agent_skill_execution_proposals" as select * from "briar_agent_skill_execution_proposals";

create table "briar_provider_backup_project_agents" as select * from "briar_project_agents";

create table "briar_provider_backup_agent_skills" as select * from "briar_agent_skills";

create table "briar_provider_backup_hunt_runs" as select * from "briar_hunt_runs";

create table "briar_provider_backup_agent_transcript_sessions" as select * from "briar_agent_transcript_sessions";

create table "briar_provider_backup_agent_transcript_segments" as select * from "briar_agent_transcript_segments";

create table "briar_provider_backup_agent_transcripts" as select * from "briar_agent_transcripts";

create table "briar_provider_backup_agent_worklog_entries" as select * from "briar_agent_worklog_entries";

create table "briar_provider_backup_channel_action_proposals" as select * from "briar_channel_action_proposals";

create table "briar_provider_backup_channel_messages" as select * from "briar_channel_messages";

create table "briar_provider_backup_channel_reply_sessions" as select * from "briar_channel_reply_sessions";

create table "briar_provider_backup_channel_agent_reply_jobs" as select * from "briar_channel_agent_reply_jobs";

create table "briar_provider_backup_channel_agents" as select * from "briar_channel_agents";

create table "briar_provider_backup_channel_message_agent_mentions" as select * from "briar_channel_message_agent_mentions";

create table "briar_provider_backup_channel_message_attachments" as select * from "briar_channel_message_attachments";

create table "briar_provider_backup_channel_message_documents" as select * from "briar_channel_message_documents";

create table "briar_provider_backup_channel_message_mentions" as select * from "briar_channel_message_mentions";

create table "briar_provider_backup_channel_message_mutation_receipts" as select * from "briar_channel_message_mutation_receipts";

create table "briar_provider_backup_channel_message_reactions" as select * from "briar_channel_message_reactions";

create table "briar_provider_backup_channel_notification_inbox" as select * from "briar_channel_notification_inbox";

create table "briar_provider_backup_channel_reply_lookups" as select * from "briar_channel_reply_lookups";

create table "briar_provider_backup_channel_reply_session_events" as select * from "briar_channel_reply_session_events";

create table "briar_provider_backup_channel_thread_subscriptions" as select * from "briar_channel_thread_subscriptions";

create table "briar_provider_backup_dm_memory_activity_revocations" as select * from "briar_dm_memory_activity_revocations";

create table "briar_provider_backup_dm_memory_discovered_refs" as select * from "briar_dm_memory_discovered_refs";

create table "briar_provider_backup_dm_memory_reply_citations" as select * from "briar_dm_memory_reply_citations";

create table "briar_provider_backup_dm_memory_reply_fences" as select * from "briar_dm_memory_reply_fences";

create table "briar_provider_backup_execution_audit_events" as select * from "briar_execution_audit_events";

create table "briar_provider_backup_hunt_events" as select * from "briar_hunt_events";

create table "briar_provider_backup_issue_action_proposals" as select * from "briar_issue_action_proposals";

create table "briar_provider_backup_issue_messages" as select * from "briar_issue_messages";

create table "briar_provider_backup_issue_agent_reply_jobs" as select * from "briar_issue_agent_reply_jobs";

create table "briar_provider_backup_issue_attachments" as select * from "briar_issue_attachments";

create table "briar_provider_backup_issue_create_mutation_receipts" as select * from "briar_issue_create_mutation_receipts";

create table "briar_provider_backup_issue_dependencies" as select * from "briar_issue_dependencies";

create table "briar_provider_backup_issue_execution_approval_audit" as select * from "briar_issue_execution_approval_audit";

create table "briar_provider_backup_issue_execution_proposals" as select * from "briar_issue_execution_proposals";

create table "briar_provider_backup_issue_key_aliases" as select * from "briar_issue_key_aliases";

create table "briar_provider_backup_issue_message_mentions" as select * from "briar_issue_message_mentions";

create table "briar_provider_backup_issue_message_mutation_receipts" as select * from "briar_issue_message_mutation_receipts";

create table "briar_provider_backup_issue_parent_links" as select * from "briar_issue_parent_links";

create table "briar_provider_backup_issue_relations" as select * from "briar_issue_relations";

create table "briar_provider_backup_issue_result_reviews" as select * from "briar_issue_result_reviews";

create table "briar_provider_backup_issue_rework_proposals" as select * from "briar_issue_rework_proposals";

create table "briar_provider_backup_issue_subscriptions" as select * from "briar_issue_subscriptions";

create table "briar_provider_backup_issue_update_mutation_receipts" as select * from "briar_issue_update_mutation_receipts";

create table "briar_provider_backup_log_archives" as select * from "briar_log_archives";

create table "briar_provider_backup_merge_batch_candidates" as select * from "briar_merge_batch_candidates";

create table "briar_provider_backup_project_agent_schedules" as select * from "briar_project_agent_schedules";

create table "briar_provider_backup_project_agent_schedule_runs" as select * from "briar_project_agent_schedule_runs";

create table "briar_provider_backup_project_agent_task_jobs" as select * from "briar_project_agent_task_jobs";

create table "briar_provider_backup_run_checkpoint_progress" as select * from "briar_run_checkpoint_progress";

create table "briar_provider_backup_run_execution_attempts" as select * from "briar_run_execution_attempts";

create table "briar_provider_backup_run_cost_records" as select * from "briar_run_cost_records";

create table "briar_provider_backup_run_evidence" as select * from "briar_run_evidence";

create table "briar_provider_backup_run_evidence_images" as select * from "briar_run_evidence_images";

create table "briar_provider_backup_run_pull_requests" as select * from "briar_run_pull_requests";

create table "briar_provider_backup_run_evidence_pull_requests" as select * from "briar_run_evidence_pull_requests";

create table "briar_provider_backup_run_stage_progress" as select * from "briar_run_stage_progress";

create table "briar_provider_backup_run_stage_revisions" as select * from "briar_run_stage_revisions";

create table "briar_provider_backup_run_usage_records" as select * from "briar_run_usage_records";

drop table "briar_run_usage_records";

drop table "briar_run_stage_revisions";

drop table "briar_run_stage_progress";

drop table "briar_run_evidence_pull_requests";

drop table "briar_run_pull_requests";

drop table "briar_run_evidence_images";

drop table "briar_run_evidence";

drop table "briar_run_cost_records";

drop table "briar_run_execution_attempts";

drop table "briar_run_checkpoint_progress";

drop table "briar_project_agent_task_jobs";

drop table "briar_project_agent_schedule_runs";

drop table "briar_project_agent_schedules";

drop table "briar_merge_batch_candidates";

drop table "briar_log_archives";

drop table "briar_issue_update_mutation_receipts";

drop table "briar_issue_subscriptions";

drop table "briar_issue_rework_proposals";

drop table "briar_issue_result_reviews";

drop table "briar_issue_relations";

drop table "briar_issue_parent_links";

drop table "briar_issue_message_mutation_receipts";

drop table "briar_issue_message_mentions";

drop table "briar_issue_key_aliases";

drop table "briar_issue_execution_proposals";

drop table "briar_issue_execution_approval_audit";

drop table "briar_issue_dependencies";

drop table "briar_issue_create_mutation_receipts";

drop table "briar_issue_attachments";

drop table "briar_issue_agent_reply_jobs";

drop table "briar_issue_messages";

drop table "briar_issue_action_proposals";

drop table "briar_hunt_events";

drop table "briar_execution_audit_events";

drop table "briar_dm_memory_reply_fences";

drop table "briar_dm_memory_reply_citations";

drop table "briar_dm_memory_discovered_refs";

drop table "briar_dm_memory_activity_revocations";

drop table "briar_channel_thread_subscriptions";

drop table "briar_channel_reply_session_events";

drop table "briar_channel_reply_lookups";

drop table "briar_channel_notification_inbox";

drop table "briar_channel_message_reactions";

drop table "briar_channel_message_mutation_receipts";

drop table "briar_channel_message_mentions";

drop table "briar_channel_message_documents";

drop table "briar_channel_message_attachments";

drop table "briar_channel_message_agent_mentions";

drop table "briar_channel_agents";

drop table "briar_channel_agent_reply_jobs";

drop table "briar_channel_reply_sessions";

drop table "briar_channel_messages";

drop table "briar_channel_action_proposals";

drop table "briar_agent_worklog_entries";

drop table "briar_agent_transcripts";

drop table "briar_agent_transcript_segments";

drop table "briar_agent_transcript_sessions";

drop table "briar_hunt_runs";

drop table "briar_agent_skills";

drop table "briar_project_agents";

drop table "briar_agent_skill_execution_proposals";

drop table "briar_agent_skill_execution_approval_audit";

CREATE TABLE briar_agent_skill_execution_approval_audit (
  id text primary key not null,
  proposal_id text not null unique,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null,
  source_kind text not null check (source_kind in ('channel', 'issue')),
  channel_id text,
  conversation_run_id text,
  trigger_message_id text not null,
  reply_message_id text not null,
  source_reply_job_id text not null,
  delegated_by_reply_job_id text,
  agent_id text not null,
  agent_name text not null,
  agent_responsibility text not null,
  skill_id text not null,
  skill_name text not null,
  skill_instructions text not null,
  skill_kind text not null check (skill_kind in ('issue_processing', 'custom')),
  provider text not null
    check (provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter', 'vertex')),
  model text,
  effort text check (
    effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  request text not null,
  worker_id text not null,
  worker_label text not null,
  result_session_id text not null unique,
  approved_by_user_id text references "user" (id) on delete set null,
  approved_at text not null,
  delegated_by_agent_id text,
  delegated_by_agent_name text,
  created_at text not null
, execution_mode text not null default 'task'
  check (execution_mode in ('conversation', 'task')), approval_policy text not null default 'explicit'
  check (approval_policy in ('invoke_is_consent', 'explicit')), thread_root_message_id text, result_reply_job_id text, result_message_id text);

CREATE TABLE briar_agent_skill_execution_proposals (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  source_kind text not null check (source_kind in ('channel', 'issue')),
  channel_id text,
  conversation_run_id text,
  trigger_message_id text not null,
  reply_message_id text not null unique,
  source_reply_job_id text not null,
  delegated_by_reply_job_id text,
  agent_id text not null,
  agent_name text not null check (
    length(trim(agent_name)) between 1 and 100
  ),
  agent_responsibility text not null check (
    length(trim(agent_responsibility)) between 1 and 20000
  ),
  skill_id text not null,
  skill_name text not null check (
    length(trim(skill_name)) between 1 and 100
  ),
  skill_instructions text not null check (length(skill_instructions) <= 20000),
  skill_kind text not null check (skill_kind in ('issue_processing', 'custom')),
  provider text not null
    check (provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter', 'vertex')),
  model text check (
    model is null or length(trim(model)) between 1 and 100
  ),
  effort text check (
    effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  request text not null check (length(trim(request)) between 1 and 10000),
  delegated_by_agent_id text,
  delegated_by_agent_name text check (
    delegated_by_agent_name is null
    or length(trim(delegated_by_agent_name)) between 1 and 100
  ),
  generation integer not null default 1 check (generation >= 1),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'invalidated')),
  requested_worker_id text,
  requested_worker_label text,
  result_session_id text unique,
  accepted_by_user_id text references "user" (id) on delete set null,
  accepted_at text,
  created_at text not null,
  updated_at text not null, execution_mode text not null default 'task'
  check (execution_mode in ('conversation', 'task')), approval_policy text not null default 'explicit'
  check (approval_policy in ('invoke_is_consent', 'explicit')), thread_root_message_id text, result_reply_job_id text, result_message_id text, materialized_session_payload_json text,
  check (
    (source_kind = 'channel' and channel_id is not null
      and conversation_run_id is null)
    or
    (source_kind = 'issue' and channel_id is null
      and conversation_run_id is not null)
  ),
  check (
    (status = 'pending' and requested_worker_id is null
      and requested_worker_label is null and result_session_id is null
      and accepted_by_user_id is null and accepted_at is null)
    or
    (status = 'accepted' and requested_worker_id is not null
      and requested_worker_label is not null and result_session_id is not null
      and accepted_at is not null)
    or status = 'invalidated'
  )
);

CREATE TABLE "briar_project_agents" (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,

  project_id text references briar_projects (id) on delete cascade,

  handle text check (
    handle is null
    or (
      length(handle) between 1 and 63
      and handle not glob '*[^a-z0-9-]*'
    )
  ),
  name text not null check (length(trim(name)) between 1 and 100),
  provider text not null
    check (provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter', 'vertex')),
  model text check (
    model is null or (model = trim(model) and length(model) between 1 and 100)
  ),
  responsibility text not null check (
    responsibility = trim(responsibility)
    and length(responsibility) between 1 and 20000
  ),
  created_at text not null,
  updated_at text not null,
  calendar_color text not null default '#3275d5'
    check (length(calendar_color) = 7 and substr(calendar_color, 1, 1) = '#'),
  skill_markdown text not null default '' check (length(skill_markdown) <= 25000),
  avatar text check (
    avatar is null or (
      length(avatar) <= 400000 and (
        substr(avatar, 1, 22) = 'data:image/png;base64,'
        or substr(avatar, 1, 23) = 'data:image/jpeg;base64,'
        or substr(avatar, 1, 23) = 'data:image/webp;base64,'
      )
    )
  ),
  avatar_pet_json text check (
    avatar_pet_json is null or (
      length(avatar_pet_json) <= 4000 and json_valid(avatar_pet_json)
    )
  ),
  avatar_spritesheet_object_key text check (
    avatar_spritesheet_object_key is null or (
      length(avatar_spritesheet_object_key) <= 1000
      and avatar_spritesheet_object_key like 'project-agent-spritesheets/%'
    )
  ),
  effort text check (
    effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  )
, description text not null default '' check (
  description = trim(description)
  and length(description) <= 500
), designated_worker_id text
  references briar_execution_workers (id) on delete restrict, designated_worker_label text
  check (
    designated_worker_label is null
    or length(trim(designated_worker_label)) between 1 and 100
  ), computer_use_policy text not null default 'disabled'
check (computer_use_policy in ('disabled', 'unattended')));

CREATE TABLE briar_agent_skills (
  id text primary key not null,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  name text not null check (
    name = trim(name) and length(name) between 1 and 100
  ),
  body text not null default '' check (length(body) <= 20000),
  provider text not null
    check (provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter', 'vertex')),
  model text check (
    model is null or (model = trim(model) and length(model) between 1 and 100)
  ),
  effort text check (
    effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  kind text not null default 'custom'
    check (kind in ('issue_processing', 'custom')),
  is_default integer not null default 0 check (is_default in (0, 1)),
  position integer not null default 0 check (position >= 0),
  created_at text not null,
  updated_at text not null
, description text not null default ''
  check (length(description) <= 1000), execution_mode text not null
  default 'task' check (execution_mode in ('conversation', 'task')), approval_policy text not null
  default 'explicit' check (approval_policy in ('invoke_is_consent', 'explicit')));

CREATE TABLE "briar_hunt_runs" (
  run_number integer primary key autoincrement,
  id text not null unique,
  project_id text not null references briar_projects (id) on delete cascade,
  source text not null check (source in ('issue', 'error', 'feedback')),
  source_key text not null check (
    source_key = trim(source_key) and length(source_key) between 1 and 200
  ),
  title text not null check (length(trim(title)) between 1 and 300),
  stage text not null check (stage in (
    'queued', 'analyzing', 'implementing', 'pr_open', 'staging_qa',
    'production_qa', 'completed', 'blocked', 'failed', 'cancelled'
  )),
  detail text check (detail is null or length(detail) <= 4000),
  repository text not null check (length(trim(repository)) between 1 and 500),
  branch text check (branch is null or length(trim(branch)) between 1 and 500),
  commit_sha text check (
    commit_sha is null or (
      length(commit_sha) between 7 and 64
      and commit_sha not glob '*[^0-9a-f]*'
    )
  ),
  started_at text not null,
  completed_at text,
  last_event_at text not null,
  created_at text not null,
  updated_at text not null,
  priority integer check (priority is null or priority between 1 and 4),
  tracker_provider text
    check (tracker_provider is null or length(trim(tracker_provider)) between 1 and 50),
  tracker_issue_id text
    check (tracker_issue_id is null or length(trim(tracker_issue_id)) between 1 and 200),
  tracker_issue_identifier text
    check (tracker_issue_identifier is null or length(trim(tracker_issue_identifier)) between 1 and 100),
  tracker_issue_url text
    check (tracker_issue_url is null or length(trim(tracker_issue_url)) between 1 and 1000),
  tracker_issue_state text
    check (tracker_issue_state is null or length(trim(tracker_issue_state)) between 1 and 100),
  issue_description text
    check (issue_description is null or length(issue_description) <= 100000),
  result_summary text
    check (result_summary is null or length(result_summary) <= 100000),
  pull_request_urls text not null default '[]'
    check (json_valid(pull_request_urls) and json_type(pull_request_urls) = 'array'),
  target_sha text check (
    target_sha is null or (
      length(target_sha) between 7 and 64
      and target_sha not glob '*[^0-9a-f]*'
    )
  ),
  source_created_at text,
  staging_qa_status text
    check (staging_qa_status is null or staging_qa_status in ('pending', 'passed', 'skipped')),
  production_qa_status text
    check (production_qa_status is null or production_qa_status in ('pending', 'passed', 'skipped')),
  staging_qa_detail text
    check (staging_qa_detail is null or length(staging_qa_detail) <= 100000),
  production_qa_detail text
    check (production_qa_detail is null or length(production_qa_detail) <= 100000),
  context_json text check (
    context_json is null or (
      json_valid(context_json) and json_type(context_json) = 'object'
    )
  ),
  claim_token_hash text check (
    claim_token_hash is null or (
      length(claim_token_hash) = 64
      and claim_token_hash not glob '*[^0-9a-f]*'
    )
  ),
  claimed_by text
    check (claimed_by is null or length(trim(claimed_by)) between 1 and 128),
  claimed_at text,
  lease_expires_at text,
  claim_attempts integer not null default 0 check (claim_attempts >= 0),
  current_attempt integer not null default 1 check (current_attempt >= 1),
  workflow_stage text,
  workflow_snapshot_json text not null
    default '{"version":1,"stages":[{"id":"repository_workflow_pending","label":"Repository workflow pending","required":true}],"completion":{"requiredStages":["repository_workflow_pending"]},"release":{"enabled":false}}'
    check (
      json_valid(workflow_snapshot_json)
      and json_type(workflow_snapshot_json) = 'object'
    ),
  worker_id text references briar_execution_workers (id) on delete set null,
  status text not null default 'queued' check (status in (
    'backlog', 'queued', 'running', 'blocked', 'failed', 'completed', 'cancelled'
  )),
  current_revision integer not null default 1 check (current_revision >= 1),
  structured_result_json text,
  agent_id text references briar_project_agents (id) on delete set null,
  requested_worker_id text
    references briar_execution_workers (id) on delete set null,
  requested_by_user_id text references "user" (id) on delete set null,
  dispatch_mode text check (dispatch_mode in ('any', 'specific')),
  dispatch_request_id text,
  dispatched_at text,
  requested_agent_provider text check (
    requested_agent_provider is null
    or requested_agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter', 'vertex')
  ),
  preferred_agent_provider text check (
    preferred_agent_provider is null
    or preferred_agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter', 'vertex')
  ),
  preferred_agent_model text check (
    preferred_agent_model is null
    or length(trim(preferred_agent_model)) between 1 and 100
  ),
  preferred_agent_effort text check (
    preferred_agent_effort is null
    or preferred_agent_effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  requested_agent_model text check (
    requested_agent_model is null
    or length(trim(requested_agent_model)) between 1 and 100
  ),
  requested_agent_effort text check (
    requested_agent_effort is null
    or requested_agent_effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  event_count integer not null default 0 check (event_count >= 0),
  execution_metrics_json text, paused_at text, waiting_checkpoint_key text, waiting_checkpoint_revision integer
  check (waiting_checkpoint_revision is null or waiting_checkpoint_revision >= 1), resume_requested_at text, assignee_user_id text references "user" (id) on delete set null, issue_checkpoints_json text
  not null default '[]' check (
    json_valid(issue_checkpoints_json)
    and json_type(issue_checkpoints_json) = 'array'
  ), last_execution_id text, created_by_user_id text
  references "user" (id) on delete set null, planned_update_resume integer not null
  default 0 check (planned_update_resume in (0, 1)), difficulty text
  check (difficulty in ('easy', 'normal', 'hard')), team_id text
  references briar_teams (id) on delete cascade, planning_project_id text
  references briar_planning_projects (id) on delete restrict, full_auto integer not null default 0
  check (full_auto in (0, 1)), requires_claim_token integer not null default 0
  check (requires_claim_token in (0, 1)),
  unique (project_id, source, source_key),
  check (
    (stage in ('completed', 'cancelled') and completed_at is not null)
    or (stage not in ('completed', 'cancelled') and completed_at is null)
  )
);

CREATE TABLE "briar_agent_transcript_sessions" (
  session_id text primary key not null check (
    session_id = trim(session_id) and length(session_id) between 1 and 128
  ),
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text references briar_hunt_runs (id) on delete cascade,
  worker_id text references briar_execution_workers (id) on delete set null,
  agent_provider text not null
    check (agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter', 'vertex')),
  started_at text not null,
  last_event_at text not null,
  event_count integer not null default 0 check (event_count >= 0),
  byte_count integer not null default 0 check (byte_count >= 0)
);

CREATE TABLE briar_agent_transcript_segments (
  session_id text not null
    references briar_agent_transcript_sessions (session_id) on delete cascade,
  first_sequence integer not null check (first_sequence > 0),
  last_sequence integer not null check (last_sequence >= first_sequence),
  object_key text not null unique,
  event_count integer not null check (event_count > 0),
  uncompressed_bytes integer not null check (uncompressed_bytes > 0),
  compressed_bytes integer not null check (compressed_bytes > 0),
  sha256 text not null check (
    length(sha256) = 64 and sha256 not glob '*[^0-9a-f]*'
  ),
  recorded_at text not null,
  primary key (session_id, first_sequence, last_sequence)
);

CREATE TABLE briar_agent_transcripts (
  session_id text not null
    references briar_agent_transcript_sessions (session_id) on delete cascade,
  sequence integer not null check (sequence > 0),
  direction text not null check (direction in ('client', 'server')),
  payload_json text not null check (
    json_valid(payload_json)
    and length(payload_json) <= 32768
  ),
  recorded_at text not null,
  primary key (session_id, sequence)
);

CREATE TABLE briar_agent_worklog_entries (
  session_id text not null
    references briar_agent_transcript_sessions (session_id) on delete cascade,
  entry_id text not null check (
    entry_id = trim(entry_id) and length(entry_id) between 1 and 512
  ),
  sequence integer not null check (sequence > 0),
  updated_sequence integer not null check (updated_sequence >= sequence),
  entry_type text not null check (entry_type in ('message', 'activity')),
  activity_kind text check (
    activity_kind is null
    or activity_kind in ('command', 'fileChange', 'webSearch', 'tool')
  ),
  phase text,
  title text,
  body text not null default '',
  status text not null check (
    status in (
      'writing', 'completed', 'failed', 'cancelled', 'interrupted'
    )
  ),
  started_at text not null,
  updated_at text not null,
  completed_at text,
  primary key (session_id, entry_id)
);

CREATE TABLE "briar_channel_action_proposals" (
  id text primary key not null,
  channel_id text not null references briar_channels (id) on delete cascade,
  project_id text references briar_projects (id) on delete set null,
  trigger_message_id text not null,
  reply_message_id text not null unique,
  action_type text not null check (
    action_type in ('request_issue_create', 'request_plan_document')
  ),
  payload_json text not null check (json_valid(payload_json)),
  status text not null default 'pending'
    check (status in ('pending', 'accepted')),
  accepted_by_user_id text references "user" (id) on delete set null,
  accepted_at text,
  result_run_id text references briar_hunt_runs (id) on delete set null,
  created_at text not null,
  updated_at text not null, issue_source_key text, execute_after_create integer not null default 0
    check (execute_after_create in (0, 1)), execution_proposal_id text, declined_by_user_id text, declined_at text,
  unique (channel_id, trigger_message_id)
);

CREATE TABLE "briar_channel_messages" (
  id text primary key not null,
  channel_id text not null references briar_channels (id) on delete cascade,
  parent_message_id text
    references "briar_channel_messages" (id) on delete cascade,
  author_user_id text references "user" (id) on delete set null,
  author_agent_id text
    references briar_project_agents (id) on delete set null,
  author_agent_name text check (
    author_agent_name is null
    or length(trim(author_agent_name)) between 1 and 100
  ),
  author_agent_provider text check (
    author_agent_provider is null
    or author_agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter', 'vertex')
  ),
  author_webhook_id text
    references briar_channel_webhooks (id) on delete set null,
  author_webhook_name text check (
    author_webhook_name is null
    or length(trim(author_webhook_name)) between 1 and 100
  ),
  webhook_event_id text check (
    webhook_event_id is null
    or (webhook_event_id = trim(webhook_event_id)
      and length(webhook_event_id) between 1 and 200)
  ),
  body text not null check (
    body = trim(body) and length(body) between 1 and 10000
  ),
  created_at text not null,
  updated_at text not null, blocks_json text check (
    blocks_json is null
    or (json_valid(blocks_json) and length(blocks_json) <= 65536)
  ), deleted_at text, memory_source_version integer not null default 1,
  check (parent_message_id is null or parent_message_id <> id),
  check (
    author_agent_name is not null
    or (author_agent_id is null and author_agent_provider is null)
  ),
  check (author_webhook_name is not null or author_webhook_id is null),
  check (
    (author_user_id is not null)
    + (author_agent_name is not null)
    + (author_webhook_name is not null) = 1
  ),
  check (
    (author_webhook_name is null and webhook_event_id is null)
    or author_webhook_name is not null
  )
);

CREATE TABLE briar_channel_reply_sessions (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null references briar_channels (id) on delete cascade,
  thread_root_message_id text not null
    references briar_channel_messages (id) on delete cascade,
  project_id text references briar_projects (id) on delete set null,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  provider text not null check (
    provider in (
      'codex', 'claude', 'cursor', 'grok', 'agy', 'opencode', 'openrouter', 'vertex'
    )
  ),
  model text,
  effort text,
  owner_device_id text
    references briar_execution_worker_devices (id) on delete set null,
  owner_worker_id text
    references briar_execution_workers (id) on delete set null,
  conversation_id text check (
    conversation_id is null or length(conversation_id) between 1 and 1024
  ),
  last_activity_at text not null,
  retained_until text not null,
  created_at text not null,
  updated_at text not null, owner_worker_label text
  check (
    owner_worker_label is null
    or length(trim(owner_worker_label)) between 1 and 100
  ), memory_space_id text, memory_revocation_epoch integer,
  unique (channel_id, thread_root_message_id, agent_id),
  check (retained_until >= last_activity_at),
  check (
    (owner_device_id is null and owner_worker_id is null)
    or (owner_device_id is not null and owner_worker_id is not null)
  )
);

CREATE TABLE briar_channel_agent_reply_jobs (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null references briar_channels (id) on delete cascade,
  project_id text references briar_projects (id) on delete cascade,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  trigger_message_id text not null
    references briar_channel_messages (id) on delete cascade,
  parent_message_id text not null
    references briar_channel_messages (id) on delete cascade,
  reply_message_id text not null unique,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  agent_provider text check (
    agent_provider is null
    or agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter', 'vertex')
  ),
  claimed_device_id text
    references briar_execution_worker_devices (id) on delete set null,
  claim_token_hash text,
  claimed_at text,
  lease_expires_at text,
  attempts integer not null default 0 check (attempts >= 0),
  error text check (error is null or length(error) <= 4000),
  created_at text not null,
  updated_at text not null,
  completed_at text, skill_id text
    references briar_agent_skills (id) on delete set null, claimed_worker_id text
  references briar_execution_workers (id) on delete set null, delegated_by_reply_job_id text
    references briar_channel_agent_reply_jobs (id) on delete cascade, delegation_request text check (
    (delegated_by_reply_job_id is null and delegation_request is null)
    or (
      delegated_by_reply_job_id is not null
      and delegation_request is not null
      and length(delegation_request) between 1 and 10000
    )
  ), selected_skill_id_snapshot text check (
    selected_skill_id_snapshot is null
    or length(selected_skill_id_snapshot) = 36
  ), execution_target_ids_json text not null default '[]'
    check (
      json_valid(execution_target_ids_json)
      and json_type(execution_target_ids_json) = 'array'
    ), selected_agent_name_snapshot text, selected_agent_responsibility_snapshot text, selected_skill_name_snapshot text, selected_skill_instructions_snapshot text, selected_skill_provider_snapshot text, selected_skill_kind_snapshot text, selected_skill_model_snapshot text, selected_skill_effort_snapshot text, skill_execution_request_snapshot text, preferred_device_id text
  references briar_execution_worker_devices (id) on delete set null, planned_update_resume integer not null
  default 0 check (planned_update_resume in (0, 1)), session_id text
  references briar_channel_reply_sessions (id) on delete cascade, approved_skill_execution_proposal_id text, memory_restart_count integer not null default 0,
  unique (channel_id, trigger_message_id, agent_id)
);

CREATE TABLE briar_channel_agents (
  channel_id text not null references briar_channels (id) on delete cascade,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  added_by_user_id text references "user" (id) on delete set null,
  created_at text not null,
  primary key (channel_id, agent_id)
);

CREATE TABLE briar_channel_message_agent_mentions (
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  created_at text not null,
  primary key (message_id, agent_id)
);

CREATE TABLE briar_channel_message_attachments (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null references briar_channels (id) on delete cascade,
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  object_key text not null unique check (
    object_key = trim(object_key)
    and length(object_key) between 1 and 500
  ),
  filename text not null check (length(trim(filename)) between 1 and 255),
  content_type text not null check (content_type in (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'image/svg+xml', 'text/html', 'application/pdf'
  )),
  byte_size integer not null check (byte_size between 1 and 20971520),
  created_at text not null
, image_width integer check (
  image_width is null or (typeof(image_width) = 'integer' and image_width > 0)
), image_height integer check (
  image_height is null or (typeof(image_height) = 'integer' and image_height > 0)
));

CREATE TABLE "briar_channel_message_documents" (
  message_id text primary key not null
    references briar_channel_messages (id) on delete cascade,
  channel_id text not null references briar_channels (id) on delete cascade,


  project_id text references briar_projects (id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 300),
  markdown text not null check (length(markdown) <= 200000),
  created_at text not null,
  updated_at text not null
);

CREATE TABLE briar_channel_message_mentions (
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  created_at text not null,
  primary key (message_id, user_id)
);

CREATE TABLE briar_channel_message_mutation_receipts (
  message_id text primary key not null
    references briar_channel_messages (id) on delete cascade,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null references briar_channels (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  request_hash text not null check (
    length(request_hash) = 64
    and request_hash not glob '*[^0-9a-f]*'
  ),
  created_at text not null
);

CREATE TABLE briar_channel_message_reactions (
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  emoji text not null check (
    emoji = trim(emoji)
    and length(emoji) between 1 and 32
  ),
  created_at text not null,
  primary key (message_id, user_id, emoji)
);

CREATE TABLE "briar_channel_notification_inbox" (
  user_id text not null references "user" (id) on delete cascade,
  organization_id text not null,
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  notification_reason text not null
    check (notification_reason in ('mention', 'thread_reply', 'subscription')),
  created_at text not null,
  primary key (user_id, message_id)
);

CREATE TABLE briar_channel_reply_lookups (
  job_id text not null references briar_channel_agent_reply_jobs(id) on delete cascade,
  claim_token_hash text not null,
  request_id text not null,
  kind text not null check (kind in ('memory', 'organization')),
  request_hash text,
  query_hashes_json text not null default '[]' check (json_valid(query_hashes_json)),
  memory_revision integer,
  revocation_epoch integer,
  lease_token text not null,
  lease_expires_at text not null,
  attempts integer not null default 1,
  response_json text check (response_json is null or (json_valid(response_json) and length(cast(response_json as blob)) <= 2097152)),
  created_at text not null,
  primary key (job_id, claim_token_hash, request_id)
);

CREATE TABLE briar_channel_reply_session_events (
  id text primary key not null,
  session_id text not null
    references briar_channel_reply_sessions (id) on delete cascade,
  reply_job_id text
    references briar_channel_agent_reply_jobs (id) on delete set null,
  event_type text not null check (
    event_type in ('claimed', 'checkpointed', 'ttl_renewed', 'cleaned')
  ),
  reason text not null check (length(reason) between 1 and 100),
  from_worker_id text,
  to_worker_id text,
  retained_until text,
  detail_json text not null default '{}'
    check (json_valid(detail_json) and json_type(detail_json) = 'object'),
  occurred_at text not null
);

CREATE TABLE briar_channel_thread_subscriptions (
  root_message_id text not null
    references briar_channel_messages (id) on delete cascade,
  channel_id text not null
    references briar_channels (id) on delete cascade,
  organization_id text not null,
  user_id text not null,
  created_at text not null,
  primary key (root_message_id, user_id),
  foreign key (organization_id, user_id)
    references briar_organization_members (organization_id, user_id)
    on delete cascade
);

CREATE TABLE briar_dm_memory_activity_revocations (
  id text not null references briar_channel_agent_reply_jobs(id) on delete cascade,
  organization_id text not null, channel_id text not null, agent_id text not null,
  trigger_message_id text not null, parent_message_id text not null,
  attempts integer not null, primary key (id, attempts)
);

CREATE TABLE briar_dm_memory_discovered_refs (
  job_id text not null references briar_channel_agent_reply_jobs(id) on delete cascade,
  claim_token_hash text not null,
  document_id text not null references briar_dm_memory_documents(id) on delete cascade,
  version integer not null,
  primary key (job_id, claim_token_hash, document_id, version)
);

CREATE TABLE briar_dm_memory_reply_citations (
  message_id text not null references briar_channel_messages(id) on delete cascade,
  document_id text not null references briar_dm_memory_documents(id) on delete cascade,
  version integer not null,
  primary key (message_id, document_id, version)
);

CREATE TABLE briar_dm_memory_reply_fences (
  job_id text primary key not null references briar_channel_agent_reply_jobs(id) on delete cascade,
  claim_token_hash text not null,
  space_id text not null,
  revocation_epoch integer not null,
  protocol integer not null check (protocol in (0, 1)),
  created_at text not null
);

CREATE TABLE briar_execution_audit_events (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text references briar_hunt_runs (id) on delete cascade,
  worker_id text references briar_execution_workers (id) on delete set null,
  agent_id text references briar_project_agents (id) on delete set null,
  actor_user_id text references "user" (id) on delete set null,
  actor_device_id text
    references briar_execution_worker_devices (id) on delete set null,
  action text not null check (
    action in (
      'dispatched', 'reassigned', 'claimed', 'lease_lost', 'cancelled',
      'requeued', 'blocked', 'completed', 'worker_readiness_changed'
    )
  ),
  request_id text,
  detail_json text not null default '{}' check (
    json_valid(detail_json) and json_type(detail_json) = 'object'
  ),
  occurred_at text not null
);

CREATE TABLE "briar_hunt_events" (
  id text primary key not null,
  run_id text not null references "briar_hunt_runs" (id) on delete cascade,
  event_key text not null check (
    event_key = trim(event_key)
    and length(event_key) between 1 and 300
  ),
  stage text not null check (stage in (
    'queued', 'analyzing', 'implementing', 'pr_open', 'staging_qa',
    'production_qa', 'completed', 'blocked', 'failed', 'cancelled'
  )),
  detail text check (detail is null or length(detail) <= 4000),
  actor text not null check (length(trim(actor)) between 1 and 128),
  branch text,
  commit_sha text check (
    commit_sha is null or (
      length(commit_sha) between 7 and 64
      and commit_sha not glob '*[^0-9a-f]*'
    )
  ),
  occurred_at text not null,
  recorded_at text not null, qa_status text
  check (qa_status is null or qa_status in ('pending', 'passed', 'skipped')), tracker_issue_state text
  check (tracker_issue_state is null or length(trim(tracker_issue_state)) between 1 and 100), pull_request_urls text not null default '[]'
  check (json_valid(pull_request_urls) and json_type(pull_request_urls) = 'array'), target_sha text
  check (target_sha is null or (
    length(target_sha) between 7 and 64
    and target_sha not glob '*[^0-9a-f]*'
  )), attempt integer not null default 1
  check (attempt >= 1), workflow_stage text, status text not null
  default 'queued'
  check (status in (
    'backlog', 'queued', 'running', 'blocked', 'failed', 'completed',
    'cancelled'
  )), revision integer not null default 1
  check (revision >= 1),
  unique (run_id, event_key)
);

CREATE TABLE briar_issue_action_proposals (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  conversation_run_id text not null references briar_hunt_runs (id) on delete cascade,
  trigger_message_id text not null,
  reply_message_id text not null unique,
  action_type text not null
    check (action_type in ('request_issue_update', 'request_issue_create')),
  payload_json text not null check (json_valid(payload_json)),
  expected_run_updated_at text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted')),
  accepted_by_user_id text references "user" (id) on delete set null,
  accepted_at text,
  result_run_id text references briar_hunt_runs (id) on delete set null,
  created_at text not null,
  updated_at text not null, approval_reserved_by_user_id text
    references "user" (id) on delete set null, approval_reserved_at text, issue_source_key text, execute_after_create integer not null default 0
    check (execute_after_create in (0, 1)), execution_proposal_id text,
  unique (project_id, trigger_message_id)
);

CREATE TABLE "briar_issue_messages" (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  parent_message_id text,
  author_user_id text references "user" (id) on delete set null,
  author_agent_provider text check (
    author_agent_provider is null
    or author_agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter', 'vertex')
  ),
  body text not null check (
    body = trim(body) and length(body) between 1 and 10000
  ),
  created_at text not null,
  updated_at text not null, author_agent_id text
  references briar_project_agents (id) on delete set null, author_agent_name text,
  check (parent_message_id is null or parent_message_id <> id)
);

CREATE TABLE briar_issue_agent_reply_jobs (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  trigger_message_id text not null
    references briar_issue_messages (id) on delete cascade,
  parent_message_id text not null
    references briar_issue_messages (id) on delete cascade,
  reply_message_id text not null unique,
  agent_id text references briar_project_agents (id) on delete set null,
  requires_preferred_worker integer not null default 0
    check (requires_preferred_worker in (0, 1)),
  agent_name_snapshot text,
  agent_responsibility_snapshot text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  preferred_worker_id text
    references briar_execution_workers (id) on delete set null,
  claimed_worker_id text
    references briar_execution_workers (id) on delete set null,
  preferred_provider text
    check (preferred_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter', 'vertex')),
  agent_provider text
    check (agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter', 'vertex')),
  claim_token_hash text,
  claimed_at text,
  lease_expires_at text,
  attempts integer not null default 0 check (attempts >= 0),
  error text,
  created_at text not null,
  updated_at text not null,
  completed_at text,
  skill_id text references briar_agent_skills (id) on delete set null,
  selected_skill_id_snapshot text,
  selected_agent_name_snapshot text,
  selected_agent_responsibility_snapshot text,
  selected_skill_name_snapshot text,
  selected_skill_instructions_snapshot text,
  selected_skill_provider_snapshot text,
  selected_skill_kind_snapshot text,
  selected_skill_model_snapshot text,
  selected_skill_effort_snapshot text,
  skill_execution_request_snapshot text, planned_update_resume integer not null
  default 0 check (planned_update_resume in (0, 1)),
  unique (project_id, trigger_message_id, agent_id)
);

CREATE TABLE briar_issue_attachments (
  id text primary key not null,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  object_key text not null unique check (
    object_key = trim(object_key)
    and length(object_key) between 1 and 500
  ),
  filename text not null check (length(trim(filename)) between 1 and 255),
  content_type text not null check (content_type in (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'image/svg+xml', 'text/html', 'video/mp4', 'video/webm', 'video/quicktime'
  )),
  byte_size integer not null check (byte_size between 1 and 20971520),
  created_at text not null
);

CREATE TABLE briar_issue_create_mutation_receipts (
  client_issue_id text primary key not null
    references briar_hunt_runs (id) on delete cascade check (
      length(client_issue_id) between 1 and 128
      and client_issue_id not glob '*[^0-9A-Za-z_-]*'
    ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  request_hash text not null check (
    length(request_hash) = 64
    and request_hash not glob '*[^0-9a-f]*'
  ),
  attachment_upload_ids_json text not null check (
    length(attachment_upload_ids_json) between 2 and 1024
    and json_valid(attachment_upload_ids_json)
    and json_type(attachment_upload_ids_json) = 'array'
    and json_array_length(attachment_upload_ids_json) between 0 and 5
  ),
  response_json text not null check (
    length(response_json) between 2 and 1000000
    and json_valid(response_json)
    and json_type(response_json) = 'object'
  ),
  created_at text not null check (
    length(created_at) between 17 and 64 and created_at = trim(created_at)
  )
);

CREATE TABLE briar_issue_dependencies (
  project_id text not null references briar_projects (id) on delete cascade,
  prerequisite_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  dependent_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  created_by_user_id text references "user" (id) on delete set null,
  created_at text not null,
  primary key (prerequisite_run_id, dependent_run_id),
  check (prerequisite_run_id <> dependent_run_id)
);

CREATE TABLE briar_issue_execution_approval_audit (
  id text primary key not null,
  proposal_id text not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null,
  source_kind text not null check (source_kind in ('channel', 'issue')),
  channel_id text,
  conversation_run_id text,
  run_id text not null,
  generation integer not null,
  approved_by_user_id text references "user" (id) on delete set null,
  approved_at text not null,
  provider text not null
    check (provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter', 'vertex')),
  model text,
  effort text check (
    effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  worker_id text,
  dispatch_request_id text not null unique,
  proposed_by_agent_id text,
  delegated_by_agent_id text,
  created_at text not null
);

CREATE TABLE briar_issue_execution_proposals (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  source_kind text not null check (source_kind in ('channel', 'issue')),
  channel_id text references briar_channels (id) on delete set null,
  conversation_run_id text references briar_hunt_runs (id) on delete set null,
  trigger_message_id text not null,
  reply_message_id text not null unique,
  target_run_id text not null references briar_hunt_runs (id) on delete cascade,
  target_title text not null check (length(trim(target_title)) between 1 and 300),
  target_run_updated_at text not null,
  proposed_by_agent_id text
    references briar_project_agents (id) on delete set null,
  delegated_by_agent_id text
    references briar_project_agents (id) on delete set null,
  delegated_by_agent_name text
    check (
      delegated_by_agent_name is null
      or length(trim(delegated_by_agent_name)) between 1 and 100
    ),
  origin_create_proposal_id text,
  generation integer not null default 1 check (generation >= 1),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'invalidated')),
  approval_reserved_by_user_id text
    references "user" (id) on delete set null,
  approval_reserved_at text,
  requested_provider text check (
    requested_provider is null
    or requested_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter', 'vertex')
  ),
  requested_model text check (
    requested_model is null
    or length(trim(requested_model)) between 1 and 100
  ),
  requested_effort text check (
    requested_effort is null
    or requested_effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  requested_worker_id text
    references briar_execution_workers (id) on delete set null,
  dispatch_request_id text unique,
  accepted_by_user_id text references "user" (id) on delete set null,
  accepted_at text,
  created_at text not null,
  updated_at text not null,
  check (
    status = 'invalidated'
    or (
      source_kind = 'channel' and channel_id is not null
      and conversation_run_id is null
    )
    or (
      source_kind = 'issue' and channel_id is null
      and conversation_run_id is not null
    )
  ),
  check (
    (approval_reserved_at is null
      and requested_provider is null
      and requested_model is null
      and requested_effort is null
      and requested_worker_id is null
      and dispatch_request_id is null)
    or
    (approval_reserved_at is not null
      and requested_provider is not null
      and dispatch_request_id is not null)
  )
);

CREATE TABLE briar_issue_key_aliases (
  team_id text not null references briar_teams (id) on delete cascade,
  issue_key text not null check (length(trim(issue_key)) between 3 and 32),
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  created_at text not null,
  primary key (team_id, issue_key)
);

CREATE TABLE briar_issue_message_mentions (
  message_id text not null references briar_issue_messages (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  created_at text not null,
  primary key (message_id, user_id)
);

CREATE TABLE briar_issue_message_mutation_receipts (
  message_id text primary key not null
    references briar_issue_messages (id) on delete cascade check (
      length(message_id) between 1 and 128
      and message_id not glob '*[^0-9A-Za-z_-]*'
    ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade check (
    length(run_id) between 1 and 128
    and run_id not glob '*[^0-9A-Za-z_-]*'
  ),
  user_id text not null references "user" (id) on delete cascade,
  request_hash text not null check (
    length(request_hash) = 64
    and request_hash not glob '*[^0-9a-f]*'
  ),
  attachment_upload_ids_json text not null check (
    length(attachment_upload_ids_json) between 2 and 1024
    and json_valid(attachment_upload_ids_json)
    and json_type(attachment_upload_ids_json) = 'array'
    and json_array_length(attachment_upload_ids_json) between 0 and 5
  ),
  response_json text not null check (
    length(response_json) between 2 and 1000000
    and json_valid(response_json)
    and json_type(response_json) = 'object'
  ),
  created_at text not null check (
    length(created_at) between 17 and 64 and created_at = trim(created_at)
  )
);

CREATE TABLE briar_issue_parent_links (
  project_id text not null references briar_projects (id) on delete cascade,
  parent_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  child_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  created_by_user_id text references "user" (id) on delete set null,
  created_at text not null,
  primary key (child_run_id),
  check (parent_run_id <> child_run_id)
);

CREATE TABLE briar_issue_relations (
  project_id text not null references briar_projects (id) on delete cascade,
  first_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  second_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  relation_type text not null default 'related'
    check (relation_type = 'related'),
  created_by_user_id text references "user" (id) on delete set null,
  created_at text not null,
  primary key (first_run_id, second_run_id),
  check (first_run_id < second_run_id)
);

CREATE TABLE briar_issue_result_reviews (
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  reviewer_user_id text not null references "user" (id) on delete cascade,
  completed_at text not null,
  primary key (run_id, reviewer_user_id)
);

CREATE TABLE briar_issue_rework_proposals (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  trigger_message_id text not null,
  reply_message_id text not null unique,
  workflow_stage text not null,
  reason text not null,
  expected_attempt integer not null check (expected_attempt > 0),
  expected_revision integer not null check (expected_revision > 0),
  status text not null default 'pending'
    check (status in ('pending', 'accepted')),
  accepted_by_user_id text references "user" (id) on delete set null,
  accepted_at text,
  applied_revision integer check (applied_revision is null or applied_revision > 0),
  created_at text not null,
  updated_at text not null,
  unique (project_id, trigger_message_id)
);

CREATE TABLE briar_issue_subscriptions (
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  organization_id text not null,
  user_id text not null,
  created_at text not null,
  primary key (run_id, user_id),
  foreign key (organization_id, user_id)
    references briar_organization_members (organization_id, user_id)
    on delete cascade
);

CREATE TABLE briar_issue_update_mutation_receipts (
  request_id text primary key not null check (
    length(request_id) between 1 and 128
    and request_id not glob '*[^0-9A-Za-z_-]*'
  ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade check (
    length(run_id) between 1 and 128
    and run_id not glob '*[^0-9A-Za-z_-]*'
  ),
  user_id text not null references "user" (id) on delete cascade,
  request_hash text not null check (
    length(request_hash) = 64
    and request_hash not glob '*[^0-9a-f]*'
  ),
  attachment_upload_ids_json text not null check (
    length(attachment_upload_ids_json) between 2 and 1024
    and json_valid(attachment_upload_ids_json)
    and json_type(attachment_upload_ids_json) = 'array'
    and json_array_length(attachment_upload_ids_json) between 0 and 5
  ),
  response_json text not null check (
    length(response_json) between 2 and 1000000
    and json_valid(response_json)
    and json_type(response_json) = 'object'
  ),
  created_at text not null check (
    length(created_at) between 17 and 64 and created_at = trim(created_at)
  )
);

CREATE TABLE briar_log_archives (
  id text primary key not null check (
    length(id) = 64 and id not glob '*[^0-9a-f]*'
  ),
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text references briar_hunt_runs (id) on delete cascade,
  scope_id text not null check (
    scope_id = trim(scope_id) and length(scope_id) between 1 and 128
  ),
  archive_kind text not null check (archive_kind in (
    'run_events', 'run_evidence', 'execution_audit',
    'agent_transcript', 'issue_messages', 'project_agent_sessions'
  )),
  object_key text not null unique check (
    object_key = trim(object_key) and length(object_key) between 1 and 1024
  ),
  format_version integer not null check (format_version = 1),
  status text not null check (status in ('failed', 'verified', 'complete')),
  row_count integer not null check (row_count > 0),
  byte_size integer not null check (byte_size >= 0),
  sha256 text not null check (
    length(sha256) = 64 and sha256 not glob '*[^0-9a-f]*'
  ),
  content_sha256 text not null check (
    length(content_sha256) = 64 and content_sha256 not glob '*[^0-9a-f]*'
  ),
  period_start text not null,
  period_end text not null,
  created_at text not null,
  verified_at text,
  completed_at text,
  expires_at text not null,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_error text,
  related_object_keys_json text not null default '[]' check (
    json_valid(related_object_keys_json)
    and json_type(related_object_keys_json) = 'array'
  )
);

CREATE TABLE briar_merge_batch_candidates (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  batch_id text references briar_merge_batches (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  revision integer not null check (revision >= 1),
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository)) and length(repository) between 3 and 300
  ),
  base_branch text not null check (base_branch = 'main'),
  pull_request_id integer not null check (pull_request_id > 0),
  pull_request_node_id text not null check (
    length(trim(pull_request_node_id)) between 1 and 200
  ),
  pull_request_number integer not null check (pull_request_number > 0),
  pull_request_url text not null check (
    pull_request_url = trim(pull_request_url) and pull_request_url like 'https://%'
  ),
  frozen_head_sha text not null check (
    length(frozen_head_sha) = 40
    and frozen_head_sha not glob '*[^0-9a-f]*'
  ),
  frozen_base_sha text not null check (
    length(frozen_base_sha) = 40
    and frozen_base_sha not glob '*[^0-9a-f]*'
  ),
  priority integer check (priority between 1 and 4),
  ready_at text not null,
  ordinal integer check (ordinal is null or ordinal between 1 and 5),
  state text not null default 'ready' check (state in (
    'ready', 'frozen', 'enqueued', 'merged', 'dequeued', 'failed'
  )),
  queue_entry_id text,
  enqueued_at text,


  merged_delivery_id text,
  merged_at text,
  failure_code text,
  failure_detail text,
  created_at text not null,
  updated_at text not null,
  unique (
    run_id, attempt, revision, repository_id, pull_request_number
  ),
  unique (batch_id, ordinal),
  unique (batch_id, repository_id, pull_request_number),
  unique (queue_entry_id)
);

CREATE TABLE briar_project_agent_schedules (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  agent_id text not null references briar_project_agents (id) on delete cascade,
  name text not null check (
    name = trim(name)
    and length(name) between 1 and 120
  ),
  recurrence text not null check (
    recurrence in ('interval', 'daily', 'weekdays', 'weekly', 'custom')
  ),
  time_of_day text not null check (
    length(time_of_day) = 5
    and substr(time_of_day, 3, 1) = ':'
    and substr(time_of_day, 1, 2) between '00' and '23'
    and substr(time_of_day, 4, 2) between '00' and '59'
  ),
  day_of_week integer check (
    (recurrence = 'weekly' and day_of_week between 0 and 6)
    or (recurrence != 'weekly' and day_of_week is null)
  ),
  time_zone text not null check (
    time_zone = trim(time_zone)
    and length(time_zone) between 1 and 100
  ),
  enabled integer not null default 1 check (enabled in (0, 1)),
  created_at text not null,
  updated_at text not null,
  next_run_at text,
  interval_value integer not null default 1
    check (interval_value between 1 and 999),
  interval_unit text not null default 'day'
    check (interval_unit in ('minute', 'hour', 'day', 'week')),
  days_of_week text,
  notification_level text not null default 'important_updates'
    check (notification_level in ('important_updates', 'none')),
  created_by_user_id text references "user" (id) on delete set null
);

CREATE TABLE briar_project_agent_schedule_runs (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  schedule_id text not null
    references briar_project_agent_schedules (id) on delete cascade,
  agent_id text not null references briar_project_agents (id) on delete cascade,
  status text not null check (status in ('running', 'completed', 'failed')),
  scheduled_for text not null,
  claim_token_hash text,
  lease_expires_at text,
  started_at text not null,
  completed_at text,
  result_summary text,
  error text,
  created_at text not null,
  updated_at text not null,
  structured_result_json text,
  unique (schedule_id, scheduled_for)
);

CREATE TABLE briar_project_agent_task_jobs (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  agent_id text not null references briar_project_agents (id) on delete cascade,
  request text not null,
  request_id text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  preferred_worker_id text not null
    references briar_execution_workers (id) on delete cascade,
  claimed_worker_id text
    references briar_execution_workers (id) on delete set null,
  claim_token_hash text,
  claimed_at text,
  lease_expires_at text,
  attempts integer not null default 0 check (attempts >= 0),
  error text,
  created_at text not null,
  updated_at text not null,
  completed_at text, skill_id text
    references briar_agent_skills (id) on delete set null, skill_execution_proposal_id text, result_summary text, result_conversation_id text, planned_update_resume integer not null
  default 0 check (planned_update_resume in (0, 1)), cancel_requested_at text, cancelled_by_user_id text, resume_count integer not null default 0 check (resume_count >= 0),
  unique (project_id, request_id)
);

CREATE TABLE briar_run_checkpoint_progress (
  run_id text not null references briar_hunt_runs(id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  revision integer not null check (revision >= 1),
  checkpoint_key text not null check (
    length(checkpoint_key) between 1 and 64
    and substr(checkpoint_key, 1, 1) glob '[a-z]'
    and checkpoint_key not glob '*[^a-z0-9_-]*'
  ),
  stage_id text not null check (
    length(stage_id) between 1 and 64
    and substr(stage_id, 1, 1) glob '[a-z]'
    and stage_id not glob '*[^a-z0-9_-]*'
  ),
  position text not null check (position in ('before', 'after')),
  state text not null check (state in ('pending', 'waiting', 'approved', 'invalidated')),
  reached_at text,
  approved_at text,
  approved_by text,
  approved_request_id text,
  primary key (run_id, attempt, revision, checkpoint_key),
  check (
    (state = 'pending'
      and reached_at is null
      and approved_at is null
      and approved_by is null
      and approved_request_id is null)
    or (state = 'waiting'
      and reached_at is not null
      and approved_at is null
      and approved_by is null
      and approved_request_id is null)
    or (state = 'approved'
      and reached_at is not null
      and approved_at is not null
      and approved_by is not null
      and approved_request_id is not null)
    or (state = 'invalidated')
  )
);

CREATE TABLE briar_run_execution_attempts (
  id text primary key not null check (
    length(id) = 36
    and substr(id, 9, 1) = '-'
    and substr(id, 14, 1) = '-'
    and substr(id, 19, 1) = '-'
    and substr(id, 24, 1) = '-'
  ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,


  project_id text not null,
  run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  run_attempt integer not null check (run_attempt > 0),
  claim_attempt integer not null check (claim_attempt > 0),
  worker_id text,
  claimed_by text,
  claimed_at text not null,
  recorded_at text not null
);

CREATE TABLE briar_run_cost_records (
  execution_id text not null
    references briar_run_execution_attempts (id) on delete cascade,
  cost_key text not null check (length(trim(cost_key)) between 1 and 512),
  usage_key text check (
    usage_key is null or length(trim(usage_key)) between 1 and 512
  ),
  session_id text check (
    session_id is null or length(trim(session_id)) between 1 and 512
  ),
  turn_id text check (
    turn_id is null or length(trim(turn_id)) between 1 and 512
  ),
  scope_id text check (
    scope_id is null or length(trim(scope_id)) between 1 and 512
  ),
  agent_provider text not null check (
    agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter', 'vertex')
  ),
  model_provider text check (
    model_provider is null or length(trim(model_provider)) between 1 and 256
  ),
  model text check (
    model is null or length(trim(model)) between 1 and 512
  ),
  canonical_model text check (
    canonical_model is null or length(trim(canonical_model)) between 1 and 512
  ),
  model_source text not null check (
    model_source in (
      'providerReported', 'providerConfig', 'configuredFallback', 'unknown'
    )
  ),
  source text not null check (length(trim(source)) between 1 and 128),
  amount_usd_ticks integer not null check (
    typeof(amount_usd_ticks) = 'integer'
    and amount_usd_ticks >= 0
    and amount_usd_ticks <= 9007199254740991
  ),
  observed_at text not null,
  recorded_at text not null,
  primary key (execution_id, cost_key)
);

CREATE TABLE briar_run_evidence (
  id text primary key,
  project_id text not null references briar_projects(id) on delete cascade,
  run_id text not null references briar_hunt_runs(id) on delete cascade,
  attempt integer not null,
  evidence_key text not null,
  workflow_stage text not null,
  evidence_type text not null,
  status text not null check (status in ('pending', 'passed', 'failed', 'skipped')),
  detail text,
  command text,
  url text,
  metadata_json text check (
    metadata_json is null or (
      json_valid(metadata_json) and json_type(metadata_json) = 'object'
    )
  ),
  actor text not null,
  observed_at text not null,
  recorded_at text not null, revision integer not null default 1
  check (revision >= 1), github_association_started_at text, image_upload_ids_json text not null default '[]'
  check (
    json_valid(image_upload_ids_json)
    and json_type(image_upload_ids_json) = 'array'
  ),
  unique (run_id, attempt, evidence_key)
);

CREATE TABLE briar_run_evidence_images (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  evidence_id text not null references briar_run_evidence (id) on delete cascade,
  object_key text not null unique check (
    object_key = trim(object_key)
    and length(object_key) between 1 and 500
  ),
  filename text not null check (length(trim(filename)) between 1 and 255),
  content_type text not null check (content_type in (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'image/svg+xml'
  )),
  byte_size integer not null check (byte_size between 1 and 20971520),
  sha256 text not null check (
    length(sha256) = 64 and sha256 not glob '*[^0-9a-f]*'
  ),
  position integer not null check (position between 0 and 4),
  created_at text not null,
  unique (evidence_id, position)
);

CREATE TABLE briar_run_pull_requests (
  project_id text not null
    references briar_projects (id) on delete cascade,
  run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  revision integer not null check (revision >= 1),
  revision_started_at text not null,
  url text not null check (
    url = trim(url)
    and length(url) between 1 and 1000
    and url like 'https://%'
  ),
  installation_id integer check (installation_id is null or installation_id > 0),
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository))
    and length(repository) between 3 and 300
  ),
  pull_request_id integer not null check (pull_request_id > 0),
  pull_request_node_id text not null check (
    length(trim(pull_request_node_id)) between 1 and 200
  ),
  pull_request_number integer not null check (pull_request_number > 0),
  state text not null default 'unknown'
    check (state in ('unknown', 'open', 'closed', 'merged')),
  draft integer check (draft is null or draft in (0, 1)),
  head_sha text check (
    head_sha is null or (
      length(head_sha) between 7 and 64
      and head_sha not glob '*[^0-9a-f]*'
    )
  ),
  base_sha text check (
    base_sha is null or (
      length(base_sha) between 7 and 64
      and base_sha not glob '*[^0-9a-f]*'
    )
  ),
  merge_commit_sha text check (
    merge_commit_sha is null or (
      length(merge_commit_sha) between 7 and 64
      and merge_commit_sha not glob '*[^0-9a-f]*'
    )
  ),
  opened_at text,
  closed_at text,
  merged_at text,
  provider_updated_at text,
  last_delivery_id text,
  created_at text not null,
  updated_at text not null, base_branch text,
  primary key (
    run_id, attempt, revision, repository_id, pull_request_number
  )
);

CREATE TABLE briar_run_evidence_pull_requests (
  evidence_id text primary key not null
    references briar_run_evidence (id) on delete cascade,
  run_id text not null,
  attempt integer not null check (attempt >= 1),
  revision integer not null check (revision >= 1),
  repository_id integer not null check (repository_id > 0),
  pull_request_number integer not null check (pull_request_number > 0),
  pull_request_id integer not null check (pull_request_id > 0),
  pull_request_node_id text not null check (
    length(trim(pull_request_node_id)) between 1 and 200
  ),
  foreign key (
    run_id, attempt, revision, repository_id, pull_request_number,
    pull_request_id, pull_request_node_id
  ) references briar_run_pull_requests (
    run_id, attempt, revision, repository_id, pull_request_number,
    pull_request_id, pull_request_node_id
  ) on delete cascade
);

CREATE TABLE briar_run_stage_progress (
  run_id text not null references briar_hunt_runs(id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  revision integer not null check (revision >= 1),
  stage_id text not null check (
    length(stage_id) between 1 and 64
    and substr(stage_id, 1, 1) glob '[a-z]'
    and stage_id not glob '*[^a-z0-9_-]*'
  ),
  state text not null check (state in ('pending', 'running', 'completed', 'skipped')),
  started_at text,
  finished_at text,
  primary key (run_id, attempt, revision, stage_id),
  check (
    (state = 'pending' and started_at is null and finished_at is null)
    or (state = 'running' and started_at is not null and finished_at is null)
    or (state = 'completed' and started_at is not null and finished_at is not null)
    or (state = 'skipped' and finished_at is not null)
  )
);

CREATE TABLE briar_run_stage_revisions (
  run_id text not null references briar_hunt_runs(id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  workflow_stage text not null,
  required_revision integer not null check (required_revision >= 1),
  primary key (run_id, attempt, workflow_stage)
);

CREATE TABLE briar_run_usage_records (
  execution_id text not null
    references briar_run_execution_attempts (id) on delete cascade,
  usage_key text not null check (length(trim(usage_key)) between 1 and 512),
  session_id text,
  turn_id text,
  scope_id text,
  agent_provider text not null check (
    agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter', 'vertex')
  ),
  model_provider text,
  model text,
  canonical_model text,
  model_source text not null check (
    model_source in (
      'providerReported', 'providerConfig', 'configuredFallback', 'unknown'
    )
  ),
  source text not null check (length(trim(source)) between 1 and 128),
  uncached_input_tokens integer check (
    uncached_input_tokens is null or uncached_input_tokens >= 0
  ),
  cache_read_tokens integer check (
    cache_read_tokens is null or cache_read_tokens >= 0
  ),
  cache_write_tokens integer check (
    cache_write_tokens is null or cache_write_tokens >= 0
  ),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  reasoning_output_tokens integer check (
    reasoning_output_tokens is null or reasoning_output_tokens >= 0
  ),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  observed_at text not null,
  recorded_at text not null,
  check (
    uncached_input_tokens is not null
    or cache_read_tokens is not null
    or cache_write_tokens is not null
    or output_tokens is not null
    or reasoning_output_tokens is not null
    or total_tokens is not null
  ),
  check (
    reasoning_output_tokens is null
    or (
      output_tokens is not null
      and reasoning_output_tokens <= output_tokens
    )
  ),

  primary key (execution_id, usage_key)
);

CREATE INDEX briar_hunt_events_run_idx
  on briar_hunt_events (run_id, occurred_at desc, id desc);

CREATE INDEX briar_hunt_events_run_attempt_idx
  on briar_hunt_events (run_id, attempt, occurred_at desc, id desc);

CREATE INDEX briar_run_evidence_run_attempt
  on briar_run_evidence (run_id, attempt, workflow_stage, evidence_type);

CREATE INDEX briar_run_stage_revisions_run_attempt
  on briar_run_stage_revisions (run_id, attempt, required_revision);

CREATE UNIQUE INDEX briar_execution_audit_request_idx
  on briar_execution_audit_events (project_id, action, request_id)
  where request_id is not null;

CREATE INDEX briar_execution_audit_project_idx
  on briar_execution_audit_events (project_id, occurred_at desc, id);

CREATE INDEX briar_issue_message_mentions_user_idx
  on briar_issue_message_mentions (user_id, created_at desc, message_id);

CREATE INDEX briar_issue_dependencies_dependent_idx
  on briar_issue_dependencies (project_id, dependent_run_id, created_at);

CREATE INDEX briar_issue_dependencies_prerequisite_idx
  on briar_issue_dependencies (project_id, prerequisite_run_id, created_at);

CREATE INDEX briar_log_archives_project_kind_idx
  on briar_log_archives (project_id, archive_kind, period_end, id);

CREATE INDEX briar_log_archives_run_kind_idx
  on briar_log_archives (run_id, archive_kind, period_end, id)
  where run_id is not null;

CREATE INDEX briar_log_archives_status_idx
  on briar_log_archives (status, created_at, id);

CREATE INDEX briar_log_archives_expiry_idx
  on briar_log_archives (expires_at, id)
  where status = 'complete';

CREATE INDEX briar_issue_result_reviews_completed_idx
  on briar_issue_result_reviews (completed_at desc);

CREATE INDEX briar_issue_messages_run_idx
  on briar_issue_messages (run_id, created_at, id);

CREATE INDEX briar_issue_messages_parent_idx
  on briar_issue_messages (parent_message_id, created_at, id);

CREATE INDEX briar_agent_transcript_sessions_project_idx
  on briar_agent_transcript_sessions (project_id, last_event_at desc);

CREATE INDEX briar_hunt_runs_project_idx
  on briar_hunt_runs (project_id, last_event_at desc);

CREATE INDEX briar_hunt_runs_attention_idx
  on briar_hunt_runs (project_id, last_event_at desc)
  where stage in ('blocked', 'failed');

CREATE INDEX briar_hunt_runs_tracker_issue_idx
  on briar_hunt_runs (project_id, tracker_provider, tracker_issue_id)
  where tracker_issue_id is not null;

CREATE UNIQUE INDEX briar_hunt_runs_tracker_issue_unique_idx
  on briar_hunt_runs (project_id, tracker_provider, tracker_issue_id)
  where tracker_provider is not null and tracker_issue_id is not null;

CREATE INDEX briar_hunt_runs_worker_idx
  on briar_hunt_runs (worker_id, last_event_at desc);

CREATE INDEX briar_hunt_runs_status_idx
  on briar_hunt_runs (project_id, status, last_event_at desc);

CREATE INDEX briar_hunt_runs_queue_claim_idx on briar_hunt_runs (
  project_id, priority, source_created_at, lease_expires_at
) where status = 'queued';

CREATE UNIQUE INDEX briar_hunt_runs_dispatch_request_idx
  on briar_hunt_runs (project_id, dispatch_request_id)
  where dispatch_request_id is not null;

CREATE INDEX briar_hunt_runs_dispatch_queue_idx on briar_hunt_runs (
  project_id, status, requested_worker_id, agent_id, dispatched_at
);

CREATE INDEX briar_run_stage_progress_lookup_idx
  on briar_run_stage_progress (run_id, attempt, revision, stage_id);

CREATE INDEX briar_run_checkpoint_progress_lookup_idx
  on briar_run_checkpoint_progress (
    run_id, attempt, revision, stage_id, position
  );

CREATE UNIQUE INDEX briar_run_checkpoint_waiting_unique_idx
  on briar_run_checkpoint_progress (run_id, attempt, revision)
  where state = 'waiting';

CREATE INDEX briar_hunt_runs_waiting_checkpoint_idx
  on briar_hunt_runs (
    project_id, waiting_checkpoint_revision, waiting_checkpoint_key
  )
  where waiting_checkpoint_key is not null;

CREATE INDEX briar_hunt_runs_resume_requested_idx
  on briar_hunt_runs(project_id, resume_requested_at, run_number)
  where resume_requested_at is not null;

CREATE INDEX briar_hunt_runs_assignee_idx
  on briar_hunt_runs (project_id, assignee_user_id, updated_at desc);

CREATE INDEX briar_run_pull_requests_current_idx
  on briar_run_pull_requests (run_id, attempt, revision, state);

CREATE INDEX briar_run_pull_requests_url_idx
  on briar_run_pull_requests (url, run_id, attempt, revision);

CREATE INDEX briar_run_pull_requests_identity_idx
  on briar_run_pull_requests (
    repository_id, pull_request_number, run_id, attempt, revision
  );

CREATE INDEX briar_issue_rework_proposals_run_idx
  on briar_issue_rework_proposals (run_id, created_at, id);

CREATE INDEX briar_issue_rework_proposals_pending_idx
  on briar_issue_rework_proposals (project_id, status, created_at);

CREATE INDEX briar_issue_action_proposals_run_idx
  on briar_issue_action_proposals (conversation_run_id, created_at, id);

CREATE INDEX briar_issue_action_proposals_pending_idx
  on briar_issue_action_proposals (project_id, status, created_at);

CREATE INDEX briar_channel_message_mentions_user_idx
  on briar_channel_message_mentions (user_id, created_at desc, message_id);

CREATE INDEX briar_channel_message_documents_channel_idx
  on briar_channel_message_documents (channel_id, created_at);

CREATE INDEX briar_channel_action_proposals_pending_idx
  on briar_channel_action_proposals (channel_id, status, created_at);

CREATE INDEX briar_run_execution_attempts_org_claimed_idx
  on briar_run_execution_attempts (
    organization_id, claimed_at desc, run_id, claim_attempt
  );

CREATE INDEX briar_run_execution_attempts_worker_idx
  on briar_run_execution_attempts (worker_id, project_id, id);

CREATE INDEX briar_run_execution_attempts_run_idx
  on briar_run_execution_attempts (run_id, organization_id, claimed_at);

CREATE INDEX briar_run_usage_records_observed_idx
  on briar_run_usage_records (observed_at, execution_id);

CREATE INDEX briar_agent_transcript_sessions_project_run_idx
  on briar_agent_transcript_sessions (
    project_id, run_id, last_event_at desc, started_at desc, session_id desc
  );

CREATE INDEX briar_run_cost_records_observed_idx
  on briar_run_cost_records (observed_at, execution_id);

CREATE INDEX briar_run_cost_records_usage_idx
  on briar_run_cost_records (execution_id, usage_key)
  where usage_key is not null;

CREATE INDEX briar_channel_message_reactions_message_idx
  on briar_channel_message_reactions (message_id, created_at, emoji);

CREATE INDEX briar_hunt_runs_project_run_number_idx
  on briar_hunt_runs (project_id, run_number);

CREATE INDEX briar_log_archives_project_sessions_idx
  on briar_log_archives (project_id, scope_id, period_end, id)
  where archive_kind = 'project_agent_sessions'
    and status in ('verified', 'complete');

CREATE INDEX briar_hunt_runs_source_identity_project_idx
  on briar_hunt_runs (source, source_key, project_id);

CREATE UNIQUE INDEX briar_issue_action_proposals_issue_source_key_idx
  on briar_issue_action_proposals (issue_source_key)
  where issue_source_key is not null;

CREATE UNIQUE INDEX briar_channel_action_proposals_issue_source_key_idx
  on briar_channel_action_proposals (issue_source_key)
  where issue_source_key is not null;

CREATE UNIQUE INDEX briar_channel_action_execution_proposal_idx
  on briar_channel_action_proposals (execution_proposal_id)
  where execution_proposal_id is not null;

CREATE UNIQUE INDEX briar_issue_action_execution_proposal_idx
  on briar_issue_action_proposals (execution_proposal_id)
  where execution_proposal_id is not null;

CREATE INDEX briar_issue_execution_proposals_issue_idx
  on briar_issue_execution_proposals (
    project_id, conversation_run_id, created_at, id
  );

CREATE INDEX briar_issue_execution_proposals_channel_idx
  on briar_issue_execution_proposals (channel_id, created_at, id);

CREATE INDEX briar_issue_execution_proposals_target_idx
  on briar_issue_execution_proposals (target_run_id, status, generation);

CREATE UNIQUE INDEX briar_issue_execution_origin_create_idx
  on briar_issue_execution_proposals (source_kind, origin_create_proposal_id)
  where origin_create_proposal_id is not null;

CREATE INDEX briar_issue_execution_approval_audit_run_idx
  on briar_issue_execution_approval_audit (run_id, approved_at, id);

CREATE INDEX briar_issue_execution_approval_audit_proposal_idx
  on briar_issue_execution_approval_audit (proposal_id, generation);

CREATE INDEX briar_agent_skill_execution_audit_session_idx
  on briar_agent_skill_execution_approval_audit (
    project_id, result_session_id, approved_at
  );

CREATE INDEX briar_run_execution_attempts_project_idx
  on briar_run_execution_attempts (project_id, id);

CREATE INDEX briar_channel_messages_root_idx
  on briar_channel_messages (channel_id, created_at, id)
  where parent_message_id is null;

CREATE INDEX briar_channel_messages_thread_idx
  on briar_channel_messages (parent_message_id, created_at, id);

CREATE INDEX briar_channel_messages_channel_idx
  on briar_channel_messages (channel_id, created_at, id);

CREATE UNIQUE INDEX briar_channel_messages_webhook_event_idx
  on briar_channel_messages (author_webhook_id, webhook_event_id)
  where author_webhook_id is not null and webhook_event_id is not null;

CREATE INDEX briar_hunt_runs_project_created_idx
  on briar_hunt_runs (project_id, source_created_at, created_by_user_id);

CREATE INDEX briar_agent_worklog_entries_session_sequence_idx
  on briar_agent_worklog_entries (session_id, sequence, entry_id);

CREATE INDEX briar_agent_worklog_entries_session_updated_idx
  on briar_agent_worklog_entries (session_id, updated_sequence, entry_id);

CREATE INDEX briar_agent_transcript_segments_session_sequence_idx
  on briar_agent_transcript_segments (
    session_id, first_sequence, last_sequence
  );

CREATE INDEX briar_hunt_runs_github_reconcile_idx
  on briar_hunt_runs (paused_at, id)
  where status = 'running'
    and paused_at is not null
    and resume_requested_at is null
    and workflow_stage = 'pr_open';

CREATE INDEX briar_project_agents_project_idx
  on briar_project_agents (project_id, created_at, id);

CREATE INDEX briar_project_agents_organization_idx
  on briar_project_agents (organization_id, created_at, id);

CREATE INDEX briar_channel_agents_agent_idx
  on briar_channel_agents (agent_id, channel_id);

CREATE INDEX briar_channel_agent_reply_jobs_queue_idx
  on briar_channel_agent_reply_jobs (
    organization_id, status, project_id, lease_expires_at, created_at
  );

CREATE INDEX briar_channel_agent_reply_jobs_channel_idx
  on briar_channel_agent_reply_jobs (channel_id, created_at desc);

CREATE INDEX briar_project_agent_task_jobs_queue_idx
  on briar_project_agent_task_jobs (
    project_id, preferred_worker_id, status, lease_expires_at, created_at
  );

CREATE INDEX briar_project_agent_task_jobs_session_idx
  on briar_project_agent_task_jobs (project_id, updated_at desc, id);

CREATE UNIQUE INDEX briar_agent_skills_name_idx
  on briar_agent_skills (agent_id, name collate nocase);

CREATE INDEX briar_agent_skills_agent_idx
  on briar_agent_skills (agent_id, position, created_at, id);

CREATE INDEX briar_project_agent_task_jobs_skill_idx
  on briar_project_agent_task_jobs (skill_id, status, created_at);

CREATE INDEX briar_channel_agent_reply_jobs_skill_idx
  on briar_channel_agent_reply_jobs (skill_id, status, created_at);

CREATE INDEX briar_channel_agent_reply_jobs_claimed_worker_idx
  on briar_channel_agent_reply_jobs (claimed_worker_id, status, lease_expires_at);

CREATE UNIQUE INDEX briar_channel_agent_reply_jobs_delegation_target_idx
  on briar_channel_agent_reply_jobs (delegated_by_reply_job_id, agent_id)
  where delegated_by_reply_job_id is not null;

CREATE INDEX briar_channel_agent_reply_jobs_delegation_parent_idx
  on briar_channel_agent_reply_jobs (
    delegated_by_reply_job_id, status, created_at, id
  );

CREATE UNIQUE INDEX briar_agent_skill_execution_source_job_idx
  on briar_agent_skill_execution_proposals (source_kind, source_reply_job_id);

CREATE INDEX briar_agent_skill_execution_channel_idx
  on briar_agent_skill_execution_proposals (channel_id, created_at, id);

CREATE INDEX briar_agent_skill_execution_issue_idx
  on briar_agent_skill_execution_proposals (
    project_id, conversation_run_id, created_at, id
  );

CREATE INDEX briar_agent_skill_execution_skill_idx
  on briar_agent_skill_execution_proposals (skill_id, status, created_at);

CREATE UNIQUE INDEX briar_project_agent_task_skill_execution_idx
  on briar_project_agent_task_jobs (skill_execution_proposal_id)
  where skill_execution_proposal_id is not null;

CREATE INDEX briar_channel_agent_reply_jobs_preferred_device_idx
  on briar_channel_agent_reply_jobs (
    preferred_device_id, status, created_at, id
  );

CREATE INDEX briar_channel_notification_inbox_user_organization_created_idx
  on briar_channel_notification_inbox (
    user_id, organization_id, created_at desc, message_id desc
  );

CREATE INDEX briar_issue_agent_reply_jobs_queue_idx
  on briar_issue_agent_reply_jobs (
    project_id, status, preferred_worker_id, lease_expires_at, created_at
  );

CREATE INDEX briar_issue_agent_reply_jobs_run_idx
  on briar_issue_agent_reply_jobs (run_id, created_at desc);

CREATE INDEX briar_issue_agent_reply_jobs_skill_idx
  on briar_issue_agent_reply_jobs (skill_id, status, created_at);

CREATE INDEX briar_issue_agent_reply_jobs_agent_idx
  on briar_issue_agent_reply_jobs (agent_id, status, created_at);

CREATE INDEX briar_merge_batch_candidates_ready_idx
  on briar_merge_batch_candidates (
    repository_id, base_branch, state, batch_id,
    priority, ready_at, run_id, pull_request_number
  );

CREATE INDEX briar_merge_batch_candidates_project_state_idx
  on briar_merge_batch_candidates (
    project_id, state, batch_id, repository_id, base_branch
  );

CREATE INDEX briar_merge_batch_candidates_pull_request_head_idx
  on briar_merge_batch_candidates (
    repository_id, pull_request_number, frozen_head_sha, state
  );

CREATE INDEX briar_channel_messages_deleted_idx
  on briar_channel_messages (channel_id, deleted_at)
  where deleted_at is not null;

CREATE INDEX briar_channel_reply_sessions_owner_idx
  on briar_channel_reply_sessions (
    owner_worker_id, retained_until, updated_at
  );

CREATE INDEX briar_channel_reply_sessions_expiry_idx
  on briar_channel_reply_sessions (retained_until, updated_at);

CREATE INDEX briar_channel_agent_reply_jobs_session_idx
  on briar_channel_agent_reply_jobs (
    session_id, status, lease_expires_at, created_at, id
  );

CREATE INDEX briar_channel_reply_session_events_session_idx
  on briar_channel_reply_session_events (session_id, occurred_at desc, id);

CREATE INDEX briar_agent_skill_execution_origin_idx
  on briar_agent_skill_execution_proposals (
    channel_id, thread_root_message_id, trigger_message_id, created_at
  );

CREATE INDEX briar_project_agents_designated_worker_idx
  on briar_project_agents (designated_worker_id, project_id);

CREATE INDEX briar_issue_attachments_run_idx
  on briar_issue_attachments (run_id, created_at, id);

CREATE INDEX briar_issue_attachments_project_idx
  on briar_issue_attachments (project_id, run_id);

CREATE INDEX briar_issue_subscriptions_user_idx
  on briar_issue_subscriptions (organization_id, user_id, created_at desc);

CREATE INDEX briar_channel_thread_subscriptions_user_idx
  on briar_channel_thread_subscriptions (
    organization_id, user_id, created_at desc
  );

CREATE INDEX briar_channel_thread_subscriptions_channel_idx
  on briar_channel_thread_subscriptions (channel_id, root_message_id);

CREATE INDEX briar_hunt_runs_planning_project_idx
  on briar_hunt_runs (planning_project_id, last_event_at desc, id);

CREATE INDEX briar_hunt_runs_team_hierarchy_idx
  on briar_hunt_runs (team_id, last_event_at desc, id);

CREATE INDEX briar_issue_key_aliases_run_idx
  on briar_issue_key_aliases (run_id, created_at, team_id);

CREATE INDEX briar_issue_parent_links_parent_idx
  on briar_issue_parent_links (project_id, parent_run_id, created_at);

CREATE INDEX briar_issue_parent_links_child_idx
  on briar_issue_parent_links (project_id, child_run_id, created_at);

CREATE INDEX briar_issue_relations_first_idx
  on briar_issue_relations (project_id, first_run_id, created_at);

CREATE INDEX briar_issue_relations_second_idx
  on briar_issue_relations (project_id, second_run_id, created_at);

CREATE INDEX briar_dm_memory_reply_fences_space on briar_dm_memory_reply_fences(space_id);

CREATE INDEX briar_dm_memory_reply_citations_document on briar_dm_memory_reply_citations(document_id);

CREATE INDEX briar_channel_message_mutation_receipts_scope_idx
  on briar_channel_message_mutation_receipts (
    organization_id, channel_id, user_id, message_id
  );

CREATE INDEX briar_run_evidence_images_evidence_idx
  on briar_run_evidence_images (evidence_id, position, id);

CREATE INDEX briar_run_evidence_images_project_run_idx
  on briar_run_evidence_images (project_id, run_id);

CREATE INDEX briar_issue_create_mutation_receipts_scope_idx
  on briar_issue_create_mutation_receipts (
    organization_id, project_id, user_id, client_issue_id
  );

CREATE INDEX briar_issue_update_mutation_receipts_scope_idx
  on briar_issue_update_mutation_receipts (
    organization_id, project_id, run_id, user_id, request_id
  );

CREATE INDEX briar_issue_message_mutation_receipts_scope_idx
  on briar_issue_message_mutation_receipts (
    organization_id, project_id, run_id, user_id, message_id
  );

CREATE INDEX briar_project_agent_schedules_project_idx
  on briar_project_agent_schedules (project_id, created_at, id);

CREATE INDEX briar_project_agent_schedules_agent_idx
  on briar_project_agent_schedules (agent_id, created_at, id);

CREATE INDEX briar_project_agent_schedules_due_idx
  on briar_project_agent_schedules (project_id, enabled, next_run_at, id);

CREATE INDEX briar_project_agent_schedule_runs_project_idx
  on briar_project_agent_schedule_runs (project_id, scheduled_for desc, id);

CREATE INDEX briar_project_agent_schedule_runs_lease_idx
  on briar_project_agent_schedule_runs (
    project_id, status, lease_expires_at, scheduled_for, id
  );

CREATE UNIQUE INDEX briar_run_pull_requests_full_identity_idx
  on briar_run_pull_requests (
    run_id, attempt, revision, repository_id, pull_request_number,
    pull_request_id, pull_request_node_id
  );

CREATE INDEX briar_run_evidence_pull_requests_link_idx
  on briar_run_evidence_pull_requests (
    run_id, attempt, revision, repository_id, pull_request_number,
    pull_request_id, pull_request_node_id
  );

CREATE INDEX briar_channel_message_attachments_message_idx
  on briar_channel_message_attachments (message_id, created_at, id);

CREATE INDEX briar_channel_message_attachments_channel_idx
  on briar_channel_message_attachments (organization_id, channel_id, message_id);

delete from "briar_run_usage_records";

delete from "briar_run_stage_revisions";

delete from "briar_run_stage_progress";

delete from "briar_run_evidence_pull_requests";

delete from "briar_run_pull_requests";

delete from "briar_run_evidence_images";

delete from "briar_run_evidence";

delete from "briar_run_cost_records";

delete from "briar_run_execution_attempts";

delete from "briar_run_checkpoint_progress";

delete from "briar_project_agent_task_jobs";

delete from "briar_project_agent_schedule_runs";

delete from "briar_project_agent_schedules";

delete from "briar_merge_batch_candidates";

delete from "briar_log_archives";

delete from "briar_issue_update_mutation_receipts";

delete from "briar_issue_subscriptions";

delete from "briar_issue_rework_proposals";

delete from "briar_issue_result_reviews";

delete from "briar_issue_relations";

delete from "briar_issue_parent_links";

delete from "briar_issue_message_mutation_receipts";

delete from "briar_issue_message_mentions";

delete from "briar_issue_key_aliases";

delete from "briar_issue_execution_proposals";

delete from "briar_issue_execution_approval_audit";

delete from "briar_issue_dependencies";

delete from "briar_issue_create_mutation_receipts";

delete from "briar_issue_attachments";

delete from "briar_issue_agent_reply_jobs";

delete from "briar_issue_messages";

delete from "briar_issue_action_proposals";

delete from "briar_hunt_events";

delete from "briar_execution_audit_events";

delete from "briar_dm_memory_reply_fences";

delete from "briar_dm_memory_reply_citations";

delete from "briar_dm_memory_discovered_refs";

delete from "briar_dm_memory_activity_revocations";

delete from "briar_channel_thread_subscriptions";

delete from "briar_channel_reply_session_events";

delete from "briar_channel_reply_lookups";

delete from "briar_channel_notification_inbox";

delete from "briar_channel_message_reactions";

delete from "briar_channel_message_mutation_receipts";

delete from "briar_channel_message_mentions";

delete from "briar_channel_message_documents";

delete from "briar_channel_message_attachments";

delete from "briar_channel_message_agent_mentions";

delete from "briar_channel_agents";

delete from "briar_channel_agent_reply_jobs";

delete from "briar_channel_reply_sessions";

delete from "briar_channel_messages";

delete from "briar_channel_action_proposals";

delete from "briar_agent_worklog_entries";

delete from "briar_agent_transcripts";

delete from "briar_agent_transcript_segments";

delete from "briar_agent_transcript_sessions";

delete from "briar_hunt_runs";

delete from "briar_agent_skills";

delete from "briar_project_agents";

delete from "briar_agent_skill_execution_proposals";

delete from "briar_agent_skill_execution_approval_audit";

insert into "briar_agent_skill_execution_approval_audit" select * from "briar_provider_backup_agent_skill_execution_approval_audit";

insert into "briar_agent_skill_execution_proposals" select * from "briar_provider_backup_agent_skill_execution_proposals";

insert into "briar_project_agents" select * from "briar_provider_backup_project_agents";

insert into "briar_agent_skills" select * from "briar_provider_backup_agent_skills";

insert into "briar_hunt_runs" select * from "briar_provider_backup_hunt_runs";

insert into "briar_agent_transcript_sessions" select * from "briar_provider_backup_agent_transcript_sessions";

insert into "briar_agent_transcript_segments" select * from "briar_provider_backup_agent_transcript_segments";

insert into "briar_agent_transcripts" select * from "briar_provider_backup_agent_transcripts";

insert into "briar_agent_worklog_entries" select * from "briar_provider_backup_agent_worklog_entries";

insert into "briar_channel_action_proposals" select * from "briar_provider_backup_channel_action_proposals";

insert into "briar_channel_messages" select * from "briar_provider_backup_channel_messages";

insert into "briar_channel_reply_sessions" select * from "briar_provider_backup_channel_reply_sessions";

insert into "briar_channel_agent_reply_jobs" select * from "briar_provider_backup_channel_agent_reply_jobs";

insert into "briar_channel_agents" select * from "briar_provider_backup_channel_agents";

insert into "briar_channel_message_agent_mentions" select * from "briar_provider_backup_channel_message_agent_mentions";

insert into "briar_channel_message_attachments" select * from "briar_provider_backup_channel_message_attachments";

insert into "briar_channel_message_documents" select * from "briar_provider_backup_channel_message_documents";

insert into "briar_channel_message_mentions" select * from "briar_provider_backup_channel_message_mentions";

insert into "briar_channel_message_mutation_receipts" select * from "briar_provider_backup_channel_message_mutation_receipts";

insert into "briar_channel_message_reactions" select * from "briar_provider_backup_channel_message_reactions";

insert into "briar_channel_notification_inbox" select * from "briar_provider_backup_channel_notification_inbox";

insert into "briar_channel_reply_lookups" select * from "briar_provider_backup_channel_reply_lookups";

insert into "briar_channel_reply_session_events" select * from "briar_provider_backup_channel_reply_session_events";

insert into "briar_channel_thread_subscriptions" select * from "briar_provider_backup_channel_thread_subscriptions";

insert into "briar_dm_memory_activity_revocations" select * from "briar_provider_backup_dm_memory_activity_revocations";

insert into "briar_dm_memory_discovered_refs" select * from "briar_provider_backup_dm_memory_discovered_refs";

insert into "briar_dm_memory_reply_citations" select * from "briar_provider_backup_dm_memory_reply_citations";

insert into "briar_dm_memory_reply_fences" select * from "briar_provider_backup_dm_memory_reply_fences";

insert into "briar_execution_audit_events" select * from "briar_provider_backup_execution_audit_events";

insert into "briar_hunt_events" select * from "briar_provider_backup_hunt_events";

insert into "briar_issue_action_proposals" select * from "briar_provider_backup_issue_action_proposals";

insert into "briar_issue_messages" select * from "briar_provider_backup_issue_messages";

insert into "briar_issue_agent_reply_jobs" select * from "briar_provider_backup_issue_agent_reply_jobs";

insert into "briar_issue_attachments" select * from "briar_provider_backup_issue_attachments";

insert into "briar_issue_create_mutation_receipts" select * from "briar_provider_backup_issue_create_mutation_receipts";

insert into "briar_issue_dependencies" select * from "briar_provider_backup_issue_dependencies";

insert into "briar_issue_execution_approval_audit" select * from "briar_provider_backup_issue_execution_approval_audit";

insert into "briar_issue_execution_proposals" select * from "briar_provider_backup_issue_execution_proposals";

insert into "briar_issue_key_aliases" select * from "briar_provider_backup_issue_key_aliases";

insert into "briar_issue_message_mentions" select * from "briar_provider_backup_issue_message_mentions";

insert into "briar_issue_message_mutation_receipts" select * from "briar_provider_backup_issue_message_mutation_receipts";

insert into "briar_issue_parent_links" select * from "briar_provider_backup_issue_parent_links";

insert into "briar_issue_relations" select * from "briar_provider_backup_issue_relations";

insert into "briar_issue_result_reviews" select * from "briar_provider_backup_issue_result_reviews";

insert into "briar_issue_rework_proposals" select * from "briar_provider_backup_issue_rework_proposals";

insert into "briar_issue_subscriptions" select * from "briar_provider_backup_issue_subscriptions";

insert into "briar_issue_update_mutation_receipts" select * from "briar_provider_backup_issue_update_mutation_receipts";

insert into "briar_log_archives" select * from "briar_provider_backup_log_archives";

insert into "briar_merge_batch_candidates" select * from "briar_provider_backup_merge_batch_candidates";

insert into "briar_project_agent_schedules" select * from "briar_provider_backup_project_agent_schedules";

insert into "briar_project_agent_schedule_runs" select * from "briar_provider_backup_project_agent_schedule_runs";

insert into "briar_project_agent_task_jobs" select * from "briar_provider_backup_project_agent_task_jobs";

insert into "briar_run_checkpoint_progress" select * from "briar_provider_backup_run_checkpoint_progress";

insert into "briar_run_execution_attempts" select * from "briar_provider_backup_run_execution_attempts";

insert into "briar_run_cost_records" select * from "briar_provider_backup_run_cost_records";

insert into "briar_run_evidence" select * from "briar_provider_backup_run_evidence";

insert into "briar_run_evidence_images" select * from "briar_provider_backup_run_evidence_images";

insert into "briar_run_pull_requests" select * from "briar_provider_backup_run_pull_requests";

insert into "briar_run_evidence_pull_requests" select * from "briar_provider_backup_run_evidence_pull_requests";

insert into "briar_run_stage_progress" select * from "briar_provider_backup_run_stage_progress";

insert into "briar_run_stage_revisions" select * from "briar_provider_backup_run_stage_revisions";

insert into "briar_run_usage_records" select * from "briar_provider_backup_run_usage_records";

drop table "briar_provider_backup_run_usage_records";

drop table "briar_provider_backup_run_stage_revisions";

drop table "briar_provider_backup_run_stage_progress";

drop table "briar_provider_backup_run_evidence_pull_requests";

drop table "briar_provider_backup_run_pull_requests";

drop table "briar_provider_backup_run_evidence_images";

drop table "briar_provider_backup_run_evidence";

drop table "briar_provider_backup_run_cost_records";

drop table "briar_provider_backup_run_execution_attempts";

drop table "briar_provider_backup_run_checkpoint_progress";

drop table "briar_provider_backup_project_agent_task_jobs";

drop table "briar_provider_backup_project_agent_schedule_runs";

drop table "briar_provider_backup_project_agent_schedules";

drop table "briar_provider_backup_merge_batch_candidates";

drop table "briar_provider_backup_log_archives";

drop table "briar_provider_backup_issue_update_mutation_receipts";

drop table "briar_provider_backup_issue_subscriptions";

drop table "briar_provider_backup_issue_rework_proposals";

drop table "briar_provider_backup_issue_result_reviews";

drop table "briar_provider_backup_issue_relations";

drop table "briar_provider_backup_issue_parent_links";

drop table "briar_provider_backup_issue_message_mutation_receipts";

drop table "briar_provider_backup_issue_message_mentions";

drop table "briar_provider_backup_issue_key_aliases";

drop table "briar_provider_backup_issue_execution_proposals";

drop table "briar_provider_backup_issue_execution_approval_audit";

drop table "briar_provider_backup_issue_dependencies";

drop table "briar_provider_backup_issue_create_mutation_receipts";

drop table "briar_provider_backup_issue_attachments";

drop table "briar_provider_backup_issue_agent_reply_jobs";

drop table "briar_provider_backup_issue_messages";

drop table "briar_provider_backup_issue_action_proposals";

drop table "briar_provider_backup_hunt_events";

drop table "briar_provider_backup_execution_audit_events";

drop table "briar_provider_backup_dm_memory_reply_fences";

drop table "briar_provider_backup_dm_memory_reply_citations";

drop table "briar_provider_backup_dm_memory_discovered_refs";

drop table "briar_provider_backup_dm_memory_activity_revocations";

drop table "briar_provider_backup_channel_thread_subscriptions";

drop table "briar_provider_backup_channel_reply_session_events";

drop table "briar_provider_backup_channel_reply_lookups";

drop table "briar_provider_backup_channel_notification_inbox";

drop table "briar_provider_backup_channel_message_reactions";

drop table "briar_provider_backup_channel_message_mutation_receipts";

drop table "briar_provider_backup_channel_message_mentions";

drop table "briar_provider_backup_channel_message_documents";

drop table "briar_provider_backup_channel_message_attachments";

drop table "briar_provider_backup_channel_message_agent_mentions";

drop table "briar_provider_backup_channel_agents";

drop table "briar_provider_backup_channel_agent_reply_jobs";

drop table "briar_provider_backup_channel_reply_sessions";

drop table "briar_provider_backup_channel_messages";

drop table "briar_provider_backup_channel_action_proposals";

drop table "briar_provider_backup_agent_worklog_entries";

drop table "briar_provider_backup_agent_transcripts";

drop table "briar_provider_backup_agent_transcript_segments";

drop table "briar_provider_backup_agent_transcript_sessions";

drop table "briar_provider_backup_hunt_runs";

drop table "briar_provider_backup_agent_skills";

drop table "briar_provider_backup_project_agents";

drop table "briar_provider_backup_agent_skill_execution_proposals";

drop table "briar_provider_backup_agent_skill_execution_approval_audit";

CREATE VIEW briar_execution_worker_healthy_providers as
select worker.id as worker_id,
       case json_extract(health.value, '$.provider')
         when 'AGENT_PROVIDER_CODEX' then 'codex'
         when 'AGENT_PROVIDER_CLAUDE' then 'claude'
         when 'AGENT_PROVIDER_CURSOR' then 'cursor'
         when 'AGENT_PROVIDER_GROK' then 'grok'
         when 'AGENT_PROVIDER_AGY' then 'agy'
         when 'AGENT_PROVIDER_OPENCODE' then 'opencode'
         when 'AGENT_PROVIDER_OPENROUTER' then 'openrouter'
         when 'AGENT_PROVIDER_VERTEX' then 'vertex'
       end as provider,
       case json_extract(worker.runtime_proto_json, '$.agentProvider')
         when 'AGENT_PROVIDER_CODEX' then 'codex'
         when 'AGENT_PROVIDER_CLAUDE' then 'claude'
         when 'AGENT_PROVIDER_CURSOR' then 'cursor'
         when 'AGENT_PROVIDER_GROK' then 'grok'
         when 'AGENT_PROVIDER_AGY' then 'agy'
         when 'AGENT_PROVIDER_OPENCODE' then 'opencode'
         when 'AGENT_PROVIDER_OPENROUTER' then 'openrouter'
         when 'AGENT_PROVIDER_VERTEX' then 'vertex'
       end as agent_provider
from briar_execution_workers worker,
     json_each(worker.runtime_proto_json, '$.providerHealth') health
where json_extract(health.value, '$.healthy') = 1
  and json_extract(health.value, '$.provider') in (
    'AGENT_PROVIDER_CODEX', 'AGENT_PROVIDER_CLAUDE',
    'AGENT_PROVIDER_CURSOR', 'AGENT_PROVIDER_GROK', 'AGENT_PROVIDER_AGY',
    'AGENT_PROVIDER_OPENCODE', 'AGENT_PROVIDER_OPENROUTER', 'AGENT_PROVIDER_VERTEX'
  );

CREATE VIEW briar_invalid_execution_worker_runtime as
select worker.id
from briar_execution_workers worker
where not (
  json_valid(worker.runtime_proto_json)
  and json_type(worker.runtime_proto_json) = 'object'
  and length(cast(worker.runtime_proto_json as blob)) <= 1048576
  and json_extract(worker.runtime_proto_json, '$.agentProvider') in (
    'AGENT_PROVIDER_CODEX', 'AGENT_PROVIDER_CLAUDE',
    'AGENT_PROVIDER_CURSOR', 'AGENT_PROVIDER_GROK', 'AGENT_PROVIDER_AGY',
    'AGENT_PROVIDER_OPENCODE', 'AGENT_PROVIDER_OPENROUTER', 'AGENT_PROVIDER_VERTEX'
  )
  and json_type(worker.runtime_proto_json, '$.providerHealth') = 'array'
  and json_array_length(worker.runtime_proto_json, '$.providerHealth') = 8
  and (
    select count(distinct json_extract(health.value, '$.provider'))
    from json_each(worker.runtime_proto_json, '$.providerHealth') health
    where health.type = 'object'
      and json_extract(health.value, '$.provider') in (
        'AGENT_PROVIDER_CODEX', 'AGENT_PROVIDER_CLAUDE',
        'AGENT_PROVIDER_CURSOR', 'AGENT_PROVIDER_GROK', 'AGENT_PROVIDER_AGY',
        'AGENT_PROVIDER_OPENCODE', 'AGENT_PROVIDER_OPENROUTER', 'AGENT_PROVIDER_VERTEX'
      )
  ) = 8
  and json_type(worker.runtime_proto_json, '$.capabilities') = 'object'
  and json_type(
    worker.runtime_proto_json, '$.capabilities.providerCapabilities'
  ) = 'array'
  and json_array_length(
    worker.runtime_proto_json, '$.capabilities.providerCapabilities'
  ) = 8
  and (
    select count(distinct json_extract(capability.value, '$.provider'))
    from json_each(
      worker.runtime_proto_json, '$.capabilities.providerCapabilities'
    ) capability
    where capability.type = 'object'
      and json_extract(capability.value, '$.provider') in (
        'AGENT_PROVIDER_CODEX', 'AGENT_PROVIDER_CLAUDE',
        'AGENT_PROVIDER_CURSOR', 'AGENT_PROVIDER_GROK', 'AGENT_PROVIDER_AGY',
        'AGENT_PROVIDER_OPENCODE', 'AGENT_PROVIDER_OPENROUTER', 'AGENT_PROVIDER_VERTEX'
      )
  ) = 8
  and (
    json_type(worker.runtime_proto_json, '$.versions') is null
    or json_type(worker.runtime_proto_json, '$.versions') = 'object'
  )
);

CREATE TRIGGER briar_dashboard_settings_update_sync
after update on briar_project_settings BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'metadata', new.project_id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_projects_update_sync
after update on briar_projects BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.id, 'metadata', new.id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_channel_changes_channels_insert_sync
after insert on briar_channels BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.id, 'channel', new.id, 'upsert', datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_channel_changes_channels_delete_sync
after delete on briar_channels BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    old.organization_id, old.id, 'channel', old.id, 'delete', datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (old.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  values (old.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = old.organization_id
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = old.organization_id
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_project_settings_workflow_v2_insert
before insert on briar_project_settings
when not (
  json_valid(new.workflow_json)
  and json_extract(new.workflow_json, '$.version') = 2
  and json_type(new.workflow_json, '$.execution.checkpoints') = 'array'
  and not exists (
    select 1 from json_each(new.workflow_json, '$.execution') field
    where field.key <> 'checkpoints'
  )
  and new.mandatory_checkpoints_json is not null
  and json_valid(new.mandatory_checkpoints_json)
  and json_type(new.mandatory_checkpoints_json) = 'array'
  and not exists (
    select 1 from json_each(new.workflow_json, '$.execution.checkpoints') checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
  )
  and not exists (
    select 1 from json_each(new.mandatory_checkpoints_json) checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
  )
)
begin
  select raise(abort, 'project workflow must use canonical v2 checkpoints');
END;

CREATE TRIGGER briar_project_settings_workflow_v2_update
before update of workflow_json, mandatory_checkpoints_json on briar_project_settings
when not (
  json_valid(new.workflow_json)
  and json_extract(new.workflow_json, '$.version') = 2
  and json_type(new.workflow_json, '$.execution.checkpoints') = 'array'
  and not exists (
    select 1 from json_each(new.workflow_json, '$.execution') field
    where field.key <> 'checkpoints'
  )
  and new.mandatory_checkpoints_json is not null
  and json_valid(new.mandatory_checkpoints_json)
  and json_type(new.mandatory_checkpoints_json) = 'array'
  and not exists (
    select 1 from json_each(new.workflow_json, '$.execution.checkpoints') checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
  )
  and not exists (
    select 1 from json_each(new.mandatory_checkpoints_json) checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
  )
)
begin
  select raise(abort, 'project workflow must use canonical v2 checkpoints');
END;

CREATE TRIGGER briar_channel_issue_approval_audit_immutable_update
before update on briar_channel_issue_approval_audit
when not (
  old.approved_by_user_id is not null
  and new.approved_by_user_id is null
  and new.id is old.id
  and new.proposal_id is old.proposal_id
  and new.organization_id is old.organization_id
  and new.channel_id is old.channel_id
  and new.project_id is old.project_id
  and new.run_id is old.run_id
  and new.approved_at is old.approved_at
  and new.issue_source_key is old.issue_source_key
  and new.result_verification is old.result_verification
  and new.payload_json is old.payload_json
  and new.created_at is old.created_at
)
BEGIN
  select raise(abort, 'channel issue approval audit is immutable');
END;

CREATE TRIGGER briar_project_agent_task_completion_receipt_immutable_update
before update on briar_project_agent_task_completion_receipts
BEGIN
  select raise(abort, 'project Agent task completion receipt is immutable');
END;

CREATE TRIGGER briar_project_agent_task_completion_receipt_immutable_delete
before delete on briar_project_agent_task_completion_receipts
when exists (
  select 1 from briar_organizations organization
  where organization.id = old.organization_id
)
BEGIN
  select raise(abort, 'project Agent task completion receipt is immutable');
END;

CREATE TRIGGER briar_project_agent_session_summaries_insert_sync
after insert on briar_project_agent_session_summaries BEGIN
  insert into briar_project_agent_session_changes (
    project_id, session_id, operation, created_at
  ) values (new.project_id, new.session_id, 'upsert', datetime('now'));
  insert into briar_project_agent_session_sync_state (
    project_id, current_version
  ) values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set
    current_version = excluded.current_version;
END;

CREATE TRIGGER briar_project_agent_session_summaries_update_sync
after update on briar_project_agent_session_summaries BEGIN
  insert into briar_project_agent_session_changes (
    project_id, session_id, operation, created_at
  ) values (new.project_id, new.session_id, 'upsert', datetime('now'));
  insert into briar_project_agent_session_sync_state (
    project_id, current_version
  ) values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set
    current_version = excluded.current_version;
END;

CREATE TRIGGER briar_project_agent_session_summaries_delete_sync
after delete on briar_project_agent_session_summaries
when exists (
  select 1 from briar_projects where id = old.project_id
) BEGIN
  insert into briar_project_agent_session_changes (
    project_id, session_id, operation, created_at
  ) values (old.project_id, old.session_id, 'delete', datetime('now'));
  insert into briar_project_agent_session_sync_state (
    project_id, current_version
  ) values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set
    current_version = excluded.current_version;
END;

CREATE TRIGGER briar_inbox_organizations_delete_sync
after delete on briar_organizations BEGIN
  delete from briar_organization_inbox_sync_state
  where organization_id = old.id;
END;

CREATE TRIGGER briar_inbox_projects_insert_sync
after insert on briar_projects BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  ) values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_inbox_projects_delete_sync
before delete on briar_projects BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  ) values (old.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = old.organization_id
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = old.organization_id
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_inbox_dashboard_state_insert_sync
after insert on briar_dashboard_sync_state BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select project.organization_id, 1
  from briar_projects project
  where project.id = new.project_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select project.organization_id
    from briar_projects project
    where project.id = new.project_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select project.organization_id
    from briar_projects project
    where project.id = new.project_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_inbox_dashboard_state_update_sync
after update of current_version on briar_dashboard_sync_state
when new.current_version <> old.current_version BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select project.organization_id, 1
  from briar_projects project
  where project.id = new.project_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select project.organization_id
    from briar_projects project
    where project.id = new.project_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select project.organization_id
    from briar_projects project
    where project.id = new.project_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_inbox_agent_session_state_insert_sync
after insert on briar_project_agent_session_sync_state BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select project.organization_id, 1
  from briar_projects project
  where project.id = new.project_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select project.organization_id
    from briar_projects project
    where project.id = new.project_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select project.organization_id
    from briar_projects project
    where project.id = new.project_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_inbox_agent_session_state_update_sync
after update of current_version on briar_project_agent_session_sync_state
when new.current_version <> old.current_version BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select project.organization_id, 1
  from briar_projects project
  where project.id = new.project_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select project.organization_id
    from briar_projects project
    where project.id = new.project_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select project.organization_id
    from briar_projects project
    where project.id = new.project_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_inbox_channel_members_insert_sync
after insert on briar_channel_members BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channels channel
  where channel.id = new.channel_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel
    where channel.id = new.channel_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel
    where channel.id = new.channel_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_inbox_channel_members_delete_sync
before delete on briar_channel_members BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channels channel
  where channel.id = old.channel_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel
    where channel.id = old.channel_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel
    where channel.id = old.channel_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_inbox_user_name_update_sync
after update of name on "user"
when new.name <> old.name BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select membership.organization_id, 1
  from briar_organization_members membership
  where membership.user_id = new.id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select membership.organization_id
    from briar_organization_members membership
    where membership.user_id = new.id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select membership.organization_id
    from briar_organization_members membership
    where membership.user_id = new.id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_inbox_realtime_state_delete
after delete on briar_organization_inbox_sync_state BEGIN
  delete from briar_organization_inbox_realtime_outbox
  where organization_id = old.organization_id;
END;

CREATE TRIGGER briar_dashboard_worker_policy_insert_sync
after insert on briar_project_execution_worker_policies BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'metadata', new.project_id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_worker_policy_update_sync
after update on briar_project_execution_worker_policies BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'metadata', new.project_id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_worker_allowlist_insert_sync
after insert on briar_project_execution_worker_allowlist BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'metadata', new.project_id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_worker_allowlist_delete_sync
after delete on briar_project_execution_worker_allowlist BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'metadata', old.project_id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_dependencies_insert_sync
after insert on briar_issue_dependencies BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (new.project_id, 'run', new.prerequisite_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.dependent_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_dependencies_delete_sync
before delete on briar_issue_dependencies BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (old.project_id, 'run', old.prerequisite_run_id, 'upsert', datetime('now')),
    (old.project_id, 'run', old.dependent_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_messages_insert_sync
after insert on briar_issue_messages BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'notifications', new.id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_messages_update_sync
after update on briar_issue_messages BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'notifications', new.id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_messages_delete_sync
before delete on briar_issue_messages BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'notifications', old.id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_workers_insert_sync
after insert on briar_execution_workers BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'worker', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_workers_delete_sync
before delete on briar_execution_workers BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'worker', old.id, 'delete', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_events_insert_sync
after insert on briar_hunt_events BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'run', new.run_id, 'upsert', datetime('now')
    from briar_hunt_runs where id = new.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, last_insert_rowid() from briar_hunt_runs where id = new.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_events_update_sync
after update on briar_hunt_events BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'run', new.run_id, 'upsert', datetime('now')
    from briar_hunt_runs where id = new.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, last_insert_rowid() from briar_hunt_runs where id = new.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_events_delete_sync
after delete on briar_hunt_events BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'run', old.run_id, 'upsert', datetime('now')
    from briar_hunt_runs where id = old.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, last_insert_rowid() from briar_hunt_runs where id = old.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_mentions_insert_sync
after insert on briar_issue_message_mentions BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select message.project_id, 'notifications', new.message_id, 'replace', datetime('now')
    from briar_issue_messages message where message.id = new.message_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select message.project_id, last_insert_rowid()
    from briar_issue_messages message where message.id = new.message_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_mentions_delete_sync
after delete on briar_issue_message_mentions BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select message.project_id, 'notifications', old.message_id, 'replace', datetime('now')
    from briar_issue_messages message where message.id = old.message_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select message.project_id, last_insert_rowid()
    from briar_issue_messages message where message.id = old.message_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_hunt_events_increment_run_event_count
after insert on briar_hunt_events BEGIN
  update briar_hunt_runs
  set event_count = event_count + 1
  where id = new.run_id;
END;

CREATE TRIGGER briar_hunt_events_decrement_run_event_count
after delete on briar_hunt_events BEGIN
  update briar_hunt_runs
  set event_count = max(event_count - 1, 0)
  where id = old.run_id;
END;

CREATE TRIGGER briar_issue_result_reviews_insert_sync
after insert on briar_issue_result_reviews BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'run', new.run_id, 'upsert', datetime('now')
      from briar_hunt_runs where id = new.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, last_insert_rowid()
    from briar_hunt_runs where id = new.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_issue_result_reviews_delete_sync
after delete on briar_issue_result_reviews BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'run', old.run_id, 'upsert', datetime('now')
      from briar_hunt_runs where id = old.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, last_insert_rowid()
    from briar_hunt_runs where id = old.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_worker_devices_update_sync
after update on briar_execution_worker_devices
when old.organization_id is not new.organization_id
  or old.owner_user_id is not new.owner_user_id
  or old.label is not new.label
  or old.device_identity_hash is not new.device_identity_hash
  or old.state is not new.state
  or old.max_concurrent_sessions is not new.max_concurrent_sessions
  or old.icon_type is not new.icon_type
  or old.icon_value is not new.icon_value
BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'worker', id, 'upsert', datetime('now')
    from briar_execution_workers where device_id = new.id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select worker.project_id, (
      select change.version
        from briar_dashboard_changes change
       where change.project_id = worker.project_id
       order by change.version desc
       limit 1
    )
    from briar_execution_workers worker
   where worker.device_id = new.id
  on conflict (project_id) do update set current_version =
    max(briar_dashboard_sync_state.current_version, excluded.current_version);
END;

CREATE TRIGGER briar_quarantined_transcript_session_project_guard
before update of project_id, run_id on briar_agent_transcript_sessions
when (new.project_id <> old.project_id or new.run_id is not old.run_id)
  and exists (
    select 1 from briar_channel_issue_transfer_quarantine quarantine
    where quarantine.entity_kind = 'agent_transcript_session'
      and quarantine.entity_id = old.session_id
  )
BEGIN
  select raise(abort, 'quarantined transcript ownership is immutable');
END;

CREATE TRIGGER briar_quarantined_transcript_archive_project_guard
before update of project_id on briar_log_archives
when new.project_id <> old.project_id
  and exists (
    select 1 from briar_channel_issue_transfer_quarantine quarantine
    where quarantine.entity_kind = 'agent_transcript_archive'
      and quarantine.entity_id = old.id
  )
BEGIN
  select raise(abort, 'quarantined transcript ownership is immutable');
END;

CREATE TRIGGER briar_mismatched_transcript_archive_quarantine
after insert on briar_log_archives
when new.archive_kind = 'agent_transcript'
  and new.run_id is not null
  and exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id <> new.project_id
  )
BEGIN
  insert into briar_channel_issue_transfer_quarantine (
    entity_kind, entity_id, run_id, source_project_id, target_project_id,
    reason, detected_at
  )
  select 'agent_transcript_archive', new.id, new.run_id, new.project_id,
         run.project_id, 'unverified_transcript_ownership', datetime('now')
  from briar_hunt_runs run where run.id = new.run_id
  on conflict (entity_kind, entity_id) do nothing;

  insert into briar_channel_issue_transfer_quarantine (
    entity_kind, entity_id, run_id, source_project_id, target_project_id,
    reason, detected_at
  )
  select 'agent_transcript_session', new.scope_id, new.run_id, new.project_id,
         run.project_id, 'unverified_transcript_ownership', datetime('now')
  from briar_hunt_runs run where run.id = new.run_id
  on conflict (entity_kind, entity_id) do nothing;

  update briar_log_archives
  set status = 'failed',
      failure_count = failure_count + 1,
      last_error = 'Transcript archive ownership requires remediation'
  where id = new.id and status in ('verified', 'complete');
END;

CREATE TRIGGER briar_mismatched_transcript_archive_verify_guard
before update of status on briar_log_archives
when new.archive_kind = 'agent_transcript'
  and new.status in ('verified', 'complete')
  and new.run_id is not null
  and exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id <> new.project_id
  )
BEGIN
  select raise(abort, 'transcript archive ownership requires remediation');
END;

CREATE TRIGGER briar_mismatched_run_archive_insert_guard
before insert on briar_log_archives
when new.archive_kind not in ('execution_audit', 'agent_transcript')
  and new.run_id is not null
  and not exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id = new.project_id
  )
BEGIN
  select raise(abort, 'run archive project does not match current run');
END;

CREATE TRIGGER briar_transcript_session_run_insert_guard
before insert on briar_agent_transcript_sessions
when new.run_id is not null
  and not exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id = new.project_id
  )
BEGIN
  select raise(abort, 'transcript run does not belong to project');
END;

CREATE TRIGGER briar_transcript_session_run_update_guard
before update of run_id, project_id on briar_agent_transcript_sessions
when new.run_id is not null
  and not exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id = new.project_id
  )
  and not exists (
    select 1 from briar_channel_issue_transfer_quarantine quarantine
    where quarantine.entity_kind = 'agent_transcript_session'
      and quarantine.entity_id = old.session_id
  )
BEGIN
  select raise(abort, 'transcript run does not belong to project');
END;

CREATE TRIGGER briar_conversation_issue_creation_finalize_guard
before update of status on briar_issue_action_proposals
when old.status = 'pending'
  and new.status = 'accepted'
  and old.action_type = 'request_issue_create'
  and not (
    old.approval_reserved_by_user_id is not null
    and old.approval_reserved_at is not null
    and old.issue_source_key is not null
    and new.approval_reserved_by_user_id is
      old.approval_reserved_by_user_id
    and new.approval_reserved_at is old.approval_reserved_at
    and new.issue_source_key is old.issue_source_key
    and new.accepted_by_user_id is old.approval_reserved_by_user_id
    and new.accepted_at = old.approval_reserved_at
    and new.result_run_id is not null
    and exists (
      select 1
      from briar_hunt_runs conversation
      where conversation.id = old.conversation_run_id
        and conversation.project_id = old.project_id
    )
    and exists (
      select 1
      from briar_hunt_runs result
      where result.id = new.result_run_id
        and result.project_id = old.project_id
        and result.source = 'issue'
        and result.source_key = old.issue_source_key
        and result.status = 'backlog' and result.stage = 'queued'
        and result.workflow_stage is null
        and result.worker_id is null
        and result.agent_id is null
        and result.requested_worker_id is null
        and result.claim_token_hash is null
        and result.claimed_by is null and result.claimed_at is null
        and result.lease_expires_at is null
        and result.last_execution_id is null
        and result.dispatch_mode is null
        and result.dispatch_request_id is null
        and result.dispatched_at is null
        and result.requested_by_user_id is null
        and result.requested_agent_provider is null
        and result.requested_agent_model is null
        and result.requested_agent_effort is null
        and result.completed_at is null
        and result.paused_at is null
        and result.resume_requested_at is null
    )
  )
BEGIN
  select raise(abort, 'conversation proposal acceptance requires reservation');
END;

CREATE TRIGGER briar_conversation_issue_reservation_immutable
before update of approval_reserved_by_user_id, approval_reserved_at,
                 issue_source_key
on briar_issue_action_proposals
when old.action_type = 'request_issue_create'
  and old.issue_source_key is not null
  and not (
    new.issue_source_key is old.issue_source_key
    and (
      (
        new.approval_reserved_at is old.approval_reserved_at
        and (
          new.approval_reserved_by_user_id is
            old.approval_reserved_by_user_id
          or (
            old.approval_reserved_by_user_id is not null
            and new.approval_reserved_by_user_id is null
          )
        )
      )
      or (
        old.approval_reserved_by_user_id is null
        and new.approval_reserved_by_user_id is not null
        and new.approval_reserved_at is not null
      )
    )
  )
BEGIN
  select raise(abort, 'conversation proposal reservation is immutable');
END;

CREATE TRIGGER briar_conversation_issue_approval_audit_insert
after update of status on briar_issue_action_proposals
when old.status = 'pending'
  and new.status = 'accepted'
  and old.action_type = 'request_issue_create'
BEGIN
  insert into briar_channel_issue_approval_audit (
    id, proposal_id, organization_id, channel_id, project_id, run_id,
    approved_by_user_id, approved_at, issue_source_key, result_verification,
    payload_json, created_at
  )
  select old.id || ':conversation-approval:' || new.result_run_id,
         old.id, project.organization_id,
         'conversation:' || old.conversation_run_id,
         old.project_id, new.result_run_id, new.accepted_by_user_id,
         new.accepted_at, old.issue_source_key, 'atomic', old.payload_json,
         new.accepted_at
  from briar_projects project where project.id = old.project_id
  on conflict (id) do nothing;
END;

CREATE TRIGGER briar_channel_changes_proposals_insert_sync
after insert on briar_channel_action_proposals BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, new.channel_id, 'proposal', new.id,
           'upsert', datetime('now')
    from briar_channels channel where channel.id = new.channel_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channels channel where channel.id = new.channel_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channels channel where channel.id = new.channel_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel where channel.id = new.channel_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel where channel.id = new.channel_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_channel_changes_proposals_update_sync
after update on briar_channel_action_proposals BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, new.channel_id, 'proposal', new.id,
           'upsert', datetime('now')
    from briar_channels channel where channel.id = new.channel_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channels channel where channel.id = new.channel_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channels channel where channel.id = new.channel_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel where channel.id = new.channel_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel where channel.id = new.channel_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_channel_create_execution_intent_insert_guard
before insert on briar_channel_action_proposals
when not (
  (new.execute_after_create = 0 and new.execution_proposal_id is null)
  or (
    new.execute_after_create = 1
    and new.execution_proposal_id is not null
    and new.action_type = 'request_issue_create'
    and new.status = 'pending'
  )
)
BEGIN
  select raise(abort, 'invalid channel create execution intent');
END;

CREATE TRIGGER briar_issue_create_execution_intent_insert_guard
before insert on briar_issue_action_proposals
when not (
  (new.execute_after_create = 0 and new.execution_proposal_id is null)
  or (
    new.execute_after_create = 1
    and new.execution_proposal_id is not null
    and new.action_type = 'request_issue_create'
    and new.status = 'pending'
  )
)
BEGIN
  select raise(abort, 'invalid issue create execution intent');
END;

CREATE TRIGGER briar_issue_execution_organization_delete_invalidate
before delete on briar_organizations
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where organization_id = old.id and status <> 'invalidated';
END;

CREATE TRIGGER briar_issue_execution_project_delete_invalidate
before delete on briar_projects
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where project_id = old.id and status <> 'invalidated';
END;

CREATE TRIGGER briar_issue_execution_channel_delete_invalidate
before delete on briar_channels
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and channel_id = old.id
    and status <> 'invalidated';
END;

CREATE TRIGGER briar_issue_execution_channel_archive_invalidate
after update of archived_at on briar_channels
when old.archived_at is null and new.archived_at is not null
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'channel' and channel_id = new.id
    and status = 'pending';
END;

CREATE TRIGGER briar_issue_execution_channel_private_invalidate
after update of visibility on briar_channels
when old.visibility = 'public' and new.visibility = 'private'
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'channel' and channel_id = new.id
    and status = 'pending'
    and approval_reserved_by_user_id is not null
    and not exists (
      select 1 from briar_channel_members member
      where member.channel_id = new.id
        and member.user_id = approval_reserved_by_user_id
    );
END;

CREATE TRIGGER briar_issue_execution_private_member_remove_invalidate
after delete on briar_channel_members
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and channel_id = old.channel_id
    and status = 'pending'
    and approval_reserved_by_user_id = old.user_id
    and exists (
      select 1 from briar_channels channel
      where channel.id = old.channel_id and channel.visibility = 'private'
    );
END;

CREATE TRIGGER briar_issue_execution_worker_delete_run_reset
before delete on briar_execution_workers
BEGIN
  update briar_hunt_runs
  set status = 'backlog', stage = 'queued', workflow_stage = null,
      agent_id = null, worker_id = null, requested_worker_id = null,
      claim_token_hash = null, claimed_by = null, claimed_at = null,
      lease_expires_at = null, claim_attempts = 0, last_execution_id = null,
      dispatch_mode = null, dispatch_request_id = null, dispatched_at = null,
      requested_by_user_id = null, requested_agent_provider = null,
      requested_agent_model = null, requested_agent_effort = null,
      paused_at = null, resume_requested_at = null, completed_at = null,
      detail = '승인에서 선택한 Worker가 삭제되어 새 실행 승인이 필요합니다.',
      updated_at = datetime('now'), last_event_at = datetime('now')
  where status in ('queued', 'blocked', 'failed')
    and dispatch_request_id is not null
    and (
      exists (
        select 1 from briar_issue_execution_proposals proposal
        where proposal.target_run_id = briar_hunt_runs.id
          and proposal.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and proposal.requested_worker_id = old.id
      )
      or exists (
        select 1 from briar_issue_execution_approval_audit approval
        where approval.run_id = briar_hunt_runs.id
          and approval.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and approval.worker_id = old.id
      )
    );
END;

CREATE TRIGGER briar_issue_execution_approver_delete_run_reset
before delete on "user"
BEGIN
  update briar_hunt_runs
  set status = 'backlog', stage = 'queued', workflow_stage = null,
      agent_id = null, worker_id = null, requested_worker_id = null,
      claim_token_hash = null, claimed_by = null, claimed_at = null,
      lease_expires_at = null, claim_attempts = 0, last_execution_id = null,
      dispatch_mode = null, dispatch_request_id = null, dispatched_at = null,
      requested_by_user_id = null, requested_agent_provider = null,
      requested_agent_model = null, requested_agent_effort = null,
      paused_at = null, resume_requested_at = null, completed_at = null,
      detail = '실행 승인 계정이 삭제되어 새 실행 승인이 필요합니다.',
      updated_at = datetime('now'), last_event_at = datetime('now')
  where status in ('queued', 'blocked', 'failed')
    and dispatch_request_id is not null
    and (
      exists (
        select 1 from briar_issue_execution_proposals proposal
        where proposal.target_run_id = briar_hunt_runs.id
          and proposal.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and old.id in (
            proposal.approval_reserved_by_user_id,
            proposal.accepted_by_user_id
          )
      )
      or exists (
        select 1 from briar_issue_execution_approval_audit approval
        where approval.run_id = briar_hunt_runs.id
          and approval.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and approval.approved_by_user_id = old.id
      )
    );
END;

CREATE TRIGGER briar_issue_execution_approval_audit_insert_guard
before insert on briar_issue_execution_approval_audit
when not exists (
  select 1
  from briar_issue_execution_proposals proposal
  where proposal.id = new.proposal_id
    and proposal.status = 'accepted'
    and new.id = proposal.id || ':approval:' || proposal.generation
    and new.organization_id = proposal.organization_id
    and new.project_id = proposal.project_id
    and new.source_kind = proposal.source_kind
    and new.channel_id is proposal.channel_id
    and new.conversation_run_id is proposal.conversation_run_id
    and new.run_id = proposal.target_run_id
    and new.generation = proposal.generation
    and new.approved_by_user_id is proposal.accepted_by_user_id
    and new.approved_at = proposal.accepted_at
    and new.provider = proposal.requested_provider
    and new.model is proposal.requested_model
    and new.effort is proposal.requested_effort
    and new.worker_id is proposal.requested_worker_id
    and new.dispatch_request_id = proposal.dispatch_request_id
    and new.proposed_by_agent_id is proposal.proposed_by_agent_id
    and new.delegated_by_agent_id is proposal.delegated_by_agent_id
    and new.created_at = proposal.accepted_at
)
BEGIN
  select raise(abort, 'invalid issue execution approval audit');
END;

CREATE TRIGGER briar_issue_execution_approval_audit_immutable_update
before update on briar_issue_execution_approval_audit
when not (
  old.approved_by_user_id is not null
  and new.approved_by_user_id is null
  and not exists (
    select 1 from "user" account
    where account.id = old.approved_by_user_id
  )
  and new.id is old.id
  and new.proposal_id is old.proposal_id
  and new.organization_id is old.organization_id
  and new.project_id is old.project_id
  and new.source_kind is old.source_kind
  and new.channel_id is old.channel_id
  and new.conversation_run_id is old.conversation_run_id
  and new.run_id is old.run_id
  and new.generation is old.generation
  and new.approved_at is old.approved_at
  and new.provider is old.provider
  and new.model is old.model
  and new.effort is old.effort
  and new.worker_id is old.worker_id
  and new.dispatch_request_id is old.dispatch_request_id
  and new.proposed_by_agent_id is old.proposed_by_agent_id
  and new.delegated_by_agent_id is old.delegated_by_agent_id
  and new.created_at is old.created_at
)
BEGIN
  select raise(abort, 'issue execution approval audit is immutable');
END;

CREATE TRIGGER briar_issue_execution_approval_audit_immutable_delete
before delete on briar_issue_execution_approval_audit
when exists (
  select 1 from briar_organizations organization
  where organization.id = old.organization_id
)
BEGIN
  select raise(abort, 'issue execution approval audit is immutable');
END;

CREATE TRIGGER briar_channel_create_execution_intent_immutable
before update of execute_after_create, execution_proposal_id
on briar_channel_action_proposals
when old.execute_after_create <> new.execute_after_create
  or old.execution_proposal_id is not new.execution_proposal_id
BEGIN
  select raise(abort, 'channel create execution intent is immutable');
END;

CREATE TRIGGER briar_issue_create_execution_intent_immutable
before update of execute_after_create, execution_proposal_id
on briar_issue_action_proposals
when old.execute_after_create <> new.execute_after_create
  or old.execution_proposal_id is not new.execution_proposal_id
BEGIN
  select raise(abort, 'issue create execution intent is immutable');
END;

CREATE TRIGGER briar_issue_create_materialize_execution_proposal
after update of status on briar_issue_action_proposals
when old.status = 'pending' and new.status = 'accepted'
  and new.action_type = 'request_issue_create'
  and new.execute_after_create = 1
  and new.execution_proposal_id is not null
  and new.result_run_id is not null
BEGIN
  insert into briar_issue_execution_proposals (
    id, organization_id, project_id, source_kind, channel_id,
    conversation_run_id, trigger_message_id, reply_message_id,
    target_run_id, target_title, target_run_updated_at,
    proposed_by_agent_id, delegated_by_agent_id, delegated_by_agent_name,
    origin_create_proposal_id, created_at, updated_at
  )
  select new.execution_proposal_id, project.organization_id, new.project_id,
         'issue', null, new.conversation_run_id, new.trigger_message_id,
         new.reply_message_id, run.id, run.title, run.updated_at,
         conversation.agent_id, null, null, new.id,
         new.accepted_at, new.accepted_at
  from briar_hunt_runs run
  join briar_hunt_runs conversation
    on conversation.id = new.conversation_run_id
   and conversation.project_id = new.project_id
  join briar_projects project on project.id = new.project_id
  where run.id = new.result_run_id and run.project_id = new.project_id
    and run.status = 'backlog' and run.stage = 'queued'
    and run.dispatch_request_id is null and run.claim_token_hash is null
  on conflict (id) do nothing;

  select raise(abort, 'issue execution proposal was not materialized')
  where not exists (
    select 1
    from briar_issue_execution_proposals proposal
    where proposal.id = new.execution_proposal_id
      and proposal.project_id = new.project_id
      and proposal.source_kind = 'issue'
      and proposal.channel_id is null
      and proposal.conversation_run_id = new.conversation_run_id
      and proposal.trigger_message_id = new.trigger_message_id
      and proposal.reply_message_id = new.reply_message_id
      and proposal.target_run_id = new.result_run_id
      and proposal.origin_create_proposal_id = new.id
      and proposal.status = 'pending'
      and proposal.dispatch_request_id is null
  );
END;

CREATE TRIGGER briar_agent_skill_execution_audit_immutable_update
before update on briar_agent_skill_execution_approval_audit
when not (
  old.approved_by_user_id is not null and new.approved_by_user_id is null
  and not exists (
    select 1 from "user" account where account.id = old.approved_by_user_id
  )
  and new.id is old.id and new.proposal_id is old.proposal_id
  and new.organization_id is old.organization_id
  and new.project_id is old.project_id and new.source_kind is old.source_kind
  and new.channel_id is old.channel_id
  and new.conversation_run_id is old.conversation_run_id
  and new.trigger_message_id is old.trigger_message_id
  and new.reply_message_id is old.reply_message_id
  and new.source_reply_job_id is old.source_reply_job_id
  and new.delegated_by_reply_job_id is old.delegated_by_reply_job_id
  and new.agent_id is old.agent_id and new.agent_name is old.agent_name
  and new.agent_responsibility is old.agent_responsibility
  and new.skill_id is old.skill_id and new.skill_name is old.skill_name
  and new.skill_instructions is old.skill_instructions
  and new.skill_kind is old.skill_kind
  and new.provider is old.provider and new.model is old.model
  and new.effort is old.effort and new.request is old.request
  and new.worker_id is old.worker_id and new.worker_label is old.worker_label
  and new.result_session_id is old.result_session_id
  and new.approved_at is old.approved_at
  and new.delegated_by_agent_id is old.delegated_by_agent_id
  and new.delegated_by_agent_name is old.delegated_by_agent_name
  and new.created_at is old.created_at
)
BEGIN
  select raise(abort, 'Agent Skill execution approval audit is immutable');
END;

CREATE TRIGGER briar_agent_skill_execution_audit_immutable_delete
before delete on briar_agent_skill_execution_approval_audit
when exists (
  select 1 from briar_organizations organization
  where organization.id = old.organization_id
)
BEGIN
  select raise(abort, 'Agent Skill execution approval audit is immutable');
END;

CREATE TRIGGER briar_inbox_channel_mentions_insert_sync
after insert on briar_channel_message_mentions BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = new.message_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = new.message_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = new.message_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_inbox_channel_mentions_delete_sync
before delete on briar_channel_message_mentions BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = old.message_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = old.message_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = old.message_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_channel_changes_reactions_insert_sync
after insert on briar_channel_message_reactions BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, message.channel_id, 'message', new.message_id,
           'upsert', datetime('now')
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = new.message_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = new.message_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = new.message_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = new.message_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = new.message_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_channel_changes_reactions_delete_sync
after delete on briar_channel_message_reactions BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, message.channel_id, 'message', old.message_id,
           'upsert', datetime('now')
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = old.message_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = old.message_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = old.message_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = old.message_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = old.message_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_dashboard_issue_rework_proposals_insert_sync
after insert on briar_issue_rework_proposals BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.reply_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_issue_rework_proposals_update_sync
after update on briar_issue_rework_proposals BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.reply_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_issue_action_proposals_insert_sync
after insert on briar_issue_action_proposals BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.reply_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_issue_action_proposals_update_sync
after update on briar_issue_action_proposals BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.reply_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_issue_subscriptions_message_author_insert
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

CREATE TRIGGER briar_issue_subscriptions_mention_insert
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

CREATE TRIGGER briar_dashboard_runs_insert_sync
after insert on briar_hunt_runs BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'run', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_runs_delete_sync
before delete on briar_hunt_runs BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'run', old.id, 'delete', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_hunt_runs_workflow_v2_insert
before insert on briar_hunt_runs
when not (
  json_valid(new.workflow_snapshot_json)
  and json_extract(new.workflow_snapshot_json, '$.version') = 2
  and json_type(new.workflow_snapshot_json, '$.execution.checkpoints') = 'array'
  and not exists (
    select 1 from json_each(new.workflow_snapshot_json, '$.execution') field
    where field.key <> 'checkpoints'
  )
  and not exists (
    select 1 from json_each(new.workflow_snapshot_json, '$.execution.checkpoints') checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
      and json_extract(checkpoint.value, '$.key') not glob 'user-*'
      and json_extract(checkpoint.value, '$.key') not glob 'issue-*'
  )
)
begin
  select raise(abort, 'run workflow must use canonical v2 checkpoints');
END;

CREATE TRIGGER briar_hunt_runs_workflow_v2_update
before update of workflow_snapshot_json on briar_hunt_runs
when not (
  json_valid(new.workflow_snapshot_json)
  and json_extract(new.workflow_snapshot_json, '$.version') = 2
  and json_type(new.workflow_snapshot_json, '$.execution.checkpoints') = 'array'
  and not exists (
    select 1 from json_each(new.workflow_snapshot_json, '$.execution') field
    where field.key <> 'checkpoints'
  )
  and not exists (
    select 1 from json_each(new.workflow_snapshot_json, '$.execution.checkpoints') checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
      and json_extract(checkpoint.value, '$.key') not glob 'user-*'
      and json_extract(checkpoint.value, '$.key') not glob 'issue-*'
  )
)
begin
  select raise(abort, 'run workflow must use canonical v2 checkpoints');
END;

CREATE TRIGGER briar_channel_reply_skill_snapshot_update
after update of skill_id on briar_channel_agent_reply_jobs
when new.skill_id is not null and new.selected_skill_id_snapshot is null
BEGIN
  update briar_channel_agent_reply_jobs
  set selected_skill_id_snapshot = new.skill_id
  where id = new.id;
END;

CREATE TRIGGER briar_conversation_issue_creation_finalize
after insert on briar_hunt_runs
when new.source = 'issue'
  and new.source_key like 'briar-conversation-approved:%'
BEGIN
  update briar_issue_action_proposals
  set status = 'accepted',
      accepted_by_user_id = approval_reserved_by_user_id,
      accepted_at = approval_reserved_at,
      result_run_id = new.id,
      updated_at = approval_reserved_at
  where status = 'pending'
    and action_type = 'request_issue_create'
    and project_id = new.project_id
    and approval_reserved_by_user_id is not null
    and approval_reserved_at is not null
    and issue_source_key = new.source_key;
END;

CREATE TRIGGER briar_conversation_issue_acceptance_transfer_guard
before update of project_id on briar_hunt_runs
when new.project_id <> old.project_id
  and exists (
    select 1 from briar_issue_action_proposals proposal
    where proposal.status = 'pending'
      and proposal.action_type = 'request_issue_create'
      and (
        (
          proposal.conversation_run_id = old.id
          and proposal.approval_reserved_by_user_id is not null
        )
        or (
          old.source = 'issue'
          and proposal.issue_source_key is not null
          and old.source_key = proposal.issue_source_key
        )
      )
  )
BEGIN
  select raise(abort, 'conversation proposal acceptance in progress');
END;

CREATE TRIGGER briar_verified_run_archive_transfer_guard
before update of project_id on briar_hunt_runs
when new.project_id <> old.project_id
  and exists (
    select 1 from briar_log_archives archive
    where archive.run_id = old.id and archive.status = 'verified'
      and archive.archive_kind <> 'execution_audit'
  )
BEGIN
  select raise(abort, 'verified run archive prevents transfer');
END;

CREATE TRIGGER briar_issue_execution_reserved_proposal_delete_guard
before delete on briar_issue_execution_proposals
when old.status = 'pending' and old.dispatch_request_id is not null
  and exists (
    select 1 from briar_organizations organization
    where organization.id = old.organization_id
  )
  and exists (
    select 1 from briar_projects project where project.id = old.project_id
  )
  and exists (
    select 1 from briar_hunt_runs run where run.id = old.target_run_id
  )
BEGIN
  select raise(abort, 'reserved execution proposal cannot be deleted');
END;

CREATE TRIGGER briar_issue_execution_proposal_identity_immutable
before update on briar_issue_execution_proposals
when new.id is not old.id
  or new.organization_id is not old.organization_id
  or new.project_id is not old.project_id
  or new.source_kind is not old.source_kind
  or not (
    new.channel_id is old.channel_id
    or (
      old.channel_id is not null and new.channel_id is null
      and not exists (
        select 1 from briar_channels channel where channel.id = old.channel_id
      )
    )
  )
  or not (
    new.conversation_run_id is old.conversation_run_id
    or (
      old.conversation_run_id is not null and new.conversation_run_id is null
      and not exists (
        select 1 from briar_hunt_runs run
        where run.id = old.conversation_run_id
      )
    )
  )
  or new.trigger_message_id is not old.trigger_message_id
  or new.reply_message_id is not old.reply_message_id
  or new.target_run_id is not old.target_run_id
  or new.target_title is not old.target_title
  or new.target_run_updated_at is not old.target_run_updated_at
  or not (
    new.proposed_by_agent_id is old.proposed_by_agent_id
    or (old.proposed_by_agent_id is not null
        and new.proposed_by_agent_id is null
        and not exists (
          select 1 from briar_project_agents agent
          where agent.id = old.proposed_by_agent_id
        ))
  )
  or not (
    new.delegated_by_agent_id is old.delegated_by_agent_id
    or (old.delegated_by_agent_id is not null
        and new.delegated_by_agent_id is null
        and not exists (
          select 1 from briar_project_agents agent
          where agent.id = old.delegated_by_agent_id
        ))
  )
  or new.delegated_by_agent_name is not old.delegated_by_agent_name
  or new.origin_create_proposal_id is not old.origin_create_proposal_id
  or new.created_at is not old.created_at
BEGIN
  select raise(abort, 'issue execution proposal identity is immutable');
END;

CREATE TRIGGER briar_issue_execution_proposal_status_guard
before update of status, generation on briar_issue_execution_proposals
when not (
  (new.status = old.status and new.generation = old.generation)
  or (
    old.status = 'pending' and new.status = 'accepted'
    and new.generation = old.generation
  )
  or (
    old.status in ('pending', 'accepted')
    and new.status = 'invalidated'
    and new.generation = old.generation + 1
  )
)
BEGIN
  select raise(abort, 'invalid issue execution proposal transition');
END;

CREATE TRIGGER briar_issue_execution_proposal_reservation_immutable
before update of approval_reserved_by_user_id, approval_reserved_at,
                 requested_provider, requested_model, requested_effort,
                 requested_worker_id, dispatch_request_id
on briar_issue_execution_proposals
when old.dispatch_request_id is not null
  and not (
    (
      new.approval_reserved_by_user_id is old.approval_reserved_by_user_id
      or (
        old.approval_reserved_by_user_id is not null
        and new.approval_reserved_by_user_id is null
        and not exists (
          select 1 from "user" account
          where account.id = old.approval_reserved_by_user_id
        )
      )
    )
    and new.approval_reserved_at is old.approval_reserved_at
    and new.requested_provider is old.requested_provider
    and new.requested_model is old.requested_model
    and new.requested_effort is old.requested_effort
    and (
      new.requested_worker_id is old.requested_worker_id
      or (
        old.requested_worker_id is not null
        and new.requested_worker_id is null
        and not exists (
          select 1 from briar_execution_workers worker
          where worker.id = old.requested_worker_id
        )
      )
    )
    and new.dispatch_request_id is old.dispatch_request_id
  )
BEGIN
  select raise(abort, 'issue execution approval reservation is immutable');
END;

CREATE TRIGGER briar_issue_execution_proposal_deleted_approver_invalidate
after update of approval_reserved_by_user_id
on briar_issue_execution_proposals
when old.approval_reserved_by_user_id is not null
  and new.approval_reserved_by_user_id is null
  and new.status <> 'invalidated'
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where id = new.id and status <> 'invalidated';
END;

CREATE TRIGGER briar_issue_execution_proposal_deleted_agent_invalidate
after update of proposed_by_agent_id
on briar_issue_execution_proposals
when old.proposed_by_agent_id is not null
  and new.proposed_by_agent_id is null
  and new.status <> 'invalidated'
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where id = new.id and status <> 'invalidated';
END;

CREATE TRIGGER briar_issue_execution_proposal_deleted_delegator_invalidate
after update of delegated_by_agent_id
on briar_issue_execution_proposals
when old.delegated_by_agent_id is not null
  and new.delegated_by_agent_id is null
  and new.status <> 'invalidated'
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where id = new.id and status <> 'invalidated';
END;

CREATE TRIGGER briar_issue_execution_proposal_deleted_worker_invalidate
after update of requested_worker_id
on briar_issue_execution_proposals
when old.requested_worker_id is not null
  and new.requested_worker_id is null
  and new.status <> 'invalidated'
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where id = new.id and status <> 'invalidated';
END;

CREATE TRIGGER briar_issue_execution_conversation_delete_invalidate
before delete on briar_hunt_runs
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'issue' and conversation_run_id = old.id
    and status <> 'invalidated';
END;

CREATE TRIGGER briar_issue_execution_channel_roster_remove_invalidate
after delete on briar_channel_agents
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and channel_id = old.channel_id
    and status = 'pending'
    and (
      proposed_by_agent_id = old.agent_id
      or delegated_by_agent_id = old.agent_id
    );
END;

CREATE TRIGGER briar_issue_execution_agent_delete_run_reset
before delete on briar_project_agents
BEGIN
  update briar_hunt_runs
  set status = 'backlog', stage = 'queued', workflow_stage = null,
      agent_id = null, worker_id = null, requested_worker_id = null,
      claim_token_hash = null, claimed_by = null, claimed_at = null,
      lease_expires_at = null, claim_attempts = 0, last_execution_id = null,
      dispatch_mode = null, dispatch_request_id = null, dispatched_at = null,
      requested_by_user_id = null, requested_agent_provider = null,
      requested_agent_model = null, requested_agent_effort = null,
      paused_at = null, resume_requested_at = null, completed_at = null,
      detail = '승인에 연결된 Agent가 삭제되어 새 실행 승인이 필요합니다.',
      updated_at = datetime('now'), last_event_at = datetime('now')
  where status in ('queued', 'blocked', 'failed')
    and dispatch_request_id is not null
    and (
      exists (
        select 1 from briar_issue_execution_proposals proposal
        where proposal.target_run_id = briar_hunt_runs.id
          and proposal.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and old.id in (
            proposal.proposed_by_agent_id, proposal.delegated_by_agent_id
          )
      )
      or exists (
        select 1 from briar_issue_execution_approval_audit approval
        where approval.run_id = briar_hunt_runs.id
          and approval.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and old.id in (
            approval.proposed_by_agent_id, approval.delegated_by_agent_id
          )
      )
    );
END;

CREATE TRIGGER briar_issue_execution_proposal_acceptance_immutable
before update of accepted_by_user_id, accepted_at
on briar_issue_execution_proposals
when not (
  (
    old.status = 'pending' and new.status = 'accepted'
    and old.accepted_by_user_id is null and old.accepted_at is null
    and new.accepted_by_user_id is old.approval_reserved_by_user_id
    and new.accepted_at = old.approval_reserved_at
  )
  or (
    old.status in ('accepted', 'invalidated')
    and new.status = old.status
    and old.accepted_by_user_id is not null
    and new.accepted_by_user_id is null
    and not exists (
      select 1 from "user" account
      where account.id = old.accepted_by_user_id
    )
    and new.accepted_at is old.accepted_at
  )
  or (
    new.accepted_by_user_id is old.accepted_by_user_id
    and new.accepted_at is old.accepted_at
  )
)
BEGIN
  select raise(abort, 'issue execution proposal acceptance is immutable');
END;

CREATE TRIGGER briar_issue_execution_claim_approval_guard
before update of claim_token_hash on briar_hunt_runs
when old.claim_token_hash is null and new.claim_token_hash is not null
  and new.dispatch_request_id is not null
  and (
    exists (
      select 1 from briar_issue_execution_proposals proposal
      where proposal.dispatch_request_id = new.dispatch_request_id
    )
    or exists (
      select 1 from briar_issue_execution_approval_audit approval
      where approval.dispatch_request_id = new.dispatch_request_id
    )
  )
  and not exists (
    select 1 from briar_issue_execution_approval_audit approval
    where approval.project_id = new.project_id
      and approval.run_id = new.id
      and approval.dispatch_request_id = new.dispatch_request_id
      and approval.provider = new.requested_agent_provider
      and approval.model is new.requested_agent_model
      and approval.effort is new.requested_agent_effort
      and approval.worker_id is new.requested_worker_id
      and approval.approved_by_user_id is new.requested_by_user_id
      and approval.proposed_by_agent_id is new.agent_id
  )
BEGIN
  select raise(abort, 'conversational execution approval audit is missing');
END;

CREATE TRIGGER briar_issue_execution_proposal_dispatch_guard
before update of dispatch_request_id on briar_hunt_runs
when new.dispatch_request_id is not null
  and new.dispatch_request_id is not old.dispatch_request_id
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
  )
  and not exists (
    select 1
    from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.status = 'pending'
      and proposal.organization_id = (
        select project.organization_id from briar_projects project
        where project.id = old.project_id
      )
      and proposal.project_id = old.project_id
      and proposal.target_run_id = old.id
      and proposal.target_run_updated_at = old.updated_at
      and proposal.approval_reserved_by_user_id is not null
      and proposal.approval_reserved_at is not null
      and proposal.requested_provider is not null
      and old.status = 'backlog' and old.stage = 'queued'
      and old.workflow_stage is null
      and old.worker_id is null and old.requested_worker_id is null
      and old.claim_token_hash is null and old.claimed_by is null
      and old.claimed_at is null and old.lease_expires_at is null
      and old.last_execution_id is null
      and old.dispatch_mode is null and old.dispatch_request_id is null
      and old.dispatched_at is null and old.requested_by_user_id is null
      and old.completed_at is null and old.paused_at is null
      and old.resume_requested_at is null
      and new.status = 'queued' and new.stage = 'queued'
      and new.workflow_stage is null
      and new.requested_by_user_id = proposal.approval_reserved_by_user_id
      and new.requested_agent_provider = proposal.requested_provider
      and new.requested_agent_model is proposal.requested_model
      and new.requested_agent_effort is proposal.requested_effort
      and new.requested_worker_id is proposal.requested_worker_id
      and new.dispatch_mode = iif(
        proposal.requested_worker_id is null, 'any', 'specific'
      )
      and new.dispatched_at = proposal.approval_reserved_at
  )
BEGIN
  select raise(abort, 'execution proposal target is stale');
END;

CREATE TRIGGER briar_issue_execution_dispatch_agent_guard
before update of dispatch_request_id on briar_hunt_runs
when new.dispatch_request_id is not null
  and new.dispatch_request_id is not old.dispatch_request_id
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
  )
  and not exists (
    select 1
    from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.status = 'pending'
      and (
        proposal.proposed_by_agent_id is null
        or (
          new.agent_id = proposal.proposed_by_agent_id
          and exists (
            select 1 from briar_project_agents agent
            where agent.id = proposal.proposed_by_agent_id
              and agent.project_id = proposal.project_id
              and agent.organization_id = proposal.organization_id
          )
        )
      )
  )
BEGIN
  select raise(abort, 'execution proposal Agent is stale');
END;

CREATE TRIGGER briar_issue_execution_dispatch_issue_source_guard
before update of dispatch_request_id on briar_hunt_runs
when new.dispatch_request_id is not null
  and new.dispatch_request_id is not old.dispatch_request_id
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.source_kind = 'issue'
  )
  and not exists (
    select 1
    from briar_issue_execution_proposals proposal
    join briar_hunt_runs conversation
      on conversation.id = proposal.conversation_run_id
     and conversation.project_id = proposal.project_id
    join briar_issue_messages reply
      on reply.id = proposal.reply_message_id
     and reply.run_id = conversation.id
     and reply.project_id = conversation.project_id
    join briar_projects project on project.id = conversation.project_id
    join briar_organization_members membership
      on membership.organization_id = project.organization_id
     and membership.user_id = proposal.approval_reserved_by_user_id
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.status = 'pending' and proposal.source_kind = 'issue'
      and project.organization_id = proposal.organization_id
  )
BEGIN
  select raise(abort, 'issue execution proposal source is stale');
END;

CREATE TRIGGER briar_issue_execution_dispatch_audit_guard
before insert on briar_execution_audit_events
when new.request_id is not null
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.request_id
  )
  and not exists (
    select 1
    from briar_issue_execution_proposals proposal
    join briar_hunt_runs run
      on run.id = proposal.target_run_id
     and run.project_id = proposal.project_id
    where proposal.dispatch_request_id = new.request_id
      and proposal.status = 'pending'
      and proposal.approval_reserved_by_user_id is not null
      and proposal.approval_reserved_at is not null
      and new.action = 'dispatched'
      and new.organization_id = proposal.organization_id
      and new.project_id = proposal.project_id
      and new.run_id = proposal.target_run_id
      and new.worker_id is proposal.requested_worker_id
      and new.agent_id is proposal.proposed_by_agent_id
      and new.actor_user_id is proposal.approval_reserved_by_user_id
      and new.occurred_at = proposal.approval_reserved_at
      and run.dispatch_request_id = proposal.dispatch_request_id
      and run.dispatched_at = proposal.approval_reserved_at
      and run.requested_by_user_id = proposal.approval_reserved_by_user_id
      and run.requested_agent_provider = proposal.requested_provider
      and run.requested_agent_model is proposal.requested_model
      and run.requested_agent_effort is proposal.requested_effort
      and run.requested_worker_id is proposal.requested_worker_id
  )
BEGIN
  select raise(abort, 'invalid issue execution dispatch audit');
END;

CREATE TRIGGER briar_issue_execution_dispatch_finalize
after insert on briar_execution_audit_events
when new.action = 'dispatched' and new.request_id is not null
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.request_id
  )
BEGIN
  update briar_issue_execution_proposals
  set status = 'accepted',
      accepted_by_user_id = approval_reserved_by_user_id,
      accepted_at = approval_reserved_at,
      updated_at = approval_reserved_at
  where dispatch_request_id = new.request_id and status = 'pending'
    and organization_id = new.organization_id
    and project_id = new.project_id and target_run_id = new.run_id
    and approval_reserved_by_user_id is new.actor_user_id
    and approval_reserved_at = new.occurred_at;

  select raise(abort, 'execution approval was not finalized')
  where changes() <> 1;
END;

CREATE TRIGGER briar_issue_execution_proposal_accept_guard
before update of status on briar_issue_execution_proposals
when old.status = 'pending' and new.status = 'accepted'
  and not (
    old.approval_reserved_by_user_id is not null
    and old.approval_reserved_at is not null
    and old.dispatch_request_id is not null
    and new.accepted_by_user_id is old.approval_reserved_by_user_id
    and new.accepted_at = old.approval_reserved_at
    and new.generation = old.generation
    and exists (
      select 1 from briar_hunt_runs run
      where run.id = old.target_run_id and run.project_id = old.project_id
        and run.dispatch_request_id = old.dispatch_request_id
        and run.dispatched_at = old.approval_reserved_at
        and run.requested_by_user_id = old.approval_reserved_by_user_id
        and run.requested_agent_provider = old.requested_provider
        and run.requested_agent_model is old.requested_model
        and run.requested_agent_effort is old.requested_effort
        and run.requested_worker_id is old.requested_worker_id
    )
    and exists (
      select 1 from briar_execution_audit_events audit
      where audit.organization_id = old.organization_id
        and audit.project_id = old.project_id
        and audit.run_id = old.target_run_id
        and audit.request_id = old.dispatch_request_id
        and audit.actor_user_id is old.approval_reserved_by_user_id
        and audit.action = 'dispatched'
    )
  )
BEGIN
  select raise(abort, 'execution proposal acceptance requires dispatch audit');
END;

CREATE TRIGGER briar_issue_execution_proposal_audit_insert
after update of status on briar_issue_execution_proposals
when old.status = 'pending' and new.status = 'accepted'
BEGIN
  insert into briar_issue_execution_approval_audit (
    id, proposal_id, organization_id, project_id, source_kind, channel_id,
    conversation_run_id, run_id, generation, approved_by_user_id,
    approved_at, provider, model, effort, worker_id, dispatch_request_id,
    proposed_by_agent_id, delegated_by_agent_id, created_at
  ) values (
    new.id || ':approval:' || new.generation, new.id, new.organization_id,
    new.project_id, new.source_kind, new.channel_id,
    new.conversation_run_id, new.target_run_id, new.generation,
    new.accepted_by_user_id, new.accepted_at, new.requested_provider,
    new.requested_model, new.requested_effort, new.requested_worker_id,
    new.dispatch_request_id, new.proposed_by_agent_id,
    new.delegated_by_agent_id, new.accepted_at
  );
END;

CREATE TRIGGER briar_issue_execution_dispatch_clear_guard
before update of dispatch_request_id, status on briar_hunt_runs
when old.dispatch_request_id is not null
  and new.dispatch_request_id is null
  and new.status not in ('completed', 'cancelled')
  and (
    exists (
      select 1 from briar_issue_execution_proposals proposal
      where proposal.target_run_id = old.id
        and proposal.project_id = old.project_id
        and proposal.dispatch_request_id = old.dispatch_request_id
    )
    or exists (
      select 1 from briar_issue_execution_approval_audit approval
      where approval.run_id = old.id
        and approval.project_id = old.project_id
        and approval.dispatch_request_id = old.dispatch_request_id
    )
  )
  and not (
    new.status = 'backlog' and new.stage = 'queued'
    and new.workflow_stage is null
    and new.agent_id is null
    and new.worker_id is null and new.requested_worker_id is null
    and new.claim_token_hash is null and new.claimed_by is null
    and new.claimed_at is null and new.lease_expires_at is null
    and new.last_execution_id is null
    and new.dispatch_mode is null and new.dispatched_at is null
    and new.requested_by_user_id is null
    and new.requested_agent_provider is null
    and new.requested_agent_model is null
    and new.requested_agent_effort is null
    and new.paused_at is null and new.resume_requested_at is null
    and new.completed_at is null
  )
BEGIN
  select raise(
    abort, 'conversational execution cancellation requires backlog reset'
  );
END;

CREATE TRIGGER briar_issue_execution_retryable_transfer_guard
before update of project_id, status on briar_hunt_runs
when old.status in ('queued', 'blocked', 'failed')
  and new.project_id <> old.project_id
  and old.dispatch_request_id is not null
  and (
    exists (
      select 1 from briar_issue_execution_proposals proposal
      where proposal.target_run_id = old.id
        and proposal.project_id = old.project_id
        and proposal.dispatch_request_id = old.dispatch_request_id
    )
    or exists (
      select 1 from briar_issue_execution_approval_audit approval
      where approval.run_id = old.id
        and approval.project_id = old.project_id
        and approval.dispatch_request_id = old.dispatch_request_id
    )
  )
  and not (
    new.status = 'backlog' and new.stage = 'queued'
    and new.workflow_stage is null
    and new.agent_id is null
    and new.worker_id is null and new.requested_worker_id is null
    and new.claim_token_hash is null and new.claimed_by is null
    and new.claimed_at is null and new.lease_expires_at is null
    and new.last_execution_id is null
    and new.dispatch_mode is null and new.dispatch_request_id is null
    and new.dispatched_at is null and new.requested_by_user_id is null
    and new.requested_agent_provider is null
    and new.requested_agent_model is null
    and new.requested_agent_effort is null
    and new.paused_at is null and new.resume_requested_at is null
    and new.completed_at is null
  )
BEGIN
  select raise(
    abort, 'conversational execution transfer requires backlog reset'
  );
END;

CREATE TRIGGER briar_issue_execution_terminal_transfer_guard
before update of project_id on briar_hunt_runs
when old.status in ('completed', 'cancelled')
  and new.project_id <> old.project_id
  and exists (
    select 1 from briar_issue_execution_approval_audit approval
    where approval.run_id = old.id
      and approval.project_id = old.project_id
  )
BEGIN
  select raise(
    abort, 'conversationally approved terminal issue transfer is not allowed'
  );
END;

CREATE TRIGGER briar_issue_execution_terminal_reactivation_guard
before update of status on briar_hunt_runs
when old.status in ('completed', 'cancelled')
  and new.status not in ('completed', 'cancelled')
  and exists (
    select 1 from briar_issue_execution_approval_audit approval
    where approval.run_id = old.id
      and approval.project_id = old.project_id
  )
BEGIN
  select raise(
    abort, 'conversational execution reactivation requires fresh approval'
  );
END;

CREATE TRIGGER briar_issue_execution_target_mutation_invalidate
after update of updated_at on briar_hunt_runs
when new.updated_at is not old.updated_at
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where target_run_id = new.id and status = 'pending'
    and target_run_updated_at is not new.updated_at
    and not (
      dispatch_request_id is not null
      and new.project_id = project_id
      and new.dispatch_request_id = dispatch_request_id
      and new.dispatched_at = approval_reserved_at
      and new.requested_by_user_id = approval_reserved_by_user_id
      and new.requested_agent_provider = requested_provider
      and new.requested_agent_model is requested_model
      and new.requested_agent_effort is requested_effort
      and new.requested_worker_id is requested_worker_id
      and new.status = 'queued' and new.stage = 'queued'
      and new.workflow_stage is null
    );
END;

CREATE TRIGGER briar_issue_execution_proposal_transfer_invalidate
after update of project_id on briar_hunt_runs
when new.project_id <> old.project_id
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where target_run_id = new.id and status <> 'invalidated';
END;

CREATE TRIGGER briar_issue_execution_proposal_unassign_invalidate
after update of dispatch_request_id on briar_hunt_runs
when old.dispatch_request_id is not null and new.dispatch_request_id is null
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where target_run_id = new.id and status <> 'invalidated'
    and dispatch_request_id = old.dispatch_request_id;
END;

CREATE TRIGGER briar_channel_execution_proposals_insert_sync
after insert on briar_issue_execution_proposals
when new.source_kind = 'channel'
BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'proposal', new.id, 'upsert',
    datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_channel_execution_proposals_update_sync
after update on briar_issue_execution_proposals
when new.source_kind = 'channel' and new.channel_id is not null
BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'proposal', new.id, 'upsert',
    datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_project_agent_task_completion_receipt_insert_guard
before insert on briar_project_agent_task_completion_receipts
when not exists (
  select 1
  from briar_project_agent_task_jobs task
  join briar_projects project on project.id = task.project_id
  where task.id = new.task_id and task.project_id = new.project_id
    and project.organization_id = new.organization_id
    and task.status = 'running'
    and task.claimed_worker_id = new.worker_id
    and task.claim_token_hash = new.claim_token_hash
    and task.skill_execution_proposal_id is new.skill_execution_proposal_id
    and (
      (new.error is null and new.outcome_status = 'completed' and (
        new.skill_execution_proposal_id is null or new.summary is not null
      ))
      or (new.error is not null and new.summary is null
        and task.attempts >= 3 and new.outcome_status = 'failed')
      or (new.error is not null and new.summary is null
        and task.attempts < 3 and new.outcome_status = 'queued')
    )
    and new.completed_at = new.created_at
)
BEGIN
  select raise(abort, 'invalid project Agent task completion receipt');
END;

CREATE TRIGGER briar_channel_agent_reply_skill_snapshot_immutable
before update of selected_skill_id_snapshot, selected_agent_name_snapshot,
                 selected_agent_responsibility_snapshot,
                 selected_skill_name_snapshot,
                 selected_skill_instructions_snapshot,
                 selected_skill_kind_snapshot,
                 selected_skill_provider_snapshot,
                 selected_skill_model_snapshot,
                 selected_skill_effort_snapshot,
                 skill_execution_request_snapshot
on briar_channel_agent_reply_jobs
when new.selected_skill_id_snapshot is not old.selected_skill_id_snapshot
  or new.selected_agent_name_snapshot is not old.selected_agent_name_snapshot
  or new.selected_agent_responsibility_snapshot is not
    old.selected_agent_responsibility_snapshot
  or new.selected_skill_name_snapshot is not old.selected_skill_name_snapshot
  or new.selected_skill_instructions_snapshot is not
    old.selected_skill_instructions_snapshot
  or new.selected_skill_kind_snapshot is not old.selected_skill_kind_snapshot
  or new.selected_skill_provider_snapshot is not
    old.selected_skill_provider_snapshot
  or new.selected_skill_model_snapshot is not old.selected_skill_model_snapshot
  or new.selected_skill_effort_snapshot is not
    old.selected_skill_effort_snapshot
  or new.skill_execution_request_snapshot is not
    old.skill_execution_request_snapshot
BEGIN
  select raise(abort, 'channel Agent Skill reply snapshot is immutable');
END;

CREATE TRIGGER briar_channel_action_skill_execution_exclusive
before insert on briar_channel_action_proposals
when exists (
  select 1 from briar_agent_skill_execution_proposals skill_execution
  where skill_execution.reply_message_id = new.reply_message_id
)
BEGIN
  select raise(abort, 'channel proposal conflicts with Agent Skill execution');
END;

CREATE TRIGGER briar_issue_action_skill_execution_exclusive
before insert on briar_issue_action_proposals
when exists (
  select 1 from briar_agent_skill_execution_proposals skill_execution
  where skill_execution.reply_message_id = new.reply_message_id
)
BEGIN
  select raise(abort, 'issue proposal conflicts with Agent Skill execution');
END;

CREATE TRIGGER briar_issue_rework_skill_execution_exclusive
before insert on briar_issue_rework_proposals
when exists (
  select 1 from briar_agent_skill_execution_proposals skill_execution
  where skill_execution.reply_message_id = new.reply_message_id
)
BEGIN
  select raise(abort, 'rework proposal conflicts with Agent Skill execution');
END;

CREATE TRIGGER briar_issue_execution_skill_execution_exclusive
before insert on briar_issue_execution_proposals
when exists (
  select 1 from briar_agent_skill_execution_proposals skill_execution
  where skill_execution.reply_message_id = new.reply_message_id
)
BEGIN
  select raise(abort, 'issue execution conflicts with Agent Skill execution');
END;

CREATE TRIGGER briar_agent_skill_execution_identity_immutable
before update on briar_agent_skill_execution_proposals
when new.id is not old.id
  or new.organization_id is not old.organization_id
  or new.project_id is not old.project_id
  or new.source_kind is not old.source_kind
  or new.channel_id is not old.channel_id
  or new.conversation_run_id is not old.conversation_run_id
  or new.trigger_message_id is not old.trigger_message_id
  or new.reply_message_id is not old.reply_message_id
  or new.source_reply_job_id is not old.source_reply_job_id
  or new.delegated_by_reply_job_id is not old.delegated_by_reply_job_id
  or new.agent_id is not old.agent_id
  or new.agent_name is not old.agent_name
  or new.agent_responsibility is not old.agent_responsibility
  or new.skill_id is not old.skill_id
  or new.skill_name is not old.skill_name
  or new.skill_instructions is not old.skill_instructions
  or new.skill_kind is not old.skill_kind
  or new.provider is not old.provider
  or new.model is not old.model
  or new.effort is not old.effort
  or new.request is not old.request
  or new.delegated_by_agent_id is not old.delegated_by_agent_id
  or new.delegated_by_agent_name is not old.delegated_by_agent_name
  or new.created_at is not old.created_at
BEGIN
  select raise(abort, 'Agent Skill execution proposal identity is immutable');
END;

CREATE TRIGGER briar_agent_skill_execution_status_guard
before update of status, generation on briar_agent_skill_execution_proposals
when not (
  (new.status = old.status and new.generation = old.generation)
  or (old.status = 'pending' and new.status = 'accepted'
      and new.generation = old.generation)
  or (old.status = 'pending' and new.status = 'invalidated'
      and new.generation = old.generation + 1)
)
BEGIN
  select raise(abort, 'invalid Agent Skill execution proposal transition');
END;

CREATE TRIGGER briar_agent_skill_execution_acceptance_immutable
before update of requested_worker_id, requested_worker_label,
                 result_session_id, accepted_by_user_id, accepted_at
on briar_agent_skill_execution_proposals
when not (
  (
    old.status = 'pending' and new.status = 'accepted'
    and old.requested_worker_id is null
    and old.requested_worker_label is null
    and old.result_session_id is null
    and old.accepted_by_user_id is null and old.accepted_at is null
    and new.requested_worker_id is not null
    and new.requested_worker_label is not null
    and new.result_session_id is not null
    and new.accepted_by_user_id is not null and new.accepted_at is not null
  )
  or (
    new.requested_worker_id is old.requested_worker_id
    and new.requested_worker_label is old.requested_worker_label
    and new.result_session_id is old.result_session_id
    and new.accepted_by_user_id is old.accepted_by_user_id
    and new.accepted_at is old.accepted_at
  )
  or (
    old.status = 'accepted' and new.status = 'accepted'
    and old.accepted_by_user_id is not null
    and new.accepted_by_user_id is null
    and not exists (
      select 1 from "user" account where account.id = old.accepted_by_user_id
    )
    and new.requested_worker_id is old.requested_worker_id
    and new.requested_worker_label is old.requested_worker_label
    and new.result_session_id is old.result_session_id
    and new.accepted_at is old.accepted_at
  )
)
BEGIN
  select raise(abort, 'Agent Skill execution acceptance is immutable');
END;

CREATE TRIGGER briar_agent_skill_execution_audit_insert_guard
before insert on briar_agent_skill_execution_approval_audit
when not exists (
  select 1 from briar_agent_skill_execution_proposals proposal
  where proposal.id = new.proposal_id and proposal.status = 'accepted'
    and new.id = proposal.id || ':approval:' || proposal.generation
    and new.organization_id = proposal.organization_id
    and new.project_id = proposal.project_id
    and new.source_kind = proposal.source_kind
    and new.channel_id is proposal.channel_id
    and new.conversation_run_id is proposal.conversation_run_id
    and new.trigger_message_id = proposal.trigger_message_id
    and new.reply_message_id = proposal.reply_message_id
    and new.source_reply_job_id = proposal.source_reply_job_id
    and new.delegated_by_reply_job_id is proposal.delegated_by_reply_job_id
    and new.agent_id = proposal.agent_id and new.agent_name = proposal.agent_name
    and new.agent_responsibility = proposal.agent_responsibility
    and new.skill_id = proposal.skill_id and new.skill_name = proposal.skill_name
    and new.skill_instructions = proposal.skill_instructions
    and new.skill_kind = proposal.skill_kind
    and new.provider = proposal.provider and new.model is proposal.model
    and new.effort is proposal.effort and new.request = proposal.request
    and new.worker_id = proposal.requested_worker_id
    and new.worker_label = proposal.requested_worker_label
    and new.result_session_id = proposal.result_session_id
    and new.approved_by_user_id is proposal.accepted_by_user_id
    and new.approved_at = proposal.accepted_at
    and new.delegated_by_agent_id is proposal.delegated_by_agent_id
    and new.delegated_by_agent_name is proposal.delegated_by_agent_name
    and new.created_at = proposal.accepted_at
)
BEGIN
  select raise(abort, 'invalid Agent Skill execution approval audit');
END;

CREATE TRIGGER briar_agent_skill_execution_task_link_immutable
before update of skill_execution_proposal_id on briar_project_agent_task_jobs
when old.skill_execution_proposal_id is not null
  and new.skill_execution_proposal_id is not old.skill_execution_proposal_id
BEGIN
  select raise(abort, 'Agent Skill execution task linkage is immutable');
END;

CREATE TRIGGER briar_agent_skill_execution_task_core_immutable
before update of id, project_id, agent_id, skill_id, request, request_id,
                 preferred_worker_id, created_at
on briar_project_agent_task_jobs
when old.skill_execution_proposal_id is not null
  and (
    new.id is not old.id or new.project_id is not old.project_id
    or new.agent_id is not old.agent_id or new.skill_id is not old.skill_id
    or new.request is not old.request or new.request_id is not old.request_id
    or new.preferred_worker_id is not old.preferred_worker_id
    or new.created_at is not old.created_at
  )
BEGIN
  select raise(abort, 'Agent Skill execution task core is immutable');
END;

CREATE TRIGGER briar_agent_skill_execution_task_terminal_guard
before update of status on briar_project_agent_task_jobs
when old.skill_execution_proposal_id is not null
  and old.status in ('queued', 'running')
  and new.status in ('completed', 'failed')
  and not exists (
    select 1
    from briar_agent_skill_execution_approval_audit approval
    join briar_project_agent_sessions session
      on session.project_id = approval.project_id
     and session.id = approval.result_session_id
    where approval.proposal_id = old.skill_execution_proposal_id
      and approval.project_id = old.project_id
      and approval.result_session_id = old.id
      and approval.agent_id = old.agent_id
      and approval.skill_id = old.skill_id
      and approval.request = old.request
      and approval.worker_id = old.preferred_worker_id
      and session.agent_id = approval.agent_id
      and session.session_type = 'task'
      and json_valid(session.payload_json)
      and json_extract(session.payload_json, '$.dispatchGroupId') = old.id
      and json_extract(session.payload_json, '$.agentId') = approval.agent_id
      and json_extract(session.payload_json, '$.agentName') = approval.agent_name
      and json_extract(session.payload_json, '$.skillId') = approval.skill_id
      and json_extract(session.payload_json, '$.sessionType') = 'task'
      and json_extract(session.payload_json, '$.trigger') = 'manual'
      and json_extract(session.payload_json, '$.request') = approval.request
      and json_extract(session.payload_json, '$.requestedWorkerId') =
        approval.worker_id
      and json_extract(session.payload_json, '$.workerId') = approval.worker_id
  )
BEGIN
  select raise(abort, 'Agent Skill execution session is missing or invalid');
END;

CREATE TRIGGER briar_agent_skill_execution_task_delete_reconcile
before delete on briar_project_agent_task_jobs
when old.skill_execution_proposal_id is not null
  and old.status in ('queued', 'running')
BEGIN
  update briar_project_agent_sessions
  set status = 'failed',
      payload_json = json_insert(
        json_set(
          payload_json,
          '$.status', 'failed',
          '$.summary', null,
          '$.conversationId', null,
          '$.error', 'Approved Agent Skill execution authority was removed.',
          '$.completedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          '$.updatedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        '$.events[#]', json_object(
          'id', lower(hex(randomblob(16))),
          'type', 'failed',
          'occurredAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        )
      ),
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where project_id = old.project_id and id = old.id;
END;

CREATE TRIGGER briar_agent_skill_execution_organization_delete_reconcile
before delete on briar_organizations
BEGIN
  delete from briar_project_agent_task_jobs
  where skill_execution_proposal_id in (
    select proposal_id
    from briar_agent_skill_execution_approval_audit
    where organization_id = old.id
  );
END;

CREATE TRIGGER briar_agent_skill_execution_worker_delete_reconcile
before delete on briar_execution_workers
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker binding was removed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where preferred_worker_id = old.id and status in ('queued', 'running')
    and skill_execution_proposal_id is not null;
END;

CREATE TRIGGER briar_agent_skill_execution_worker_binding_reconcile
after update of project_id, device_id on briar_execution_workers
when new.project_id is not old.project_id or new.device_id is not old.device_id
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker binding changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where preferred_worker_id = new.id and status in ('queued', 'running')
    and skill_execution_proposal_id is not null;
END;

CREATE TRIGGER briar_agent_skill_execution_worker_disable_reconcile
after update of state on briar_execution_workers
when old.state <> 'disabled' and new.state = 'disabled'
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker was disabled before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where preferred_worker_id = new.id and status in ('queued', 'running')
    and skill_execution_proposal_id is not null;
END;

CREATE TRIGGER briar_agent_skill_execution_device_authority_reconcile
after update of organization_id, owner_user_id on briar_execution_worker_devices
when new.organization_id is not old.organization_id
  or new.owner_user_id is not old.owner_user_id
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker device authority changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where status in ('queued', 'running')
    and skill_execution_proposal_id is not null
    and preferred_worker_id in (
      select id from briar_execution_workers where device_id = new.id
    );
END;

CREATE TRIGGER briar_agent_skill_execution_device_disable_reconcile
after update of state on briar_execution_worker_devices
when old.state <> 'disabled' and new.state = 'disabled'
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker device was disabled before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where status in ('queued', 'running')
    and skill_execution_proposal_id is not null
    and preferred_worker_id in (
      select id from briar_execution_workers where device_id = new.id
    );
END;

CREATE TRIGGER briar_agent_skill_execution_skill_delete_invalidate
before delete on briar_agent_skills
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where skill_id = old.id and status = 'pending';

  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Skill was removed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where status in ('queued', 'running')
    and skill_id = old.id
    and skill_execution_proposal_id is not null
    and exists (
      select 1 from briar_agent_skill_execution_approval_audit approval
      where approval.proposal_id = skill_execution_proposal_id
    );

  delete from briar_project_agent_task_jobs
  where skill_id = old.id and skill_execution_proposal_id is not null;
END;

CREATE TRIGGER briar_agent_skill_execution_agent_delete_invalidate
before delete on briar_project_agents
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where (agent_id = old.id or delegated_by_agent_id = old.id)
    and status = 'pending';

  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Agent was removed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where status in ('queued', 'running')
    and skill_execution_proposal_id in (
      select proposal_id
      from briar_agent_skill_execution_approval_audit
      where agent_id = old.id
    );
END;

CREATE TRIGGER briar_agent_skill_execution_agent_update_invalidate
after update of organization_id, project_id, name, responsibility
on briar_project_agents
when new.organization_id is not old.organization_id
  or new.project_id is not old.project_id
  or new.name <> old.name
  or new.responsibility <> old.responsibility
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where (agent_id = old.id or delegated_by_agent_id = old.id)
    and status = 'pending';

  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Agent changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where status in ('queued', 'running')
    and skill_execution_proposal_id in (
      select proposal_id
      from briar_agent_skill_execution_approval_audit
      where agent_id = old.id
        and (new.organization_id is not organization_id
          or new.project_id is not project_id
          or new.name <> agent_name
          or new.responsibility <> agent_responsibility)
    );
END;

CREATE TRIGGER briar_agent_skill_execution_channel_archive_invalidate
after update of archived_at on briar_channels
when old.archived_at is null and new.archived_at is not null
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'channel' and channel_id = new.id and status = 'pending';
END;

CREATE TRIGGER briar_agent_skill_execution_channel_roster_invalidate
after delete on briar_channel_agents
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and channel_id = old.channel_id
    and status = 'pending'
    and (agent_id = old.agent_id or delegated_by_agent_id = old.agent_id);
END;

CREATE TRIGGER briar_agent_skill_execution_channel_job_invalidate
after update of organization_id, channel_id, project_id, agent_id, skill_id,
                selected_skill_id_snapshot, trigger_message_id,
                reply_message_id, delegated_by_reply_job_id,
                delegation_request, status
on briar_channel_agent_reply_jobs
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'channel'
    and (source_reply_job_id = old.id or delegated_by_reply_job_id = old.id)
    and status = 'pending'
    and (new.organization_id is not old.organization_id
      or new.channel_id is not old.channel_id
      or new.project_id is not old.project_id
      or new.agent_id is not old.agent_id
      or new.skill_id is not old.skill_id
      or new.selected_skill_id_snapshot is not old.selected_skill_id_snapshot
      or new.trigger_message_id is not old.trigger_message_id
      or new.reply_message_id is not old.reply_message_id
      or new.delegated_by_reply_job_id is not old.delegated_by_reply_job_id
      or new.delegation_request is not old.delegation_request
      or new.status <> 'completed');
END;

CREATE TRIGGER briar_agent_skill_execution_issue_message_invalidate
after update of body on briar_issue_messages
when new.body <> old.body
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'issue' and trigger_message_id = new.id
    and status = 'pending';
END;

CREATE TRIGGER briar_agent_skill_execution_issue_message_delete_invalidate
before delete on briar_issue_messages
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'issue' and status = 'pending'
    and old.id in (trigger_message_id, reply_message_id);
END;

CREATE TRIGGER briar_agent_skill_execution_issue_assignment_invalidate
after update of agent_id, project_id on briar_hunt_runs
when new.agent_id is not old.agent_id or new.project_id <> old.project_id
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'issue' and conversation_run_id = new.id
    and status = 'pending';
END;

CREATE TRIGGER briar_agent_skill_execution_channel_sync_insert
after insert on briar_agent_skill_execution_proposals
when new.source_kind = 'channel'
BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'proposal', new.id, 'upsert',
    datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_agent_skill_execution_channel_sync_update
after update on briar_agent_skill_execution_proposals
when new.source_kind = 'channel' and new.channel_id is not null
BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'proposal', new.id, 'upsert',
    datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_dashboard_runs_update_sync
after update on briar_hunt_runs
when old.lease_expires_at is new.lease_expires_at
  or old.updated_at is not new.updated_at
BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'run', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_channel_changes_reply_jobs_update_sync
after update on briar_channel_agent_reply_jobs
when old.lease_expires_at is new.lease_expires_at
  or old.updated_at is not new.updated_at
BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'reply_job', new.id, 'upsert',
    datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_issue_subscriptions_run_insert
after insert on briar_hunt_runs
when new.assignee_user_id is not null BEGIN
  insert into briar_issue_subscriptions (
    run_id, organization_id, user_id, created_at
  )
  select new.id, project.organization_id, new.assignee_user_id, new.started_at
  from briar_projects project
  join briar_organization_members membership
    on membership.organization_id = project.organization_id
   and membership.user_id = new.assignee_user_id
  where project.id = new.project_id
  on conflict (run_id, user_id) do nothing;
END;

CREATE TRIGGER briar_issue_subscriptions_assignee_update
after update of assignee_user_id on briar_hunt_runs
when new.assignee_user_id is not null
  and new.assignee_user_id is not old.assignee_user_id BEGIN
  insert into briar_issue_subscriptions (
    run_id, organization_id, user_id, created_at
  )
  select new.id, project.organization_id, new.assignee_user_id, new.updated_at
  from briar_projects project
  join briar_organization_members membership
    on membership.organization_id = project.organization_id
   and membership.user_id = new.assignee_user_id
  where project.id = new.project_id
  on conflict (run_id, user_id) do nothing;
END;

CREATE TRIGGER briar_channel_changes_messages_insert_sync
after insert on briar_channel_messages BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, new.channel_id, 'message', new.id,
           'upsert', datetime('now')
    from briar_channels channel where channel.id = new.channel_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channels channel where channel.id = new.channel_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channels channel where channel.id = new.channel_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel where channel.id = new.channel_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel where channel.id = new.channel_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_channel_changes_messages_delete_sync
after delete on briar_channel_messages BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, old.channel_id, 'message', old.id,
           'delete', datetime('now')
    from briar_channels channel where channel.id = old.channel_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channels channel where channel.id = old.channel_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channels channel where channel.id = old.channel_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel where channel.id = old.channel_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel where channel.id = old.channel_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_agent_skill_execution_channel_message_invalidate
after update of body on briar_channel_messages
when new.body <> old.body
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'channel' and trigger_message_id = new.id
    and status = 'pending';
END;

CREATE TRIGGER briar_agent_skill_execution_channel_message_delete_invalidate
before delete on briar_channel_messages
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and status = 'pending'
    and old.id in (trigger_message_id, reply_message_id);
END;

CREATE TRIGGER briar_channel_changes_reply_jobs_insert_sync
after insert on briar_channel_agent_reply_jobs BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'reply_job', new.id, 'upsert',
    datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_channel_reply_skill_snapshot_insert
after insert on briar_channel_agent_reply_jobs
when new.skill_id is not null and new.selected_skill_id_snapshot is null
BEGIN
  update briar_channel_agent_reply_jobs
  set selected_skill_id_snapshot = new.skill_id
  where id = new.id;
END;

CREATE TRIGGER briar_agent_skill_execution_channel_job_delete_invalidate
before delete on briar_channel_agent_reply_jobs
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and status = 'pending'
    and (source_reply_job_id = old.id or delegated_by_reply_job_id = old.id);
END;

CREATE TRIGGER briar_issue_execution_proposal_insert_guard
before insert on briar_issue_execution_proposals
when not (
  new.status = 'pending' and new.generation = 1
  and new.approval_reserved_by_user_id is null
  and new.approval_reserved_at is null
  and new.requested_provider is null and new.requested_model is null
  and new.requested_effort is null and new.requested_worker_id is null
  and new.dispatch_request_id is null
  and new.accepted_by_user_id is null and new.accepted_at is null
  and exists (
    select 1
    from briar_projects project
    join briar_hunt_runs target
      on target.id = new.target_run_id and target.project_id = project.id
    where project.id = new.project_id
      and project.organization_id = new.organization_id
      and target.title = new.target_title
      and target.updated_at = new.target_run_updated_at
      and target.status = 'backlog' and target.stage = 'queued'
      and target.workflow_stage is null
      and target.worker_id is null and target.requested_worker_id is null
      and target.claim_token_hash is null and target.claimed_by is null
      and target.claimed_at is null and target.lease_expires_at is null
      and target.last_execution_id is null
      and target.dispatch_mode is null and target.dispatch_request_id is null
      and target.dispatched_at is null and target.requested_by_user_id is null
      and target.completed_at is null and target.paused_at is null
      and target.resume_requested_at is null
  )
  and (
    new.proposed_by_agent_id is null
    or exists (
      select 1 from briar_project_agents agent
      where agent.id = new.proposed_by_agent_id
        and agent.project_id = new.project_id
        and agent.organization_id = new.organization_id
    )
  )
  and (
    (
      new.source_kind = 'channel'
      and new.proposed_by_agent_id is not null
      and exists (
        select 1
        from briar_channels channel
        join briar_channel_messages reply
          on reply.id = new.reply_message_id
         and reply.channel_id = channel.id
        join briar_channel_agents roster
          on roster.channel_id = channel.id
         and roster.agent_id = new.proposed_by_agent_id
        where channel.id = new.channel_id
          and channel.organization_id = new.organization_id
          and reply.author_agent_id = new.proposed_by_agent_id
      )
      and (
        (new.origin_create_proposal_id is null)
        or exists (
          select 1 from briar_channel_action_proposals origin
          where origin.id = new.origin_create_proposal_id
            and origin.channel_id = new.channel_id
            and origin.reply_message_id = new.reply_message_id
            and origin.result_run_id = new.target_run_id
            and origin.execution_proposal_id = new.id
            and origin.execute_after_create = 1
            and origin.status = 'accepted'
        )
      )
    )
    or
    (
      new.source_kind = 'issue'
      and exists (
        select 1
        from briar_hunt_runs conversation
        join briar_issue_messages reply
          on reply.id = new.reply_message_id
         and reply.run_id = conversation.id
         and reply.project_id = conversation.project_id
        where conversation.id = new.conversation_run_id
          and conversation.project_id = new.project_id
      )
      and (
        (
          new.origin_create_proposal_id is null
          and new.target_run_id = new.conversation_run_id
        )
        or exists (
          select 1 from briar_issue_action_proposals origin
          where origin.id = new.origin_create_proposal_id
            and origin.conversation_run_id = new.conversation_run_id
            and origin.reply_message_id = new.reply_message_id
            and origin.result_run_id = new.target_run_id
            and origin.execution_proposal_id = new.id
            and origin.execute_after_create = 1
            and origin.status = 'accepted'
        )
      )
    )
  )
)
BEGIN
  select raise(abort, 'invalid issue execution proposal');
END;

CREATE TRIGGER briar_channel_create_materialize_execution_proposal
after update of status on briar_channel_action_proposals
when old.status = 'pending' and new.status = 'accepted'
  and new.action_type = 'request_issue_create'
  and new.execute_after_create = 1
  and new.execution_proposal_id is not null
  and new.result_run_id is not null
BEGIN
  insert into briar_issue_execution_proposals (
    id, organization_id, project_id, source_kind, channel_id,
    conversation_run_id, trigger_message_id, reply_message_id,
    target_run_id, target_title, target_run_updated_at,
    proposed_by_agent_id, delegated_by_agent_id, delegated_by_agent_name,
    origin_create_proposal_id, created_at, updated_at
  )
  select new.execution_proposal_id, channel.organization_id, new.project_id,
         'channel', new.channel_id, null, new.trigger_message_id,
         new.reply_message_id, run.id, run.title, run.updated_at,
         reply.author_agent_id, parent.agent_id, parent_agent.name,
         new.id, new.accepted_at, new.accepted_at
  from briar_hunt_runs run
  join briar_channels channel on channel.id = new.channel_id
  join briar_channel_messages reply on reply.id = new.reply_message_id
  left join briar_channel_agent_reply_jobs child
    on child.reply_message_id = new.reply_message_id
  left join briar_channel_agent_reply_jobs parent
    on parent.id = child.delegated_by_reply_job_id
  left join briar_project_agents parent_agent on parent_agent.id = parent.agent_id
  where run.id = new.result_run_id and run.project_id = new.project_id
    and run.status = 'backlog' and run.stage = 'queued'
    and run.dispatch_request_id is null and run.claim_token_hash is null
  on conflict (id) do nothing;

  select raise(abort, 'channel execution proposal was not materialized')
  where not exists (
    select 1
    from briar_issue_execution_proposals proposal
    join briar_channels channel on channel.id = new.channel_id
    where proposal.id = new.execution_proposal_id
      and proposal.organization_id = channel.organization_id
      and proposal.project_id = new.project_id
      and proposal.source_kind = 'channel'
      and proposal.channel_id = new.channel_id
      and proposal.conversation_run_id is null
      and proposal.trigger_message_id = new.trigger_message_id
      and proposal.reply_message_id = new.reply_message_id
      and proposal.target_run_id = new.result_run_id
      and proposal.origin_create_proposal_id = new.id
      and proposal.status = 'pending'
      and proposal.dispatch_request_id is null
  );
END;

CREATE TRIGGER briar_issue_execution_dispatch_channel_source_guard
before update of dispatch_request_id on briar_hunt_runs
when new.dispatch_request_id is not null
  and new.dispatch_request_id is not old.dispatch_request_id
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.source_kind = 'channel'
  )
  and not exists (
    select 1
    from briar_issue_execution_proposals proposal
    join briar_channels channel on channel.id = proposal.channel_id
    join briar_organization_members membership
      on membership.organization_id = channel.organization_id
     and membership.user_id = proposal.approval_reserved_by_user_id
    join briar_channel_messages reply
      on reply.id = proposal.reply_message_id
     and reply.channel_id = channel.id
    join briar_project_agents agent
      on agent.id = proposal.proposed_by_agent_id
     and agent.id = reply.author_agent_id
     and agent.project_id = proposal.project_id
     and agent.organization_id = proposal.organization_id
    join briar_channel_agents roster
      on roster.channel_id = channel.id and roster.agent_id = agent.id
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.status = 'pending' and proposal.source_kind = 'channel'
      and channel.organization_id = proposal.organization_id
      and channel.archived_at is null
      and (
        channel.visibility = 'public'
        or exists (
          select 1 from briar_channel_members channel_member
          where channel_member.channel_id = channel.id
            and channel_member.user_id = proposal.approval_reserved_by_user_id
        )
      )
      and (
        proposal.delegated_by_agent_id is null
        or exists (
          select 1
          from briar_project_agents source_agent
          join briar_channel_agents source_roster
            on source_roster.channel_id = channel.id
           and source_roster.agent_id = source_agent.id
          join briar_channel_agent_reply_jobs child
            on child.reply_message_id = proposal.reply_message_id
          join briar_channel_agent_reply_jobs parent
            on parent.id = child.delegated_by_reply_job_id
           and parent.agent_id = source_agent.id
          where source_agent.id = proposal.delegated_by_agent_id
            and source_agent.organization_id = proposal.organization_id
            and source_agent.project_id is null
        )
      )
  )
BEGIN
  select raise(abort, 'channel execution proposal source is stale');
END;

CREATE TRIGGER briar_dashboard_issue_execution_proposals_insert_sync
after insert on briar_issue_execution_proposals
when new.source_kind = 'issue' BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.reply_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_issue_execution_proposals_update_sync
after update on briar_issue_execution_proposals
when new.source_kind = 'issue' BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.reply_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_issue_skill_proposals_insert_sync
after insert on briar_agent_skill_execution_proposals
when new.source_kind = 'issue' BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.reply_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_issue_skill_proposals_update_sync
after update on briar_agent_skill_execution_proposals
when new.source_kind = 'issue' BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.reply_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_issue_subscriptions_creator_insert
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

CREATE TRIGGER briar_agent_skills_max_count_insert
before insert on briar_agent_skills
when not exists (
  select 1 from briar_agent_skills existing
  where existing.id = new.id and existing.agent_id = new.agent_id
)
and (
  select count(*) from briar_agent_skills skill
  where skill.agent_id = new.agent_id
) >= 5
BEGIN
  select raise(abort, 'An Agent can have at most 5 Skills');
END;

CREATE TRIGGER briar_agent_skills_max_count_update
before update of agent_id on briar_agent_skills
when new.agent_id <> old.agent_id
and (
  select count(*) from briar_agent_skills skill
  where skill.agent_id = new.agent_id
) >= 5
BEGIN
  select raise(abort, 'An Agent can have at most 5 Skills');
END;

CREATE TRIGGER briar_channel_thread_subscriptions_author_insert
after insert on briar_channel_messages
when new.author_user_id is not null BEGIN
  insert into briar_channel_thread_subscriptions (
    root_message_id, channel_id, organization_id, user_id, created_at
  )
  select coalesce(new.parent_message_id, new.id), new.channel_id,
         channel.organization_id, new.author_user_id, new.created_at
  from briar_channels channel
  join briar_organization_members membership
    on membership.organization_id = channel.organization_id
   and membership.user_id = new.author_user_id
  where channel.id = new.channel_id
  on conflict (root_message_id, user_id) do nothing;
END;

CREATE TRIGGER briar_channel_thread_subscriptions_mention_insert
after insert on briar_channel_message_mentions BEGIN
  insert into briar_channel_thread_subscriptions (
    root_message_id, channel_id, organization_id, user_id, created_at
  )
  select coalesce(message.parent_message_id, message.id), message.channel_id,
         channel.organization_id, new.user_id, new.created_at
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  join briar_organization_members membership
    on membership.organization_id = channel.organization_id
   and membership.user_id = new.user_id
  where message.id = new.message_id
  on conflict (root_message_id, user_id) do nothing;
END;

CREATE TRIGGER briar_channel_notification_message_insert
after insert on briar_channel_messages
when new.parent_message_id is not null BEGIN
  insert into briar_channel_notification_inbox (
    user_id, organization_id, message_id, notification_reason, created_at
  )
  select subscription.user_id, subscription.organization_id, new.id,
         iif(root.author_user_id = subscription.user_id, 'thread_reply', 'subscription'),
         new.created_at
  from briar_channel_thread_subscriptions subscription
  join briar_channel_messages root
    on root.id = subscription.root_message_id
   and root.channel_id = new.channel_id
  where subscription.root_message_id = new.parent_message_id
    and (new.author_user_id is null
         or new.author_user_id <> subscription.user_id)
    and julianday(new.created_at) >= julianday(subscription.created_at)
  on conflict (user_id, message_id) do nothing;
END;

CREATE TRIGGER briar_channel_notification_mention_insert
after insert on briar_channel_message_mentions
BEGIN
  insert into briar_channel_notification_inbox (
    user_id, organization_id, message_id, notification_reason, created_at
  )
  select new.user_id, channel.organization_id, message.id,
         'mention', message.created_at
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = new.message_id
    and (message.author_user_id is null
         or message.author_user_id <> new.user_id)
  on conflict (user_id, message_id) do update set
    organization_id = excluded.organization_id,
    notification_reason = 'mention',
    created_at = excluded.created_at;
END;

CREATE TRIGGER briar_channel_notification_mention_delete
after delete on briar_channel_message_mentions
BEGIN
  delete from briar_channel_notification_inbox
  where user_id = old.user_id and message_id = old.message_id;

  insert into briar_channel_notification_inbox (
    user_id, organization_id, message_id, notification_reason, created_at
  )
  select subscription.user_id, subscription.organization_id, message.id,
         iif(root.author_user_id = subscription.user_id, 'thread_reply', 'subscription'),
         message.created_at
  from briar_channel_messages message
  join briar_channel_thread_subscriptions subscription
    on subscription.root_message_id = coalesce(
         message.parent_message_id, message.id
       )
   and subscription.user_id = old.user_id
  join briar_channel_messages root
    on root.id = subscription.root_message_id
   and root.channel_id = message.channel_id
  where message.id = old.message_id
    and message.parent_message_id is not null
    and (message.author_user_id is null
         or message.author_user_id <> old.user_id)
    and julianday(message.created_at) >= julianday(subscription.created_at)
  on conflict (user_id, message_id) do nothing;
END;

CREATE TRIGGER briar_issue_agent_reply_skill_snapshot_immutable
before update of selected_skill_id_snapshot, selected_agent_name_snapshot,
                 selected_agent_responsibility_snapshot,
                 selected_skill_name_snapshot,
                 selected_skill_instructions_snapshot,
                 selected_skill_kind_snapshot,
                 selected_skill_provider_snapshot,
                 selected_skill_model_snapshot,
                 selected_skill_effort_snapshot,
                 skill_execution_request_snapshot
on briar_issue_agent_reply_jobs
when new.selected_skill_id_snapshot is not old.selected_skill_id_snapshot
  or new.selected_agent_name_snapshot is not old.selected_agent_name_snapshot
  or new.selected_agent_responsibility_snapshot is not
    old.selected_agent_responsibility_snapshot
  or new.selected_skill_name_snapshot is not old.selected_skill_name_snapshot
  or new.selected_skill_instructions_snapshot is not
    old.selected_skill_instructions_snapshot
  or new.selected_skill_kind_snapshot is not old.selected_skill_kind_snapshot
  or new.selected_skill_provider_snapshot is not
    old.selected_skill_provider_snapshot
  or new.selected_skill_model_snapshot is not old.selected_skill_model_snapshot
  or new.selected_skill_effort_snapshot is not old.selected_skill_effort_snapshot
  or new.skill_execution_request_snapshot is not
    old.skill_execution_request_snapshot
begin
  select raise(abort, 'issue Agent Skill reply snapshot is immutable');
end;

CREATE TRIGGER briar_agent_skill_execution_issue_job_invalidate
after update of project_id, run_id, trigger_message_id, reply_message_id,
                skill_id, selected_skill_id_snapshot, status
on briar_issue_agent_reply_jobs
begin
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'issue' and source_reply_job_id = old.id
    and status = 'pending'
    and (new.project_id is not old.project_id
      or new.run_id is not old.run_id
      or new.trigger_message_id is not old.trigger_message_id
      or new.reply_message_id is not old.reply_message_id
      or new.skill_id is not old.skill_id
      or new.selected_skill_id_snapshot is not old.selected_skill_id_snapshot
      or new.status <> 'completed');
end;

CREATE TRIGGER briar_agent_skill_execution_issue_job_delete_invalidate
before delete on briar_issue_agent_reply_jobs
begin
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'issue' and source_reply_job_id = old.id
    and status = 'pending';
end;

CREATE TRIGGER briar_dashboard_issue_reply_jobs_insert_sync
after insert on briar_issue_agent_reply_jobs begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.trigger_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

CREATE TRIGGER briar_dashboard_issue_reply_jobs_update_sync
after update of status, claimed_worker_id, agent_provider, error, completed_at
on briar_issue_agent_reply_jobs begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.trigger_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

CREATE TRIGGER briar_project_stranded_run_child_delete_guard
before delete on briar_projects
when exists (
  select 1 from briar_run_child_storage_a_project_mismatches mismatch
  where mismatch.stale_project_id = old.id
     or mismatch.current_project_id = old.id
)
or exists (
  select 1 from briar_run_child_storage_b_project_mismatches mismatch
  where mismatch.stale_project_id = old.id
     or mismatch.current_project_id = old.id
)
or exists (
  select 1 from briar_run_child_relation_a_project_mismatches mismatch
  where mismatch.stale_project_id = old.id
     or mismatch.current_project_id = old.id
)
or exists (
  select 1 from briar_run_child_relation_b_project_mismatches mismatch
  where mismatch.stale_project_id = old.id
     or mismatch.current_project_id = old.id
)
begin
  select raise(abort, 'project has stranded transferred issue data');
end;

CREATE TRIGGER briar_agent_skill_execution_insert_guard
before insert on briar_agent_skill_execution_proposals
when not (
  new.status = 'pending' and new.generation = 1
  and new.requested_worker_id is null
  and new.requested_worker_label is null
  and new.result_session_id is null
  and new.accepted_by_user_id is null and new.accepted_at is null
  and exists (
    select 1
    from briar_projects project
    join briar_project_agents agent
      on agent.id = new.agent_id and agent.project_id = project.id
     and agent.organization_id = project.organization_id
    join briar_agent_skills skill
      on skill.id = new.skill_id and skill.agent_id = agent.id
    where project.id = new.project_id
      and project.organization_id = new.organization_id
      and agent.name = new.agent_name
      and agent.responsibility = new.agent_responsibility
      and skill.name = new.skill_name
      and skill.body = new.skill_instructions
      and skill.kind = new.skill_kind
      and skill.provider = new.provider
      and skill.model is new.model
      and skill.effort is new.effort
  )
  and not exists (
    select 1 from briar_issue_execution_proposals execution
    where execution.reply_message_id = new.reply_message_id
  )
  and not exists (
    select 1 from briar_channel_action_proposals action
    where new.source_kind = 'channel'
      and action.reply_message_id = new.reply_message_id
  )
  and not exists (
    select 1 from briar_issue_action_proposals action
    where new.source_kind = 'issue'
      and action.reply_message_id = new.reply_message_id
  )
  and not exists (
    select 1 from briar_issue_rework_proposals rework
    where new.source_kind = 'issue'
      and rework.reply_message_id = new.reply_message_id
  )
  and (
    (
      new.source_kind = 'channel'
      and exists (
        select 1
        from briar_channel_agent_reply_jobs job
        join briar_channels channel
          on channel.id = job.channel_id
         and channel.organization_id = job.organization_id
        join briar_channel_messages trigger_message
          on trigger_message.id = job.trigger_message_id
         and trigger_message.channel_id = job.channel_id
        join briar_channel_messages reply
          on reply.id = job.reply_message_id
         and reply.channel_id = job.channel_id
         and reply.author_agent_id = job.agent_id
        join briar_channel_agents roster
          on roster.channel_id = job.channel_id and roster.agent_id = job.agent_id
        where job.id = new.source_reply_job_id
          and job.organization_id = new.organization_id
          and job.channel_id = new.channel_id
          and job.project_id = new.project_id
          and job.agent_id = new.agent_id
          and job.skill_id = new.skill_id
          and job.selected_skill_id_snapshot = new.skill_id
          and job.selected_agent_name_snapshot = new.agent_name
          and job.selected_agent_responsibility_snapshot =
            new.agent_responsibility
          and job.selected_skill_name_snapshot = new.skill_name
          and job.selected_skill_instructions_snapshot = new.skill_instructions
          and job.selected_skill_kind_snapshot = new.skill_kind
          and job.selected_skill_provider_snapshot = new.provider
          and job.selected_skill_model_snapshot is new.model
          and job.selected_skill_effort_snapshot is new.effort
          and job.skill_execution_request_snapshot = new.request
          and job.trigger_message_id = new.trigger_message_id
          and job.reply_message_id = new.reply_message_id
          and job.status = 'completed'
          and channel.archived_at is null
          and (
            (job.delegated_by_reply_job_id is null
              and new.request = trigger_message.body)
            or
            (job.delegated_by_reply_job_id is not null
              and new.request = job.delegation_request)
          )
          and new.delegated_by_reply_job_id is job.delegated_by_reply_job_id
          and (
            (job.delegated_by_reply_job_id is null
              and new.delegated_by_agent_id is null
              and new.delegated_by_agent_name is null)
            or exists (
              select 1
              from briar_channel_agent_reply_jobs parent
              join briar_project_agents parent_agent
                on parent_agent.id = parent.agent_id
               and parent_agent.organization_id = job.organization_id
               and parent_agent.project_id is null
              join briar_channel_agents parent_roster
                on parent_roster.channel_id = job.channel_id
               and parent_roster.agent_id = parent_agent.id
              where parent.id = job.delegated_by_reply_job_id
                and parent.organization_id = job.organization_id
                and parent.channel_id = job.channel_id
                and parent.trigger_message_id = job.trigger_message_id
                and parent.project_id is null
                and parent.delegated_by_reply_job_id is null
                and parent.status = 'completed'
                and new.delegated_by_agent_id = parent_agent.id
                and new.delegated_by_agent_name = parent_agent.name
            )
          )
      )
    )
    or
    (
      new.source_kind = 'issue'
      and new.delegated_by_reply_job_id is null
      and new.delegated_by_agent_id is null
      and new.delegated_by_agent_name is null
      and exists (
        select 1
        from briar_issue_agent_reply_jobs job
        join briar_hunt_runs run
          on run.id = job.run_id and run.project_id = job.project_id
        join briar_issue_messages trigger_message
          on trigger_message.id = job.trigger_message_id
         and trigger_message.run_id = job.run_id
         and trigger_message.project_id = job.project_id
        join briar_issue_messages reply
          on reply.id = job.reply_message_id
         and reply.run_id = job.run_id and reply.project_id = job.project_id
        where job.id = new.source_reply_job_id
          and job.project_id = new.project_id
          and job.run_id = new.conversation_run_id
          and job.trigger_message_id = new.trigger_message_id
          and job.reply_message_id = new.reply_message_id
          and job.status = 'completed'
          and job.skill_id = new.skill_id
          and job.selected_skill_id_snapshot = new.skill_id
          and job.selected_agent_name_snapshot = new.agent_name
          and job.selected_agent_responsibility_snapshot =
            new.agent_responsibility
          and job.selected_skill_name_snapshot = new.skill_name
          and job.selected_skill_instructions_snapshot = new.skill_instructions
          and job.selected_skill_kind_snapshot = new.skill_kind
          and job.selected_skill_provider_snapshot = new.provider
          and job.selected_skill_model_snapshot is new.model
          and job.selected_skill_effort_snapshot is new.effort
          and job.skill_execution_request_snapshot = new.request
          and coalesce(job.agent_id, run.agent_id) = new.agent_id
          and trigger_message.body = new.request
      )
    )
  )
)
begin
  select raise(abort, 'invalid Agent Skill execution proposal');
end;

CREATE TRIGGER briar_project_agent_session_requester_immutable
before update of requested_by_user_id on briar_project_agent_sessions
when new.requested_by_user_id is not old.requested_by_user_id
  and not (
    old.requested_by_user_id is not null
    and new.requested_by_user_id is null
    and not exists (
      select 1 from "user" account
      where account.id = old.requested_by_user_id
    )
  )
begin
  select raise(abort, 'Agent Session requester is immutable');
end;

CREATE TRIGGER briar_managed_computers_state_transition
before update of state on briar_managed_computers
when new.state != old.state and not (
  (old.state = 'requested' and new.state in ('provisioning', 'failed', 'draining')) or
  (old.state = 'provisioning' and new.state in ('bootstrapping', 'failed', 'draining')) or
  (old.state = 'bootstrapping' and new.state in ('needs_setup', 'failed', 'draining')) or
  (old.state = 'needs_setup' and new.state in ('ready', 'failed', 'draining')) or
  (old.state = 'ready' and new.state in ('failed', 'draining')) or
  (old.state = 'failed' and new.state in ('requested', 'draining', 'terminated')) or
  (old.state = 'draining' and new.state in ('stopped', 'failed')) or
  (old.state = 'stopped' and new.state in ('terminated', 'failed'))
)
begin
  select raise(abort, 'invalid managed computer state transition');
end;

CREATE TRIGGER briar_channel_issue_batch_items_immutable_update
before update on briar_channel_issue_batch_items
BEGIN
  select raise(abort, 'channel issue batch mapping is immutable');
END;

CREATE TRIGGER briar_agent_transcript_segments_totals_after_insert
after insert on briar_agent_transcript_segments
begin
  update briar_agent_transcript_sessions
  set event_count = event_count + new.event_count,
      byte_count = byte_count + new.uncompressed_bytes
  where session_id = new.session_id;
end;

CREATE TRIGGER briar_agent_transcript_segments_totals_after_delete
after delete on briar_agent_transcript_segments
begin
  update briar_agent_transcript_sessions
  set event_count = event_count - old.event_count,
      byte_count = byte_count - old.uncompressed_bytes
  where session_id = old.session_id;
end;

CREATE TRIGGER briar_agent_transcript_segments_totals_after_update
after update of session_id, event_count, uncompressed_bytes
on briar_agent_transcript_segments
begin
  update briar_agent_transcript_sessions
  set event_count = event_count + new.event_count - old.event_count,
      byte_count = byte_count + new.uncompressed_bytes - old.uncompressed_bytes
  where session_id = new.session_id
    and old.session_id = new.session_id;

  update briar_agent_transcript_sessions
  set event_count = event_count - old.event_count,
      byte_count = byte_count - old.uncompressed_bytes
  where session_id = old.session_id
    and old.session_id <> new.session_id;

  update briar_agent_transcript_sessions
  set event_count = event_count + new.event_count,
      byte_count = byte_count + new.uncompressed_bytes
  where session_id = new.session_id
    and old.session_id <> new.session_id;
end;

CREATE TRIGGER briar_agent_skill_execution_mode_insert_guard
before insert on briar_agent_skill_execution_proposals
when not (
  exists (
    select 1 from briar_agent_skills skill
    where skill.id = new.skill_id and skill.agent_id = new.agent_id
      and skill.execution_mode = new.execution_mode
      and skill.approval_policy = new.approval_policy
  )
  and (
    (new.source_kind = 'channel'
      and new.channel_id is not null
      and new.thread_root_message_id is not null
      and exists (
        select 1 from briar_channel_agent_reply_jobs job
        where job.id = new.source_reply_job_id
          and job.channel_id = new.channel_id
          and job.parent_message_id = new.thread_root_message_id
          and job.trigger_message_id = new.trigger_message_id
      ))
    or
    (new.source_kind = 'issue'
      and new.channel_id is null
      and new.execution_mode = 'task'
      and new.thread_root_message_id is not null
      and exists (
        select 1 from briar_issue_agent_reply_jobs job
        where job.id = new.source_reply_job_id
          and job.run_id = new.conversation_run_id
          and job.parent_message_id = new.thread_root_message_id
          and job.trigger_message_id = new.trigger_message_id
      ))
  )
)
begin
  select raise(abort, 'invalid Agent Skill execution mode or origin');
end;

CREATE TRIGGER briar_agent_skill_execution_result_job_insert_guard
before insert on briar_channel_agent_reply_jobs
when new.approved_skill_execution_proposal_id is not null
  and not exists (
    select 1
    from briar_agent_skill_execution_proposals proposal
    join briar_channel_agent_reply_jobs source
      on source.id = proposal.source_reply_job_id
     and source.session_id = proposal.result_session_id
    where proposal.id = new.approved_skill_execution_proposal_id
      and proposal.status = 'accepted'
      and proposal.source_kind = 'channel'
      and proposal.execution_mode = 'conversation'
      and proposal.channel_id = new.channel_id
      and proposal.project_id = new.project_id
      and proposal.agent_id = new.agent_id
      and proposal.skill_id = new.skill_id
      and proposal.result_session_id = new.session_id
      and proposal.result_reply_job_id = new.id
      and proposal.result_message_id = new.reply_message_id
      and proposal.reply_message_id = new.trigger_message_id
      and proposal.thread_root_message_id = new.parent_message_id
      and proposal.request = new.skill_execution_request_snapshot
      and proposal.skill_id = new.selected_skill_id_snapshot
      and proposal.agent_name = new.selected_agent_name_snapshot
      and proposal.agent_responsibility =
        new.selected_agent_responsibility_snapshot
      and proposal.skill_name = new.selected_skill_name_snapshot
      and proposal.skill_instructions =
        new.selected_skill_instructions_snapshot
      and proposal.skill_kind = new.selected_skill_kind_snapshot
      and proposal.provider = new.selected_skill_provider_snapshot
      and proposal.model is new.selected_skill_model_snapshot
      and proposal.effort is new.selected_skill_effort_snapshot
  )
begin
  select raise(abort, 'invalid approved Agent Skill conversation job');
end;

CREATE TRIGGER briar_agent_skill_execution_result_job_origin_immutable
before update of approved_skill_execution_proposal_id
on briar_channel_agent_reply_jobs
when new.approved_skill_execution_proposal_id is not
  old.approved_skill_execution_proposal_id
begin
  select raise(abort, 'approved Agent Skill conversation origin is immutable');
end;

CREATE TRIGGER briar_agent_skill_execution_result_job_failure_publish
after update of status on briar_channel_agent_reply_jobs
when old.status in ('queued', 'running') and new.status = 'failed'
  and new.approved_skill_execution_proposal_id is not null
begin
  insert or ignore into briar_channel_messages (
    id, channel_id, parent_message_id, author_user_id, author_agent_id,
    author_agent_name, author_agent_provider, body, created_at, updated_at
  )
  select proposal.result_message_id, proposal.channel_id,
         proposal.thread_root_message_id, null, proposal.agent_id,
         proposal.agent_name, proposal.provider,
         '**Skill execution failed**' || char(10) || char(10) ||
           substr(coalesce(new.error, 'The Skill failed without an error summary.'),
                  1, 9000),
         new.updated_at, new.updated_at
  from briar_agent_skill_execution_proposals proposal
  where proposal.id = new.approved_skill_execution_proposal_id
    and proposal.status = 'accepted'
    and proposal.execution_mode = 'conversation'
    and proposal.result_reply_job_id = new.id
    and proposal.result_message_id = new.reply_message_id
    and exists (
      select 1 from briar_channel_messages root
      where root.id = proposal.thread_root_message_id
        and root.channel_id = proposal.channel_id
        and root.parent_message_id is null
    );
end;

CREATE TRIGGER briar_agent_skill_execution_mode_immutable
before update of execution_mode, approval_policy, thread_root_message_id
on briar_agent_skill_execution_proposals
when new.execution_mode is not old.execution_mode
  or new.approval_policy is not old.approval_policy
  or new.thread_root_message_id is not old.thread_root_message_id
begin
  select raise(abort, 'Agent Skill execution mode and origin are immutable');
end;

CREATE TRIGGER briar_agent_skill_execution_result_origin_immutable
before update of result_reply_job_id, result_message_id
on briar_agent_skill_execution_proposals
when not (
  (old.status = 'pending' and new.status = 'accepted'
    and old.result_reply_job_id is null and old.result_message_id is null
    and (
      (new.execution_mode = 'task'
        and new.result_reply_job_id is null and new.result_message_id is null)
      or
      (new.execution_mode = 'conversation'
        and new.result_reply_job_id is not null
        and new.result_message_id is not null)
    ))
  or
  (old.status = 'accepted' and new.status = 'accepted'
    and new.execution_mode = 'task'
    and old.result_reply_job_id is null and new.result_reply_job_id is null
    and old.result_message_id is null and new.result_message_id is not null
    and exists (
      select 1 from briar_project_agent_task_jobs task
      where task.id = new.result_session_id
        and task.skill_execution_proposal_id = new.id
        and task.status in ('completed', 'failed')
    ))
  or
  (new.result_reply_job_id is old.result_reply_job_id
    and new.result_message_id is old.result_message_id)
)
begin
  select raise(abort, 'Agent Skill execution result origin is immutable');
end;

CREATE TRIGGER briar_channel_issue_proposal_decline_guard
before update of declined_by_user_id, declined_at
on briar_channel_action_proposals
when not (
  old.action_type = 'request_issue_create'
  and old.status = 'pending'
  and old.declined_by_user_id is null
  and old.declined_at is null
  and old.accepted_by_user_id is null
  and old.accepted_at is null
  and old.issue_source_key is null
  and new.declined_by_user_id is not null
  and new.declined_at is not null
)
begin
  select raise(abort, 'channel issue proposal decline is immutable');
end;

CREATE TRIGGER briar_channel_issue_proposal_declined_accept_guard
before update of status, accepted_by_user_id, accepted_at, issue_source_key
on briar_channel_action_proposals
when old.action_type = 'request_issue_create'
  and old.declined_at is not null
  and (
    new.status is not old.status
    or new.accepted_by_user_id is not old.accepted_by_user_id
    or new.accepted_at is not old.accepted_at
    or new.issue_source_key is not old.issue_source_key
  )
begin


  select raise(ignore);
end;

CREATE TRIGGER briar_dashboard_attachments_insert_sync
after insert on briar_issue_attachments BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'run', new.run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_attachments_delete_sync
after delete on briar_issue_attachments BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'run', old.run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_members_insert_sync
after insert on briar_organization_members BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select id, 'metadata', new.user_id, 'replace', datetime('now')
    from briar_projects where organization_id = new.organization_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select change.project_id, max(change.version)
    from briar_dashboard_changes change
    join briar_projects project on project.id = change.project_id
   where project.organization_id = new.organization_id
     and change.entity_type = 'metadata'
   group by change.project_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_members_update_sync
after update on briar_organization_members BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select id, 'metadata', new.user_id, 'replace', datetime('now')
    from briar_projects where organization_id = new.organization_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select change.project_id, max(change.version)
    from briar_dashboard_changes change
    join briar_projects project on project.id = change.project_id
   where project.organization_id = new.organization_id
     and change.entity_type = 'metadata'
   group by change.project_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_members_delete_sync
after delete on briar_organization_members BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select id, 'metadata', old.user_id, 'replace', datetime('now')
    from briar_projects where organization_id = old.organization_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select change.project_id, max(change.version)
    from briar_dashboard_changes change
    join briar_projects project on project.id = change.project_id
   where project.organization_id = old.organization_id
     and change.entity_type = 'metadata'
   group by change.project_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_issue_execution_org_member_remove_invalidate
after delete on briar_organization_members
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where organization_id = old.organization_id and status = 'pending'
    and approval_reserved_by_user_id = old.user_id;
END;

CREATE TRIGGER briar_agent_skill_execution_worker_membership_reconcile
before delete on briar_organization_members
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker owner lost organization access.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where status in ('queued', 'running')
    and skill_execution_proposal_id is not null
    and preferred_worker_id in (
      select worker.id
      from briar_execution_workers worker
      join briar_execution_worker_devices device on device.id = worker.device_id
      where device.organization_id = old.organization_id
        and device.owner_user_id = old.user_id
    );
END;

CREATE TRIGGER briar_project_members_insert_sync
after insert on briar_project_members BEGIN
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, 1)
  on conflict (project_id) do update set
    current_version = briar_dashboard_sync_state.current_version + 1;
END;

CREATE TRIGGER briar_project_members_delete_sync
before delete on briar_project_members BEGIN
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, 1)
  on conflict (project_id) do update set
    current_version = briar_dashboard_sync_state.current_version + 1;
END;

CREATE TRIGGER briar_issue_subscriptions_insert_sync
after insert on briar_issue_subscriptions BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  )
  select run.project_id, 'run', run.id, 'upsert', datetime('now')
  from briar_hunt_runs run where run.id = new.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select run.project_id, last_insert_rowid()
  from briar_hunt_runs run where run.id = new.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_issue_subscriptions_delete_sync
before delete on briar_issue_subscriptions BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  )
  select run.project_id, 'run', run.id, 'upsert', datetime('now')
  from briar_hunt_runs run where run.id = old.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select run.project_id, last_insert_rowid()
  from briar_hunt_runs run where run.id = old.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_channel_thread_subscriptions_insert_sync
after insert on briar_channel_thread_subscriptions BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'message', new.root_message_id,
    'upsert', datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_channel_thread_subscriptions_delete_sync
before delete on briar_channel_thread_subscriptions BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    old.organization_id, old.channel_id, 'message', old.root_message_id,
    'upsert', datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (old.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  values (old.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = old.organization_id
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = old.organization_id
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_mobile_push_outbox_sync_delete
after delete on briar_organization_inbox_sync_state BEGIN
  delete from briar_mobile_push_outbox
  where organization_id = old.organization_id;
END;

CREATE TRIGGER briar_projects_sync_team_after_insert
after insert on briar_projects BEGIN
  insert or ignore into briar_teams (
    id, owner_user_id, name, agent_token_hash, created_at, updated_at,
    organization_id, icon_data_url, icon_data_url_browser, issue_key_prefix,
    schedule_tab_enabled
  ) values (
    new.id, new.owner_user_id, new.name, new.agent_token_hash,
    new.created_at, new.updated_at, new.organization_id, new.icon_data_url,
    new.icon_data_url_browser, new.issue_key_prefix, new.schedule_tab_enabled
  );
  update briar_teams
  set owner_user_id = new.owner_user_id,
      name = new.name,
      agent_token_hash = new.agent_token_hash,
      created_at = new.created_at,
      updated_at = new.updated_at,
      organization_id = new.organization_id,
      icon_data_url = new.icon_data_url,
      icon_data_url_browser = new.icon_data_url_browser,
      issue_key_prefix = new.issue_key_prefix,
      schedule_tab_enabled = new.schedule_tab_enabled
  where id = new.id and (
    owner_user_id is not new.owner_user_id or name is not new.name
    or agent_token_hash is not new.agent_token_hash
    or created_at is not new.created_at or updated_at is not new.updated_at
    or organization_id is not new.organization_id
    or icon_data_url is not new.icon_data_url
    or icon_data_url_browser is not new.icon_data_url_browser
    or issue_key_prefix is not new.issue_key_prefix
    or schedule_tab_enabled is not new.schedule_tab_enabled
  );
END;

CREATE TRIGGER briar_projects_sync_team_after_update
after update on briar_projects BEGIN
  update briar_teams
  set owner_user_id = new.owner_user_id,
      name = new.name,
      agent_token_hash = new.agent_token_hash,
      created_at = new.created_at,
      updated_at = new.updated_at,
      organization_id = new.organization_id,
      icon_data_url = new.icon_data_url,
      icon_data_url_browser = new.icon_data_url_browser,
      issue_key_prefix = new.issue_key_prefix,
      schedule_tab_enabled = new.schedule_tab_enabled
  where id = new.id and (
    owner_user_id is not new.owner_user_id or name is not new.name
    or agent_token_hash is not new.agent_token_hash
    or created_at is not new.created_at or updated_at is not new.updated_at
    or organization_id is not new.organization_id
    or icon_data_url is not new.icon_data_url
    or icon_data_url_browser is not new.icon_data_url_browser
    or issue_key_prefix is not new.issue_key_prefix
    or schedule_tab_enabled is not new.schedule_tab_enabled
  );
END;

CREATE TRIGGER briar_projects_sync_team_after_delete
after delete on briar_projects BEGIN
  delete from briar_teams where id = old.id;
END;

CREATE TRIGGER briar_teams_sync_legacy_after_insert
after insert on briar_teams BEGIN
  insert or ignore into briar_projects (
    id, owner_user_id, name, agent_token_hash, created_at, updated_at,
    organization_id, icon_data_url, icon_data_url_browser, issue_key_prefix,
    schedule_tab_enabled
  ) values (
    new.id, new.owner_user_id, new.name, new.agent_token_hash,
    new.created_at, new.updated_at, new.organization_id, new.icon_data_url,
    new.icon_data_url_browser, new.issue_key_prefix, new.schedule_tab_enabled
  );
  update briar_projects
  set owner_user_id = new.owner_user_id,
      name = new.name,
      agent_token_hash = new.agent_token_hash,
      created_at = new.created_at,
      updated_at = new.updated_at,
      organization_id = new.organization_id,
      icon_data_url = new.icon_data_url,
      icon_data_url_browser = new.icon_data_url_browser,
      issue_key_prefix = new.issue_key_prefix,
      schedule_tab_enabled = new.schedule_tab_enabled
  where id = new.id and (
    owner_user_id is not new.owner_user_id or name is not new.name
    or agent_token_hash is not new.agent_token_hash
    or created_at is not new.created_at or updated_at is not new.updated_at
    or organization_id is not new.organization_id
    or icon_data_url is not new.icon_data_url
    or icon_data_url_browser is not new.icon_data_url_browser
    or issue_key_prefix is not new.issue_key_prefix
    or schedule_tab_enabled is not new.schedule_tab_enabled
  );
END;

CREATE TRIGGER briar_teams_sync_legacy_after_update
after update on briar_teams BEGIN
  update briar_projects
  set owner_user_id = new.owner_user_id,
      name = new.name,
      agent_token_hash = new.agent_token_hash,
      created_at = new.created_at,
      updated_at = new.updated_at,
      organization_id = new.organization_id,
      icon_data_url = new.icon_data_url,
      icon_data_url_browser = new.icon_data_url_browser,
      issue_key_prefix = new.issue_key_prefix,
      schedule_tab_enabled = new.schedule_tab_enabled
  where id = new.id and (
    owner_user_id is not new.owner_user_id or name is not new.name
    or agent_token_hash is not new.agent_token_hash
    or created_at is not new.created_at or updated_at is not new.updated_at
    or organization_id is not new.organization_id
    or icon_data_url is not new.icon_data_url
    or icon_data_url_browser is not new.icon_data_url_browser
    or issue_key_prefix is not new.issue_key_prefix
    or schedule_tab_enabled is not new.schedule_tab_enabled
  );
END;

CREATE TRIGGER briar_teams_sync_legacy_after_delete
after delete on briar_teams BEGIN
  delete from briar_projects where id = old.id;
END;

CREATE TRIGGER briar_teams_delete_issues_before_projects
before delete on briar_teams BEGIN
  delete from briar_hunt_runs where project_id = old.id;
END;

CREATE TRIGGER briar_hunt_runs_assign_default_project
after insert on briar_hunt_runs
when new.planning_project_id is null BEGIN
  update briar_hunt_runs
  set team_id = coalesce(new.team_id, new.project_id),
      planning_project_id = (
    select project.id
    from briar_planning_projects project
    where project.team_id = new.project_id and project.is_default = 1
  )
  where id = new.id;
END;

CREATE TRIGGER briar_hunt_runs_validate_team_insert
before insert on briar_hunt_runs
when new.team_id is not null and new.team_id <> new.project_id BEGIN
  select raise(abort, 'legacy project id must match issue team');
END;

CREATE TRIGGER briar_hunt_runs_sync_team_after_insert
after insert on briar_hunt_runs
when new.team_id is null BEGIN
  update briar_hunt_runs set team_id = new.project_id where id = new.id;
END;

CREATE TRIGGER briar_hunt_runs_validate_team_update
before update of team_id on briar_hunt_runs
when new.team_id is null or new.team_id <> new.project_id BEGIN
  select raise(abort, 'legacy project id must match issue team');
END;

CREATE TRIGGER briar_hunt_runs_validate_project_insert
before insert on briar_hunt_runs
when new.planning_project_id is not null BEGIN
  select case when not exists (
    select 1 from briar_planning_projects project
    where project.id = new.planning_project_id
      and project.team_id = new.project_id
  ) then raise(abort, 'issue project must belong to its team') end;
END;

CREATE TRIGGER briar_hunt_runs_validate_project_update
before update of planning_project_id on briar_hunt_runs BEGIN
  select case when new.planning_project_id is null or not exists (
    select 1 from briar_planning_projects project
    where project.id = new.planning_project_id
      and project.team_id = new.project_id
  ) then raise(abort, 'issue project must belong to its team') end;
END;

CREATE TRIGGER briar_hunt_runs_reclassify_after_team_transfer
after update of project_id on briar_hunt_runs
when old.project_id <> new.project_id BEGIN
  update briar_hunt_runs
  set team_id = new.project_id,
      planning_project_id = (
    select project.id
    from briar_planning_projects project
    where project.team_id = new.project_id and project.is_default = 1
  )
  where id = new.id;
END;

CREATE TRIGGER briar_teams_create_default_project_after_insert
after insert on briar_teams BEGIN
  insert into briar_planning_projects (
    id, team_id, name, description, status, sort_order, is_default,
    created_at, updated_at
  ) values (
    lower(
      hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' ||
      '4' || substr(hex(randomblob(2)), 2) || '-' ||
      substr('89ab', 1 + abs(random()) % 4, 1) ||
      substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    ),
    new.id, 'General', '', 'active', 0, 1, new.created_at, new.updated_at
  );
END;

CREATE TRIGGER briar_planning_projects_validate_lead_insert
before insert on briar_planning_projects
when new.lead_user_id is not null BEGIN
  select case when not exists (
    select 1
    from briar_teams team
    join briar_organization_members membership
      on membership.organization_id = team.organization_id
     and membership.user_id = new.lead_user_id
    left join briar_project_members team_membership
      on team_membership.project_id = team.id
     and team_membership.user_id = membership.user_id
    where team.id = new.team_id
      and (
        membership.role in ('owner', 'co-owner')
        or team_membership.user_id is not null
      )
  ) then raise(abort, 'project lead must have access to its team') end;
END;

CREATE TRIGGER briar_planning_projects_validate_lead_update
before update of lead_user_id, team_id on briar_planning_projects
when new.lead_user_id is not null BEGIN
  select case when not exists (
    select 1
    from briar_teams team
    join briar_organization_members membership
      on membership.organization_id = team.organization_id
     and membership.user_id = new.lead_user_id
    left join briar_project_members team_membership
      on team_membership.project_id = team.id
     and team_membership.user_id = membership.user_id
    where team.id = new.team_id
      and (
        membership.role in ('owner', 'co-owner')
        or team_membership.user_id is not null
      )
  ) then raise(abort, 'project lead must have access to its team') end;
END;

CREATE TRIGGER briar_agent_skill_execution_skill_update_invalidate
after update of body, provider, model, effort, execution_mode, approval_policy
on briar_agent_skills
when new.body is not old.body
  or new.provider is not old.provider
  or new.model is not old.model
  or new.effort is not old.effort
  or new.execution_mode is not old.execution_mode
  or new.approval_policy is not old.approval_policy
begin
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where skill_id = old.id and status = 'pending'
    and (
      new.body is not skill_instructions
      or new.provider is not provider
      or new.model is not model
      or new.effort is not effort
      or new.execution_mode is not execution_mode
      or new.approval_policy is not approval_policy
    );

  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Skill runtime changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where status in ('queued', 'running')
    and skill_execution_proposal_id in (
      select approval.proposal_id
      from briar_agent_skill_execution_approval_audit approval
      where approval.skill_id = old.id
        and (
          new.body is not approval.skill_instructions
          or new.provider is not approval.provider
          or new.model is not approval.model
          or new.effort is not approval.effort
          or new.execution_mode is not approval.execution_mode
          or new.approval_policy is not approval.approval_policy
        )
    );

  update briar_channel_agent_reply_jobs
  set status = 'failed',
      error = 'Approved Skill runtime changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_device_id = null, claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where status in ('queued', 'running')
    and approved_skill_execution_proposal_id in (
      select proposal.id
      from briar_agent_skill_execution_proposals proposal
      where proposal.skill_id = old.id and proposal.status = 'accepted'
        and (
          new.body is not proposal.skill_instructions
          or new.provider is not proposal.provider
          or new.model is not proposal.model
          or new.effort is not proposal.effort
          or new.execution_mode is not proposal.execution_mode
          or new.approval_policy is not proposal.approval_policy
        )
    );
end;

CREATE TRIGGER briar_agent_skill_execution_task_terminal_project
after update of status on briar_project_agent_task_jobs
when new.skill_execution_proposal_id is not null
  and new.status in ('completed', 'failed')
  and (
    old.status in ('queued', 'running')
    or (
      old.status = new.status
      and (
        new.completed_at is null
        or exists (
          select 1 from briar_project_agent_sessions session
          where session.project_id = new.project_id and session.id = new.id
            and (
              session.status is not new.status
              or julianday(new.completed_at) < julianday(session.started_at)
            )
        )
        or not exists (
          select 1 from briar_project_agent_session_summaries summary
          where summary.project_id = new.project_id
            and summary.session_id = new.id
            and json_extract(summary.summary_json, '$.status') = new.status
        )
        or not exists (
          select 1
          from briar_agent_skill_execution_proposals proposal
          left join briar_channel_messages channel_message
            on proposal.source_kind = 'channel'
           and channel_message.id = proposal.result_message_id
          left join briar_issue_messages issue_message
            on proposal.source_kind = 'issue'
           and issue_message.id = proposal.result_message_id
          where proposal.id = new.skill_execution_proposal_id
            and proposal.result_message_id is not null
            and (
              channel_message.id is not null or issue_message.id is not null
            )
        )
      )
    )
  )
begin
  update briar_project_agent_task_jobs
  set completed_at = case
        when julianday(strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) <
             julianday((
               select session.started_at
               from briar_project_agent_sessions session
               where session.project_id = new.project_id
                 and session.id = new.id
             ))
          then (
            select session.started_at
            from briar_project_agent_sessions session
            where session.project_id = new.project_id and session.id = new.id
          )
        else strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      end,
      updated_at = case
        when julianday(strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) <
             julianday((
               select session.started_at
               from briar_project_agent_sessions session
               where session.project_id = new.project_id
                 and session.id = new.id
             ))
          then (
            select session.started_at
            from briar_project_agent_sessions session
            where session.project_id = new.project_id and session.id = new.id
          )
        else strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      end
  where project_id = new.project_id and id = new.id;

  update briar_project_agent_sessions
  set status = new.status,
      payload_json = json_insert(
        json_set(
          payload_json,
          '$.status', new.status,
          '$.summary', new.result_summary,
          '$.conversationId', new.result_conversation_id,
          '$.error', new.error,
          '$.completedAt', (
            select task.completed_at
            from briar_project_agent_task_jobs task
            where task.project_id = new.project_id and task.id = new.id
          ),
          '$.updatedAt', (
            select task.updated_at
            from briar_project_agent_task_jobs task
            where task.project_id = new.project_id and task.id = new.id
          )
        ),
        '$.events[#]', json_object(
          'id', lower(hex(randomblob(16))),
          'type', new.status,
          'occurredAt', (
            select task.completed_at
            from briar_project_agent_task_jobs task
            where task.project_id = new.project_id and task.id = new.id
          )
        )
      ),
      completed_at = (
        select task.completed_at
        from briar_project_agent_task_jobs task
        where task.project_id = new.project_id and task.id = new.id
      ),
      updated_at = (
        select task.updated_at
        from briar_project_agent_task_jobs task
        where task.project_id = new.project_id and task.id = new.id
      )
  where project_id = new.project_id and id = new.id;

  insert into briar_project_agent_session_summaries (
    project_id, session_id, summary_json, updated_at, archived
  )
  select session.project_id, session.id,
         json_object(
           'dispatchGroupId', coalesce(
             json_extract(session.payload_json, '$.dispatchGroupId'),
             session.id
           ),
           'agentId', coalesce(
             json_extract(session.payload_json, '$.agentId'),
             session.agent_id
           ),
           'agentName', json_extract(session.payload_json, '$.agentName'),
           'skillId', json_extract(session.payload_json, '$.skillId'),
           'sessionType', coalesce(
             json_extract(session.payload_json, '$.sessionType'),
             session.session_type
           ),
           'trigger', json_extract(session.payload_json, '$.trigger'),
           'scheduleId', json_extract(session.payload_json, '$.scheduleId'),
           'scheduleRunId',
             json_extract(session.payload_json, '$.scheduleRunId'),
           'parentSessionId',
             json_extract(session.payload_json, '$.parentSessionId'),
           'requestedByUserId', session.requested_by_user_id,
           'request', substr(
             json_extract(session.payload_json, '$.request'), 1, 500
           ),
           'status', session.status,
           'issues', json(coalesce(
             json_extract(session.payload_json, '$.issues'), '[]'
           )),
           'startedAt', session.started_at,
           'completedAt', session.completed_at,
           'inboxVersion', 'session:v1:' || session.status || ':' ||
             coalesce(session.completed_at, session.started_at),
           'requestedWorkerId',
             json_extract(session.payload_json, '$.requestedWorkerId'),
           'workerId', json_extract(session.payload_json, '$.workerId'),
           'updatedAt', session.updated_at
         ),
         session.updated_at, 0
  from briar_project_agent_sessions session
  where session.project_id = new.project_id and session.id = new.id
  on conflict (project_id, session_id) do update set
    summary_json = excluded.summary_json,
    updated_at = excluded.updated_at,
    archived = 0;

  update briar_agent_skill_execution_proposals
  set result_message_id = coalesce(
        result_message_id,
        lower(hex(randomblob(4))) || '-' ||
        lower(hex(randomblob(2))) || '-' ||
        lower(hex(randomblob(2))) || '-' ||
        lower(hex(randomblob(2))) || '-' ||
        lower(hex(randomblob(6)))
      ),
      updated_at = (
        select task.updated_at
        from briar_project_agent_task_jobs task
        where task.project_id = new.project_id and task.id = new.id
      )
  where id = new.skill_execution_proposal_id
    and status = 'accepted' and execution_mode = 'task'
    and result_session_id = new.id;

  insert into briar_channel_messages (
    id, channel_id, parent_message_id, author_user_id, author_agent_id,
    author_agent_name, author_agent_provider, body, created_at, updated_at
  )
  select proposal.result_message_id, proposal.channel_id,
         proposal.thread_root_message_id, null, proposal.agent_id,
         proposal.agent_name, proposal.provider,
         case when new.status = 'completed'
           then '**Skill execution completed**'
           else '**Skill execution failed**' end || char(10) || char(10) ||
           substr(case when new.status = 'completed'
             then coalesce(
               new.result_summary, 'The Skill completed without a summary.'
             )
             else coalesce(
               new.error, 'The Skill failed without an error summary.'
             ) end, 1, 9000) || char(10) || char(10) ||
           '[View Agent Session](briar-companion://sessions/' ||
           new.project_id || '/' || new.id || ')',
         task.completed_at, task.completed_at
  from briar_agent_skill_execution_proposals proposal
  join briar_project_agent_task_jobs task
    on task.project_id = proposal.project_id
   and task.id = proposal.result_session_id
  where proposal.id = new.skill_execution_proposal_id
    and proposal.source_kind = 'channel'
    and proposal.result_message_id is not null
    and exists (
      select 1 from briar_channel_messages root
      where root.id = proposal.thread_root_message_id
        and root.channel_id = proposal.channel_id
        and root.parent_message_id is null
    )
  on conflict (id) do update set
    body = excluded.body,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

  insert into briar_issue_messages (
    id, project_id, run_id, parent_message_id, author_user_id,
    author_agent_id, author_agent_name, author_agent_provider,
    body, created_at, updated_at
  )
  select proposal.result_message_id, proposal.project_id,
         proposal.conversation_run_id, proposal.thread_root_message_id,
         null, proposal.agent_id, proposal.agent_name, proposal.provider,
         case when new.status = 'completed'
           then '**Skill execution completed**'
           else '**Skill execution failed**' end || char(10) || char(10) ||
           substr(case when new.status = 'completed'
             then coalesce(
               new.result_summary, 'The Skill completed without a summary.'
             )
             else coalesce(
               new.error, 'The Skill failed without an error summary.'
             ) end, 1, 9000) || char(10) || char(10) ||
           '[View Agent Session](briar-companion://sessions/' ||
           new.project_id || '/' || new.id || ')',
         task.completed_at, task.completed_at
  from briar_agent_skill_execution_proposals proposal
  join briar_project_agent_task_jobs task
    on task.project_id = proposal.project_id
   and task.id = proposal.result_session_id
  where proposal.id = new.skill_execution_proposal_id
    and proposal.source_kind = 'issue'
    and proposal.result_message_id is not null
    and exists (
      select 1 from briar_issue_messages root
      where root.id = proposal.thread_root_message_id
        and root.project_id = proposal.project_id
        and root.run_id = proposal.conversation_run_id
    )
  on conflict (id) do update set
    body = excluded.body,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;




  insert into briar_channel_notification_inbox (
    user_id, organization_id, message_id, notification_reason, created_at
  )
  select subscription.user_id, subscription.organization_id, message.id,
         iif(root.author_user_id = subscription.user_id,
             'thread_reply', 'subscription'),
         message.created_at
  from briar_agent_skill_execution_proposals proposal
  join briar_channel_messages message
    on message.id = proposal.result_message_id
   and message.channel_id = proposal.channel_id
  join briar_channel_thread_subscriptions subscription
    on subscription.root_message_id = proposal.thread_root_message_id
  join briar_channel_messages root
    on root.id = subscription.root_message_id
   and root.channel_id = proposal.channel_id
  where proposal.id = new.skill_execution_proposal_id
    and proposal.source_kind = 'channel'
    and (message.author_user_id is null
         or message.author_user_id <> subscription.user_id)
    and julianday(message.created_at) >= julianday(subscription.created_at)
  on conflict (user_id, message_id) do update set
    organization_id = excluded.organization_id,
    notification_reason = excluded.notification_reason,
    created_at = excluded.created_at;

  insert into briar_agent_skill_execution_realtime_outbox (
    task_id, organization_id, project_id, source_kind,
    channel_cursor, project_cursor, session_version, updated_at
  )
  select new.id, proposal.organization_id, proposal.project_id,
         proposal.source_kind,
         case when proposal.source_kind = 'channel'
           then coalesce(channel_state.current_version, 0) else null end,
         case when proposal.source_kind = 'issue'
           then coalesce(project_state.current_version, 0) else null end,
         coalesce(session_state.current_version, 0),
         task.updated_at
  from briar_agent_skill_execution_proposals proposal
  join briar_project_agent_task_jobs task
    on task.project_id = proposal.project_id
   and task.id = proposal.result_session_id
  left join briar_channel_sync_state channel_state
    on channel_state.organization_id = proposal.organization_id
  left join briar_dashboard_sync_state project_state
    on project_state.project_id = proposal.project_id
  left join briar_project_agent_session_sync_state session_state
    on session_state.project_id = proposal.project_id
  where proposal.id = new.skill_execution_proposal_id
  on conflict (task_id) do update set
    channel_cursor = case when excluded.source_kind = 'channel' then max(
        coalesce(briar_agent_skill_execution_realtime_outbox.channel_cursor, 0),
        excluded.channel_cursor
      ) else null end,
    project_cursor = case when excluded.source_kind = 'issue' then max(
        coalesce(briar_agent_skill_execution_realtime_outbox.project_cursor, 0),
        excluded.project_cursor
      ) else null end,
    session_version = max(
      briar_agent_skill_execution_realtime_outbox.session_version,
      excluded.session_version
    ),
    updated_at = excluded.updated_at;
end;

pragma defer_foreign_keys = off;
