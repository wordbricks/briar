import { normalizeAutoHuntWorkflow } from "../../src/lib/auto-hunt-contract";
import { agentSkillJson, issueProcessingAgentSkillRow } from "./agent-skills";
import { parseJsonObject } from "./agent-result-json";
import { sha256 } from "./crypto-digest";
import {
  claimNextQueuedHuntRun,
  getProjectAgent,
  listIssueAttachments,
} from "./db";
import {
  issueClaimExecutionConfig,
  legacyAgentSkillInstructions,
} from "./agent-execution-config";
import { HttpError, json } from "./http-response";
import { issueAttachmentJson } from "./issue-conversation-json";
import { claimConversationJson } from "./issue-conversation-json";
import { listIssueMessagesWithArchive } from "./issue-conversation-service";
import { readJson } from "./request-readers";
import {
  type AuthenticatedWorkerProject,
  requireAgentProject,
  requireWorkerProjectBinding,
} from "./worker-route-auth";
import { decodeClaimInput } from "./worker-request-contract";
import { latestExecutionWorkerUpdateHandoff } from "./worker-update-repository";
import { claimWorkflowContext } from "./workflow-resume";
import {
  auditExecutionEvent,
  executionWorkerProviders,
  leaseExpiryFrom,
  reapStalledHuntRuns,
  workerStateAt,
} from "./workers";

