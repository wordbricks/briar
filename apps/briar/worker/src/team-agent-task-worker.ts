import { agentSkillJson } from "./agent-skills";
import { publishAgentSkillTaskResult } from "./agent-skill-execution-proposal-repository";
import { getArchivedProjectAgentSession } from "./archive";
import { sha256 } from "./crypto-digest";
import {
  cancelTeamAgentTaskJob,
  claimNextTeamAgentTask,
  completeTeamAgentTaskWithReceipt,
  getTeamAgentSession,
  getTeamAgentTaskJob,
  reapTeamAgentTaskJobs,
  teamAgentSessionIsApprovalOwned,
  upsertTeamAgentSessionSummary,
} from "./db";
import { HttpError } from "./http-response";
import { syncTeamAgentTaskSession } from "./team-agent-task-session";
import {
  scheduleChannelRealtimePublish,
  scheduleProjectAgentSessionRealtimePublish,
  scheduleProjectRealtimePublish,
} from "./realtime-scheduling";
import {
  type AuthenticatedWorkerTeam,
} from "./worker-route-auth";
import { latestExecutionWorkerUpdateHandoff } from "./worker-update-repository";
import {
  executionWorkerProviders,
  executionWorkerRuntime,
  isExecutionWorkerAllowedForProject,
  leaseExpiryFrom,
  workerStateAt,
} from "./workers";

