#!/usr/bin/env bun

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
  supportsRemoteWorkerUpdates,
  workerUpdateDeepLink,
  type WorkerUpdateDirective,
} from "./worker-update";
import {
  allocateAnalysisWorktree,
  allocateCachedAnalysisWorktree,
  allocateIssueWorktree,
  allocateMergeGroupWorktree,
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
  assertLiveMergeGroupSha,
  inspectAndEnqueueMember,
  mergeGroupContainingAllMembers,
  parseMergeGroupRefs,
  publishCommitStatus,
  verifyNativeMergeQueue,
  type CommandRunner as MergeQueueCommandRunner,
} from "./merge-queue";
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
  type ClaimedMergeBatch,
  type ClaimedProjectAgentTask,
  type ClaimedRun,
  type DetachedAgentClaim,
  type DetachedAgentSkill,
  type QueuedAttachment,
  type WorkerRegistration,
} from "./worker-claim-contract";

const openRouterOpenCodeConfig = JSON.stringify({
  provider: {
    openrouter: { options: { apiKey: "{env:OPENROUTER_API_KEY}" } },
  },
});

function providerExecutionEnvironment(
  config: Config,
  provider: AgentProvider,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const browserEnvironment = {
    ...environment,
    BRIAR_BROWSER_AUTOMATION_PROVIDER:
      config.appSettings.browserAutomationProvider,
  };
  if (provider !== "openrouter") return browserEnvironment;
  const apiKey = config.openrouterApiKey?.trim();
  if (!apiKey) {
    throw new Error("앱 설정에서 OpenRouter API 키를 먼저 저장하세요.");
  }
  return {
    ...browserEnvironment,
    OPENROUTER_API_KEY: apiKey,
    OPENCODE_CONFIG_CONTENT: openRouterOpenCodeConfig,
  };
}
const executionToken = (project: ProjectConfig) =>
  process.env.BRIAR_WORKER_TOKEN ??
  process.env.BRIAR_AGENT_TOKEN ??
  project.agentToken;
const configuredConfigDirectory = process.env.BRIAR_CONFIG_HOME?.trim();
if (configuredConfigDirectory && !isAbsolute(configuredConfigDirectory)) {
  throw new Error("BRIAR_CONFIG_HOME must be an absolute path");
}
const configDirectory =
  configuredConfigDirectory || join(homedir(), ".config", "briar");
const configPath = join(configDirectory, "config.json");
const defaultApiUrl = process.env.BRIAR_API_URL ?? "http://127.0.0.1:8787";
const cliVersion = packageJson.version;

const args = process.argv.slice(2);
const values = (name: string) =>
  args.flatMap((argument, index) =>
    argument === name && args[index + 1] ? [args[index + 1]] : [],
  );
const value = (name: string) => values(name).at(-1);
const has = (name: string) => args.includes(name);
const required = (name: string) => {
  const result = value(name);
  if (!result) throw new Error(`${name} is required`);
  return result;
};

async function loadConfig(): Promise<Config> {
  let contents: string;
  try {
    contents = await readFile(configPath, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {
        apiUrl: defaultApiUrl,
        agentProviders: {
          codex: true,
          claude: true,
          cursor: true,
          grok: true,
          agy: true,
          opencode: true,
          openrouter: true,
        },
        appSettings: {
          preventSleepWhileRunning: false,
          browserAutomationProvider: "ego-browser",
        },
        projects: [],
      };
    }
    throw new Error(
      `Briar 로컬 설정을 읽지 못했습니다: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let storedConfig: unknown;
  try {
    storedConfig = JSON.parse(contents);
  } catch {
    throw new Error("Briar 로컬 설정이 올바른 JSON이 아닙니다.");
  }
  let config: Config;
  try {
    config = decodeConfig(storedConfig);
  } catch (error) {
    const locations = configErrorLocations(error);
    throw new Error(
      `Briar 로컬 설정이 손상되었습니다: ${locations.join(", ")} 항목을 확인하세요.`,
    );
  }

  const apiUrl = process.env.BRIAR_API_URL ?? config.apiUrl;
  return {
    ...config,
    apiUrl,
    userToken: sameApiEnvironment(apiUrl, config.apiUrl)
      ? config.userToken
      : undefined,
  };
}

async function saveConfig(config: Config) {
  await saveConfigAt(configDirectory, config);
}

async function saveConfigAt(directory: string, config: Config) {
  const path = join(directory, "config.json");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

async function request<T>(
  apiUrl: string,
  path: string,
  token: string | null,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${apiUrl.replace(/\/$/u, "")}${path}`, {
    ...init,
    headers,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new HttpRequestError(
      httpErrorMessage(body) ||
        `request failed (${response.status})`,
      response.status,
      body,
    );
  }
  return body as T;
}

const serializeTranscriptRequest = (
  envelope: Record<string, unknown>,
  events: TranscriptBatchEvent[],
) => JSON.stringify({ ...envelope, events });

const isTranscriptPayloadTooLarge = (error: unknown) =>
  error instanceof HttpRequestError && error.status === 413;

async function openBrowser(url: string) {
  const command =
    platform() === "darwin"
      ? ["open", url]
      : platform() === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  const process = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
  await process.exited;
}

async function login() {
  const config = await loadConfig();
  const code = await request<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    interval?: number;
  }>(config.apiUrl, "/api/auth/device/code", null, {
    method: "POST",
    body: JSON.stringify({ client_id: "briar-cli", scope: "openid profile email" }),
  });
  console.log(`Briar 로그인 코드: ${code.user_code}`);
  console.log("시스템 브라우저에서 로그인하고 기기 승인을 완료하세요.");
  await openBrowser(code.verification_uri_complete ?? code.verification_uri);

  let interval = (code.interval ?? 5) * 1_000;
  for (;;) {
    await Bun.sleep(interval);
    try {
      const token = await request<{ access_token?: string }>(
        config.apiUrl,
        "/api/auth/device/token",
        null,
        {
          method: "POST",
          body: JSON.stringify({
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: code.device_code,
            client_id: "briar-cli",
          }),
        },
      );
      if (!token.access_token) continue;
      config.userToken = token.access_token;
      await saveConfig(config);
      const me = await request<{ user: { name: string; email: string } }>(
        config.apiUrl,
        "/me",
        token.access_token,
      );
      console.log(`${me.user.name} (${me.user.email}) 계정으로 로그인했습니다.`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error);
      if (message.includes("pending")) continue;
      if (message.includes("slow")) {
        interval += 5_000;
        continue;
      }
      throw error;
    }
  }
}

function gitValueAt(cwd: string, gitArgs: string[]) {
  const result = Bun.spawnSync(["git", ...gitArgs], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
  });
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

const gitValue = (gitArgs: string[]) => gitValueAt(process.cwd(), gitArgs);

async function currentRepositoryPath() {
  const repositoryRoot = gitValue(["rev-parse", "--show-toplevel"]);
  if (!repositoryRoot) throw new Error("Git 저장소 안에서 이 명령을 실행하세요.");
  return resolve(repositoryRoot);
}

function gitCommonDirectory(repositoryPath: string) {
  const commonDirectory = gitValueAt(repositoryPath, ["rev-parse", "--git-common-dir"]);
  if (!commonDirectory) return null;
  return resolve(repositoryPath, commonDirectory);
}

const defaultWorktreeBranchPrefix = "briar";

/** Git runner for worktree work: keeps stderr so failures stay reportable. */
const runGit: GitRunner = (gitArgs, options = {}) => {
  const result = Bun.spawnSync(["git", ...gitArgs], {
    cwd: options.cwd ?? process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
  });
  return {
    // A timeout kills the child, leaving exitCode null; treat that as failure.
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

function worktreeSettings(project: ProjectConfig): WorktreeSettings {
  const configured = project.autoHunt?.worktrees;
  const worktreeHome = process.env.BRIAR_WORKTREE_HOME?.trim() || homedir();
  return {
    root:
      process.env.BRIAR_WORKTREE_ROOT?.trim() ||
      configured?.root ||
      defaultWorktreeRoot(worktreeHome),
    branchPrefix: configured?.branchPrefix || defaultWorktreeBranchPrefix,
  };
}

/** Per-issue worktrees are the default; a project can opt out explicitly. */
function worktreesEnabled(project: ProjectConfig): boolean {
  return project.autoHunt?.worktrees?.enabled !== false;
}

function activeClaimWorktree(project: ProjectConfig) {
  const worktree = project.activeClaim?.worktree;
  if (!worktree) {
    throw new Error("이 프로젝트에 진행 중인 claim의 워크트리가 없습니다.");
  }
  return worktree;
}

async function currentProject(config: Config): Promise<ProjectConfig> {
  const repositoryPath = await currentRepositoryPath();
  const remote = gitValue(["remote", "get-url", "origin"]);
  const commonDirectory = gitCommonDirectory(repositoryPath);
  const matchesRepository = (candidate: ProjectConfig) => {
    // samePath, not string equality: git reports canonical paths, so a repo or
    // worktree reached through a symlink must still match its stored project.
    if (samePath(candidate.repositoryPath, repositoryPath)) return true;
    if (remote && candidate.repositoryRemote === remote) return true;
    const candidateCommonDirectory = gitCommonDirectory(candidate.repositoryPath);
    return Boolean(
      commonDirectory &&
        candidateCommonDirectory &&
        samePath(commonDirectory, candidateCommonDirectory),
    );
  };
  const requestedProjectId = process.env.BRIAR_PROJECT_ID?.trim();
  const project = selectProjectForApi(
    config.projects.filter(matchesRepository),
    config.apiUrl,
    requestedProjectId,
  );
  if (!project) {
    if (requestedProjectId) {
      throw new Error(
        "자동사냥이 요청한 Briar 프로젝트가 이 저장소에 연결되어 있지 않습니다.",
      );
    }
    throw new Error(
      "연결된 Briar 프로젝트가 없습니다. Briar 앱에서 이 저장소를 연결하세요.",
    );
  }
  return project;
}

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
  type DoctorMergeQueuePolicy = {
    repositoryId: number;
    repository: string;
    baseBranch: string;
    enabled: boolean;
  };
  let mergeQueuePolicy: DoctorMergeQueuePolicy | null = null;
  let mergeQueueHealthy: boolean | null = null;
  let mergeQueueError: string | null = null;
  try {
    velen = ensureConfiguredVelen(project);
  } catch (error) {
    velenError = error instanceof Error ? error.message : String(error);
  }
  try {
    const result = await request<{ policy: DoctorMergeQueuePolicy | null }>(
      config.apiUrl,
      `/projects/${project.id}/merge-policy`,
      executionToken(project),
    );
    mergeQueuePolicy = result.policy;
    if (mergeQueuePolicy?.enabled) {
      verifyNativeMergeQueue(
        runMergeQueueCommand,
        mergeQueuePolicy.repository,
        mergeQueuePolicy.baseBranch,
      );
      mergeQueueHealthy = true;
    }
  } catch (error) {
    mergeQueueHealthy = false;
    mergeQueueError = error instanceof Error ? error.message : String(error);
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
      mergeQueue: {
        policy: mergeQueuePolicy,
        healthy: mergeQueueHealthy,
        error: mergeQueueError,
      },
      velenHealthy: velenError === null,
      velenError,
      requestIds: [velen?.auth.requestId, velen?.org.requestId, velen?.linear?.requestId].filter(
        Boolean,
      ),
    }),
  );
}

