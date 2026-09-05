import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  agentProviderCatalog,
  agentProviderEnvironmentKey,
  isOpenCodeUpstreamProvider,
  usesGoogleApplicationDefaultCredentials,
  type AgentProvider,
  type OpenCodeUpstreamProvider,
} from "../src/lib/agent-provider";

const commonEnvironmentKeys = new Set([
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "USER",
  "LOGNAME",
  "PATH",
  "PATHEXT",
  "SHELL",
  "COMSPEC",
  "SYSTEMROOT",
  "WINDIR",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  // Names the Briar provider rather than carrying a credential, and the
  // runner reads it to pick the isolation allowlist for its own provider.
  agentProviderEnvironmentKey,
]);

/**
 * Env prefixes each provider CLI authenticates through. OpenCode upstreams are
 * absent on purpose: their rows come from the catalog descriptor, so a new
 * upstream cannot be forgotten here.
 */
const providerPrefixes = {
  codex: ["OPENAI_"],
  claude: ["ANTHROPIC_", "AWS_", "GOOGLE_", "VERTEX_"],
  cursor: ["CURSOR_"],
  grok: [],
  agy: [],
  opencode: [
    "OPENAI_",
    "ANTHROPIC_",
    "XAI_",
    "OPENROUTER_",
    "AZURE_OPENAI_",
    "AWS_",
    "GOOGLE_",
    "GEMINI_",
    "VERTEX_",
    "OLLAMA_",
    "LMSTUDIO_",
    "DEEPSEEK_",
    "MISTRAL_",
    "COHERE_",
    "GROQ_",
    "TOGETHER_",
    "CEREBRAS_",
  ],
  // Pi is multi-provider like OpenCode: it authenticates against whichever
  // upstream the selected model belongs to, so its own key prefixes travel
  // with it. `PI_` carries pi's own switches.
  pi: [
    "ANTHROPIC_",
    "OPENAI_",
    "GEMINI_",
    "GOOGLE_",
    "OPENROUTER_",
    "XAI_",
    "PI_",
  ],
} satisfies Record<Exclude<AgentProvider, OpenCodeUpstreamProvider>, string[]>;

const providerEnvironmentKeys = {
  codex: new Set(["CODEX_ACCESS_TOKEN"]),
  claude: new Set(["CLAUDE_CODE_OAUTH_TOKEN"]),
  cursor: new Set(["CURSOR_API_KEY"]),
  grok: new Set(["XAI_API_KEY"]),
  agy: new Set(),
  opencode: new Set(),
  // `PI_ACP_PI_COMMAND` names the `pi` executable the adapter spawns; without
  // it an isolated turn falls back to a bare `pi` lookup on PATH.
  pi: new Set(["PI_ACP_PI_COMMAND"]),
} satisfies Record<
  Exclude<AgentProvider, OpenCodeUpstreamProvider>,
  Set<string>
>;

/** Environment names a provider's own authentication inputs live under. */
type ProviderEnvironmentAllowlist = {
  prefixes: readonly string[];
  keys: ReadonlySet<string>;
};

/**
 * Upstream rows are derived from the catalog descriptor; every other provider
 * keeps its explicit, total table above.
 */
function providerEnvironmentAllowlist(
  provider: AgentProvider,
): ProviderEnvironmentAllowlist {
  if (isOpenCodeUpstreamProvider(provider)) {
    const { upstream } = agentProviderCatalog[provider];
    return {
      prefixes: upstream.environmentPrefixes,
      keys: new Set(upstream.environmentKeys),
    };
  }
  return {
    prefixes: providerPrefixes[provider],
    keys: providerEnvironmentKeys[provider],
  };
}

const grokReadOnlyProfile = "briar_read_only";

/**
 * Marker naming the isolated state root a read-only turn already runs under.
 *
 * `prepareReadOnlyAgentEnvironment` stamps it on every environment it builds,
 * and it survives into the spawned process because the allowlist is applied
 * before the marker is added. The worker path prepares the environment before
 * it spawns the runner bundle, so the runner sees the marker in `process.env`
 * and {@link ensureReadOnlyAgentEnvironment} skips a second preparation.
 * Without it the desktop path (which prepares nothing) and the worker path
 * would each need their own runner branch.
 */
