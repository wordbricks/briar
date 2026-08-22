import { normalizeAutoHuntWorkflow } from "../../src/lib/auto-hunt-contract";
import type { BriarAuth } from "./auth";
import { sha256 } from "./crypto-digest";
import { corsHeaders, HttpError, json } from "./http-response";
import { managedComputerByDeviceId } from "./managed-computer-repository";
import { endManagedComputerRemoteSessionsAndDisconnect } from "./managed-computer-remote-service";
import { getProject } from "./project-command-repository";
import { getProjectSettings } from "./project-settings-repository";
import { readJson } from "./request-readers";
import { requireSession } from "./session-auth";
import {
  decodeLeaseRenew,
  decodeWorkerBind,
  decodeWorkerConcurrency,
  decodeWorkerHeartbeat,
  decodeWorkerLabel,
  decodeWorkerRegister,
} from "./worker-request-contract";
import {
  decodeWorkerUpdateHandoff,
  decodeWorkerUpdatePrepare,
  decodeWorkerUpdateRequestId,
} from "./worker-update-contract";
import { pendingExecutionWorkerUpdate } from "./worker-update-repository";
import { workerJson } from "./worker-json";
import {
  auditExecutionEvent,
  bindExecutionWorkerProject,
  completeExecutionWorkerUpdates,
  countExecutionWorkerDeviceSessions,
  executionWorkerBindingById,
  executionWorkerDeviceForBinding,
  executionWorkerUpdateStatus,
  failExecutionWorkerUpdateHandoff,
  handoffExecutionWorkerClaim,
  hasExecutionWorkerReadinessChanged,
  reapStalledHuntRuns,
  recordWorkerHeartbeat,
  registerExecutionWorker,
  renewHuntRunLease,
  requestExecutionWorkerUpdate,
  unbindExecutionWorker,
  updateExecutionWorkerConcurrency,
  updateExecutionWorkerLabel,
  WorkerConflictError,
} from "./workers";

export type ExecutionWorkerRouteInput = {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  env: Env;
  requireAgentProject: () => Promise<string>;
  requireWorkerCredential: () => Promise<{
    deviceId: string;
    organizationId: string;
    ownerUserId: string;
  }>;
  requireWorkerProjectBinding: (projectId: string) => Promise<{
    binding: { id: string };
  }>;
};

const bearerToken = (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
};

