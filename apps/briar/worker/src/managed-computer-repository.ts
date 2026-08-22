import type {
  ManagedComputerProvisioningJobRow,
  ManagedComputerRow,
  ManagedComputerState,
} from "./managed-computer-model";

const activeStates: readonly ManagedComputerState[] = [
  "requested",
  "provisioning",
  "bootstrapping",
  "needs_setup",
  "ready",
  "failed",
  "draining",
  "stopped",
];

const activeStateSql = activeStates.map(() => "?").join(", ");

export async function managedComputerById(
  db: D1Database,
  managedComputerId: string,
) {
  return db.prepare(
    `select * from briar_managed_computers where id = ?`,
  ).bind(managedComputerId).first<ManagedComputerRow>();
}

export async function managedComputerByDeviceId(
  db: D1Database,
  deviceId: string,
) {
  return db.prepare(
    `select * from briar_managed_computers where briar_device_id = ?`,
  ).bind(deviceId).first<ManagedComputerRow>();
}

export async function organizationManagedComputer(
  db: D1Database,
  organizationId: string,
  managedComputerId: string,
) {
  return db.prepare(
    `select * from briar_managed_computers
     where id = ? and organization_id = ?`,
  ).bind(managedComputerId, organizationId).first<ManagedComputerRow>();
}

export async function listOrganizationManagedComputers(
  db: D1Database,
  organizationId: string,
) {
  const result = await db.prepare(
    `select * from briar_managed_computers
     where organization_id = ?
     order by created_at desc, id`,
  ).bind(organizationId).all<ManagedComputerRow>();
  return result.results ?? [];
}

export async function managedComputerApplicationByRequest(
  db: D1Database,
  organizationId: string,
  requestId: string,
) {
  return db.prepare(
    `select computer.*
     from briar_managed_computer_entitlements entitlement
     join briar_managed_computers computer
       on computer.entitlement_id = entitlement.id
     where entitlement.organization_id = ? and entitlement.request_id = ?`,
  ).bind(organizationId, requestId).first<ManagedComputerRow>();
}

export async function managedComputerCapacity(
  db: D1Database,
  input: {
    organizationId: string;
    userId: string;
    campaignId: string;
    organizationLimit: number;
    fleetLimit: number;
  },
) {
  const row = await db.prepare(
    `select
       (select count(*) from briar_managed_computers
        where organization_id = ? and state in (${activeStateSql}))
          as organization_count,
       (select count(*) from briar_managed_computers
        where state in (${activeStateSql})) as fleet_count,
       exists(
         select 1 from briar_managed_computer_promotion_redemptions
         where user_id = ? and campaign_id = ?
       ) as user_redeemed,
       exists(
         select 1 from briar_managed_computer_promotion_redemptions
         where organization_id = ? and campaign_id = ?
       ) as organization_redeemed`,
  ).bind(
    input.organizationId,
    ...activeStates,
    ...activeStates,
    input.userId,
    input.campaignId,
    input.organizationId,
    input.campaignId,
  ).first<{
    organization_count: number;
    fleet_count: number;
    user_redeemed: number;
    organization_redeemed: number;
  }>();
  const capacity = row ?? {
    organization_count: 0,
    fleet_count: 0,
    user_redeemed: 0,
    organization_redeemed: 0,
  };
  return {
    organizationCount: capacity.organization_count,
    fleetCount: capacity.fleet_count,
    userRedeemed: capacity.user_redeemed === 1,
    organizationRedeemed: capacity.organization_redeemed === 1,
    eligible:
      capacity.organization_count < input.organizationLimit &&
      capacity.fleet_count < input.fleetLimit &&
      capacity.user_redeemed === 0 &&
      capacity.organization_redeemed === 0,
  };
}

