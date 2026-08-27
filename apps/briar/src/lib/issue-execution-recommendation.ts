import type { IssueDifficulty } from "./issue-difficulty";
import {
  agentProviderSupportsSelection,
  type AgentModelCapability,
  type AgentProviderCapabilityCatalog,
  type ModelEffort,
} from "./agent-provider-contract";
import type { AgentProvider } from "./agent-provider";

export type IssueExecutionRecommendation = {
  provider: AgentProvider;
  model: string;
  effort: ModelEffort | null;
};

type RecommendedModel = {
  provider: AgentProvider;
  effort: ModelEffort | null;
  exactAliases?: readonly string[];
  signatures: ReadonlyArray<readonly string[]>;
};

const recommendedModelsByDifficulty = {
  easy: [
    {
      provider: "agy",
      effort: null,
      signatures: [["gemini", "3", "7", "flash", "high"]],
    },
    {
      provider: "opencode",
      effort: "high",
      exactAliases: [
        "deepseek-v4-flash",
        "opencode-go/deepseek-v4-flash",
      ],
      signatures: [["deepseek", "v4", "flash", "0731"]],
    },
    {
      provider: "codex",
      effort: "max",
      signatures: [["gpt", "5", "6", "luna"]],
    },
    {
      provider: "claude",
      effort: "high",
      exactAliases: ["sonnet", "claude-sonnet"],
      signatures: [["sonnet", "5"]],
    },
    {
      provider: "openrouter",
      effort: "high",
      exactAliases: ["deepseek-v4-flash"],
      signatures: [["deepseek", "v4", "flash", "0731"]],
    },
  ],
  normal: [
    {
      provider: "codex",
      effort: "max",
      signatures: [["gpt", "5", "6", "luna"]],
    },
    {
      provider: "claude",
      effort: "high",
      exactAliases: ["opus", "claude-opus"],
      signatures: [["opus", "5"]],
    },
    {
      provider: "grok",
      effort: "high",
      signatures: [["grok", "4", "6"]],
    },
  ],
  hard: [
    {
      provider: "codex",
      effort: "xhigh",
      signatures: [["gpt", "5", "6", "sol"]],
    },
    {
      provider: "claude",
      effort: "high",
      exactAliases: ["opus", "claude-opus"],
      signatures: [["opus", "5"]],
    },
  ],
} as const satisfies Record<IssueDifficulty, readonly RecommendedModel[]>;

const normalizedModelName = (value: string) =>
  value.normalize("NFKD").toLocaleLowerCase("en-US").replace(
    /[^a-z0-9]+/gu,
    "-",
  ).replace(/^-+|-+$/gu, "");

const modelNameTokens = (value: string) =>
  normalizedModelName(value).split("-").filter(Boolean);

function includesTokenSequence(
  tokens: readonly string[],
  signature: readonly string[],
) {
  if (signature.length > tokens.length) return false;
  return tokens.some((_, start) =>
    signature.every((token, offset) => tokens[start + offset] === token)
  );
}

function matchesRecommendedModel(
  model: AgentModelCapability,
  recommendation: RecommendedModel,
) {
  const names = [model.id, model.label];
  const aliases = new Set(
    (recommendation.exactAliases ?? []).map(normalizedModelName),
  );
  return names.some((name) => {
    const normalized = normalizedModelName(name);
    if (aliases.has(normalized)) return true;
    const tokens = modelNameTokens(name);
    return recommendation.signatures.some((signature) =>
      includesTokenSequence(tokens, signature)
    );
  });
}

/**
 * Selects only a centrally designated model that a live Worker advertised.
 * The returned model ID is the provider-owned ID from the capability catalog,
 * so harmless prefix and display-name variations never become guessed IDs.
 */
export function recommendIssueExecution(
  difficulty: IssueDifficulty | null,
  catalog: AgentProviderCapabilityCatalog,
  providerConstraint?: AgentProvider | null,
  selectionAvailable: (
    selection: IssueExecutionRecommendation,
  ) => boolean = () => true,
): IssueExecutionRecommendation | null {
  if (!difficulty) return null;
  const recommendations = recommendedModelsByDifficulty[difficulty];
  if (!recommendations) return null;
  for (const recommendation of recommendations) {
    if (
      providerConstraint && recommendation.provider !== providerConstraint
    ) continue;
    const capability = catalog[recommendation.provider];
    const model = capability.models.find((candidate) =>
      matchesRecommendedModel(candidate, recommendation) &&
      agentProviderSupportsSelection(
        capability,
        candidate.id,
        recommendation.effort,
      )
    );
    if (!model) continue;
    const selection = {
      provider: recommendation.provider,
      model: model.id,
      effort: recommendation.effort,
    };
    if (selectionAvailable(selection)) return selection;
  }
  return null;
}
