import type { AgentProvider } from "./project-llm";

export type AgentUsageStatus = "ok" | "error" | "unavailable";

export type AgentUsageWindow = {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number | null;
};

export type AgentUsageProvider = {
  provider: "claude" | "codex" | "grok";
  status: AgentUsageStatus;
  session: AgentUsageWindow | null;
  weekly: AgentUsageWindow | null;
  monthly: AgentUsageWindow | null;
  planType: string | null;
  accountLabel?: string | null;
  authenticated?: boolean;
  updatedAt: number;
  error: string | null;
};

export type AgentUsageSnapshot = {
  claude: AgentUsageProvider;
  codex: AgentUsageProvider;
  grok: AgentUsageProvider;
  updatedAt: number;
};

const historyStorageKey = "briar.agent-usage.history.v1";
const historyLimit = 96;

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function loadAgentUsage(): Promise<AgentUsageSnapshot> {
  if (!isTauri()) {
    throw new Error("Agent usage is available in the Briar desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentUsageSnapshot>("load_agent_usage");
}

export async function openAgentProviderLogin(
  provider: AgentProvider,
) {
  if (!isTauri()) {
    throw new Error("Provider sign-in is available in the Briar desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<void>("open_agent_provider_login", { provider });
}

function isUsageProvider(value: unknown): value is AgentUsageProvider {
  if (!value || typeof value !== "object") return false;
  const provider = value as Partial<AgentUsageProvider>;
  return (
    (provider.provider === "claude" ||
      provider.provider === "codex" ||
      provider.provider === "grok") &&
    (provider.status === "ok" ||
      provider.status === "error" ||
      provider.status === "unavailable") &&
    typeof provider.updatedAt === "number"
  );
}

function isUsageSnapshot(value: unknown): value is AgentUsageSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<AgentUsageSnapshot>;
  return (
    typeof snapshot.updatedAt === "number" &&
    isUsageProvider(snapshot.claude) &&
    isUsageProvider(snapshot.codex) &&
    isUsageProvider(snapshot.grok)
  );
}

export function readAgentUsageHistory(): AgentUsageSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(historyStorageKey) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isUsageSnapshot)
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