export const readOnlyStateRootEnvironmentKey = "BRIAR_READ_ONLY_STATE_ROOT";

export type PreparedReadOnlyAgentEnvironment = {
  environment: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
};

/**
 * Conversational Agent turns are not execution workers. Give their provider
 * process only OS basics and that provider's authentication inputs, never
 * Briar, source-control, deployment, or integration credentials.
 */
export function readOnlyAgentEnvironment(
  provider: AgentProvider,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allowed: NodeJS.ProcessEnv = {};
  const { prefixes, keys: exactKeys } = providerEnvironmentAllowlist(provider);
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    const normalized = key.toUpperCase();
    if (
      commonEnvironmentKeys.has(normalized) ||
      normalized.startsWith("LC_") ||
      exactKeys.has(normalized) ||
      prefixes.some((prefix) => normalized.startsWith(prefix))
    ) {
      allowed[key] = value;
    }
  }
  return allowed;
}

async function copyOptionalCredential(
  sourcePath: string,
  targetPath: string,
) {
  try {
    await copyFile(sourcePath, targetPath);
    await chmod(targetPath, 0o600);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return false;
  }
}

function readClaudeKeychainCredential(
  environment: NodeJS.ProcessEnv,
  sourceClaudeHome: string,
) {
  if (process.platform !== "darwin") return null;
  const account =
    environment.USER?.trim() || environment.USERNAME?.trim() || "user";
  const suffix = createHash("sha256")
    .update(sourceClaudeHome)
    .digest("hex")
    .slice(0, 8);
  for (const service of [
    `Claude Code-credentials-${suffix}`,
    "Claude Code-credentials",
  ]) {
    const result = spawnSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { encoding: "utf8", timeout: 5_000, maxBuffer: 1_000_000 },
    );
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  }
  return null;
}

function normalizedClaudeCredential(contents: string) {
  const parsed = JSON.parse(contents) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Claude credential is not a JSON object");
  }
  return JSON.stringify(parsed);
}

