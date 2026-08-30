import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { platform } from "node:os";
import { join } from "node:path";
import { autoHuntRequirementKinds } from "../src/lib/auto-hunt-contract";
import { organizationAgentContextCapability } from "../src/lib/organization-agent-context-contract";
import { runProjectAgentTaskCompletionFlow } from "./agent-runner";
import { HttpRequestError } from "./execution-metrics-upload";
import {
  inspectWorkflowRequirements,
  workflowRequirementReadinessDetail,
} from "./workflow-requirements";
import {
  createWorkerDeviceIdentity,
  createWorkerLoopHeartbeat,
  defaultWorkerLabel,
  interruptibleSleep,
  runWorkerLoop,
} from "./worker";
import {
  executeClaimedMergeBatch,
  type MergeBatchApi,
} from "./merge-queue";
import {
  supportsRemoteWorkerUpdates,
  workerUpdateLaunch,
  type WorkerUpdateDirective,
} from "./worker-update";
import {
  analysisWorktreePath,
  extendCachedAnalysisWorktreeRetention,
  maintainIdleAnalysisWorktrees,
  projectWorktreeRoot,
} from "./worktree";
import {
  cleanupOrphanedOrganizationAgentWorkspaces,
  prepareOrganizationAgentWorkspace,
} from "./organization-agent-context";
import {
  healthyWorkerProviders,
  inspectWorkerProviderHealth,
  providerHealthReadinessDetail,
} from "./provider-health";
import { discoverWorkerProviderCapabilities } from "./provider-capabilities";
import {
  decodeWorkerBinding,
  decodeWorkerRegistration,
  type WorkerRegistration,
} from "./worker-registration-contract";
import { createWorkerQueueClient } from "./worker-queue-client";
import type { ClaimedWork } from "./worker-queue-contract";
import {
  configDirectory,
  cliVersion,
  value,
  has,
  loadConfig,
  saveConfig,
  request,
  login,
  gitValueAt,
  runGit,
  worktreeSettings,
  worktreesEnabled,
  currentProject,
} from "./command-support";
import {
  maintainRecordedCompletedWorktrees,
  syncCompletedWorktreeRecordsFromDashboard,
} from "./worktree-commands";
import {
  activeReplyActivityPublishers,
  activeCachedAnalysisWorktreePaths,
  runClaimedIssue,
} from "./issue-execution";
import {
  runClaimedProjectAgentTask,
  completeClaimedProjectAgentTask,
  failClaimedProjectAgentTask,
  runClaimedIssueReply,
  failClaimedIssueReply,
  runClaimedChannelReply,
  failClaimedChannelReply,
} from "./reply-execution";
import { loadManagedComputerCredential } from "./managed-computer-credential";

const WORKER_SERVER_MAINTENANCE_INTERVAL_MS = 5 * 60_000;

