
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
  args,
  value,
  has,
  required,
  loadConfig,
  saveConfig,
  request,
  login,
  gitValue,
  currentRepositoryPath,
  runGit,
  worktreeSettings,
  worktreesEnabled,
  currentProject,
} from "./command-support";

async function createProject() {
  const config = await loadConfig();
  if (!config.userToken) throw new Error("먼저 `briar login`을 실행하세요.");
  const repositoryPath = await currentRepositoryPath();
  const name = value("--name") ?? basename(repositoryPath);
  const result = await request<{
    project: { id: string; name: string };
    agentToken: string;
  }>(config.apiUrl, "/projects", config.userToken, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  config.projects = [
    ...config.projects.filter((project) => project.id !== result.project.id),
    {
      id: result.project.id,
      repositoryPath,
      repositoryRemote: gitValue(["remote", "get-url", "origin"]) ?? undefined,
      agentToken: result.agentToken,
      apiUrl: config.apiUrl,
    },
  ];
  await saveConfig(config);
  console.log(`프로젝트 ${result.project.name}을 연결했습니다.`);
  console.log(`Project ID: ${result.project.id}`);
}

async function connectProject() {
  const config = await loadConfig();
  const projectId = required("--project-id");
  const agentToken = required("--agent-token");
  const repositoryPath = await currentRepositoryPath();
  config.projects = [
    ...config.projects.filter((project) => project.id !== projectId),
    {
      id: projectId,
      repositoryPath,
      repositoryRemote: gitValue(["remote", "get-url", "origin"]) ?? undefined,
      agentToken,
      apiUrl: config.apiUrl,
    },
  ];
  await saveConfig(config);
  console.log(`${repositoryPath}를 Briar 프로젝트 ${projectId}에 연결했습니다.`);
  console.log("저장소 경로와 Agent 토큰은 이 컴퓨터에만 저장됩니다.");
}

const velenExecutable = () =>
  Bun.which("velen") ?? join(homedir(), ".local", "bin", "velen");

function runVelen(commandArgs: string[]) {
  const result = Bun.spawnSync([
    velenExecutable(),
    "--output",
    "json",
    ...commandArgs,
  ], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const message = result.stderr.toString().trim() || result.stdout.toString().trim();
    throw new Error(`Velen CLI 확인 실패: ${message || `exit ${result.exitCode}`}`);
  }
  return decodeVelenEnvelope(JSON.parse(result.stdout.toString()));
}

function ensureConfiguredVelen(project?: ProjectConfig) {
  const configuredOrg = project?.autoHunt?.velenOrg;
  const linearEnabled = project?.autoHunt?.linear?.enabled ?? false;
  if (!configuredOrg) {
    if (linearEnabled) {
      throw new Error("Linear 연동에는 Velen 조직과 Linear source가 필요합니다.");
    }
    if (project?.autoHunt?.dataSource) {
      throw new Error("Velen data source를 사용하려면 Velen 조직을 설정하세요.");
    }
    return null;
  }
  if (!Bun.file(velenExecutable()).size) {
    throw new Error(
      "이 프로젝트에 설정된 Velen CLI 기능을 사용하려면 `bun install -g @wordbricks/velen`으로 CLI를 설치하세요.",
    );
  }
  const auth = runVelen(["auth", "whoami"]);
  const org = runVelen(["--org", configuredOrg, "org", "current"]);
  const linearSource = linearEnabled
    ? project?.autoHunt?.linear?.source
    : undefined;
  if (linearEnabled && !linearSource) {
    throw new Error("Linear 연동이 켜져 있지만 Velen Linear source가 없습니다.");
  }
  const linear = linearSource
    ? runVelen(["--org", configuredOrg!, "source", "show", linearSource])
    : null;
  return { auth, org, linear };
}

function configuredWorkflow(project: ProjectConfig) {
  const workflow = project.autoHunt?.workflow;
  if (
    !workflow ||
    workflow.stages.some((stage) => stage.id === repositoryWorkflowPendingStageId)
  ) {
    throw new Error(
      "저장소 기반 워크플로우가 아직 생성되지 않았습니다. Briar 앱에서 이 저장소 연결을 완료하세요.",
    );
  }
  return workflow;
}

async function configureProject() {
  const allowedOptions = new Set([
    "--velen-org",
    "--disable-velen",
    "--data-source",
    "--enable-linear",
    "--linear-source",
    "--linear-team",
    "--disable-linear",
    "--enable-worktrees",
    "--disable-worktrees",
    "--worktree-root",
    "--branch-prefix",
    "--enable-full-access",
    "--disable-full-access",
    "--i-understand-the-risk",
    "--github-repository",
  ]);
  const unknownOption = args.slice(2).find(
    (argument) => argument.startsWith("--") && !allowedOptions.has(argument),
  );
  if (unknownOption) throw new Error(`알 수 없는 옵션입니다: ${unknownOption}`);
  const config = await loadConfig();
  const project = await currentProject(config);
  const disableVelen = has("--disable-velen");
  const requestedVelenOrg = value("--velen-org");
  if (disableVelen && requestedVelenOrg) {
    throw new Error("--velen-org와 --disable-velen을 함께 쓸 수 없습니다.");
  }
  const velenOrg = disableVelen
    ? undefined
    : requestedVelenOrg ?? project.autoHunt?.velenOrg;
  const linearDisabled = has("--disable-linear");
  const linearSource = value("--linear-source");
  if (!linearDisabled && !linearSource && has("--enable-linear")) {
    throw new Error("--enable-linear requires --linear-source");
  }
  if (has("--enable-worktrees") && has("--disable-worktrees")) {
    throw new Error("--enable-worktrees와 --disable-worktrees를 함께 쓸 수 없습니다.");
  }
  if (has("--enable-full-access") && has("--disable-full-access")) {
    throw new Error("--enable-full-access와 --disable-full-access를 함께 쓸 수 없습니다.");
  }
  // Explicitly re-enabling the default unrestricted mode still requires a
  // deliberate acknowledgement because Auto Hunt input is untrusted.
  if (has("--enable-full-access") && !has("--i-understand-the-risk")) {
    throw new Error(
      "--enable-full-access는 샌드박스를 완전히 해제해 에이전트가 파일시스템 전체에 쓸 수 있게 합니다. 확인을 위해 --i-understand-the-risk를 함께 지정하세요.",
    );
  }
  const nextAutoHunt = {
    ...project.autoHunt,
    velenOrg,
    dataSource: disableVelen
      ? undefined
      : value("--data-source") ?? project.autoHunt?.dataSource,
    githubRepository:
      value("--github-repository") ?? project.autoHunt?.githubRepository,
    linear: linearDisabled || disableVelen
      ? { enabled: false }
      : linearSource
        ? {
            enabled: true,
            source: linearSource,
            teamKey: value("--linear-team") ?? project.autoHunt?.linear?.teamKey,
          }
        : (project.autoHunt?.linear ?? { enabled: false }),
    workflow: configuredWorkflow(project),
    worktrees: {
      ...project.autoHunt?.worktrees,
      ...(has("--disable-worktrees") ? { enabled: false } : {}),
      ...(has("--enable-worktrees") ? { enabled: true } : {}),
      ...(value("--worktree-root") ? { root: resolve(required("--worktree-root")) } : {}),
      ...(value("--branch-prefix") ? { branchPrefix: required("--branch-prefix") } : {}),
    },
    sandbox: {
      ...project.autoHunt?.sandbox,
      ...(has("--enable-full-access") ? { fullAccess: true } : {}),
      ...(has("--disable-full-access") ? { fullAccess: false } : {}),
    },
  };
  const nextProject = {
    ...project,
    repositoryRemote:
      gitValue(["remote", "get-url", "origin"]) ?? project.repositoryRemote,
    autoHunt: nextAutoHunt,
  };
  ensureConfiguredVelen(nextProject);
  config.projects = config.projects.map((candidate) =>
    candidate.id === project.id ? nextProject : candidate,
  );
  await saveConfig(config);

  if (config.userToken) {
    await request(config.apiUrl, `/projects/${project.id}/settings`, config.userToken, {
      method: "PUT",
      body: JSON.stringify({
        velenOrg: velenOrg ?? null,
        dataSource: nextAutoHunt.dataSource ?? null,
        linear: {
          enabled: nextAutoHunt.linear?.enabled ?? false,
          source: nextAutoHunt.linear?.source ?? null,
          teamKey: nextAutoHunt.linear?.teamKey ?? null,
        },
        githubRepository: nextAutoHunt.githubRepository ?? null,
        workflow: nextAutoHunt.workflow,
      }),
    });
  }
  console.log(
    JSON.stringify({
      projectId: project.id,
      velenOrg: velenOrg ?? null,
      linearEnabled: nextAutoHunt.linear?.enabled ?? false,
      linearSource: nextAutoHunt.linear?.source ?? null,
      fullAccess: nextAutoHunt.sandbox?.fullAccess ?? true,
    }),
  );
}

async function projectDoctor() {
  const config = await loadConfig();
  const project = await currentProject(config);
  let velen: ReturnType<typeof ensureConfiguredVelen> = null;
  let velenError: string | null = null;
  try {
    velen = ensureConfiguredVelen(project);
  } catch (error) {
    velenError = error instanceof Error ? error.message : String(error);
  }
  console.log(
    JSON.stringify({
      ok: true,
      projectId: project.id,
      repositoryPath: project.repositoryPath,
      velenOrg: project.autoHunt?.velenOrg ?? null,
      linearEnabled: project.autoHunt?.linear?.enabled ?? false,
      linearSource: project.autoHunt?.linear?.source ?? null,
      dataSource: project.autoHunt?.dataSource ?? null,
      workflow: configuredWorkflow(project),
      worktrees: {
        enabled: worktreesEnabled(project),
        root: projectWorktreeRoot(worktreeSettings(project).root, project.id),
        branchPrefix: worktreeSettings(project).branchPrefix,
        // null means no origin/HEAD and no main/master: allocation would fail.
        baseRef: resolveBaseRef(runGit, project.repositoryPath),
      },
      sandbox: {
        // true is the default; false opts into checkout/worktree-confined writes.
        fullAccess: project.autoHunt?.sandbox?.fullAccess ?? true,
      },
      velenHealthy: velenError === null,
      velenError,
      requestIds: [velen?.auth.requestId, velen?.org.requestId, velen?.linear?.requestId].filter(
        Boolean,
      ),
    }),
  );
}

async function showWorkflow() {
  const config = await loadConfig();
  const project = await currentProject(config);
  console.log(
    JSON.stringify({
      projectId: project.id,
      workflow: configuredWorkflow(project),
    }),
  );
}

export {
  createProject,
  connectProject,
  velenExecutable,
  runVelen,
  ensureConfiguredVelen,
  configuredWorkflow,
  configureProject,
  projectDoctor,
  showWorkflow,
};

