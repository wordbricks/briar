import { compareSemanticVersions, isSemanticVersion } from "../../src/lib/semantic-version";
import { managedComputerConfig } from "./managed-computer-model";
import { reconcileDrainingManagedComputer } from "./managed-computer-reconciliation";
import {
  beginManagedComputerRetirement,
  listOrganizationManagedComputers,
  managedComputerByDeviceId,
  managedComputerById,
  organizationManagedComputer,
  recordManagedComputerAuditEvent,
  refreshManagedComputerReadiness,
} from "./managed-computer-repository";
import {
  applyForPromotionalManagedComputer,
  issueManagedComputerSetupSession,
  managedComputerProductResponse,
  managedComputerSetupStatus,
  retryManagedComputerProvisioning,
  validateManagedComputerPromotion,
} from "./managed-computer-service";
import {
  assertManagedComputerRemoteRequestOrigin,
  createManagedComputerRemoteSessionTicket,
  endManagedComputerRemoteSessionAndDisconnect,
  endManagedComputerRemoteSessionsAndDisconnect,
  recordManagedComputerRemoteRejection,
} from "./managed-computer-remote-service";
import {
  managedComputerSetupAgentStatus,
  managedComputerSetupClientSocket,
} from "./managed-computer-setup-relay-service";
import { hasOrganizationCapability } from "./organization-access";
import { getOrganizationRole } from "./organization-repository";
import { getProject } from "./project-command-repository";
import { readLatestVersion } from "./releases";
import { sha256 } from "./crypto-digest";
import {
  recoverMissingWorkerHardDelete,
} from "./worker-lifecycle-repository";
import type { WorkerRuntimeMetadata } from "./worker-runtime-mappers";
import {
  deleteExecutionWorker,
  bindExecutionWorkerProject,
  executionWorkerDeviceForBinding,
  listOrganizationExecutionWorkers,
  registerExecutionWorker,
  requestExecutionWorkerUpdate,
  unbindExecutionWorker,
  updateExecutionWorkerConcurrency,
  updateExecutionWorkerIcon,
} from "./workers";

export type FleetApplicationErrorReason =
  | "development_management_required"
  | "latest_release_unavailable"
  | "managed_computer_not_found"
  | "managed_computer_remote_forbidden"
  | "managed_computer_setup_forbidden"
  | "managed_computer_retire_unavailable"
  | "organization_not_found"
  | "project_not_found"
  | "remote_session_not_found"
  | "worker_disabled"
  | "worker_not_found"
  | "worker_request_id_mismatch"
  | "worker_update_unsupported";

export class FleetApplicationError extends Error {
  constructor(
    readonly reason: FleetApplicationErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "FleetApplicationError";
  }
}

const applicationError = (
  reason: FleetApplicationErrorReason,
  message: string,
): never => {
  throw new FleetApplicationError(reason, message);
};

const projectManagement = async (input: {
  db: D1Database;
  projectId: string;
  userId: string;
}) => {
  const project = await getProject(input.db, input.projectId, input.userId);
  if (!project) return applicationError("project_not_found", "Project not found");
  requireDevelopmentManagement(project.member_role);
  return project;
};

