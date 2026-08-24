import {
  awsAccountId,
  managedInstanceIsSsmOnline,
  verifyManagedInstance,
} from "./aws-managed-computer";
import {
  managedComputerCredential,
  managedComputerEnrollmentNonce,
  managedComputerSetupToken,
  promotionCodesEqual,
  sha256Hex,
  verifyEc2IdentityDocumentSignature,
} from "./managed-computer-crypto";
import {
  managedComputerConfig,
  managedComputerConfigurationIssues,
  managedComputerInfrastructureIssues,
  managedComputerProduct,
  managedComputerProvisioningConfigured,
  type ManagedComputerConfig,
} from "./managed-computer-model";
import {
  bindManagedComputerSetupSession,
  createManagedComputerSetupSessionRecord,
  createManagedComputerRetry,
  createPromotionalManagedComputer,
  enrollManagedComputerDevice,
  latestManagedComputerSetupSession,
  managedComputerApplicationByRequest,
  managedComputerById,
  managedComputerCapacity,
  managedComputerProvisioningJob,
  managedComputerSetupSessionByRequest,
  managedComputerSetupSessionByTokenHash,
  managedComputerSetupWorker,
  recordManagedComputerAuditEvent,
} from "./managed-computer-repository";
import { decodeInstanceIdentityDocument } from "./managed-computer-request-contract";
import type { AgentProviderCapabilityCatalog } from "../../src/lib/agent-provider-contract";
import type { AgentProvider } from "../../src/lib/agent-provider";
import type { ProviderHealthMap } from "./workers";
import { workerJson } from "./worker-json";

export class ManagedComputerServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ManagedComputerServiceError";
  }
}

function requiredConfiguration(config: ManagedComputerConfig) {
  const issues = managedComputerInfrastructureIssues(config);
  if (issues.length > 0) {
    throw new ManagedComputerServiceError(
      503,
      "MANAGED_COMPUTER_NOT_CONFIGURED",
      `Managed computer provisioning is not configured (${issues.join(", ")})`,
    );
  }
}

function requireApplicationsEnabled(config: ManagedComputerConfig) {
  const issues = managedComputerConfigurationIssues(config);
  if (issues.length > 0) {
    throw new ManagedComputerServiceError(
      503,
      "MANAGED_COMPUTER_NOT_CONFIGURED",
      `Managed computer applications are not configured (${issues.join(", ")})`,
    );
  }
  if (!config.applicationsEnabled) {
    throw new ManagedComputerServiceError(
      503,
      "MANAGED_COMPUTER_APPLICATIONS_DISABLED",
      "New managed computer applications are temporarily unavailable",
    );
  }
}

function capacityError(capacity: Awaited<ReturnType<typeof managedComputerCapacity>>) {
  if (capacity.userRedeemed) {
    return new ManagedComputerServiceError(
      409,
      "MANAGED_COMPUTER_USER_LIMIT",
      "This promotion has already been used by this user",
    );
  }
  if (capacity.organizationRedeemed) {
    return new ManagedComputerServiceError(
      409,
      "MANAGED_COMPUTER_ORGANIZATION_LIMIT",
      "This organization already has a pilot managed computer",
    );
  }
  return new ManagedComputerServiceError(
    409,
    "MANAGED_COMPUTER_FLEET_LIMIT",
    "The managed computer pilot fleet is currently full",
  );
}

async function validatePromotionCode(
  config: ManagedComputerConfig,
  code: string,
) {
  return Boolean(
    config.promotionCode &&
      await promotionCodesEqual(code, config.promotionCode),
  );
}

async function ensureProvisioningWorkflow(
  env: Env,
  input: {
    managedComputerId: string;
    provisioningJobId: string;
    workflowInstanceId: string;
    previousInstanceId?: string | null;
    previousInstanceRegion?: string | null;
  },
) {
  try {
    await env.MANAGED_COMPUTER_PROVISIONING.create({
      id: input.workflowInstanceId,
      params: {
        managedComputerId: input.managedComputerId,
        provisioningJobId: input.provisioningJobId,
        previousInstanceId: input.previousInstanceId ?? null,
        previousInstanceRegion: input.previousInstanceRegion ?? null,
      },
      retention: { successRetention: "30 days", errorRetention: "30 days" },
    });
  } catch (error) {
    const existing = await env.MANAGED_COMPUTER_PROVISIONING.get(
      input.workflowInstanceId,
    ).catch(() => null);
    if (!existing) throw error;
  }
}

export function managedComputerProductResponse(env: Env) {
  const config = managedComputerConfig(env);
  return {
    ...managedComputerProduct(config),
    configurationReady: managedComputerProvisioningConfigured(config),
  };
}

