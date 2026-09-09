import {
  agentProviderCatalog,
  type AgentProvider,
} from "./agent-provider";

/** Every catalogued provider may use the common isolated classification path. */
export function supportsDetachedProviderClassification(provider: AgentProvider): boolean {
  return Object.hasOwn(agentProviderCatalog, provider);
}
