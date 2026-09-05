import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { platform } from "node:os";
import { join, resolve } from "node:path";
import { unlink } from "node:fs/promises";
import { CONTRACTS_DESCRIPTOR_FINGERPRINT } from "@briar/contracts/descriptor-fingerprint";
import { buildComputerUseArgs } from "@briar/agent-exec";
import { Code, ConnectError } from "@connectrpc/connect";
import { autoHuntRequirementKinds } from "../src/lib/auto-hunt-contract";
import { runProjectAgentTaskCompletionFlow } from "./agent-runner";
import { detachedProviderBlockOf } from "./detached-provider-turn";
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
  type WorkerLoopUpdateDirective,
} from "./worker";
import { executeClaimedMergeBatch } from "./merge-queue";
import {
  supportsRemoteWorkerUpdates,
  workerUpdateLaunch,
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
  createWorkerControlClient,
  createWorkerEnrollmentClient,
  type WorkerRuntimeInput,
} from "./worker-control-client";
import {
  createWorkerQueueClient,
  createWorkerQueueOperations,
} from "./worker-queue-client";
import type { ClaimedWork } from "./worker-queue-contract";
import {
  configDirectory,
  cliVersion,
  value,
  has,
  loadConfig,
  saveConfig,
  login,
  gitValueAt,
  runGit,
  worktreeSettings,
  worktreesEnabled,
  currentProject,
  openCodeUpstreamConfigured,
  providerExecutionEnvironment,
} from "./command-support";
import {
  type Config,
  enabledAgentProviders,
  type TeamConfig,
} from "./config-contract";
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
  runClaimedIssueReply,
  failClaimedIssueReply,
  runClaimedChannelReply,
  failClaimedChannelReply,
} from "./reply-execution";
import { loadManagedComputerCredential } from "./managed-computer-credential";
import { runClaimedDmMemory } from "./dm-memory-learning";
import { runDetachedProviderTurn } from "./detached-provider-turn";
import { prepareReadOnlyAgentEnvironment } from "./read-only-agent-environment";
import { ComputerUseBoxClient } from "./computer-use-box-client";
import { defaultComputerUseScreenshotDirectory } from "./computer-use-native-executor";
import { supportsComputerUseProvider } from
  "../src/lib/computer-use-contract";

const WORKER_SERVER_MAINTENANCE_INTERVAL_MS = 5 * 60_000;
const COMPUTER_USE_CANARY_MAX_AGE_MS = 5 * 60_000;
const COMPUTER_USE_CANARY_RETRY_MS = 30_000;

let computerUseCanary:
  | { readonly checkedAt: number; readonly ready: boolean }
  | undefined;
let computerUseCanaryPromise: Promise<boolean> | undefined;

const retryableCompletionCodes = new Set([
  Code.DeadlineExceeded,
  Code.ResourceExhausted,
  Code.Internal,
  Code.Unavailable,
]);

const isRetryableWorkerCompletionError = (error: unknown) =>
  !(error instanceof ConnectError) || retryableCompletionCodes.has(error.code);

const isMissingWorkerError = (error: unknown) =>
  error instanceof ConnectError && error.code === Code.NotFound;

const workerRuntime = (input: {
  agentProvider: WorkerRuntimeInput["agentProvider"];
  providerHealth: WorkerRuntimeInput["providerHealth"];
  providerCapabilities: WorkerRuntimeInput["providerCapabilities"];
  worktrees: boolean;
  workflowRequirements?: WorkerRuntimeInput["workflowRequirements"];
  dmMemoryLearning: WorkerRuntimeInput["dmMemoryLearning"];
  computerUse?: WorkerRuntimeInput["computerUse"];
}): WorkerRuntimeInput => ({
  ...input,
  versions: { briar: cliVersion },
  remoteUpdates: {
    supported: supportsRemoteWorkerUpdates(platform()),
    protocol: 1,
  },
});

