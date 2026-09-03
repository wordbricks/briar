import {
  getTeam,
  HuntTransitionError,
  moveHuntRun,
  transferIssue,
} from "./db";
import { HttpError } from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import { decodeTeamTransferInput } from "./team-request-contract";
import {
  decodeMoveRunInput,
  decodePausedRunReworkInput,
  decodeRecoveryUserInput,
  decodeRequestIdInput,
  decodeResumeUserInput,
} from "./run-request-contract";
import { decodeDispatchRun } from "./worker-request-contract";
import {
  recoverRunApplication,
  reworkRunApplication,
  resumeRunApplication,
} from "./run-control-application";
import {
  auditExecutionEvent,
  dispatchHuntRun,
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
  const project = await getTeam(input.db, input.projectId, input.userId);
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
  const request = decodeTeamTransferInput(input.request);
  if (request.targetProjectId === sourceProject.id) {
    throw new HttpError(400, "Target project must be different");
  }
  const targetProject = await getTeam(
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
  const result = await recoverRunApplication({
    db: input.db,
    projectId: project.id,
    runId: input.runId,
    action: input.action,
    requestId: request.requestId,
    actor: `briar-app:${input.userId}`,
    reason: request.reason ?? null,
  });
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
  return result;
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
  return resumeRunApplication({
    db: input.db,
    projectId: project.id,
    runId: input.runId,
    requestId: request.requestId,
    checkpointKey: request.checkpointKey,
    attempt: request.attempt,
    revision: request.revision,
    actor: `briar-app:${input.userId}`,
  });
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

export async function reworkProjectIssueRun(
  input: IssueControlApplicationInput & { request: unknown },
) {
  const project = await requireIssueExecutionProject(
    input,
    "issues:execute",
    "Issue execution permission required",
  );
  const request = decodePausedRunReworkInput(input.request);
  return reworkRunApplication({
    db: input.db,
    projectId: project.id,
    runId: input.runId,
    workflowStage: request.workflowStage,
    requestId: request.requestId,
    actor: `briar-app:${input.userId}`,
    reason: request.reason,
    checkpoint: {
      key: request.checkpointKey,
      attempt: request.attempt,
      revision: request.revision,
    },
  });
}

export async function unassignProjectIssueRun(
  input: IssueControlApplicationInput & { request: unknown },
) {
  const project = await requireIssueExecutionProject(
    input,
    "issues:execute",
    "Issue execution permission required",
  );
  const request = decodeRequestIdInput(input.request);
  const result = await unassignHuntRun(
    input.db,
    project.organization_id,
    project.id,
    {
      runId: input.runId,
      requestedByUserId: input.userId,
      requestId: request.requestId,
      occurredAt: new Date().toISOString(),
    },
  );
  if (!result) throw new HttpError(404, "Run not found");
  return result;
}
