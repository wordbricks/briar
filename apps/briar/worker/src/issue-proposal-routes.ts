import { channelExecutionProposalAcceptInputSchema } from "../../src/lib/channels-contract";
import {
  approveAgentSkillExecutionProposal,
} from "./agent-skill-execution-approval";
import type { BriarAuth } from "./auth";
import { approvedIssueCreation } from "./channel-proposal-helpers";
import {
  acceptIssueCreateProposal,
  acceptIssueReworkProposal,
  acceptIssueUpdateProposal,
  agentSkillExecutionApprovalTablesAvailable,
  getHuntRunForProject,
  getIssueActionProposal,
  getIssueAgentSkillExecutionProposal,
  getIssueExecutionProposal,
  getIssueReworkProposal,
  getProject,
  HuntTransitionError,
  issueExecutionApprovalTablesAvailable,
  listIssueExecutionProposals,
  reserveIssueCreateProposalApproval,
  reserveIssueExecutionProposalApproval,
  reworkHuntRun,
} from "./db";
import { HttpError, json } from "./http-response";
import {
  issueActionProposalJson,
  issueExecutionProposalJson,
  issueReworkProposalJson,
} from "./issue-conversation-json";
import {
  decodeAgentSkillExecutionProposalAcceptInput,
  decodeExecutionPreferences,
  decodeIssueCreateProposalAction,
  decodeIssueUpdateProposalAction,
} from "./issue-request-contract";
import { createIssueWithAttachments } from "./issue-write-service";
import { newConversationProposalIssueSourceKey } from "./proposal-issue-source";
import { readJson } from "./request-readers";
import { decodeRequestSync } from "./request-schema";
import { requireSession } from "./session-auth";
import { dispatchHuntRun, WorkerConflictError } from "./workers";

const decodeChannelExecutionProposalAcceptInput = decodeRequestSync(
  channelExecutionProposalAcceptInputSchema,
);

