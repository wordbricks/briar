import { listArchivedExecutionAuditEvents } from "./archive";
import type { BriarAuth } from "./auth";
import {
  getProject,
  HuntTransitionError,
  moveHuntRun,
  recoverHuntRun,
  reworkHuntRun,
  transferIssue,
} from "./db";
import { parseJsonObject } from "./agent-result-json";
import { HttpError, json } from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import { decodeProjectTransferInput } from "./project-request-contract";
import { readJson } from "./request-readers";
import {
  decodeMoveRunInput,
  decodePausedRunReworkInput,
  decodeRecoveryUserInput,
  decodeRequestIdInput,
  decodeResumeUserInput,
} from "./run-request-contract";
import { requireSession } from "./session-auth";
import { decodeDispatchRun } from "./worker-request-contract";
import { resumeRunWithCheckpointIdentity } from "./workflow-resume";
import {
  auditExecutionEvent,
  dispatchHuntRun,
  listExecutionAuditEvents,
  unassignHuntRun,
} from "./workers";

type IssueControlApplicationInput = {
  db: D1Database;
  projectId: string;
  runId: string;
  userId: string;
};

async function requireIssueExecutionProject(
  input: IssueControlApplicationInput,
  capability: "issues:execute" | "issues:write",
  deniedMessage: string,
) {
  const project = await getProject(input.db, input.projectId, input.userId);
  if (!project) throw new HttpError(404, "Project not found");
  if (!hasOrganizationCapability(project.member_role, capability)) {
    throw new HttpError(403, deniedMessage);
  }
  return project;
}

export async function transferProjectIssue(
  input: IssueControlApplicationInput & { request: unknown },
) {
  const sourceProject = await requireIssueExecutionProject(
    input,
    "issues:write",
    "Issue editing permission required",
  );
  const request = decodeProjectTransferInput(input.request);
  if (request.targetProjectId === sourceProject.id) {
    throw new HttpError(400, "Target project must be different");
  }
  const targetProject = await getProject(
    input.db,
    request.targetProjectId,
    input.userId,
  );
  if (!targetProject) throw new HttpError(404, "Target project not found");
  if (targetProject.organization_id !== sourceProject.organization_id) {
    throw new HttpError(
      403,
      "Issues can only be transferred within the same organization",
    );
  }
  const outcome = await transferIssue(input.db, {
    sourceProjectId: sourceProject.id,
    targetProjectId: targetProject.id,
    targetProjectName: targetProject.name,
    runId: input.runId,
    observedAt: new Date().toISOString(),
  });
  if (outcome === "not_found") throw new HttpError(404, "Run not found");
  if (outcome === "active") {
    throw new HttpError(409, "An active issue cannot be transferred");
  }
  if (outcome === "same_project") {
    throw new HttpError(400, "Target project must be different");
  }
  if (outcome === "source_key_conflict") {
    throw new HttpError(
      409,
      "The target project already has an issue with the same source key",
    );
  }
  if (outcome === "archive_in_progress") {
    throw new HttpError(
      409,
      "This issue is being archived; retry the transfer shortly",
    );
  }
  if (outcome === "proposal_approval_in_progress") {
    throw new HttpError(
      409,
      "This issue has an approval in progress; retry the transfer shortly",
    );
  }
  if (outcome === "execution_approval_boundary") {
    throw new HttpError(
      409,
      "Completed or cancelled channel-approved issues cannot be transferred",
    );
  }
  return {
    runId: input.runId,
    sourceProjectId: sourceProject.id,
    targetProjectId: targetProject.id,
    outcome: "transferred" as const,
  };
}

export async function recoverProjectIssueRun(
  input: IssueControlApplicationInput & {
    action: "retry" | "cancel";
    request: unknown;
  },
) {
  const project = await requireIssueExecutionProject(
    input,
    "issues:execute",
    "Issue execution permission required",
  );
  const request = decodeRecoveryUserInput(input.request);
  const result = await recoverHuntRun(input.db, project.id, {
    runId: input.runId,
    action: input.action,
    requestId: request.requestId,
    actor: `briar-app:${input.userId}`,
    reason: request.reason ?? null,
    occurredAt: new Date().toISOString(),
  });
  if (result.outcome === "not_found") {
    throw new HttpError(404, "Run not found");
  }
  if (result.outcome === "ineligible") {
    throw new HttpError(
      409,
      input.action === "retry"
        ? "Only blocked or failed runs can be retried"
        : "Completed or cancelled runs cannot be cancelled",
    );
  }
  if (
    input.action === "cancel" &&
    (result.outcome === "cancelled" || result.outcome === "already_cancelled")
  ) {
    await auditExecutionEvent(input.db, {
      organizationId: project.organization_id,
      projectId: project.id,
      runId: input.runId,
      actorUserId: input.userId,
      action: "cancelled",
      requestId: request.requestId,
      detail: { reason: request.reason ?? null },
      occurredAt: new Date().toISOString(),
    });
  }
  return { runId: input.runId, ...result };
}