async function workerRegisterCommand() {
  const config = await loadConfig();
  const userToken = process.env.BRIAR_USER_TOKEN ?? config.userToken;
  if (!userToken) throw new Error("먼저 `briar login`을 실행하세요.");
  const requestedProjectId = value("--project");
  const project = requestedProjectId
    ? config.projects.find((candidate) => candidate.id === requestedProjectId)
    : await currentProject(config);
  if (!project) {
    throw new Error("이 컴퓨터에 연결된 프로젝트를 찾지 못했습니다.");
  }
  const deviceIdentity =
    config.workerDeviceIdentity ?? createWorkerDeviceIdentity();
  const label = value("--label") ?? defaultWorkerLabel();
  const configuredProvider = project.llm?.provider ?? "codex";
  const providerHealth = await inspectWorkerProviderHealth(
    config.agentProviders,
    { openrouterApiKey: config.openrouterApiKey ?? null },
  );
  const providerCapabilities = await discoverWorkerProviderCapabilities(
    config.agentProviders,
    { refresh: true },
  );
  const providers = healthyWorkerProviders(providerHealth);
  const provider = providers.includes(configuredProvider)
    ? configuredProvider
    : (providers[0] ?? configuredProvider);
  const requestedMaxSessions = Number.parseInt(
    value("--max-sessions") ?? "",
    10,
  );
  let registration: WorkerRegistration | null = null;
  if (config.projects.some((candidate) => candidate.executionWorker)) {
    try {
      const binding = decodeWorkerBinding(
        await request(
          config.apiUrl,
          `/projects/${project.id}/workers/bind`,
          userToken,
          {
            method: "POST",
            body: JSON.stringify({
              deviceIdentity,
              agentProvider: provider,
              providers,
              providerHealth,
              providerCapabilities,
              versions: { briar: cliVersion },
            }),
          },
        ),
      );
      const existing = config.projects.find(
        (candidate) => candidate.executionWorker?.deviceId === binding.deviceId,
      )?.executionWorker;
      if (existing?.token) {
        registration = {
          ...binding,
          workerToken: existing.token,
        };
      }
    } catch {
      // The device is not enrolled in this organization yet. Registration
      // below creates it and issues the first organization credential.
    }
  }
  registration ??= decodeWorkerRegistration(
    await request(
      config.apiUrl,
      `/projects/${project.id}/workers/register`,
      userToken,
      {
        method: "POST",
        body: JSON.stringify({
          label,
          deviceIdentity,
          agentProvider: provider,
          providers,
          providerHealth,
          providerCapabilities,
          ...(Number.isInteger(requestedMaxSessions) &&
          requestedMaxSessions > 0
            ? { maxConcurrentSessions: requestedMaxSessions }
            : {}),
          versions: { briar: cliVersion },
        }),
      },
    ),
  );
  config.workerDeviceIdentity = deviceIdentity;
  config.projects = config.projects.map((candidate) => {
    if (
      candidate.id !== project.id &&
      candidate.executionWorker?.deviceId !== registration.deviceId
    ) {
      return candidate;
    }
    return {
      ...candidate,
      executionWorker: {
        deviceId: registration.deviceId,
        workerId:
          candidate.id === project.id
            ? registration.worker.id
            : candidate.executionWorker!.workerId,
        organizationId: registration.organizationId,
        token: registration.workerToken,
        label,
        maxConcurrentSessions: registration.worker.maxConcurrentSessions,
      },
    };
  });
  await saveConfig(config);
  console.log(
    JSON.stringify({
      projectId: project.id,
      organizationId: registration.organizationId,
      deviceId: registration.deviceId,
      workerId: registration.worker.id,
      label,
      maxConcurrentSessions: registration.worker.maxConcurrentSessions,
      state: registration.worker.state,
    }),
  );
}

async function workerUnregisterCommand() {
  const config = await loadConfig();
  const userToken = process.env.BRIAR_USER_TOKEN ?? config.userToken;
  if (!userToken) throw new Error("먼저 `briar login`을 실행하세요.");
  const requestedProjectId = value("--project");
  const project = requestedProjectId
    ? config.projects.find((candidate) => candidate.id === requestedProjectId)
    : await currentProject(config);
  if (!project?.executionWorker) {
    throw new Error("이 프로젝트에 등록된 worker가 없습니다.");
  }
  const requestedLifecycleReason = value("--lifecycle-reason");
  if (
    requestedLifecycleReason &&
    requestedLifecycleReason !== "managed-deprovision"
  ) {
    throw new Error("Worker lifecycle reason이 올바르지 않습니다.");
  }
  const lifecycleReason = requestedLifecycleReason === "managed-deprovision"
    ? "managed_deprovision"
    : "explicit_user_unlink";
  await request(
    config.apiUrl,
    `/projects/${project.id}/workers/${project.executionWorker.workerId}`,
    userToken,
    {
      method: "DELETE",
      headers: {
        "Idempotency-Key":
          `worker-unlink:${project.id}:${project.executionWorker.workerId}`,
        "X-Briar-Worker-Lifecycle-Reason": lifecycleReason,
      },
    },
  );
  config.projects = config.projects.map((candidate) =>
    candidate.id === project.id
      ? { ...candidate, executionWorker: undefined }
      : candidate,
  );
  await saveConfig(config);
  console.log(
    JSON.stringify({
      deviceId: project.executionWorker.deviceId,
      projectId: project.id,
      state: "unbound",
    }),
  );
}

interface WorkerLabelSyncFailure {
  error: unknown;
}

