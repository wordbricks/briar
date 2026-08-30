import { agentSkillJson } from "./agent-skills";
import { publishAgentSkillTaskResult } from "./agent-skill-execution-proposal-repository";
import { getArchivedProjectAgentSession } from "./archive";
import { sha256 } from "./crypto-digest";
import {
  claimNextProjectAgentTask,
  completeProjectAgentTaskWithReceipt,
  getProjectAgentSession,
  reapProjectAgentTaskJobs,
  upsertProjectAgentSessionSummary,
} from "./db";
import { HttpError, json } from "./http-response";
import { projectAgentSessionJson } from "./project-agent-session-json";
import { syncProjectAgentTaskSession } from "./project-agent-task-session";
import {
  decodeProjectAgentTaskCompletion,
} from "./project-request-contract";
import { readJson } from "./request-readers";
import {
  scheduleChannelRealtimePublish,
  scheduleProjectAgentSessionRealtimePublish,
  scheduleProjectRealtimePublish,
} from "./realtime-scheduling";
import {
  type AuthenticatedWorkerProject,
  requireWorkerProjectBinding,
} from "./worker-route-auth";
import { latestExecutionWorkerUpdateHandoff } from "./worker-update-repository";
import {
  executionWorkerProviders,
  isExecutionWorkerAllowedForProject,
  leaseExpiryFrom,
  workerStateAt,
} from "./workers";

export async function claimNextProjectAgentTaskWork(input: {
  projectId: string;
  db: D1Database;
  env: Env;
  context?: ExecutionContext;
  authenticatedWorker: AuthenticatedWorkerProject;
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
    const reaped = await reapProjectAgentTaskJobs(db, input.projectId, {
      observedAt,
      error: "Worker lease expired after repeated attempts.",
    });
    await Promise.all(
      reaped.map(async (job) => {
        if (job.skill_execution_proposal_id) {
          const session = await getProjectAgentSession(
            db,
            job.project_id,
            job.id,
          );
          if (!session) return;
          await upsertProjectAgentSessionSummary(db, session, false);
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
        const session = await syncProjectAgentTaskSession(
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
    const job = await claimNextProjectAgentTask(db, input.projectId, {
      workerId: authenticatedWorker.binding.id,
      agentProviders: providers,
      claimTokenHash: await sha256(claimToken),
      claimedAt: observedAt,
      leaseExpiresAt: leaseExpiryFrom(observedAt),
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
          responsibility: job.agent_responsibility,
          skill: job.agent_skill,
          skills: job.agent_skills.map(agentSkillJson),
        },
    };
}

export async function handleProjectAgentTaskWorkerRoute(input: {
  request: Request;
  url: URL;
  db: D1Database;
  env: Env;
  context?: ExecutionContext;
}): Promise<Response | undefined> {
  const { request, url, db, env, context } = input;

  const projectAgentTaskClaimMatch = url.pathname.match(
    /^\/agent-task-claims\/([0-9a-f-]+)\/complete$/u,
  );
  if (projectAgentTaskClaimMatch && request.method === "POST") {
    const body = await readJson(request);
    const input = decodeProjectAgentTaskCompletion(body);
    const worker = await requireWorkerProjectBinding(
      db,
      request,
      input.projectId,
      input.workerId,
    );
    const claimTokenHash = await sha256(input.claimToken);
    const observedAt = new Date().toISOString();
    const completion = await completeProjectAgentTaskWithReceipt(
      db,
      input.projectId,
      projectAgentTaskClaimMatch[1],
      {
        workerId: worker.binding.id,
        claimTokenHash,
        updatedAt: observedAt,
        summary: input.summary ?? null,
        conversationId: input.conversationId ?? null,
        error: input.error,
      },
    );
    if (!completion) {
      throw new HttpError(409, "Agent task completion conflicts with its receipt");
    }
    const completed = completion.job;
    const hotSession = await getProjectAgentSession(
      db,
      input.projectId,
      projectAgentTaskClaimMatch[1],
    );
    let session = hotSession ? projectAgentSessionJson(hotSession) : null;
    let sessionChanged = false;
    if (
      completed && !completed.skill_execution_proposal_id &&
      hotSession &&
      (
        !completion.replayed || hotSession.updated_at !== completed.updated_at ||
        hotSession.status !== (completed.status === "queued" ? "running" : completed.status)
      )
    ) {
      session = await syncProjectAgentTaskSession(db, completed, {
        summary: completed.result_summary ?? input.summary ?? null,
        conversationId:
          completed.result_conversation_id ?? input.conversationId ?? null,
        error: completed.error ?? input.error ?? null,
      });
      sessionChanged = session !== null;
    }
    if (completed?.skill_execution_proposal_id && hotSession) {
      const summaryResult = await upsertProjectAgentSessionSummary(
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
      scheduleProjectRealtimePublish(env, db, input.projectId, context);
    }
    if (sessionChanged) {
      scheduleProjectAgentSessionRealtimePublish(
        env,
        db,
        input.projectId,
        context,
      );
    }
    if (!session) {
      const archived = await getArchivedProjectAgentSession(
        db,
        env.ARCHIVES,
        input.projectId,
        projectAgentTaskClaimMatch[1],
      );
      session = archived ? projectAgentSessionJson(archived) : null;
    }
    if (!session) throw new HttpError(409, "Agent task session is missing");
    return json({ session });
  }


  return undefined;
}
