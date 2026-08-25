import {
  describeManagedInstance,
  listTaggedManagedInstances,
  stopManagedInstance,
  terminateManagedInstance,
  verifyManagedInstance,
} from "./aws-managed-computer";
import { managedComputerConfig } from "./managed-computer-model";
import {
  beginManagedComputerDrain,
  listDrainingManagedComputersForReconciliation,
  listManagedComputersForReconciliation,
  managedComputerById,
  markManagedComputerReconciliationFailure,
  markManagedComputerStopped,
  markManagedComputerTerminated,
  managedComputerWorkerHealth,
  recordManagedComputerAuditEvent,
  refreshManagedComputerReadiness,
} from "./managed-computer-repository";
import { countExecutionWorkerDeviceSessions } from "./workers";
import {
  endManagedComputerRemoteSessionsAndDisconnect,
  expireStaleManagedComputerRemoteSessionsAndDisconnect,
} from "./managed-computer-remote-service";

export type ManagedComputerRetirementDependencies = {
  managedComputerById: typeof managedComputerById;
  listDrainingManagedComputersForReconciliation:
    typeof listDrainingManagedComputersForReconciliation;
  countExecutionWorkerDeviceSessions:
    typeof countExecutionWorkerDeviceSessions;
  stopManagedInstance: typeof stopManagedInstance;
  markManagedComputerStopped: typeof markManagedComputerStopped;
  endManagedComputerRemoteSessionsAndDisconnect:
    typeof endManagedComputerRemoteSessionsAndDisconnect;
  recordManagedComputerAuditEvent: typeof recordManagedComputerAuditEvent;
};

const managedComputerRetirementDependencies:
  ManagedComputerRetirementDependencies = {
    managedComputerById,
    listDrainingManagedComputersForReconciliation,
    countExecutionWorkerDeviceSessions,
    stopManagedInstance,
    markManagedComputerStopped,
    endManagedComputerRemoteSessionsAndDisconnect,
    recordManagedComputerAuditEvent,
  };

export type ManagedComputerStopAttempt =
  | { outcome: "not_draining" }
  | { outcome: "not_configured" }
  | { outcome: "waiting"; activeSessions: number }
  | { outcome: "stopped"; activeSessions: 0 }
  | { outcome: "unchanged"; activeSessions: 0 };

export async function reconcileDrainingManagedComputer(
  db: D1Database,
  env: Env,
  managedComputerId: string,
  observedAt: string,
  dependencies = managedComputerRetirementDependencies,
): Promise<ManagedComputerStopAttempt> {
  const computer = await dependencies.managedComputerById(
    db,
    managedComputerId,
  );
  if (!computer || computer.state !== "draining") {
    return { outcome: "not_draining" };
  }
  const config = managedComputerConfig(env);
  if (!config.awsAccessKeyId || !config.awsSecretAccessKey) {
    return { outcome: "not_configured" };
  }
  const activeSessions = computer.briar_device_id
    ? await dependencies.countExecutionWorkerDeviceSessions(
        db,
        computer.briar_device_id,
        observedAt,
      )
    : 0;
  if (activeSessions > 0) return { outcome: "waiting", activeSessions };
  if (computer.aws_instance_id) {
    await dependencies.stopManagedInstance(
      config,
      computer.aws_region,
      computer.aws_instance_id,
    );
  }
  const updated = await dependencies.markManagedComputerStopped(
    db,
    computer.id,
    observedAt,
  );
  if (!updated) return { outcome: "unchanged", activeSessions: 0 };
  await dependencies.endManagedComputerRemoteSessionsAndDisconnect(db, env, {
    managedComputerId: computer.id,
    reason: "computer_stopped",
    observedAt,
  });
  await dependencies.recordManagedComputerAuditEvent(db, {
    organizationId: computer.organization_id,
    managedComputerId: computer.id,
    action: "stopped",
    detail: { activeSessions: 0 },
    occurredAt: observedAt,
  });
  return { outcome: "stopped", activeSessions: 0 };
}

