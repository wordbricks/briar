import {
  agentSkillExecutionApprovalTablesAvailable,
  issueExecutionApprovalTablesAvailable,
} from "./execution-approval-schema-repository";
import { type IssueAttachmentInput } from "./issue-attachment-repository";
import { type IssueAgentReplyJobRow } from "./issue-agent-reply-repository";

export type IssueAgentReplyCompletionOutput = {
  body: string;
  proposedAction:
    | {
        type: "request_issue_rework";
        workflowStage: string;
        reason: string;
      }
    | {
        type: "request_issue_update";
        changes: Record<string, unknown>;
      }
    | {
        type: "request_issue_create";
        issue: Record<string, unknown>;
        executeAfterCreate: boolean;
      }
    | null;
  executionProposal: boolean;
  skillExecutionProposal?: boolean;
  attachments?: IssueAttachmentInput[];
};

/**
 * Commits the claim transition, reply, and optional approval card in one D1
 * batch. The claim token intentionally remains on the completed row until the
 * final statement so every artifact insert can prove it belongs to the exact
 * live lease that won the transition.
 */
export async function completeIssueAgentReplyOutput(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    completedAt: string;
    output: IssueAgentReplyCompletionOutput;
  },
) {
  const executionApprovalsAvailable =
    await issueExecutionApprovalTablesAvailable(db);
  const skillExecutionApprovalsAvailable =
    await agentSkillExecutionApprovalTablesAvailable(db);
  if (
    !executionApprovalsAvailable &&
    (input.output.executionProposal ||
      (input.output.proposedAction?.type === "request_issue_create" &&
        input.output.proposedAction.executeAfterCreate))
  ) {
    throw new Error("issue execution approval schema is unavailable");
  }
  if (
    input.output.skillExecutionProposal &&
    !skillExecutionApprovalsAvailable
  ) {
    throw new Error("Agent Skill execution approval schema is unavailable");
  }
  if (
    input.output.skillExecutionProposal &&
    (input.output.executionProposal || input.output.proposedAction)
  ) {
    throw new Error(
      "Agent Skill execution cannot be combined with another proposal",
    );
  }

  const proposedAction = input.output.proposedAction;
  const rework = proposedAction?.type === "request_issue_rework"
    ? proposedAction
    : null;
  const action = proposedAction && proposedAction.type !== "request_issue_rework"
    ? proposedAction
    : null;
  const actionProposalId = action ? crypto.randomUUID() : null;
  const reworkProposalId = rework ? crypto.randomUUID() : null;
  const executionProposalId = input.output.executionProposal
    ? crypto.randomUUID()
    : null;
  const createExecutionProposalId =
    action?.type === "request_issue_create" && action.executeAfterCreate
      ? crypto.randomUUID()
      : null;
  const skillExecutionProposalId = input.output.skillExecutionProposal
    ? crypto.randomUUID()
    : null;
  const consentTaskSessionId = input.output.skillExecutionProposal
    ? crypto.randomUUID()
    : null;
  const staleExecutionGuard = executionApprovalsAvailable
    ? `and not exists (
         select 1 from briar_issue_execution_proposals stale_execution
         where stale_execution.reply_message_id = job.reply_message_id
            or (
              stale_execution.project_id = job.project_id
              and stale_execution.trigger_message_id = job.trigger_message_id
              and stale_execution.source_kind = 'issue'
            )
       )`
    : "";
  const staleSkillExecutionGuard = skillExecutionApprovalsAvailable
    ? `and not exists (
         select 1
         from briar_agent_skill_execution_proposals stale_skill_execution
         where stale_skill_execution.reply_message_id = job.reply_message_id
            or (
              stale_skill_execution.project_id = job.project_id
              and stale_skill_execution.trigger_message_id =
                job.trigger_message_id
              and stale_skill_execution.source_kind = 'issue'
            )
       )`
    : "";

  const transition = db
    .prepare(
      `update briar_issue_agent_reply_jobs as job
       set status = 'completed', completed_at = ?, updated_at = ?
       where job.id = ? and job.project_id = ? and job.status = 'running'
         and job.claimed_worker_id = ? and job.claim_token_hash = ?
         and job.lease_expires_at > ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = job.run_id and run.project_id = job.project_id
         )
         and not exists (
           select 1 from briar_issue_messages stale_message
           where stale_message.id = job.reply_message_id
         )
         and not exists (
           select 1 from briar_issue_rework_proposals stale_rework
           where stale_rework.reply_message_id = job.reply_message_id
              or (
                stale_rework.project_id = job.project_id
                and stale_rework.trigger_message_id = job.trigger_message_id
              )
         )
         and not exists (
           select 1 from briar_issue_action_proposals stale_action
           where stale_action.reply_message_id = job.reply_message_id
              or (
                stale_action.project_id = job.project_id
                and stale_action.trigger_message_id = job.trigger_message_id
              )
         )
         ${staleExecutionGuard}
         ${staleSkillExecutionGuard}
         and (
           ? = 0
           or exists (
             select 1 from briar_hunt_runs run
             where run.id = job.run_id and run.project_id = job.project_id
               and run.status = 'completed'
               and exists (
                 select 1
                 from json_each(run.workflow_snapshot_json, '$.stages') stage
                 where json_extract(stage.value, '$.id') = ?
               )
           )
         )
         and (
           ? = 0
           or exists (
             select 1 from briar_hunt_runs run
             where run.id = job.run_id and run.project_id = job.project_id
               and run.status = 'backlog' and run.stage = 'queued'
               and run.workflow_stage is null
               and run.worker_id is null and run.requested_worker_id is null
               and run.claim_token_hash is null and run.claimed_by is null
               and run.claimed_at is null and run.lease_expires_at is null
               and run.last_execution_id is null
               and run.dispatch_mode is null
               and run.dispatch_request_id is null
               and run.dispatched_at is null
               and run.requested_by_user_id is null
               and run.completed_at is null and run.paused_at is null
               and run.resume_requested_at is null
           )
         )
         and (
           ? = 0
           or exists (
             select 1
             from briar_hunt_runs run
             join briar_projects project on project.id = run.project_id
             join briar_project_agents agent
               on agent.id = coalesce(job.agent_id, run.agent_id)
              and agent.project_id = run.project_id
              and agent.organization_id = project.organization_id
             join briar_agent_skills skill
               on skill.id = job.skill_id and skill.agent_id = agent.id
              and job.selected_skill_id_snapshot = skill.id
             join briar_issue_messages trigger
               on trigger.id = job.trigger_message_id
              and trigger.project_id = job.project_id
              and trigger.run_id = job.run_id
             where run.id = job.run_id and run.project_id = job.project_id
               and agent.name = job.selected_agent_name_snapshot
               and agent.responsibility =
                 job.selected_agent_responsibility_snapshot
               and skill.name = job.selected_skill_name_snapshot
               and skill.body =
                 job.selected_skill_instructions_snapshot
               and skill.kind = job.selected_skill_kind_snapshot
               and skill.provider = job.selected_skill_provider_snapshot
               and skill.model is job.selected_skill_model_snapshot
               and skill.effort is job.selected_skill_effort_snapshot
               and trigger.body = job.skill_execution_request_snapshot
           )
         )
       returning *`,
    )
    .bind(
      input.completedAt,
      input.completedAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
      input.completedAt,
      rework ? 1 : 0,
      rework?.workflowStage ?? null,
      input.output.executionProposal ? 1 : 0,
      input.output.skillExecutionProposal ? 1 : 0,
    );

  const completedClaim = (alias: string) =>
    `${alias}.id = ? and ${alias}.project_id = ?
     and ${alias}.status = 'completed'
     and ${alias}.claimed_worker_id = ?
     and ${alias}.claim_token_hash = ?
     and ${alias}.completed_at = ?`;
  const claimBindings = [
    jobId,
    projectId,
    input.workerId,
    input.claimTokenHash,
    input.completedAt,
  ];
  const statements: D1PreparedStatement[] = [
    transition,
    db.prepare(
      `insert into briar_issue_messages (
         id, project_id, run_id, parent_message_id, author_user_id,
         author_agent_id, author_agent_name, author_agent_provider,
         body, created_at, updated_at
       )
       select job.reply_message_id, job.project_id, job.run_id, parent.id,
              null, job.agent_id, job.agent_name_snapshot,
              job.agent_provider, ?, ?, ?
       from briar_issue_agent_reply_jobs job
       join briar_issue_messages parent
         on parent.id = job.parent_message_id
        and parent.project_id = job.project_id and parent.run_id = job.run_id
       where ${completedClaim("job")}`,
    ).bind(
      input.output.body,
      input.completedAt,
      input.completedAt,
      ...claimBindings,
    ),
  ];

  for (const attachment of input.output.attachments ?? []) {
    statements.push(db.prepare(
      `insert into briar_issue_attachments (
         id, run_id, project_id, object_key, filename, content_type,
         byte_size, created_at
       )
       select ?, job.run_id, job.project_id, ?, ?, ?, ?, ?
       from briar_issue_agent_reply_jobs job
       where ${completedClaim("job")}`,
    ).bind(
      attachment.id,
      attachment.object_key,
      attachment.filename,
      attachment.content_type,
      attachment.byte_size,
      input.completedAt,
      ...claimBindings,
    ));
  }

  if (rework) {
    statements.push(db.prepare(
      `insert into briar_issue_rework_proposals (
         id, project_id, run_id, trigger_message_id, reply_message_id,
         workflow_stage, reason, expected_attempt, expected_revision,
         created_at, updated_at
       )
       select ?, job.project_id, run.id, job.trigger_message_id,
              job.reply_message_id, ?, ?, run.current_attempt,
              run.current_revision, ?, ?
       from briar_issue_agent_reply_jobs job
       join briar_hunt_runs run
         on run.id = job.run_id and run.project_id = job.project_id
       where ${completedClaim("job")}`,
    ).bind(
      reworkProposalId,
      rework.workflowStage,
      rework.reason,
      input.completedAt,
      input.completedAt,
      ...claimBindings,
    ));
  }

  if (action) {
    const payloadJson = JSON.stringify(
      action.type === "request_issue_update"
        ? { changes: action.changes }
        : { issue: action.issue },
    );
    statements.push(db.prepare(
      executionApprovalsAvailable
        ? `insert into briar_issue_action_proposals (
             id, project_id, conversation_run_id, trigger_message_id,
             reply_message_id, action_type, payload_json,
             expected_run_updated_at, execute_after_create,
             execution_proposal_id, created_at, updated_at
           )
           select ?, job.project_id, run.id, job.trigger_message_id,
                  job.reply_message_id, ?, ?,
                  case when ? = 'request_issue_update'
                    then run.updated_at else null end,
                  ?, ?, ?, ?
           from briar_issue_agent_reply_jobs job
           join briar_hunt_runs run
             on run.id = job.run_id and run.project_id = job.project_id
           where ${completedClaim("job")}`
        : `insert into briar_issue_action_proposals (
             id, project_id, conversation_run_id, trigger_message_id,
             reply_message_id, action_type, payload_json,
             expected_run_updated_at, created_at, updated_at
           )
           select ?, job.project_id, run.id, job.trigger_message_id,
                  job.reply_message_id, ?, ?,
                  case when ? = 'request_issue_update'
                    then run.updated_at else null end,
                  ?, ?
           from briar_issue_agent_reply_jobs job
           join briar_hunt_runs run
             on run.id = job.run_id and run.project_id = job.project_id
           where ${completedClaim("job")}`,
    ).bind(...(
      executionApprovalsAvailable
        ? [
            actionProposalId,
            action.type,
            payloadJson,
            action.type,
            action.type === "request_issue_create" && action.executeAfterCreate
              ? 1
              : 0,
            createExecutionProposalId,
            input.completedAt,
            input.completedAt,
            ...claimBindings,
          ]
        : [
            actionProposalId,
            action.type,
            payloadJson,
            action.type,
            input.completedAt,
            input.completedAt,
            ...claimBindings,
          ]
    )));
  }

  if (input.output.executionProposal) {
    statements.push(db.prepare(
      `insert into briar_issue_execution_proposals (
         id, organization_id, project_id, source_kind, channel_id,
         conversation_run_id, trigger_message_id, reply_message_id,
         target_run_id, target_title, target_run_updated_at,
         proposed_by_agent_id, delegated_by_agent_id,
         delegated_by_agent_name, created_at, updated_at
       )
       select ?, project.organization_id, job.project_id, 'issue', null,
              job.run_id, job.trigger_message_id, job.reply_message_id,
              run.id, run.title, run.updated_at, job.agent_id,
              null, null, ?, ?
       from briar_issue_agent_reply_jobs job
       join briar_hunt_runs run
         on run.id = job.run_id and run.project_id = job.project_id
       join briar_projects project on project.id = job.project_id
       where ${completedClaim("job")}`,
    ).bind(
      executionProposalId,
      input.completedAt,
      input.completedAt,
      ...claimBindings,
    ));
  }

  if (input.output.skillExecutionProposal) {
    statements.push(db.prepare(
      `insert into briar_agent_skill_execution_proposals (
         id, organization_id, project_id, source_kind, channel_id,
         conversation_run_id, trigger_message_id, reply_message_id,
         source_reply_job_id, delegated_by_reply_job_id,
         agent_id, agent_name, agent_responsibility,
         skill_id, skill_name, skill_instructions,
         skill_kind, provider, model, effort, execution_mode, approval_policy,
         thread_root_message_id, request, delegated_by_agent_id,
         delegated_by_agent_name, created_at, updated_at
       )
       select ?, project.organization_id, job.project_id, 'issue', null,
              job.run_id, job.trigger_message_id, job.reply_message_id,
              job.id, null, agent.id, job.selected_agent_name_snapshot,
              job.selected_agent_responsibility_snapshot,
              skill.id, job.selected_skill_name_snapshot,
              job.selected_skill_instructions_snapshot,
              job.selected_skill_kind_snapshot,
              job.selected_skill_provider_snapshot,
              job.selected_skill_model_snapshot,
              job.selected_skill_effort_snapshot,
              skill.execution_mode, skill.approval_policy,
              job.parent_message_id,
              job.skill_execution_request_snapshot, null, null, ?, ?
       from briar_issue_agent_reply_jobs job
       join briar_hunt_runs run
         on run.id = job.run_id and run.project_id = job.project_id
       join briar_projects project on project.id = job.project_id
       join briar_project_agents agent
         on agent.id = coalesce(job.agent_id, run.agent_id)
        and agent.project_id = run.project_id
        and agent.organization_id = project.organization_id
       join briar_agent_skills skill
         on skill.id = job.skill_id and skill.agent_id = agent.id
        and job.selected_skill_id_snapshot = skill.id
       join briar_issue_messages trigger
         on trigger.id = job.trigger_message_id
        and trigger.project_id = job.project_id and trigger.run_id = job.run_id
       and agent.name = job.selected_agent_name_snapshot
       and agent.responsibility = job.selected_agent_responsibility_snapshot
       and skill.name = job.selected_skill_name_snapshot
       and skill.body = job.selected_skill_instructions_snapshot
       and skill.kind = job.selected_skill_kind_snapshot
       and skill.provider = job.selected_skill_provider_snapshot
       and skill.model is job.selected_skill_model_snapshot
       and skill.effort is job.selected_skill_effort_snapshot
       and skill.execution_mode = 'task'
       and trigger.body = job.skill_execution_request_snapshot
       where ${completedClaim("job")}`,
    ).bind(
      skillExecutionProposalId,
      input.completedAt,
      input.completedAt,
      ...claimBindings,
    ));
    statements.push(db.prepare(
      `update briar_agent_skill_execution_proposals
       set status = 'accepted',
           requested_worker_id = (
             select job.claimed_worker_id
             from briar_issue_agent_reply_jobs job
             where job.id = source_reply_job_id
           ),
           requested_worker_label = (
             select worker.label
             from briar_issue_agent_reply_jobs job
             join briar_execution_workers worker
               on worker.id = job.claimed_worker_id
             where job.id = source_reply_job_id
           ),
           result_session_id = ?,
           accepted_by_user_id = (
             select trigger.author_user_id
             from briar_issue_agent_reply_jobs job
             join briar_issue_messages trigger
               on trigger.id = job.trigger_message_id
              and trigger.project_id = job.project_id
              and trigger.run_id = job.run_id
             where job.id = source_reply_job_id
           ),
           accepted_at = ?, updated_at = ?
       where id = ? and status = 'pending' and execution_mode = 'task'
         and approval_policy = 'invoke_is_consent'
         and exists (
           select 1 from briar_issue_agent_reply_jobs job
           join briar_issue_messages trigger
             on trigger.id = job.trigger_message_id
            and trigger.project_id = job.project_id
            and trigger.run_id = job.run_id
           join briar_execution_workers worker
             on worker.id = job.claimed_worker_id
           where job.id = source_reply_job_id
             and trigger.author_user_id is not null
         )`,
    ).bind(
      consentTaskSessionId,
      input.completedAt,
      input.completedAt,
      skillExecutionProposalId,
    ));
  }

  statements.push(db.prepare(
    `update briar_issue_agent_reply_jobs
     set claim_token_hash = null, lease_expires_at = null
     where ${completedClaim("briar_issue_agent_reply_jobs")}`,
  ).bind(...claimBindings));

  const results = await db.batch(statements);
  const completed = results[0]?.results[0] as IssueAgentReplyJobRow | undefined;
  return completed
    ? { ...completed, claim_token_hash: null, lease_expires_at: null }
    : null;
}
