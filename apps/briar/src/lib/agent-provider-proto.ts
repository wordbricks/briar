import { AgentProvider as ProtoAgentProvider } from
  "@briar/contracts/gen/briar/types/v1/provider_pb";
import * as Record from "effect/Record";
import {
  agentProviderCatalog,
  agentProviders,
  type AgentProvider,
} from "./agent-provider";

/**
 * Platform names are the generated enum keys lowercased, so the wire map is a
 * derivation rather than a second hand-maintained list.
 */
export const protoAgentProvider = Record.map(
  agentProviderCatalog,
  (_entry, provider) =>
    ProtoAgentProvider[provider.toUpperCase() as Uppercase<AgentProvider>],
);

const agentProviderByProto = new Map<ProtoAgentProvider, AgentProvider>(
  agentProviders.map((provider) => [protoAgentProvider[provider], provider]),
);

export const agentProviderToProto = (
  provider: AgentProvider,
): ProtoAgentProvider => protoAgentProvider[provider];

export const agentProviderFromProto = (
  provider: ProtoAgentProvider,
): AgentProvider => {
  const known = agentProviderByProto.get(provider);
  if (known === undefined) {
    throw new Error("Agent provider is missing or unsupported");
  }
  return known;
};
