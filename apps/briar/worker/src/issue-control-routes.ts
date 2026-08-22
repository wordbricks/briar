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

export async function handleIssueControlRoute(input: {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  archivesBucket: R2Bucket;
}): Promise<Response | undefined> {
  const { request, url, auth, db, archivesBucket } = input;

  const recoveryMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/(retry|cancel)$/u,
  );

  const issueTransferMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/transfer$/u,
  );
  if (issueTransferMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const sourceProject = await getProject(
      db,
      issueTransferMatch[1],
      session.user.id,
    );
    if (!sourceProject) throw new HttpError(404, "Project not found");
    const body = decodeProjectTransferInput(await readJson(request));
    if (body.targetProjectId === sourceProject.id) {
      throw new HttpError(400, "Target project must be different");
    }
    const targetProject = await getProject(
      db,
      body.targetProjectId,
      session.user.id,
    );
    if (!targetProject) throw new HttpError(404, "Target project not found");
    if (targetProject.organization_id !== sourceProject.organization_id) {
      throw new HttpError(
        403,
        "Issues can only be transferred within the same organization",
      );
    }
    const outcome = await transferIssue(db, {
      sourceProjectId: sourceProject.id,
      targetProjectId: targetProject.id,
      targetProjectName: targetProject.name,
      runId: issueTransferMatch[2],
      observedAt: new Date().toISOString(),
    });
    if (outcome === "not_found") {
      throw new HttpError(404, "Run not found");
    }
    if (outcome === "active") {
      throw new HttpError(
        409,
        "An active issue cannot be transferred",
      );
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
    return json({
      runId: issueTransferMatch[2],
      sourceProjectId: sourceProject.id,
      targetProjectId: targetProject.id,
      outcome: "transferred",
    });
  }

  if (recoveryMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, recoveryMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeRecoveryUserInput(await readJson(request));
    const result = await recoverHuntRun(db, project.id, {
      runId: recoveryMatch[2],
      action: recoveryMatch[3] as "retry" | "cancel",
      requestId: input.requestId,
      actor: `briar-app:${session.user.id}`,
      reason: input.reason ?? null,
      occurredAt: new Date().toISOString(),
    });
    if (result.outcome === "not_found") {
      throw new HttpError(404, "Run not found");
    }
    if (result.outcome === "ineligible") {
      throw new HttpError(
        409,
        recoveryMatch[3] === "retry"
          ? "Only blocked or failed runs can be retried"
          : "Completed or cancelled runs cannot be cancelled",
      );
    }
    if (
      recoveryMatch[3] === "cancel" &&
      (result.outcome === "cancelled" ||
        result.outcome === "already_cancelled")
    ) {
      await auditExecutionEvent(db, {
        organizationId: project.organization_id,
        projectId: project.id,
        runId: recoveryMatch[2],
        actorUserId: session.user.id,
        action: "cancelled",
        requestId: input.requestId,
        detail: { reason: input.reason ?? null },
        occurredAt: new Date().toISOString(),
      });
    }
    return json({ runId: recoveryMatch[2], ...result });
  }

  const resumeRunMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/resume$/u,
  );
  if (resumeRunMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, resumeRunMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeResumeUserInput(await readJson(request));
    const result = await resumeRunWithCheckpointIdentity(
      db,
      project.id,
      resumeRunMatch[2],
      input,
      `briar-app:${session.user.id}`,
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
    return json({
      runId: resumeRunMatch[2],
      ...result,
      workflowStage: result.nextStage,
      startStage: result.nextStage,
    });
  }

  const pausedReworkMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/rework$/u,
  );
  if (pausedReworkMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, pausedReworkMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
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

  const moveRunMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/status$/u,
  );
  if (moveRunMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, moveRunMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeMoveRunInput(await readJson(request));
    try {
      const result = await moveHuntRun(db, project.id, {
        runId: moveRunMatch[2],
        status: input.status,
        workflowStage: input.workflowStage,
        requestId: input.requestId,
        actor: `briar-app:${session.user.id}`,
        occurredAt: new Date().toISOString(),
      });
      if (result.outcome === "not_found") {
        throw new HttpError(404, "Run not found");
      }
      return json({ runId: moveRunMatch[2], ...result });
    } catch (error) {
      if (error instanceof HuntTransitionError) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
  }

  const dispatchRunMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/(dispatch|reassign)$/u,
  );
  if (dispatchRunMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, dispatchRunMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeDispatchRun(await readJson(request));
    const dispatched = await dispatchHuntRun(
      db,
      project.organization_id,
      project.id,
      {
        runId: dispatchRunMatch[2],
        agentId: input.agentId ?? null,
        provider: input.provider,
        model: input.model,
        effort: input.effort,
        persistPreferences: input.persistPreferences,
        workerId: input.workerId ?? null,
        requestedByUserId: session.user.id,
        requestId: input.requestId,
        occurredAt: new Date().toISOString(),
        reassign: dispatchRunMatch[3] === "reassign",
      },
    );
    if (!dispatched) throw new HttpError(404, "Run not found");
    return json(dispatched);
  }

  const unassignRunMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/unassign$/u,
  );
  if (unassignRunMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, unassignRunMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
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
    if (project.member_role !== "owner" && project.member_role !== "admin") {
      throw new HttpError(403, "Organization admin access required");
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