export async function reconcileDrainingManagedComputers(
  db: D1Database,
  env: Env,
  observedAt: string,
  dependencies = managedComputerRetirementDependencies,
) {
  const config = managedComputerConfig(env);
  if (!config.awsAccessKeyId || !config.awsSecretAccessKey) {
    return { skipped: true, reason: "not_configured" as const };
  }
  const computers = await dependencies
    .listDrainingManagedComputersForReconciliation(db);
  let waiting = 0;
  let stopped = 0;
  let unchanged = 0;
  let failed = 0;
  for (const computer of computers) {
    try {
      const result = await reconcileDrainingManagedComputer(
        db,
        env,
        computer.id,
        observedAt,
        dependencies,
      );
      if (result.outcome === "waiting") waiting += 1;
      if (result.outcome === "stopped") stopped += 1;
      if (["not_draining", "unchanged"].includes(result.outcome)) {
        unchanged += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({
        message: "Managed computer stop retry failed",
        managedComputerId: computer.id,
        observedAt,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return {
    skipped: false,
    checked: computers.length,
    waiting,
    stopped,
    unchanged,
    failed,
  };
}

export async function reconcileManagedComputers(
  db: D1Database,
  env: Env,
  observedAt: string,
) {
  await expireStaleManagedComputerRemoteSessionsAndDisconnect(
    db,
    env,
    observedAt,
  );
  const config = managedComputerConfig(env);
  if (
    !config.region ||
    !config.launchTemplateId ||
    !config.launchTemplateVersion ||
    !config.awsAccessKeyId ||
    !config.awsSecretAccessKey
  ) return { skipped: true, reason: "not_configured" as const };
  const computers = await listManagedComputersForReconciliation(db);
  let drained = 0;
  let stopped = 0;
  let terminated = 0;
  let failed = 0;
  for (const computer of computers) {
    if (computer.state === "needs_setup") {
      await refreshManagedComputerReadiness(db, computer.id, observedAt);
    }
    if (
      computer.expires_at <= observedAt &&
      !["draining", "stopped", "terminated"].includes(computer.state)
    ) {
      const draining = await beginManagedComputerDrain(db, computer.id, observedAt);
      if (draining) {
        drained += 1;
        await endManagedComputerRemoteSessionsAndDisconnect(db, env, {
          managedComputerId: computer.id,
          reason: "computer_expired",
          observedAt,
        });
        await recordManagedComputerAuditEvent(db, {
          organizationId: computer.organization_id,
          managedComputerId: computer.id,
          action: "draining_started",
          detail: { reason: "expired" },
          occurredAt: observedAt,
        });
      }
      continue;
    }
    if (computer.state === "draining") {
      try {
        const result = await reconcileDrainingManagedComputer(
          db,
          env,
          computer.id,
          observedAt,
        );
        if (result.outcome === "stopped") stopped += 1;
      } catch (error) {
        failed += 1;
        console.error(JSON.stringify({
          message: "Managed computer stop reconciliation failed",
          managedComputerId: computer.id,
          observedAt,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
      continue;
    }
    if (
      computer.state === "stopped" &&
      computer.stopped_at &&
      Date.parse(observedAt) >=
        Date.parse(computer.stopped_at) +
          config.stoppedRetentionDays * 24 * 60 * 60_000
    ) {
      if (computer.aws_instance_id) {
        await terminateManagedInstance(
          config,
          computer.aws_region,
          computer.aws_instance_id,
        );
      }
      const updated = await markManagedComputerTerminated(db, computer.id, observedAt);
      if (updated) {
        terminated += 1;
        await endManagedComputerRemoteSessionsAndDisconnect(db, env, {
          managedComputerId: computer.id,
          reason: "computer_terminated",
          observedAt,
        });
        await recordManagedComputerAuditEvent(db, {
          organizationId: computer.organization_id,
          managedComputerId: computer.id,
          action: "terminated",
          detail: { retentionDays: config.stoppedRetentionDays },
          occurredAt: observedAt,
        });
      }
      continue;
    }
    if (!computer.aws_instance_id || computer.state === "requested") continue;
    try {
      const workerHealth = await managedComputerWorkerHealth(db, computer.id);
      if (
        computer.state === "ready" &&
        (
          workerHealth.device_state === "disabled" ||
          workerHealth.active_binding_count === 0
        )
      ) {
        throw new Error("Briar computer registration is missing or disabled");
      }
      const instance = await describeManagedInstance(
        config,
        computer.aws_region,
        computer.aws_instance_id,
      );
      if (!instance || instance.state === "terminated") {
        throw new Error("AWS instance is missing");
      }
      await verifyManagedInstance(config, {
        managedComputerId: computer.id,
        organizationId: computer.organization_id,
        campaignId: config.campaignId,
        instanceId: computer.aws_instance_id,
        region: computer.aws_region,
        launchTemplateId: computer.aws_launch_template_id,
        launchTemplateVersion: computer.aws_launch_template_version,
        instanceType: computer.aws_instance_type,
      });
      await recordManagedComputerAuditEvent(db, {
        organizationId: computer.organization_id,
        managedComputerId: computer.id,
        action: "reconciled",
        detail: {
          awsState: instance.state,
          briarState: computer.state,
          workerDeviceState: workerHealth.device_state,
          workerBindings: workerHealth.binding_count,
          activeWorkerBindings: workerHealth.active_binding_count,
          workerLastHeartbeatAt: workerHealth.worker_last_heartbeat_at,
        },
        occurredAt: observedAt,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const updated = await markManagedComputerReconciliationFailure(db, {
        managedComputerId: computer.id,
        code: "MANAGED_COMPUTER_RECONCILIATION_FAILED",
        detail,
        observedAt,
      });
      if (updated) {
        failed += 1;
        await endManagedComputerRemoteSessionsAndDisconnect(db, env, {
          managedComputerId: computer.id,
          reason: "computer_unhealthy",
          observedAt,
        });
        await recordManagedComputerAuditEvent(db, {
          organizationId: computer.organization_id,
          managedComputerId: computer.id,
          action: "orphan_detected",
          detail: { instanceId: computer.aws_instance_id, reason: detail },
          occurredAt: observedAt,
        });
      }
    }
  }
  const knownInstanceIds = new Set(
    computers.flatMap((computer) =>
      computer.aws_instance_id ? [computer.aws_instance_id] : []
    ),
  );
  const tagged = await listTaggedManagedInstances(config);
  const orphanInstanceIds = tagged
    .filter((instance) => !knownInstanceIds.has(instance.instanceId))
    .map((instance) => instance.instanceId);
  return {
    skipped: false,
    checked: computers.length,
    drained,
    stopped,
    terminated,
    failed,
    orphanInstanceIds,
  };
}