async function configureMergeQueue() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const repository = (
    value("--repository") ?? project.autoHunt?.githubRepository ?? ""
  ).trim().toLowerCase();
  if (!repository) {
    throw new Error("--repository or the project GitHub repository is required");
  }
  const baseBranch = (value("--base-branch") ?? "main").trim();
  const enabled = !has("--disable");
  const repositoryResponse = runMergeQueueCommand([
    "gh", "api", `repos/${repository}`, "--jq", ".id",
  ]);
  const repositoryId = Number(repositoryResponse.stdout.trim());
  if (
    repositoryResponse.exitCode !== 0 ||
    !Number.isSafeInteger(repositoryId) ||
    repositoryId <= 0
  ) {
    throw new Error(
      `GitHub repository identity could not be read: ${repositoryResponse.stderr.trim()}`,
    );
  }
  if (enabled) {
    // Activation is intentionally after the authoritative GitHub rule check.
    // This command never creates or edits a GitHub ruleset.
    verifyNativeMergeQueue(runMergeQueueCommand, repository, baseBranch);
  }
  const quietWindowMs = Number(value("--quiet-window-ms") ?? "30000");
  if (!Number.isInteger(quietWindowMs) || quietWindowMs < 1_000 || quietWindowMs > 300_000) {
    throw new Error("--quiet-window-ms must be between 1000 and 300000");
  }
  const result = await request(
    config.apiUrl,
    `/projects/${project.id}/merge-policy`,
    executionToken(project),
    {
      method: "PUT",
      body: JSON.stringify({
        repositoryId,
        repository,
        baseBranch,
        enabled,
        quietWindowMs,
        validationCommand: value("--validation-command") ?? "bun run ci:local",
        statusContexts: [
          "signoff/app-worker",
          "signoff/d1-migrations",
          "signoff/rust",
          "signoff/security",
        ],
      }),
    },
  );
  console.log(JSON.stringify(result));
}

async function retryMergeQueueBatch() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const batchId = required("--batch");
  decodeUuid(batchId);
  const result = await request(
    config.apiUrl,
    `/projects/${project.id}/merge-batches/${batchId}/retry`,
    executionToken(project),
    { method: "POST", body: "{}" },
  );
  console.log(JSON.stringify(result));
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

function safeAttachmentFilename(filename: string) {
  const normalized = filename
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^\.+/u, "")
    .slice(-120);
  return normalized || "attachment";
}

