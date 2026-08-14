export const agentProviders = [
  "codex",
  "claude",
  "grok",
  "agy",
  "opencode",
] as const;
export type AgentProvider = (typeof agentProviders)[number];

export const modelEfforts = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;
export type ModelEffort = (typeof modelEfforts)[number];

export type AgentProviderModelDefinition = {
  id: string;
  label: string;
};

export type AgentProviderPolicy = {
  label: string;
  models: readonly AgentProviderModelDefinition[];
  efforts: readonly ModelEffort[];
  allowUnlistedModels: boolean;
};

const standardEfforts = modelEfforts;
const claudeEfforts = modelEfforts.filter((effort) => effort !== "ultra");
const limitedEfforts = modelEfforts.filter(
  (effort) => effort === "low" || effort === "medium" || effort === "high",
);

export const agentProviderPolicies: Record<AgentProvider, AgentProviderPolicy> = {
  codex: {
    label: "Codex",
    models: [
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    ],
    efforts: standardEfforts,
    allowUnlistedModels: false,
  },
  claude: {
    label: "Claude",
    models: [
      { id: "sonnet", label: "Claude Sonnet" },
      { id: "opus", label: "Claude Opus" },
      { id: "haiku", label: "Claude Haiku" },
      { id: "fable", label: "Claude Fable" },
    ],
    efforts: claudeEfforts,
    allowUnlistedModels: false,
  },
  grok: {
    label: "Grok",
    models: [
      { id: "grok-4.5", label: "Grok 4.5" },
      { id: "grok-build", label: "Grok Build" },
    ],
    efforts: limitedEfforts,
    allowUnlistedModels: false,
  },
  agy: {
    label: "Antigravity",
    models: [],
    efforts: limitedEfforts,
    allowUnlistedModels: true,
  },
  opencode: {
    label: "OpenCode",
    models: [],
    efforts: limitedEfforts,
    allowUnlistedModels: true,
  },
};

export const agentProviderLabels = Object.fromEntries(
  agentProviders.map((provider) => [provider, agentProviderPolicies[provider].label]),
) as Record<AgentProvider, string>;

export function agentProviderAllowsModel(
  provider: AgentProvider,
  model: string,
) {
  const policy = agentProviderPolicies[provider];
  return (
    policy.allowUnlistedModels ||
    policy.models.some((candidate) => candidate.id === model)
  );
}

export function agentProviderAllowsEffort(
  provider: AgentProvider,
  effort: ModelEffort,
) {
  return agentProviderPolicies[provider].efforts.includes(effort);
}
