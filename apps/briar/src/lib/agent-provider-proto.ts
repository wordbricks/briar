import { AgentProvider as ProtoAgentProvider } from
  "@briar/contracts/gen/briar/types/v1/provider_pb";
import type { AgentProvider } from "./agent-provider";

export const protoAgentProvider = {
  codex: ProtoAgentProvider.CODEX,
  claude: ProtoAgentProvider.CLAUDE,
  cursor: ProtoAgentProvider.CURSOR,
  grok: ProtoAgentProvider.GROK,
  agy: ProtoAgentProvider.AGY,
  opencode: ProtoAgentProvider.OPENCODE,
  openrouter: ProtoAgentProvider.OPENROUTER,
} as const satisfies Record<AgentProvider, ProtoAgentProvider>;

export const agentProviderToProto = (
  provider: AgentProvider,
): ProtoAgentProvider => protoAgentProvider[provider];

export const agentProviderFromProto = (
  provider: ProtoAgentProvider,
): AgentProvider => {
  switch (provider) {
    case ProtoAgentProvider.CODEX:
      return "codex";
    case ProtoAgentProvider.CLAUDE:
      return "claude";
    case ProtoAgentProvider.CURSOR:
      return "cursor";
    case ProtoAgentProvider.GROK:
      return "grok";
    case ProtoAgentProvider.AGY:
      return "agy";
    case ProtoAgentProvider.OPENCODE:
      return "opencode";
    case ProtoAgentProvider.OPENROUTER:
      return "openrouter";
    default:
      throw new Error("Agent provider is missing or unsupported");
  }
};
