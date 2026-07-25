#!/usr/bin/env bun

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import packageJson from "../package.json";
import {
  autoHuntQaEnvironments,
  autoHuntRunStatuses,
  autoHuntSources,
  autoHuntStages,
  autoHuntWorkflowPresets,
  workflowForPreset,
} from "../src/lib/auto-hunt-contract";
import {
  defaultWorkerLabel,
  hostFingerprint,
  interruptibleSleep,
  runWorkerLoop,
  serviceDefinition,
  writeServiceDefinition,
  type ClaimedIssue,
} from "./worker";

const workflowStageIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u);

const workflowConfigSchema = z.object({
  version: z.literal(1),
  preset: z.enum(autoHuntWorkflowPresets).optional(),
  stages: z.array(
    z.object({
      id: workflowStageIdSchema,
      label: z.string().min(1),
      required: z.boolean(),
      evidence: z.array(z.string().min(1)).optional(),
      checks: z.array(z.string().min(1)).optional(),
    }),
  ).min(1),
  completion: z.object({
    requiredStages: z.array(workflowStageIdSchema),
  }).optional(),
  release: z.object({ enabled: z.boolean() }).optional(),
});

const autoHuntConfigSchema = z
  .object({
    velenOrg: z.string().min(1).optional(),
    dataSource: z.string().min(1).optional(),
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
    repositoryRemote: z.string().optional(),
    llm: z
      .object({ provider: z.enum(["codex", "claude"]) })
      .passthrough()
      .optional(),
    autoHunt: autoHuntConfigSchema.optional(),
    activeClaim: z
      .object({
        runId: z.string().uuid(),
        sourceKey: z.string().min(1),
        token: z.string().startsWith("briar_claim_"),
        leaseExpiresAt: z.string().datetime({ offset: true }),
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
const configDirectory = join(homedir(), ".config", "briar");
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
    const config = configSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
    return {
      ...config,
      apiUrl: process.env.BRIAR_API_URL ?? config.apiUrl,
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

async function currentProject(config: Config): Promise<ProjectConfig> {
  const repositoryPath = await currentRepositoryPath();
  const remote = gitValue(["remote", "get-url", "origin"]);
  const commonDirectory = gitCommonDirectory(repositoryPath);
  const matchesRepository = (candidate: ProjectConfig) => {
    if (resolve(candidate.repositoryPath) === repositoryPath) return true;
    if (remote && candidate.repositoryRemote === remote) return true;
    const candidateCommonDirectory = gitCommonDirectory(candidate.repositoryPath);
    return Boolean(
      commonDirectory &&
        candidateCommonDirectory &&
        commonDirectory === candidateCommonDirectory,
    );
  };
  const requestedProjectId = process.env.BRIAR_PROJECT_ID?.trim();
  const project = requestedProjectId
    ? config.projects.find(
        (candidate) =>
          candidate.id === requestedProjectId && matchesRepository(candidate),
      )
    : config.projects.find(matchesRepository);
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

function ensureVelen(project?: ProjectConfig) {
  if (!Bun.file(velenExecutable()).size) {
    throw new Error(
      "Velen CLI가 필요합니다. `bun install -g @wordbricks/velen`으로 설치하세요.",
    );
  }
  const auth = runVelen(["auth", "whoami"]);
  const configuredOrg = project?.autoHunt?.velenOrg;
  if (project && !configuredOrg) {
    throw new Error(
      "Velen 조직이 설정되지 않았습니다. Briar 앱에서 Auto Hunt 설정을 완료하세요.",
    );
  }
  const org = configuredOrg
    ? runVelen(["--org", configuredOrg, "org", "current"])
    : runVelen(["org", "current"]);
  const linearSource = project?.autoHunt?.linear?.enabled
    ? project.autoHunt.linear.source
    : undefined;
  if (project?.autoHunt?.linear?.enabled && !linearSource) {
    throw new Error("Linear 연동이 켜져 있지만 Velen Linear source가 없습니다.");
  }
  const linear = linearSource
    ? runVelen(["--org", configuredOrg!, "source", "show", linearSource])
    : null;
  return { auth, org, linear };
}

async function configureAutoHunt() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const velenOrg = required("--velen-org");
  const linearDisabled = has("--disable-linear");
  const linearSource = value("--linear-source");
  if (!linearDisabled && !linearSource && has("--enable-linear")) {
    throw new Error("--enable-linear requires --linear-source");
  }
  const nextAutoHunt = {
    ...project.autoHunt,
    velenOrg,
    dataSource: value("--data-source") ?? project.autoHunt?.dataSource,
    githubRepository:
      value("--github-repository") ?? project.autoHunt?.githubRepository,
    linear: linearDisabled
      ? { enabled: false }
      : linearSource
        ? {
            enabled: true,
            source: linearSource,
            teamKey: value("--linear-team") ?? project.autoHunt?.linear?.teamKey,
          }
        : (project.autoHunt?.linear ?? { enabled: false }),
    workflow: (() => {
      const preset = value("--workflow-preset");
      if (!preset) return project.autoHunt?.workflow ?? workflowForPreset("local");
      const parsed = z.enum(autoHuntWorkflowPresets).parse(preset);
      if (parsed === "custom") {
        throw new Error("custom workflow must be configured in the Briar app");
      }
      return workflowForPreset(parsed);
    })(),
  };
  const nextProject = {
    ...project,
    repositoryRemote:
      gitValue(["remote", "get-url", "origin"]) ?? project.repositoryRemote,
    autoHunt: nextAutoHunt,
  };
  ensureVelen(nextProject);
  config.projects = config.projects.map((candidate) =>
    candidate.id === project.id ? nextProject : candidate,
  );
  await saveConfig(config);

  if (config.userToken) {
    await request(config.apiUrl, `/projects/${project.id}/settings`, config.userToken, {
      method: "PUT",
      body: JSON.stringify({
        velenOrg,
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
      velenOrg,
      linearEnabled: nextAutoHunt.linear?.enabled ?? false,
      linearSource: nextAutoHunt.linear?.source ?? null,
    }),
  );
}

async function autoHuntDoctor() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const result = ensureVelen(project);
  console.log(
    JSON.stringify({
      ok: true,
      projectId: project.id,
      repositoryPath: project.repositoryPath,
      velenOrg: project.autoHunt?.velenOrg ?? null,
      linearEnabled: project.autoHunt?.linear?.enabled ?? false,
      linearSource: project.autoHunt?.linear?.source ?? null,
      dataSource: project.autoHunt?.dataSource ?? null,
      workflow: project.autoHunt?.workflow ?? workflowForPreset("local"),
      requestIds: [result.auth.requestId, result.org.requestId, result.linear?.requestId].filter(
        Boolean,
      ),
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

async function nextHunt() {
  const config = await loadConfig();
  const project = await currentProject(config);
  ensureVelen(project);
  if (
    project.activeClaim &&
    Date.parse(project.activeClaim.leaseExpiresAt) > Date.now()
  ) {
    throw new Error(
      `이미 처리 중인 Auto Hunt claim이 있습니다: ${project.activeClaim.sourceKey}`,
    );
  }
  const result = await request<{ issue: unknown }>(
    config.apiUrl,
    "/ingest/queue/claim",
    process.env.BRIAR_AGENT_TOKEN ?? project.agentToken,
    {
      method: "POST",
      body: JSON.stringify({ claimedBy: value("--actor") ?? "briar-auto-hunt" }),
    },
  );
  if (result.issue === null) {
    console.log(JSON.stringify({ issue: null }));
    return;
  }
  const issue = queuedIssueSchema.parse(result.issue);
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
      issue: { ...publicIssue, attachments },
    }),
  );
}

async function optionalText(valueFlag: string, fileFlag: string) {
  const path = value(fileFlag);
  if (path) return readFile(resolve(path), "utf8");
  return value(valueFlag) ?? null;
}

async function recordHunt() {
  const config = await loadConfig();
  const project = await currentProject(config);
  ensureVelen(project);
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
  const input = {
    source: value("--source") ?? "issue",
    sourceKey: required("--source-key"),
    title: required("--title"),
    stage: value("--stage"),
    status: value("--status"),
    workflowStage: value("--workflow-stage"),
    eventKey: required("--event-key"),
    occurredAt: value("--observed-at") ?? value("--occurred-at") ?? new Date().toISOString(),
    actor: value("--actor") ?? "briar-auto-hunt",
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
    resultSummary: await optionalText("--result-summary", "--result-summary-file"),
    pullRequestUrls: values("--pull-request-url"),
    targetSha: value("--target-sha") ?? null,
    sourceCreatedAt: value("--source-created-at") ?? null,
    qaStatus: value("--qa-status") ?? null,
    stagingQaDetail: await optionalText("--staging-qa-detail", "--staging-qa-detail-file"),
    productionQaDetail: await optionalText(
      "--production-qa-detail",
      "--production-qa-detail-file",
    ),
    context: contextValue ? JSON.parse(contextValue) : null,
  };
  z.object({
    source: z.enum(autoHuntSources),
    sourceKey: z.string().min(1),
    title: z.string().min(1),
    stage: z.enum(autoHuntStages).optional(),
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
    pullRequestUrls: z.array(z.string().url()).max(20),
    targetSha: z.string().regex(/^[0-9a-f]{7,64}$/u).nullable(),
    sourceCreatedAt: z.string().datetime({ offset: true }).nullable(),
    qaStatus: z.literal("pending").nullable(),
    stagingQaDetail: z.string().nullable(),
    productionQaDetail: z.string().nullable(),
    context: z.record(z.string(), z.unknown()).nullable(),
  }).superRefine((progress, context) => {
    if (!progress.stage && !progress.status) {
      context.addIssue({ code: "custom", message: "--status or --stage is required" });
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
    "/ingest/events",
    agentToken,
    {
      method: "POST",
      body: JSON.stringify(input),
      headers:
        project.activeClaim?.sourceKey === input.sourceKey
          ? { "X-Briar-Claim-Token": project.activeClaim.token }
          : undefined,
    },
  );
  if (
    project.activeClaim?.sourceKey === input.sourceKey &&
    input.status !== "queued" &&
    input.stage !== "queued"
  ) {
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id
        ? { ...candidate, activeClaim: undefined }
        : candidate,
    );
    await saveConfig(config);
  }
  console.log(JSON.stringify(result));
}

async function recordQa() {
  const config = await loadConfig();
  const project = await currentProject(config);
  ensureVelen(project);
  const input = {
    runId: required("--run-id"),
    environment: required("--environment"),
    result: required("--result"),
    observedAt: value("--observed-at") ?? new Date().toISOString(),
    actor: value("--actor") ?? "briar-auto-hunt",
    detail: await optionalText("--detail", "--detail-file"),
  };
  z.object({
    runId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u),
    environment: z.enum(autoHuntQaEnvironments),
    result: z.enum(["passed", "skipped"]),
    observedAt: z.string().datetime({ offset: true }),
    actor: z.string().min(1),
    detail: z.string().nullable(),
  }).parse(input);
  const result = await request(
    config.apiUrl,
    "/ingest/qa-results",
    process.env.BRIAR_AGENT_TOKEN ?? project.agentToken,
    { method: "POST", body: JSON.stringify(input) },
  );
  console.log(JSON.stringify(result));
}

async function recoverHunt(action: "retry" | "cancel") {
  const config = await loadConfig();
  const project = await currentProject(config);
  ensureVelen(project);
  const runId = required("--run-id");
  const input = {
    requestId: value("--request-id") ?? crypto.randomUUID(),
    actor: value("--actor") ?? "briar-auto-hunt",
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
    `/ingest/runs/${runId}/${action}`,
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
 * Only the Claude path exists as a standalone runner today
 * (dist-agent/claude-runner.js). The Codex app-server client still lives in the
 * desktop's Rust layer, so `briar worker` cannot drive it until that client is
 * ported to src-agent — see docs/plans/remote-execution-hosts.md §2.4.
 */
async function runClaimedIssue(project: ProjectConfig, issue: ClaimedIssue) {
  const provider = project.llm?.provider ?? "codex";
  if (provider !== "claude") {
    throw new Error(
      `이 프로젝트는 ${provider} 에이전트를 사용하도록 설정되어 있어 워커에서 실행할 수 없습니다. Codex 러너 이식이 끝나면 사용할 수 있습니다.`,
    );
  }
  throw new Error(
    `Claude 러너 연결이 아직 준비되지 않았습니다: ${issue.sourceKey}는 데스크톱 앱에서 실행하세요.`,
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
  ensureVelen(project);
  const agentToken = process.env.BRIAR_AGENT_TOKEN ?? project.agentToken;
  const label = value("--label") ?? defaultWorkerLabel();
  const provider = project.llm?.provider ?? "codex";

  const registration = workerRegistrationSchema.parse(
    await request(config.apiUrl, "/ingest/workers/register", agentToken, {
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
        const claimed = await request<{ issue: unknown }>(
          config.apiUrl,
          "/ingest/queue/claim",
          agentToken,
          {
            method: "POST",
            body: JSON.stringify({ claimedBy: label, workerId }),
          },
        );
        return claimed.issue === null
          ? null
          : claimedRunSchema.parse(claimed.issue);
      },
      renewLease: async (issue) => {
        await request(
          config.apiUrl,
          `/ingest/runs/${issue.runId}/lease`,
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
          `/ingest/workers/${workerId}/heartbeat`,
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

const usage = `Briar CLI

  briar login
  briar project create [--name <name>]
  briar connect --project-id <uuid> --agent-token <token>
  briar auto-hunt doctor
  briar auto-hunt next
  briar auto-hunt configure --velen-org <slug> [--data-source <provider://source>]
    [--enable-linear --linear-source <linear://source> --linear-team <key>]
    [--disable-linear] [--workflow-preset <local|review|release|research>]
  briar auto-hunt record --source-key <key> --title <title>
    --status <queued|running|blocked|failed|completed|cancelled>
    [--workflow-stage <configured-stage>]
    --event-key <retry-stable-key> [Wordbricks-compatible progress flags]
  briar auto-hunt qa-result --run-id <uuid> --environment <staging|production>
    --result <passed|skipped>
  briar auto-hunt retry --run-id <uuid> [--request-id <uuid>] [--reason <text>]
  briar auto-hunt cancel --run-id <uuid> [--request-id <uuid>] [--reason <text>]
  briar worker [--project <uuid>] [--label <text>] [--max-issues <n>] [--once]
  briar worker status [--project <uuid>]
  briar worker install-service [--project <uuid>] [--briar-binary <path>]
  briar worker uninstall-service [--project <uuid>]

Compatibility:
  briar hunt record ...   Alias of briar auto-hunt record

Environment:
  BRIAR_API_URL       Cloudflare Worker URL
  BRIAR_AGENT_TOKEN   Project-scoped ingest token
`;

async function main() {
  if (args[0] === "--version" || args[0] === "version") {
    console.log(`briar ${cliVersion}`);
    return;
  }
  if (args[0] === "login") return login();
  if (args[0] === "project" && args[1] === "create") return createProject();
  if (args[0] === "connect") return connectProject();
  if (args[0] === "auto-hunt" && args[1] === "doctor") return autoHuntDoctor();
  if (args[0] === "auto-hunt" && args[1] === "next") return nextHunt();
  if (args[0] === "auto-hunt" && args[1] === "configure") {
    return configureAutoHunt();
  }
  if (args[0] === "auto-hunt" && args[1] === "record") return recordHunt();
  if (args[0] === "auto-hunt" && args[1] === "qa-result") return recordQa();
  if (args[0] === "auto-hunt" && args[1] === "retry") return recoverHunt("retry");
  if (args[0] === "auto-hunt" && args[1] === "cancel") return recoverHunt("cancel");
  if (args[0] === "hunt" && args[1] === "record") return recordHunt();
  if (args[0] === "worker" && args[1] === "status") return workerStatus();
  if (args[0] === "worker" && args[1] === "install-service") {
    return workerService("install");
  }
  if (args[0] === "worker" && args[1] === "uninstall-service") {
    return workerService("uninstall");
  }
  if (args[0] === "worker") return workerCommand();
  console.log(usage);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
