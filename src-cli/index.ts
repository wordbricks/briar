#!/usr/bin/env bun

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import {
  autoHuntQaEnvironments,
  autoHuntSources,
  autoHuntStages,
} from "../src/lib/auto-hunt-contract";

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
  })
  .passthrough();

const projectConfigSchema = z
  .object({
    id: z.string().uuid(),
    repositoryPath: z.string(),
    agentToken: z.string(),
    repositoryRemote: z.string().optional(),
    autoHunt: autoHuntConfigSchema.optional(),
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
    return configSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
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
  const project = config.projects.find((candidate) => {
    if (resolve(candidate.repositoryPath) === repositoryPath) return true;
    if (remote && candidate.repositoryRemote === remote) return true;
    const candidateCommonDirectory = gitCommonDirectory(candidate.repositoryPath);
    return Boolean(
      commonDirectory &&
        candidateCommonDirectory &&
        commonDirectory === candidateCommonDirectory,
    );
  });
  if (!project) {
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
      requestIds: [result.auth.requestId, result.org.requestId, result.linear?.requestId].filter(
        Boolean,
      ),
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
    stage: required("--stage"),
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
    stage: z.enum(autoHuntStages),
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
  }).parse(input);
  const result = await request<{ runId: string; stage: string }>(
    config.apiUrl,
    "/ingest/events",
    agentToken,
    { method: "POST", body: JSON.stringify(input) },
  );
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

const usage = `Briar CLI

  briar login
  briar project create [--name <name>]
  briar connect --project-id <uuid> --agent-token <token>
  briar auto-hunt doctor
  briar auto-hunt configure --velen-org <slug> [--data-source <provider://source>]
    [--enable-linear --linear-source <linear://source> --linear-team <key>]
    [--disable-linear]
  briar auto-hunt record --source-key <key> --title <title> --stage <stage>
    --event-key <retry-stable-key> [Wordbricks-compatible progress flags]
  briar auto-hunt qa-result --run-id <uuid> --environment <staging|production>
    --result <passed|skipped>

Compatibility:
  briar hunt record ...   Alias of briar auto-hunt record

Environment:
  BRIAR_API_URL       Cloudflare Worker URL
  BRIAR_AGENT_TOKEN   Project-scoped ingest token
`;

async function main() {
  if (args[0] === "login") return login();
  if (args[0] === "project" && args[1] === "create") return createProject();
  if (args[0] === "connect") return connectProject();
  if (args[0] === "auto-hunt" && args[1] === "doctor") return autoHuntDoctor();
  if (args[0] === "auto-hunt" && args[1] === "configure") {
    return configureAutoHunt();
  }
  if (args[0] === "auto-hunt" && args[1] === "record") return recordHunt();
  if (args[0] === "auto-hunt" && args[1] === "qa-result") return recordQa();
  if (args[0] === "hunt" && args[1] === "record") return recordHunt();
  console.log(usage);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
