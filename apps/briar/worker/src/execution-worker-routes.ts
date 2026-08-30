import { normalizeAutoHuntWorkflow } from "../../src/lib/auto-hunt-contract";
import type { BriarAuth } from "./auth";
import { sha256 } from "./crypto-digest";
import { corsHeaders, HttpError, json } from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import { managedComputerByDeviceId } from "./managed-computer-repository";
import { endManagedComputerRemoteSessionsAndDisconnect } from "./managed-computer-remote-service";
import { getProject } from "./project-command-repository";
import { getProjectSettings } from "./project-settings-repository";
import { readJson } from "./request-readers";
import { requireSession } from "./session-auth";
import {
  decodeWorkerBind,
  decodeWorkerConcurrency,
  decodeWorkerHeartbeat,
  decodeWorkerLabel,
  decodeWorkerRegister,
} from "./worker-request-contract";
import {
  decodeWorkerUpdateFailure,
  decodeWorkerUpdatePrepare,
  decodeWorkerUpdateRequestId,
} from "./worker-update-contract";
import { pendingExecutionWorkerUpdate } from "./worker-update-repository";
import { workerJson } from "./worker-json";
import {
  recoverMissingWorkerHardDelete,
  recordPreservedWorkerBinding,
} from "./worker-lifecycle-repository";
import {
  projectWorkerDeleteReason,
  workerLifecycleRequestId,
} from "./worker-lifecycle-request";
import {
  auditExecutionEvent,
  bindExecutionWorkerProject,
  completeExecutionWorkerUpdates,
  countExecutionWorkerDeviceSessions,
  executionWorkerBindingById,
  executionWorkerDeviceForBinding,
  executionWorkerUpdateStatus,
  failExecutionWorkerUpdate,
  hasExecutionWorkerReadinessChanged,
  reapStalledHuntRuns,
  recordWorkerHeartbeat,
  registerExecutionWorker,
  requestExecutionWorkerUpdate,
  unbindExecutionWorker,
  updateExecutionWorkerConcurrency,
  updateExecutionWorkerLabel,
  workerStateAt,
} from "./workers";

export type ExecutionWorkerRouteInput = {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  env: Env;
  requireWorkerCredential: () => Promise<{
    deviceId: string;
    organizationId: string;
    ownerUserId: string;
  }>;
};

