import {
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { constants as fileConstants } from "node:fs";
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
import {
  agentProviderExecutionEnvironment,
  openCodeUpstreamOf,
  type AgentProvider,
} from "../src/lib/agent-provider";
import {
  createDeviceAuthorizationClient,
  type DeviceAuthorizationClient,
} from "../src/lib/device-authorization-client";
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
  decodeConfigJson,
  decodePreProtoConfigJson,
  encodeConfigJson,
  type Config,
  type ProjectConfig,
} from "./config-contract";
import {
  configuredManagedComputerCredentialPath,
  loadOptionalManagedComputerCredential,
} from "./managed-computer-credential";
import { fetchCurrentUser } from "./app-connect-client";

/**
 * Credential this provider's OpenCode upstream authenticates with, read from
 * the Briar config field the upstream descriptor names. Providers that run
 * their own CLI carry no upstream credential.
 */
function openCodeUpstreamCredential(
  config: Config,
  provider: AgentProvider,
): string | null {
  const upstream = openCodeUpstreamOf(provider);
  if (!upstream) return null;
  return config[upstream.credential.configField]?.trim() || null;
}

/** Whether this provider's upstream credential is saved in the Briar config. */
function openCodeUpstreamConfigured(config: Config, provider: AgentProvider) {
  return openCodeUpstreamCredential(config, provider) !== null;
}

function providerExecutionEnvironment(
  config: Config,
  provider: AgentProvider,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const browserEnvironment = {
    ...environment,
    BRIAR_BROWSER_AUTOMATION_PROVIDER:
      config.appSettings.browserAutomationProvider,
    ...(config.managedComputer
      ? {
          BRIAR_MANAGED_COMPUTER_ID:
            config.managedComputer.managedComputerId,
        }
      : {}),
  };
  return agentProviderExecutionEnvironment(
    provider,
    openCodeUpstreamCredential(config, provider),
    browserEnvironment,
  );
}
const executionToken = (project: ProjectConfig) => {
  const token = process.env.BRIAR_WORKER_TOKEN ??
    process.env.BRIAR_AGENT_TOKEN ??
    project.agentToken;
  if (!token) throw new Error("Briar execution credential is unavailable");
  return token;
};
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
      const managedCredential = await loadOptionalManagedComputerCredential();
      return {
        apiUrl: managedCredential?.apiOrigin ??
          process.env.BRIAR_API_URL ?? defaultApiUrl,
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
          browserAutomationProvider: "agent-browser",
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

  let config: Config;
  try {
    config = decodeConfigJson(contents);
  } catch (error) {
    let migrated: Config;
    try {
      migrated = decodePreProtoConfigJson(contents);
    } catch {
      const locations = configErrorLocations(error);
      throw new Error(
        `Briar 로컬 설정이 손상되었습니다: ${locations.join(", ")} 항목을 확인하세요.`,
      );
    }
    await migratePreProtoConfig(migrated);
    config = migrated;
  }

  const managedCredential = await loadOptionalManagedComputerCredential(
    config.managedComputer?.credentialFile ??
      configuredManagedComputerCredentialPath(),
  );
  const apiUrl = managedCredential?.apiOrigin ??
    process.env.BRIAR_API_URL ?? config.apiUrl;
  return {
    ...config,
    apiUrl,
    userToken: sameApiEnvironment(apiUrl, config.apiUrl)
      ? config.userToken
      : undefined,
  };
}

// TODO(remove after every Briar 1.2.174 installation has run 1.2.179+ once):
// Delete this one-time domain-JSON migration. Canonical ProtoJSON remains the
// only accepted persisted contract after the installed user base is rewritten.
async function migratePreProtoConfig(config: Config) {
  const backupPath = join(
    configDirectory,
    `config.pre-proto-ssot-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.json`,
  );
  try {
    await copyFile(configPath, backupPath, fileConstants.COPYFILE_EXCL);
  } catch (error) {
    if (
      !error || typeof error !== "object" || !("code" in error) ||
      error.code !== "EEXIST"
    ) throw error;
  }
  await saveConfigAt(configDirectory, config);
}

async function saveConfig(config: Config) {
  await saveConfigAt(configDirectory, config);
}