export async function resumeProjectIssueRun(
  input: IssueControlApplicationInput & { request: unknown },
) {
  const project = await requireIssueExecutionProject(
    input,
    "issues:execute",
    "Issue execution permission required",
  );
  const request = decodeResumeUserInput(input.request);
  const result = await resumeRunWithCheckpointIdentity(
    input.db,
    project.id,
    input.runId,
    request,
    `briar-app:${input.userId}`,
  );
  if (result.outcome === "not_found") {
    throw new HttpError(404, "Run not found");
  }
  if (result.outcome === "conflict") {
    throw new HttpError(
      409,
      "The paused checkpoint changed before it could be resumed",
      "CHECKPOINT_CONFLICT",
    );
  }
  return {
    runId: input.runId,
    ...result,
    workflowStage: result.nextStage,
    startStage: result.nextStage,
  };
}

export async function moveProjectIssueRun(
  input: IssueControlApplicationInput & { request: unknown },
) {
  const project = await requireIssueExecutionProject(
    input,
    "issues:execute",
    "Issue execution permission required",
  );
  const request = decodeMoveRunInput(input.request);
  try {
    const result = await moveHuntRun(input.db, project.id, {
      runId: input.runId,
      status: request.status,
      workflowStage: request.workflowStage,
      requestId: request.requestId,
      actor: `briar-app:${input.userId}`,
      occurredAt: new Date().toISOString(),
    });
    if (result.outcome === "not_found") {
      throw new HttpError(404, "Run not found");
    }
    return { runId: input.runId, ...result };
  } catch (error) {
    if (error instanceof HuntTransitionError) {
      throw new HttpError(409, error.message);
    }
    throw error;
  }
}

export async function dispatchProjectIssueRun(
  input: IssueControlApplicationInput & {
    request: unknown;
    reassign: boolean;
  },
) {
  const project = await requireIssueExecutionProject(
    input,
    "issues:execute",
    "Issue execution permission required",
  );
  const request = decodeDispatchRun(input.request);
  const dispatched = await dispatchHuntRun(
    input.db,
    project.organization_id,
    project.id,
    {
      runId: input.runId,
      agentId: request.agentId ?? null,
      provider: request.provider,
      model: request.model,
      effort: request.effort,
      persistPreferences: request.persistPreferences,
      workerId: request.workerId ?? null,
      requestedByUserId: input.userId,
      requestId: request.requestId,
      occurredAt: new Date().toISOString(),
      reassign: input.reassign,
    },
  );
  if (!dispatched) throw new HttpError(404, "Run not found");
  return dispatched;
}

export async function handleIssueControlRoute(input: {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  archivesBucket: R2Bucket;
}): Promise<Response | undefined> {
  const { request, url, auth, db, archivesBucket } = input;

  const pausedReworkMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/rework$/u,
  );
  if (pausedReworkMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, pausedReworkMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "issues:execute")) {
      throw new HttpError(403, "Issue execution permission required");
    }
    const input = decodePausedRunReworkInput(await readJson(request));
    try {
      const result = await reworkHuntRun(db, project.id, {
        runId: pausedReworkMatch[2],
        workflowStage: input.workflowStage,
        requestId: input.requestId,
        actor: `briar-app:${session.user.id}`,
        reason: input.reason,
        occurredAt: new Date().toISOString(),
        checkpoint: {
          key: input.checkpointKey,
          attempt: input.attempt,
          revision: input.revision,
        },
      });
      if (result.outcome === "not_found") {
        throw new HttpError(404, "Run not found");
      }
      return json({ runId: pausedReworkMatch[2], ...result });
    } catch (error) {
      if (error instanceof HuntTransitionError) {
        throw new HttpError(409, error.message, "CHECKPOINT_CONFLICT");
      }
      throw error;
    }
  }

  const unassignRunMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/unassign$/u,
  );
  if (unassignRunMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, unassignRunMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "issues:execute")) {
      throw new HttpError(403, "Issue execution permission required");
    }
    const input = decodeRequestIdInput(await readJson(request));
    const result = await unassignHuntRun(db, project.organization_id, project.id, {
      runId: unassignRunMatch[2],
      requestedByUserId: session.user.id,
      requestId: input.requestId,
      occurredAt: new Date().toISOString(),
    });
    if (!result) throw new HttpError(404, "Run not found");
    return json(result);
  }

  const executionAuditMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/execution-audit$/u,
  );
  if (executionAuditMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, executionAuditMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "issues:execute")) {
      throw new HttpError(403, "Issue execution permission required");
    }
    const runId = new URL(request.url).searchParams.get("runId") ?? undefined;
    const [hotEvents, archivedEvents] = await Promise.all([
      listExecutionAuditEvents(db, project.id, runId),
      listArchivedExecutionAuditEvents(
        db,
        archivesBucket,
        project.id,
        runId,
      ),
    ]);
    const events = [
      ...new Map(
        [...archivedEvents, ...hotEvents].map((event) => [event.id, event]),
      ).values(),
    ].sort(
      (left, right) =>
        right.occurred_at.localeCompare(left.occurred_at) ||
        right.id.localeCompare(left.id),
    );
    return json({
      events: events.map((event) => ({
        id: event.id,
        runId: event.run_id,
        workerId: event.worker_id,
        agentId: event.agent_id,
        actorUserId: event.actor_user_id,
        actorDeviceId: event.actor_device_id,
        action: event.action,
        requestId: event.request_id,
        detail: parseJsonObject(event.detail_json) ?? {},
        occurredAt: event.occurred_at,
      })),
    });
  }

  return undefined;
}