export async function validateManagedComputerPromotion(
  db: D1Database,
  env: Env,
  input: {
    organizationId: string;
    userId: string;
    code: string;
    observedAt: string;
  },
) {
  const config = managedComputerConfig(env);
  const valid = await validatePromotionCode(config, input.code);
  const capacity = await managedComputerCapacity(db, {
    organizationId: input.organizationId,
    userId: input.userId,
    campaignId: config.campaignId,
    organizationLimit: config.organizationLimit,
    fleetLimit: config.fleetLimit,
  });
  if (valid) {
    await recordManagedComputerAuditEvent(db, {
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "promotion_validated",
      detail: { campaignId: config.campaignId, eligible: capacity.eligible },
      occurredAt: input.observedAt,
    });
  }
  return {
    valid,
    eligible: valid &&
      config.applicationsEnabled &&
      managedComputerProvisioningConfigured(config) &&
      capacity.eligible,
    totalCents: valid ? 0 : 10_000,
    currency: "USD" as const,
    applicationsEnabled:
      config.applicationsEnabled && managedComputerProvisioningConfigured(config),
    limitReason: !valid || capacity.eligible
      ? null
      : capacity.userRedeemed
        ? "user"
        : capacity.organizationRedeemed ||
            capacity.organizationCount >= config.organizationLimit
          ? "organization"
          : "fleet",
  };
}

export async function applyForPromotionalManagedComputer(
  db: D1Database,
  env: Env,
  input: {
    organizationId: string;
    userId: string;
    code: string;
    requestId: string;
    observedAt: string;
  },
) {
  const existing = await managedComputerApplicationByRequest(
    db,
    input.organizationId,
    input.requestId,
  );
  if (existing) {
    if (existing.requester_user_id !== input.userId) {
      throw new ManagedComputerServiceError(
        409,
        "MANAGED_COMPUTER_REQUEST_CONFLICT",
        "This request ID belongs to another applicant",
      );
    }
    const job = await managedComputerProvisioningJob(
      db,
      existing.provisioning_job_id,
    );
    if (job?.status === "requested") {
      await ensureProvisioningWorkflow(env, {
        managedComputerId: existing.id,
        provisioningJobId: job.id,
        workflowInstanceId: job.workflow_instance_id,
      });
    }
    return { computer: existing, duplicate: true };
  }
  const config = managedComputerConfig(env);
  requireApplicationsEnabled(config);
  if (!await validatePromotionCode(config, input.code)) {
    throw new ManagedComputerServiceError(
      400,
      "MANAGED_COMPUTER_PROMOTION_INVALID",
      "Promotion code is invalid",
    );
  }
  const capacity = await managedComputerCapacity(db, {
    organizationId: input.organizationId,
    userId: input.userId,
    campaignId: config.campaignId,
    organizationLimit: config.organizationLimit,
    fleetLimit: config.fleetLimit,
  });
  if (!capacity.eligible) throw capacityError(capacity);
  const managedComputerId = crypto.randomUUID();
  const provisioningJobId = crypto.randomUUID();
  const entitlementId = crypto.randomUUID();
  const workflowInstanceId = `managed-computer-${managedComputerId}`;
  const nonce = await managedComputerEnrollmentNonce(
    config.enrollmentSecret ?? "",
    managedComputerId,
    provisioningJobId,
  );
  const observedTime = Date.parse(input.observedAt);
  const computer = await createPromotionalManagedComputer(db, {
    entitlementId,
    managedComputerId,
    provisioningJobId,
    workflowInstanceId,
    organizationId: input.organizationId,
    userId: input.userId,
    campaignId: config.campaignId,
    requestId: input.requestId,
    organizationLimit: config.organizationLimit,
    fleetLimit: config.fleetLimit,
    region: config.region ?? "",
    instanceType: config.instanceType,
    launchTemplateId: config.launchTemplateId ?? "",
    launchTemplateVersion: config.launchTemplateVersion ?? "",
    bootstrapApiOrigin: config.apiOrigin ?? "",
    enrollmentNonceHash: await sha256Hex(nonce),
    enrollmentExpiresAt: new Date(
      observedTime + config.enrollmentTtlMinutes * 60_000,
    ).toISOString(),
    expiresAt: new Date(
      observedTime + config.lifetimeDays * 24 * 60 * 60_000,
    ).toISOString(),
    observedAt: input.observedAt,
  });
  if (!computer) {
    const raced = await managedComputerApplicationByRequest(
      db,
      input.organizationId,
      input.requestId,
    );
    if (raced?.requester_user_id === input.userId) {
      return { computer: raced, duplicate: true };
    }
    throw capacityError(await managedComputerCapacity(db, {
      organizationId: input.organizationId,
      userId: input.userId,
      campaignId: config.campaignId,
      organizationLimit: config.organizationLimit,
      fleetLimit: config.fleetLimit,
    }));
  }
  await ensureProvisioningWorkflow(env, {
    managedComputerId,
    provisioningJobId,
    workflowInstanceId,
  });
  return { computer, duplicate: false };
}

