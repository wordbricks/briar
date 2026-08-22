import {
  chmod,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import {
  homedir,
  platform,
} from "node:os";
import {
  isAbsolute,
  join,
  resolve,
} from "node:path";
import packageJson from "../../../package.json";
import { type AgentProvider } from "../src/lib/agent-provider";
import { type TranscriptBatchEvent } from "./transcript-batcher";
import { HttpRequestError } from "./execution-metrics-upload";
import {
  defaultWorktreeRoot,
  samePath,
  type GitRunner,
  type WorktreeSettings,
} from "./worktree";
import {
  sameApiEnvironment,
  selectProjectForApi,
} from "./config-environment";
import {
  configErrorLocations,
  decodeConfig,
  type Config,
  type ProjectConfig,
} from "./config-contract";
import { httpErrorMessage } from "./command-contract";

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

export {
  openRouterOpenCodeConfig,
  providerExecutionEnvironment,
  executionToken,
  configuredConfigDirectory,
  configDirectory,
  configPath,
  defaultApiUrl,
  cliVersion,
  args,
  values,
  value,
  has,
  required,
  loadConfig,
  saveConfig,
  saveConfigAt,
  request,
  serializeTranscriptRequest,
  isTranscriptPayloadTooLarge,
  openBrowser,
  login,
  gitValueAt,
  gitValue,
  currentRepositoryPath,
  gitCommonDirectory,
  defaultWorktreeBranchPrefix,
  runGit,
  worktreeSettings,
  worktreesEnabled,
  activeClaimWorktree,
  currentProject,
};