export async function recordManagedComputerAuditEvent(
  db: D1Database,
  input: {
    id?: string;
    organizationId: string;
    managedComputerId?: string | null;
    actorUserId?: string | null;
    action:
      | "promotion_validated"
      | "entitlement_approved"
      | "requested"
      | "provisioning_started"
      | "instance_created"
      | "bootstrapping_started"
      | "enrolled"
      | "ready"
      | "provisioning_failed"
      | "retry_requested"
      | "draining_started"
      | "stopped"
      | "terminated"
      | "orphan_detected"
      | "reconciled";
    requestId?: string | null;
    detail?: Record<string, unknown>;
    occurredAt: string;
  },
) {
  await db.prepare(
    `insert into briar_managed_computer_audit_events (
       id, organization_id, managed_computer_id, actor_user_id, action,
       request_id, detail_json, occurred_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.id ?? crypto.randomUUID(),
    input.organizationId,
    input.managedComputerId ?? null,
    input.actorUserId ?? null,
    input.action,
    input.requestId ?? null,
    JSON.stringify(input.detail ?? {}),
    input.occurredAt,
  ).run();
}

export async function createPromotionalManagedComputer(
  db: D1Database,
  input: {
    entitlementId: string;
    managedComputerId: string;
    provisioningJobId: string;
    workflowInstanceId: string;
    organizationId: string;
    userId: string;
    campaignId: string;
    requestId: string;
    organizationLimit: number;
    fleetLimit: number;
    region: string;
    instanceType: string;
    launchTemplateId: string;
    launchTemplateVersion: string;
    bootstrapApiOrigin: string;
    enrollmentNonceHash: string;
    enrollmentExpiresAt: string;
    expiresAt: string;
    observedAt: string;
  },
) {
  const statements = [
    db.prepare(
      `insert into briar_managed_computer_entitlements (
         id, organization_id, requester_user_id, source, source_reference,
         request_id, status, approved_at, expires_at, created_at, updated_at
       )
       select ?, ?, ?, 'free_promotion', ?, ?, 'approved', ?, ?, ?, ?
       where exists (
         select 1 from briar_managed_computer_campaigns
         where id = ? and active = 1
       )
         and (select count(*) from briar_managed_computers
              where organization_id = ? and state in (${activeStateSql})) < ?
         and (select count(*) from briar_managed_computers
              where state in (${activeStateSql})) < ?
         and not exists (
           select 1 from briar_managed_computer_promotion_redemptions
           where user_id = ? and campaign_id = ?
         )
         and not exists (
           select 1 from briar_managed_computer_promotion_redemptions
           where organization_id = ? and campaign_id = ?
         )
       on conflict (organization_id, request_id) do nothing`,
    ).bind(
      input.entitlementId,
      input.organizationId,
      input.userId,
      input.campaignId,
      input.requestId,
      input.observedAt,
      input.expiresAt,
      input.observedAt,
      input.observedAt,
      input.campaignId,
      input.organizationId,
      ...activeStates,
      input.organizationLimit,
      ...activeStates,
      input.fleetLimit,
      input.userId,
      input.campaignId,
      input.organizationId,
      input.campaignId,
    ),
    db.prepare(
      `insert into briar_managed_computers (
         id, organization_id, requester_user_id, entitlement_id, state,
         aws_region, aws_instance_type, aws_launch_template_id,
         aws_launch_template_version, bootstrap_api_origin,
         provisioning_job_id, enrollment_nonce_hash, enrollment_expires_at,
         created_at, state_updated_at, expires_at, updated_at
       )
       select ?, ?, ?, ?, 'requested', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       where exists (
         select 1 from briar_managed_computer_entitlements
         where id = ? and organization_id = ? and requester_user_id = ?
       )`,
    ).bind(
      input.managedComputerId,
      input.organizationId,
      input.userId,
      input.entitlementId,
      input.region,
      input.instanceType,
      input.launchTemplateId,
      input.launchTemplateVersion,
      input.bootstrapApiOrigin,
      input.provisioningJobId,
      input.enrollmentNonceHash,
      input.enrollmentExpiresAt,
      input.observedAt,
      input.observedAt,
      input.expiresAt,
      input.observedAt,
      input.entitlementId,
      input.organizationId,
      input.userId,
    ),
    db.prepare(
      `insert into briar_managed_computer_promotion_redemptions (
         id, organization_id, user_id, managed_computer_id, campaign_id,
         request_id, redeemed_at
       )
       select ?, ?, ?, ?, ?, ?, ?
       where exists (select 1 from briar_managed_computers where id = ?)`,
    ).bind(
      crypto.randomUUID(),
      input.organizationId,
      input.userId,
      input.managedComputerId,
      input.campaignId,
      input.requestId,
      input.observedAt,
      input.managedComputerId,
    ),
    db.prepare(
      `insert into briar_managed_computer_provisioning_jobs (
         id, managed_computer_id, workflow_instance_id, idempotency_key,
         status, attempt, created_at, updated_at
       )
       select ?, ?, ?, ?, 'requested', 1, ?, ?
       where exists (select 1 from briar_managed_computers where id = ?)`,
    ).bind(
      input.provisioningJobId,
      input.managedComputerId,
      input.workflowInstanceId,
      `application:${input.organizationId}:${input.requestId}`,
      input.observedAt,
      input.observedAt,
      input.managedComputerId,
    ),
    ...(["entitlement_approved", "requested"] as const).map((action) =>
      db.prepare(
        `insert into briar_managed_computer_audit_events (
           id, organization_id, managed_computer_id, actor_user_id, action,
           request_id, detail_json, occurred_at
         )
         select ?, ?, ?, ?, ?, ?, ?, ?
         where exists (select 1 from briar_managed_computers where id = ?)`,
      ).bind(
        crypto.randomUUID(),
        input.organizationId,
        input.managedComputerId,
        input.userId,
        action,
        input.requestId,
        JSON.stringify({ campaignId: input.campaignId }),
        input.observedAt,
        input.managedComputerId,
      )
    ),
  ];
  await db.batch(statements);
  return managedComputerById(db, input.managedComputerId);
}

export async function managedComputerProvisioningJob(
  db: D1Database,
  provisioningJobId: string,
) {
  return db.prepare(
    `select * from briar_managed_computer_provisioning_jobs where id = ?`,
  ).bind(provisioningJobId).first<ManagedComputerProvisioningJobRow>();
}

export async function startManagedComputerProvisioning(
  db: D1Database,
  managedComputerId: string,
  provisioningJobId: string,
  observedAt: string,
) {
  const [computer] = await db.batch([
    db.prepare(
      `update briar_managed_computers
       set state = 'provisioning', state_updated_at = ?, updated_at = ?,
           error_code = null, error_detail = null
       where id = ? and provisioning_job_id = ? and state = 'requested'
       returning *`,
    ).bind(observedAt, observedAt, managedComputerId, provisioningJobId),
    db.prepare(
      `update briar_managed_computer_provisioning_jobs
       set status = 'running', started_at = coalesce(started_at, ?), updated_at = ?
       where id = ? and managed_computer_id = ? and status = 'requested'`,
    ).bind(observedAt, observedAt, provisioningJobId, managedComputerId),
  ]);
  const row = computer.results?.[0] as ManagedComputerRow | undefined;
  return row ?? managedComputerById(db, managedComputerId);
}

export async function recordManagedComputerInstance(
  db: D1Database,
  input: {
    managedComputerId: string;
    provisioningJobId: string;
    accountId: string;
    instanceId: string;
    volumeId: string | null;
    observedAt: string;
  },
) {
  await db.prepare(
    `update briar_managed_computers
     set aws_account_id = ?, aws_instance_id = ?, aws_volume_id = ?,
         updated_at = ?
     where id = ? and provisioning_job_id = ?
       and state in ('provisioning', 'bootstrapping')
       and (aws_instance_id is null or aws_instance_id = ?)`,
  ).bind(
    input.accountId,
    input.instanceId,
    input.volumeId,
    input.observedAt,
    input.managedComputerId,
    input.provisioningJobId,
    input.instanceId,
  ).run();
}

export async function markManagedComputerBootstrapping(
  db: D1Database,
  input: {
    managedComputerId: string;
    provisioningJobId: string;
    observedAt: string;
  },
) {
  await db.prepare(
    `update briar_managed_computers
     set state = 'bootstrapping', state_updated_at = ?, updated_at = ?
     where id = ? and provisioning_job_id = ? and state = 'provisioning'`,
  ).bind(
    input.observedAt,
    input.observedAt,
    input.managedComputerId,
    input.provisioningJobId,
  ).run();
}

export async function completeManagedComputerProvisioning(
  db: D1Database,
  input: {
    managedComputerId: string;
    provisioningJobId: string;
    observedAt: string;
  },
) {
  await db.prepare(
    `update briar_managed_computer_provisioning_jobs
     set status = 'succeeded', completed_at = ?, updated_at = ?
     where id = ? and managed_computer_id = ? and status = 'running'`,
  ).bind(
    input.observedAt,
    input.observedAt,
    input.provisioningJobId,
    input.managedComputerId,
  ).run();
}

export async function failManagedComputerProvisioning(
  db: D1Database,
  input: {
    managedComputerId: string;
    provisioningJobId: string;
    code: string;
    detail: string;
    observedAt: string;
  },
) {
  const computer = await managedComputerById(db, input.managedComputerId);
  if (!computer || computer.state === "terminated") return;
  const detail = input.detail.trim().slice(0, 4_000) || "Unknown failure";
  const [computerResult] = await db.batch([
    db.prepare(
      `update briar_managed_computers
       set state = 'failed', state_updated_at = ?, error_code = ?,
           error_detail = ?, updated_at = ?
       where id = ? and provisioning_job_id = ?
         and state in ('requested', 'provisioning', 'bootstrapping')`,
    ).bind(
      input.observedAt,
      input.code.slice(0, 120),
      detail,
      input.observedAt,
      input.managedComputerId,
      input.provisioningJobId,
    ),
    db.prepare(
      `update briar_managed_computer_provisioning_jobs
       set status = 'failed', error_code = ?, error_detail = ?,
           completed_at = ?, updated_at = ?
       where id = ? and managed_computer_id = ? and status != 'succeeded'`,
    ).bind(
      input.code.slice(0, 120),
      detail,
      input.observedAt,
      input.observedAt,
      input.provisioningJobId,
      input.managedComputerId,
    ),
  ]);
  if ((computerResult.meta.changes ?? 0) > 0) {
    await recordManagedComputerAuditEvent(db, {
      organizationId: computer.organization_id,
      managedComputerId: computer.id,
      action: "provisioning_failed",
      detail: { code: input.code, detail },
      occurredAt: input.observedAt,
    });
  }
}

export async function createManagedComputerRetry(
  db: D1Database,
  input: {
    managedComputerId: string;
    organizationId: string;
    actorUserId: string;
    requestId: string;
    provisioningJobId: string;
    workflowInstanceId: string;
    enrollmentExpiresAt: string;
    observedAt: string;
  },
) {
  const idempotencyKey =
    `retry:${input.managedComputerId}:${input.requestId}`;
  const existing = await db.prepare(
    `select * from briar_managed_computer_provisioning_jobs
     where idempotency_key = ?`,
  ).bind(idempotencyKey).first<ManagedComputerProvisioningJobRow>();
  if (existing) return { job: existing, created: false };
  const computer = await organizationManagedComputer(
    db,
    input.organizationId,
    input.managedComputerId,
  );
  if (!computer || computer.state !== "failed" || computer.retry_count >= 3) {
    return null;
  }
  const attempt = computer.retry_count + 2;
  await db.batch([
    db.prepare(
      `update briar_managed_computers
       set state = 'requested', provisioning_job_id = ?,
           retry_count = retry_count + 1, last_retry_at = ?,
           state_updated_at = ?, error_code = null, error_detail = null,
           enrollment_expires_at = ?,
           updated_at = ?
       where id = ? and organization_id = ? and state = 'failed'
         and retry_count = ?`,
    ).bind(
      input.provisioningJobId,
      input.observedAt,
      input.observedAt,
      input.enrollmentExpiresAt,
      input.observedAt,
      input.managedComputerId,
      input.organizationId,
      computer.retry_count,
    ),
    db.prepare(
      `insert into briar_managed_computer_provisioning_jobs (
         id, managed_computer_id, workflow_instance_id, idempotency_key,
         status, attempt, created_at, updated_at
       )
       select ?, ?, ?, ?, 'requested', ?, ?, ?
       where exists (
         select 1 from briar_managed_computers
         where id = ? and provisioning_job_id = ? and state = 'requested'
       )`,
    ).bind(
      input.provisioningJobId,
      input.managedComputerId,
      input.workflowInstanceId,
      idempotencyKey,
      attempt,
      input.observedAt,
      input.observedAt,
      input.managedComputerId,
      input.provisioningJobId,
    ),
  ]);
  const job = await managedComputerProvisioningJob(db, input.provisioningJobId);
  if (!job) return null;
  await recordManagedComputerAuditEvent(db, {
    organizationId: input.organizationId,
    managedComputerId: input.managedComputerId,
    actorUserId: input.actorUserId,
    action: "retry_requested",
    requestId: input.requestId,
    detail: { attempt },
    occurredAt: input.observedAt,
  });
  return { job, created: true };
}

export async function enrollManagedComputerDevice(
  db: D1Database,
  input: {
    managedComputerId: string;
    nonceHash: string;
    identityHash: string;
    credentialHash: string;
    deviceId: string;
    accountId: string;
    region: string;
    instanceId: string;
    briarVersion: string;
    observedAt: string;
  },
) {
  const computer = await managedComputerById(db, input.managedComputerId);
  if (
    !computer ||
    !["bootstrapping", "needs_setup"].includes(computer.state) ||
    computer.enrollment_nonce_hash !== input.nonceHash ||
    computer.enrollment_expires_at <= input.observedAt ||
    computer.aws_account_id !== input.accountId ||
    computer.aws_region !== input.region ||
    computer.aws_instance_id !== input.instanceId
  ) return null;
  if (
    computer.enrollment_consumed_at !== null &&
    computer.enrollment_identity_hash !== input.identityHash
  ) return null;
  const firstEnrollment = computer.enrollment_consumed_at === null;
  await db.batch([
    db.prepare(
      `insert into briar_execution_worker_devices (
         id, organization_id, owner_user_id, label, device_identity_hash,
         state, max_concurrent_sessions, last_heartbeat_at, created_at, updated_at
       ) values (?, ?, ?, ?, ?, 'online', 1, ?, ?, ?)
       on conflict (organization_id, device_identity_hash) do update set
         state = 'online', max_concurrent_sessions = 1,
         last_heartbeat_at = excluded.last_heartbeat_at,
         updated_at = excluded.updated_at
       where briar_execution_worker_devices.id = excluded.id
         and briar_execution_worker_devices.owner_user_id = excluded.owner_user_id`,
    ).bind(
      input.deviceId,
      computer.organization_id,
      computer.requester_user_id,
      `Briar managed computer ${computer.id.slice(0, 8)}`,
      input.identityHash,
      input.observedAt,
      input.observedAt,
      input.observedAt,
    ),
    db.prepare(
      `insert into briar_execution_worker_credentials (
         device_id, token_hash, created_at, last_used_at, expires_at, revoked_at
       ) values (?, ?, ?, null, null, null)
       on conflict (device_id) do update set
         token_hash = excluded.token_hash, created_at = excluded.created_at,
         last_used_at = null, expires_at = null, revoked_at = null`,
    ).bind(input.deviceId, input.credentialHash, input.observedAt),
    db.prepare(
      `update briar_managed_computers
       set state = 'needs_setup', state_updated_at = ?, briar_device_id = ?,
           enrollment_consumed_at = coalesce(enrollment_consumed_at, ?),
           enrollment_identity_hash = ?, updated_at = ?
       where id = ? and enrollment_nonce_hash = ?
         and state in ('bootstrapping', 'needs_setup')`,
    ).bind(
      input.observedAt,
      input.deviceId,
      input.observedAt,
      input.identityHash,
      input.observedAt,
      computer.id,
      input.nonceHash,
    ),
  ]);
  if (firstEnrollment) {
    await recordManagedComputerAuditEvent(db, {
      organizationId: computer.organization_id,
      managedComputerId: computer.id,
      action: "enrolled",
      detail: {
        instanceId: input.instanceId,
        deviceId: input.deviceId,
        briarVersion: input.briarVersion,
      },
      occurredAt: input.observedAt,
    });
  }
  return managedComputerById(db, computer.id);
}

export async function refreshManagedComputerReadiness(
  db: D1Database,
  managedComputerId: string,
  observedAt: string,
) {
  const staleBefore = new Date(Date.parse(observedAt) - 3 * 60_000).toISOString();
  const result = await db.prepare(
    `update briar_managed_computers
     set state = 'ready', state_updated_at = ?, updated_at = ?
     where id = ? and state = 'needs_setup' and briar_device_id is not null
       and exists (
         select 1 from briar_execution_workers worker
         where worker.device_id = briar_managed_computers.briar_device_id
           and worker.state = 'online' and worker.accepting_work = 1
           and worker.readiness_state = 'ready'
           and worker.last_heartbeat_at > ?
       )`,
  ).bind(observedAt, observedAt, managedComputerId, staleBefore).run();
  const computer = await managedComputerById(db, managedComputerId);
  if (computer && (result.meta.changes ?? 0) > 0) {
    await recordManagedComputerAuditEvent(db, {
      organizationId: computer.organization_id,
      managedComputerId: computer.id,
      action: "ready",
      detail: { deviceId: computer.briar_device_id },
      occurredAt: observedAt,
    });
  }
  return computer;
}

export async function managedComputerWorkerHealth(
  db: D1Database,
  managedComputerId: string,
) {
  const row = await db.prepare(
    `select device.state as device_state,
            device.last_heartbeat_at as device_last_heartbeat_at,
            count(worker.id) as binding_count,
            coalesce(sum(case when worker.state != 'disabled' then 1 else 0 end), 0)
              as active_binding_count,
            max(worker.last_heartbeat_at) as worker_last_heartbeat_at
     from briar_managed_computers computer
     left join briar_execution_worker_devices device
       on device.id = computer.briar_device_id
     left join briar_execution_workers worker
       on worker.device_id = device.id
     where computer.id = ?
     group by computer.id, device.id`,
  ).bind(managedComputerId).first<{
    device_state: "online" | "stale" | "disabled" | null;
    device_last_heartbeat_at: string | null;
    binding_count: number;
    active_binding_count: number;
    worker_last_heartbeat_at: string | null;
  }>();
  return row ?? {
    device_state: null,
    device_last_heartbeat_at: null,
    binding_count: 0,
    active_binding_count: 0,
    worker_last_heartbeat_at: null,
  };
}

export async function listManagedComputersForReconciliation(db: D1Database) {
  const result = await db.prepare(
    `select * from briar_managed_computers
     where state in (${activeStateSql})
     order by created_at limit 500`,
  ).bind(...activeStates).all<ManagedComputerRow>();
  return result.results ?? [];
}

export async function beginManagedComputerDrain(
  db: D1Database,
  managedComputerId: string,
  observedAt: string,
) {
  const result = await db.prepare(
    `update briar_managed_computers
     set state = 'draining', state_updated_at = ?, drained_at = ?, updated_at = ?
     where id = ? and state in (
       'requested', 'provisioning', 'bootstrapping', 'needs_setup', 'ready', 'failed'
     )
     returning *`,
  ).bind(observedAt, observedAt, observedAt, managedComputerId)
    .first<ManagedComputerRow>();
  if (result?.briar_device_id) {
    await db.prepare(
      `update briar_execution_workers
       set accepting_work = 0, readiness_state = 'busy',
           readiness_detail = '관리형 컴퓨터 만료로 새 작업을 받지 않습니다.',
           updated_at = ?
       where device_id = ? and state != 'disabled'`,
    ).bind(observedAt, result.briar_device_id).run();
  }
  return result;
}

export async function markManagedComputerStopped(
  db: D1Database,
  managedComputerId: string,
  observedAt: string,
) {
  return db.prepare(
    `update briar_managed_computers
     set state = 'stopped', state_updated_at = ?, stopped_at = ?, updated_at = ?
     where id = ? and state = 'draining'
     returning *`,
  ).bind(observedAt, observedAt, observedAt, managedComputerId)
    .first<ManagedComputerRow>();
}

export async function markManagedComputerTerminated(
  db: D1Database,
  managedComputerId: string,
  observedAt: string,
) {
  const computer = await db.prepare(
    `update briar_managed_computers
     set state = 'terminated', state_updated_at = ?, terminated_at = ?, updated_at = ?
     where id = ? and state in ('stopped', 'failed')
     returning *`,
  ).bind(observedAt, observedAt, observedAt, managedComputerId)
    .first<ManagedComputerRow>();
  if (computer?.briar_device_id) {
    await db.batch([
      db.prepare(
        `update briar_execution_worker_devices
         set state = 'disabled', updated_at = ? where id = ?`,
      ).bind(observedAt, computer.briar_device_id),
      db.prepare(
        `update briar_execution_workers
         set state = 'disabled', accepting_work = 0, updated_at = ?
         where device_id = ?`,
      ).bind(observedAt, computer.briar_device_id),
      db.prepare(
        `update briar_execution_worker_credentials
         set revoked_at = coalesce(revoked_at, ?)
         where device_id = ?`,
      ).bind(observedAt, computer.briar_device_id),
    ]);
  }
  return computer;
}

export async function markManagedComputerReconciliationFailure(
  db: D1Database,
  input: {
    managedComputerId: string;
    code: string;
    detail: string;
    observedAt: string;
  },
) {
  return db.prepare(
    `update briar_managed_computers
     set state = 'failed', state_updated_at = ?, error_code = ?,
         error_detail = ?, updated_at = ?
     where id = ? and state in (
       'requested', 'provisioning', 'bootstrapping', 'needs_setup', 'ready',
       'draining', 'stopped'
     )
     returning *`,
  ).bind(
    input.observedAt,
    input.code.slice(0, 120),
    input.detail.slice(0, 4_000),
    input.observedAt,
    input.managedComputerId,
  ).first<ManagedComputerRow>();
}