export async function claimNextTeamAgentTaskWork(input: {
  projectId: string;
  db: D1Database;
  env: Env;
  context?: ExecutionContext;
  authenticatedWorker: AuthenticatedWorkerTeam;
}) {
    const { db, env, context, authenticatedWorker } = input;
    const observedAt = new Date().toISOString();
    if (
      workerStateAt(
        authenticatedWorker.binding.last_heartbeat_at,
        observedAt,
        authenticatedWorker.binding.state,
      ) !== "online" ||
      authenticatedWorker.binding.accepting_work !== 1 ||
      authenticatedWorker.binding.readiness_state === "needs_attention"
    ) {
      throw new HttpError(409, "Worker is not ready to claim agent tasks");
    }
    const providers = executionWorkerProviders(authenticatedWorker.binding);
    const computerUseProvidersJson = JSON.stringify(
      executionWorkerRuntime(authenticatedWorker.binding).computerUse
        ?.providers ?? [],
    );
    if (providers.length === 0) {
      throw new HttpError(409, "Worker has no available agent provider");
    }
    if (
      !(await isExecutionWorkerAllowedForProject(
        db,
        input.projectId,
        authenticatedWorker.binding.id,
      ))
    ) {
      throw new HttpError(
        409,
        "Worker is not allowed by this project's execution policy",
      );
    }
    const reaped = await reapTeamAgentTaskJobs(db, input.projectId, {
      observedAt,
      error: "Worker lease expired after repeated attempts.",
    });
    await Promise.all(
      reaped.map(async (job) => {
        if (job.skill_execution_proposal_id) {
          const session = await getTeamAgentSession(
            db,
            job.project_id,
            job.id,
          );
          if (!session) return;
          await upsertTeamAgentSessionSummary(db, session, false);
          const published = await publishAgentSkillTaskResult(
            db,
            job,
            observedAt,
          );
          if (published?.source_kind === "channel") {
            scheduleChannelRealtimePublish(
              env,
              db,
              published.organization_id,
              context,
            );
          } else if (published?.source_kind === "issue") {
            scheduleProjectRealtimePublish(env, db, job.project_id, context);
          }
          scheduleProjectAgentSessionRealtimePublish(
            env,
            db,
            job.project_id,
            context,
          );
          return;
        }
        const session = await syncTeamAgentTaskSession(
          db,
          job,
          { error: job.error },
        );
        if (session) {
          scheduleProjectAgentSessionRealtimePublish(
            env,
            db,
            job.project_id,
            context,
          );
        }
      }),
    );
    const claimToken = `briar_agent_task_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const job = await claimNextTeamAgentTask(db, input.projectId, {
      workerId: authenticatedWorker.binding.id,
      claimTokenHash: await sha256(claimToken),
      claimedAt: observedAt,
      leaseExpiresAt: leaseExpiryFrom(observedAt),
      computerUseProvidersJson,
    });
    if (!job) return null;
    const activeSkill = job.agent_skills.find(
      (skill) => skill.id === job.selected_skill_id,
    );
    if (!activeSkill) {
      throw new HttpError(409, "Agent task lost its selected Skill");
    }
    const handoffContext = await latestExecutionWorkerUpdateHandoff(db, {
      deviceId: authenticatedWorker.principal.deviceId,
      workType: "projectAgentTask",
      workId: job.id,
    });
    return {
        workType: "projectAgentTask" as const,
        workId: job.id,
        runId: job.id,
        sourceKey: `project-agent:${input.projectId}:${job.id}`,
        title: job.agent_name,
        claimToken,
        claimAttempts: job.attempts,
        resumeCount: job.resume_count,
        claimedAt: job.claimed_at,
        leaseExpiresAt: job.lease_expires_at,
        request: job.request,
        activeSkill: agentSkillJson(activeSkill),
        handoffContext,
        agent: {
          id: job.agent_id,
          name: job.agent_name,
          provider: job.agent_provider,
          model: job.agent_model,
          effort: job.agent_effort,
          computerUsePolicy: job.agent_computer_use_policy,
          responsibility: job.agent_responsibility,
          skills: job.agent_skills.map(agentSkillJson),
        },
    };
}

/** The stop reason stored on a task a member cancelled from its session. */
export const teamAgentTaskCancelledError = "Agent 세션에서 실행을 중지했습니다.";

/**
 * Stop a Project Agent task from its session. Idempotent: cancelling an
 * already terminal task returns the session it already has. The Worker that
 * still holds the task loses its lease, so its late completion is rejected by
 * `completeTeamAgentTaskWithReceipt`'s `status = 'running'` guard.
 */
export async function cancelTeamAgentTaskWork(input: {
  db: D1Database;
  env: Env;
  context?: ExecutionContext;
  projectId: string;
  sessionId: string;
  userId: string | null;
}) {
  const { db, env, context, projectId, sessionId, userId } = input;
  if (await teamAgentSessionIsApprovalOwned(db, projectId, sessionId)) {
    throw new HttpError(
      409,
      "Approved Agent Skill execution sessions are updated by their assigned Worker",
      "AGENT_SKILL_EXECUTION_SESSION_SERVER_OWNED",
    );
  }
  const job = await getTeamAgentTaskJob(db, projectId, sessionId);
  if (!job) throw new HttpError(404, "Agent task not found for this session");
  const currentSession = await getTeamAgentSession(db, projectId, sessionId);
  if (!currentSession) throw new HttpError(404, "Agent task session is missing");
  if (job.status === "completed" || job.status === "failed") {
    return currentSession;
  }
  const observedAt = new Date().toISOString();
  const cancelled = await cancelTeamAgentTaskJob(db, projectId, sessionId, {
    userId,
    observedAt,
    error: teamAgentTaskCancelledError,
  });
  if (!cancelled) {
    throw new HttpError(409, "Agent task could not be cancelled");
  }
  await syncTeamAgentTaskSession(db, cancelled, { error: null });
  scheduleProjectAgentSessionRealtimePublish(env, db, projectId, context);
  return (await getTeamAgentSession(db, projectId, sessionId)) ?? currentSession;
}

export async function completeTeamAgentTaskWork(input: {
  db: D1Database;
  env: Env;
  context?: ExecutionContext;
  projectId: string;
  taskId: string;
  workerId: string;
  claimTokenHash: string;
  result:
    | { readonly case: "success"; readonly summary: string; readonly conversationId: string | null }
    | { readonly case: "failure"; readonly error: string };
}) {
  const {
    db,
    env,
    context,
    projectId,
    taskId,
    workerId,
    claimTokenHash,
    result,
  } = input;
  const observedAt = new Date().toISOString();
  const completion = await completeTeamAgentTaskWithReceipt(
    db,
    projectId,
    taskId,
    {
      workerId,
      claimTokenHash,
      updatedAt: observedAt,
      summary: result.case === "success" ? result.summary : null,
      conversationId: result.case === "success" ? result.conversationId : null,
      error: result.case === "failure" ? result.error : undefined,
    },
  );
  if (!completion) {
    throw new HttpError(409, "Agent task completion conflicts with its receipt");
  }
  const completed = completion.job;
  const hotSession = await getTeamAgentSession(db, projectId, taskId);
  let sessionExists = hotSession !== null;
  let sessionChanged = false;
  if (
    completed && !completed.skill_execution_proposal_id &&
    hotSession &&
    (
      !completion.replayed || hotSession.updated_at !== completed.updated_at ||
      hotSession.status !== (completed.status === "queued" ? "running" : completed.status)
    )
  ) {
    const synchronized = await syncTeamAgentTaskSession(db, completed, {
      summary: completed.result_summary ??
        (result.case === "success" ? result.summary : null),
      conversationId: completed.result_conversation_id ??
        (result.case === "success" ? result.conversationId : null),
      error: completed.error ?? (result.case === "failure" ? result.error : null),
    });
    sessionExists ||= synchronized !== null;
    sessionChanged = synchronized !== null;
  }
  if (completed?.skill_execution_proposal_id && hotSession) {
    const summaryResult = await upsertTeamAgentSessionSummary(
      db,
      hotSession,
      false,
    );
    sessionChanged ||= (summaryResult.meta.changes ?? 0) > 0;
  }
  const publishedResult = completed
    ? await publishAgentSkillTaskResult(db, completed, observedAt)
    : null;
  if (publishedResult?.source_kind === "channel") {
    scheduleChannelRealtimePublish(
      env,
      db,
      publishedResult.organization_id,
      context,
    );
  } else if (publishedResult?.source_kind === "issue") {
    scheduleProjectRealtimePublish(env, db, projectId, context);
  }
  if (sessionChanged) {
    scheduleProjectAgentSessionRealtimePublish(env, db, projectId, context);
  }
  if (!sessionExists) {
    sessionExists = await getArchivedProjectAgentSession(
      db,
      env.ARCHIVES,
      projectId,
      taskId,
    ) !== null;
  }
  if (!sessionExists) throw new HttpError(409, "Agent task session is missing");
  return { replayed: completion.replayed };
}
