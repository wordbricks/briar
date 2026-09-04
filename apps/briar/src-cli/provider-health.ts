import { homedir } from "node:os";
import {
  agentProviders,
  agentProviderBinaryName,
  type AgentProvider,
} from "../src/lib/agent-provider";
import {
  agyAuthenticated,
  claudeAuthenticated,
  codexAuthenticated,
  cursorAuthenticated,
  grokAuthenticated,
  opencodeAuthenticated,
  parseClaudeAuthStatus,
  parseCursorAboutEmail,
} from "./provider-credentials";
import {
  probeWorkerProviderUsage,
  type ProviderUsageProbe,
  type ProviderUsageProbeDependencies,
} from "./provider-usage";
import {
  activeProviderBlock,
  type ActiveProviderBlock,
} from "./provider-block-registry";

export {
  agyAuthenticated,
  claudeAuthenticated,
  codexAuthenticated,
  cursorAuthenticated,
  grokAuthenticated,
  opencodeAuthenticated,
  parseClaudeAuthStatus,
  parseCursorAboutEmail,
};

export const workerProviderIds = agentProviders;
export type WorkerProvider = AgentProvider;

export type WorkerProviderHealthReason =
  | "disabled"
  | "not_installed"
  | "not_authenticated"
  | "usage_exhausted"
  | "billing_required"
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
  /** A block a runner reported for this provider that is still in force. */
  runtimeBlock: (
    provider: WorkerProvider,
    now: number,
  ) => ActiveProviderBlock | null;
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

const defaultDependencies: ProviderHealthDependencies = {
  home: homedir(),
  openrouterApiKey: process.env.OPENROUTER_API_KEY?.trim() || null,
  now: Date.now,
  which: (provider) => Bun.which(agentProviderBinaryName(provider)),
  runtimeBlock: (provider, now) => activeProviderBlock(provider, () => now),
  authenticated: async (provider, binary, home, now, openrouterApiKey) => {
    if (provider === "codex") {
      return codexAuthenticated(home);
    }
    if (provider === "claude") {
      return claudeAuthenticated(binary);
    }
    if (provider === "cursor") {
      return cursorAuthenticated(binary);
    }
    if (provider === "opencode") {
      return opencodeAuthenticated(home);
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

      // A runner saw the provider refuse work moments ago; that beats a
      // cached or unavailable quota probe until the hold ends.
      const runtimeBlock = resolved.runtimeBlock(provider, resolved.now());
      if (runtimeBlock) {
        return [provider, runtimeBlockHealth(runtimeBlock)] as const;
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

function runtimeBlockHealth(entry: ActiveProviderBlock): WorkerProviderHealth {
  switch (entry.block.reason) {
    case "auth_required":
      return {
        installed: true,
        authenticated: false,
        healthy: false,
        reason: "not_authenticated",
      };
    case "billing_required":
      return {
        installed: true,
        authenticated: true,
        healthy: false,
        reason: "billing_required",
        usageExhausted: false,
      };
    default:
      return {
        installed: true,
        authenticated: true,
        healthy: false,
        reason: "usage_exhausted",
        usageExhausted: true,
        maxUsedPercent: 100,
      };
  }
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
  const blockedReasons = new Set(["usage_exhausted", "billing_required"]);
  if (
    values.some((entry) => entry.reason !== null && blockedReasons.has(entry.reason)) &&
    values.every(
      (entry) =>
        !entry.healthy &&
        (entry.reason === "usage_exhausted" ||
          entry.reason === "billing_required" ||
          entry.reason === "disabled" ||
          entry.reason === "not_installed" ||
          entry.reason === "not_authenticated"),
    ) &&
    values.some((entry) => entry.authenticated)
  ) {
    if (values.every((entry) => entry.reason !== "usage_exhausted")) {
      return "결제 또는 크레딧 문제로 실행할 수 있는 coding agent가 없습니다.";
    }
    return "사용량 한도에 도달해 실행할 수 있는 coding agent가 없습니다.";
  }
  return "로그인되어 사용할 수 있는 coding agent가 없습니다.";
}