export async function retryManagedComputerProvisioning(
  db: D1Database,
  env: Env,
  input: {
    managedComputerId: string;
    organizationId: string;
    userId: string;
    requestId: string;
    observedAt: string;
  },
) {
  const config = managedComputerConfig(env);
  requiredConfiguration(config);
  const provisioningJobId = crypto.randomUUID();
  const workflowInstanceId =
    `managed-computer-${input.managedComputerId}-${input.requestId}`;
  const nonce = await managedComputerEnrollmentNonce(
    config.enrollmentSecret ?? "",
    input.managedComputerId,
    provisioningJobId,
  );
  const result = await createManagedComputerRetry(db, {
    ...input,
    actorUserId: input.userId,
    provisioningJobId,
    workflowInstanceId,
    enrollmentNonceHash: await sha256Hex(nonce),
    enrollmentExpiresAt: new Date(
      Date.parse(input.observedAt) + config.enrollmentTtlMinutes * 60_000,
    ).toISOString(),
    region: config.region ?? "",
    instanceType: config.instanceType,
    launchTemplateId: config.launchTemplateId ?? "",
    launchTemplateVersion: config.launchTemplateVersion ?? "",
    bootstrapApiOrigin: config.apiOrigin ?? "",
  });
  if (!result) {
    throw new ManagedComputerServiceError(
      409,
      "MANAGED_COMPUTER_RETRY_UNAVAILABLE",
      "Managed computer provisioning cannot be retried",
    );
  }
  await ensureProvisioningWorkflow(env, {
    managedComputerId: input.managedComputerId,
    provisioningJobId: result.job.id,
    workflowInstanceId: result.job.workflow_instance_id,
    previousInstanceId: result.created ? result.previousInstanceId : null,
    previousInstanceRegion: result.created
      ? result.previousInstanceRegion
      : null,
  });
  return result;
}

export async function enrollManagedComputer(
  db: D1Database,
  env: Env,
  input: {
    managedComputerId: string;
    nonce: string;
    identityDocument: string;
    identitySignature: string;
    briarVersion: string;
    observedAt: string;
  },
) {
  const config = managedComputerConfig(env);
  requiredConfiguration(config);
  if (!await verifyEc2IdentityDocumentSignature(
    config.awsIdentityPublicKey ?? "",
    input.identityDocument,
    input.identitySignature,
  )) {
    throw new ManagedComputerServiceError(
      403,
      "MANAGED_COMPUTER_IDENTITY_SIGNATURE_INVALID",
      "EC2 instance identity signature is invalid",
    );
  }
  let identityDocument: ReturnType<typeof decodeInstanceIdentityDocument>;
  try {
    identityDocument = decodeInstanceIdentityDocument(
      JSON.parse(input.identityDocument) as unknown,
    );
  } catch {
    throw new ManagedComputerServiceError(
      400,
      "MANAGED_COMPUTER_IDENTITY_DOCUMENT_INVALID",
      "EC2 instance identity document is malformed",
    );
  }
  const computer = await managedComputerById(db, input.managedComputerId);
  if (!computer) {
    throw new ManagedComputerServiceError(
      404,
      "MANAGED_COMPUTER_NOT_FOUND",
      "Managed computer enrollment was not found",
    );
  }
  const nonceHash = await sha256Hex(input.nonce);
  const pendingTime = Date.parse(identityDocument.pendingTime);
  if (
    computer.enrollment_nonce_hash !== nonceHash ||
    computer.enrollment_expires_at <= input.observedAt ||
    identityDocument.instanceId !== computer.aws_instance_id ||
    identityDocument.instanceType !== computer.aws_instance_type ||
    identityDocument.region !== computer.aws_region ||
    !Number.isFinite(pendingTime) ||
    pendingTime < Date.parse(computer.created_at) - 5 * 60_000 ||
    pendingTime > Date.parse(input.observedAt) + 5 * 60_000
  ) {
    throw new ManagedComputerServiceError(
      403,
      "MANAGED_COMPUTER_ENROLLMENT_INVALID",
      "Managed computer enrollment proof is invalid or expired",
    );
  }
  const accountId = await awsAccountId(config);
  if (accountId !== identityDocument.accountId) {
    throw new ManagedComputerServiceError(
      403,
      "MANAGED_COMPUTER_IDENTITY_INVALID",
      "EC2 account identity does not match the managed fleet",
    );
  }
  await verifyManagedInstance(config, {
    managedComputerId: computer.id,
    organizationId: computer.organization_id,
    campaignId: config.campaignId,
    instanceId: identityDocument.instanceId,
    region: computer.aws_region,
    launchTemplateId: computer.aws_launch_template_id,
    launchTemplateVersion: computer.aws_launch_template_version,
    instanceType: computer.aws_instance_type,
  });
  if (!await managedInstanceIsSsmOnline(
    config,
    computer.aws_region,
    identityDocument.instanceId,
  )) {
    throw new ManagedComputerServiceError(
      409,
      "MANAGED_COMPUTER_SSM_NOT_READY",
      "Managed computer is not yet verified by Systems Manager",
    );
  }
  const normalizedSignature = input.identitySignature.replace(/\s+/gu, "");
  const signatureHash = await sha256Hex(normalizedSignature);
  const identityHash = await sha256Hex([
    accountId,
    computer.aws_region,
    identityDocument.instanceId,
    signatureHash,
  ].join(":"));
  const credential = await managedComputerCredential(
    config.enrollmentSecret ?? "",
    computer.id,
    input.nonce,
  );
  const deviceId = `managed-${computer.id}`;
  const enrolled = await enrollManagedComputerDevice(db, {
    managedComputerId: computer.id,
    nonceHash,
    identityHash,
    credentialHash: await sha256Hex(credential),
    deviceId,
    accountId,
    region: computer.aws_region,
    instanceId: identityDocument.instanceId,
    briarVersion: input.briarVersion,
    observedAt: input.observedAt,
  });
  if (!enrolled) {
    throw new ManagedComputerServiceError(
      409,
      "MANAGED_COMPUTER_ENROLLMENT_STALE",
      "Managed computer enrollment is no longer active",
    );
  }
  return { credential, deviceId, organizationId: computer.organization_id };
}

