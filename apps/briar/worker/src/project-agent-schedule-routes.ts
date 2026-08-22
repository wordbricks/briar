import {
  isRepositoryWorkflowPending,
  normalizeAutoHuntWorkflow,
} from "../../src/lib/auto-hunt-contract";
import {
  claimDueProjectAgentScheduleRun,
  completeProjectAgentScheduleRun,
  createProjectAgentSchedule,
  deleteProjectAgentSchedule,
  getProject,
  getProjectSettings,
  listClaimableProjectAgentScheduleProjectIds,
  listProjectAgentScheduleRuns,
  listProjectAgentSchedules,
  renewProjectAgentScheduleRunLease,
  updateProjectAgentSchedule,
} from "./db";
import { decodeProjectAgentScheduleBatchClaim } from "./account-organization-request-contract";
import { decodeProjectAgentScheduleInput } from "./project-request-contract";
import {
  decodeProjectAgentScheduleRunCompletion,
  decodeProjectAgentScheduleRunRenew,
} from "./worker-request-contract";
import { sha256 } from "./crypto-digest";
import { corsHeaders, HttpError, json } from "./http-response";
import {
  projectAgentScheduleJson,
  projectAgentScheduleRunJson,
} from "./project-agent-schedule-json";
import { readJson } from "./request-readers";
import { scheduleProjectRealtimePublish } from "./realtime-scheduling";

export type ProjectAgentScheduleRouteInput = {
  request: Request;
  db: D1Database;
  env: Env;
  context?: ExecutionContext;
  requireSession: () => Promise<{ user: { id: string } }>;
};

