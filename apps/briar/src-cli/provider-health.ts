import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  agentProviderBinaryName,
  agentProviders,
  type AgentProvider,
} from "../src/lib/agent-provider";
import {
  probeWorkerProviderUsage,
  type ProviderUsageProbe,
  type ProviderUsageProbeDependencies,
} from "./provider-usage";

export const workerProviderIds = agentProviders;
export type WorkerProvider = AgentProvider;

export type WorkerProviderHealthReason =
  | "disabled"
  | "not_installed"
  | "not_authenticated"
  | "usage_exhausted"
  | null;

export type WorkerProviderHealth = {
  installed: boolean;
  authenticated: boolean;
  healthy: boolean;
  reason: WorkerProviderHealthReason;
  /** Present when usage was successfully read or known exhausted. */
  usageExhausted?: boolean;
  maxUsedPercent?: number | null;
};

export type WorkerProviderHealthMap = Record<
  WorkerProvider,
  WorkerProviderHealth
>;

type ProviderHealthDependencies = {
  home: string;
  openrouterApiKey: string | null;
  now: () => number;
  which: (provider: WorkerProvider) => string | null;
  authenticated: (
    provider: WorkerProvider,
    binary: string,
    home: string,
    now: number,
    openrouterApiKey: string | null,
  ) => Promise<boolean>;
  /**
   * Probe remaining provider quota. Return `exhausted: true` only when usage
   * is known to be fully consumed. Unknown/error results keep the provider
   * selectable (fail open) so transient probe failures do not offline hosts.
   */
  usage: (
    provider: WorkerProvider,
    binary: string | null,
    home: string,
    now: number,
  ) => Promise<ProviderUsageProbe>;
};

const commandResult = (binary: string, args: string[]) =>
  spawnSync(binary, args, {
    encoding: "utf8",
    env: process.env,
    timeout: 10_000,
  });

const agyCommandResult = (binary: string, args: string[]) => {
  const env = { ...process.env };
  for (const key of [
    "AGY_ADC_AUTH",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
  ]) {
    delete env[key];
  }
  return spawnSync(binary, args, { encoding: "utf8", env, timeout: 10_000 });
};

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

export const claudeAuthenticated = async (binary: string) => {
  const result = commandResult(binary, ["auth", "status"]);
  return parseClaudeAuthStatus(result.stdout);
};

const cursorEmailIsAuthenticated = (value: unknown) => {
  if (typeof value !== "string") return false;
  const email = value.trim().toLowerCase();
  return Boolean(
    email && email !== "not logged in" &&
      !email.includes("login required") &&
      !email.includes("authentication required"),
  );
};

export const parseCursorAuthStatus = (stdout: string) => {
  try {
    const status = JSON.parse(stdout) as { userEmail?: unknown };
    return cursorEmailIsAuthenticated(status.userEmail);
  } catch {
    const line = stdout.split(/\r?\n/u).find((candidate) =>
      candidate.trimStart().startsWith("User Email"),
    );
    return cursorEmailIsAuthenticated(
      line?.trimStart().slice("User Email".length).trim(),
    );
  }
};

export const cursorAuthenticated = async (binary: string) => {
  if (process.env.CURSOR_API_KEY?.trim()) return true;
  const json = commandResult(binary, ["about", "--format", "json"]);
  if (json.status === 0 && parseCursorAuthStatus(json.stdout)) return true;
  const plain = commandResult(binary, ["about"]);
  return plain.status === 0 && parseCursorAuthStatus(plain.stdout);
};

export const agyAuthenticated = async (binary: string) => {
  const result = agyCommandResult(binary, ["--output-format", "json", "models"]);
  return result.status === 0 && !result.error;
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
  openrouterApiKey: process.env.OPENROUTER_API_KEY?.trim() || null,
  now: Date.now,
  which: (provider) => Bun.which(agentProviderBinaryName(provider)),
  authenticated: async (provider, binary, home, now, openrouterApiKey) => {
    if (provider === "codex") {
      return codexAuthenticated(binary);
    }
    if (provider === "claude") {
      return claudeAuthenticated(binary);
    }
    if (provider === "cursor") {
      return cursorAuthenticated(binary);
    }
    if (provider === "opencode") {
      // OpenCode delegates credentials to its configured model providers.
      return true;
    }
    if (provider === "openrouter") {
      return Boolean(openrouterApiKey?.trim());
    }
    if (provider === "agy") {
      return agyAuthenticated(binary);
    }
    return grokAuthenticated(home, now);
  },
  usage: async (provider, binary, home, now) =>
    probeWorkerProviderUsage(provider, {
      home,
      now: () => now,
      which: () => binary,
    }),
};

export async function inspectWorkerProviderHealth(
  enabled: Record<WorkerProvider, boolean>,
  dependencies: Partial<
    ProviderHealthDependencies & {
      usageProbe?: Partial<ProviderUsageProbeDependencies>;
    }
  > = {},
): Promise<WorkerProviderHealthMap> {
  const resolved: ProviderHealthDependencies = {
    ...defaultDependencies,
    ...dependencies,
    usage:
      dependencies.usage ??
      (async (provider, binary, home, now) =>
        probeWorkerProviderUsage(provider, {
          home,
          now: () => now,
          which: () => binary,
          ...dependencies.usageProbe,
        })),
  };
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
              resolved.openrouterApiKey,
            )
          : false;
      if (!enabled[provider]) {
        return [
          provider,
          {
            installed,
            authenticated: false,
            healthy: false,
            reason: "disabled" as const,
          },
        ] as const;
      }
      if (!installed) {
        return [
          provider,
          {
            installed: false,
            authenticated: false,
            healthy: false,
            reason: "not_installed" as const,
          },
        ] as const;
      }
      if (!authenticated) {
        return [
          provider,
          {
            installed: true,
            authenticated: false,
            healthy: false,
            reason: "not_authenticated" as const,
          },
        ] as const;
      }

      const usage = await resolved.usage(
        provider,
        binary,
        resolved.home,
        resolved.now(),
      );
      if (usage.exhausted) {
        return [
          provider,
          {
            installed: true,
            authenticated: true,
            healthy: false,
            reason: "usage_exhausted" as const,
            usageExhausted: true,
            maxUsedPercent: usage.maxUsedPercent,
          },
        ] as const;
      }
      return [
        provider,
        {
          installed: true,
          authenticated: true,
          healthy: true,
          reason: null,
          usageExhausted: false,
          maxUsedPercent: usage.maxUsedPercent,
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

/** Readiness copy when no healthy provider remains after install/auth/usage checks. */
export function providerHealthReadinessDetail(
  health: WorkerProviderHealthMap,
): string {
  const values = workerProviderIds.map((provider) => health[provider]);
  if (
    values.some((entry) => entry.reason === "usage_exhausted") &&
    values.every(
      (entry) =>
        !entry.healthy &&
        (entry.reason === "usage_exhausted" ||
          entry.reason === "disabled" ||
          entry.reason === "not_installed" ||
          entry.reason === "not_authenticated"),
    ) &&
    values.some((entry) => entry.authenticated)
  ) {
    return "사용량 한도에 도달해 실행할 수 있는 coding agent가 없습니다.";
  }
  return "로그인되어 사용할 수 있는 coding agent가 없습니다.";
}
