import type { AgentProvider } from "./agent-provider";

/** Only providers with enforced workspace and product tool isolation may classify execution intent. */
export function supportsDetachedProviderClassification(provider: AgentProvider): boolean {
  return provider === "claude" || provider === "codex";
}