export async function handleProjectAgentScheduleRoute(
  routeInput: ProjectAgentScheduleRouteInput,
): Promise<Response | undefined> {
  const { request, db, env, context } = routeInput;
  const pathname = new URL(request.url).pathname;

  const projectAgentSchedulesMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-schedules$/u,
  );
  if (projectAgentSchedulesMatch && request.method === "GET") {
    const session = await routeInput.requireSession();
    const project = await getProject(
      db,
      projectAgentSchedulesMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const schedules = await listProjectAgentSchedules(db, project.id);
    return json({
      schedules: schedules.map(projectAgentScheduleJson),
    });
  }
  if (projectAgentSchedulesMatch && request.method === "POST") {
    const session = await routeInput.requireSession();
    const project = await getProject(
      db,
      projectAgentSchedulesMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeProjectAgentScheduleInput(
      await readJson(request),
    );
    const schedule = await createProjectAgentSchedule(db, project.id, {
      ...input,
      createdByUserId: session.user.id,
    });
    if (!schedule) throw new HttpError(404, "Project agent not found");
    return json({ schedule: projectAgentScheduleJson(schedule) }, 201);
  }

  const projectAgentScheduleMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-schedules\/([0-9a-f-]+)$/u,
  );
  if (projectAgentScheduleMatch && request.method === "PUT") {
    const session = await routeInput.requireSession();
    const project = await getProject(
      db,
      projectAgentScheduleMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeProjectAgentScheduleInput(
      await readJson(request),
    );
    const schedule = await updateProjectAgentSchedule(
      db,
      project.id,
      projectAgentScheduleMatch[2],
      input,
    );
    if (!schedule) {
      throw new HttpError(404, "Project agent schedule not found");
    }
    return json({ schedule: projectAgentScheduleJson(schedule) });
  }
  if (projectAgentScheduleMatch && request.method === "DELETE") {
    const session = await routeInput.requireSession();
    const project = await getProject(
      db,
      projectAgentScheduleMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const result = await deleteProjectAgentSchedule(
      db,
      project.id,
      projectAgentScheduleMatch[2],
    );
    if (result === "running") {
      throw new HttpError(409, "A schedule run is currently active");
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const projectAgentScheduleRunsMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-schedule-runs$/u,
  );
  if (projectAgentScheduleRunsMatch && request.method === "GET") {
    const session = await routeInput.requireSession();
    const project = await getProject(
      db,
      projectAgentScheduleRunsMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const runs = await listProjectAgentScheduleRuns(db, project.id);
    return json({ runs: runs.map((run) => projectAgentScheduleRunJson(run)) });
  }

  if (pathname === "/agent-schedule-runs/claim" && request.method === "POST") {
    const session = await routeInput.requireSession();
    const input = decodeProjectAgentScheduleBatchClaim(
      await readJson(request),
    );
    const observedAt = new Date().toISOString();
    const projectIds = await listClaimableProjectAgentScheduleProjectIds(
      db,
      session.user.id,
      input.projectIds,
      observedAt,
    );
    for (const projectId of projectIds) {
      const settings = await getProjectSettings(db, projectId);
      const workflow = normalizeAutoHuntWorkflow(
        settings?.workflow_json ? JSON.parse(settings.workflow_json) : null,
      );
      if (isRepositoryWorkflowPending(workflow)) continue;
      const claimToken = `briar_schedule_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
      const run = await claimDueProjectAgentScheduleRun(db, projectId, {
        claimTokenHash: await sha256(claimToken),
        observedAt,
      });
      if (!run) continue;
      scheduleProjectRealtimePublish(env, db, projectId, context);
      return json({ run: projectAgentScheduleRunJson(run, claimToken) });
    }
    return json({ run: null });
  }

  const projectAgentScheduleRunsClaimMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-schedule-runs\/claim$/u,
  );
  if (projectAgentScheduleRunsClaimMatch && request.method === "POST") {
    const session = await routeInput.requireSession();
    const project = await getProject(
      db,
      projectAgentScheduleRunsClaimMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const settings = await getProjectSettings(db, project.id);
    const workflow = normalizeAutoHuntWorkflow(
      settings?.workflow_json ? JSON.parse(settings.workflow_json) : null,
    );
    if (isRepositoryWorkflowPending(workflow)) {
      throw new HttpError(409, "Repository workflow has not been generated");
    }
    const observedAt = new Date().toISOString();
    const claimToken = `briar_schedule_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const run = await claimDueProjectAgentScheduleRun(db, project.id, {
      claimTokenHash: await sha256(claimToken),
      observedAt,
    });
    if (run) scheduleProjectRealtimePublish(env, db, project.id, context);
    return json({
      run: run ? projectAgentScheduleRunJson(run, claimToken) : null,
    });
  }

  const projectAgentScheduleRunCompleteMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-schedule-runs\/([0-9a-f-]+)\/complete$/u,
  );
  if (projectAgentScheduleRunCompleteMatch && request.method === "POST") {
    const session = await routeInput.requireSession();
    const project = await getProject(
      db,
      projectAgentScheduleRunCompleteMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeProjectAgentScheduleRunCompletion(
      await readJson(request),
    );
    const run = await completeProjectAgentScheduleRun(
      db,
      project.id,
      projectAgentScheduleRunCompleteMatch[2],
      {
        claimTokenHash: await sha256(input.claimToken),
        status: input.status,
        resultSummary: input.resultSummary ?? null,
        structuredResult: input.structuredResult,
        error: input.error ?? null,
        observedAt: new Date().toISOString(),
      },
    );
    if (!run)
      throw new HttpError(409, "Schedule run claim is no longer active");
    return json({ run: projectAgentScheduleRunJson(run) });
  }

  const projectAgentScheduleRunRenewMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-schedule-runs\/([0-9a-f-]+)\/renew$/u,
  );
  if (projectAgentScheduleRunRenewMatch && request.method === "POST") {
    const session = await routeInput.requireSession();
    const project = await getProject(
      db,
      projectAgentScheduleRunRenewMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeProjectAgentScheduleRunRenew(
      await readJson(request),
    );
    const run = await renewProjectAgentScheduleRunLease(
      db,
      project.id,
      projectAgentScheduleRunRenewMatch[2],
      {
        claimTokenHash: await sha256(input.claimToken),
        observedAt: new Date().toISOString(),
      },
    );
    if (!run)
      throw new HttpError(409, "Schedule run claim is no longer active");
    return json({ leaseExpiresAt: run.lease_expires_at });
  }
}