export async function handleExecutionWorkerRoute(
  routeInput: ExecutionWorkerRouteInput,
): Promise<Response | undefined> {
  const { request, url, auth, db, env } = routeInput;
  const { pathname } = url;
  const requireAgentProject = (_db: D1Database, _request: Request) =>
    routeInput.requireAgentProject();
  const requireWorkerCredential = (_db: D1Database, _request: Request) =>
    routeInput.requireWorkerCredential();
  const requireWorkerProjectBinding = (
    _db: D1Database,
    _request: Request,
    projectId: string,
  ) => routeInput.requireWorkerProjectBinding(projectId);

  const workerRegistrationMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/workers\/register$/u,
  );
  if (workerRegistrationMatch && request.method === "POST") {
    const projectId = workerRegistrationMatch[1];
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeWorkerRegister(await readJson(request));
    const observedAt = new Date().toISOString();
    const workerToken = `briar_worker_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const registration = await registerExecutionWorker(db, projectId, {
      id: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      organizationId: project.organization_id,
      ownerUserId: session.user.id,
      label: input.label,
      deviceIdentityHash: await sha256(input.deviceIdentity),
      credentialTokenHash: await sha256(workerToken),
      agentProvider: input.agentProvider,
      providers: input.providers,
      providerHealth: input.providerHealth,
      providerCapabilities: input.providerCapabilities,
      maxConcurrentSessions: input.maxConcurrentSessions,
      versions: input.versions,
      observedAt,
    });
    const response = json(
      {
        organizationId: project.organization_id,
        deviceId: registration.device.id,
        worker: workerJson(registration.worker, observedAt),
        workerToken,
      },
      201,
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  const workerBindingMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/workers\/bind$/u,
  );
  if (workerBindingMatch && request.method === "POST") {
    const projectId = workerBindingMatch[1];
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeWorkerBind(await readJson(request));
    const observedAt = new Date().toISOString();
    const binding = await bindExecutionWorkerProject(db, projectId, {
      id: crypto.randomUUID(),
      organizationId: project.organization_id,
      ownerUserId: session.user.id,
      deviceIdentityHash: await sha256(input.deviceIdentity),
      agentProvider: input.agentProvider,
      providers: input.providers,
      providerHealth: input.providerHealth,
      providerCapabilities: input.providerCapabilities,
      versions: input.versions,
      observedAt,
    });
    return json(
      {
        organizationId: project.organization_id,
        deviceId: binding.device.id,
        worker: workerJson(binding.worker, observedAt),
      },
      201,
    );
  }

  const workerDisableMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/workers\/([0-9a-zA-Z-]+)$/u,
  );
  if (workerDisableMatch && request.method === "PATCH") {
    const projectId = workerDisableMatch[1];
    const workerId = workerDisableMatch[2];
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const device = await executionWorkerDeviceForBinding(db, workerId);
    if (!device || device.organization_id !== project.organization_id) {
      throw new HttpError(404, "Worker not found");
    }
    if (
      device.owner_user_id !== session.user.id &&
      project.member_role !== "owner" &&
      project.member_role !== "admin"
    ) {
      throw new HttpError(403, "Worker owner or organization admin access required");
    }
    const input = decodeWorkerConcurrency(await readJson(request));
    const observedAt = new Date().toISOString();
    const updated = await updateExecutionWorkerConcurrency(
      db,
      device.id,
      input.maxConcurrentSessions,
      observedAt,
    );
    if (!updated) throw new HttpError(409, "Worker is disabled");
    const binding = await executionWorkerBindingById(
      db,
      device.id,
      workerId,
    );
    if (!binding) throw new HttpError(404, "Worker not found");
    binding.active_sessions = await countExecutionWorkerDeviceSessions(
      db,
      device.id,
      observedAt,
    );
    return json(workerJson(binding, observedAt));
  }
  if (workerDisableMatch && request.method === "DELETE") {
    const projectId = workerDisableMatch[1];
    const workerId = workerDisableMatch[2];
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const device = await executionWorkerDeviceForBinding(db, workerId);
    if (!device || device.organization_id !== project.organization_id) {
      throw new HttpError(404, "Worker not found");
    }
    if (
      device.owner_user_id !== session.user.id &&
      project.member_role !== "owner" &&
      project.member_role !== "admin"
    ) {
      throw new HttpError(403, "Worker owner or organization admin access required");
    }
    const managedComputer = await managedComputerByDeviceId(db, device.id);
    const remainingBindings = await db.prepare(
      `select count(*) binding_count from briar_execution_workers
       where device_id = ?`,
    ).bind(device.id).first<{ binding_count: number }>();
    const observedAt = new Date().toISOString();
    await unbindExecutionWorker(
      db,
      device.id,
      projectId,
      observedAt,
    );
    if (managedComputer && (remainingBindings?.binding_count ?? 0) <= 1) {
      await endManagedComputerRemoteSessionsAndDisconnect(db, env, {
        managedComputerId: managedComputer.id,
        reason: "worker_credential_revoked",
        observedAt,
      });
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const workerUpdatePrepareMatch = pathname.match(
    /^\/workers\/([0-9a-zA-Z-]+)\/update-handoff\/prepare$/u,
  );
  if (workerUpdatePrepareMatch && request.method === "POST") {
    const principal = await requireWorkerCredential(db, request);
    const binding = await executionWorkerBindingById(
      db,
      principal.deviceId,
      workerUpdatePrepareMatch[1],
    );
    if (!binding || binding.state === "disabled") {
      throw new HttpError(403, "Worker is not enabled for this project");
    }
    const input = decodeWorkerUpdatePrepare(await readJson(request));
    const observedAt = new Date().toISOString();
    const updateRequest = await requestExecutionWorkerUpdate(db, {
      id: crypto.randomUUID(),
      organizationId: principal.organizationId,
      deviceId: principal.deviceId,
      requestedByUserId: principal.ownerUserId,
      targetVersion: input.targetVersion,
      requestedAt: observedAt,
    });
    const status = await executionWorkerUpdateStatus(db, {
      deviceId: principal.deviceId,
      requestId: updateRequest.id,
      observedAt,
    });
    return json({
      requestId: updateRequest.id,
      targetVersion: updateRequest.targetVersion,
      handoffState: status?.request.handoffState ?? updateRequest.handoffState,
      activeWorkCount: status?.activeWorkCount ?? 0,
      ready: status?.ready ?? false,
    }, 202);
  }

  const workerUpdateStatusMatch = pathname.match(
    /^\/workers\/([0-9a-zA-Z-]+)\/update-handoff\/status$/u,
  );
  if (workerUpdateStatusMatch && request.method === "GET") {
    const principal = await requireWorkerCredential(db, request);
    const binding = await executionWorkerBindingById(
      db,
      principal.deviceId,
      workerUpdateStatusMatch[1],
    );
    if (!binding || binding.state === "disabled") {
      throw new HttpError(403, "Worker is not enabled for this project");
    }
    const requestId = new URL(request.url).searchParams.get("requestId") ?? undefined;
    if (requestId) decodeWorkerUpdateRequestId(requestId);
    const status = await executionWorkerUpdateStatus(db, {
      deviceId: principal.deviceId,
      requestId,
      observedAt: new Date().toISOString(),
    });
    if (!status) return json({ request: null, activeWorkCount: 0, ready: true });
    return json({
      requestId: status.request.id,
      targetVersion: status.request.targetVersion,
      status: status.request.status,
      handoffState: status.request.handoffState,
      handoffError: status.request.handoffError,
      activeWorkCount: status.activeWorkCount,
      ready: status.ready,
    });
  }

  const workerUpdateClaimMatch = pathname.match(
    /^\/workers\/([0-9a-zA-Z-]+)\/update-handoff\/claim$/u,
  );
  if (workerUpdateClaimMatch && request.method === "POST") {
    const principal = await requireWorkerCredential(db, request);
    const binding = await executionWorkerBindingById(
      db,
      principal.deviceId,
      workerUpdateClaimMatch[1],
    );
    if (!binding || binding.state === "disabled") {
      throw new HttpError(403, "Worker is not enabled for this project");
    }
    const input = decodeWorkerUpdateHandoff(await readJson(request));
    if (input.projectId !== binding.project_id) {
      throw new HttpError(403, "Worker handoff project does not match its binding");
    }
    const observedAt = new Date().toISOString();
    const claimTokenHash = await sha256(input.claimToken);
    let outcome;
    try {
      outcome = await handoffExecutionWorkerClaim(db, {
        requestId: input.requestId,
        organizationId: principal.organizationId,
        deviceId: principal.deviceId,
        projectId: input.projectId,
        workerId: binding.id,
        workType: input.workType,
        workId: input.workId,
        runId: input.runId ?? null,
        claimTokenHash,
        metadata: input.checkpoint,
        observedAt,
      });
    } catch (error) {
      try {
        await failExecutionWorkerUpdateHandoff(db, {
          requestId: input.requestId,
          organizationId: principal.organizationId,
          deviceId: principal.deviceId,
          projectId: input.projectId,
          workerId: binding.id,
          workType: input.workType,
          workId: input.workId,
          runId: input.runId ?? null,
          claimTokenHash,
          metadata: input.checkpoint,
          error: error instanceof Error ? error.message : String(error),
          observedAt,
        });
      } catch (failureError) {
        console.error(
          `worker update handoff failure could not be recorded: ${
            failureError instanceof Error ? failureError.message : String(failureError)
          }`,
        );
      }
      throw error;
    }
    if (outcome.outcome === "not_ready") {
      throw new HttpError(409, "Worker update handoff is not draining");
    }
    if (outcome.outcome === "not_active") {
      throw new HttpError(409, "Worker claim is no longer active");
    }
    const status = await executionWorkerUpdateStatus(db, {
      deviceId: principal.deviceId,
      requestId: input.requestId,
      observedAt: new Date().toISOString(),
    });
    return json({
      outcome: outcome.outcome,
      requestId: input.requestId,
      handoffState: status?.request.handoffState ?? "draining",
      activeWorkCount: outcome.activeWorkCount,
      ready: status?.ready ?? false,
    });
  }

  const workerHeartbeatMatch = pathname.match(
    /^\/workers\/([0-9a-zA-Z-]+)\/heartbeat$/u,
  );
  if (workerHeartbeatMatch && request.method === "POST") {
    const principal = await requireWorkerCredential(db, request);
    const binding = await executionWorkerBindingById(
      db,
      principal.deviceId,
      workerHeartbeatMatch[1],
    );
    if (!binding || binding.state === "disabled") {
      throw new HttpError(403, "Worker is not enabled for this project");
    }
    const input = decodeWorkerHeartbeat(await readJson(request));
    const observedAt = new Date().toISOString();
    const pendingBeforeHeartbeat = await pendingExecutionWorkerUpdate(
      db,
      principal.deviceId,
    );
    const updateIsDraining = pendingBeforeHeartbeat?.handoffState === "draining";
    const worker = await recordWorkerHeartbeat(db, binding.project_id, {
      workerId: workerHeartbeatMatch[1],
      versions: input.versions,
      acceptingWork: updateIsDraining ? false : input.acceptingWork,
      readinessState: updateIsDraining ? "busy" : input.readinessState,
      readinessDetail: updateIsDraining
        ? "계획된 업데이트 handoff를 진행 중입니다."
        : input.readinessDetail,
      capabilities: input.capabilities,
      observedAt,
    });
    await completeExecutionWorkerUpdates(
      db,
      principal.deviceId,
      input.versions?.briar,
      observedAt,
    );
    const updateDirective = await pendingExecutionWorkerUpdate(
      db,
      principal.deviceId,
    );
    if (hasExecutionWorkerReadinessChanged(binding, worker)) {
      await auditExecutionEvent(db, {
        organizationId: principal.organizationId,
        projectId: binding.project_id,
        workerId: binding.id,
        actorDeviceId: principal.deviceId,
        action: "worker_readiness_changed",
        detail: {
          acceptingWork: worker.accepting_work === 1,
          readinessState: worker.readiness_state,
          readinessDetail: worker.readiness_detail,
        },
        occurredAt: observedAt,
      });
    }
    // A heartbeat is the cheapest regular touchpoint, so let it also recover
    // runs whose holder stopped reporting.
    const reaped = await reapStalledHuntRuns(db, binding.project_id, observedAt);
    // Share the project workflow tool list so each worker can probe readiness
    // against the same requirements, even when its local config is stale.
    const projectSettings = await getProjectSettings(db, binding.project_id);
    const projectWorkflow = projectSettings?.workflow_json
      ? normalizeAutoHuntWorkflow(JSON.parse(projectSettings.workflow_json))
      : null;
    return json({
      worker: workerJson(worker, observedAt),
      reaped,
      workflowRequirements: projectWorkflow?.requirements ?? [],
      updateDirective,
    });
  }

  const workerLabelMatch = pathname.match(
    /^\/workers\/([0-9a-zA-Z-]+)\/label$/u,
  );
  if (workerLabelMatch && request.method === "PATCH") {
    const principal = await requireWorkerCredential(db, request);
    const binding = await executionWorkerBindingById(
      db,
      principal.deviceId,
      workerLabelMatch[1],
    );
    if (!binding || binding.state === "disabled") {
      throw new HttpError(403, "Worker is not enabled for this project");
    }
    const input = decodeWorkerLabel(await readJson(request));
    const device = await updateExecutionWorkerLabel(
      db,
      principal.deviceId,
      input.label,
      new Date().toISOString(),
    );
    if (!device) throw new HttpError(409, "Worker is disabled");
    return json({ deviceId: device.id, label: device.label });
  }

  const leaseMatch = pathname.match(/^\/runs\/([0-9a-f-]+)\/lease$/u);
  if (leaseMatch && request.method === "POST") {
    const input = decodeLeaseRenew(await readJson(request));
    let workerId: string | undefined;
    const projectId = bearerToken(request).startsWith("briar_worker_")
      ? (() => {
          if (!input.projectId) {
            throw new HttpError(400, "projectId is required for worker lease renewal");
          }
          return input.projectId;
        })()
      : await requireAgentProject(db, request);
    if (bearerToken(request).startsWith("briar_worker_")) {
      const worker = await requireWorkerProjectBinding(
        db,
        request,
        projectId,
      );
      workerId = worker.binding.id;
    }
    const observedAt = new Date().toISOString();
    let renewed;
    try {
      renewed = await renewHuntRunLease(db, projectId, {
        runId: leaseMatch[1],
        claimTokenHash: await sha256(input.claimToken),
        observedAt,
        workerId,
      });
    } catch (error) {
      if (workerId && error instanceof WorkerConflictError) {
        const project = await db
          .prepare(`select organization_id from briar_projects where id = ?`)
          .bind(projectId)
          .first<{ organization_id: string }>();
        if (project) {
          await auditExecutionEvent(db, {
            organizationId: project.organization_id,
            projectId,
            runId: leaseMatch[1],
            workerId,
            action: "lease_lost",
            detail: { reason: error.message },
            occurredAt: observedAt,
          });
        }
      }
      throw error;
    }
    return json({
      runId: renewed.id,
      leaseExpiresAt: renewed.lease_expires_at,
    });
  }

  return undefined;
}
