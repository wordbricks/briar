import type { AgentProvider } from "../../src/lib/agent-provider";
import { getAgentSkill } from "./agent-skills";
import type { BriarAuth } from "./auth";
import { HttpError, json } from "./http-response";
import { getProjectAgent } from "./project-agent-repository";
import { projectAgentSessionJson } from "./project-agent-session-json";
import {
  getProjectAgentSession,
  upsertProjectAgentSession,
} from "./project-agent-session-repository";
import { projectAgentTaskSessionEvent } from "./project-agent-task-session";
import {
  createProjectAgentTaskJob,
  getProjectAgentTaskJobByRequest,
} from "./project-agent-task-repository";
import { getProject } from "./project-command-repository";
import { decodeProjectAgentTaskInput } from "./project-request-contract";
import { readJson } from "./request-readers";
import { scheduleProjectAgentSessionRealtimePublish } from "./realtime-scheduling";
import { requireSession } from "./session-auth";
import {
  executionWorkerProviders,
  isExecutionWorkerAllowedForProject,
  workerStateAt,
} from "./workers";

export type ProjectAgentTaskRouteInput = {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  env: Env;
  context?: ExecutionContext;
};

export async function handleProjectAgentTaskRoute(
  routeInput: ProjectAgentTaskRouteInput,
): Promise<Response | undefined> {
  const { request, url, auth, db, env, context } = routeInput;
  const projectAgentTasksMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-tasks$/u,
  );
  if (!projectAgentTasksMatch || request.method !== "POST") return undefined;

  const session = await requireSession(auth, request);
  const project = await getProject(
    db,
    projectAgentTasksMatch[1],
    session.user.id,
  );
  if (!project) throw new HttpError(404, "Project not found");
  const input = decodeProjectAgentTaskInput(await readJson(request));
  const existingJob = await getProjectAgentTaskJobByRequest(
    db,
    project.id,
    input.requestId,
  );
  if (existingJob) {
    const existingSession = await getProjectAgentSession(
      db,
      project.id,
      existingJob.id,
    );
    if (!existingSession) {
      throw new HttpError(409, "Agent task session is missing");
    }
    return json({ session: projectAgentSessionJson(existingSession) });
  }

  const agent = await getProjectAgent(db, project.id, input.agentId);
  if (!agent) throw new HttpError(404, "Agent not found for this project");
  if (!input.skillId && agent.skills.length !== 1) {
    throw new HttpError(400, "Choose an Agent Skill before running the Agent");
  }
  const selectedSkill = await getAgentSkill(
    db,
    agent.id,
    input.skillId ?? null,
  );
  if (!selectedSkill) {
    throw new HttpError(404, "Agent Skill not found for this Agent");
  }
  const worker = await db
    .prepare(
      `select worker.*, device.max_concurrent_sessions
       from briar_execution_workers worker
       join briar_execution_worker_devices device on device.id = worker.device_id
       where worker.id = ? and worker.project_id = ?
         and device.organization_id = ?`,
    )
    .bind(input.workerId, project.id, project.organization_id)
    .first<{
      id: string;
      agent_provider: AgentProvider;
      capabilities_json: string;
      state: "online" | "stale" | "disabled";
      accepting_work: number;
      readiness_state: "ready" | "busy" | "needs_attention";
      last_heartbeat_at: string;
      max_concurrent_sessions: number;
    }>();
  if (!worker) throw new HttpError(404, "Worker not found for this project");
  const observedAt = new Date().toISOString();
  if (
    workerStateAt(worker.last_heartbeat_at, observedAt, worker.state) !== "online" ||
    worker.accepting_work !== 1 ||
    worker.readiness_state === "needs_attention"
  ) {
    throw new HttpError(409, "Worker is not ready to accept agent tasks");
  }
  if (!executionWorkerProviders(worker).includes(selectedSkill.provider)) {
    throw new HttpError(
      409,
      `Worker does not support the ${selectedSkill.provider} provider`,
    );
  }
  if (!(await isExecutionWorkerAllowedForProject(db, project.id, worker.id))) {
    throw new HttpError(
      409,
      "Worker is not allowed by this project's execution policy",
    );
  }
  const active = await db
    .prepare(
      `select
         (select count(*)
          from briar_hunt_runs run
          where run.worker_id = ? and run.claim_token_hash is not null
            and run.lease_expires_at > ?
            and run.status not in ('backlog', 'completed', 'cancelled', 'blocked', 'failed'))
         +
         (select count(*)
          from briar_project_agent_task_jobs task
          where task.claimed_worker_id = ? and task.status = 'running'
            and task.lease_expires_at > ?) as count`,
    )
    .bind(worker.id, observedAt, worker.id, observedAt)
    .first<{ count: number }>();
  if ((active?.count ?? 0) >= worker.max_concurrent_sessions) {
    throw new HttpError(409, "Worker has no available execution slot");
  }

  const taskId = crypto.randomUUID();
  let job;
  try {
    job = await createProjectAgentTaskJob(db, {
      id: taskId,
      projectId: project.id,
      agentId: agent.id,
      skill: selectedSkill,
      request: input.request,
      requestId: input.requestId,
      workerId: worker.id,
      createdAt: observedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message.includes("unique")) throw error;
    job = await getProjectAgentTaskJobByRequest(
      db,
      project.id,
      input.requestId,
    );
  }
  if (!job) throw new HttpError(409, "Agent task could not be queued");
  const payload = {
    dispatchGroupId: taskId,
    agentId: agent.id,
    agentName: agent.name,
    skillId: selectedSkill.id,
    sessionType: "task" as const,
    trigger: "manual" as const,
    scheduleId: null,
    scheduleRunId: null,
    parentSessionId: null,
    request: input.request,
    followUps: [],
    status: "running" as const,
    issues: [],
    startedAt: observedAt,
    completedAt: null,
    conversationId: null,
    requestedWorkerId: worker.id,
    workerId: worker.id,
    summary: null,
    error: null,
    events: [projectAgentTaskSessionEvent("started", observedAt)],
    updatedAt: observedAt,
  };
  const createdSession = await upsertProjectAgentSession(db, {
    project_id: project.id,
    id: taskId,
    agent_id: agent.id,
    requested_by_user_id: session.user.id,
    status: "running",
    session_type: "task",
    payload_json: JSON.stringify(payload),
    started_at: observedAt,
    completed_at: null,
    updated_at: observedAt,
  }, observedAt);
  if (!createdSession) {
    throw new HttpError(409, "Agent task session could not be created");
  }
  scheduleProjectAgentSessionRealtimePublish(
    env,
    db,
    project.id,
    context,
  );
  return json({ session: projectAgentSessionJson(createdSession) });
}
