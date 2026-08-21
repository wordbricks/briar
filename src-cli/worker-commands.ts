
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir, platform, tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import packageJson from "../package.json";
import {
  autoHuntRequirementKinds,
  repositoryWorkflowPendingStageId,
} from "../src/lib/auto-hunt-contract";
import { decodeStructuredAgentResult } from "../src/lib/agent-result";
import {
  agentExecutionCostRecordsFromObservations,
  agentExecutionMetrics,
  agentExecutionTokenUsageFromObservations,
  agentExecutionUsageRecordsFromObservations,
  createAgentExecutionUsageCollector,
} from "../src/lib/agent-execution-metrics";
import type { ModelEffort } from "../src/lib/agent-provider-contract";
import type { AgentProvider } from "../src/lib/agent-provider";
import { validateEvidenceImages } from "../src/lib/evidence-images";
import {
  decodeOrganizationAgentContextRequestTurn,
  organizationAgentContextCapability,
} from "../src/lib/organization-agent-context-contract";
import {
  createDetachedTranscriptSequencer,
  detachedAgentPrompt,
  detachedChannelReplyPrompt,
  detachedChannelReplyOutputSchema,
  detachedIssueReplyPrompt,
  detachedIssueReplyOutputSchema,
  detachedProjectAgentPrompt,
  detachedPayloadDirection,
  detachedProviderBlockedRunEvent,
  detachedProviderBlockFromPayload,
  detachedRunContinuationPrompt,
  detachedRunDisposition,
  detachedRunRecoveryPrompt,
  detachedRunTurnDecision,
  detachedTranscriptPayload,
  detachedTranscriptSessionId,
  parseDetachedIssueReplyResult,
  parseDetachedJsonResult,
  runProjectAgentTaskCompletionFlow,
  shouldPersistDetachedTranscriptPayload,
  type DetachedAgent,
} from "./agent-runner";
import { agentImageAttachments } from "../src-agent/runner-attachments";
import {
  assertDetachedProviderTurnSucceeded,
  detachedProviderTurnFailure,
  runDetachedProviderTurn,
} from "./detached-provider-turn";
import {
  TranscriptBatcher,
  type TranscriptBatchEvent,
} from "./transcript-batcher";
import {
  ChannelActivityPublisher,
  type ChannelActivityCredential,
} from "./channel-activity-publisher";
import {
  HttpRequestError,
  uploadExecutionMetricsWithCostCompatibility,
} from "./execution-metrics-upload";
import {
  inspectWorkflowRequirements,
  workflowRequirementReadinessDetail,
} from "./workflow-requirements";
import {
  createWorkerDeviceIdentity,
  defaultWorkerLabel,
  errorDelayMs,
  issueWorkerSessionDirectory,
  interruptibleSleep,
  restartInstalledServices,
  runWorkerLoop,
  serviceDefinition,
  workerCliPath,
  workerExecutionPath,
  writeServiceDefinition,
  type ClaimedIssue,
  type WorkerExecutionCheckpoint,
} from "./worker";
import {
  claimMergeBatchIfReady,
  executeClaimedMergeBatch,
  inspectMergeQueueDoctor,
  mergeQueueProfileFromResponse,
  releaseMergeBatchClaim,
  renewMergeBatchClaim,
  type MergeBatchApi,
} from "./merge-queue";
import { resolveMergeGroupContainerRuntime } from "./merge-group-validation";
import {
  supportsRemoteWorkerUpdates,
  workerUpdateDeepLink,
  type WorkerUpdateDirective,
} from "./worker-update";
import {
  allocateAnalysisWorktree,
  allocateCachedAnalysisWorktree,
  allocateIssueWorktree,
  analysisWorktreePath,
  defaultWorktreeRoot,
  findExistingIssueWorktree,
  issueReplyWorkspaceMode,
  listCompletedWorktrees,
  listIssueWorktrees,
  maintainIdleAnalysisWorktrees,
  maintainTerminalIssueWorktree,
  markCachedAnalysisWorktreeIdle,
  projectWorktreeRoot,
  recordCompletedWorktree,
  removeAnalysisWorktree,
  removeCompletedWorktreeRecord,
  removeIssueWorktree,
  resolveBaseRef,
  samePath,
  type GitRunner,
  type IssueWorktree,
  type WorktreeSettings,
} from "./worktree";
import {
  sameApiEnvironment,
  selectProjectForApi,
} from "./config-environment";
import {
  channelReplyCompleteRequestBody,
  collectChannelReplyAttachments,
  parseChannelReplyAgentResult,
} from "./channel-reply-attachments";
import {
  channelReplyImageDirectory,
  cleanupChannelReplyImages,
  downloadChannelReplyImages,
} from "./channel-reply-images";
import { cleanupChannelReplyResources } from "./channel-reply-cleanup";
import { assertChannelReplyWorkspaceScope } from "./channel-reply-scope";
import {
  cleanupOrphanedOrganizationAgentWorkspaces,
  cleanupOrganizationAgentContext,
  downloadOrganizationAgentContextManifest,
  hydrateOrganizationAgentContext,
  prepareOrganizationAgentWorkspace,
} from "./organization-agent-context";
import {
  healthyWorkerProviders,
  inspectWorkerProviderHealth,
  providerHealthReadinessDetail,
} from "./provider-health";
import { discoverWorkerProviderCapabilities } from "./provider-capabilities";
import {
  configureBrowserSkillGuide,
  getSkillGuide,
  skillGuides,
} from "./skill-guides";
import {
  briarIssueUrl,
  ensureBriarIssueLinkInGithubPullRequest,
} from "./github-pr";
import {
  configErrorLocations,
  decodeConfig,
  type Config,
  type ProjectConfig,
} from "./config-contract";
import {
  decodeChannelMessagesInput,
  decodeCreateIssueInput,
  decodeDashboardRuns,
  decodeIsoDateTimeWithOffset,
  decodeRunEvidenceInput,
  decodeUuid,
  decodeVelenEnvelope,
  decodeWorkflowStageId,
  decodeWorkspaceMode,
  httpErrorMessage,
  validateRecoveryRunInput,
  validateResumeRunInput,
  validateReworkRunInput,
  validateRunEventInput,
  validateWorkflowTransitionInput,
} from "./command-contract";
import {
  decodeClaimedChannelReply,
  decodeClaimedIssueReply,
  decodeClaimedMergeBatch,
  decodeClaimedProjectAgentTask,
  decodeClaimedRun,
  decodeDetachedAgentEffortOption,
  decodeDetachedAgentSkillsOption,
  decodeQueuedIssue,
  decodeWorkerBinding,
  decodeWorkerRegistration,
  type ClaimedChannelReply,
  type ClaimedIssueReply,
  type ClaimedProjectAgentTask,
  type ClaimedRun,
  type DetachedAgentClaim,
  type DetachedAgentSkill,
  type QueuedAttachment,
  type WorkerRegistration,
} from "./worker-claim-contract";

