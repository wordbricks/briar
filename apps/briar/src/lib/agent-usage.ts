import {
  agentProviderLabels,
  type AgentProvider,
} from "./agent-provider";
import {
  commands,
  type AgentProviderKind,
  type AgentUsageSnapshot as NativeAgentUsageSnapshot,
  type AgentUsageWindow,
  type ProviderUsage,
} from "../generated/tauri";

export const quotaUsageProviders = [
  "claude",
  "codex",
  "grok",
  "agy",
  "opencode",
  "openrouter",
  "cursor",
] as const satisfies readonly AgentProviderKind[];

export type AgentUsageProvider = ProviderUsage;
export type AgentUsageSnapshot = NativeAgentUsageSnapshot;

export function emptyUsageProvider(
  provider: AgentProviderKind,
): AgentUsageProvider {
  return {
    provider,
    status: "unavailable",
    session: null,
    weekly: null,
    monthly: null,
    planType: null,
    accountLabel: null,
    authenticated: false,
    updatedAt: 0,
    error: null,
  };
}

export function quotaUsageProviderLabel(provider: AgentProviderKind) {
  return agentProviderLabels[provider];
}

const historyStorageKey = "briar.agent-usage.history.v1";
const historyLimit = 96;

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function loadAgentUsage(): Promise<AgentUsageSnapshot> {
  if (!isTauri()) {
    throw new Error("Agent usage is available in the Briar desktop app.");
  }
  return commands.loadAgentUsage();
}

export async function openAgentProviderLogin(
  provider: AgentProvider,
) {
  if (!isTauri()) {
    throw new Error("Provider sign-in is available in the Briar desktop app.");
  }
  return commands.openAgentProviderLogin(provider);
}

function isQuotaUsageProvider(value: unknown): value is AgentProviderKind {
  return (
    value === "claude" ||
    value === "codex" ||
    value === "grok" ||
    value === "agy" ||
    value === "opencode" ||
    value === "openrouter" ||
    value === "cursor"
  );
}

function usageProviderFrom(value: unknown): AgentUsageProvider | null {
  if (!value || typeof value !== "object") return null;
  const provider = value as Partial<AgentUsageProvider>;
  if (
    !isQuotaUsageProvider(provider.provider) ||
    (provider.status !== "ok" &&
      provider.status !== "error" &&
      provider.status !== "unavailable") ||
    typeof provider.updatedAt !== "number"
  ) {
    return null;
  }
  return {
    ...provider,
    accountLabel: typeof provider.accountLabel === "string"
      ? provider.accountLabel
      : null,
    authenticated: provider.authenticated === true,
  } as AgentUsageProvider;
}

function parseUsageSnapshot(value: unknown): AgentUsageSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<AgentUsageSnapshot>;
  const claude = usageProviderFrom(snapshot.claude);
  const codex = usageProviderFrom(snapshot.codex);
  const grok = usageProviderFrom(snapshot.grok);
  if (
    typeof snapshot.updatedAt !== "number" ||
    !claude ||
    !codex ||
    !grok
  ) {
    return null;
  }
  return {
    claude,
    codex,
    grok,
    agy: usageProviderFrom(snapshot.agy) ?? emptyUsageProvider("agy"),
    opencode: usageProviderFrom(snapshot.opencode) ??
      emptyUsageProvider("opencode"),
    openrouter: usageProviderFrom(snapshot.openrouter) ??
      emptyUsageProvider("openrouter"),
    cursor: usageProviderFrom(snapshot.cursor) ?? emptyUsageProvider("cursor"),
    updatedAt: snapshot.updatedAt,
  };
}

export function readAgentUsageHistory(): AgentUsageSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(historyStorageKey) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseUsageSnapshot)
      .filter((snapshot): snapshot is AgentUsageSnapshot => snapshot !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, historyLimit);
  } catch {
    return [];
  }
}

export function recordAgentUsageSnapshot(
  snapshot: AgentUsageSnapshot,
): AgentUsageSnapshot[] {
  const minute = Math.floor(snapshot.updatedAt / 60_000);
  const history = [
    snapshot,
    ...readAgentUsageHistory().filter(
      (item) => Math.floor(item.updatedAt / 60_000) !== minute,
    ),
  ].slice(0, historyLimit);
  try {
    window.localStorage.setItem(historyStorageKey, JSON.stringify(history));
  } catch {
    // The current session can still show the newly collected snapshot.
  }
  return history;
}

export function clearAgentUsageHistory() {
  try {
    window.localStorage.removeItem(historyStorageKey);
  } catch {
    // Ignore storage failures; callers still clear their in-memory history.
  }
}

export function tightestUsageWindow(provider: AgentUsageProvider) {
  const windows = [provider.session, provider.weekly, provider.monthly].filter(
    (window): window is AgentUsageWindow => window !== null,
  );
  return (
    windows.sort((left, right) => right.usedPercent - left.usedPercent)[0] ??
    null
  );
}

/**
 * True when any known quota window is fully consumed.
 * Unknown or failed usage reads are not treated as exhausted so workers stay
 * available until a positive 100% reading is observed.
 */
export function isProviderUsageExhausted(
  provider: Pick<
    AgentUsageProvider,
    "status" | "session" | "weekly" | "monthly"
  >,
  thresholdPercent = 100,
): boolean {
  if (provider.status !== "ok") return false;
  const windows = [provider.session, provider.weekly, provider.monthly].filter(
    (window): window is AgentUsageWindow => window !== null,
  );
  return windows.some((window) => window.usedPercent >= thresholdPercent);
}

export function formatUsageDuration(milliseconds: number) {
  const minutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0
      ? `${hours}h ${remainingMinutes}m`
      : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

export function formatUsageWindowLabel(window: AgentUsageWindow) {
  if (window.windowMinutes <= 300) return "5h";
  if (window.windowMinutes <= 10_080) return "wk";
  return `${Math.round(window.windowMinutes / 1_440)}d`;
}
