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

const agentProviderMenuPositions = new Map<AgentProvider, number>(
  agentProviders.map((provider, index) => [provider, index]),
);

export function sortAgentProviders(
  providers: readonly AgentProvider[],
): AgentProvider[] {
  return providers
    .map((provider, index) => ({ provider, index }))
    .sort((left, right) => {
      const order = (agentProviderMenuPositions.get(left.provider) ?? Infinity) -
        (agentProviderMenuPositions.get(right.provider) ?? Infinity);
      return order || left.index - right.index;
    })
    .map(({ provider }) => provider);
}

export function agentProviderBinaryName(provider: AgentProvider) {
  if (provider === "cursor") return "cursor-agent";
  if (provider === "openrouter") return "opencode";
  return provider;
}

export const agentProviderLabels = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
  grok: "Grok",
  agy: "Antigravity",
  opencode: "OpenCode",
  openrouter: "OpenRouter",
} satisfies Record<AgentProvider, string>;
