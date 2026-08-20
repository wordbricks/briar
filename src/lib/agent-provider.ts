export const agentProviders = [
  "codex",
  "claude",
  "cursor",
  "grok",
  "agy",
  "opencode",
  "openrouter",
] as const;

export type AgentProvider = (typeof agentProviders)[number];

export function agentProviderBinaryName(provider: AgentProvider) {
  if (provider === "cursor") return "cursor-agent";
  if (provider === "openrouter") return "opencode";
  return provider;
}

export const agentProviderLabels: Record<AgentProvider, string> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
  grok: "Grok",
  agy: "Antigravity",
  opencode: "OpenCode",
  openrouter: "OpenRouter",
};