const dmMemoryLearningCapability = (
  providers: ReturnType<typeof healthyWorkerProviders>,
  hasOpenRouterKey: boolean,
): NonNullable<WorkerRuntimeInput["dmMemoryLearning"]> => ({
  protocol: 2,
  transports: ["agent", ...(hasOpenRouterKey ? ["openrouter" as const] : [])],
  providers,
});

const runComputerUseCanary = async (): Promise<boolean> => {
  const client = await ComputerUseBoxClient.connect();
  const assigned = await client.assign("briar-capability-canary");
  let screenshotPath: string | undefined;
  try {
    const result = await assigned.executor.execute(buildComputerUseArgs({
      raw: { action: "screenshot" },
      toolCallId: `capability-${randomUUID()}`,
      viewport: { width: 1_280, height: 720 },
      bindUnmappedCharacters: true,
    }), { signal: AbortSignal.timeout(35_000) });
    screenshotPath = result.result.value?.screenshotPath;
    if (result.result.case !== "success") return false;
    const screenshot = result.result.value.screenshot;
    return screenshot !== undefined
      && Buffer.from(screenshot, "base64").subarray(0, 8).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
  } finally {
    if (
      screenshotPath?.startsWith(`${defaultComputerUseScreenshotDirectory}/`)
    ) {
      await unlink(screenshotPath).catch(() => undefined);
    }
    await assigned.release().catch(() => undefined);
  }
};

const computerUseCanaryReady = async (): Promise<boolean> => {
  const now = Date.now();
  const maxAge = computerUseCanary?.ready
    ? COMPUTER_USE_CANARY_MAX_AGE_MS
    : COMPUTER_USE_CANARY_RETRY_MS;
  if (
    computerUseCanary !== undefined
    && now - computerUseCanary.checkedAt < maxAge
  ) return computerUseCanary.ready;
  if (!computerUseCanaryPromise) {
    computerUseCanaryPromise = runComputerUseCanary()
      .catch(() => false)
      .then((ready) => {
        computerUseCanary = { checkedAt: Date.now(), ready };
        return ready;
      })
      .finally(() => {
        computerUseCanaryPromise = undefined;
      });
  }
  return computerUseCanaryPromise;
};

