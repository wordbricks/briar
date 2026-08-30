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
import { flushOrganizationInboxRealtimeOutbox } from "./realtime-scheduling";
import { processSlackRevocationQueue } from "./slack-revocations";
import { cleanupExpiredChannelReplySessions } from "./channels";
import { maintainReplyUploadCleanup } from "./reply-completion-repository";

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
  maintainReplyUploadCleanup: typeof maintainReplyUploadCleanup;
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
  maintainReplyUploadCleanup,
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
        const [github, mergeQueue, managedComputerRetirements] =
          await Promise.all([
          dependencies.reconcileGithubMergedRuns(env.DB),
          dependencies.reconcileEnabledMergeQueueRuns(env.DB, observedAt),
          dependencies.reconcileDrainingManagedComputers(
            env.DB,
            env,
            observedAt,
          ),
        ]);
        await flushOrganizationInboxRealtimeOutbox(env, env.DB);
        console.log(JSON.stringify({
          message: "Minute reconciliation completed",
          observedAt,
          github,
          mergeQueue,
          managedComputerRetirements,
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
        channelReplySessions, replyUploads] =
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
        dependencies.maintainReplyUploadCleanup(
          env.DB,
          env.ATTACHMENTS,
          observedAt,
        ),
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
        channelReplySessions: channelReplySessions.map((session) => ({
          sessionId: session.id,
          reason: "ttl_expired",
        })),
        replyUploads,
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