async function workerSyncLabelCommand() {
  const config = await loadConfig();
  const label = defaultWorkerLabel();
  const registrationsByDevice = new Map<
    string,
    Array<{ workerId: string; token: string }>
  >();
  for (const project of config.projects) {
    const registered = project.executionWorker;
    if (!registered?.token) continue;
    const registrations = registrationsByDevice.get(registered.deviceId) ?? [];
    registrations.push({
      workerId: registered.workerId,
      token: registered.token,
    });
    registrationsByDevice.set(registered.deviceId, registrations);
  }

  const syncedDeviceIds = new Set<string>();
  let failedDevices = 0;
  for (const [deviceId, registrations] of registrationsByDevice) {
    let lastFailure: WorkerLabelSyncFailure | null = null;
    for (const registration of registrations) {
      try {
        await request(
          config.apiUrl,
          `/workers/${registration.workerId}/label`,
          registration.token,
          {
            method: "PATCH",
            body: JSON.stringify({ label }),
          },
        );
        syncedDeviceIds.add(deviceId);
        lastFailure = null;
        break;
      } catch (error) {
        lastFailure = { error };
      }
    }
    if (lastFailure?.error) failedDevices += 1;
  }

  if (syncedDeviceIds.size > 0) {
    config.projects = config.projects.map((project) => {
      const registered = project.executionWorker;
      if (!registered || !syncedDeviceIds.has(registered.deviceId)) {
        return project;
      }
      return {
        ...project,
        executionWorker: { ...registered, label },
      };
    });
    await saveConfig(config);
  }
  console.log(
    JSON.stringify({
      label,
      syncedDevices: syncedDeviceIds.size,
      failedDevices,
    }),
  );
}

