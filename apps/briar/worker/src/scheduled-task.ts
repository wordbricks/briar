import { runDueDmSchedules } from "./dm-schedules";
import {
  archiveCompletedLogs,
  expireArchives,
  processArchiveCleanupQueue,
} from "./archive";
import {
  pruneExpiredDashboardChanges,
  reconcileGithubMergedRuns,
} from "./db";
import { reconcileEnabledMergeQueueRuns } from "./merge-queue-reconcile";
import {
  reconcileDrainingManagedComputers,
  reconcileManagedComputers,
} from "./managed-computer-reconciliation";
import {
  flushAgentSkillExecutionRealtimeOutbox,
  flushWorkspaceInboxRealtimeOutbox,
} from "./realtime-scheduling";
import { processSlackRevocationQueue } from "./slack-revocations";
import { cleanupExpiredChannelReplySessions } from "./channels";
import { maintainUploadCleanup } from "./upload-repository";
import { cleanupAbandonedReplyLookups } from "./channel-reply-lookup-budget";
import { flushDmMemoryActivityRevocations } from "./dm-memory-activity-revocations";
import { flushWhatsAppOutbox } from "./whatsapp-outbox";
import { memoryVaultStoreFromEnv } from "./memory-vault/artifacts-git-store";
import { runMemoryVaultMaintenance as runMemoryVaultMaintenanceWithStore } from "./memory-vault/forget";

/**
 * Memory vault purges (every minute) and the orphan repository sweep (every six
 * hours). A failure is logged and reported, never allowed to fail the other
 * scheduled work.
 */
async function runMemoryVaultMaintenance(env: Env, cadence: "minute" | "six_hourly") {
  const store = memoryVaultStoreFromEnv(env);
  let maintenance: Awaited<ReturnType<typeof runMemoryVaultMaintenanceWithStore>> | { error: string };
  try {
    maintenance = await runMemoryVaultMaintenanceWithStore({ db: env.DB, store }, cadence);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "Memory vault maintenance failed", cadence, error: message }));
    maintenance = { error: message };
  }
  return maintenance;
}

/**
 * Reply-claim housekeeping that used to ride on DM memory maintenance: drop
 * lookup caches of reply claims that ended, and clear the activity of replies
 * a DM memory revocation sent back to the queue.
 */
async function runDmReplyCleanup(env: Env, observedAt: string) {
  await cleanupAbandonedReplyLookups(env.DB, observedAt);
  return env.CHANNEL_ACTIVITY_REALTIME ? await flushDmMemoryActivityRevocations(env.DB, env) : null;
}

export type ScheduledTaskDependencies = {
  archiveCompletedLogs: typeof archiveCompletedLogs;
  expireArchives: typeof expireArchives;
  processArchiveCleanupQueue: typeof processArchiveCleanupQueue;
  processSlackRevocationQueue: typeof processSlackRevocationQueue;
  pruneExpiredDashboardChanges: typeof pruneExpiredDashboardChanges;
  reconcileGithubMergedRuns: typeof reconcileGithubMergedRuns;
  reconcileEnabledMergeQueueRuns: typeof reconcileEnabledMergeQueueRuns;
  reconcileDrainingManagedComputers: typeof reconcileDrainingManagedComputers;
  reconcileManagedComputers: typeof reconcileManagedComputers;
  cleanupExpiredChannelReplySessions: typeof cleanupExpiredChannelReplySessions;
  maintainUploadCleanup: typeof maintainUploadCleanup;
  runDmReplyCleanup: typeof runDmReplyCleanup;
  runDueDmSchedules: typeof runDueDmSchedules;
  flushWhatsAppOutbox: typeof flushWhatsAppOutbox;
  runMemoryVaultMaintenance: typeof runMemoryVaultMaintenance;
};

interface DashboardChangePruneFailure {
  error: unknown;
}

const scheduledTaskDependencies: ScheduledTaskDependencies = {
  archiveCompletedLogs,
  expireArchives,
  processArchiveCleanupQueue,
  processSlackRevocationQueue,
  pruneExpiredDashboardChanges,
  reconcileGithubMergedRuns,
  reconcileEnabledMergeQueueRuns,
  reconcileDrainingManagedComputers,
  reconcileManagedComputers,
  cleanupExpiredChannelReplySessions,
  maintainUploadCleanup,
  runDmReplyCleanup,
  runDueDmSchedules,
  flushWhatsAppOutbox,
  runMemoryVaultMaintenance,
};
const GITHUB_RECONCILIATION_CRON = "* * * * *";
const LOG_MAINTENANCE_CRON = "17 */6 * * *";

