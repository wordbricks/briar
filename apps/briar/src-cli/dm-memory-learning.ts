import { setTimeout as delay } from "node:timers/promises";
import {
  DmMemoryLearningFailure,
  DmMemoryLearningStage,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { ApplicationErrorDetailSchema } from "@briar/contracts/gen/briar/types/v1/error_pb";
import { Code, ConnectError } from "@connectrpc/connect";
import * as Schema from "effect/Schema";
import type { AgentProvider } from "../src/lib/agent-provider";
import { dmMemoryCanonicalJson } from "../src/lib/dm-memory-canonical-json";
import {
  DmLearningCommitResult,
  DmLearningInvocation,
  DmLearningProposalResult,
  type ClaimedDmMemory,
  type DmLearningUsage,
} from "../src/lib/dm-memory-learning-contract";
import {
  DmLearningClientError,
  invokeDmLearningModel,
} from "./dm-memory-learning-model";
import {
  type WorkerQueueClient,
  workClaimIdentityToProto,
} from "./worker-queue-client";

type LearningClient = {
  rpc: Pick<
    WorkerQueueClient,
    | "reserveDmMemoryLearningCall"
    | "submitDmMemoryLearningProposal"
    | "submitDmMemoryLearningVerification"
    | "failDmMemoryLearning"
  >;
  projectId: string;
  claim: ClaimedDmMemory;
  signal?: AbortSignal;
};

const failureCode = {
  invalid_proposal: DmMemoryLearningFailure.INVALID_PROPOSAL,
  verification_rejected: DmMemoryLearningFailure.VERIFICATION_REJECTED,
  stale: DmMemoryLearningFailure.STALE,
  scope_revoked: DmMemoryLearningFailure.SCOPE_REVOKED,
  budget_exhausted: DmMemoryLearningFailure.BUDGET_EXHAUSTED,
  model_unavailable: DmMemoryLearningFailure.MODEL_UNAVAILABLE,
  model_timeout: DmMemoryLearningFailure.MODEL_TIMEOUT,
  model_credentials: DmMemoryLearningFailure.MODEL_CREDENTIALS,
  model_configuration: DmMemoryLearningFailure.MODEL_CONFIGURATION,
  input_capacity: DmMemoryLearningFailure.INPUT_CAPACITY,
} as const;

const usageMessage = (usage: DmLearningUsage) => ({
  inputTokens: BigInt(usage.inputTokens),
  outputTokens: BigInt(usage.outputTokens),
  costMicroUsd: usage.costMicroUsd === null
    ? undefined
    : BigInt(usage.costMicroUsd),
});

const rpcError = (error: unknown) => {
  if (error instanceof DmLearningClientError) return error;
  const connect = ConnectError.from(error);
  const applicationCode = connect.findDetails(ApplicationErrorDetailSchema)[0]
    ?.code;
  const detailCode = applicationCode?.startsWith("memory_")
    ? applicationCode.slice("memory_".length)
    : undefined;
  if (detailCode && detailCode in failureCode) {
    return new DmLearningClientError(detailCode as keyof typeof failureCode);
  }
  switch (connect.code) {
    case Code.Canceled:
    case Code.PermissionDenied:
    case Code.Unauthenticated:
      return new DmLearningClientError("scope_revoked");
    case Code.Aborted:
    case Code.FailedPrecondition:
      return new DmLearningClientError("stale");
    case Code.ResourceExhausted:
      return new DmLearningClientError("budget_exhausted");
    case Code.InvalidArgument:
      return new DmLearningClientError("invalid_proposal");
    case Code.DeadlineExceeded:
      return new DmLearningClientError("model_timeout");
    default:
      return new DmLearningClientError("model_unavailable");
  }
};

async function learningRpc<T>(
  input: LearningClient,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const timeout = AbortSignal.timeout(7_000);
    const signal = AbortSignal.any([
      timeout,
      ...(input.signal ? [input.signal] : []),
    ]);
    try {
      return await operation(signal);
    } catch (error) {
      if (input.signal?.aborted) {
        throw new DmLearningClientError("scope_revoked");
      }
      const safe = rpcError(error);
      if (
        attempt === 2 ||
        (safe.code !== "model_unavailable" && safe.code !== "model_timeout")
      ) throw safe;
      await delay((attempt + 1) * 200, undefined, { signal: input.signal });
    }
  }
  throw new DmLearningClientError("model_unavailable");
}

const claimMessage = (input: LearningClient) => ({
  projectId: input.projectId,
  workerId: input.claim.workerId,
  work: workClaimIdentityToProto(input.claim),
});

const decodeResponse = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: Uint8Array,
): S["Type"] => {
  try {
    return Schema.decodeUnknownSync(schema)(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value)),
    );
  } catch {
    throw new DmLearningClientError("invalid_proposal");
  }
};

