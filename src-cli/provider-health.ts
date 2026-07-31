import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const workerProviderIds = ["codex", "claude", "grok"] as const;
export type WorkerProvider = (typeof workerProviderIds)[number];

export type WorkerProviderHealth = {
  installed: boolean;
  authenticated: boolean;
  healthy: boolean;
  reason: "disabled" | "not_installed" | "not_authenticated" | null;
};

export type WorkerProviderHealthMap = Record<
  WorkerProvider,
  WorkerProviderHealth
>;

type ProviderHealthDependencies = {
  home: string;
  now: () => number;
  which: (provider: WorkerProvider) => string | null;
  authenticated: (
    provider: WorkerProvider,
    binary: string,
    home: string,
    now: number,
  ) => Promise<boolean>;
};

const commandResult = (binary: string, args: string[]) =>
  spawnSync(binary, args, {
    encoding: "utf8",
    env: process.env,
    timeout: 10_000,
  });

const codexAuthenticated = (binary: string) => {
  const result = commandResult(binary, ["login", "status"]);
  return result.status === 0 && !result.error;
};

export const parseClaudeAuthStatus = (stdout: string) => {
  try {
    const status = JSON.parse(stdout) as { loggedIn?: unknown };
    return status.loggedIn === true;
  } catch {
    return false;
  }
};

const hasClaudeOauthToken = (contents: string) => {
  try {
    const credentials = JSON.parse(contents) as {
      claudeAiOauth?: { accessToken?: unknown };
    };
    return (
      typeof credentials.claudeAiOauth?.accessToken === "string" &&
      credentials.claudeAiOauth.accessToken.trim().length > 0
    );
  } catch {
    return false;
  }
};

const claudeAuthenticated = async (binary: string, home: string) => {
  const configDirectory =
    process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");
  try {
    if (
      hasClaudeOauthToken(
        await readFile(join(configDirectory, ".credentials.json"), "utf8"),
      )
    ) {
      return true;
    }
  } catch {
    // Claude stores OAuth credentials in Keychain on macOS.
  }
  if (process.platform === "darwin") {
    const account = process.env.USER || process.env.USERNAME || "user";
    const suffix = createHash("sha256")
      .update(configDirectory)
      .digest("hex")
      .slice(0, 8);
    for (const service of [
      `Claude Code-credentials-${suffix}`,
      "Claude Code-credentials",
    ]) {
      const result = spawnSync(
        "/usr/bin/security",
        ["find-generic-password", "-s", service, "-a", account, "-w"],
        { encoding: "utf8", timeout: 10_000 },
      );
      if (result.status === 0 && hasClaudeOauthToken(result.stdout)) {
        return true;
      }
    }
  }
  const result = commandResult(binary, ["auth", "status"]);
  return parseClaudeAuthStatus(result.stdout);
};

const validGrokSession = (value: unknown, now: number) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.key !== "string" || entry.key.length === 0) return false;
  if (typeof entry.expiresAt !== "string") return true;
  const expiresAt = Date.parse(entry.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now + 5 * 60_000;
};

export const grokAuthenticated = async (home: string, now: number) => {
  const grokHome =
    process.env.GROK_HOME?.trim() || join(home, ".grok");
  try {
    const parsed = JSON.parse(
      await readFile(join(grokHome, "auth.json"), "utf8"),
    ) as Record<string, unknown>;
    const preferred = Object.entries(parsed).filter(
      ([issuer]) =>
        issuer === "https://auth.x.ai" ||
        issuer.startsWith("https://auth.x.ai::"),
    );
    const candidates =
      preferred.length > 0 ? preferred : Object.entries(parsed);
    return candidates.some(([, value]) => validGrokSession(value, now));
  } catch {
    return false;
  }
};

const defaultDependencies: ProviderHealthDependencies = {
  home: homedir(),
  now: Date.now,
  which: (provider) => Bun.which(provider),
  authenticated: async (provider, binary, home, now) => {
    if (provider === "codex") {
      return codexAuthenticated(binary);
    }
    if (provider === "claude") {
      return claudeAuthenticated(binary, home);
    }
    return grokAuthenticated(home, now);
  },
};

export async function inspectWorkerProviderHealth(
  enabled: Record<WorkerProvider, boolean>,
  dependencies: Partial<ProviderHealthDependencies> = {},
): Promise<WorkerProviderHealthMap> {
  const resolved = { ...defaultDependencies, ...dependencies };
  const entries = await Promise.all(
    workerProviderIds.map(async (provider) => {
      const binary = resolved.which(provider);
      const installed = Boolean(binary);
      const authenticated =
        enabled[provider] && binary
          ? await resolved.authenticated(
              provider,
              binary,
              resolved.home,
              resolved.now(),
            )
          : false;
      const healthy = enabled[provider] && installed && authenticated;
      return [
        provider,
        {
          installed,
          authenticated,
          healthy,
          reason: healthy
            ? null
            : !enabled[provider]
              ? "disabled"
              : !installed
                ? "not_installed"
                : "not_authenticated",
        },
      ] as const;
    }),
  );
  return Object.fromEntries(entries) as WorkerProviderHealthMap;
}

export function healthyWorkerProviders(
  health: WorkerProviderHealthMap,
): WorkerProvider[] {
  return workerProviderIds.filter((provider) => health[provider].healthy);
}