export async function handleScheduledTask(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
  dependencies = scheduledTaskDependencies,
): Promise<void> {
  const observedAt = new Date(controller.scheduledTime).toISOString();
  if (controller.cron === GITHUB_RECONCILIATION_CRON) {
    ctx.waitUntil((async () => {
      try {
        const [github, mergeQueue, managedComputerRetirements, dmReplyCleanup, whatsapp, dmSchedules, memoryVault] =
          await Promise.all([
          dependencies.reconcileGithubMergedRuns(env.DB),
          dependencies.reconcileEnabledMergeQueueRuns(env.DB, observedAt),
          dependencies.reconcileDrainingManagedComputers(
            env.DB,
            env,
            observedAt,
          ),
          dependencies.runDmReplyCleanup(env, observedAt),
          dependencies.flushWhatsAppOutbox(env, env.DB, observedAt),
          dependencies.runDueDmSchedules(env.DB, new Date().toISOString()),
          dependencies.runMemoryVaultMaintenance(env, "minute"),
        ]);
        await Promise.all([
          flushWorkspaceInboxRealtimeOutbox(env, env.DB),
          flushAgentSkillExecutionRealtimeOutbox(env, env.DB),
        ]);
        console.log(JSON.stringify({
          message: "Minute reconciliation completed",
          observedAt,
          github,
          mergeQueue,
          managedComputerRetirements,
          dmReplyCleanup,
          whatsapp,
          dmSchedules,
          memoryVault,
        }));
      } catch (error) {
        console.error(JSON.stringify({
          message: "Minute reconciliation failed",
          observedAt,
          error: error instanceof Error ? error.message : String(error),
        }));
        throw error;
      }
    })());
    return;
  }
  if (controller.cron !== LOG_MAINTENANCE_CRON) {
    console.error(JSON.stringify({
      message: "Unknown scheduled task ignored",
      observedAt,
      cron: controller.cron,
    }));
    controller.noRetry();
    return;
  }
  ctx.waitUntil((async () => {
    try {
      // Keep the bounded delete separate from the other D1 maintenance writers.
      let dashboardChanges: Awaited<
        ReturnType<typeof pruneExpiredDashboardChanges>
      > | null = null;
      let dashboardChangePruneFailure: DashboardChangePruneFailure | null = null;
      try {
        dashboardChanges = await dependencies.pruneExpiredDashboardChanges(
          env.DB,
          observedAt,
        );
      } catch (error) {
        dashboardChangePruneFailure = { error };
        console.error(JSON.stringify({
          message: "Dashboard change prune failed",
          observedAt,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
      const [archive, expired, cleanup, slackRevocations, github, managedComputers,
        channelReplySessions, uploads, memoryVault] =
        await Promise.all([
        dependencies.archiveCompletedLogs(env.DB, env.ARCHIVES, observedAt),
        dependencies.expireArchives(
          env.DB,
          env.ARCHIVES,
          env.ATTACHMENTS,
          observedAt,
        ),
        dependencies.processArchiveCleanupQueue(
          env.DB,
          env.ARCHIVES,
          env.ATTACHMENTS,
          observedAt,
        ),
        dependencies.processSlackRevocationQueue(env.DB, env, observedAt),
        dependencies.reconcileGithubMergedRuns(env.DB),
        dependencies.reconcileManagedComputers(env.DB, env, observedAt),
        dependencies.cleanupExpiredChannelReplySessions(env.DB, { observedAt }),
        dependencies.maintainUploadCleanup(
          env.DB,
          env.ATTACHMENTS,
          observedAt,
        ),
        dependencies.runMemoryVaultMaintenance(env, "six_hourly"),
      ]);
      await Promise.all([
        flushWorkspaceInboxRealtimeOutbox(env, env.DB),
        flushAgentSkillExecutionRealtimeOutbox(env, env.DB),
      ]);
      if (dashboardChangePruneFailure !== null) {
        throw dashboardChangePruneFailure.error;
      }
      console.log(JSON.stringify({
        message: "log archive sweep completed",
        observedAt,
        dashboardChanges,
        archive,
        expiredObjects: expired,
        cleanup,
        slackRevocations,
        github,
        managedComputers,
        channelReplySessions: channelReplySessions.map((session) => ({
          sessionId: session.id,
          reason: "ttl_expired",
        })),
        uploads,
        memoryVault,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        message: "log archive sweep failed",
        observedAt,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  })());
}