async function existingPaths(paths: string[]) {
  const existing: string[] = [];
  for (const path of paths) {
    try {
      await lstat(path);
      existing.push(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return existing;
}

function grokProjectConfigurationPaths(workspaceRoot: string) {
  return [
    ".grok",
    ".claude",
    ".cursor",
    ".codex",
    ".agents",
    ".mcp.json",
    "AGENT.md",
    "AGENTS.md",
    "Agents.md",
    "CLAUDE.md",
    "CLAUDE.local.md",
    "Claude.md",
  ].map((path) => join(workspaceRoot, path));
}

async function prepareCodexEnvironment(
  allowed: NodeJS.ProcessEnv,
  environment: NodeJS.ProcessEnv,
) {
  const sourceCodexHome = environment.CODEX_HOME?.trim() ||
    join(environment.HOME?.trim() || homedir(), ".codex");
  const isolatedCodexHome = await mkdtemp(
    join(tmpdir(), "briar-codex-read-only-"),
  );
  try {
    await copyOptionalCredential(
      join(sourceCodexHome, "auth.json"),
      join(isolatedCodexHome, "auth.json"),
    );
  } catch (error) {
    await rm(isolatedCodexHome, { recursive: true, force: true });
    throw error;
  }
  return {
    environment: {
      ...allowed,
      CODEX_HOME: isolatedCodexHome,
      CODEX_SQLITE_HOME: isolatedCodexHome,
    },
    stateRoot: isolatedCodexHome,
    cleanup: () => rm(isolatedCodexHome, { recursive: true, force: true }),
  };
}

async function prepareClaudeEnvironment(
  allowed: NodeJS.ProcessEnv,
  environment: NodeJS.ProcessEnv,
  keychainCredential: (
    environment: NodeJS.ProcessEnv,
    sourceClaudeHome: string,
  ) => string | null,
) {
  const sourceClaudeHome = environment.CLAUDE_CONFIG_DIR?.trim() ||
    join(environment.HOME?.trim() || homedir(), ".claude");
  const isolatedClaudeHome = await mkdtemp(
    join(tmpdir(), "briar-claude-read-only-"),
  );
  try {
    // macOS keeps the live login in the Keychain; an abandoned
    // `.credentials.json` next to it must not shadow that login.
    const credential = keychainCredential(environment, sourceClaudeHome);
    if (credential) {
      await writeFile(
        join(isolatedClaudeHome, ".credentials.json"),
        normalizedClaudeCredential(credential),
        { mode: 0o600 },
      );
    } else {
      await copyOptionalCredential(
        join(sourceClaudeHome, ".credentials.json"),
        join(isolatedClaudeHome, ".credentials.json"),
      );
    }
  } catch (error) {
    await rm(isolatedClaudeHome, { recursive: true, force: true });
    throw error;
  }
  return {
    environment: {
      ...allowed,
      CLAUDE_CONFIG_DIR: isolatedClaudeHome,
      CLAUDE_SECURESTORAGE_CONFIG_DIR: isolatedClaudeHome,
    },
    stateRoot: isolatedClaudeHome,
    cleanup: () => rm(isolatedClaudeHome, { recursive: true, force: true }),
  };
}

async function prepareGrokEnvironment(
  allowed: NodeJS.ProcessEnv,
  environment: NodeJS.ProcessEnv,
  workspaceRoot: string,
) {
  const sourceGrokHome = environment.GROK_HOME?.trim() ||
    join(environment.HOME?.trim() || homedir(), ".grok");
  const isolatedGrokHome = await mkdtemp(
    join(tmpdir(), "briar-grok-read-only-"),
  );
  const absoluteWorkspaceRoot = resolve(workspaceRoot);
  try {
    await copyOptionalCredential(
      join(sourceGrokHome, "auth.json"),
      join(isolatedGrokHome, "auth.json"),
    );
    const deniedProjectConfiguration = await existingPaths(
      grokProjectConfigurationPaths(absoluteWorkspaceRoot),
    );
    await writeFile(
      join(isolatedGrokHome, "sandbox.toml"),
      [
        `[profiles.${grokReadOnlyProfile}]`,
        'extends = "strict"',
        "restrict_network = true",
        `read_only = [${JSON.stringify(absoluteWorkspaceRoot)}]`,
        `deny = ${JSON.stringify(deniedProjectConfiguration)}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    await writeFile(
      join(isolatedGrokHome, "config.toml"),
      [
        "[shell_environment_policy]",
        'inherit = "core"',
        "ignore_default_excludes = false",
        'include_only = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE"]',
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
  } catch (error) {
    await rm(isolatedGrokHome, { recursive: true, force: true });
    throw error;
  }
  return {
    environment: {
      ...allowed,
      HOME: isolatedGrokHome,
      USERPROFILE: isolatedGrokHome,
      TMPDIR: isolatedGrokHome,
      TMP: isolatedGrokHome,
      TEMP: isolatedGrokHome,
      GROK_HOME: isolatedGrokHome,
      GROK_SANDBOX: grokReadOnlyProfile,
      GROK_MEMORY: "0",
      GROK_SUBAGENTS: "0",
      GROK_WEB_FETCH: "0",
      GROK_MANAGED_MCPS_ENABLED: "0",
      GROK_TELEMETRY_ENABLED: "0",
      GROK_TELEMETRY_TRACE_UPLOAD: "0",
      GROK_FEEDBACK_ENABLED: "0",
      GROK_DISABLE_AUTOUPDATER: "1",
      GROK_CURSOR_SKILLS_ENABLED: "0",
      GROK_CURSOR_RULES_ENABLED: "0",
      GROK_CURSOR_AGENTS_ENABLED: "0",
      GROK_CURSOR_MCPS_ENABLED: "0",
      GROK_CURSOR_HOOKS_ENABLED: "0",
      GROK_CURSOR_SESSIONS_ENABLED: "0",
      GROK_CLAUDE_SKILLS_ENABLED: "0",
      GROK_CLAUDE_RULES_ENABLED: "0",
      GROK_CLAUDE_AGENTS_ENABLED: "0",
      GROK_CLAUDE_MCPS_ENABLED: "0",
      GROK_CLAUDE_HOOKS_ENABLED: "0",
      GROK_CLAUDE_SESSIONS_ENABLED: "0",
      DISABLE_EMBEDDED_SEARCH_TOOLS: "1",
    },
    stateRoot: isolatedGrokHome,
    cleanup: () => rm(isolatedGrokHome, { recursive: true, force: true }),
  };
}

async function prepareCursorEnvironment(
  allowed: NodeJS.ProcessEnv,
  environment: NodeJS.ProcessEnv,
) {
  const isolatedRoot = await mkdtemp(join(tmpdir(), "briar-cursor-read-only-"));
  const targetCursorHome = join(isolatedRoot, ".cursor");
  const sourceHome = environment.HOME?.trim() || homedir();
  const sourceCursorHome = join(sourceHome, ".cursor");
  try {
    await mkdir(targetCursorHome, { recursive: true, mode: 0o700 });
    for (const name of ["cli-config.json", "auth.json"]) {
      await copyOptionalCredential(
        join(sourceCursorHome, name),
        join(targetCursorHome, name),
      );
    }
  } catch (error) {
    await rm(isolatedRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    environment: {
      ...allowed,
      HOME: isolatedRoot,
      USERPROFILE: isolatedRoot,
      TMPDIR: isolatedRoot,
      TMP: isolatedRoot,
      TEMP: isolatedRoot,
    },
    stateRoot: isolatedRoot,
    cleanup: () => rm(isolatedRoot, { recursive: true, force: true }),
  };
}

/**
 * Pi keeps every piece of its state under `$HOME/.pi/agent` and exposes no
 * environment override for that root, so isolating a read-only turn means
 * giving the process its own `HOME` and copying just the credential file in.
 * `~/.pi/pi-acp` (the adapter's session map) is deliberately left behind: a
 * read-only turn never resumes a recorded session.
 */
async function preparePiEnvironment(
  allowed: NodeJS.ProcessEnv,
  environment: NodeJS.ProcessEnv,
) {
  const isolatedRoot = await mkdtemp(join(tmpdir(), "briar-pi-read-only-"));
  const targetAgentHome = join(isolatedRoot, ".pi", "agent");
  const sourceHome = environment.HOME?.trim() || homedir();
  const sourceAgentHome = join(sourceHome, ".pi", "agent");
  try {
    await mkdir(targetAgentHome, { recursive: true, mode: 0o700 });
    for (const name of ["auth.json", "models.json"]) {
      await copyOptionalCredential(
        join(sourceAgentHome, name),
        join(targetAgentHome, name),
      );
    }
    // A turn must not adopt project-local pi resources it never reviewed.
    // `defaultProjectTrust: "never"` is what makes `--mode rpc`, which shows
    // no trust prompt, ignore `.pi/` in the workspace.
    await writeFile(
      join(targetAgentHome, "settings.json"),
      `${JSON.stringify({ defaultProjectTrust: "never" }, null, 2)}\n`,
      { mode: 0o600 },
    );
  } catch (error) {
    await rm(isolatedRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    environment: {
      ...allowed,
      HOME: isolatedRoot,
      USERPROFILE: isolatedRoot,
      TMPDIR: isolatedRoot,
      TMP: isolatedRoot,
      TEMP: isolatedRoot,
    },
    stateRoot: isolatedRoot,
    cleanup: () => rm(isolatedRoot, { recursive: true, force: true }),
  };
}

async function prepareOpenCodeEnvironment(
  allowed: NodeJS.ProcessEnv,
  environment: NodeJS.ProcessEnv,
) {
  const isolatedRoot = await mkdtemp(
    join(tmpdir(), "briar-opencode-read-only-"),
  );
  const dataRoot = join(isolatedRoot, "data");
  const configRoot = join(isolatedRoot, "config");
  const cacheRoot = join(isolatedRoot, "cache");
  const stateRoot = join(isolatedRoot, "state");
  const targetDataDirectory = join(dataRoot, "opencode");
  const targetConfigDirectory = join(configRoot, "opencode");
  const sourceDataRoot = environment.XDG_DATA_HOME?.trim() ||
    join(environment.HOME?.trim() || homedir(), ".local", "share");
  try {
    await Promise.all([
      mkdir(targetDataDirectory, { recursive: true, mode: 0o700 }),
      mkdir(targetConfigDirectory, { recursive: true, mode: 0o700 }),
      mkdir(cacheRoot, { recursive: true, mode: 0o700 }),
      mkdir(stateRoot, { recursive: true, mode: 0o700 }),
    ]);
    await copyOptionalCredential(
      join(sourceDataRoot, "opencode", "auth.json"),
      join(targetDataDirectory, "auth.json"),
    );
  } catch (error) {
    await rm(isolatedRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    environment: {
      ...allowed,
      HOME: isolatedRoot,
      USERPROFILE: isolatedRoot,
      TMPDIR: isolatedRoot,
      TMP: isolatedRoot,
      TEMP: isolatedRoot,
      XDG_DATA_HOME: dataRoot,
      XDG_CONFIG_HOME: configRoot,
      XDG_CACHE_HOME: cacheRoot,
      XDG_STATE_HOME: stateRoot,
      OPENCODE_CONFIG_DIR: targetConfigDirectory,
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    },
    stateRoot: isolatedRoot,
    cleanup: () => rm(isolatedRoot, { recursive: true, force: true }),
  };
}

async function prepareAgyEnvironment(
  allowed: NodeJS.ProcessEnv,
  environment: NodeJS.ProcessEnv,
) {
  const isolatedRoot = await mkdtemp(join(tmpdir(), "briar-agy-read-only-"));
  const sourceHome = environment.HOME?.trim() || homedir();
  const sourceGeminiHome = join(sourceHome, ".gemini");
  const targetGeminiHome = join(isolatedRoot, ".gemini");
  const targetAgyCache = join(targetGeminiHome, "antigravity-cli", "cache");
  const targetConfig = join(targetGeminiHome, "config");
  try {
    await Promise.all([
      mkdir(targetAgyCache, { recursive: true, mode: 0o700 }),
      mkdir(targetConfig, { recursive: true, mode: 0o700 }),
    ]);
    for (const relativePath of [
      "google_accounts.json",
      "oauth_creds.json",
      "installation_id",
      "antigravity-cli/installation_id",
      "antigravity-cli/cache/default_project_id.txt",
      "config/config.json",
    ]) {
      await copyOptionalCredential(
        join(sourceGeminiHome, relativePath),
        join(targetGeminiHome, relativePath),
      );
    }
  } catch (error) {
    await rm(isolatedRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    environment: {
      ...allowed,
      HOME: isolatedRoot,
      USERPROFILE: isolatedRoot,
      TMPDIR: isolatedRoot,
      TMP: isolatedRoot,
      TEMP: isolatedRoot,
    },
    stateRoot: isolatedRoot,
    cleanup: () => rm(isolatedRoot, { recursive: true, force: true }),
  };
}

/**
 * Codex config can contain a legacy sandbox_mode that overrides a narrower
 * permission profile. Start read-only turns with an ephemeral config home that
 * contains authentication only, then remove all session state on completion.
 */
export async function prepareReadOnlyAgentEnvironment(
  provider: AgentProvider,
  input: {
    workspaceRoot: string;
    environment?: NodeJS.ProcessEnv;
    claudeKeychainCredential?: (
      environment: NodeJS.ProcessEnv,
      sourceClaudeHome: string,
    ) => string | null;
  },
): Promise<PreparedReadOnlyAgentEnvironment> {
  const environment = input.environment ?? process.env;
  const allowed = readOnlyAgentEnvironment(provider, environment);
  const prepared = await preparedProviderEnvironment(
    provider,
    allowed,
    environment,
    input,
  );
  return {
    environment: {
      ...prepared.environment,
      // Resolved from the pre-swap environment, so it still points at the real
      // home after the preparation above replaced HOME.
      ...(await pinnedGoogleApplicationCredentials(provider, environment)),
      [readOnlyStateRootEnvironmentKey]: prepared.stateRoot,
    },
    cleanup: prepared.cleanup,
  };
}

/**
 * Google Application Default Credentials are found relative to the home
 * directory, and every read-only preparation swaps `HOME` for an isolated
 * root. Pin the ADC file as an absolute path so google-auth-library still
 * finds it, without copying the credential anywhere.
 *
 * Nothing is pinned when the caller already named a credential file, when the
 * provider does not authenticate this way, or when the machine has no ADC file
 * — the last case is a real "not signed in", and the provider reports it.
 */
async function pinnedGoogleApplicationCredentials(
  provider: AgentProvider,
  environment: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  if (!usesGoogleApplicationDefaultCredentials(provider)) return {};
  if (environment.GOOGLE_APPLICATION_CREDENTIALS?.trim()) return {};
  const gcloudConfigRoot = environment.CLOUDSDK_CONFIG?.trim() ||
    join(environment.HOME?.trim() || homedir(), ".config", "gcloud");
  const [adcPath] = await existingPaths([
    join(gcloudConfigRoot, "application_default_credentials.json"),
  ]);
  return adcPath ? { GOOGLE_APPLICATION_CREDENTIALS: adcPath } : {};
}

function preparedProviderEnvironment(
  provider: AgentProvider,
  allowed: NodeJS.ProcessEnv,
  environment: NodeJS.ProcessEnv,
  input: {
    workspaceRoot: string;
    claudeKeychainCredential?: (
      environment: NodeJS.ProcessEnv,
      sourceClaudeHome: string,
    ) => string | null;
  },
): Promise<{
  environment: NodeJS.ProcessEnv;
  stateRoot: string;
  cleanup: () => Promise<void>;
}> {
  if (provider === "codex") {
    return prepareCodexEnvironment(allowed, environment);
  }
  if (provider === "claude") {
    return prepareClaudeEnvironment(
      allowed,
      environment,
      input.claudeKeychainCredential ?? readClaudeKeychainCredential,
    );
  }
  if (provider === "grok") {
    return prepareGrokEnvironment(
      allowed,
      environment,
      input.workspaceRoot,
    );
  }
  if (provider === "cursor") {
    return prepareCursorEnvironment(allowed, environment);
  }
  if (provider === "agy") {
    return prepareAgyEnvironment(allowed, environment);
  }
  return prepareOpenCodeEnvironment(allowed, environment);
}

const noReadOnlyIsolation = (environment: NodeJS.ProcessEnv) => ({
  environment,
  cleanup: () => Promise.resolve(),
});

/**
 * Runner-side entry point for read-only isolation.
 *
 * The desktop app spawns a runner bundle with the plain process environment,
 * so the runner itself has to build the isolated provider home the seatbelt
 * profile and the provider's own "state is not isolated" guards expect. The
 * worker path prepares that environment before it spawns the runner, which is
 * why an environment already carrying {@link readOnlyStateRootEnvironmentKey}
 * is passed straight through instead of isolated twice.
 */
export async function ensureReadOnlyAgentEnvironment(
  provider: AgentProvider,
  input: {
    readOnly: boolean;
    workspaceRoot: string;
    environment?: NodeJS.ProcessEnv;
  },
): Promise<PreparedReadOnlyAgentEnvironment> {
  const environment = input.environment ?? process.env;
  if (!input.readOnly) return noReadOnlyIsolation(environment);
  if (environment[readOnlyStateRootEnvironmentKey]?.trim()) {
    return noReadOnlyIsolation(environment);
  }
  return prepareReadOnlyAgentEnvironment(provider, {
    workspaceRoot: input.workspaceRoot,
    environment,
  });
}