export async function handleIssueProposalRoute(input: {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  attachmentsBucket: R2Bucket;
  archivesBucket: R2Bucket;
}): Promise<Response | undefined> {
  const {
    request,
    url,
    auth,
    db,
    attachmentsBucket,
    archivesBucket,
  } = input;

  const issueReworkProposalAcceptMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/rework-proposals\/([0-9a-f-]+)\/accept$/u,
  );
  if (issueReworkProposalAcceptMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueReworkProposalAcceptMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const proposal = await getIssueReworkProposal(
      db,
      project.id,
      issueReworkProposalAcceptMatch[2],
      issueReworkProposalAcceptMatch[3],
    );
    if (!proposal) throw new HttpError(404, "Rework proposal not found");
    if (proposal.status === "accepted") {
      return json({
        proposal: issueReworkProposalJson(proposal),
        outcome: "already_accepted",
        attempt: proposal.expected_attempt,
        revision: proposal.applied_revision,
        workflowStage: proposal.workflow_stage,
      });
    }
    const acceptedAt = new Date().toISOString();
    try {
      const rework = await reworkHuntRun(db, project.id, {
        runId: proposal.run_id,
        workflowStage: proposal.workflow_stage,
        requestId: proposal.id,
        actor: `briar-app:${session.user.id}`,
        reason: proposal.reason,
        occurredAt: acceptedAt,
        completed: {
          expectedAttempt: proposal.expected_attempt,
          expectedRevision: proposal.expected_revision,
        },
      });
      if (rework.outcome === "not_found" || rework.revision === null) {
        throw new HttpError(404, "Run not found");
      }
      const accepted = await acceptIssueReworkProposal(db, {
        projectId: project.id,
        runId: proposal.run_id,
        proposalId: proposal.id,
        userId: session.user.id,
        acceptedAt,
        appliedRevision: rework.revision,
      }) ?? await getIssueReworkProposal(
        db,
        project.id,
        proposal.run_id,
        proposal.id,
      );
      if (!accepted) throw new HttpError(409, "Rework proposal changed");
      return json({
        proposal: issueReworkProposalJson(accepted),
        outcome:
          rework.outcome === "already_reworked"
            ? "already_accepted"
            : "accepted",
        attempt: rework.attempt,
        revision: rework.revision,
        workflowStage: rework.workflowStage,
      });
    } catch (error) {
      if (error instanceof HuntTransitionError) {
        throw new HttpError(409, error.message, "REWORK_PROPOSAL_CONFLICT");
      }
      throw error;
    }
  }

  const issueActionProposalAcceptMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/issue-action-proposals\/([0-9a-f-]+)\/accept$/u,
  );
  if (issueActionProposalAcceptMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueActionProposalAcceptMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const proposal = await getIssueActionProposal(
      db,
      project.id,
      issueActionProposalAcceptMatch[2],
      issueActionProposalAcceptMatch[3],
    );
    if (!proposal) throw new HttpError(404, "Issue action proposal not found");
    if (proposal.status === "accepted") {
      const executionProposal = (await listIssueExecutionProposals(
        db,
        project.id,
        proposal.conversation_run_id,
      )).find(
        (candidate) => candidate.origin_create_proposal_id === proposal.id,
      ) ?? null;
      return json({
        proposal: issueActionProposalJson(proposal),
        executionProposal: executionProposal
          ? issueExecutionProposalJson(executionProposal)
          : null,
        outcome: "already_accepted",
        resultRunId: proposal.result_run_id,
      });
    }

    const acceptedAt = new Date().toISOString();
    const rawPayload = JSON.parse(proposal.payload_json);
    if (proposal.action_type === "request_issue_update") {
      const action = decodeIssueUpdateProposalAction({
        type: proposal.action_type,
        ...rawPayload,
      });
      const run = await getHuntRunForProject(
        db,
        project.id,
        proposal.conversation_run_id,
      );
      if (!run) throw new HttpError(404, "Run not found");
      const hasDescription = Object.prototype.hasOwnProperty.call(
        action.changes,
        "description",
      );
      const hasPriority = Object.prototype.hasOwnProperty.call(
        action.changes,
        "priority",
      );
      const accepted = await acceptIssueUpdateProposal(db, {
        projectId: project.id,
        conversationRunId: proposal.conversation_run_id,
        proposalId: proposal.id,
        userId: session.user.id,
        acceptedAt,
        title: action.changes.title ?? run.title,
        description: hasDescription
          ? action.changes.description ?? null
          : run.issue_description,
        priority: hasPriority
          ? action.changes.priority ?? null
          : run.priority,
      });
      if (!accepted) {
        throw new HttpError(
          409,
          "The issue changed after this proposal was created",
          "ISSUE_ACTION_PROPOSAL_CONFLICT",
        );
      }
      return json({
        proposal: issueActionProposalJson(accepted),
        outcome: "accepted",
        resultRunId: accepted.result_run_id,
      });
    }

    const action = decodeIssueCreateProposalAction({
      type: proposal.action_type,
      ...rawPayload,
    });
    const reservation = await reserveIssueCreateProposalApproval(db, {
      projectId: project.id,
      conversationRunId: proposal.conversation_run_id,
      proposalId: proposal.id,
      userId: session.user.id,
      reservedAt: acceptedAt,
      issueSourceKey: newConversationProposalIssueSourceKey(),
    });
    if (!reservation) {
      const latest = await getIssueActionProposal(
        db,
        project.id,
        proposal.conversation_run_id,
        proposal.id,
      );
      if (latest?.status === "accepted") {
        const executionProposal = (await listIssueExecutionProposals(
          db,
          project.id,
          latest.conversation_run_id,
        )).find(
          (candidate) => candidate.origin_create_proposal_id === latest.id,
        ) ?? null;
        return json({
          proposal: issueActionProposalJson(latest),
          executionProposal: executionProposal
            ? issueExecutionProposalJson(executionProposal)
            : null,
          outcome: "already_accepted",
          resultRunId: latest.result_run_id,
        });
      }
      throw new HttpError(
        409,
        "This issue proposal is being accepted by another member",
        "ISSUE_ACTION_PROPOSAL_CONFLICT",
      );
    }
    if (!reservation.issue_source_key) {
      throw new HttpError(
        409,
        "This issue proposal has no approval identity",
        "ISSUE_ACTION_PROPOSAL_CONFLICT",
      );
    }
    let created: Awaited<ReturnType<typeof createIssueWithAttachments>>;
    try {
      created = await createIssueWithAttachments({
        db,
        attachmentsBucket,
        project,
        issue: approvedIssueCreation(action.issue),
        attachments: [],
        sourceKey: reservation.issue_source_key,
        // Keep the event payload stable across retries. The accepting user is
        // recorded on the proposal row itself.
        actor: "briar-conversation",
        detail: "대화창에서 사용자가 승인한 제안으로 생성된 이슈입니다.",
        context: {
          origin: "briar-conversation",
          proposalId: proposal.id,
          conversationRunId: proposal.conversation_run_id,
        },
        issueId: proposal.id,
        createdByUserId: reservation.approval_reserved_by_user_id,
        occurredAt: proposal.created_at,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes(
          "conversation proposal no longer belongs to project",
        )
      ) {
        throw new HttpError(
          409,
          "The conversation moved before this proposal could be accepted",
          "ISSUE_ACTION_PROPOSAL_CONFLICT",
        );
      }
      throw error;
    }
    const finalized = await acceptIssueCreateProposal(db, {
      projectId: project.id,
      conversationRunId: proposal.conversation_run_id,
      proposalId: proposal.id,
      userId: session.user.id,
      acceptedAt,
      resultRunId: created.runId,
    });
    const accepted = finalized ?? await getIssueActionProposal(
      db,
      project.id,
      proposal.conversation_run_id,
      proposal.id,
    );
    if (
      !accepted || accepted.status !== "accepted" ||
      accepted.result_run_id !== created.runId
    ) {
      throw new HttpError(
        409,
        "The created issue is not eligible for this approval",
        "ISSUE_ACTION_PROPOSAL_CONFLICT",
      );
    }
    const executionProposal = (await listIssueExecutionProposals(
      db,
      project.id,
      accepted.conversation_run_id,
    )).find(
      (candidate) => candidate.origin_create_proposal_id === accepted.id,
    ) ?? null;
    return json({
      proposal: issueActionProposalJson(accepted),
      executionProposal: executionProposal
        ? issueExecutionProposalJson(executionProposal)
        : null,
      outcome:
        accepted.status === "accepted" && accepted.accepted_at !== acceptedAt
          ? "already_accepted"
          : "accepted",
      resultRunId: accepted.result_run_id,
    });
  }

  const issueSkillExecutionProposalAcceptMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/skill-execution-proposals\/([0-9a-f-]+)\/accept$/u,
  );
  if (issueSkillExecutionProposalAcceptMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueSkillExecutionProposalAcceptMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!(await agentSkillExecutionApprovalTablesAvailable(db))) {
      throw new HttpError(
        503,
        "Agent Skill execution approval is not available during this upgrade",
        "AGENT_SKILL_EXECUTION_APPROVAL_UNAVAILABLE",
      );
    }
    const conversationRunId = issueSkillExecutionProposalAcceptMatch[2];
    const proposalId = issueSkillExecutionProposalAcceptMatch[3];
    const loadProposal = () => getIssueAgentSkillExecutionProposal(
      db,
      project.id,
      conversationRunId,
      proposalId,
    );
    const proposal = await loadProposal();
    if (!proposal) {
      throw new HttpError(404, "Agent Skill execution proposal not found");
    }
    const input = decodeAgentSkillExecutionProposalAcceptInput(
      await readJson(request),
    );
    return json(await approveAgentSkillExecutionProposal(db, archivesBucket, proposal, {
      sourceKind: "issue",
      userId: session.user.id,
      workerId: input.workerId,
      staleCode: "ISSUE_SKILL_EXECUTION_PROPOSAL_STALE",
      conflictCode: "ISSUE_SKILL_EXECUTION_PROPOSAL_CONFLICT",
      reload: loadProposal,
    }));
  }

  const issueExecutionProposalAcceptMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/issue-execution-proposals\/([0-9a-f-]+)\/accept$/u,
  );
  if (issueExecutionProposalAcceptMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueExecutionProposalAcceptMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!(await issueExecutionApprovalTablesAvailable(db))) {
      throw new HttpError(
        503,
        "Issue execution approval is not available during this upgrade",
        "ISSUE_EXECUTION_APPROVAL_UNAVAILABLE",
      );
    }
    const proposal = await getIssueExecutionProposal(
      db,
      project.id,
      issueExecutionProposalAcceptMatch[2],
      issueExecutionProposalAcceptMatch[3],
    );
    if (!proposal) throw new HttpError(404, "Execution proposal not found");
    const input = decodeChannelExecutionProposalAcceptInput(
      await readJson(request),
    );
    decodeExecutionPreferences({
      provider: input.provider,
      model: input.model,
      effort: input.effort,
    });
    const run = await getHuntRunForProject(db, project.id, proposal.target_run_id);
    if (proposal.status === "accepted") {
      if (
        proposal.accepted_by_user_id !== session.user.id ||
        proposal.requested_provider !== input.provider ||
        proposal.requested_model !== input.model ||
        proposal.requested_effort !== input.effort ||
        proposal.requested_worker_id !== input.workerId
      ) {
        throw new HttpError(
          409,
          "Execution was approved with different settings or by another member",
          "ISSUE_EXECUTION_PROPOSAL_CONFLICT",
        );
      }
      if (
        !run || !proposal.dispatch_request_id ||
        run.dispatch_request_id !== proposal.dispatch_request_id
      ) {
        throw new HttpError(
          409,
          "This execution approval is stale; request a new approval",
          "ISSUE_EXECUTION_PROPOSAL_STALE",
        );
      }
      return json({
        proposal: issueExecutionProposalJson(proposal),
        outcome: "already_accepted",
        projectId: proposal.project_id,
        runId: proposal.target_run_id,
        dispatch: {
          runId: proposal.target_run_id,
          agentId: proposal.proposed_by_agent_id,
          provider: proposal.requested_provider,
          model: proposal.requested_model,
          effort: proposal.requested_effort,
          requestedWorkerId: proposal.requested_worker_id,
          requestedByUserId: proposal.accepted_by_user_id,
          dispatchMode: proposal.requested_worker_id ? "specific" : "any",
          dispatchedAt: proposal.accepted_at,
          outcome: "already_dispatched",
        },
      });
    }
    if (proposal.status !== "pending") {
      throw new HttpError(
        409,
        "This execution proposal is no longer valid",
        "ISSUE_EXECUTION_PROPOSAL_STALE",
      );
    }
    const acceptedAt = new Date().toISOString();
    const reservation = await reserveIssueExecutionProposalApproval(db, {
      projectId: project.id,
      conversationRunId: proposal.conversation_run_id!,
      proposalId: proposal.id,
      userId: session.user.id,
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      workerId: input.workerId,
      dispatchRequestId: crypto.randomUUID(),
      reservedAt: acceptedAt,
    });
    if (!reservation?.dispatch_request_id ||
        !reservation.approval_reserved_by_user_id ||
        !reservation.approval_reserved_at) {
      throw new HttpError(
        409,
        "The issue or execution approval changed before dispatch",
        "ISSUE_EXECUTION_PROPOSAL_CONFLICT",
      );
    }
    try {
      const dispatched = await dispatchHuntRun(
        db,
        project.organization_id,
        project.id,
        {
          runId: reservation.target_run_id,
          agentId: reservation.proposed_by_agent_id,
          provider: reservation.requested_provider!,
          model: reservation.requested_model,
          effort: reservation.requested_effort,
          persistPreferences: false,
          workerId: reservation.requested_worker_id,
          requestedByUserId: reservation.approval_reserved_by_user_id,
          requestId: reservation.dispatch_request_id,
          occurredAt: reservation.approval_reserved_at,
        },
      );
      if (!dispatched) throw new HttpError(404, "Run not found");
      const accepted = await getIssueExecutionProposal(
        db,
        reservation.project_id,
        reservation.conversation_run_id!,
        reservation.id,
      );
      if (
        !accepted || accepted.status !== "accepted" ||
        accepted.dispatch_request_id !== reservation.dispatch_request_id
      ) {
        throw new HttpError(
          409,
          "Execution approval was not finalized",
          "ISSUE_EXECUTION_PROPOSAL_CONFLICT",
        );
      }
      return json({
        proposal: issueExecutionProposalJson(accepted),
        outcome: "accepted",
        projectId: accepted.project_id,
        runId: accepted.target_run_id,
        dispatch: dispatched,
      });
    } catch (error) {
      if (error instanceof WorkerConflictError || (
        error instanceof Error && error.message.includes("execution proposal")
      )) {
        throw new HttpError(
          409,
          error.message,
          "ISSUE_EXECUTION_PROPOSAL_CONFLICT",
        );
      }
      throw error;
    }
  }


  return undefined;
}