function requireSetupSecret(config: ManagedComputerConfig) {
  if (!config.enrollmentSecret) {
    throw new ManagedComputerServiceError(
      503,
      "MANAGED_COMPUTER_SETUP_NOT_CONFIGURED",
      "Managed computer setup is not configured",
    );
  }
  return config.enrollmentSecret;
}

export async function issueManagedComputerSetupSession(
  db: D1Database,
  env: Env,
  input: {
    managedComputerId: string;
    organizationId: string;
    projectId: string;
    userId: string;
    requestId: string;
    observedAt: string;
  },
) {
  const computer = await managedComputerById(db, input.managedComputerId);
  if (!computer || computer.organization_id !== input.organizationId) {
    throw new ManagedComputerServiceError(
      404,
      "MANAGED_COMPUTER_NOT_FOUND",
      "Managed computer not found",
    );
  }
  if (!computer.briar_device_id || !["needs_setup", "ready"].includes(computer.state)) {
    throw new ManagedComputerServiceError(
      409,
      "MANAGED_COMPUTER_SETUP_UNAVAILABLE",
      "Managed computer enrollment must complete before setup",
    );
  }
  const project = await db.prepare(
    `select id, organization_id from briar_projects where id = ?`,
  ).bind(input.projectId).first<{ id: string; organization_id: string }>();
  if (!project || project.organization_id !== input.organizationId) {
    throw new ManagedComputerServiceError(
      404,
      "MANAGED_COMPUTER_SETUP_PROJECT_NOT_FOUND",
      "Project not found in this organization",
    );
  }
  const config = managedComputerConfig(env);
  const token = await managedComputerSetupToken(
    requireSetupSecret(config),
    computer.id,
    input.requestId,
  );
  const tokenHash = await sha256Hex(token);
  const existing = await managedComputerSetupSessionByRequest(
    db,
    computer.id,
    input.requestId,
  );
  if (existing) {
    if (
      existing.requested_by_user_id !== input.userId ||
      existing.project_id !== input.projectId ||
      existing.token_hash !== tokenHash
    ) {
      throw new ManagedComputerServiceError(
        409,
        "MANAGED_COMPUTER_SETUP_REQUEST_CONFLICT",
        "This setup request ID is already in use",
      );
    }
    if (existing.status === "pending" && existing.expires_at <= input.observedAt) {
      throw new ManagedComputerServiceError(
        410,
        "MANAGED_COMPUTER_SETUP_EXPIRED",
        "Managed computer setup ticket expired; create a new request",
      );
    }
    return { session: existing, setupToken: token, duplicate: true };
  }
  const session = await createManagedComputerSetupSessionRecord(db, {
    id: crypto.randomUUID(),
    managedComputerId: computer.id,
    organizationId: input.organizationId,
    projectId: input.projectId,
    requestedByUserId: input.userId,
    requestId: input.requestId,
    tokenHash,
    expiresAt: new Date(
      Date.parse(input.observedAt) + config.setupTtlMinutes * 60_000,
    ).toISOString(),
    observedAt: input.observedAt,
  });
  if (!session) {
    throw new ManagedComputerServiceError(
      409,
      "MANAGED_COMPUTER_SETUP_UNAVAILABLE",
      "Managed computer setup is no longer available",
    );
  }
  if (
    session.requested_by_user_id !== input.userId ||
    session.project_id !== input.projectId ||
    session.token_hash !== tokenHash
  ) {
    throw new ManagedComputerServiceError(
      409,
      "MANAGED_COMPUTER_SETUP_REQUEST_CONFLICT",
      "This setup request ID is already in use",
    );
  }
  return { session, setupToken: token, duplicate: false };
}