async function saveConfigAt(directory: string, config: Config) {
  const path = join(directory, "config.json");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = join(
    directory,
    `.config.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const file = await open(temporaryPath, "wx", 0o600);
  try {
    await file.writeFile(encodeConfigJson(config), "utf8");
    await file.sync();
    await file.close();
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    await file.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

type BrowserLaunchHandle = {
  exited: Promise<number | null>;
  unref: () => void;
};

type BrowserLauncher = (
  command: string,
  arguments_: string[],
  options: {
    detached: true;
    stdio: "ignore";
    windowsHide: true;
  },
) => BrowserLaunchHandle;

type OpenBrowserDependencies = {
  launch?: BrowserLauncher;
  platform?: NodeJS.Platform;
  writeLine?: (message: string) => void;
};

const launchBrowser: BrowserLauncher = (command, arguments_, options) => {
  const child = spawn(command, arguments_, options);
  return {
    exited: new Promise((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", resolveExit);
    }),
    unref: () => child.unref(),
  };
};

function openBrowser(url: string, dependencies: OpenBrowserDependencies = {}) {
  const operatingSystem = dependencies.platform ?? platform();
  const command =
    operatingSystem === "darwin"
      ? ["open", url]
      : operatingSystem === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  const writeLine = dependencies.writeLine ?? console.error;
  let reportedFailure = false;
  const reportFailure = () => {
    if (reportedFailure) return;
    reportedFailure = true;
    writeLine(
      `브라우저를 자동으로 열지 못했습니다. 다음 주소를 직접 여세요: ${url}`,
    );
  };

  try {
    const child = (dependencies.launch ?? launchBrowser)(
      command[0],
      command.slice(1),
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    void child.exited.then((exitCode) => {
      if (exitCode !== 0) reportFailure();
    }, reportFailure);
    child.unref();
  } catch {
    reportFailure();
  }
}

type LoginDependencies = {
  createDeviceAuthorizationClient: (
    apiUrl: string,
  ) => DeviceAuthorizationClient;
  fetchCurrentUser: typeof fetchCurrentUser;
  loadConfig: typeof loadConfig;
  openBrowser: (url: string) => void;
  saveConfig: typeof saveConfig;
  sleep: (milliseconds: number) => Promise<void>;
  writeLine: (message: string) => void;
};

async function login(
  apiUrlOverride?: string,
  dependencyOverrides: Partial<LoginDependencies> = {},
) {
  const dependencies: LoginDependencies = {
    createDeviceAuthorizationClient,
    fetchCurrentUser,
    loadConfig,
    openBrowser,
    saveConfig,
    sleep: (milliseconds) => Bun.sleep(milliseconds),
    writeLine: console.log,
    ...dependencyOverrides,
  };
  const loaded = await dependencies.loadConfig();
  const config = apiUrlOverride
    ? {
      ...loaded,
      apiUrl: apiUrlOverride,
      userToken: sameApiEnvironment(apiUrlOverride, loaded.apiUrl)
        ? loaded.userToken
        : undefined,
    }
    : loaded;
  const deviceAuthorization = dependencies.createDeviceAuthorizationClient(
    config.apiUrl,
  );
  const code = await deviceAuthorization.requestCode({
    clientId: "briar-cli",
    scope: "openid profile email",
  });
  dependencies.writeLine(`Briar 로그인 코드: ${code.userCode}`);
  dependencies.writeLine("시스템 브라우저에서 로그인하고 기기 승인을 완료하세요.");
  dependencies.openBrowser(code.verificationUriComplete);

  let interval = code.interval * 1_000;
  for (;;) {
    await dependencies.sleep(interval);
    const token = await deviceAuthorization.pollToken({
      deviceCode: code.deviceCode,
      clientId: "briar-cli",
    });
    switch (token.status) {
      case "authorization_pending":
        continue;
      case "slow_down":
        interval += 5_000;
        continue;
      case "access_denied":
      case "expired_token":
        throw new Error(token.description);
      case "authorized":
        config.userToken = token.accessToken;
        await dependencies.saveConfig(config);
        const user = await dependencies.fetchCurrentUser(
          config.apiUrl,
          token.accessToken,
        );
        dependencies.writeLine(
          `${user.name} (${user.email}) 계정으로 로그인했습니다.`,
        );
        return;
    }
  }
}

function gitValueAt(cwd: string, gitArgs: string[]) {
  try {
    const result = Bun.spawnSync(["git", ...gitArgs], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    return result.exitCode === 0 ? result.stdout.toString().trim() : null;
  } catch {
    return null;
  }
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
  openCodeUpstreamConfigured,
  openCodeUpstreamCredential,
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
  openBrowser,
  type LoginDependencies,
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