import {
  configDirectory,
  cliVersion,
  values,
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
      if (existing) {
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
  await request(
    config.apiUrl,
    `/projects/${project.id}/workers/${project.executionWorker.workerId}`,
    userToken,
    { method: "DELETE" },
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

async function workerSyncLabelCommand() {
  const config = await loadConfig();
  const label = defaultWorkerLabel();
  const registrationsByDevice = new Map<
    string,
    Array<{ workerId: string; token: string }>
  >();
  for (const project of config.projects) {
    const registered = project.executionWorker;
    if (!registered) continue;
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
    let lastError: unknown = null;
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
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) failedDevices += 1;
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
  const workerToken = process.env.BRIAR_WORKER_TOKEN ?? registered.token;
  const label = registered.label;
  const workerId = registered.workerId;
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
      const child = spawn(
        "/usr/bin/open",
        [workerUpdateDeepLink(heartbeat.updateDirective)],
        { detached: true, stdio: "ignore" },
      );
      child.unref();
    }
    throw new Error(readinessProblem);
  }

  const maxIssues = Number.parseInt(value("--max-issues") ?? "", 10);
  const mergeGroupRuntimeResolution = resolveMergeGroupContainerRuntime();
  const mergeGroupRuntime = mergeGroupRuntimeResolution.ready
    ? mergeGroupRuntimeResolution
    : null;
  const mergeBatchApi: MergeBatchApi = <T = unknown>(
    path: string,
    init: { method: "POST"; body: string },
  ) => request<T>(config.apiUrl, path, workerToken, init);
  let lastWorktreeSweepAt = Number.NEGATIVE_INFINITY;
  let lastAnalysisWorktreeSweepAt = Number.NEGATIVE_INFINITY;
  let lastTriggeredUpdateId: string | null = null;
  const result = await runWorkerLoop(
    {
      claim: async (_options) => {
        const mergeBatch = await claimMergeBatchIfReady({
          api: mergeBatchApi,
          projectId: project.id,
          workerId,
          claimedBy: label,
          repliesOnly: _options?.repliesOnly === true,
          runtime: mergeGroupRuntime,
        });
        if (mergeBatch) return { work: mergeBatch };
        // The combined API claim is ordered by reply queues first and applies
        // the regular-session limit atomically to issue/task queues. The loop
        // still passes its local reply-only hint without adding a wire-field,
        // keeping this endpoint compatible with older API deployments during
        // rollout.
        const claim = await request<{
          work: unknown;
          retryAfterMs?: number;
        }>(
          config.apiUrl,
          "/worker-claims",
          workerToken,
          {
            method: "POST",
            body: JSON.stringify({
              claimedBy: label,
              workerId,
              projectId: project.id,
            }),
          },
        );
        if (claim.work === null) {
          return { work: null, retryAfterMs: claim.retryAfterMs };
        }
        const workType = typeof claim.work === "object" && claim.work !== null
          ? Reflect.get(claim.work, "workType")
          : undefined;
        const work = workType === "mergeBatch"
          ? decodeClaimedMergeBatch(claim.work)
          : workType === "issueReply"
          ? decodeClaimedIssueReply(claim.work)
          : workType === "projectAgentTask"
            ? decodeClaimedProjectAgentTask(claim.work)
            : workType === "channelReply"
              ? decodeClaimedChannelReply(claim.work)
              : decodeClaimedRun(claim.work);
        return { work };
      },
      renewLease: async (issue) => {
        if (issue.workType === "mergeBatch") {
          await renewMergeBatchClaim(
            mergeBatchApi,
            decodeClaimedMergeBatch(issue),
            workerId,
          );
          return;
        }
        if (issue.workType === "projectAgentTask") {
          const task = decodeClaimedProjectAgentTask(issue);
          await request(
            config.apiUrl,
            `/agent-task-claims/${task.workId}/lease`,
            workerToken,
            {
              method: "POST",
              body: JSON.stringify({
                projectId: project.id,
                workerId,
                claimToken: task.claimToken,
              }),
            },
          );
          return;
        }
        if (issue.workType === "channelReply") {
          const reply = decodeClaimedChannelReply(issue);
          const renewed = await request<{
            leaseExpiresAt: string;
            activity?: ChannelActivityCredential | null;
          }>(
            config.apiUrl,
            `/channel-reply-claims/${reply.workId}/lease`,
            workerToken,
            {
              method: "POST",
              body: JSON.stringify({
                organizationId: reply.organizationId,
                workerId,
                claimToken: reply.claimToken,
              }),
            },
          );
          activeReplyActivityPublishers.get(reply.workId)?.updateCredential(
            renewed.activity ?? null,
          );
          return;
        }
        if (issue.workType === "issueReply") {
          const reply = decodeClaimedIssueReply(issue);
          const renewed = await request<{
            leaseExpiresAt: string;
            activity?: ChannelActivityCredential | null;
          }>(
            config.apiUrl,
            `/issue-reply-claims/${reply.workId}/lease`,
            workerToken,
            {
              method: "POST",
              body: JSON.stringify({
                projectId: project.id,
                workerId,
                claimToken: reply.claimToken,
              }),
            },
          );
          activeReplyActivityPublishers.get(reply.workId)?.updateCredential(
            renewed.activity ?? null,
          );
          return;
        }
        await request(
          config.apiUrl,
          `/runs/${issue.runId}/lease`,
          workerToken,
          {
            method: "POST",
            body: JSON.stringify({
              claimToken: issue.claimToken,
              projectId: project.id,
            }),
          },
        );
      },
      heartbeat: async (readinessState = "ready") => {
        if (Date.now() - lastAnalysisWorktreeSweepAt >= 5 * 60_000) {
          lastAnalysisWorktreeSweepAt = Date.now();
          try {
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
        let effectiveAcceptingWork = acceptingWork;
        if (heartbeat.updateDirective) {
          effectiveAcceptingWork = false;
          if (
            supportsRemoteWorkerUpdates(platform()) &&
            lastTriggeredUpdateId !== heartbeat.updateDirective.id
          ) {
            lastTriggeredUpdateId = heartbeat.updateDirective.id;
            const child = spawn(
              "/usr/bin/open",
              [workerUpdateDeepLink(heartbeat.updateDirective)],
              { detached: true, stdio: "ignore" },
            );
            child.unref();
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
        return {
          acceptingWork: effectiveAcceptingWork,
          maxConcurrentSessions:
            heartbeat.worker.maxConcurrentSessions ??
            registered.maxConcurrentSessions,
        };
      },
      handoff: async (issue, requestId, checkpoint) => {
        if (issue.workType === "mergeBatch") {
          try {
            await releaseMergeBatchClaim(
              mergeBatchApi,
              decodeClaimedMergeBatch(issue),
              workerId,
            );
          } catch (error) {
            // A phase may have completed and atomically released just as the
            // planned update aborted it. A missing old lease is already the
            // safe handoff outcome.
            if (!(error instanceof HttpRequestError) || error.status !== 409) {
              throw error;
            }
          }
          return;
        }
        const workType = issue.workType ?? "issue";
        const workId = issue.workId ?? issue.runId;
        await request(
          config.apiUrl,
          `/workers/${workerId}/update-handoff/claim`,
          workerToken,
          {
            method: "POST",
            body: JSON.stringify({
              requestId,
              projectId: project.id,
              workType,
              workId,
              runId: issue.runId,
              claimToken: issue.claimToken,
              checkpoint: {
                conversationId: checkpoint.conversationId ?? null,
                workspacePath: checkpoint.workspacePath ?? null,
              },
            }),
          },
        );
      },
      runIssue: async (issue, signal, reportCheckpoint) => {
        if (issue.workType === "mergeBatch") {
          if (!mergeGroupRuntime) {
            throw new Error(
              "Merge batch was claimed without an audited local container runtime",
            );
          }
          await executeClaimedMergeBatch({
            claim: decodeClaimedMergeBatch(issue),
            workerId,
            repositoryPath: project.repositoryPath,
            runtime: mergeGroupRuntime,
            signal,
            api: mergeBatchApi,
          });
          return;
        }
        if (issue.workType === "projectAgentTask") {
          const task = decodeClaimedProjectAgentTask(issue);
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
          const reply = decodeClaimedChannelReply(issue);
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
          const reply = decodeClaimedIssueReply(issue);
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
          decodeClaimedRun(issue),
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
      // Planned update drains are delivered through heartbeat. Keep the
      // active Worker below the 30-second handoff budget even while a
      // provider turn is occupying every execution slot.
      heartbeatIntervalMs: 10_000,
      ...(Number.isInteger(maxIssues) && maxIssues > 0 ? { maxIssues } : {}),
    },
  );
  console.log(JSON.stringify(result));
}

async function workerStatus() {
  const config = await loadConfig();
  const project = value("--project")
    ? config.projects.find((candidate) => candidate.id === value("--project"))
    : await currentProject(config);
  if (!project) {
    throw new Error("이 컴퓨터에 연결된 프로젝트를 찾지 못했습니다.");
  }
  const definition = serviceDefinition({
    projectId: project.id,
    briarBinary: process.execPath,
    workingDirectory: project.repositoryPath,
  });
  console.log(
    JSON.stringify(
      {
        projectId: project.id,
        service: definition.label,
        unitPath: definition.path,
        logPath: definition.logPath,
        registered: Boolean(project.executionWorker),
        workerId: project.executionWorker?.workerId ?? null,
        deviceId: project.executionWorker?.deviceId ?? null,
        label: project.executionWorker?.label ?? null,
        maxConcurrentSessions:
          project.executionWorker?.maxConcurrentSessions ?? null,
      },
      null,
      2,
    ),
  );
}

async function workerRestartServices() {
  const config = await loadConfig();
  const projects = config.projects.filter((project) => {
    if (!project.executionWorker) return false;
    const definition = serviceDefinition({
      projectId: project.id,
      briarBinary: process.execPath,
      workingDirectory: project.repositoryPath,
    });
    return existsSync(definition.path);
  });
  const handoffs = new Map<
    string,
    { workerId: string; token: string; requestId: string }
  >();
  for (const project of projects) {
    const registered = project.executionWorker;
    if (!registered || handoffs.has(registered.workerId)) continue;
    const prepared = await request<{
      requestId: string;
      targetVersion: string;
      handoffState: string;
      activeWorkCount: number;
      ready: boolean;
    }>(
      config.apiUrl,
      `/workers/${registered.workerId}/update-handoff/prepare`,
      registered.token,
      {
        method: "POST",
        body: JSON.stringify({ targetVersion: cliVersion }),
      },
    );
    handoffs.set(registered.workerId, {
      workerId: registered.workerId,
      token: registered.token,
      requestId: prepared.requestId,
    });
  }

  const deadline = Date.now() + 30_000;
  while (true) {
    let ready = true;
    for (const handoff of handoffs.values()) {
      const status = await request<{
        handoffState: string;
        activeWorkCount: number;
        ready: boolean;
        handoffError?: string | null;
      }>(
        config.apiUrl,
        `/workers/${handoff.workerId}/update-handoff/status?requestId=${encodeURIComponent(handoff.requestId)}`,
        handoff.token,
      );
      if (status.handoffState === "failed") {
        throw new Error(
          `Worker update handoff failed: ${status.handoffError ?? "unknown reason"}`,
        );
      }
      if (!status.ready || status.activeWorkCount > 0) ready = false;
    }
    if (ready) break;
    if (Date.now() >= deadline) {
      throw new Error(
        "Worker update handoff timed out after 30 seconds; services were not restarted so the old lease remains the safe fallback.",
      );
    }
    await Bun.sleep(500);
  }

  const definitions = config.projects
    .filter((project) => Boolean(project.executionWorker))
    .map((project) =>
      serviceDefinition({
        projectId: project.id,
        briarBinary: process.execPath,
        workingDirectory: project.repositoryPath,
      }),
    );
  const result = restartInstalledServices(definitions, {
    exists: existsSync,
    run: (command) => {
      const spawned = Bun.spawnSync({
        cmd: command,
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        success: spawned.success,
        error: new TextDecoder().decode(spawned.stderr).trim(),
      };
    },
  });
  console.log(JSON.stringify(result));
}

async function workerService(action: "install" | "uninstall") {
  const config = await loadConfig();
  const project = value("--project")
    ? config.projects.find((candidate) => candidate.id === value("--project"))
    : await currentProject(config);
  if (!project) {
    throw new Error("이 컴퓨터에 연결된 프로젝트를 찾지 못했습니다.");
  }
  if (action === "install" && !project.executionWorker) {
    throw new Error(
      "서비스를 설치하기 전에 `briar worker register`를 실행하세요.",
    );
  }
  const briarBinary = value("--briar-binary") ?? process.execPath;
  const runtimeBinary = value("--runtime-binary");
  const cliScript = value("--cli-script");
  const definition = serviceDefinition({
    projectId: project.id,
    briarBinary,
    runtimeBinary,
    cliScript,
    workingDirectory: project.repositoryPath,
  });
  const command =
    action === "install" ? definition.enableCommand : definition.disableCommand;
  if (action === "install") {
    await writeServiceDefinition(definition);
  }
  const argv =
    command[0] === "launchctl"
      ? [...command, definition.path]
      : command;
  const spawned = Bun.spawnSync({ cmd: argv, stdout: "pipe", stderr: "pipe" });
  if (!spawned.success) {
    throw new Error(
      `서비스 ${action === "install" ? "설치" : "제거"}에 실패했습니다: ${new TextDecoder().decode(spawned.stderr).trim()}`,
    );
  }
  console.log(
    JSON.stringify({
      action,
      service: definition.label,
      unitPath: definition.path,
      logPath: definition.logPath,
    }),
  );
}

export {
  workerRegisterCommand,
  workerUnregisterCommand,
  workerSyncLabelCommand,
  workerCommand,
  workerStatus,
  workerRestartServices,
  workerService,
};