export async function bindManagedComputerSetup(
  db: D1Database,
  input: {
    managedComputerId: string;
    organizationId: string;
    deviceId: string;
    setupToken: string;
    worker: {
      agentProvider: AgentProvider;
      providers?: AgentProvider[];
      providerHealth?: ProviderHealthMap;
      providerCapabilities?: AgentProviderCapabilityCatalog;
      versions: Record<string, string>;
    };
    observedAt: string;
  },
) {
  const computer = await managedComputerById(db, input.managedComputerId);
  if (
    !computer || computer.organization_id !== input.organizationId ||
    computer.briar_device_id !== input.deviceId ||
    !["needs_setup", "ready"].includes(computer.state)
  ) {
    throw new ManagedComputerServiceError(
      403,
      "MANAGED_COMPUTER_SETUP_DEVICE_FORBIDDEN",
      "Worker is not authorized for this managed computer",
    );
  }
  const tokenHash = await sha256Hex(input.setupToken);
  const session = await managedComputerSetupSessionByTokenHash(
    db,
    computer.id,
    tokenHash,
  );
  if (!session || session.organization_id !== input.organizationId) {
    throw new ManagedComputerServiceError(
      403,
      "MANAGED_COMPUTER_SETUP_TOKEN_INVALID",
      "Managed computer setup ticket is invalid",
    );
  }
  if (session.status === "pending" && session.expires_at <= input.observedAt) {
    throw new ManagedComputerServiceError(
      410,
      "MANAGED_COMPUTER_SETUP_EXPIRED",
      "Managed computer setup ticket expired",
    );
  }
  if (session.status === "consumed") {
    const worker = session.worker_id
      ? await managedComputerSetupWorker(db, session.worker_id, input.deviceId)
      : null;
    if (!worker) {
      throw new ManagedComputerServiceError(
        409,
        "MANAGED_COMPUTER_SETUP_INCOMPLETE",
        "Managed computer setup ticket was consumed without a worker binding",
      );
    }
    return { session, worker, duplicate: true };
  }
  const result = await bindManagedComputerSetupSession(db, {
    setupSessionId: session.id,
    setupTokenHash: tokenHash,
    managedComputerId: computer.id,
    organizationId: input.organizationId,
    deviceId: input.deviceId,
    ...input.worker,
    observedAt: input.observedAt,
  });
  if (!result) {
    throw new ManagedComputerServiceError(
      409,
      "MANAGED_COMPUTER_SETUP_STALE",
      "Managed computer setup ticket is no longer active",
    );
  }
  return { ...result, duplicate: false };
}

export async function managedComputerSetupStatus(
  db: D1Database,
  managedComputerId: string,
  observedAt: string,
) {
  const session = await latestManagedComputerSetupSession(db, managedComputerId);
  const worker = session?.worker_id
    ? await db.prepare(
      `select worker.*, device.max_concurrent_sessions,
              device.icon_type, device.icon_value
       from briar_execution_workers worker
       join briar_execution_worker_devices device on device.id = worker.device_id
       where worker.id = ?`,
    ).bind(session.worker_id).first<Parameters<typeof workerJson>[0]>()
    : null;
  return {
    session: session
      ? {
        id: session.id,
        projectId: session.project_id,
        status: session.status === "pending" && session.expires_at <= observedAt
          ? "expired"
          : session.status,
        expiresAt: session.expires_at,
        consumedAt: session.consumed_at,
      }
      : null,
    worker: worker ? workerJson(worker, observedAt) : null,
  };
}
