import {
  getProjectAgentSession,
  upsertProjectAgentSession,
} from "./project-agent-session-repository";
import type { ProjectAgentSessionRow } from "./project-agent-model";
import { projectAgentSessionJson } from "./project-agent-session-json";
import { decodeStoredProjectAgentSessionPayload } from "./project-request-contract";

export const projectAgentTaskSessionEvent = (
  type: "started" | "completed" | "failed",
  occurredAt: string,
) => ({
  id: crypto.randomUUID(),
  type,
  occurredAt,
});

export async function syncProjectAgentTaskSession(
  db: D1Database,
  job: {
    id: string;
    project_id: string;
    agent_id: string;
    status: "queued" | "running" | "completed" | "failed";
    claimed_worker_id: string | null;
    preferred_worker_id: string;
    updated_at: string;
    completed_at: string | null;
    error: string | null;
  },
  input: {
    summary?: string | null;
    conversationId?: string | null;
    error?: string | null;
  } = {},
) {
  const current = await getProjectAgentSession(db, job.project_id, job.id);
  if (!current) return null;
  const payload = decodeStoredProjectAgentSessionPayload(current.payload_json);
  const terminal = job.status === "completed" || job.status === "failed";
  const nextPayload = {
    ...payload,
    status: job.status === "queued" || job.status === "running"
      ? "running"
      : job.status,
    requestedWorkerId: payload.requestedWorkerId ?? job.preferred_worker_id,
    workerId: job.claimed_worker_id ?? payload.workerId ?? job.preferred_worker_id,
    conversationId: input.conversationId ?? payload.conversationId ?? null,
    summary: input.summary ?? payload.summary ?? null,
    error: terminal ? (input.error ?? job.error ?? null) : null,
    completedAt: terminal ? job.completed_at : null,
    updatedAt: job.updated_at,
    events: [
      ...payload.events,
      projectAgentTaskSessionEvent(
        terminal ? (job.status === "completed" ? "completed" : "failed") : "started",
        job.updated_at,
      ),
    ],
  };
  const updated = await upsertProjectAgentSession(db, {
    project_id: current.project_id,
    id: current.id,
    agent_id: current.agent_id,
    requested_by_user_id: current.requested_by_user_id,
    status: nextPayload.status as ProjectAgentSessionRow["status"],
    session_type: current.session_type,
    payload_json: JSON.stringify(nextPayload),
    started_at: current.started_at,
    completed_at: nextPayload.completedAt as string | null,
    updated_at: job.updated_at,
  }, job.updated_at);
  return updated ? projectAgentSessionJson(updated) : null;
}
