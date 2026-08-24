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
import { reconcileManagedComputers } from "./managed-computer-reconciliation";
import { flushOrganizationInboxRealtimeOutbox } from "./realtime-scheduling";
import { processSlackRevocationQueue } from "./slack-revocations";

export type ScheduledTaskDependencies = {
  archiveCompletedLogs: typeof archiveCompletedLogs;
  expireArchives: typeof expireArchives;
  processArchiveCleanupQueue: typeof processArchiveCleanupQueue;
  processSlackRevocationQueue: typeof processSlackRevocationQueue;
  pruneExpiredDashboardChanges: typeof pruneExpiredDashboardChanges;
  reconcileGithubMergedRuns: typeof reconcileGithubMergedRuns;
  reconcileEnabledMergeQueueRuns: typeof reconcileEnabledMergeQueueRuns;
  reconcileManagedComputers: typeof reconcileManagedComputers;
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
  reconcileManagedComputers,
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
        const [github, mergeQueue] = await Promise.all([
          dependencies.reconcileGithubMergedRuns(env.DB),
          dependencies.reconcileEnabledMergeQueueRuns(env.DB, observedAt),
        ]);
        await flushOrganizationInboxRealtimeOutbox(env, env.DB);
        console.log(JSON.stringify({
          message: "GitHub merge reconciliation completed",
          observedAt,
          github,
          mergeQueue,
        }));
      } catch (error) {
        console.error(JSON.stringify({
          message: "GitHub merge reconciliation failed",
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
      const [archive, expired, cleanup, slackRevocations, github, managedComputers] =
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
      ]);
      await flushOrganizationInboxRealtimeOutbox(env, env.DB);
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