export async function handleExecutionWorkerRoute(
  routeInput: ExecutionWorkerRouteInput,
): Promise<Response | undefined> {
  const { request, url, auth, db, env } = routeInput;
  const { pathname } = url;
  const requireWorkerCredential = (_db: D1Database, _request: Request) =>
    routeInput.requireWorkerCredential();

  const workerRegistrationMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/workers\/register$/u,
  );
  if (workerRegistrationMatch && request.method === "POST") {
    const projectId = workerRegistrationMatch[1];
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
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
    if (!hasOrganizationCapability(project.member_role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
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
    if (!hasOrganizationCapability(project.member_role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
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
    const observedAt = new Date().toISOString();
    const requestId = workerLifecycleRequestId(
      request,
      `worker-unlink:${projectId}:${workerId}`,
    );
    const lifecycleReason = projectWorkerDeleteReason(request);
    const project = await getProject(db, projectId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const device = await executionWorkerDeviceForBinding(db, workerId);
    if (!device || device.organization_id !== project.organization_id) {
      if (await recoverMissingWorkerHardDelete(db, {
        requestId,
        organizationId: project.organization_id,
        projectId,
        workerId,
        operation: "binding_delete",
        observedAt,
      })) {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      throw new HttpError(404, "Worker not found");
    }
    if (!hasOrganizationCapability(project.member_role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    const managedComputer = await managedComputerByDeviceId(db, device.id);
    const remainingBindings = await db.prepare(
      `select count(*) binding_count from briar_execution_workers
       where device_id = ?`,
    ).bind(device.id).first<{ binding_count: number }>();
    await unbindExecutionWorker(
      db,
      device.id,
      projectId,
      observedAt,
      {
        requestId,
        organizationId: project.organization_id,
        workerId,
        reason: lifecycleReason,
      },
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

  const workerUpdateFailureMatch = pathname.match(
    /^\/workers\/([0-9a-zA-Z-]+)\/update-handoff\/fail$/u,
  );
  if (workerUpdateFailureMatch && request.method === "POST") {
    const principal = await requireWorkerCredential(db, request);
    const binding = await executionWorkerBindingById(
      db,
      principal.deviceId,
      workerUpdateFailureMatch[1],
    );
    if (!binding || binding.state === "disabled") {
      throw new HttpError(403, "Worker is not enabled for this project");
    }
    const input = decodeWorkerUpdateFailure(await readJson(request));
    await failExecutionWorkerUpdate(db, {
      requestId: input.requestId,
      organizationId: principal.organizationId,
      deviceId: principal.deviceId,
      error: input.error,
      observedAt: new Date().toISOString(),
    });
    return new Response(null, { status: 204, headers: corsHeaders });
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
    const updateDirective = await completeExecutionWorkerUpdates(
      db,
      principal.deviceId,
      input.versions?.briar,
      observedAt,
      pendingBeforeHeartbeat,
    );
    const updateIsPending = updateDirective !== null;
    const updateFailed = updateDirective?.handoffState === "failed";
    const worker = await recordWorkerHeartbeat(db, binding.project_id, {
      workerId: workerHeartbeatMatch[1],
      knownBinding: binding,
      versions: input.versions,
      acceptingWork: updateIsPending ? false : input.acceptingWork,
      readinessState: updateFailed
        ? "needs_attention"
        : updateIsPending
          ? "busy"
          : input.readinessState,
      readinessDetail: updateFailed
        ? "원격 런타임 업데이트에 실패했습니다."
        : updateIsPending
          ? "계획된 업데이트 handoff를 진행 중입니다."
          : input.readinessDetail,
      capabilities: input.capabilities,
      observedAt,
    });
    if (
      !pendingBeforeHeartbeat &&
      workerStateAt(binding.last_heartbeat_at, observedAt, binding.state) === "stale"
    ) {
      await recordPreservedWorkerBinding(db, {
        requestId: `worker-restart:${binding.id}:${binding.last_heartbeat_at}`,
        organizationId: principal.organizationId,
        projectId: binding.project_id,
        deviceId: principal.deviceId,
        workerId: binding.id,
        reason: "restart",
        observedAt,
        detail: {
          bindingPreserved: true,
          detection: "heartbeat_after_stale",
        },
      }).catch(() => {
        console.error(JSON.stringify({
          message: "Execution Worker restart lifecycle telemetry failed",
          deviceId: principal.deviceId,
          workerId: binding.id,
        }));
      });
    }
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
    let reaped: Awaited<ReturnType<typeof reapStalledHuntRuns>> = [];
    let workflowRequirements:
      | ReturnType<typeof normalizeAutoHuntWorkflow>["requirements"]
      | undefined;
    // The client requests this on a five-minute cadence. Claims and dashboard
    // reads remain independent reaper touchpoints for timely recovery.
    if (input.refreshMaintenance === true) {
      const [nextReaped, projectSettings] = await Promise.all([
        reapStalledHuntRuns(db, binding.project_id, observedAt),
        getProjectSettings(db, binding.project_id),
      ]);
      reaped = nextReaped;
      const projectWorkflow = projectSettings?.workflow_json
        ? normalizeAutoHuntWorkflow(JSON.parse(projectSettings.workflow_json))
        : null;
      workflowRequirements = projectWorkflow?.requirements ?? [];
    }
    return json({
      worker: workerJson(worker, observedAt),
      reaped,
      ...(workflowRequirements === undefined ? {} : { workflowRequirements }),
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

  return undefined;
}
