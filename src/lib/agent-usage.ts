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
  updatedAt: number;
  error: string | null;
};

export type AgentUsageSnapshot = {
  claude: AgentUsageProvider;
  codex: AgentUsageProvider;
  grok: AgentUsageProvider;
  updatedAt: number;
};

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function loadAgentUsage(): Promise<AgentUsageSnapshot> {
  if (!isTauri()) {
    throw new Error("Agent usage is available in the Briar desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentUsageSnapshot>("load_agent_usage");
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
