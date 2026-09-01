import * as Schema from "effect/Schema";
import { DmLearningPolicy } from "../../src/lib/dm-memory-learning-contract";

export type DmLearningEnvironment = {
  DM_MEMORY_LEARNING_ENABLED?: string;
  DM_MEMORY_LEARNING_POLICIES?: string;
};
const policies = Schema.Record(Schema.String.check(Schema.isUUID()), DmLearningPolicy);
export function dmLearningPolicy(env: DmLearningEnvironment, organizationId: string): DmLearningPolicy | null {
  if (env.DM_MEMORY_LEARNING_ENABLED !== "true" || !env.DM_MEMORY_LEARNING_POLICIES) return null;
  try {
    const policy = Schema.decodeUnknownSync(policies)(JSON.parse(env.DM_MEMORY_LEARNING_POLICIES))[organizationId];
    if (!policy || policy.maxInputBytes < 8192) return null;
    for (const model of [policy.proposer, policy.verifier]) {
      if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(model.model) ||
        model.model.startsWith("openrouter/") || !/^[a-zA-Z0-9_./-]+$/u.test(model.upstreamProvider)) return null;
    }
    return policy;
  } catch { return null; }
}

export { dmLearningCallReservation } from "../../src/lib/dm-memory-learning-prompts";