/** Provider requests are not retried here. A durable reservation owns each call. */
export async function runClaimedDmMemory(input: LearningClient & {
  apiKey: string | null;
  signal: AbortSignal;
  invoke?: typeof invokeDmLearningModel;
  agentEnvironment?: (provider: AgentProvider) => NodeJS.ProcessEnv;
  runAgentTurn?: Parameters<typeof invokeDmLearningModel>[0]["runAgentTurn"];
  prepareAgentEnvironment?: Parameters<typeof invokeDmLearningModel>[0]["prepareAgentEnvironment"];
}): Promise<DmLearningCommitResult> {
  const invoke = input.invoke ?? invokeDmLearningModel;
  let currentCallId: string | undefined;
  const reserve = async (stage: "proposing" | "verifying") => {
    const callId = crypto.randomUUID();
    const response = await learningRpc(input, (signal) =>
      input.rpc.reserveDmMemoryLearningCall({
        claim: claimMessage(input),
        callId,
        stage: stage === "proposing"
          ? DmMemoryLearningStage.PROPOSING
          : DmMemoryLearningStage.VERIFYING,
      }, { signal })
    );
    const invocation = decodeResponse(DmLearningInvocation, response.json);
    if (
      invocation.callId !== callId || invocation.stage !== stage ||
      invocation.inputHash !== input.claim.inputHash ||
      dmMemoryCanonicalJson(invocation.snapshot) !==
        dmMemoryCanonicalJson(input.claim.snapshot) ||
      invocation.status !== "reserved" ||
      dmMemoryCanonicalJson(invocation.model) !== dmMemoryCanonicalJson(
        input.claim.snapshot.policy[
          stage === "proposing" ? "proposer" : "verifier"
        ],
      )
    ) throw new DmLearningClientError("stale");
    currentCallId = invocation.callId;
    return invocation;
  };

  try {
    const proposing = await reserve("proposing");
    const proposal = await invoke({
      invocation: proposing,
      apiKey: input.apiKey,
      signal: input.signal,
      environment: proposing.model.transport === "agent"
        ? input.agentEnvironment?.(proposing.model.provider)
        : undefined,
      runAgentTurn: input.runAgentTurn,
      prepareAgentEnvironment: input.prepareAgentEnvironment,
    });
    if (!("proposal" in proposal)) {
      throw new DmLearningClientError("invalid_proposal");
    }
    const proposedResponse = await learningRpc(input, (signal) =>
      input.rpc.submitDmMemoryLearningProposal({
        claim: claimMessage(input),
        callId: proposing.callId,
        proposalJson: new TextEncoder().encode(
          dmMemoryCanonicalJson(proposal.proposal),
        ),
        usage: usageMessage(proposal.usage),
      }, { signal })
    );
    const proposed = decodeResponse(
      DmLearningProposalResult,
      proposedResponse.json,
    );
    if (proposed.status !== "verifying") return proposed;

    const verifying = await reserve("verifying");
    if (
      verifying.proposalId !== proposed.proposalId ||
      verifying.proposalHash !== proposed.proposalHash ||
      dmMemoryCanonicalJson(verifying.proposal) !==
        dmMemoryCanonicalJson(proposal.proposal)
    ) throw new DmLearningClientError("stale");
    const verification = await invoke({
      invocation: verifying,
      apiKey: input.apiKey,
      signal: input.signal,
      environment: verifying.model.transport === "agent"
        ? input.agentEnvironment?.(verifying.model.provider)
        : undefined,
      runAgentTurn: input.runAgentTurn,
      prepareAgentEnvironment: input.prepareAgentEnvironment,
    });
    if (!("verification" in verification)) {
      throw new DmLearningClientError("invalid_proposal");
    }
    const verifiedResponse = await learningRpc(input, (signal) =>
      input.rpc.submitDmMemoryLearningVerification({
        claim: claimMessage(input),
        callId: verifying.callId,
        proposalId: proposed.proposalId,
        proposalHash: proposed.proposalHash,
        verificationJson: new TextEncoder().encode(
          dmMemoryCanonicalJson(verification.verification),
        ),
        usage: usageMessage(verification.usage),
      }, { signal })
    );
    return decodeResponse(DmLearningCommitResult, verifiedResponse.json);
  } catch (error) {
    if (input.signal.aborted) {
      throw new DmLearningClientError("scope_revoked");
    }
    const safe = rpcError(error);
    try {
      await input.rpc.failDmMemoryLearning({
        claim: claimMessage(input),
        code: failureCode[safe.code],
        callId: currentCallId && safe.usage ? currentCallId : undefined,
        usage: currentCallId && safe.usage
          ? usageMessage(safe.usage)
          : undefined,
      }, { signal: AbortSignal.timeout(7_000) });
    } catch {
      // Lease expiry retires a disconnected attempt; private model errors stay local.
    }
    throw safe;
  }
}