export async function handleQueueClaimRoute(input: {
  request: Request;
  url: URL;
  db: D1Database;
  env: Env;
  authenticatedWorker?: AuthenticatedWorkerProject;
}): Promise<Response | undefined> {
  const {
    request,
    url,
    db,
    env,
    authenticatedWorker: preauthenticatedWorker,
  } = input;

  if (url.pathname === "/queue/claims" && request.method === "POST") {
    // Migration 0090 is applied by worker:deploy before this code can run.
    const input = decodeClaimInput(await readJson(request));
    let authenticatedWorkerId: string | undefined;
    let authenticatedWorker:
      | Awaited<ReturnType<typeof requireWorkerProjectBinding>>
      | undefined;
    const projectId = input.workerId
      ? (() => {
          if (!input.projectId) {
            throw new HttpError(400, "projectId is required for worker claims");
          }
          return input.projectId;
        })()
      : await requireAgentProject(db, request);
    if (input.workerId) {
      authenticatedWorker = await requireWorkerProjectBinding(
        db,
        request,
        projectId,
        input.workerId,
        preauthenticatedWorker,
      );
      authenticatedWorkerId = authenticatedWorker.binding.id;
      if (
        workerStateAt(
          authenticatedWorker.binding.last_heartbeat_at,
          new Date().toISOString(),
          authenticatedWorker.binding.state,
        ) !== "online" ||
        authenticatedWorker.binding.accepting_work !== 1 ||
        authenticatedWorker.binding.readiness_state === "needs_attention"
      ) {
        throw new HttpError(409, "Worker is not ready to claim work");
      }
    }
    const claimedAt = new Date().toISOString();
    // Recover runs abandoned by a dead worker before looking at the queue, so
    // they are claimable again in this same request.
    await reapStalledHuntRuns(db, projectId, claimedAt);
    const leaseExpiresAt = leaseExpiryFrom(claimedAt);
    const claimToken = `briar_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const run = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: await sha256(claimToken),
      claimedBy: input.claimedBy,
      claimedAt,
      leaseExpiresAt,
      runId: input.runId,
      workerId: authenticatedWorkerId,
      workerDeviceId: authenticatedWorker?.principal.deviceId,
      agentProviders: authenticatedWorker
        ? executionWorkerProviders(authenticatedWorker.binding)
        : undefined,
      detachedOnly: Boolean(authenticatedWorkerId),
    });
    if (!run && input.runId) {
      const waiting = await db
        .prepare(
          `select count(*) as count
           from briar_issue_dependencies dependency
           join briar_hunt_runs prerequisite
             on prerequisite.id = dependency.prerequisite_run_id
           where dependency.project_id = ?
             and dependency.dependent_run_id = ?
             and prerequisite.status != 'completed'`,
        )
        .bind(projectId, input.runId)
        .first<{ count: number }>();
      if ((waiting?.count ?? 0) > 0) {
        throw new HttpError(
          409,
          "Run is waiting for prerequisite issues to complete",
        );
      }
    }
    if (run && authenticatedWorker) {
      await auditExecutionEvent(db, {
        organizationId: authenticatedWorker.principal.organizationId,
        projectId,
        runId: run.id,
        workerId: authenticatedWorker.binding.id,
        agentId: run.agent_id,
        actorDeviceId: authenticatedWorker.principal.deviceId,
        action: "claimed",
        detail: { claimAttempts: run.claim_attempts },
        occurredAt: claimedAt,
      });
    }
    const agent =
      run?.agent_id ? await getProjectAgent(db, projectId, run.agent_id) : null;
    const activeSkill = agent
      ? issueProcessingAgentSkillRow(agent.skills)
      : null;
    const execution = run
      ? issueClaimExecutionConfig({
          preferred: {
            provider: run.preferred_agent_provider,
            model: run.preferred_agent_model,
            effort: run.preferred_agent_effort,
          },
          requested: {
            provider: run.requested_agent_provider,
            model: run.requested_agent_model,
            effort: run.requested_agent_effort,
          },
          activeSkill,
          agent,
        })
      : null;
    const [attachments, messages, reworkFeedbackEvent] = run
      ? await Promise.all([
          listIssueAttachments(db, projectId, run.id),
          listIssueMessagesWithArchive(db, env.ARCHIVES, projectId, run.id),
          run.current_revision > 1
            ? db
                .prepare(
                  `select detail from briar_hunt_events
                   where run_id = ? and revision = ?
                     and event_key like 'workflow:rework:%'
                   order by recorded_at desc, id desc
                   limit 1`,
                )
                .bind(run.id, run.current_revision)
                .first<{ detail: string | null }>()
            : null,
        ])
      : [[], [], null];
    const workflowContext = run
      ? await claimWorkflowContext(db, projectId, run)
      : { startStage: null, resumeContext: null };
    const handoffContext = run && authenticatedWorker
      ? await latestExecutionWorkerUpdateHandoff(db, {
          deviceId: authenticatedWorker.principal.deviceId,
          workType: "issue",
          workId: run.id,
        })
      : null;
    return json({
      work: run
        ? {
            runId: run.id,
            runNumber: run.run_number,
            currentAttempt: run.current_attempt,
            currentRevision: run.current_revision,
            source: run.source,
            sourceKey: run.source_key,
            title: run.title,
            description: run.issue_description,
            priority: run.priority,
            repository: run.repository,
            sourceCreatedAt: run.source_created_at,
            createdByUserId: run.created_by_user_id ?? null,
            context: parseJsonObject(run.context_json),
            reviewFeedback: reworkFeedbackEvent?.detail ?? null,
            workflowStage: run.workflow_stage,
            startStage: workflowContext.startStage,
            resumeContext: workflowContext.resumeContext,
            workflow: normalizeAutoHuntWorkflow(
              JSON.parse(run.workflow_snapshot_json),
            ),
            attachments: attachments.map(issueAttachmentJson),
            messages: claimConversationJson(messages, attachments),
            claimToken,
            executionId: run.last_execution_id,
            claimedBy: run.claimed_by,
            claimedAt: run.claimed_at,
            leaseExpiresAt: run.lease_expires_at,
            claimAttempts: run.claim_attempts,
            handoffContext,
            execution: execution?.provider
              ? execution
              : null,
            activeSkill: activeSkill ? agentSkillJson(activeSkill) : null,
            agent: agent
              ? {
                  id: agent.id,
                  name: agent.name,
                  provider: execution?.provider ?? agent.provider,
                  model: execution?.model ?? null,
                  effort: execution?.effort ?? null,
                  responsibility: agent.responsibility,
                  skill: legacyAgentSkillInstructions(
                    activeSkill,
                    agent.skill_markdown,
                  ),
                  skills: agent.skills.map(agentSkillJson),
                }
              : null,
          }
        : null,
    });
  }


  return undefined;
}
