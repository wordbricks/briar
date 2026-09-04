import { AgentProvider as ProtoAgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import type { WorkerCapabilities } from "@briar/contracts/gen/briar/types/v1/worker_pb";
import * as Schema from "effect/Schema";
import type { AgentProvider } from "../../src/lib/agent-provider";
import { DmLearningPolicy } from "../../src/lib/dm-memory-learning-contract";

export type DmLearningEnvironment = {
  DM_MEMORY_LEARNING_ENABLED?: string;
  DM_MEMORY_LEARNING_POLICIES?: string;
};
const policies = Schema.Record(Schema.String.check(Schema.isUUID()), DmLearningPolicy);
const protoProvider = {
  codex: ProtoAgentProvider.CODEX,
  claude: ProtoAgentProvider.CLAUDE,
  cursor: ProtoAgentProvider.CURSOR,
  grok: ProtoAgentProvider.GROK,
  agy: ProtoAgentProvider.AGY,
  opencode: ProtoAgentProvider.OPENCODE,
  openrouter: ProtoAgentProvider.OPENROUTER,
  vertex: ProtoAgentProvider.VERTEX,
} as const satisfies Record<AgentProvider, ProtoAgentProvider>;

export function dmLearningPolicy(env: DmLearningEnvironment, organizationId: string): DmLearningPolicy | null {
  if (env.DM_MEMORY_LEARNING_ENABLED !== "true" || !env.DM_MEMORY_LEARNING_POLICIES) return null;
  try {
    const policy = Schema.decodeUnknownSync(policies)(JSON.parse(env.DM_MEMORY_LEARNING_POLICIES))[organizationId];
    if (!policy || policy.maxInputBytes < 8192) return null;
    if ([policy.proposer, policy.verifier].some((model) => model.transport === "openrouter") &&
      (policy.spaceDailyMicroUsd === 0 || policy.organizationDailyMicroUsd === 0)) return null;
    for (const model of [policy.proposer, policy.verifier]) {
      if (model.transport === "openrouter") {
        if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(model.model) ||
          model.model.startsWith("openrouter/") || !/^[a-zA-Z0-9_./-]+$/u.test(model.upstreamProvider)) return null;
      } else if ((model.model !== null && !/^[a-zA-Z0-9_.:/-]+$/u.test(model.model)) ||
        (model.effort !== null && !/^[a-zA-Z0-9_.-]+$/u.test(model.effort))) return null;
    }
    return policy;
  } catch { return null; }
}

export function supportsDmMemoryLearning(capabilities: WorkerCapabilities | undefined, policy?: DmLearningPolicy) {
  if (capabilities?.dmMemoryProtocol !== 1 || !capabilities.dmMemoryLearning) return false;
  const advertised = capabilities.dmMemoryLearning;
  if (advertised.protocol === 1 && advertised.transport === "openrouter") {
    return policy ? [policy.proposer, policy.verifier].every((model) => model.transport === "openrouter") : true;
  }
  if (advertised.protocol !== 2) return false;
  if (!policy) return advertised.transports.includes("agent") || advertised.transports.includes("openrouter");
  return [policy.proposer, policy.verifier].every((model) =>
    advertised.transports.includes(model.transport) &&
    (model.transport !== "agent" || advertised.providers.includes(protoProvider[model.provider])));
}

export { dmLearningCallReservation } from "../../src/lib/dm-memory-learning-prompts";
