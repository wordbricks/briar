#!/usr/bin/env bun

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import packageJson from "../package.json";
import {
  autoHuntEvidenceTypeMaxLength,
  autoHuntEvidenceTypePattern,
  autoHuntRunStatuses,
  autoHuntSources,
  repositoryWorkflowPendingStageId,
} from "../src/lib/auto-hunt-contract";
import { structuredAgentResultSchema } from "../src/lib/agent-result";
import {
  defaultWorkerLabel,
  hostFingerprint,
  interruptibleSleep,
  runWorkerLoop,
  serviceDefinition,
  writeServiceDefinition,
  type ClaimedIssue,
} from "./worker";
import {
  allocateIssueWorktree,
  defaultWorktreeRoot,
  listIssueWorktrees,
  projectWorktreeRoot,
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
import { getSkillGuide, skillGuides } from "./skill-guides";

const workflowStageIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u);
const evidenceTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(autoHuntEvidenceTypeMaxLength)
  .regex(autoHuntEvidenceTypePattern);

const workflowConfigSchema = z
  .object({
    version: z.literal(1),
    stages: z.array(
      z.object({
        id: workflowStageIdSchema,
        label: z.string().min(1),
        required: z.boolean(),
        evidence: z.array(evidenceTypeSchema).optional(),
        checks: z.array(z.string().min(1)).optional(),
      }),
    ).min(1),
    completion: z.object({
      requiredStages: z.array(workflowStageIdSchema),
    }).optional(),
    release: z.object({ enabled: z.boolean() }).optional(),
  })
  .strict();

const worktreeConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    root: z.string().min(1).optional(),
    branchPrefix: z.string().min(1).optional(),
  })
  .passthrough();

const sandboxConfigSchema = z
  .object({
    /** False confines Auto Hunt writes to the assigned workspace. Defaults to true. */
    fullAccess: z.boolean().optional(),
  })
  .passthrough();

const claimWorktreeSchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1),
  baseRef: z.string().min(1),
  baseSha: z.string().min(1),
});

const workspaceModeSchema = z.enum(["project", "worktree", "current", "none"]);

