import { AgentProvider as ProtoAgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import type { WorkerCapabilities } from "@briar/contracts/gen/briar/types/v1/worker_pb";
import { agentProviders, type AgentProvider } from "../../src/lib/agent-provider";
import { dmLearningAgentPolicy, dmLearningPreferredProvider, dmMemoryLearningVerifiedProviders,
  type DmLearningPolicy } from "../../src/lib/dm-memory-learning-contract";

const protoProvider = {
  codex: ProtoAgentProvider.CODEX,
  claude: ProtoAgentProvider.CLAUDE,
  cursor: ProtoAgentProvider.CURSOR,
  grok: ProtoAgentProvider.GROK,
  agy: ProtoAgentProvider.AGY,
  opencode: ProtoAgentProvider.OPENCODE,
  openrouter: ProtoAgentProvider.OPENROUTER,
  vertex: ProtoAgentProvider.VERTEX,
  pi: ProtoAgentProvider.PI,
} as const satisfies Record<AgentProvider, ProtoAgentProvider>;

/** The DM's own Agent provider decides the policy; claim time falls back inside the verified list. */
export function dmLearningSpacePolicy(agentProvider: string): DmLearningPolicy {
  const provider = agentProviders.find((candidate) => candidate === agentProvider);
  return dmLearningAgentPolicy(provider === undefined
    ? dmMemoryLearningVerifiedProviders[0] : dmLearningPreferredProvider(provider));
}

/** Verified providers this Worker advertises, in the code-listed preference order. */
export function advertisedDmLearningProviders(capabilities: WorkerCapabilities | undefined): AgentProvider[] {
  const advertised = capabilities?.dmMemoryLearning;
  if (capabilities?.dmMemoryProtocol !== 1 || advertised?.protocol !== 2 ||
    !advertised.transports.includes("agent")) return [];
  return dmMemoryLearningVerifiedProviders.filter((provider) =>
    advertised.providers.includes(protoProvider[provider]));
}

export function supportsDmMemoryLearning(capabilities: WorkerCapabilities | undefined) {
  return advertisedDmLearningProviders(capabilities).length > 0;
}

export { dmLearningCallReservation } from "../../src/lib/dm-memory-learning-prompts";