export async function registerProjectExecutionWorkerApplication(input: {
  db: D1Database;
  projectId: string;
  userId: string;
  label: string;
  deviceIdentity: string;
  runtime: WorkerRuntimeMetadata;
  maxConcurrentSessions?: number;
  observedAt: string;
}) {
  const project = await projectManagement(input);
  const workerToken =
    `briar_worker_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const registration = await registerExecutionWorker(input.db, input.projectId, {
    id: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    organizationId: project.organization_id,
    ownerUserId: input.userId,
    label: input.label,
    deviceIdentityHash: await sha256(input.deviceIdentity),
    credentialTokenHash: await sha256(workerToken),
    agentProvider: input.runtime.agentProvider,
    providers: input.runtime.providers,
    providerHealth: input.runtime.providerHealth,
    providerCapabilities: input.runtime.providerCapabilities,
    capabilities: input.runtime.capabilities,
    maxConcurrentSessions: input.maxConcurrentSessions,
    versions: input.runtime.versions,
    observedAt: input.observedAt,
  });
  return {
    ...registration,
    organizationId: project.organization_id,
    workerToken,
  };
}

export async function bindProjectExecutionWorkerApplication(input: {
  db: D1Database;
  projectId: string;
  userId: string;
  deviceIdentity: string;
  runtime: WorkerRuntimeMetadata;
  observedAt: string;
}) {
  const project = await projectManagement(input);
  const binding = await bindExecutionWorkerProject(input.db, input.projectId, {
    id: crypto.randomUUID(),
    organizationId: project.organization_id,
    ownerUserId: input.userId,
    deviceIdentityHash: await sha256(input.deviceIdentity),
    agentProvider: input.runtime.agentProvider,
    providers: input.runtime.providers,
    providerHealth: input.runtime.providerHealth,
    providerCapabilities: input.runtime.providerCapabilities,
    capabilities: input.runtime.capabilities,
    versions: input.runtime.versions,
    observedAt: input.observedAt,
  });
  return { ...binding, organizationId: project.organization_id };
}

export async function unbindProjectExecutionWorkerApplication(input: {
  db: D1Database;
  env: Env;
  projectId: string;
  workerId: string;
  userId: string;
  requestId: string;
  reason: "explicit_user_unlink" | "managed_deprovision";
  observedAt: string;
}) {
  if (input.requestId !== `worker-unlink:${input.projectId}:${input.workerId}`) {
    return applicationError(
      "worker_request_id_mismatch",
      "requestId must match the Worker lifecycle target",
    );
  }
  const project = await projectManagement(input);
  const device = await executionWorkerDeviceForBinding(input.db, input.workerId);
  if (!device || device.organization_id !== project.organization_id) {
    const recovered = await recoverMissingWorkerHardDelete(input.db, {
      requestId: input.requestId,
      organizationId: project.organization_id,
      projectId: input.projectId,
      workerId: input.workerId,
      operation: "binding_delete",
      observedAt: input.observedAt,
    });
    if (recovered) return { alreadyUnbound: true };
    return applicationError("worker_not_found", "Worker not found");
  }
  const managedComputer = await managedComputerByDeviceId(input.db, device.id);
  const remainingBindings = await input.db.prepare(
    `select count(*) binding_count from briar_execution_workers
     where device_id = ?`,
  ).bind(device.id).first<{ binding_count: number }>();
  const unbound = await unbindExecutionWorker(
    input.db,
    device.id,
    input.projectId,
    input.observedAt,
    {
      requestId: input.requestId,
      organizationId: project.organization_id,
      workerId: input.workerId,
      reason: input.reason,
    },
  );
  if (managedComputer && (remainingBindings?.binding_count ?? 0) <= 1) {
    await endManagedComputerRemoteSessionsAndDisconnect(input.db, input.env, {
      managedComputerId: managedComputer.id,
      reason: "worker_credential_revoked",
      observedAt: input.observedAt,
    });
  }
  return { alreadyUnbound: !unbound };
}

const organizationRole = async (
  db: D1Database,
  organizationId: string,
  userId: string,
) => {
  const role = await getOrganizationRole(db, organizationId, userId);
  if (!hasOrganizationCapability(role, "organization:read")) {
    applicationError("organization_not_found", "Organization not found");
  }
  return role;
};

const requireDevelopmentManagement = (
  role: Awaited<ReturnType<typeof getOrganizationRole>>,
) => {
  if (!hasOrganizationCapability(role, "development:manage")) {
    applicationError(
      "development_management_required",
      "Development management permission required",
    );
  }
};

export async function listExecutionWorkersApplication(input: {
  db: D1Database;
  releases: Pick<R2Bucket, "get">;
  organizationId: string;
  userId: string;
  observedAt: string;
}) {
  const role = await organizationRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  return {
    workers: await listOrganizationExecutionWorkers(
      input.db,
      input.organizationId,
      input.observedAt,
    ),
    latestVersion: await readLatestVersion(input.releases),
    canManage: hasOrganizationCapability(role, "development:manage"),
    generatedAt: input.observedAt,
  };
}

export async function requestExecutionWorkerUpdateApplication(input: {
  db: D1Database;
  releases: Pick<R2Bucket, "get">;
  organizationId: string;
  deviceId: string;
  userId: string;
  observedAt: string;
}) {
  const role = await organizationRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  const device = (
    await listOrganizationExecutionWorkers(
      input.db,
      input.organizationId,
      input.observedAt,
    )
  ).find((candidate) => candidate.deviceId === input.deviceId);
  if (!device) return applicationError("worker_not_found", "Worker not found");
  requireDevelopmentManagement(role);
  if (!device.remoteUpdateSupported) {
    return applicationError(
      "worker_update_unsupported",
      "Worker does not support remote updates",
    );
  }
  const targetVersion = await readLatestVersion(input.releases);
  if (!targetVersion) {
    return applicationError(
      "latest_release_unavailable",
      "Latest release is unavailable",
    );
  }
  const currentVersion = device.versions.briar;
  if (
    currentVersion && isSemanticVersion(currentVersion) &&
    compareSemanticVersions(currentVersion, targetVersion) >= 0
  ) {
    return {
      outcome: "already_current" as const,
      requestId: null,
      targetVersion,
    };
  }
  const updateRequest = await requestExecutionWorkerUpdate(input.db, {
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    deviceId: input.deviceId,
    requestedByUserId: input.userId,
    targetVersion,
    requestedAt: input.observedAt,
  });
  return {
    outcome: "requested" as const,
    requestId: updateRequest.id,
    targetVersion: updateRequest.targetVersion,
  };
}

export async function updateExecutionWorkerApplication(input: {
  db: D1Database;
  organizationId: string;
  deviceId: string;
  userId: string;
  update: {
    maxConcurrentSessions?: number;
    icon?:
      | { type: "emoji" | "image"; value: string }
      | null;
  };
  observedAt: string;
}) {
  const role = await organizationRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  const device = await input.db
    .prepare(
      `select id
       from briar_execution_worker_devices
       where id = ? and organization_id = ?`,
    )
    .bind(input.deviceId, input.organizationId)
    .first<{ id: string }>();
  if (!device) return applicationError("worker_not_found", "Worker not found");
  requireDevelopmentManagement(role);
  let updated = input.update.maxConcurrentSessions === undefined
    ? null
    : await updateExecutionWorkerConcurrency(
      input.db,
      device.id,
      input.update.maxConcurrentSessions,
      input.observedAt,
    );
  if (input.update.icon !== undefined) {
    updated = await updateExecutionWorkerIcon(
      input.db,
      device.id,
      input.update.icon,
      input.observedAt,
    );
  }
  if (!updated) return applicationError("worker_disabled", "Worker is disabled");
  return updated;
}

export async function deleteExecutionWorkerApplication(input: {
  db: D1Database;
  env: Env;
  organizationId: string;
  deviceId: string;
  userId: string;
  requestId: string;
  observedAt: string;
}) {
  const expectedRequestId = `worker-deprovision:${input.deviceId}`;
  if (input.requestId !== expectedRequestId) {
    applicationError(
      "worker_request_id_mismatch",
      "requestId must match the Worker lifecycle target",
    );
  }
  const role = await organizationRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  const device = await input.db
    .prepare(
      `select id
       from briar_execution_worker_devices
       where id = ? and organization_id = ?`,
    )
    .bind(input.deviceId, input.organizationId)
    .first<{ id: string }>();
  if (!device) {
    const recovered = await recoverMissingWorkerHardDelete(input.db, {
      requestId: input.requestId,
      organizationId: input.organizationId,
      projectId: null,
      deviceId: input.deviceId,
      workerId: null,
      operation: "device_delete",
      observedAt: input.observedAt,
    });
    if (recovered) return { deleted: true };
    return applicationError("worker_not_found", "Worker not found");
  }
  requireDevelopmentManagement(role);
  const managedComputer = await managedComputerByDeviceId(input.db, device.id);
  let deleted: boolean;
  try {
    deleted = await deleteExecutionWorker(
      input.db,
      device.id,
      input.observedAt,
      {
        requestId: input.requestId,
        organizationId: input.organizationId,
        projectId: null,
        workerId: null,
        reason: managedComputer
          ? "managed_deprovision"
          : "explicit_user_deprovision",
      },
    );
  } catch (error) {
    if (managedComputer) {
      await endManagedComputerRemoteSessionsAndDisconnect(input.db, input.env, {
        managedComputerId: managedComputer.id,
        reason: "worker_credential_revoked",
        observedAt: input.observedAt,
      });
    }
    throw error;
  }
  if (managedComputer) {
    await endManagedComputerRemoteSessionsAndDisconnect(input.db, input.env, {
      managedComputerId: managedComputer.id,
      reason: "worker_credential_revoked",
      observedAt: input.observedAt,
    });
  }
  if (!deleted) applicationError("worker_not_found", "Worker not found");
  return { deleted: true };
}

export async function getManagedComputerProductApplication(input: {
  db: D1Database;
  env: Env;
  organizationId: string;
  userId: string;
}) {
  const role = await organizationRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  return {
    ...managedComputerProductResponse(input.env),
    canApply: hasOrganizationCapability(role, "development:manage"),
  };
}

export async function listManagedComputersApplication(input: {
  db: D1Database;
  organizationId: string;
  userId: string;
  observedAt: string;
}) {
  await organizationRole(input.db, input.organizationId, input.userId);
  const computers = await listOrganizationManagedComputers(
    input.db,
    input.organizationId,
  );
  const refreshed = await Promise.all(computers.map((computer) =>
    computer.state === "needs_setup"
      ? refreshManagedComputerReadiness(
        input.db,
        computer.id,
        input.observedAt,
      )
      : Promise.resolve(computer)
  ));
  return {
    computers: refreshed.flatMap((computer) => computer ? [computer] : []),
    generatedAt: input.observedAt,
  };
}

export async function getManagedComputerApplication(input: {
  db: D1Database;
  organizationId: string;
  managedComputerId: string;
  userId: string;
  observedAt: string;
}) {
  await organizationRole(input.db, input.organizationId, input.userId);
  let computer = await organizationManagedComputer(
    input.db,
    input.organizationId,
    input.managedComputerId,
  );
  if (!computer) {
    return applicationError(
      "managed_computer_not_found",
      "Managed computer not found",
    );
  }
  if (computer.state === "needs_setup") {
    computer = await refreshManagedComputerReadiness(
      input.db,
      computer.id,
      input.observedAt,
    );
  }
  if (!computer) {
    return applicationError(
      "managed_computer_not_found",
      "Managed computer not found",
    );
  }
  return computer;
}

export async function validateManagedComputerPromotionApplication(input: {
  db: D1Database;
  env: Env;
  organizationId: string;
  userId: string;
  code: string;
  observedAt: string;
}) {
  const role = await organizationRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  requireDevelopmentManagement(role);
  return validateManagedComputerPromotion(input.db, input.env, input);
}

export async function applyForManagedComputerApplication(input: {
  db: D1Database;
  env: Env;
  organizationId: string;
  userId: string;
  code: string;
  requestId: string;
  observedAt: string;
}) {
  const role = await organizationRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  requireDevelopmentManagement(role);
  return applyForPromotionalManagedComputer(input.db, input.env, input);
}

export async function retryManagedComputerApplication(input: {
  db: D1Database;
  env: Env;
  organizationId: string;
  managedComputerId: string;
  userId: string;
  requestId: string;
  observedAt: string;
}) {
  const role = await organizationRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  requireDevelopmentManagement(role);
  const result = await retryManagedComputerProvisioning(input.db, input.env, input);
  const computer = await organizationManagedComputer(
    input.db,
    input.organizationId,
    input.managedComputerId,
  );
  if (!computer) {
    return applicationError(
      "managed_computer_not_found",
      "Managed computer not found",
    );
  }
  return { computer, duplicate: !result.created };
}

export async function retireManagedComputerApplication(input: {
  db: D1Database;
  env: Env;
  organizationId: string;
  managedComputerId: string;
  userId: string;
  observedAt: string;
}) {
  const role = await organizationRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  requireDevelopmentManagement(role);
  const existing = await organizationManagedComputer(
    input.db,
    input.organizationId,
    input.managedComputerId,
  );
  if (!existing) {
    return applicationError(
      "managed_computer_not_found",
      "Managed computer not found",
    );
  }
  if (["requested", "provisioning", "bootstrapping"].includes(existing.state)) {
    return applicationError(
      "managed_computer_retire_unavailable",
      "Managed computer preparation must finish before retirement",
    );
  }
  const transitioned = await beginManagedComputerRetirement(input.db, {
    managedComputerId: input.managedComputerId,
    organizationId: input.organizationId,
    observedAt: input.observedAt,
  });
  const computer = transitioned ?? await organizationManagedComputer(
    input.db,
    input.organizationId,
    input.managedComputerId,
  );
  if (!computer) {
    return applicationError(
      "managed_computer_not_found",
      "Managed computer not found",
    );
  }
  if (!["draining", "stopped", "terminated"].includes(computer.state)) {
    return applicationError(
      "managed_computer_retire_unavailable",
      "Managed computer cannot be retired from its current state",
    );
  }
  if (transitioned) {
    await recordManagedComputerAuditEvent(input.db, {
      organizationId: input.organizationId,
      managedComputerId: input.managedComputerId,
      actorUserId: input.userId,
      action: "draining_started",
      detail: { reason: "user_retired" },
      occurredAt: input.observedAt,
    });
  }
  await endManagedComputerRemoteSessionsAndDisconnect(input.db, input.env, {
    managedComputerId: input.managedComputerId,
    reason: "computer_retired",
    observedAt: input.observedAt,
  });
  const reconciliation = computer.state === "draining"
    ? reconcileDrainingManagedComputer(
      input.db,
      input.env,
      input.managedComputerId,
      input.observedAt,
    ).then(() => undefined).catch((error) => {
      console.error(JSON.stringify({
        message: "Managed computer immediate stop failed",
        managedComputerId: input.managedComputerId,
        observedAt: input.observedAt,
        error: error instanceof Error ? error.message : String(error),
      }));
    })
    : null;
  return { computer, duplicate: !transitioned, reconciliation };
}

const managedComputerControlAccess = async (input: {
  db: D1Database;
  organizationId: string;
  managedComputerId: string;
  userId: string;
  kind: "remote" | "setup";
  observedAt: string;
}) => {
  const role = await getOrganizationRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  const computer = await organizationManagedComputer(
    input.db,
    input.organizationId,
    input.managedComputerId,
  );
  if (computer && hasOrganizationCapability(role, "development:manage")) {
    return computer;
  }
  if (input.kind === "remote") {
    const attemptedComputer = computer ?? await managedComputerById(
      input.db,
      input.managedComputerId,
    );
    if (attemptedComputer) {
      await recordManagedComputerRemoteRejection(input.db, {
        organizationId: attemptedComputer.organization_id,
        managedComputerId: attemptedComputer.id,
        actorUserId: input.userId,
        reasonCode: computer ? "permission_denied" : "organization_mismatch",
        observedAt: input.observedAt,
      });
    }
    return applicationError(
      "managed_computer_remote_forbidden",
      "Managed computer remote access required",
    );
  }
  return applicationError(
    "managed_computer_setup_forbidden",
    "Managed computer setup access required",
  );
};

export async function createManagedComputerRemoteSessionApplication(input: {
  db: D1Database;
  env: Env;
  organizationId: string;
  managedComputerId: string;
  userId: string;
  requestId: string;
  reconnectSessionId?: string;
  requestUrl: string;
  origin: string | null;
  secFetchSite: string | null;
  observedAt: string;
}) {
  const computer = await managedComputerControlAccess({ ...input, kind: "remote" });
  try {
    assertManagedComputerRemoteRequestOrigin(
      { origin: input.origin, secFetchSite: input.secFetchSite },
      managedComputerConfig(input.env),
      { required: true },
    );
  } catch (error) {
    await recordManagedComputerRemoteRejection(input.db, {
      organizationId: computer.organization_id,
      managedComputerId: computer.id,
      actorUserId: input.userId,
      reasonCode: "origin_rejected",
      observedAt: input.observedAt,
    });
    throw error;
  }
  return createManagedComputerRemoteSessionTicket(input.db, input.env, {
    requestUrl: input.requestUrl,
    organizationId: input.organizationId,
    managedComputerId: input.managedComputerId,
    controllerUserId: input.userId,
    requestId: input.requestId,
    reconnectSessionId: input.reconnectSessionId,
    observedAt: input.observedAt,
  });
}

export async function endManagedComputerRemoteSessionApplication(input: {
  db: D1Database;
  env: Env;
  organizationId: string;
  managedComputerId: string;
  remoteSessionId: string;
  userId: string;
  origin: string | null;
  secFetchSite: string | null;
  observedAt: string;
}) {
  const computer = await managedComputerControlAccess({ ...input, kind: "remote" });
  try {
    assertManagedComputerRemoteRequestOrigin(
      { origin: input.origin, secFetchSite: input.secFetchSite },
      managedComputerConfig(input.env),
      { required: true },
    );
  } catch (error) {
    await recordManagedComputerRemoteRejection(input.db, {
      organizationId: computer.organization_id,
      managedComputerId: computer.id,
      actorUserId: input.userId,
      reasonCode: "origin_rejected",
      observedAt: input.observedAt,
    });
    throw error;
  }
  const ended = await endManagedComputerRemoteSessionAndDisconnect(
    input.db,
    input.env,
    {
      sessionId: input.remoteSessionId,
      organizationId: input.organizationId,
      managedComputerId: input.managedComputerId,
      actorUserId: input.userId,
      reason: "user_ended",
      observedAt: input.observedAt,
    },
  );
  if (!ended) {
    applicationError(
      "remote_session_not_found",
      "Remote desktop session not found",
    );
  }
  return { ended: true };
}

export async function createManagedComputerSetupSessionApplication(input: {
  db: D1Database;
  env: Env;
  organizationId: string;
  managedComputerId: string;
  projectId: string;
  requestId: string;
  userId: string;
  requestUrl: string;
  observedAt: string;
}) {
  await managedComputerControlAccess({ ...input, kind: "setup" });
  const result = await issueManagedComputerSetupSession(input.db, input.env, {
    organizationId: input.organizationId,
    managedComputerId: input.managedComputerId,
    projectId: input.projectId,
    userId: input.userId,
    requestId: input.requestId,
    observedAt: input.observedAt,
  });
  return {
    ...result,
    socket: managedComputerSetupClientSocket(input.requestUrl, {
      managedComputerId: input.managedComputerId,
      sessionId: result.session.id,
      setupToken: result.setupToken,
    }),
    agentConnected: await managedComputerSetupAgentStatus(
      input.env,
      input.managedComputerId,
    ),
  };
}

export async function getManagedComputerSetupStatusApplication(input: {
  db: D1Database;
  organizationId: string;
  managedComputerId: string;
  userId: string;
  observedAt: string;
}) {
  await managedComputerControlAccess({ ...input, kind: "setup" });
  return managedComputerSetupStatus(
    input.db,
    input.managedComputerId,
    input.observedAt,
  );
}