async function downloadClaimAttachment(
  apiUrl: string,
  token: string,
  projectId: string,
  runId: string,
  attachment: QueuedAttachment,
  storageDirectory = configDirectory,
) {
  const expectedPrefix = `/projects/${projectId}/runs/${runId}/attachments/`;
  if (!attachment.url.startsWith(expectedPrefix)) {
    throw new Error("Attachment URL does not belong to the claimed issue");
  }
  const response = await fetch(
    `${apiUrl.replace(/\/$/u, "")}${attachment.url}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(`Attachment download failed (${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== attachment.byteSize) {
    throw new Error("Attachment size did not match its metadata");
  }
  const directory = join(storageDirectory, "attachments", runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(
    directory,
    `${attachment.id}-${safeAttachmentFilename(attachment.filename)}`,
  );
  await writeFile(path, bytes, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

async function claimWork() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run");
  if (runId) decodeUuid(runId);
  if (
    project.activeClaim &&
    !project.activeClaim.finished &&
    Date.parse(project.activeClaim.leaseExpiresAt) > Date.now() &&
    !has("--runtime-dispatch")
  ) {
    throw new Error(
      `이미 처리 중인 claim이 있습니다: ${project.activeClaim.sourceKey}`,
    );
  }
  const result = await request<{ work: unknown }>(
    config.apiUrl,
    "/queue/claims",
    executionToken(project),
    {
      method: "POST",
      body: JSON.stringify({
        claimedBy: value("--actor") ?? "briar-workflow",
        ...(runId ? { runId } : {}),
      }),
    },
  );
  if (result.work === null) {
    console.log(JSON.stringify({ work: null }));
    return;
  }
  const issue = decodeQueuedIssue(result.work);
  const agentToken = executionToken(project);
  config.projects = config.projects.map((candidate) =>
    candidate.id === project.id
      ? {
          ...candidate,
          activeClaim: {
            runId: issue.runId,
            sourceKey: issue.sourceKey,
            token: issue.claimToken,
            leaseExpiresAt: issue.leaseExpiresAt,
          },
        }
      : candidate,
  );
  await saveConfig(config);
  // Persist the claim before workspace allocation so a crash cannot lose the
  // token needed to report or release the run.
  const { workspace, workspaceError } = await allocateClaimWorkspace(
    config,
    project,
    issue,
  );
  const attachments = await Promise.all(
    issue.attachments.map(async (attachment) => {
      try {
        return {
          ...attachment,
          localPath: await downloadClaimAttachment(
            config.apiUrl,
            agentToken,
            project.id,
            issue.runId,
            attachment,
          ),
          downloadError: null,
        };
      } catch (error) {
        return {
          ...attachment,
          localPath: null,
          downloadError: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  const { claimToken: _claimToken, ...publicIssue } = issue;
  console.log(
    JSON.stringify({
      work: {
        ...publicIssue,
        briarIssueUrl: briarIssueUrl(
          config.apiUrl,
          project.id,
          issue.runId,
        ),
        attachments,
        workspace,
      },
      ...(workspaceError ? { workspaceError } : {}),
    }),
  );
}

/**
 * Resolve the claimed run's workspace. Allocation failures stay in the
 * response because the run is already claimed and must remain reportable.
 */
async function allocateClaimWorkspace(
  config: Config,
  project: ProjectConfig,
  issue: { runId: string; sourceKey: string; title: string },
  storageDirectory = configDirectory,
): Promise<{
  workspace:
    | ({ type: "worktree" } & IssueWorktree & { warning?: string })
    | { type: "current"; path: string }
    | null;
  workspaceError: string | null;
}> {
  const requestedMode = decodeWorkspaceMode(value("--workspace") ?? "project");
  const mode =
    requestedMode === "project"
      ? worktreesEnabled(project)
        ? "worktree"
        : "current"
      : requestedMode;
  if (mode === "none") {
    return { workspace: null, workspaceError: null };
  }
  if (mode === "current") {
    return {
      workspace: { type: "current", path: project.repositoryPath },
      workspaceError: null,
    };
  }
  try {
    const worktree = await allocateIssueWorktree({
      repositoryPath: project.repositoryPath,
      projectId: project.id,
      issue,
      settings: worktreeSettings(project),
      git: runGit,
      ...(value("--base-branch") ? { baseRef: required("--base-branch") } : {}),
    });
    await removeCompletedWorktreeRecord(
      projectWorktreeRoot(worktreeSettings(project).root, project.id),
      issue.runId,
    );
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id && candidate.activeClaim
        ? {
            ...candidate,
            activeClaim: {
              ...candidate.activeClaim,
              worktree: {
                path: worktree.path,
                branch: worktree.branch,
                baseRef: worktree.baseRef,
                baseSha: worktree.baseSha,
              },
            },
          }
        : candidate,
    );
    await saveConfigAt(storageDirectory, config);
    return {
      workspace: { type: "worktree", ...worktree },
      workspaceError: null,
    };
  } catch (error) {
    return {
      workspace: null,
      workspaceError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function worktreeShow() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const settings = worktreeSettings(project);
  console.log(
    JSON.stringify({
      projectId: project.id,
      root: projectWorktreeRoot(settings.root, project.id),
      branchPrefix: settings.branchPrefix,
      sourceKey: project.activeClaim?.sourceKey ?? null,
      worktree: activeClaimWorktree(project),
    }),
  );
}

async function worktreeList() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const root = projectWorktreeRoot(worktreeSettings(project).root, project.id);
  console.log(
    JSON.stringify({
      projectId: project.id,
      root,
      worktrees: listIssueWorktrees(runGit, project.repositoryPath, root),
    }),
  );
}

async function worktreeRemove() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const root = projectWorktreeRoot(worktreeSettings(project).root, project.id);
  const target = resolve(value("--path") ?? activeClaimWorktree(project).path);
  // Only ever remove a registered worktree under this project's root, so a
  // wrong `--path` cannot take out the main checkout or an unrelated tree.
  const registered = listIssueWorktrees(runGit, project.repositoryPath, root).find((worktree) =>
    samePath(worktree.path, target),
  );
  if (!registered?.branch) {
    throw new Error(`이 프로젝트의 워크트리가 아닙니다: ${target}`);
  }
  const result = removeIssueWorktree(
    runGit,
    project.repositoryPath,
    { path: registered.path, branch: registered.branch },
    { force: has("--force") },
  );
  if (
    project.activeClaim?.worktree &&
    samePath(project.activeClaim.worktree.path, registered.path)
  ) {
    config.projects = config.projects.map((candidate) => {
      if (candidate.id !== project.id || !candidate.activeClaim) return candidate;
      const { worktree: _removed, ...activeClaim } = candidate.activeClaim;
      return { ...candidate, activeClaim };
    });
    await saveConfig(config);
  }
  console.log(JSON.stringify({ path: registered.path, branch: registered.branch, ...result }));
}

async function maintainRecordedCompletedWorktrees(project: ProjectConfig) {
  const root = projectWorktreeRoot(worktreeSettings(project).root, project.id);
  const registeredWorktrees = listIssueWorktrees(runGit, project.repositoryPath, root);
  const results = [];
  for (const record of await listCompletedWorktrees(root)) {
    const registered = registeredWorktrees.find(
      (worktree) =>
        worktree.branch === record.branch && samePath(worktree.path, record.path),
    );
    if (!registered?.branch) {
      await removeCompletedWorktreeRecord(root, record.runId);
      results.push({
        path: record.path,
        branch: record.branch,
        gc: { status: "removed", branchDeleted: false, alreadyAbsent: true },
      });
      continue;
    }
    const result = await maintainTerminalIssueWorktree(
      runGit,
      project.repositoryPath,
      { path: registered.path, branch: registered.branch },
      { completedAt: record.completedAt },
    );
    if (result.gc.status === "removed") {
      await removeCompletedWorktreeRecord(root, record.runId);
    }
    results.push({ path: registered.path, branch: registered.branch, ...result });
  }
  return results;
}

async function syncCompletedWorktreeRecordsFromDashboard(
  config: Config,
  project: ProjectConfig,
): Promise<number> {
  if (!config.userToken) return 0;
  const dashboard = await request<{ runs: unknown[] }>(
    config.apiUrl,
    `/projects/${encodeURIComponent(project.id)}/dashboard`,
    config.userToken,
  );
  const completedRuns = decodeDashboardRuns(dashboard.runs)
    .filter(
      (run): run is typeof run & { branch: string; completedAt: string } =>
        run.status === "completed" && Boolean(run.branch && run.completedAt),
    );
  const root = projectWorktreeRoot(worktreeSettings(project).root, project.id);
  const existingRunIds = new Set(
    (await listCompletedWorktrees(root)).map((record) => record.runId),
  );
  const registeredWorktrees = listIssueWorktrees(runGit, project.repositoryPath, root);
  let recorded = 0;
  for (const run of completedRuns) {
    if (existingRunIds.has(run.id)) continue;
    const worktree = registeredWorktrees.find((candidate) => candidate.branch === run.branch);
    if (!worktree?.branch) continue;
    await recordCompletedWorktree(root, {
      runId: run.id,
      path: worktree.path,
      branch: worktree.branch,
      completedAt: run.completedAt,
    });
    recorded += 1;
  }
  return recorded;
}

async function worktreeMaintain() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const root = projectWorktreeRoot(worktreeSettings(project).root, project.id);
  const registeredWorktrees = listIssueWorktrees(runGit, project.repositoryPath, root);
  if (has("--all")) {
    try {
      await syncCompletedWorktreeRecordsFromDashboard(config, project);
    } catch {
      // Previously recorded completions remain maintainable while offline.
    }
    const results = await maintainRecordedCompletedWorktrees(project);
    console.log(JSON.stringify({ projectId: project.id, results }));
    return;
  }
  const activeWorktree = project.activeClaim?.worktree;
  const target = resolve(value("--path") ?? activeClaimWorktree(project).path);
  const registered = registeredWorktrees.find((worktree) =>
    samePath(worktree.path, target),
  );
  if (!registered?.branch) {
    throw new Error(`이 프로젝트의 워크트리가 아닙니다: ${target}`);
  }
  const baseRef =
    activeWorktree && samePath(activeWorktree.path, registered.path)
      ? activeWorktree.baseRef
      : undefined;
  const completedAt = value("--completed-at");
  if (completedAt) decodeIsoDateTimeWithOffset(completedAt);
  const completedRunId = value("--run");
  if (completedRunId) decodeUuid(completedRunId);
  if (Boolean(completedAt) !== Boolean(completedRunId)) {
    throw new Error("--completed-at and --run must be supplied together");
  }
  if (completedAt && completedRunId) {
    await recordCompletedWorktree(root, {
      runId: completedRunId,
      path: registered.path,
      branch: registered.branch,
      completedAt,
    });
  }
  const result = await maintainTerminalIssueWorktree(
    runGit,
    project.repositoryPath,
    { path: registered.path, branch: registered.branch },
    {
      ...(baseRef ? { baseRef } : {}),
      ...(completedAt ? { completedAt } : {}),
    },
  );
  if (
    result.gc.status === "removed" &&
    project.activeClaim?.worktree &&
    samePath(project.activeClaim.worktree.path, registered.path)
  ) {
    config.projects = config.projects.map((candidate) => {
      if (candidate.id !== project.id || !candidate.activeClaim) return candidate;
      const { worktree: _removed, ...activeClaim } = candidate.activeClaim;
      return { ...candidate, activeClaim };
    });
    await saveConfig(config);
  }
  if (result.gc.status === "removed" && completedRunId) {
    await removeCompletedWorktreeRecord(root, completedRunId);
  }
  console.log(JSON.stringify({ path: registered.path, branch: registered.branch, ...result }));
}

async function optionalText(valueFlag: string, fileFlag: string) {
  const path = value(fileFlag);
  if (path) return readFile(resolve(path), "utf8");
  return value(valueFlag) ?? null;
}

async function createIssueCommand() {
  const config = await loadConfig();
  if (!config.userToken) throw new Error("먼저 `briar login`을 실행하세요.");
  const project = await currentProject(config);
  const priorityValue = value("--priority");
  const input = decodeCreateIssueInput({
    title: required("--title"),
    description: await optionalText("--description", "--description-file"),
    priority: priorityValue === undefined ? null : Number(priorityValue),
    status: value("--status") ?? "queued",
  });
  const result = await request<{
    runId: string;
    sourceKey: string;
    stage: "queued";
    status: "backlog" | "queued";
    attachments: unknown[];
  }>(
    config.apiUrl,
    `/projects/${encodeURIComponent(project.id)}/issues`,
    config.userToken,
    { method: "POST", body: JSON.stringify(input) },
  );
  console.log(JSON.stringify(result));
}

async function changeIssueDependencyCommand(action: "add" | "remove") {
  const config = await loadConfig();
  if (!config.userToken) throw new Error("먼저 `briar login`을 실행하세요.");
  const project = await currentProject(config);
  const dependentRunId = decodeUuid(required("--dependent-run"));
  const prerequisiteRunId = decodeUuid(required("--prerequisite-run"));
  const path =
    `/projects/${encodeURIComponent(project.id)}` +
    `/runs/${encodeURIComponent(dependentRunId)}` +
    `/dependencies/${encodeURIComponent(prerequisiteRunId)}`;

  if (action === "add") {
    const result = await request<{
      prerequisiteRunId: string;
      dependentRunId: string;
      outcome: "created" | "already_exists";
    }>(config.apiUrl, path, config.userToken, { method: "PUT" });
    console.log(JSON.stringify(result));
    return;
  }

  await request<void>(config.apiUrl, path, config.userToken, {
    method: "DELETE",
  });
  console.log(
    JSON.stringify({ dependentRunId, prerequisiteRunId, outcome: "removed" }),
  );
}

const channelMessagesUsage = `Usage: briar channel messages --channel-id <uuid>
  [--limit <1-100>] [--cursor <message-uuid>]
  [--parent-message-id <root-message-uuid>]`;

async function listChannelMessagesCommand() {
  if (has("--help")) {
    console.log(channelMessagesUsage);
    return;
  }
  const config = await loadConfig();
  const project = await currentProject(config);
  const input = decodeChannelMessagesInput({
    channelId: required("--channel-id"),
    limit: value("--limit") === undefined ? 50 : Number(value("--limit")),
    cursor: value("--cursor") ?? null,
    parentMessageId: value("--parent-message-id") ?? null,
  });
  const searchParams = new URLSearchParams({ limit: String(input.limit) });
  if (input.cursor) searchParams.set("cursor", input.cursor);
  if (input.parentMessageId) {
    searchParams.set("parentMessageId", input.parentMessageId);
  }
  const result = await request<{
    channel: unknown;
    messages: unknown[];
    nextCursor: string | null;
  }>(
    config.apiUrl,
    `/projects/${encodeURIComponent(project.id)}` +
      `/channels/${encodeURIComponent(input.channelId)}/messages?${searchParams}`,
    process.env.BRIAR_AGENT_TOKEN ?? project.agentToken,
  );
  console.log(JSON.stringify(result));
}

async function addRunEvent(forcedStatus?: string) {
  const config = await loadConfig();
  const project = await currentProject(config);
  const repositoryRoot = await currentRepositoryPath();
  const agentToken = executionToken(project);
  if (!agentToken) throw new Error("Briar 실행 토큰이 없습니다.");
  const branch = value("--branch") ?? gitValue(["branch", "--show-current"]);
  const commitSha = value("--commit-sha") ?? gitValue(["rev-parse", "HEAD"]);
  const remote = gitValue(["remote", "get-url", "origin"]);
  const repository = value("--repository") ?? remote ?? basename(repositoryRoot);
  const issueId = value("--issue-id") ?? null;
  const issueIdentifier = value("--issue-identifier") ?? null;
  const issueUrl = value("--issue-url") ?? null;
  const issueState = value("--issue-state") ?? null;
  const hasLinearReference = Boolean(
    issueId || issueIdentifier || issueUrl || issueState,
  );
  const contextValue = value("--context-json");
  const structuredResultValue = await optionalText(
    "--structured-result",
    "--structured-result-file",
  );
  const structuredResult = structuredResultValue
    ? decodeStructuredAgentResult(JSON.parse(structuredResultValue))
    : null;
  const runId = value("--run") ?? project.activeClaim?.runId ?? null;
  const sourceKey = value("--source-key") ?? project.activeClaim?.sourceKey ?? null;
  const title = value("--title");
  const input = {
    runId,
    source: value("--source") ?? (runId ? null : "issue"),
    sourceKey,
    title: title ?? null,
    status: forcedStatus ?? value("--status"),
    workflowStage: value("--workflow-stage"),
    eventKey: required("--event-key"),
    occurredAt: value("--observed-at") ?? value("--occurred-at") ?? new Date().toISOString(),
    actor: value("--actor") ?? "briar-workflow",
    repository,
    detail: value("--status-detail") ?? value("--detail") ?? null,
    priority: value("--priority") ? Number(value("--priority")) : null,
    branch: branch || null,
    commitSha: commitSha || null,
    tracker: hasLinearReference
      ? {
          provider:
            value("--tracker-provider") ??
            (project.autoHunt?.linear?.enabled ? "linear" : "generic"),
          issueId,
          identifier: issueIdentifier,
          url: issueUrl,
          state: issueState,
        }
      : null,
    issueDescription: await optionalText("--issue-description", "--issue-description-file"),
    resultSummary:
      structuredResult?.summary ??
      (await optionalText("--result-summary", "--result-summary-file")),
    structuredResult,
    pullRequestUrls: values("--pull-request-url"),
    targetSha: value("--target-sha") ?? null,
    sourceCreatedAt: value("--source-created-at") ?? null,
    context: contextValue ? JSON.parse(contextValue) : null,
  };
  if (forcedStatus === "completed" && !input.structuredResult) {
    throw new Error(
      "run complete requires --structured-result or --structured-result-file",
    );
  }
  if (
    forcedStatus === "completed" &&
    input.structuredResult &&
    !["completed", "partial"].includes(input.structuredResult.outcome)
  ) {
    throw new Error(
      "run complete structured outcome must be completed or partial",
    );
  }
  if (input.status === "blocked" && !input.structuredResult) {
    throw new Error(
      "--status blocked requires --structured-result or --structured-result-file",
    );
  }
  if (
    input.status === "blocked" &&
    input.structuredResult?.outcome !== "blocked"
  ) {
    throw new Error("--status blocked structured outcome must be blocked");
  }
  if (
    input.status === "blocked" &&
    (!input.structuredResult?.humanActionRequired ||
      !input.structuredResult.nextAction)
  ) {
    throw new Error(
      "--status blocked requires humanActionRequired and an exact nextAction",
    );
  }
  validateRunEventInput(input);
  const result = await request<{
    runId: string;
    status: string;
    workflowStage: string | null;
    stage: string;
  }>(
    config.apiUrl,
    "/run-events",
    agentToken,
    {
      method: "POST",
      body: JSON.stringify(input),
      headers:
        project.activeClaim?.runId === input.runId && project.activeClaim.token
          ? { "X-Briar-Claim-Token": project.activeClaim.token }
          : undefined,
    },
  );
  if (project.activeClaim?.runId === result.runId) {
    const terminal = ["completed", "cancelled", "blocked", "failed"].includes(
      input.status ?? "",
    );
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id
        ? {
            ...candidate,
            activeClaim: candidate.activeClaim && terminal
              ? {
                  ...candidate.activeClaim,
                  token: undefined,
                  finished: true,
                  terminalStatus: input.status as "completed" | "cancelled" | "blocked" | "failed",
                  finishedAt: input.occurredAt,
                }
              : candidate.activeClaim,
          }
        : candidate,
    );
    await saveConfig(config);
  }
  console.log(JSON.stringify(result));
}

async function addRunEvidence() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  const metadataValue = value("--metadata-json");
  const input = {
    evidenceKey: required("--key"),
    stage: required("--stage"),
    type: required("--type"),
    status: required("--status"),
    observedAt: value("--observed-at") ?? new Date().toISOString(),
    actor: value("--actor") ?? "briar-workflow",
    detail: await optionalText("--detail", "--detail-file"),
    command: value("--command") ?? null,
    url: value("--url") ?? null,
    metadata: metadataValue ? JSON.parse(metadataValue) : null,
  };
  const parsed = decodeRunEvidenceInput(input);
  if (
    parsed.type === "pull_request" &&
    parsed.url &&
    (parsed.status === "passed" || parsed.status === "pending")
  ) {
    const github = ensureBriarIssueLinkInGithubPullRequest({
      pullRequestUrl: parsed.url,
      issueUrl: briarIssueUrl(config.apiUrl, project.id, runId),
    });
    parsed.metadata = {
      ...(parsed.metadata ?? {}),
      githubPullRequest: github.identity,
    };
  }
  const imagePaths = values("--image").map((path) => resolve(path));
  const images = await Promise.all(
    imagePaths.map(async (path) => {
      const image = Bun.file(path);
      if (!(await image.exists())) {
        throw new Error(`Evidence image does not exist: ${path}`);
      }
      return { image, name: basename(path) };
    }),
  );
  const imageError = validateEvidenceImages(
    images.map(({ image, name }) => ({
      name,
      size: image.size,
      type: image.type,
    })),
  );
  if (imageError) throw new Error(imageError);
  const body = images.length
    ? (() => {
        const form = new FormData();
        form.append("evidence", JSON.stringify(parsed));
        for (const { image, name } of images) {
          form.append("images", image, name);
        }
        return form;
      })()
    : JSON.stringify(parsed);
  const result = await request(
    config.apiUrl,
    `/runs/${runId}/evidence`,
    executionToken(project),
    {
      method: "POST",
      body,
      headers:
        project.activeClaim?.runId === runId && project.activeClaim.token
          ? { "X-Briar-Claim-Token": project.activeClaim.token }
          : undefined,
    },
  );
  console.log(JSON.stringify(result));
}

async function listCurrentRunEvidence() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  decodeUuid(runId);
  const result = await request(
    config.apiUrl,
    `/runs/${runId}/evidence`,
    executionToken(project),
  );
  console.log(JSON.stringify(result));
}

async function recoverRun(action: "retry" | "cancel") {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  const input = {
    requestId: value("--request-id") ?? crypto.randomUUID(),
    actor: value("--actor") ?? "briar-workflow",
    reason: value("--reason") ?? null,
  };
  validateRecoveryRunInput(input);
  decodeUuid(runId);
  const result = await request<{
    runId: string;
    outcome: string;
    attempt: number;
    stage: string;
  }>(
    config.apiUrl,
    `/runs/${runId}/${action}`,
    executionToken(project),
    { method: "POST", body: JSON.stringify(input) },
  );
  if (project.activeClaim?.runId === runId) {
    // The server released this claim while queueing the new revision. Make the
    // current provider turn stop instead of continuing with a stale token.
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id
        ? { ...candidate, activeClaim: undefined }
        : candidate,
    );
    await saveConfig(config);
  }
  console.log(JSON.stringify(result));
}

async function reworkRun() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  const input = {
    requestId: value("--request-id") ?? crypto.randomUUID(),
    actor: value("--actor") ?? "briar-workflow",
    workflowStage: required("--to"),
    reason: required("--reason"),
  };
  validateReworkRunInput(input);
  decodeUuid(runId);
  const result = await request<{
    runId: string;
    outcome: "reworked" | "already_reworked";
    attempt: number;
    revision: number;
    workflowStage: string;
  }>(
    config.apiUrl,
    `/runs/${runId}/rework`,
    executionToken(project),
    { method: "POST", body: JSON.stringify(input) },
  );
  if (project.activeClaim?.runId === runId) {
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id
        ? { ...candidate, activeClaim: undefined }
        : candidate
    );
    await saveConfig(config);
  }
  console.log(JSON.stringify(result));
}

async function resumeRun() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  const input = {
    requestId: value("--request-id") ?? crypto.randomUUID(),
    actor: value("--actor") ?? "briar-workflow",
    checkpointKey: value("--checkpoint"),
    attempt: value("--attempt") ? Number(value("--attempt")) : undefined,
    revision: value("--revision") ? Number(value("--revision")) : undefined,
  };
  validateResumeRunInput(input);
  decodeUuid(runId);
  const result = await request<{
    runId: string;
    outcome: string;
    workflowStage: string | null;
    startStage: string | null;
    terminalReviewOnly: boolean;
  }>(
    config.apiUrl,
    `/runs/${runId}/resume`,
    executionToken(project),
    { method: "POST", body: JSON.stringify(input) },
  );
  if (project.activeClaim?.runId === runId) {
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id
        ? { ...candidate, activeClaim: undefined }
        : candidate,
    );
    await saveConfig(config);
  }
  console.log(JSON.stringify(result));
}