const autoHuntConfigSchema = z
  .object({
    velenOrg: z.string().min(1).optional(),
    dataSource: z.string().min(1).optional(),
    worktrees: worktreeConfigSchema.optional(),
    sandbox: sandboxConfigSchema.optional(),
    linear: z
      .object({
        enabled: z.boolean(),
        source: z.string().regex(/^linear:\/\/[A-Za-z0-9._-]+$/u).optional(),
        teamKey: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
    githubRepository: z.string().min(1).optional(),
    workflow: workflowConfigSchema.optional(),
  })
  .passthrough();

const projectConfigSchema = z
  .object({
    id: z.string().uuid(),
    repositoryPath: z.string(),
    agentToken: z.string(),
    apiUrl: z.string().url().optional(),
    repositoryRemote: z.string().optional(),
    llm: z
      .object({ provider: z.enum(["codex", "claude", "grok"]) })
      .passthrough()
      .optional(),
    autoHunt: autoHuntConfigSchema.optional(),
    activeClaim: z
      .object({
        runId: z.string().uuid(),
        sourceKey: z.string().min(1),
        token: z.string().startsWith("briar_claim_").optional(),
        leaseExpiresAt: z.string().datetime({ offset: true }),
        worktree: claimWorktreeSchema.optional(),
        finished: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();

const configSchema = z
  .object({
    apiUrl: z.string().url(),
    userToken: z.string().optional(),
    projects: z.array(projectConfigSchema).default([]),
  })
  .passthrough();

type Config = z.infer<typeof configSchema>;
type ProjectConfig = z.infer<typeof projectConfigSchema>;
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
  try {
    const config = configSchema.parse(
      JSON.parse(await readFile(configPath, "utf8")),
    );
    const apiUrl = process.env.BRIAR_API_URL ?? config.apiUrl;
    return {
      ...config,
      apiUrl,
      userToken: sameApiEnvironment(apiUrl, config.apiUrl)
        ? config.userToken
        : undefined,
    };
  } catch {
    return { apiUrl: defaultApiUrl, projects: [] };
  }
}

async function saveConfig(config: Config) {
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(configPath, 0o600);
}

async function request<T>(
  apiUrl: string,
  path: string,
  token: string | null,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiUrl.replace(/\/$/u, "")}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorBody = z
      .object({
        message: z.string().optional(),
        error_description: z.string().optional(),
        error: z.string().optional(),
      })
      .passthrough()
      .safeParse(body);
    throw new Error(
      (errorBody.success &&
        (errorBody.data.message ??
          errorBody.data.error_description ??
          errorBody.data.error)) ||
        `request failed (${response.status})`,
    );
  }
  return body as T;
}

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
  console.log("시스템 브라우저에서 Google 로그인과 기기 승인을 완료하세요.");
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

const velenEnvelopeSchema = z
  .object({
    ok: z.boolean(),
    data: z.unknown(),
    requestId: z.string().optional(),
  })
  .passthrough();

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
  return velenEnvelopeSchema.parse(JSON.parse(result.stdout.toString()));
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
  const velen = ensureConfiguredVelen(project);
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

const queuedAttachmentSchema = z.object({
  id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  contentType: z.string().regex(/^(?:image|video)\//u),
  byteSize: z.number().int().positive().max(20 * 1024 * 1024),
  url: z.string().startsWith("/"),
});

const queuedIssueSchema = z.object({
  runId: z.string().uuid(),
  runNumber: z.number().int().positive(),
  currentAttempt: z.number().int().positive(),
  source: z.enum(autoHuntSources),
  sourceKey: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  priority: z.number().int().min(1).max(4).nullable(),
  repository: z.string().min(1),
  sourceCreatedAt: z.string().datetime({ offset: true }).nullable(),
  context: z.record(z.string(), z.unknown()).nullable(),
  workflow: workflowConfigSchema,
  attachments: z.array(queuedAttachmentSchema).max(5).default([]),
  claimToken: z.string().startsWith("briar_claim_"),
  claimedBy: z.string().min(1),
  claimedAt: z.string().datetime({ offset: true }),
  leaseExpiresAt: z.string().datetime({ offset: true }),
  claimAttempts: z.number().int().positive(),
});

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
  attachment: z.infer<typeof queuedAttachmentSchema>,
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
  const directory = join(configDirectory, "attachments", runId);
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
  if (runId) z.string().uuid().parse(runId);
  ensureConfiguredVelen(project);
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
    process.env.BRIAR_AGENT_TOKEN ?? project.agentToken,
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
  const issue = queuedIssueSchema.parse(result.work);
  const agentToken = process.env.BRIAR_AGENT_TOKEN ?? project.agentToken;
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
      work: { ...publicIssue, attachments, workspace },
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
): Promise<{
  workspace:
    | ({ type: "worktree" } & IssueWorktree & { warning?: string })
    | { type: "current"; path: string }
    | null;
  workspaceError: string | null;
}> {
  const requestedMode = workspaceModeSchema.parse(value("--workspace") ?? "project");
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
    await saveConfig(config);
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

async function optionalText(valueFlag: string, fileFlag: string) {
  const path = value(fileFlag);
  if (path) return readFile(resolve(path), "utf8");
  return value(valueFlag) ?? null;
}

async function addRunEvent(forcedStatus?: string) {
  const config = await loadConfig();
  const project = await currentProject(config);
  const repositoryRoot = await currentRepositoryPath();
  const agentToken = process.env.BRIAR_AGENT_TOKEN ?? project.agentToken;
  if (!agentToken) throw new Error("Briar Agent 토큰이 없습니다.");
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
    ? structuredAgentResultSchema.parse(JSON.parse(structuredResultValue))
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
  z.object({
    runId: z.string().uuid().nullable(),
    source: z.enum(autoHuntSources).nullable(),
    sourceKey: z.string().min(1).nullable(),
    title: z.string().min(1).nullable(),
    status: z.enum(autoHuntRunStatuses).optional(),
    workflowStage: workflowStageIdSchema.nullable().optional(),
    eventKey: z.string().min(1),
    occurredAt: z.string().datetime({ offset: true }),
    actor: z.string().min(1),
    repository: z.string().min(1),
    detail: z.string().nullable(),
    priority: z.number().int().min(1).max(4).nullable(),
    branch: z.string().nullable(),
    commitSha: z.string().regex(/^[0-9a-f]{7,64}$/u).nullable(),
    tracker: z
      .object({
        provider: z.string().min(1).max(64),
        issueId: z.string().nullable(),
        identifier: z.string().nullable(),
        url: z.string().url().nullable(),
        state: z.string().nullable(),
      })
      .nullable(),
    issueDescription: z.string().nullable(),
    resultSummary: z.string().nullable(),
    structuredResult: structuredAgentResultSchema.nullable(),
    pullRequestUrls: z.array(z.string().url()).max(20),
    targetSha: z.string().regex(/^[0-9a-f]{7,64}$/u).nullable(),
    sourceCreatedAt: z.string().datetime({ offset: true }).nullable(),
    context: z.record(z.string(), z.unknown()).nullable(),
  }).superRefine((progress, context) => {
    if (!progress.runId && (!progress.source || !progress.sourceKey || !progress.title)) {
      context.addIssue({
        code: "custom",
        message: "--source, --source-key, and --title are required without --run",
      });
    }
    if (!progress.status) {
      context.addIssue({ code: "custom", message: "--status is required" });
    }
    if (progress.status === "running" && !progress.workflowStage) {
      context.addIssue({
        code: "custom",
        message: "--workflow-stage is required with --status running",
      });
    }
  }).parse(input);
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
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id
        ? {
            ...candidate,
            activeClaim: candidate.activeClaim && input.status !== "queued"
              ? {
                  ...candidate.activeClaim,
                  token: undefined,
                  finished: ["completed", "cancelled"].includes(input.status ?? ""),
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
  const parsed = z.object({
    evidenceKey: z.string().min(1).max(300),
    stage: workflowStageIdSchema,
    type: evidenceTypeSchema,
    status: z.enum(["pending", "passed", "failed", "skipped"]),
    observedAt: z.string().datetime({ offset: true }),
    actor: z.string().min(1),
    detail: z.string().nullable(),
    command: z.string().min(1).max(2_000).nullable(),
    url: z.string().url().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
  }).parse(input);
  const result = await request(
    config.apiUrl,
    `/runs/${runId}/evidence`,
    process.env.BRIAR_AGENT_TOKEN ?? project.agentToken,
    { method: "POST", body: JSON.stringify(parsed) },
  );
  console.log(JSON.stringify(result));
}

async function listCurrentRunEvidence() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  z.string().uuid().parse(runId);
  const result = await request(
    config.apiUrl,
    `/runs/${runId}/evidence`,
    process.env.BRIAR_AGENT_TOKEN ?? project.agentToken,
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
  z.object({
    requestId: z.string().uuid(),
    actor: z.string().min(1).max(128),
    reason: z.string().min(1).max(4_000).nullable(),
  }).parse(input);
  z.string().uuid().parse(runId);
  const result = await request<{
    runId: string;
    outcome: string;
    attempt: number;
    stage: string;
  }>(
    config.apiUrl,
    `/runs/${runId}/${action}`,
    process.env.BRIAR_AGENT_TOKEN ?? project.agentToken,
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
  z.object({
    requestId: z.string().uuid(),
    actor: z.string().min(1).max(128),
    workflowStage: workflowStageIdSchema,
    reason: z.string().trim().min(1).max(4_000),
  }).parse(input);
  z.string().uuid().parse(runId);
  const result = await request<{
    runId: string;
    outcome: string;
    attempt: number;
    revision: number;
    workflowStage: string;
  }>(
    config.apiUrl,
    `/runs/${runId}/rework`,
    process.env.BRIAR_AGENT_TOKEN ?? project.agentToken,
    { method: "POST", body: JSON.stringify(input) },
  );
  console.log(JSON.stringify(result));
}

const workerRegistrationSchema = z.object({
  worker: z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    state: z.enum(["online", "stale", "disabled"]),
    lastHeartbeatAt: z.string(),
  }),
});

const claimedRunSchema = z.object({
  runId: z.string().uuid(),
  sourceKey: z.string().min(1),
  title: z.string().min(1),
  claimToken: z.string().startsWith("briar_claim_"),
  leaseExpiresAt: z.string(),
});

/**
 * Agent launcher for a claimed issue.
 *
 * Claude and Grok have standalone runners (dist-agent/*-runner.js). The Codex
 * app-server client still lives in the desktop's Rust layer, so `briar worker`
 * cannot drive Codex until that client is ported to src-agent — see
 * docs/plans/remote-execution-hosts.md §2.4. Runner wiring for Claude/Grok in
 * the CLI worker loop is still pending; issue execution remains desktop-led.
 */
async function runClaimedIssue(project: ProjectConfig, issue: ClaimedIssue) {
  const provider = project.llm?.provider ?? "codex";
  if (provider !== "claude" && provider !== "grok") {
    throw new Error(
      `이 프로젝트는 ${provider} 에이전트를 사용하도록 설정되어 있어 워커에서 실행할 수 없습니다. Codex 러너 이식이 끝나면 사용할 수 있습니다.`,
    );
  }
  throw new Error(
    `${provider === "grok" ? "Grok" : "Claude"} 러너 연결이 아직 준비되지 않았습니다: ${issue.sourceKey}는 데스크톱 앱에서 실행하세요.`,
  );
}

async function workerCommand() {
  const config = await loadConfig();
  const projectId = value("--project");
  const project = projectId
    ? config.projects.find((candidate) => candidate.id === projectId)
    : await currentProject(config);
  if (!project) {
    throw new Error("이 컴퓨터에 연결된 프로젝트를 찾지 못했습니다.");
  }
  ensureConfiguredVelen(project);
  const agentToken = process.env.BRIAR_AGENT_TOKEN ?? project.agentToken;
  const label = value("--label") ?? defaultWorkerLabel();
  const provider = project.llm?.provider ?? "codex";

  const registration = workerRegistrationSchema.parse(
    await request(config.apiUrl, "/workers/register", agentToken, {
      method: "POST",
      body: JSON.stringify({
        label,
        hostFingerprint: hostFingerprint(),
        agentProvider: provider,
        versions: { briar: cliVersion },
      }),
    }),
  );
  const workerId = registration.worker.id;
  console.log(`worker ${label} registered as ${workerId}`);

  const maxIssues = Number.parseInt(value("--max-issues") ?? "", 10);
  const result = await runWorkerLoop(
    {
      claim: async () => {
        const claimed = await request<{ work: unknown }>(
          config.apiUrl,
          "/queue/claims",
          agentToken,
          {
            method: "POST",
            body: JSON.stringify({ claimedBy: label, workerId }),
          },
        );
        return claimed.work === null
          ? null
          : claimedRunSchema.parse(claimed.work);
      },
      renewLease: async (issue) => {
        await request(
          config.apiUrl,
          `/runs/${issue.runId}/lease`,
          agentToken,
          {
            method: "POST",
            body: JSON.stringify({ claimToken: issue.claimToken }),
          },
        );
      },
      heartbeat: async () => {
        await request(
          config.apiUrl,
          `/workers/${workerId}/heartbeat`,
          agentToken,
          {
            method: "POST",
            body: JSON.stringify({ versions: { briar: cliVersion } }),
          },
        );
      },
      runIssue: (issue) => runClaimedIssue(project, issue),
      sleep: interruptibleSleep,
      now: () => Date.now(),
      log: (line) => console.log(line),
    },
    {
      once: has("--once"),
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
        hostFingerprint: hostFingerprint(),
      },
      null,
      2,
    ),
  );
}

async function workerService(action: "install" | "uninstall") {
  const config = await loadConfig();
  const project = value("--project")
    ? config.projects.find((candidate) => candidate.id === value("--project"))
    : await currentProject(config);
  if (!project) {
    throw new Error("이 컴퓨터에 연결된 프로젝트를 찾지 못했습니다.");
  }
  const briarBinary = value("--briar-binary") ?? process.execPath;
  const definition = serviceDefinition({
    projectId: project.id,
    briarBinary,
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

function showSkillGuide() {
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
  if (has("--json")) {
    console.log(
      JSON.stringify(
        {
          name: guide.name,
          version: cliVersion,
          markdown: guide.markdown,
        },
        null,
        2,
      ),
    );
    return;
  }
  process.stdout.write(
    guide.markdown.endsWith("\n") ? guide.markdown : `${guide.markdown}\n`,
  );
}

const usage = `Briar CLI

  briar login
  briar skills list [--json]
  briar skills get <topic> [--json]
  briar project create [--name <name>]
  briar connect --project-id <uuid> --agent-token <token>
  briar project doctor
  briar project configure [--velen-org <slug> | --disable-velen]
    [--data-source <provider://source>]
    [--enable-linear --linear-source <linear://source> --linear-team <key>]
    [--disable-linear]
    [--enable-worktrees|--disable-worktrees] [--worktree-root <dir>]
    [--branch-prefix <prefix>]
    [--enable-full-access --i-understand-the-risk | --disable-full-access]
  briar workflow show
  briar queue claim [--run <uuid>] [--workspace <project|worktree|current|none>]
    [--base-branch <ref>]
  briar worktree show
  briar worktree list
  briar worktree remove [--path <worktree>] [--force]
  briar run event add [--run <uuid>]
    [--source <issue|feedback|error> --source-key <key> --title <title>]
    --status <backlog|queued|running|blocked|failed|completed|cancelled>
    [--workflow-stage <configured-stage>] --event-key <retry-stable-key>
  briar run complete [--run <uuid>] --event-key <retry-stable-key>
    --structured-result-file <path>
  briar run evidence add [--run <uuid>] --key <retry-stable-key>
    --stage <configured-stage> --type <type>
    --status <pending|passed|failed|skipped>
    [--detail <text>|--detail-file <path>] [--command <command>]
    [--url <url>] [--metadata-json <json>]
  briar run evidence list [--run <uuid>]
  briar run rework [--run <uuid>] --to <earlier-stage> --reason <text>
    [--request-id <uuid>]
  briar run retry [--run <uuid>] [--request-id <uuid>] [--reason <text>]
  briar run cancel [--run <uuid>] [--request-id <uuid>] [--reason <text>]
  briar worker [--project <uuid>] [--label <text>] [--max-issues <n>] [--once]
  briar worker status [--project <uuid>]
  briar worker install-service [--project <uuid>] [--briar-binary <path>]
  briar worker uninstall-service [--project <uuid>]

Environment:
  BRIAR_API_URL       Cloudflare Worker URL
  BRIAR_AGENT_TOKEN   Project-scoped ingest token
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
  if (args[0] === "login") return login();
  if (args[0] === "project" && args[1] === "create") return createProject();
  if (args[0] === "connect") return connectProject();
  if (args[0] === "project" && args[1] === "doctor") return projectDoctor();
  if (args[0] === "project" && args[1] === "configure") return configureProject();
  if (args[0] === "workflow" && args[1] === "show") return showWorkflow();
  if (args[0] === "queue" && args[1] === "claim") return claimWork();
  if (args[0] === "worktree" && args[1] === "show") return worktreeShow();
  if (args[0] === "worktree" && args[1] === "list") return worktreeList();
  if (args[0] === "worktree" && args[1] === "remove") return worktreeRemove();
  if (args[0] === "run" && args[1] === "event" && args[2] === "add") {
    return addRunEvent();
  }
  if (args[0] === "run" && args[1] === "complete") {
    return addRunEvent("completed");
  }
  if (args[0] === "run" && args[1] === "evidence" && args[2] === "add") {
    return addRunEvidence();
  }
  if (args[0] === "run" && args[1] === "evidence" && args[2] === "list") {
    return listCurrentRunEvidence();
  }
  if (args[0] === "run" && args[1] === "rework") return reworkRun();
  if (args[0] === "run" && args[1] === "retry") return recoverRun("retry");
  if (args[0] === "run" && args[1] === "cancel") return recoverRun("cancel");
  if (args[0] === "worker" && args[1] === "status") return workerStatus();
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
