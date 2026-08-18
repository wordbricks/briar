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
import type { AgentProvider } from "../src/lib/agent-provider-contract";

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
]);

const providerPrefixes: Record<AgentProvider, string[]> = {
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
  openrouter: ["OPENROUTER_"],
};

const providerEnvironmentKeys: Record<AgentProvider, Set<string>> = {
  codex: new Set(["CODEX_ACCESS_TOKEN"]),
  claude: new Set(["CLAUDE_CODE_OAUTH_TOKEN"]),
  cursor: new Set(["CURSOR_API_KEY"]),
  grok: new Set(["XAI_API_KEY"]),
  agy: new Set(),
  opencode: new Set(),
  openrouter: new Set(["OPENCODE_CONFIG_CONTENT"]),
};

const grokReadOnlyProfile = "briar_read_only";

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
  const prefixes = providerPrefixes[provider];
  const exactKeys = providerEnvironmentKeys[provider];
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
    const copied = await copyOptionalCredential(
      join(sourceClaudeHome, ".credentials.json"),
      join(isolatedClaudeHome, ".credentials.json"),
    );
    if (!copied) {
      const credential = keychainCredential(environment, sourceClaudeHome);
      if (credential) {
        await writeFile(
          join(isolatedClaudeHome, ".credentials.json"),
          normalizedClaudeCredential(credential),
          { mode: 0o600 },
        );
      }
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