async function transitionWorkflowStage(action: "start" | "complete") {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  const stage = required("--stage");
  const input = {
    requestId: value("--request-id") ?? crypto.randomUUID(),
    actor: value("--actor") ?? "briar-workflow",
    attempt: value("--attempt") ? Number(value("--attempt")) : undefined,
    revision: value("--revision") ? Number(value("--revision")) : undefined,
  };
  validateWorkflowTransitionInput(input);
  decodeUuid(runId);
  decodeWorkflowStageId(stage);
  const result = await request<{
    runId: string;
    requestId: string;
    outcome:
      | "started"
      | "completed"
      | "already_started"
      | "already_completed"
      | "paused"
      | "delegated";
    attempt: number;
    revision: number;
    stage: string;
    checkpoint: {
      key: string;
      stage: string;
      position: "before" | "after";
      revision: number;
    } | null;
  }>(
    config.apiUrl,
    `/runs/${runId}/stages/${stage}/${action}`,
    executionToken(project),
    {
      method: "POST",
      body: JSON.stringify(input),
      headers:
        project.activeClaim?.runId === runId && project.activeClaim.token
          ? { "X-Briar-Claim-Token": project.activeClaim.token }
          : undefined,
    },
  );
  if (result.outcome === "paused" && project.activeClaim?.runId === runId) {
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id
        ? { ...candidate, activeClaim: undefined }
        : candidate,
    );
    await saveConfig(config);
  }
  if (result.outcome === "delegated" && project.activeClaim?.runId === runId) {
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id
        ? { ...candidate, activeClaim: undefined }
        : candidate,
    );
    await saveConfig(config);
  }
  console.log(JSON.stringify(result));
}

const activeReplyActivityPublishers = new Map<
  string,
  ChannelActivityPublisher
>();
const activeCachedAnalysisWorktreePaths = new Map<string, number>();

function retainCachedAnalysisWorktree(path: string) {
  activeCachedAnalysisWorktreePaths.set(
    path,
    (activeCachedAnalysisWorktreePaths.get(path) ?? 0) + 1,
  );
}

function releaseCachedAnalysisWorktree(path: string) {
  const remaining = (activeCachedAnalysisWorktreePaths.get(path) ?? 1) - 1;
  if (remaining <= 0) {
    activeCachedAnalysisWorktreePaths.delete(path);
  } else {
    activeCachedAnalysisWorktreePaths.set(path, remaining);
  }
}

function detachedAgentWithActiveSkill(
  agent: DetachedAgentClaim,
  activeSkill: DetachedAgentSkill | null | undefined,
): DetachedAgent {
  return {
    ...agent,
    activeSkill: activeSkill ?? null,
  };
}

function detachedReplyAgent(input: {
  workId: string;
  provider: AgentProvider;
  model: string | null;
  effort?: ModelEffort | null;
  agent?: DetachedAgentClaim | null;
  activeSkill?: DetachedAgentSkill | null;
  snapshot: Record<string, unknown>;
  fallbackName: string;
  scope?: DetachedAgent["scope"];
}): DetachedAgent {
  const snapshotAgent = Predicate.isObject(input.snapshot.agent)
    ? input.snapshot.agent
    : null;
  const snapshotSkills = decodeDetachedAgentSkillsOption(snapshotAgent?.skills);
  const baseAgent = input.agent ?? {
    id: typeof snapshotAgent?.id === "string" && snapshotAgent.id.trim()
      ? snapshotAgent.id
      : input.workId,
    name: typeof snapshotAgent?.name === "string" && snapshotAgent.name.trim()
      ? snapshotAgent.name
      : input.fallbackName,
    provider: input.provider,
    model: input.model,
    effort:
      typeof snapshotAgent?.effort === "string" &&
        Option.isSome(decodeDetachedAgentEffortOption(snapshotAgent.effort))
        ? snapshotAgent.effort
        : null,
    responsibility: typeof snapshotAgent?.responsibility === "string"
      ? snapshotAgent.responsibility
      : "",
    skill: typeof snapshotAgent?.skill === "string" ? snapshotAgent.skill : "",
    skills: Option.getOrElse(snapshotSkills, () => []),
  };
  return {
    ...baseAgent,
    // The top-level execution fields are snapshotted by the server and remain
    // authoritative during rolling upgrades, even when Agent defaults change.
    provider: input.provider,
    model: input.model,
    effort: input.effort !== undefined
      ? input.effort
      : input.activeSkill?.effort ?? baseAgent.effort,
    activeSkill: input.activeSkill ?? null,
    scope: input.scope,
  };
}