async function workerCommand() {
  const config = await loadConfig();
  await cleanupOrphanedOrganizationAgentWorkspaces({
    workerSessionsDirectory: join(configDirectory, "worker-sessions"),
  });
  const projectId = value("--project");
  const project = projectId
    ? config.projects.find((candidate) => candidate.id === projectId)
    : await currentProject(config);
  if (!project) {
    throw new Error("이 컴퓨터에 연결된 프로젝트를 찾지 못했습니다.");
  }
  const registered = project.executionWorker;
  if (!registered) {
    throw new Error(
      "이 프로젝트의 worker가 등록되지 않았습니다. `briar worker register`를 먼저 실행하세요.",
    );
  }
  const managedCredential =
    !process.env.BRIAR_WORKER_TOKEN && !registered.token && config.managedComputer
      ? await loadManagedComputerCredential(
        config.managedComputer.credentialFile,
      )
      : null;
  if (
    managedCredential &&
    (managedCredential.deviceId !== registered.deviceId ||
      managedCredential.organizationId !== registered.organizationId)
  ) {
    throw new Error("Managed computer credential does not match this worker");
  }
  const workerToken = process.env.BRIAR_WORKER_TOKEN ??
    registered.token ?? managedCredential?.credential;
  if (!workerToken) {
    throw new Error("이 worker의 machine credential을 읽지 못했습니다.");
  }
  const label = registered.label;
  const workerId = registered.workerId;
  const triggerWorkerUpdate = (directive: WorkerUpdateDirective) => {
    if (directive.handoffState === "failed") return;
    const launch = workerUpdateLaunch(directive, workerId);
    const child = spawn(launch.command, launch.args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  };
  let sharedWorkflowRequirements:
    | Array<{
        id: string;
        label: string;
        kind: (typeof autoHuntRequirementKinds)[number];
        tool: string;
        reason: string;
      }>
    | null = project.autoHunt?.workflow?.requirements ?? null;
  const readinessProblem = !gitValueAt(project.repositoryPath, [
    "rev-parse",
    "--show-toplevel",
  ])
    ? "연결된 저장소를 열 수 없습니다."
    : null;
  console.log(`worker ${label} starting as ${workerId}`);

  if (readinessProblem) {
    const providerHealth = await inspectWorkerProviderHealth(
      config.agentProviders,
      { openrouterApiKey: config.openrouterApiKey ?? null },
    );
    const providerCapabilities = await discoverWorkerProviderCapabilities(
      config.agentProviders,
    );
    const heartbeat = await request<{
      updateDirective?: WorkerUpdateDirective | null;
    }>(
      config.apiUrl,
      `/workers/${workerId}/heartbeat`,
      workerToken,
      {
        method: "POST",
        body: JSON.stringify({
          versions: { briar: cliVersion },
          acceptingWork: false,
          readinessState: "needs_attention",
          readinessDetail: readinessProblem,
          capabilities: {
            providers: healthyWorkerProviders(providerHealth),
            providerHealth,
            providerCapabilities,
            worktrees: true,
            remoteUpdates: {
              supported: supportsRemoteWorkerUpdates(platform()),
              protocol: 1,
            },
            organizationAgentContext: organizationAgentContextCapability,
          },
        }),
      },
    );
    if (
      heartbeat.updateDirective &&
      supportsRemoteWorkerUpdates(platform())
    ) {
      triggerWorkerUpdate(heartbeat.updateDirective);
    }
    throw new Error(readinessProblem);
  }

  const maxIssues = Number.parseInt(value("--max-issues") ?? "", 10);
  const workerQueue = createWorkerQueueClient(config.apiUrl, workerToken);
  const mergeBatchApi: MergeBatchApi = <T = unknown>(
    path: string,
    init: { method: "POST"; body: string },
  ) => request<T>(config.apiUrl, path, workerToken, init);
  let lastWorktreeSweepAt = Number.NEGATIVE_INFINITY;
  let lastAnalysisWorktreeSweepAt = Number.NEGATIVE_INFINITY;
  let lastServerMaintenanceAt = Number.NEGATIVE_INFINITY;
  let lastTriggeredUpdateId: string | null = null;
  const result = await runWorkerLoop<ClaimedWork>(
    {
      claim: async (_options) => workerQueue.claimWork({
          projectId: project.id,
          workerId,
          claimedBy: label,
          repliesOnly: _options?.repliesOnly === true,
        }),
      renewLease: async (issue) => {
        const renewed = await workerQueue.renewWorkLease({
          projectId: project.id,
          workerId,
          work: issue,
        });
        if (issue.workType === "channelReply") {
          const reply = issue;
          activeReplyActivityPublishers.get(reply.workId)?.updateCredential(
            renewed.activity,
          );
          if (reply.session && renewed.retainedUntil) {
            if (reply.projectId) {
              const settings = worktreeSettings(project);
              const root = projectWorktreeRoot(settings.root, project.id);
              const path = analysisWorktreePath(
                settings.root,
                project.id,
                reply.session.id,
              );
              if (activeCachedAnalysisWorktreePaths.has(path)) {
                await extendCachedAnalysisWorktreeRetention({
                  root,
                  runId: reply.session.id,
                  retainedUntil: renewed.retainedUntil,
                });
              }
            } else {
              await prepareOrganizationAgentWorkspace(
                join(
                  configDirectory,
                  "worker-sessions",
                  `channel-${reply.session.id}`,
                ),
                process.pid,
                { reuse: true, retainedUntil: renewed.retainedUntil },
              );
            }
          }
          return;
        }
        if (issue.workType === "issueReply") {
          const reply = issue;
          activeReplyActivityPublishers.get(reply.workId)?.updateCredential(
            renewed.activity,
          );
        }
      },
      heartbeat: async (readinessState = "ready") => {
        if (Date.now() - lastAnalysisWorktreeSweepAt >= 5 * 60_000) {
          lastAnalysisWorktreeSweepAt = Date.now();
          try {
            await cleanupOrphanedOrganizationAgentWorkspaces({
              workerSessionsDirectory: join(configDirectory, "worker-sessions"),
            });
            const maintenance = await maintainIdleAnalysisWorktrees(
              runGit,
              project.repositoryPath,
              projectWorktreeRoot(worktreeSettings(project).root, project.id),
              { activePaths: [...activeCachedAnalysisWorktreePaths.keys()] },
            );
            const reportable = maintenance.filter(
              (item) => item.status === "removed" || item.reason !== "active",
            );
            if (reportable.length > 0) {
              console.log(
                `analysis worktree maintenance: ${JSON.stringify(reportable)}`,
              );
            }
          } catch (error) {
            console.error(
              `analysis worktree maintenance failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        if (Date.now() - lastWorktreeSweepAt >= 60 * 60 * 1_000) {
          lastWorktreeSweepAt = Date.now();
          try {
            await syncCompletedWorktreeRecordsFromDashboard(config, project);
            const maintenance = await maintainRecordedCompletedWorktrees(project);
            if (maintenance.length > 0) {
              console.log(`completed worktree maintenance: ${JSON.stringify(maintenance)}`);
            }
          } catch (error) {
            console.error(
              `completed worktree maintenance failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        const providerHealth = await inspectWorkerProviderHealth(
          config.agentProviders,
          { openrouterApiKey: config.openrouterApiKey ?? null },
        );
        const providerCapabilities = await discoverWorkerProviderCapabilities(
          config.agentProviders,
        );
        const providers = healthyWorkerProviders(providerHealth);
        const hasHealthyProvider = providers.length > 0;
        // Shared project workflow tools must be ready on this worker machine.
        // Prefer the requirements returned by the previous heartbeat (server is
        // source of truth); fall back to the local mirrored workflow.
        const sharedRequirements =
          sharedWorkflowRequirements ??
          project.autoHunt?.workflow?.requirements ??
          [];
        const requirementHealth =
          inspectWorkflowRequirements(sharedRequirements);
        const requirementDetail =
          workflowRequirementReadinessDetail(requirementHealth);
        const toolsReady = requirementDetail === null;
        const acceptingWork = hasHealthyProvider && toolsReady;
        const nextReadinessState = !hasHealthyProvider || !toolsReady
          ? "needs_attention"
          : readinessState;
        const nextReadinessDetail = !hasHealthyProvider
          ? providerHealthReadinessDetail(providerHealth)
          : requirementDetail;
        // Reaper and workflow settings are not liveness data. Refresh them on
        // a separate cadence while every heartbeat keeps dispatch state fresh.
        const refreshMaintenance =
          Date.now() - lastServerMaintenanceAt >=
            WORKER_SERVER_MAINTENANCE_INTERVAL_MS;
        const heartbeat = await request<{
          worker: { maxConcurrentSessions?: number };
          updateDirective?: WorkerUpdateDirective | null;
          workflowRequirements?: Array<{
            id: string;
            label: string;
            kind: (typeof autoHuntRequirementKinds)[number];
            tool: string;
            reason: string;
          }>;
        }>(
          config.apiUrl,
          `/workers/${workerId}/heartbeat`,
          workerToken,
          {
            method: "POST",
            body: JSON.stringify({
              versions: { briar: cliVersion },
              refreshMaintenance,
              acceptingWork,
              readinessState: nextReadinessState,
              readinessDetail: nextReadinessDetail,
              capabilities: {
                providers,
                providerHealth,
                providerCapabilities,
                worktrees: worktreesEnabled(project),
                remoteUpdates: {
                  supported: supportsRemoteWorkerUpdates(platform()),
                  protocol: 1,
                },
                organizationAgentContext: organizationAgentContextCapability,
                workflowRequirements: requirementHealth.map((item) => ({
                  id: item.id,
                  healthy: item.healthy,
                  detail: item.detail,
                })),
              },
            }),
          },
        );
        if (refreshMaintenance) lastServerMaintenanceAt = Date.now();
        let effectiveAcceptingWork = acceptingWork;
        if (heartbeat.updateDirective) {
          effectiveAcceptingWork = false;
          if (heartbeat.updateDirective.handoffState === "failed") {
            // A failed request is retried with the same server request ID.
            // Re-arm the local launcher once the server moves it back to draining.
            lastTriggeredUpdateId = null;
          } else if (
            supportsRemoteWorkerUpdates(platform()) &&
            lastTriggeredUpdateId !== heartbeat.updateDirective.id
          ) {
            lastTriggeredUpdateId = heartbeat.updateDirective.id;
            triggerWorkerUpdate(heartbeat.updateDirective);
            console.log(
              `worker update requested: ${heartbeat.updateDirective.targetVersion}`,
            );
          }
        }
        if (Array.isArray(heartbeat.workflowRequirements)) {
          const previousKey = JSON.stringify(sharedWorkflowRequirements ?? []);
          const nextKey = JSON.stringify(heartbeat.workflowRequirements);
          sharedWorkflowRequirements = heartbeat.workflowRequirements;
          if (previousKey !== nextKey) {
            // Keep the local mirror aligned so desktop health and the next
            // worker restart see the same shared tool list.
            if (project.autoHunt?.workflow) {
              project.autoHunt = {
                ...project.autoHunt,
                workflow: {
                  ...project.autoHunt.workflow,
                  requirements: heartbeat.workflowRequirements,
                },
              };
              config.projects = config.projects.map((candidate) =>
                candidate.id === project.id ? project : candidate,
              );
              await saveConfig(config);
            }
            // Re-probe immediately so a stale empty local list cannot claim
            // work before the next heartbeat interval.
            const refreshedHealth = inspectWorkflowRequirements(
              sharedWorkflowRequirements,
            );
            const refreshedDetail =
              workflowRequirementReadinessDetail(refreshedHealth);
            if (refreshedDetail || !hasHealthyProvider) {
              effectiveAcceptingWork = false;
              await request(
                config.apiUrl,
                `/workers/${workerId}/heartbeat`,
                workerToken,
                {
                  method: "POST",
                  body: JSON.stringify({
                    versions: { briar: cliVersion },
                    acceptingWork: false,
                    readinessState: "needs_attention",
                    readinessDetail: !hasHealthyProvider
                      ? providerHealthReadinessDetail(providerHealth)
                      : refreshedDetail,
                    capabilities: {
                      providers,
                      providerHealth,
                      providerCapabilities,
                      worktrees: worktreesEnabled(project),
                      remoteUpdates: {
                        supported: supportsRemoteWorkerUpdates(platform()),
                        protocol: 1,
                      },
                      organizationAgentContext: organizationAgentContextCapability,
                      workflowRequirements: refreshedHealth.map((item) => ({
                        id: item.id,
                        healthy: item.healthy,
                        detail: item.detail,
                      })),
                    },
                  }),
                },
              );
            }
          }
        }
        return createWorkerLoopHeartbeat({
          acceptingWork: effectiveAcceptingWork,
          maxConcurrentSessions:
            heartbeat.worker.maxConcurrentSessions ??
            registered.maxConcurrentSessions,
          updateDirective: heartbeat.updateDirective,
        });
      },
      handoff: async (issue, requestId, checkpoint) => {
        await workerQueue.handoffWork({
          requestId,
          projectId: project.id,
          workerId,
          work: issue,
          checkpoint,
        });
      },
      runIssue: async (issue, signal, reportCheckpoint) => {
        if (issue.workType === "mergeBatch") {
          const claim = issue;
          await executeClaimedMergeBatch({
            claim,
            workerId,
            repositoryPath: project.repositoryPath,
            signal,
            api: mergeBatchApi,
            renewLease: async () => {
              await workerQueue.renewWorkLease({
                projectId: project.id,
                workerId,
                work: claim,
              });
            },
            releaseLease: async () => {
              await workerQueue.handoffWork({
                requestId: randomUUID(),
                projectId: project.id,
                workerId,
                work: claim,
                checkpoint: {},
              });
            },
          });
          return;
        }
        if (issue.workType === "projectAgentTask") {
          const task = issue;
          await runProjectAgentTaskCompletionFlow({
            runProvider: () => runClaimedProjectAgentTask(
              config,
              project,
              task,
              workerToken,
              workerId,
              signal,
              reportCheckpoint,
            ),
            completeSuccess: (completion) => completeClaimedProjectAgentTask(
              config,
              task,
              workerToken,
              completion,
              signal,
            ),
            completeFailure: async (error) => {
              if (signal.aborted) throw error;
              return failClaimedProjectAgentTask(
                config,
                project,
                task,
                workerToken,
                error,
              );
            },
            isRetryableCompletionError: (error) =>
              !(error instanceof HttpRequestError) ||
              error.status === 408 || error.status === 429 ||
              error.status >= 500,
            sleep: interruptibleSleep,
            signal,
          });
          return;
        }
        if (issue.workType === "channelReply") {
          const reply = issue;
          try {
            await runClaimedChannelReply(
              config,
              project,
              reply,
              workerToken,
              signal,
              reportCheckpoint,
            );
          } catch (error) {
            if (signal.aborted) throw error;
            await failClaimedChannelReply(
              config,
              project,
              reply,
              workerToken,
              error,
            );
          }
          return;
        }
        if (issue.workType === "issueReply") {
          const reply = issue;
          try {
            await runClaimedIssueReply(
              config,
              project,
              reply,
              workerToken,
              signal,
              reportCheckpoint,
            );
          } catch (error) {
            if (signal.aborted) throw error;
            await failClaimedIssueReply(
              config,
              project,
              reply,
              workerToken,
              error,
            );
          }
          return;
        }
        await runClaimedIssue(
          config,
          project,
          issue,
          workerToken,
          signal,
          reportCheckpoint,
        );
      },
      sleep: interruptibleSleep,
      now: () => Date.now(),
      log: (line) => console.log(line),
    },
    {
      once: has("--once"),
      maxConcurrentSessions: registered.maxConcurrentSessions,
      ...(Number.isInteger(maxIssues) && maxIssues > 0 ? { maxIssues } : {}),
    },
  );
  console.log(JSON.stringify(result));
}

export {
  workerRegisterCommand,
  workerUnregisterCommand,
  workerSyncLabelCommand,
  workerCommand,
};