const inspectComputerUseCapability = async (
  config: Awaited<ReturnType<typeof loadConfig>>,
  providers: ReturnType<typeof healthyWorkerProviders>,
): Promise<WorkerRuntimeInput["computerUse"]> => {
  const computerUseProviders = providers.filter(supportsComputerUseProvider);
  if (!config.managedComputer || computerUseProviders.length === 0) {
    return undefined;
  }
  const mcpServerPath = [
    resolve(import.meta.dir, "agent/computer-use-mcp-server.js"),
    resolve(import.meta.dir, "../dist-agent/computer-use-mcp-server.js"),
  ].find((path) => Bun.file(path).size > 0);
  if (!mcpServerPath) return undefined;
  try {
    const response = await fetch("http://127.0.0.1:1337/healthz", {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return undefined;
    const health = await response.json() as Record<string, unknown>;
    if (
      health.ok !== true
      || health.computerUseSupported !== true
      || health.resource !== "computerUse"
    ) return undefined;
    if (!(await computerUseCanaryReady())) return undefined;
  } catch {
    return undefined;
  }
  return {
    protocol: 1,
    transport: "connectrpc-resource-exec",
    providers: computerUseProviders,
    maxWindows: 99,
    sharedDesktop: true,
    humanTakeover: true,
    schemaDigest: Buffer.from(CONTRACTS_DESCRIPTOR_FINGERPRINT).toString("hex"),
  };
};

export type ProjectWorkerRegistration = {
  projectId: string;
  organizationId: string;
  deviceId: string;
  workerId: string;
  label: string;
  maxConcurrentSessions: number;
  state: string;
};

/**
 * Register (or re-bind) this machine as the execution worker of `project`
 * and persist the resulting credential in `config`. Shared by the
 * interactive `briar worker register` command and headless bootstraps such as
 * the Docker sandbox, which register every project in one pass.
 */
export async function registerProjectExecutionWorker(input: {
  config: Config;
  project: TeamConfig;
  userToken: string;
  label: string;
  maxConcurrentSessions?: number;
}): Promise<ProjectWorkerRegistration> {
  const { config, project, label } = input;
  const deviceIdentity =
    config.workerDeviceIdentity ?? createWorkerDeviceIdentity();
  const configuredProvider = project.llm?.provider ?? "codex";
  const providerHealth = await inspectWorkerProviderHealth(
    enabledAgentProviders(config),
    {
      upstreamConfigured: (provider) =>
        openCodeUpstreamConfigured(config, provider),
    },
  );
  const providerCapabilities = await discoverWorkerProviderCapabilities(
    enabledAgentProviders(config),
    { refresh: true },
  );
  const providers = healthyWorkerProviders(providerHealth);
  const computerUse = await inspectComputerUseCapability(config, providers);
  const provider = providers.includes(configuredProvider)
    ? configuredProvider
    : (providers[0] ?? configuredProvider);
  const runtime = workerRuntime({
    agentProvider: provider,
    providerHealth,
    providerCapabilities,
    worktrees: true,
    dmMemoryLearning: dmMemoryLearningCapability(
      providers,
      openCodeUpstreamConfigured(config, "openrouter"),
    ),
    computerUse,
  });
  const enrollment = createWorkerEnrollmentClient(config.apiUrl, input.userToken);
  let registration: Awaited<ReturnType<typeof enrollment.register>> | null = null;
  if (config.teams.some((candidate) => candidate.executionWorker)) {
    try {
      const binding = await enrollment.bind({
        projectId: project.id,
        deviceIdentity,
        runtime,
      });
      const existing = config.teams.find(
        (candidate) => candidate.executionWorker?.deviceId === binding.deviceId,
      )?.executionWorker;
      if (existing?.token) {
        registration = {
          ...binding,
          workerToken: existing.token,
        };
      }
    } catch (error) {
      if (!(error instanceof ConnectError) || error.code !== Code.FailedPrecondition) {
        throw error;
      }
      // The device is not enrolled in this organization yet. Registration
      // below creates it and issues the first organization credential.
    }
  }
  registration ??= await enrollment.register({
    projectId: project.id,
    label,
    deviceIdentity,
    runtime,
    ...(Number.isInteger(input.maxConcurrentSessions) &&
        (input.maxConcurrentSessions ?? 0) > 0
      ? { maxConcurrentSessions: input.maxConcurrentSessions }
      : {}),
  });
  const resolved = registration;
  config.workerDeviceIdentity = deviceIdentity;
  config.teams = config.teams.map((candidate) => {
    if (
      candidate.id !== project.id &&
      candidate.executionWorker?.deviceId !== resolved.deviceId
    ) {
      return candidate;
    }
    return {
      ...candidate,
      executionWorker: {
        deviceId: resolved.deviceId,
        workerId:
          candidate.id === project.id
            ? resolved.worker.id
            : candidate.executionWorker!.workerId,
        organizationId: resolved.organizationId,
        token: resolved.workerToken,
        label,
        maxConcurrentSessions: resolved.worker.maxConcurrentSessions,
      },
    };
  });
  await saveConfig(config);
  return {
    projectId: project.id,
    organizationId: resolved.organizationId,
    deviceId: resolved.deviceId,
    workerId: resolved.worker.id,
    label,
    maxConcurrentSessions: resolved.worker.maxConcurrentSessions,
    state: resolved.worker.state,
  };
}

async function workerRegisterCommand() {
  const config = await loadConfig();
  const userToken = process.env.BRIAR_USER_TOKEN ?? config.userToken;
  if (!userToken) throw new Error("먼저 `briar login`을 실행하세요.");
  const requestedProjectId = value("--team");
  const project = requestedProjectId
    ? config.teams.find((candidate) => candidate.id === requestedProjectId)
    : await currentProject(config);
  if (!project) {
    throw new Error("이 컴퓨터에 연결된 팀을 찾지 못했습니다.");
  }
  const requestedMaxSessions = Number.parseInt(
    value("--max-sessions") ?? "",
    10,
  );
  const registration = await registerProjectExecutionWorker({
    config,
    project,
    userToken,
    label: value("--label") ?? defaultWorkerLabel(),
    ...(Number.isInteger(requestedMaxSessions) && requestedMaxSessions > 0
      ? { maxConcurrentSessions: requestedMaxSessions }
      : {}),
  });
  console.log(JSON.stringify(registration));
}

async function workerUnregisterCommand() {
  const config = await loadConfig();
  const userToken = process.env.BRIAR_USER_TOKEN ?? config.userToken;
  if (!userToken) throw new Error("먼저 `briar login`을 실행하세요.");
  const requestedProjectId = value("--team");
  const project = requestedProjectId
    ? config.teams.find((candidate) => candidate.id === requestedProjectId)
    : await currentProject(config);
  if (!project?.executionWorker) {
    throw new Error("이 팀에 등록된 worker가 없습니다.");
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
  const result = await unregisterTeamExecutionWorker({
    config,
    team: project,
    userToken,
    reason: lifecycleReason,
  });
  console.log(JSON.stringify(result));
}

/**
 * Unbind this device's execution worker from `team` and drop the local
 * credential. A worker already removed remotely counts as unbound so the
 * device can be registered again. Shared by `briar worker unregister` and
 * the sandbox teardown.
 */
export async function unregisterTeamExecutionWorker(input: {
  config: Config;
  team: TeamConfig;
  userToken: string;
  reason: "explicit_user_unlink" | "managed_deprovision";
}) {
  const { config, team } = input;
  const worker = team.executionWorker;
  if (!worker) throw new Error("이 팀에 등록된 worker가 없습니다.");
  try {
    await createWorkerEnrollmentClient(config.apiUrl, input.userToken).unbind({
      projectId: team.id,
      workerId: worker.workerId,
      requestId: `worker-unlink:${team.id}:${worker.workerId}`,
      reason: input.reason,
    });
  } catch (error) {
    if (!isMissingWorkerError(error)) throw error;
    // The local config can outlive a worker that was removed remotely. Treat
    // that state as already unbound so the user can register the device again.
  }
  config.teams = config.teams.map((candidate) =>
    candidate.id === team.id
      ? { ...candidate, executionWorker: undefined }
      : candidate,
  );
  await saveConfig(config);
  return {
    deviceId: worker.deviceId,
    projectId: team.id,
    workerId: worker.workerId,
    state: "unbound" as const,
  };
}

interface WorkerLabelSyncFailure {
  error: unknown;
}

type WorkflowRequirementRecord = {
  id: string;
  label: string;
  kind: (typeof autoHuntRequirementKinds)[number];
  tool: string;
  reason: string;
};

// The long-running worker loop loads its config once at startup and can stay
// up for hours, so it must never persist that stale in-memory snapshot back
// to disk (that would clobber settings changed elsewhere in the meantime,
// e.g. a provider toggled in the desktop app). Re-read the current config
// immediately before writing and patch only this project's workflow
// requirements, leaving everything else on disk untouched.
async function persistProjectWorkflowRequirements(
  projectId: string,
  requirements: WorkflowRequirementRecord[],
) {
  const freshConfig = await loadConfig();
  const freshProject = freshConfig.teams.find(
    (candidate) => candidate.id === projectId,
  );
  if (!freshProject?.autoHunt?.workflow) return;
  const updatedProject = {
    ...freshProject,
    autoHunt: {
      ...freshProject.autoHunt,
      workflow: { ...freshProject.autoHunt.workflow, requirements },
    },
  };
  freshConfig.teams = freshConfig.teams.map((candidate) =>
    candidate.id === projectId ? updatedProject : candidate,
  );
  await saveConfig(freshConfig);
}

async function workerSyncLabelCommand() {
  const config = await loadConfig();
  const label = defaultWorkerLabel();
  const registrationsByDevice = new Map<
    string,
    Array<{ workerId: string; token: string }>
  >();
  for (const project of config.teams) {
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
        await createWorkerControlClient(
          config.apiUrl,
          registration.token,
        ).updateLabel(registration.workerId, label);
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
    config.teams = config.teams.map((project) => {
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
  const projectId = value("--team");
  const project = projectId
    ? config.teams.find((candidate) => candidate.id === projectId)
    : await currentProject(config);
  if (!project) {
    throw new Error("이 컴퓨터에 연결된 팀을 찾지 못했습니다.");
  }
  const registered = project.executionWorker;
  if (!registered) {
    throw new Error(
      "이 팀의 worker가 등록되지 않았습니다. `briar worker register`를 먼저 실행하세요.",
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
  const workerControl = createWorkerControlClient(config.apiUrl, workerToken);
  const label = registered.label;
  const workerId = registered.workerId;
  const triggerWorkerUpdate = (directive: WorkerLoopUpdateDirective) => {
    if (directive.handoffState === "failed") return;
    const launch = workerUpdateLaunch(directive, workerId);
    const child = spawn(launch.command, launch.args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  };
  let sharedWorkflowRequirements: WorkflowRequirementRecord[] | null =
    project.autoHunt?.workflow?.requirements ?? null;
  const readinessProblem = !gitValueAt(project.repositoryPath, [
    "rev-parse",
    "--show-toplevel",
  ])
    ? "연결된 저장소를 열 수 없습니다."
    : null;
  console.log(`worker ${label} starting as ${workerId}`);

  if (readinessProblem) {
    const providerHealth = await inspectWorkerProviderHealth(
      enabledAgentProviders(config),
      {
        upstreamConfigured: (provider) =>
          openCodeUpstreamConfigured(config, provider),
      },
    );
    const providerCapabilities = await discoverWorkerProviderCapabilities(
      enabledAgentProviders(config),
    );
    const providers = healthyWorkerProviders(providerHealth);
    const computerUse = await inspectComputerUseCapability(config, providers);
    const configuredProvider = project.llm?.provider ?? "codex";
    const heartbeat = await workerControl.heartbeat({
      workerId,
      runtime: workerRuntime({
        agentProvider: providers.includes(configuredProvider)
          ? configuredProvider
          : (providers[0] ?? configuredProvider),
        providerHealth,
        providerCapabilities,
        worktrees: true,
        dmMemoryLearning: dmMemoryLearningCapability(
          providers,
          openCodeUpstreamConfigured(config, "openrouter"),
        ),
        computerUse,
      }),
      acceptingWork: false,
      readinessState: "needs_attention",
      readinessDetail: readinessProblem,
    });
    if (
      heartbeat.updateDirective &&
      supportsRemoteWorkerUpdates(platform())
    ) {
      triggerWorkerUpdate(heartbeat.updateDirective);
    }
    throw new Error(readinessProblem);
  }

  const maxIssues = Number.parseInt(value("--max-issues") ?? "", 10);
  const workerQueueClient = createWorkerQueueClient(config.apiUrl, workerToken);
  const workerQueue = createWorkerQueueOperations(workerQueueClient);
  let lastWorktreeSweepAt = Number.NEGATIVE_INFINITY;
  let lastAnalysisWorktreeSweepAt = Number.NEGATIVE_INFINITY;
  let lastServerMaintenanceAt = Number.NEGATIVE_INFINITY;
  let lastTriggeredUpdateId: string | null = null;
  const result = await runWorkerLoop<ClaimedWork>(
    {
      claim: async (_options) => workerQueue.claimWork({
          organizationId: registered.organizationId,
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
          enabledAgentProviders(config),
          {
            upstreamConfigured: (provider) =>
              openCodeUpstreamConfigured(config, provider),
          },
        );
        const providerCapabilities = await discoverWorkerProviderCapabilities(
          enabledAgentProviders(config),
        );
        const providers = healthyWorkerProviders(providerHealth);
        const computerUse = await inspectComputerUseCapability(
          config,
          providers,
        );
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
        const configuredProvider = project.llm?.provider ?? "codex";
        const heartbeat = await workerControl.heartbeat({
          workerId,
          runtime: workerRuntime({
            agentProvider: providers.includes(configuredProvider)
              ? configuredProvider
              : (providers[0] ?? configuredProvider),
            providerHealth,
            providerCapabilities,
            worktrees: worktreesEnabled(project),
            workflowRequirements: requirementHealth.map((item) => ({
              id: item.id,
              healthy: item.healthy,
              detail: item.detail,
            })),
            dmMemoryLearning: dmMemoryLearningCapability(
              providers,
              openCodeUpstreamConfigured(config, "openrouter"),
            ),
            computerUse,
          }),
          refreshMaintenance,
          acceptingWork,
          readinessState: nextReadinessState,
          readinessDetail: nextReadinessDetail,
        });
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
        if (heartbeat.workflowRequirements) {
          const previousKey = JSON.stringify(sharedWorkflowRequirements ?? []);
          const nextKey = JSON.stringify(heartbeat.workflowRequirements);
          sharedWorkflowRequirements = heartbeat.workflowRequirements;
          if (previousKey !== nextKey) {
            // Keep the local mirror aligned so desktop health and the next
            // worker restart see the same shared tool list.
            await persistProjectWorkflowRequirements(
              project.id,
              heartbeat.workflowRequirements,
            );
            // Re-probe immediately so a stale empty local list cannot claim
            // work before the next heartbeat interval.
            const refreshedHealth = inspectWorkflowRequirements(
              sharedWorkflowRequirements,
            );
            const refreshedDetail =
              workflowRequirementReadinessDetail(refreshedHealth);
            if (refreshedDetail || !hasHealthyProvider) {
              effectiveAcceptingWork = false;
              await workerControl.heartbeat({
                workerId,
                runtime: workerRuntime({
                  agentProvider: providers.includes(configuredProvider)
                    ? configuredProvider
                    : (providers[0] ?? configuredProvider),
                  providerHealth,
                  providerCapabilities,
                  worktrees: worktreesEnabled(project),
                  workflowRequirements: refreshedHealth.map((item) => ({
                    id: item.id,
                    healthy: item.healthy,
                    detail: item.detail,
                  })),
                  dmMemoryLearning: dmMemoryLearningCapability(
                    providers,
                    openCodeUpstreamConfigured(config, "openrouter"),
                  ),
                  computerUse,
                }),
                acceptingWork: false,
                readinessState: "needs_attention",
                readinessDetail: !hasHealthyProvider
                  ? providerHealthReadinessDetail(providerHealth)
                  : refreshedDetail,
              });
            }
          }
        }
        return createWorkerLoopHeartbeat({
          acceptingWork: effectiveAcceptingWork,
          maxConcurrentSessions:
            heartbeat.maxConcurrentSessions ??
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
        if (issue.workType === "dmMemory") {
          await runClaimedDmMemory({
            rpc: workerQueueClient,
            projectId: project.id,
            claim: issue,
            apiKey: config.openrouterApiKey ?? null,
            signal,
            agentEnvironment: (provider) =>
              providerExecutionEnvironment(config, provider, process.env),
            runAgentTurn: runDetachedProviderTurn,
            prepareAgentEnvironment: prepareReadOnlyAgentEnvironment,
          });
          return;
        }
        if (issue.workType === "mergeBatch") {
          const claim = issue;
          await executeClaimedMergeBatch({
            claim,
            workerId,
            repositoryPath: project.repositoryPath,
            signal,
            rpc: workerQueueClient,
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
            completeSuccess: (completion) =>
              workerQueue.completeProjectAgentTask({
                projectId: project.id,
                workerId,
                work: task,
                result: {
                  case: "success",
                  summary: completion.summary,
                  conversationId: completion.conversationId,
                },
                signal,
              }),
            completeFailure: async (error) => {
              if (signal.aborted) throw error;
              const block = detachedProviderBlockOf(error);
              return workerQueue.completeProjectAgentTask({
                projectId: project.id,
                workerId,
                work: task,
                result: {
                  case: "failure",
                  error: error instanceof Error ? error.message : String(error),
                  ...(block ? { block } : {}),
                },
              });
            },
            isRetryableCompletionError: isRetryableWorkerCompletionError,
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