async function runClaimedIssue(
  config: Config,
  project: ProjectConfig,
  issue: ClaimedRun,
  workerToken: string,
  signal: AbortSignal,
  reportCheckpoint?: (value: WorkerExecutionCheckpoint) => void,
) {
  const runtimeDirectory = issueWorkerSessionDirectory(configDirectory, issue);
  const runtimeConfig = structuredClone(config);
  runtimeConfig.projects = runtimeConfig.projects.map((candidate) =>
    candidate.id === project.id
      ? {
          ...candidate,
          activeClaim: {
            runId: issue.runId,
            sourceKey: issue.sourceKey,
            token: issue.claimToken,
            leaseExpiresAt: issue.leaseExpiresAt,
          },
        }
      : candidate,
  );
  await saveConfigAt(runtimeDirectory, runtimeConfig);
  try {
    await runClaimedIssueInRuntime(
      runtimeConfig,
      project,
      issue,
      workerToken,
      signal,
      runtimeDirectory,
      reportCheckpoint,
    );
  } finally {
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
}

async function runClaimedIssueInRuntime(
  config: Config,
  project: ProjectConfig,
  issue: ClaimedRun,
  workerToken: string,
  signal: AbortSignal,
  runtimeDirectory: string,
  reportCheckpoint?: (value: WorkerExecutionCheckpoint) => void,
) {
  const execution = issue.execution ??
    (issue.agent
      ? {
          provider: issue.agent.provider,
          model: issue.agent.model,
          effort: issue.agent.effort,
        }
      : null);
  if (!execution) {
    throw new Error("이 실행에 사용할 프로바이더가 지정되지 않았습니다.");
  }
  const activeProject =
    config.projects.find((candidate) => candidate.id === project.id) ?? project;
  const { workspace, workspaceError } = await allocateClaimWorkspace(
    config,
    activeProject,
    issue,
    runtimeDirectory,
  );
  if (!workspace?.path) {
    throw new Error(
      `Worker workspace allocation failed: ${workspaceError ?? "no workspace"}`,
    );
  }
  reportCheckpoint?.({ workspacePath: workspace.path });

  const provider = execution.provider;
  const attachments = await Promise.all(
    issue.attachments.map(async (attachment) => {
      try {
        return {
          ...attachment,
          localPath: await downloadClaimAttachment(
            config.apiUrl,
            workerToken,
            project.id,
            issue.runId,
            attachment,
            runtimeDirectory,
          ),
          downloadError: null,
        };
      } catch (error) {
        return {
          ...attachment,
          localPath: null,
          downloadError: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  const logicalAgent = issue.agent
    ? detachedAgentWithActiveSkill(issue.agent, issue.activeSkill)
    : null;
  const prompt = detachedAgentPrompt({
    agent: logicalAgent,
    snapshot: {
      runId: issue.runId,
      runNumber: issue.runNumber,
      currentAttempt: issue.currentAttempt,
      currentRevision: issue.currentRevision,
      source: issue.source,
      sourceKey: issue.sourceKey,
      title: issue.title,
      issueDescription: issue.description,
      briarIssueUrl: briarIssueUrl(
        config.apiUrl,
        project.id,
        issue.runId,
      ),
      priority: issue.priority,
      sourceCreatedAt: issue.sourceCreatedAt,
      createdByUserId: issue.createdByUserId,
      context: issue.context,
      reviewFeedback: issue.reviewFeedback,
      workflow: issue.workflow,
      startStage: issue.startStage,
      resumeContext: issue.resumeContext,
      attachments,
      conversation: issue.messages,
    },
    workspacePath: workspace.path,
    startStage: issue.startStage,
    resumeContext: issue.resumeContext,
  });
  const fullAccess = activeProject.autoHunt?.sandbox?.fullAccess ?? true;
  const sessionId = detachedTranscriptSessionId(
    issue.runId,
    issue.executionId,
  );
  const environment = providerExecutionEnvironment(config, provider, {
    ...process.env,
    PATH: workerExecutionPath(),
    BRIAR_CLI: workerCliPath(),
    BRIAR_WORKER_TOKEN: workerToken,
    BRIAR_PROJECT_ID: project.id,
    BRIAR_CONFIG_HOME: runtimeDirectory,
  });

  const detachedAgent: DetachedAgent = {
    id: logicalAgent?.id ?? issue.runId,
    name: logicalAgent?.name ?? "Briar Worker",
    provider: execution.provider,
    model: execution.model,
    effort: execution.effort,
    responsibility: logicalAgent?.responsibility ?? "",
    skill: logicalAgent?.skill ?? "",
    skills: logicalAgent?.skills ?? [],
    activeSkill: logicalAgent?.activeSkill ?? null,
  };
  const providerAttachments = agentImageAttachments(attachments);

  const executionStartedAt = Date.now();
  const transcriptSequencer = createDetachedTranscriptSequencer(
    issue.claimAttempts,
  );
  const usageCollector = createAgentExecutionUsageCollector(provider, {
    configuredModel: execution.model,
  });
  const transcriptEnvelope = {
    projectId: project.id,
    sessionId,
    runId: issue.runId,
    workType: "issue" as const,
    workId: issue.runId,
    claimToken: issue.claimToken,
    ...(issue.executionId ? { executionId: issue.executionId } : {}),
    workerId: activeProject.executionWorker?.workerId,
    agentProvider: provider,
  };
  const transcriptBatcher = new TranscriptBatcher({
    send: async (events) => {
      await request(config.apiUrl, "/transcripts", workerToken, {
        method: "POST",
        body: serializeTranscriptRequest(transcriptEnvelope, events),
      });
    },
    measureBytes: (events) =>
      Buffer.byteLength(
        serializeTranscriptRequest(transcriptEnvelope, events),
        "utf8",
      ),
    isPayloadTooLarge: isTranscriptPayloadTooLarge,
    onError: (error) => {
      console.error(
        `transcript upload failed for ${issue.sourceKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  });
  let conversationId: string | null = issue.handoffContext?.conversationId ?? null;
  if (conversationId) reportCheckpoint?.({ conversationId });
  let nextPrompt = prompt;
  let turnNumber = 0;
  let consecutiveProviderTurnFailures = 0;
  try {
    for (;;) {
      turnNumber += 1;
      let runnerBlock: ReturnType<typeof detachedProviderBlockFromPayload> = null;
      const turn = await runDetachedProviderTurn({
        agent: detachedAgent,
        prompt: nextPrompt,
        workspacePath: workspace.path,
        fullAccess,
        conversationId,
        attachments:
          turnNumber === 1 || !conversationId
            ? providerAttachments
            : undefined,
        environment,
        signal,
        onConversationId: (nextConversationId) => {
          conversationId = nextConversationId;
          reportCheckpoint?.({ conversationId: nextConversationId });
        },
        onPayload: async (rawPayload, line) => {
          usageCollector.observe(rawPayload, new Date().toISOString());
          runnerBlock ??= detachedProviderBlockFromPayload(rawPayload);
          const direction = detachedPayloadDirection(rawPayload);
          const payload = detachedTranscriptPayload(rawPayload, line);
          const transcriptSequence = transcriptSequencer.nextForPayload(payload);
          if (transcriptSequence !== null) {
            await transcriptBatcher.enqueue({
              sequence: transcriptSequence,
              direction,
              payload,
            });
          }
        },
      });
      await transcriptBatcher.flush();
      conversationId = turn.conversationId;
      if (runnerBlock) {
        await request(config.apiUrl, "/run-events", workerToken, {
          method: "POST",
          headers: { "X-Briar-Claim-Token": issue.claimToken },
          body: JSON.stringify(
            detachedProviderBlockedRunEvent({
              block: runnerBlock,
              runId: issue.runId,
              attempt: issue.currentAttempt,
              actor: `briar-worker:${activeProject.executionWorker?.workerId ?? "unknown"}`,
              repository: issue.repository,
              model: execution.model,
              occurredAt: new Date().toISOString(),
            }),
          ),
        });
        return;
      }
      const turnFailure = detachedProviderTurnFailure(turn);

      const runtimeConfig = decodeConfig(
        JSON.parse(await readFile(join(runtimeDirectory, "config.json"), "utf8")),
      );
      const disposition = detachedRunDisposition(
        runtimeConfig.projects.find((candidate) => candidate.id === project.id)
          ?.activeClaim,
        issue.runId,
      );
      const turnDecision = detachedRunTurnDecision(disposition, turnFailure);
      if (turnDecision === "stop") return;

      if (turnDecision === "recover" && turnFailure) {
        consecutiveProviderTurnFailures += 1;
        console.error(
          `recovering ${issue.sourceKey}: agent turn ${turnNumber} failed while the run remained active: ${turnFailure}`,
        );
        nextPrompt = detachedRunRecoveryPrompt({
          runId: issue.runId,
          sourceKey: issue.sourceKey,
          failure: turnFailure,
        });
        if (!conversationId) {
          nextPrompt = `${nextPrompt}\n\nThe provider did not return a reusable conversation ID, so the durable issue context follows again.\n\n${prompt}`;
        }
        await interruptibleSleep(
          errorDelayMs(consecutiveProviderTurnFailures, 30_000),
          signal,
        );
        continue;
      }
      consecutiveProviderTurnFailures = 0;

      console.error(
        `continuing ${issue.sourceKey}: agent turn ${turnNumber} ended while the run remained active`,
      );
      nextPrompt = detachedRunContinuationPrompt({
        runId: issue.runId,
        sourceKey: issue.sourceKey,
      });
      if (!conversationId) {
        nextPrompt = `${nextPrompt}\n\nThe provider did not return a reusable conversation ID, so the durable issue context follows again.\n\n${prompt}`;
      }
    }
  } catch (error) {
    if (!signal.aborted) {
      try {
        await request(config.apiUrl, "/run-events", workerToken, {
          method: "POST",
          headers: { "X-Briar-Claim-Token": issue.claimToken },
          body: JSON.stringify({
            runId: issue.runId,
            status: "failed",
            workflowStage: null,
            eventKey: `detached:${issue.currentAttempt}:agent-failed`,
            occurredAt: new Date().toISOString(),
            actor: `briar-worker:${activeProject.executionWorker?.workerId ?? "unknown"}`,
            repository: issue.repository,
            detail: error instanceof Error ? error.message : String(error),
            pullRequestUrls: [],
          }),
        });
      } catch {
        // A cancellation or reassignment invalidates the claim before the
        // process exits. That expected late write must not hide the root error.
      }
    }
    throw error;
  } finally {
    await transcriptBatcher.flush();
    const usageObservations = usageCollector.finish();
    const usageRecords = agentExecutionUsageRecordsFromObservations(
      usageObservations,
    );
    const costRecords = agentExecutionCostRecordsFromObservations(
      usageCollector.finishCosts(),
    );
    const executionMetrics = agentExecutionMetrics(
      Date.now() - executionStartedAt,
      agentExecutionTokenUsageFromObservations(usageObservations),
    );
    try {
      const metricsPayload = {
        projectId: project.id,
        sessionId,
        runId: issue.runId,
        runAttempt: issue.currentAttempt,
        workType: "issue" as const,
        workId: issue.runId,
        claimToken: issue.claimToken,
        ...(issue.executionId ? { executionId: issue.executionId } : {}),
        workerId: activeProject.executionWorker?.workerId,
        agentProvider: provider,
        executionMetrics,
        ...(issue.executionId && usageRecords.length > 0
          ? { usageRecords }
          : {}),
        ...(issue.executionId && costRecords.length > 0
          ? { costRecords }
          : {}),
        events: [
          {
            sequence: transcriptSequencer.next(),
            direction: "server",
            payload: { type: "execution.metrics", executionMetrics },
          },
        ],
      };
      await uploadExecutionMetricsWithCostCompatibility({
        payload: metricsPayload,
        send: (payload) =>
          request(config.apiUrl, "/transcripts", workerToken, {
            method: "POST",
            body: JSON.stringify(payload),
          }),
      });
    } catch (error) {
      console.error(
        `execution metrics upload failed for ${issue.sourceKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (workspace.type === "worktree") {
      try {
        let completedAt: string | undefined;
        try {
          const runtimeConfig = decodeConfig(
            JSON.parse(await readFile(join(runtimeDirectory, "config.json"), "utf8")),
          );
          const runtimeClaim = runtimeConfig.projects.find(
            (candidate) => candidate.id === project.id,
          )?.activeClaim;
          if (
            runtimeClaim?.runId === issue.runId &&
            runtimeClaim.terminalStatus === "completed"
          ) {
            completedAt = runtimeClaim.finishedAt;
          }
        } catch {
          // Maintenance still compacts reproducible artifacts without a
          // completion timestamp; deletion remains disabled.
        }
        if (completedAt) {
          await recordCompletedWorktree(
            projectWorktreeRoot(worktreeSettings(project).root, project.id),
            {
              runId: issue.runId,
              path: workspace.path,
              branch: workspace.branch,
              completedAt,
            },
          );
        }
        const maintenance = await maintainTerminalIssueWorktree(
          runGit,
          project.repositoryPath,
          { path: workspace.path, branch: workspace.branch },
          { baseRef: workspace.baseRef, ...(completedAt ? { completedAt } : {}) },
        );
        console.error(
          `worktree maintenance for ${issue.sourceKey}: ${JSON.stringify(maintenance)}`,
        );
      } catch (error) {
        console.error(
          `worktree maintenance failed for ${issue.sourceKey}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}

async function runClaimedProjectAgentTask(
  config: Config,
  project: ProjectConfig,
  task: ClaimedProjectAgentTask,
  workerToken: string,
  workerId: string,
  signal: AbortSignal,
  reportCheckpoint?: (value: WorkerExecutionCheckpoint) => void,
) {
  const workspacePath = project.repositoryPath;
  reportCheckpoint?.({ workspacePath });
  const organizationId = project.executionWorker?.organizationId;
  if (!organizationId) throw new Error("Worker registration is missing");
  const agent: DetachedAgent = {
    ...detachedAgentWithActiveSkill(task.agent, task.activeSkill),
    scope: { kind: "project", organizationId, projectId: project.id },
  };
  const prompt = detachedProjectAgentPrompt({
    agent,
    request: task.request,
    workspacePath,
  });
  const transcriptSequencer = createDetachedTranscriptSequencer(
    task.claimAttempts,
  );
  // Direct Agent tasks are not Hunt runs. Their task/session UUID is the
  // durable transcript key, while attempt-scoped sequence ranges make Worker
  // retries append safely without requiring a Hunt-run binding.
  const transcriptEnvelope = {
    projectId: project.id,
    sessionId: task.workId,
    runId: task.runId,
    workType: "projectAgentTask" as const,
    workId: task.workId,
    claimToken: task.claimToken,
    workerId,
    agentProvider: agent.provider,
  };
  const transcriptBatcher = new TranscriptBatcher({
    send: async (events) => {
      await request(config.apiUrl, "/transcripts", workerToken, {
        method: "POST",
        body: serializeTranscriptRequest(transcriptEnvelope, events),
      });
    },
    measureBytes: (events) =>
      Buffer.byteLength(
        serializeTranscriptRequest(transcriptEnvelope, events),
        "utf8",
      ),
    isPayloadTooLarge: isTranscriptPayloadTooLarge,
    onError: (error) => {
      console.error(
        `transcript upload failed for ${task.sourceKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  });
  let conversationId: string | null = task.handoffContext?.conversationId ?? null;
  if (conversationId) reportCheckpoint?.({ conversationId });
  const turn = await (async () => {
    try {
      return await runDetachedProviderTurn({
        agent,
        prompt,
        workspacePath,
        fullAccess: project.autoHunt?.sandbox?.fullAccess ?? true,
        conversationId,
        environment: providerExecutionEnvironment(config, agent.provider, {
          ...process.env,
          PATH: workerExecutionPath(),
          BRIAR_CLI: workerCliPath(),
          BRIAR_WORKER_TOKEN: workerToken,
          BRIAR_PROJECT_ID: project.id,
        }),
        signal,
        onConversationId: (nextConversationId) => {
          conversationId = nextConversationId;
          reportCheckpoint?.({ conversationId: nextConversationId });
        },
        onPayload: async (rawPayload, line) => {
          const payload = detachedTranscriptPayload(rawPayload, line);
          const sequence = transcriptSequencer.nextForPayload(payload);
          if (sequence === null) return;
          await transcriptBatcher.enqueue({
            sequence,
            direction: detachedPayloadDirection(rawPayload),
            payload,
          });
        },
      });
    } finally {
      // Transcript telemetry remains optional, but buffered progress deserves
      // one final upload attempt before the durable task result is settled.
      await transcriptBatcher.flush();
    }
  })();
  assertDetachedProviderTurnSucceeded(turn);
  if (!turn.resultText) throw new Error("Agent returned an empty direct-run summary");
  return {
    projectId: project.id,
    workerId,
    claimToken: task.claimToken,
    summary: turn.resultText.slice(0, 50_000),
    conversationId: turn.conversationId ?? conversationId,
  };
}

async function completeClaimedProjectAgentTask(
  config: Config,
  task: ClaimedProjectAgentTask,
  workerToken: string,
  completion: {
    projectId: string;
    workerId: string;
    claimToken: string;
    summary: string;
    conversationId: string | null;
  },
  signal: AbortSignal,
) {
  await request(
    config.apiUrl,
    `/agent-task-claims/${task.workId}/complete`,
    workerToken,
    {
      method: "POST",
      signal,
      body: JSON.stringify(completion),
    },
  );
}

async function failClaimedProjectAgentTask(
  config: Config,
  project: ProjectConfig,
  task: ClaimedProjectAgentTask,
  workerToken: string,
  error: unknown,
) {
  const workerId = project.executionWorker?.workerId;
  if (!workerId) throw error;
  await request(
    config.apiUrl,
    `/agent-task-claims/${task.workId}/complete`,
    workerToken,
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        workerId,
        claimToken: task.claimToken,
        error: error instanceof Error ? error.message : String(error),
      }),
    },
  );
}

async function runClaimedIssueReply(
  config: Config,
  project: ProjectConfig,
  issue: ClaimedIssueReply,
  workerToken: string,
  signal: AbortSignal,
  reportCheckpoint?: (value: WorkerExecutionCheckpoint) => void,
) {
  const registered = project.executionWorker;
  if (!registered) throw new Error("Worker registration is missing");
  const provider = issue.provider;
  const trigger = issue.snapshot.messages.find(
    (message) => message.id === issue.triggerMessageId,
  );
  if (!trigger) throw new Error("Mention message is missing from the reply snapshot");
  const projectUsesWorktrees = worktreesEnabled(project);
  const settings = worktreeSettings(project);
  const worktreeRoot = projectWorktreeRoot(settings.root, project.id);
  // A running issue must see the processing Worker's uncommitted files. An
  // unassigned issue has no execution worktree yet, so its read-only replies
  // share a short-lived analysis checkout instead.
  const configuredWorktree = projectUsesWorktrees
    ? findExistingIssueWorktree(
        runGit,
        project.repositoryPath,
        worktreeRoot,
        {
          runId: issue.runId,
          sourceKey: issue.sourceKey,
          title: issue.title,
        },
        issue.branch,
      )
    : null;
  const workspaceMode = issueReplyWorkspaceMode({
    worktreesEnabled: projectUsesWorktrees,
    hasConfiguredWorktree: configuredWorktree !== null,
    requiresPreferredWorker: issue.requiresPreferredWorker,
    branch: issue.branch,
  });
  if (workspaceMode === "missing-required") {
    throw new Error(
      "The issue processing worktree is not available on this Worker",
    );
  }
  const cachedAnalysisPath =
    workspaceMode === "cached-analysis"
      ? analysisWorktreePath(settings.root, project.id, issue.runId)
      : null;
  let cachedAnalysisWorktree:
    | Awaited<ReturnType<typeof allocateCachedAnalysisWorktree>>
    | null = null;
  if (cachedAnalysisPath) {
    retainCachedAnalysisWorktree(cachedAnalysisPath);
    try {
      cachedAnalysisWorktree = await allocateCachedAnalysisWorktree({
        repositoryPath: project.repositoryPath,
        projectId: project.id,
        runId: issue.runId,
        settings,
        git: runGit,
      });
    } catch (error) {
      releaseCachedAnalysisWorktree(cachedAnalysisPath);
      throw error;
    }
  }
  const workspacePath =
    configuredWorktree?.path ??
    cachedAnalysisWorktree?.path ??
    project.repositoryPath;
  reportCheckpoint?.({ workspacePath });
  const imageDirectory = await mkdtemp(join(tmpdir(), "briar-issue-reply-images-"));
  let imagesCleaned = false;
  let lastActivityErrorAt = Number.NEGATIVE_INFINITY;
  const activityPublisher = new ChannelActivityPublisher({
    credential: issue.activity,
    send: async (credential, input) => {
      await request(
        config.apiUrl,
        `/issue-reply-claims/${issue.workId}/activity`,
        null,
        {
          method: "POST",
          headers: {
            "X-Briar-Channel-Activity-Token": credential.token,
          },
          body: JSON.stringify(input),
        },
      );
    },
    onError: (error) => {
      const now = Date.now();
      if (now - lastActivityErrorAt < 60_000) return;
      lastActivityErrorAt = now;
      console.error(
        `issue activity publish failed for ${issue.workId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  });
  activeReplyActivityPublishers.set(issue.workId, activityPublisher);
  const cleanupContext = () =>
    cleanupChannelReplyResources([
      {
        label: "issue reply images",
        run: async () => {
          if (imagesCleaned) return;
          await rm(imageDirectory, { recursive: true, force: true });
          imagesCleaned = true;
        },
      },
    ]);
  try {
    await mkdir(imageDirectory, { recursive: true, mode: 0o700 });
    const downloadedImages = await Promise.all(
      trigger.attachments
        .filter((attachment) => attachment.contentType.startsWith("image/"))
        .map(async (attachment) => ({
          ...attachment,
          localPath: await downloadClaimAttachment(
            config.apiUrl,
            workerToken,
            project.id,
            issue.runId,
            attachment,
            imageDirectory,
          ),
        })),
    );
    const attachments = agentImageAttachments(downloadedImages);
    const agent = detachedReplyAgent({
      workId: issue.workId,
      provider,
      model: issue.model,
      effort: issue.effort,
      agent: issue.agent,
      activeSkill: issue.activeSkill,
      snapshot: issue.snapshot,
      fallbackName: "Project Agent",
      scope: {
        kind: "project",
        organizationId: registered.organizationId,
        projectId: project.id,
      },
    });
    if (
      issue.skillExecutionTarget &&
      (issue.skillExecutionTarget.projectId !== project.id ||
        issue.skillExecutionTarget.agentId !== agent.id ||
        issue.skillExecutionTarget.skillId !== agent.activeSkill?.id ||
        issue.skillExecutionTarget.skillName !== agent.activeSkill?.name ||
        issue.skillExecutionTarget.request !== trigger.body)
    ) {
      throw new Error(
        "Issue reply Skill execution target does not match its claimed context",
      );
    }
    const prompt = detachedIssueReplyPrompt({
      agent,
      snapshot: {
        ...issue.snapshot,
        downloadedImagePaths: attachments.map((attachment) => attachment.path),
      },
      userMessage: trigger.body,
      workspaceAvailable: true,
      workspaceShared: workspaceMode !== "cached-analysis",
      skillExecutionTarget: issue.skillExecutionTarget,
    });
    let sequence = 0;
    const transcriptEnvelope = {
      projectId: project.id,
      sessionId: `reply-${issue.workId}`,
      runId: issue.runId,
      workType: "issueReply" as const,
      workId: issue.workId,
      claimToken: issue.claimToken,
      workerId: registered.workerId,
      agentProvider: provider,
    };
    const transcriptBatcher = new TranscriptBatcher({
      send: async (events) => {
        await request(config.apiUrl, "/transcripts", workerToken, {
          method: "POST",
          body: serializeTranscriptRequest(transcriptEnvelope, events),
        });
      },
      measureBytes: (events) =>
        Buffer.byteLength(
          serializeTranscriptRequest(transcriptEnvelope, events),
          "utf8",
        ),
      isPayloadTooLarge: isTranscriptPayloadTooLarge,
      onError: (error) => {
        console.error(
          `transcript upload failed for reply ${issue.workId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      },
    });
    let conversationId: string | null = issue.handoffContext?.conversationId ?? null;
    if (conversationId) reportCheckpoint?.({ conversationId });
    const turn = await (async () => {
      try {
        return await runDetachedProviderTurn({
          agent,
          prompt,
          workspacePath,
          fullAccess: false,
          readOnly: true,
          attachments,
          conversationId,
          outputSchema: detachedIssueReplyOutputSchema,
          environment: providerExecutionEnvironment(config, agent.provider, {
            ...process.env,
            PATH: workerExecutionPath(),
            BRIAR_CLI: workerCliPath(),
            BRIAR_WORKER_TOKEN: workerToken,
            BRIAR_PROJECT_ID: project.id,
          }),
          signal,
          onConversationId: (nextConversationId) => {
            conversationId = nextConversationId;
            reportCheckpoint?.({ conversationId: nextConversationId });
          },
          onPayload: async (payload, line) => {
            activityPublisher.observePayload(payload);
            sequence += 1;
            const direction = detachedPayloadDirection(payload);
            const bounded = detachedTranscriptPayload(payload, line);
            if (shouldPersistDetachedTranscriptPayload(bounded)) {
              await transcriptBatcher.enqueue({
                sequence,
                direction,
                payload: bounded,
              });
            }
          },
        });
      } finally {
        // The durable reply result remains more important than optional
        // transcript data, but buffered events must get one final send chance.
        await transcriptBatcher.flush();
      }
    })();
    assertDetachedProviderTurnSucceeded(turn);
    if (!turn.resultText) throw new Error("Agent returned an empty issue reply");
    const result = parseDetachedIssueReplyResult(turn.resultText, {
      allowSkillExecutionProposal: issue.skillExecutionTarget !== null,
    });
    if (!result.reply) throw new Error("Agent returned an empty issue reply");
    // Private downloaded images must be removed before the durable reply
    // succeeds. Worktree cache bookkeeping is best-effort in the outer cleanup.
    await cleanupContext();
    await request(
      config.apiUrl,
      `/issue-reply-claims/${issue.workId}/complete`,
      workerToken,
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          workerId: registered.workerId,
          claimToken: issue.claimToken,
          body: result.reply,
          proposedAction: result.proposedAction,
          executionProposal: result.executionProposal,
          skillExecutionProposal: result.skillExecutionProposal,
        }),
      },
    );
  } finally {
    activityPublisher.stop();
    if (activeReplyActivityPublishers.get(issue.workId) === activityPublisher) {
      activeReplyActivityPublishers.delete(issue.workId);
    }
    try {
      await cleanupContext();
    } finally {
      if (cachedAnalysisWorktree && cachedAnalysisPath) {
        try {
          await markCachedAnalysisWorktreeIdle({
            root: worktreeRoot,
            runId: issue.runId,
            worktree: cachedAnalysisWorktree,
          });
        } catch (error) {
          console.error(
            `analysis worktree cache update failed for ${issue.runId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        } finally {
          releaseCachedAnalysisWorktree(cachedAnalysisPath);
        }
      }
    }
  }
}

async function failClaimedIssueReply(
  config: Config,
  project: ProjectConfig,
  issue: ClaimedIssueReply,
  workerToken: string,
  error: unknown,
) {
  const workerId = project.executionWorker?.workerId;
  if (!workerId) throw error;
  await request(
    config.apiUrl,
    `/issue-reply-claims/${issue.workId}/complete`,
    workerToken,
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        workerId,
        claimToken: issue.claimToken,
        error: error instanceof Error ? error.message : String(error),
      }),
    },
  );
}

async function runClaimedChannelReply(
  config: Config,
  project: ProjectConfig,
  reply: ClaimedChannelReply,
  workerToken: string,
  signal: AbortSignal,
  reportCheckpoint?: (value: WorkerExecutionCheckpoint) => void,
) {
  const registered = project.executionWorker;
  if (!registered) throw new Error("Worker registration is missing");
  assertChannelReplyWorkspaceScope(reply, project.id);
  const analysisWorktree = reply.projectId
    ? await allocateAnalysisWorktree({
        repositoryPath: project.repositoryPath,
        projectId: project.id,
        workId: reply.workId,
        settings: worktreeSettings(project),
        git: runGit,
      })
    : null;
  const workspacePath =
    analysisWorktree?.path ??
    join(configDirectory, "worker-sessions", `channel-${reply.workId}`);
  reportCheckpoint?.({ workspacePath });
  if (!analysisWorktree) {
    // A prior hard-killed attempt may have left a path behind. Recreate the
    // exact claim workspace so stale files or a planted symlink cannot become
    // trusted Organization Agent context.
    await prepareOrganizationAgentWorkspace(workspacePath);
  }
  const imageDirectory = channelReplyImageDirectory(workspacePath);
  let organizationContextCleaned = false;
  let imagesCleaned = false;
  let workspaceCleaned = false;
  let lastActivityErrorAt = Number.NEGATIVE_INFINITY;
  const activityPublisher = new ChannelActivityPublisher({
    credential: reply.activity,
    send: async (credential, input) => {
      await request(
        config.apiUrl,
        `/channel-reply-claims/${reply.workId}/activity`,
        null,
        {
          method: "POST",
          headers: {
            "X-Briar-Channel-Activity-Token": credential.token,
          },
          body: JSON.stringify(input),
        },
      );
    },
    onError: (error) => {
      const now = Date.now();
      if (now - lastActivityErrorAt < 60_000) return;
      lastActivityErrorAt = now;
      console.error(
        `channel activity publish failed for ${reply.workId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  });
  activeReplyActivityPublishers.set(reply.workId, activityPublisher);
  const cleanupContext = () =>
    cleanupChannelReplyResources([
      ...(reply.scope.kind === "organization"
        ? [{
            label: "organization context",
            run: async () => {
              if (organizationContextCleaned) return;
              await cleanupOrganizationAgentContext(workspacePath);
              organizationContextCleaned = true;
            },
          }]
        : []),
      {
        label: "channel images",
        run: async () => {
          if (imagesCleaned) return;
          await cleanupChannelReplyImages(imageDirectory);
          imagesCleaned = true;
        },
      },
      {
        label: analysisWorktree ? "analysis worktree" : "channel workspace",
        run: async () => {
          if (workspaceCleaned) return;
          if (analysisWorktree) {
            await removeAnalysisWorktree({
              repositoryPath: project.repositoryPath,
              path: analysisWorktree.path,
              git: runGit,
            });
          } else {
            await rm(workspacePath, { recursive: true, force: true });
          }
          workspaceCleaned = true;
        },
      },
    ]);
  try {
    const organizationContext = reply.scope.kind === "organization"
      ? await downloadOrganizationAgentContextManifest({
          apiUrl: config.apiUrl,
          workerToken,
          organizationId: reply.organizationId,
          workId: reply.workId,
          workerId: registered.workerId,
          claimToken: reply.claimToken,
          snapshotAt: reply.organizationContext!.snapshotAt,
          workspacePath,
          signal,
        })
      : null;
    const downloadedImages = await downloadChannelReplyImages({
      apiUrl: config.apiUrl,
      workerToken,
      organizationId: reply.organizationId,
      workId: reply.workId,
      claimToken: reply.claimToken,
      triggerMessageId: reply.triggerMessageId,
      snapshot: reply.snapshot,
      workspacePath,
    });
    const agent = detachedReplyAgent({
      workId: reply.workId,
      provider: reply.provider,
      model: reply.model,
      effort: reply.effort,
      agent: reply.agent,
      activeSkill: reply.activeSkill,
      snapshot: reply.snapshot,
      fallbackName: "Briar Channel",
      scope: reply.scope,
    });
    const prompt = detachedChannelReplyPrompt({
      agent,
      snapshot: {
        ...reply.snapshot,
        downloadedImagePaths: downloadedImages.paths,
      },
      workspaceAvailable: Boolean(analysisWorktree),
      organizationContextAvailable: organizationContext !== null,
      delegationTargets: reply.delegationTargets,
      delegation: reply.delegation,
      skillExecutionTarget: reply.skillExecutionTarget,
    });
    let conversationId: string | null = reply.handoffContext?.conversationId ?? null;
    if (conversationId) reportCheckpoint?.({ conversationId });
    let lookupRounds = 0;
    let turnPrompt = prompt;
    let result: ReturnType<typeof parseChannelReplyAgentResult>["result"] | null =
      null;
    let attachmentPaths: string[] = [];
    while (!result) {
      const turn = await runDetachedProviderTurn({
        agent,
        prompt: turnPrompt,
        workspacePath,
        fullAccess: project.autoHunt?.sandbox?.fullAccess ?? true,
        conversationId,
        attachments: lookupRounds === 0
          ? downloadedImages.attachments
          : undefined,
        outputSchema: detachedChannelReplyOutputSchema,
        organizationContextManifestPath:
          organizationContext?.manifestPath ?? null,
        delegationTargets: reply.scope.kind === "organization"
          ? reply.delegationTargets
          : undefined,
        environment: providerExecutionEnvironment(config, agent.provider, {
          ...process.env,
          PATH: workerExecutionPath(),
          BRIAR_CLI: workerCliPath(),
          BRIAR_WORKER_TOKEN: workerToken,
          BRIAR_PROJECT_ID: project.id,
        }),
        signal,
        onConversationId: (nextConversationId) => {
          conversationId = nextConversationId;
          reportCheckpoint?.({ conversationId: nextConversationId });
        },
        onPayload: (payload) => {
          activityPublisher.observePayload(payload);
        },
      });
      assertDetachedProviderTurnSucceeded(turn);
      if (!turn.resultText) {
        throw new Error("Agent returned an empty channel reply");
      }
      const parsed = parseDetachedJsonResult(turn.resultText);
      const parsedRecord = parsed && typeof parsed === "object" &&
          !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
      const contextRequests = parsedRecord?.contextRequests;
      if (contextRequests === null || contextRequests === undefined) {
        const parsedResult = parseChannelReplyAgentResult(parsed);
        result = parsedResult.result;
        attachmentPaths = parsedResult.attachmentPaths;
        break;
      }
      const lookup = decodeOrganizationAgentContextRequestTurn({
        contextRequests,
      });
      if (
        parsedRecord?.body !== null ||
        !Array.isArray(parsedRecord.attachments) ||
        parsedRecord.attachments.length !== 0 ||
        parsedRecord.document !== null ||
        parsedRecord.issueProposal !== null ||
        parsedRecord.executionProposal !== null ||
        parsedRecord.skillExecutionProposal !== null ||
        parsedRecord.delegation !== null
      ) {
        throw new Error(
          "Organization context lookup cannot include a channel reply or proposal",
        );
      }
      if (!organizationContext) {
        throw new Error(
          "Project reply cannot request organization context",
        );
      }
      if (lookupRounds >= 3) {
        throw new Error("Organization Agent context lookup limit exceeded");
      }
      const hydrated = await hydrateOrganizationAgentContext({
        apiUrl: config.apiUrl,
        workerToken,
        organizationId: reply.organizationId,
        workId: reply.workId,
        workerId: registered.workerId,
        claimToken: reply.claimToken,
        snapshotAt: reply.organizationContext!.snapshotAt,
        workspacePath,
        requests: lookup.contextRequests,
        signal,
      });
      if (hydrated.loaded === 0) {
        throw new Error("Organization Agent repeated a loaded context query");
      }
      lookupRounds += 1;
      conversationId = turn.conversationId;
      const continuation = [
        `Briar loaded ${hydrated.loaded} requested organization context file(s).`,
        `Re-read the manifest at ${JSON.stringify(hydrated.manifestPath)} and the newly referenced lookup files.`,
        "Use those facts to continue. Request another smallest-possible lookup only if essential; otherwise return the normal channel reply JSON now.",
      ].join("\n\n");
      turnPrompt = conversationId ? continuation : `${prompt}\n\n${continuation}`;
    }
    if (!result) throw new Error("Agent returned no channel reply");
    if (result.skillExecutionProposal && !reply.skillExecutionTarget) {
      throw new Error(
        "Channel reply Agent Skill execution target is not authorized",
      );
    }
    // Read reply images before the disposable workspace disappears. Private
    // inbound context must still be gone before the durable reply completes.
    const replyImages = await collectChannelReplyAttachments({
      workspacePath,
      paths: attachmentPaths,
    });
    await cleanupContext();
    await request(
      config.apiUrl,
      `/channel-reply-claims/${reply.workId}/complete`,
      workerToken,
      {
        method: "POST",
        body: channelReplyCompleteRequestBody({
          organizationId: reply.organizationId,
          workerId: registered.workerId,
          claimToken: reply.claimToken,
          result,
          attachments: replyImages,
        }),
      },
    );
  } finally {
    activityPublisher.stop();
    if (activeReplyActivityPublishers.get(reply.workId) === activityPublisher) {
      activeReplyActivityPublishers.delete(reply.workId);
    }
    await cleanupContext();
  }
}

async function failClaimedChannelReply(
  config: Config,
  project: ProjectConfig,
  reply: ClaimedChannelReply,
  workerToken: string,
  error: unknown,
) {
  const workerId = project.executionWorker?.workerId;
  if (!workerId) throw error;
  await request(
    config.apiUrl,
    `/channel-reply-claims/${reply.workId}/complete`,
    workerToken,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: reply.organizationId,
        workerId,
        claimToken: reply.claimToken,
        error: error instanceof Error ? error.message : String(error),
      }),
    },
  );
}

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

const runMergeQueueCommand: MergeQueueCommandRunner = (command, options = {}) => {
  const result = Bun.spawnSync(command, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
    ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

async function runClaimedMergeBatch(
  config: Config,
  project: ProjectConfig,
  batch: ClaimedMergeBatch,
  workerToken: string,
  workerId: string,
  signal: AbortSignal,
  reportCheckpoint?: (value: WorkerExecutionCheckpoint) => void,
) {
  const operation = <T>(name: string, body: Record<string, unknown>) =>
    request<T>(
      config.apiUrl,
      `/merge-batch-claims/${batch.workId}/${name}`,
      workerToken,
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          workerId,
          claimToken: batch.claimToken,
          ...body,
        }),
      },
    );
  let worktreePath: string | null = null;
  let syntheticSha = batch.mergeGroupSha;
  try {
    verifyNativeMergeQueue(
      runMergeQueueCommand,
      batch.repository,
      batch.baseBranch,
    );
    if (batch.state === "awaiting_merge") {
      if (!batch.mergeGroupRef || !batch.mergeGroupSha) {
        throw new Error("Awaiting merge batch lost its exact merge-group identity");
      }
      const liveGroup = runMergeQueueCommand([
        "gh",
        "api",
        `repos/${batch.repository}/git/ref/${batch.mergeGroupRef.replace(/^refs\//u, "")}`,
      ]);
      if (liveGroup.exitCode !== 0) {
        throw new Error("GitHub merge-group ref disappeared before status recovery");
      }
      assertLiveMergeGroupSha(liveGroup.stdout, batch.mergeGroupSha);
      // The server transition durably proves validation passed. Rechecking its
      // fences makes status publication idempotently recoverable after a crash.
      await operation("validation", { mergeGroupSha: batch.mergeGroupSha });
      for (const context of batch.statusContexts) {
        publishCommitStatus(runMergeQueueCommand, {
          repository: batch.repository,
          sha: batch.mergeGroupSha,
          context,
          state: "success",
          description: "Briar merge-group validation passed",
        });
      }
      return;
    }

    for (const member of batch.members) {
      if (signal.aborted) throw signal.reason ?? new Error("Merge batch aborted");
      if (member.state === "merged") continue;
      const queueEntryId = inspectAndEnqueueMember(
        runMergeQueueCommand,
        batch,
        member,
      );
      await operation("enqueue", {
        candidateId: member.id,
        expectedHeadSha: member.frozenHeadSha,
        queueEntryId,
      });
    }

    let mergeGroup = batch.mergeGroupRef && batch.mergeGroupSha
      ? { ref: batch.mergeGroupRef, sha: batch.mergeGroupSha }
      : null;
    for (let attempt = 0; !mergeGroup && attempt < 120; attempt += 1) {
      if (signal.aborted) throw signal.reason ?? new Error("Merge batch aborted");
      const refs = runMergeQueueCommand([
        "gh",
        "api",
        `repos/${batch.repository}/git/matching-refs/heads/gh-readonly-queue/${encodeURIComponent(batch.baseBranch)}/`,
      ]);
      if (refs.exitCode !== 0) {
        throw new Error(
          `GitHub merge-group refs could not be read: ${refs.stderr.trim()}`,
        );
      }
      mergeGroup = mergeGroupContainingAllMembers(
        runGit,
        project.repositoryPath,
        batch,
        parseMergeGroupRefs(refs.stdout),
      );
      if (!mergeGroup) await interruptibleSleep(5_000, signal);
    }
    if (!mergeGroup) {
      throw new Error(
        "GitHub did not create one merge group containing every frozen batch member",
      );
    }
    syntheticSha = mergeGroup.sha;
    await operation("merge-group", {
      mergeGroupRef: mergeGroup.ref,
      mergeGroupSha: mergeGroup.sha,
    });

    const worktree = await allocateMergeGroupWorktree({
      repositoryPath: project.repositoryPath,
      projectId: project.id,
      batchId: batch.workId,
      mergeGroupSha: mergeGroup.sha,
      settings: worktreeSettings(project),
      git: runGit,
    });
    worktreePath = worktree.path;
    reportCheckpoint?.({ workspacePath: worktree.path });
    const validation = Bun.spawn(
      ["/bin/bash", "-lc", batch.validationCommand],
      {
        cwd: worktree.path,
        stdout: "inherit",
        stderr: "inherit",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" },
        signal,
      },
    );
    const exitCode = await validation.exited;
    const checkedHead = runGit(["rev-parse", "HEAD"], { cwd: worktree.path });
    if (checkedHead.exitCode !== 0 || checkedHead.stdout.trim() !== mergeGroup.sha) {
      throw new Error("Synthetic merge-group SHA changed during validation");
    }
    const liveGroup = runMergeQueueCommand([
      "gh",
      "api",
      `repos/${batch.repository}/git/ref/${mergeGroup.ref.replace(/^refs\//u, "")}`,
    ]);
    if (liveGroup.exitCode !== 0) {
      throw new Error("GitHub merge-group ref disappeared during validation");
    }
    assertLiveMergeGroupSha(liveGroup.stdout, mergeGroup.sha);
    // The server-side renewal rechecks the lease immediately before statuses
    // are published, so a superseded coordinator cannot bless stale output.
    await operation("lease", {});
    if (exitCode !== 0) {
      for (const context of batch.statusContexts) {
        publishCommitStatus(runMergeQueueCommand, {
          repository: batch.repository,
          sha: mergeGroup.sha,
          context,
          state: "failure",
          description: "Briar merge-group validation failed",
        });
      }
      throw new Error(`Merge-group validation failed with exit code ${exitCode}`);
    }
    // The durable service approves the exact SHA, current revisions, and live
    // lease before any success context can become authoritative on GitHub.
    await operation("validation", { mergeGroupSha: mergeGroup.sha });
    for (const context of batch.statusContexts) {
      publishCommitStatus(runMergeQueueCommand, {
        repository: batch.repository,
        sha: mergeGroup.sha,
        context,
        state: "success",
        description: "Briar merge-group validation passed",
      });
    }
  } catch (error) {
    if (!signal.aborted) {
      const detail = error instanceof Error ? error.message : String(error);
      const blocked = /Require merge queue|branch rules|could not be read|authenticated/iu
        .test(detail);
      try {
        await operation("failure", {
          outcome: blocked ? "blocked" : "failed",
          code: blocked ? "merge_queue_unavailable" : "merge_batch_failed",
          detail,
        });
      } catch {
        // A lost lease is expected to reject this late failure write. The
        // durable frozen batch remains recoverable by the next coordinator.
      }
    }
    throw error;
  } finally {
    if (worktreePath) {
      try {
        await removeAnalysisWorktree({
          repositoryPath: project.repositoryPath,
          path: worktreePath,
          git: runGit,
        });
      } catch (error) {
        console.error(
          `merge-group worktree cleanup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
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
  let lastWorktreeSweepAt = Number.NEGATIVE_INFINITY;
  let lastAnalysisWorktreeSweepAt = Number.NEGATIVE_INFINITY;
  let lastTriggeredUpdateId: string | null = null;
  const result = await runWorkerLoop(
    {
      claim: async (_options) => {
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
        const work = workType === "issueReply"
          ? decodeClaimedIssueReply(claim.work)
          : workType === "mergeBatch"
            ? decodeClaimedMergeBatch(claim.work)
          : workType === "projectAgentTask"
            ? decodeClaimedProjectAgentTask(claim.work)
            : workType === "channelReply"
              ? decodeClaimedChannelReply(claim.work)
              : decodeClaimedRun(claim.work);
        return { work };
      },
      renewLease: async (issue) => {
        if (issue.workType === "mergeBatch") {
          const batch = decodeClaimedMergeBatch(issue);
          await request(
            config.apiUrl,
            `/merge-batch-claims/${batch.workId}/lease`,
            workerToken,
            {
              method: "POST",
              body: JSON.stringify({
                projectId: project.id,
                workerId,
                claimToken: batch.claimToken,
              }),
            },
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
        const workType = issue.workType ?? "issue";
        // A merge batch has no provider conversation to transfer. Stopping
        // renewal lets its durable lease expire and the next Worker resumes
        // the same frozen batch without touching any issue worktree/evidence.
        if (workType === "mergeBatch") return;
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
          await runClaimedMergeBatch(
            config,
            project,
            decodeClaimedMergeBatch(issue),
            workerToken,
            workerId,
            signal,
            reportCheckpoint,
          );
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

const skillsUsage = `Briar bundled skill guides

  briar skills list [--json]
  briar skills get <topic> [--json]
`;

function listSkillGuides() {
  const topics = skillGuides.map(({ name, description }) => ({ name, description }));
  if (has("--json")) {
    console.log(JSON.stringify({ version: cliVersion, topics }, null, 2));
    return;
  }
  process.stdout.write(
    `${topics.map((topic) => `${topic.name}: ${topic.description}`).join("\n")}\n`,
  );
}

async function showSkillGuide() {
  const topic = args[2];
  if (!topic || topic === "--help") {
    console.log("Usage: briar skills get <topic> [--json]");
    return;
  }
  const guide = getSkillGuide(topic);
  if (!guide) {
    throw new Error(
      `Unknown skill topic "${topic}". Available topics: ${skillGuides
        .map((candidate) => candidate.name)
        .join(", ")}`,
    );
  }
  const markdown = topic === "browser"
    ? configureBrowserSkillGuide(
        guide.markdown,
        (await loadConfig()).appSettings.browserAutomationProvider,
      )
    : guide.markdown;
  if (has("--json")) {
    console.log(
      JSON.stringify(
        {
          name: guide.name,
          version: cliVersion,
          markdown,
        },
        null,
        2,
      ),
    );
    return;
  }
  process.stdout.write(
    markdown.endsWith("\n") ? markdown : `${markdown}\n`,
  );
}

const usage = `Briar CLI

  briar login
  briar skills list [--json]
  briar skills get <topic> [--json]
  briar project create [--name <name>]
  briar connect --project-id <uuid> --agent-token <token>
  briar project doctor
  briar merge-queue configure [--repository <owner/name>] [--base-branch <branch>]
    [--quiet-window-ms <milliseconds>] [--validation-command <command>] [--disable]
  briar merge-queue retry --batch <uuid>
  briar project configure [--velen-org <slug> | --disable-velen]
    [--data-source <provider://source>]
    [--enable-linear --linear-source <linear://source> --linear-team <key>]
    [--disable-linear]
    [--enable-worktrees|--disable-worktrees] [--worktree-root <dir>]
    [--branch-prefix <prefix>]
    [--enable-full-access --i-understand-the-risk | --disable-full-access]
  briar issue create --title <title>
    [--description <text>|--description-file <path>]
    [--priority <1-4>] [--status <queued|backlog>]
  briar issue dependency add --dependent-run <uuid> --prerequisite-run <uuid>
  briar issue dependency remove --dependent-run <uuid> --prerequisite-run <uuid>
  briar channel messages --channel-id <uuid>
    [--limit <1-100>] [--cursor <message-uuid>]
    [--parent-message-id <root-message-uuid>]
  briar workflow show
  briar queue claim [--run <uuid>] [--workspace <project|worktree|current|none>]
    [--base-branch <ref>]
  briar worktree show
  briar worktree list
  briar worktree maintain [--path <worktree> --run <uuid> --completed-at <ISO-8601>]
  briar worktree maintain --all
  briar worktree remove [--path <worktree>] [--force]
  briar run event add [--run <uuid>]
    [--source <issue|feedback|error> --source-key <key> --title <title>]
    --status <backlog|queued|running|blocked|failed|completed|cancelled>
    [--workflow-stage <configured-stage>] --event-key <retry-stable-key>
  briar run complete [--run <uuid>] --event-key <retry-stable-key>
    --structured-result-file <path>
  briar run stage <start|complete> [--run <uuid>] --stage <configured-stage>
    [--attempt <n>] [--revision <n>] [--request-id <uuid>]
  briar run evidence add [--run <uuid>] --key <retry-stable-key>
    --stage <configured-stage> --type <type>
    --status <pending|passed|failed|skipped>
    [--detail <text>|--detail-file <path>] [--command <command>]
    [--url <url>] [--metadata-json <json>] [--image <path>]...
  briar run evidence list [--run <uuid>]
  briar run rework [--run <uuid>] --to <earlier-stage> --reason <text>
    [--request-id <uuid>]
  briar run resume [--run <uuid>] [--checkpoint <key> --attempt <n> --revision <n>]
    [--request-id <uuid>]
  briar run retry [--run <uuid>] [--request-id <uuid>] [--reason <text>]
  briar run cancel [--run <uuid>] [--request-id <uuid>] [--reason <text>]
  briar worker register [--project <uuid>] [--label <text>]
    [--max-sessions <1-16>]
  briar worker unregister [--project <uuid>]
  briar worker [--project <uuid>] [--max-issues <n>] [--once]
  briar worker status [--project <uuid>]
  briar worker restart-services
  briar worker install-service [--project <uuid>] [--briar-binary <path>] [--runtime-binary <path> --cli-script <path>]
  briar worker uninstall-service [--project <uuid>]

Environment:
  BRIAR_API_URL       Cloudflare Worker URL
  BRIAR_AGENT_TOKEN   Project-scoped ingest token
  BRIAR_WORKER_TOKEN  Worker credential override
  BRIAR_CLI           Absolute CLI path injected into Auto Hunt workers
  BRIAR_CONFIG_HOME   Absolute directory containing an isolated config.json
  BRIAR_WORKTREE_ROOT Parent directory for per-issue worktrees
`;

async function main() {
  if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
    console.log(usage);
    return;
  }
  if (args[0] === "--version" || args[0] === "version") {
    console.log(`briar ${cliVersion}`);
    return;
  }
  if (
    args[0] === "skills" &&
    (!args[1] || args[1] === "help" || args[1] === "--help")
  ) {
    console.log(skillsUsage);
    return;
  }
  if (args[0] === "skills" && args[1] === "list") return listSkillGuides();
  if (args[0] === "skills" && args[1] === "get") return showSkillGuide();
  if (
    args[0] === "channel" &&
    (!args[1] || args[1] === "help" || args[1] === "--help")
  ) {
    console.log(channelMessagesUsage);
    return;
  }
  if (args[0] === "login") return login();
  if (args[0] === "project" && args[1] === "create") return createProject();
  if (args[0] === "connect") return connectProject();
  if (args[0] === "project" && args[1] === "doctor") return projectDoctor();
  if (args[0] === "merge-queue" && args[1] === "configure") {
    return configureMergeQueue();
  }
  if (args[0] === "merge-queue" && args[1] === "retry") {
    return retryMergeQueueBatch();
  }
  if (args[0] === "project" && args[1] === "configure") return configureProject();
  if (args[0] === "issue" && args[1] === "create") return createIssueCommand();
  if (args[0] === "channel" && args[1] === "messages") {
    return listChannelMessagesCommand();
  }
  if (
    args[0] === "issue" &&
    args[1] === "dependency" &&
    args[2] === "add"
  ) {
    return changeIssueDependencyCommand("add");
  }
  if (
    args[0] === "issue" &&
    args[1] === "dependency" &&
    args[2] === "remove"
  ) {
    return changeIssueDependencyCommand("remove");
  }
  if (args[0] === "workflow" && args[1] === "show") return showWorkflow();
  if (args[0] === "queue" && args[1] === "claim") return claimWork();
  if (args[0] === "worktree" && args[1] === "show") return worktreeShow();
  if (args[0] === "worktree" && args[1] === "list") return worktreeList();
  if (args[0] === "worktree" && args[1] === "maintain") return worktreeMaintain();
  if (args[0] === "worktree" && args[1] === "remove") return worktreeRemove();
  if (args[0] === "run" && args[1] === "event" && args[2] === "add") {
    return addRunEvent();
  }
  if (args[0] === "run" && args[1] === "complete") {
    return addRunEvent("completed");
  }
  if (
    args[0] === "run" && args[1] === "stage" &&
    (args[2] === "start" || args[2] === "complete")
  ) {
    return transitionWorkflowStage(args[2]);
  }
  if (args[0] === "run" && args[1] === "evidence" && args[2] === "add") {
    return addRunEvidence();
  }
  if (args[0] === "run" && args[1] === "evidence" && args[2] === "list") {
    return listCurrentRunEvidence();
  }
  if (args[0] === "run" && args[1] === "rework") return reworkRun();
  if (args[0] === "run" && args[1] === "resume") return resumeRun();
  if (args[0] === "run" && args[1] === "retry") return recoverRun("retry");
  if (args[0] === "run" && args[1] === "cancel") return recoverRun("cancel");
  if (args[0] === "worker" && args[1] === "register") {
    return workerRegisterCommand();
  }
  if (args[0] === "worker" && args[1] === "unregister") {
    return workerUnregisterCommand();
  }
  if (args[0] === "worker" && args[1] === "sync-label") {
    return workerSyncLabelCommand();
  }
  if (args[0] === "worker" && args[1] === "status") return workerStatus();
  if (args[0] === "worker" && args[1] === "restart-services") {
    return workerRestartServices();
  }
  if (args[0] === "worker" && args[1] === "install-service") {
    return workerService("install");
  }
  if (args[0] === "worker" && args[1] === "uninstall-service") {
    return workerService("uninstall");
  }
  if (args[0] === "worker") return workerCommand();
  throw new Error(`Unknown command: ${args.join(" ")}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
