import { setTimeout as delay } from "node:timers/promises";
import * as Schema from "effect/Schema";
import { dmMemoryCanonicalJson } from "../src/lib/dm-memory-canonical-json";
import { DmLearningCommitResult, DmLearningInvocation, DmLearningProposalResult, dmLearningFailureCodes,
  dmMemoryLearningClaimTokenHeader, type ClaimedDmMemory } from "../src/lib/dm-memory-learning-contract";
import { IsoDateTimeWithOffset } from "../src/lib/date-time-schema";
import { DmLearningClientError, invokeDmLearningModel, readDmLearningJson } from "./dm-memory-learning-model";

type LearningClient = { apiUrl: string; workerToken: string; claim: ClaimedDmMemory; signal?: AbortSignal; fetcher?: typeof fetch };
const safeError = Schema.Struct({ code: Schema.optional(Schema.String) });
const leaseResponse = Schema.Struct({ leaseExpiresAt: IsoDateTimeWithOffset });
const releaseResponse = Schema.Struct({ released: Schema.Boolean });

async function learningRequest<S extends Schema.ConstraintDecoder<unknown>>(
  input: LearningClient, resource: string, body: Record<string, unknown>, schema: S,
): Promise<S["Type"]> {
  const { claim } = input;
  const url = new URL(`/organizations/${claim.organizationId}/dm-memory-claims/${claim.workId}/${resource}`, input.apiUrl);
  const encoded = JSON.stringify({ workerId: claim.workerId, inputHash: claim.inputHash, ...body });
  for (let attempt = 0; attempt < 3; attempt++) {
    const timeout = AbortSignal.timeout(7_000);
    try {
      const response = await (input.fetcher ?? fetch)(url, {
        method: "POST", redirect: "error", signal: AbortSignal.any([timeout, ...(input.signal ? [input.signal] : [])]),
        headers: { Authorization: `Bearer ${input.workerToken}`, "Content-Type": "application/json",
          [dmMemoryLearningClaimTokenHeader]: claim.claimToken }, body: encoded,
      });
      const value = await readDmLearningJson(response);
      if (!response.ok) {
        const parsed = Schema.decodeUnknownSync(safeError)(value);
        const code = dmLearningFailureCodes.find((candidate) => `memory_${candidate}` === parsed.code);
        throw new DmLearningClientError(code ?? (response.status === 401 || response.status === 403
          ? "scope_revoked" : response.status >= 500 ? "model_unavailable" : "invalid_proposal"));
      }
      return Schema.decodeUnknownSync(schema)(value);
    } catch (error) {
      if (input.signal?.aborted) throw new DmLearningClientError("scope_revoked");
      const safe = error instanceof DmLearningClientError ? error
        : new DmLearningClientError(timeout.aborted ? "model_timeout"
          : Schema.isSchemaError(error) ? "invalid_proposal" : "model_unavailable");
      if (attempt === 2 || (safe.code !== "model_unavailable" && safe.code !== "model_timeout")) throw safe;
      await delay((attempt + 1) * 200, undefined, { signal: input.signal });
    }
  }
  throw new DmLearningClientError("model_unavailable");
}

export async function renewClaimedDmMemory(input: LearningClient) {
  return learningRequest(input, "lease", {}, leaseResponse);
}

export async function releaseClaimedDmMemory(input: LearningClient) {
  return learningRequest(input, "release", {}, releaseResponse);
}

/** Provider requests are never retried here. A durable new reservation owns any next call. */
export async function runClaimedDmMemory(input: LearningClient & {
  apiKey: string | null; signal: AbortSignal; invoke?: typeof invokeDmLearningModel;
}): Promise<DmLearningCommitResult> {
  const invoke = input.invoke ?? invokeDmLearningModel;
  let currentCallId: string | undefined;
  const reserve = async (stage: "proposing" | "verifying") => {
    const callId = crypto.randomUUID();
    const invocation = await learningRequest(input, "call", { callId, stage }, DmLearningInvocation);
    if (invocation.callId !== callId || invocation.stage !== stage || invocation.inputHash !== input.claim.inputHash ||
      dmMemoryCanonicalJson(invocation.snapshot) !== dmMemoryCanonicalJson(input.claim.snapshot) || invocation.status !== "reserved" ||
      dmMemoryCanonicalJson(invocation.model) !== dmMemoryCanonicalJson(input.claim.snapshot.policy[stage === "proposing" ? "proposer" : "verifier"])) {
      throw new DmLearningClientError("stale");
    }
    currentCallId = invocation.callId;
    return invocation;
  };
  try {
    const proposing = await reserve("proposing");
    const proposal = await invoke({ invocation: proposing, apiKey: input.apiKey, signal: input.signal });
    if (!("proposal" in proposal)) throw new DmLearningClientError("invalid_proposal");
    const proposed = await learningRequest(input, "proposal", { callId: proposing.callId, ...proposal }, DmLearningProposalResult);
    if (proposed.status !== "verifying") return proposed;
    const verifying = await reserve("verifying");
    if (verifying.proposalId !== proposed.proposalId || verifying.proposalHash !== proposed.proposalHash ||
      dmMemoryCanonicalJson(verifying.proposal) !== dmMemoryCanonicalJson(proposal.proposal)) throw new DmLearningClientError("stale");
    const verification = await invoke({ invocation: verifying, apiKey: input.apiKey, signal: input.signal });
    if (!("verification" in verification)) throw new DmLearningClientError("invalid_proposal");
    return await learningRequest(input, "verification", { callId: verifying.callId,
      proposalId: proposed.proposalId, proposalHash: proposed.proposalHash, ...verification }, DmLearningCommitResult);
  } catch (error) {
    if (input.signal.aborted) throw new DmLearningClientError("scope_revoked");
    const safe = error instanceof DmLearningClientError ? error : new DmLearningClientError("model_unavailable");
    try { await learningRequest(input, "fail", { code: safe.code,
      ...(currentCallId && safe.usage ? { callId: currentCallId, usage: safe.usage } : {}) }, releaseResponse); }
    catch { /* Lease expiry retires a disconnected attempt; never log private errors. */ }
    throw safe;
  }
}
