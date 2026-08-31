import * as Schema from "effect/Schema";
import {
  decodeStoredMergeQueueValidationCommands,
  MERGE_QUEUE_VALIDATION_CONTEXT,
} from "../../src/lib/merge-queue-validation-contract";
import { sha256 } from "./crypto-digest";
import { HttpError } from "./http-response";
import {
  blockMergeBatch,
  claimNextMergeBatch,
  completeMergeBatchPublication,
  recordPreparedMergeBatch,
  recordMergeBatchCandidateEnqueued,
  recordMergeBatchValidationProof,
} from "./merge-batches";
import { decodeRequestSync } from "./request-schema";
import {
  integerBetween,
  mutableArray,
  strictSchema,
  trimmedText,
  UuidString,
} from "./schema-codecs";
import { leaseExpiryFrom, workerStateAt } from "./workers";

const GitObjectId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}$/u),
);

const MergeBatchWorkIdentity = strictSchema(Schema.Struct({
  batchId: UuidString,
  projectId: UuidString,
  workerId: trimmedText(1, 128),
  claimTokenHash: Schema.String.check(
    Schema.isPattern(/^[0-9a-f]{64}$/u),
  ),
}));

const MergeBatchCandidateEnqueued = strictSchema(Schema.Struct({
  candidateId: Schema.String.check(Schema.isLengthBetween(1, 128)),
  expectedHeadSha: GitObjectId,
  expectedBaseSha: GitObjectId,
  queueEntryId: trimmedText(1, 200),
}));

const MergeBatchAuthority = strictSchema(Schema.Struct({
  integrationRef: Schema.String.check(
    Schema.isPattern(
      /^refs\/heads\/briar\/merge-queue\/[0-9a-f-]{36}$/u,
    ),
  ),
  integrationSha: GitObjectId,
  baseSha: GitObjectId,
}));

const MergeBatchValidationResult = strictSchema(Schema.Struct({
  context: Schema.Literal(MERGE_QUEUE_VALIDATION_CONTEXT),
  passed: Schema.Boolean,
  exitCode: integerBetween(0, 255),
  failureCode: Schema.NullOr(Schema.Literals(["ci_failed", "output_limit"])),
  log: Schema.String.check(Schema.isMaxLength(64 * 1_024)),
  logSha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  logTruncated: Schema.Boolean,
}));

const MergeBatchValidation = strictSchema(Schema.Struct({
  mergeGroupSha: GitObjectId,
  validationResults: mutableArray(MergeBatchValidationResult).check(
    Schema.isLengthBetween(1, 1),
  ),
}));

const MergeBatchPublication = strictSchema(Schema.Struct({
  mergeGroupSha: GitObjectId,
}));

const MergeBatchBlock = strictSchema(Schema.Struct({
  code: Schema.String.check(
    Schema.isPattern(/^[a-z][a-z0-9_]{0,63}$/u),
  ),
  detail: Schema.Trim.check(Schema.isLengthBetween(1, 4_000)),
}));

const decodeMergeBatchWorkIdentity = decodeRequestSync(MergeBatchWorkIdentity);
const decodeMergeBatchCandidateEnqueued = decodeRequestSync(
  MergeBatchCandidateEnqueued,
);
const decodeMergeBatchAuthority = decodeRequestSync(MergeBatchAuthority);
const decodeMergeBatchValidation = decodeRequestSync(MergeBatchValidation);
const decodeMergeBatchPublication = decodeRequestSync(MergeBatchPublication);
const decodeMergeBatchBlock = decodeRequestSync(MergeBatchBlock);
const decodeMergeBatchValidationResults = decodeRequestSync(
  mutableArray(MergeBatchValidationResult).check(
    Schema.isLengthBetween(1, 1),
  ),
);

export const claimedMergeBatch = (
  claim: NonNullable<Awaited<ReturnType<typeof claimNextMergeBatch>>>,
  claimToken: string,
) => {
  const validationCommands = [
    ...decodeStoredMergeQueueValidationCommands(
      claim.batch.validation_commands_json,
    ),
  ];
  return {
    workType: "mergeBatch" as const,
    workId: claim.batch.id,
    runId: claim.batch.id,
    sourceKey: `merge:${claim.batch.repository}#${claim.batch.id.slice(0, 8)}`,
    title: `Merge ${claim.members.length} PRs into ${claim.batch.base_branch}`,
    projectId: claim.batch.project_id,
    repositoryId: claim.batch.repository_id,
    repository: claim.batch.repository,
    baseBranch: claim.batch.base_branch,
    validationCommands,
    phase: claim.phase,
    claimToken,
    claimedAt: claim.batch.claimed_at,
    leaseExpiresAt: claim.batch.lease_expires_at,
    claimAttempts: claim.batch.claim_attempts,
    batch: {
      id: claim.batch.id,
      state: claim.batch.state,
      finalDeliveryId: claim.batch.final_delivery_id,
      mergeGroupRef: claim.batch.merge_group_ref,
      mergeGroupSha: claim.batch.merge_group_sha,
      mergeGroupBaseSha: claim.batch.merge_group_base_sha,
      validationResults: claim.batch.validation_results_json
        ? decodeMergeBatchValidationResults(
            JSON.parse(claim.batch.validation_results_json),
          )
        : null,
      validatedAt: claim.batch.validated_at,
      publishedAt: claim.batch.published_at,
      failureCode: claim.batch.failure_code,
      failureDetail: claim.batch.failure_detail,
    },
    members: claim.members.map((member) => ({
      id: member.id,
      ordinal: member.ordinal,
      runId: member.run_id,
      attempt: member.attempt,
      revision: member.revision,
      pullRequestId: member.pull_request_id,
      pullRequestNodeId: member.pull_request_node_id,
      pullRequestNumber: member.pull_request_number,
      pullRequestUrl: member.pull_request_url,
      headSha: member.frozen_head_sha,
      baseSha: member.frozen_base_sha,
      queueEntryId: member.queue_entry_id,
      state: member.state,
    })),
    pendingHeads: claim.pendingHeads.map((head) => ({
      deliveryId: head.delivery_id,
      headRef: head.head_ref,
      headSha: head.head_sha,
      baseSha: head.base_sha,
      tailPullRequestNumber: head.tail_pull_request_number,
      receivedAt: head.received_at,
    })),
  };
};

export async function claimNextMergeBatchWork(input: {
  db: D1Database;
  projectId: string;
  workerId: string;
  claimedBy: string;
  authenticatedWorker: {
    principal: { deviceId: string };
    binding: {
      id: string;
      last_heartbeat_at: string;
      state: "online" | "stale" | "disabled";
      accepting_work: number;
      readiness_state: "ready" | "busy" | "needs_attention";
    };
  };
}) {
  const observedAt = new Date().toISOString();
  if (
    workerStateAt(
        input.authenticatedWorker.binding.last_heartbeat_at,
        observedAt,
        input.authenticatedWorker.binding.state,
      ) !== "online" ||
    input.authenticatedWorker.binding.accepting_work !== 1 ||
    input.authenticatedWorker.binding.readiness_state === "needs_attention"
  ) {
    throw new HttpError(409, "Worker is not ready to claim a merge batch");
  }
  const claimToken =
    `briar_merge_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const claim = await claimNextMergeBatch(input.db, input.projectId, {
    workerId: input.authenticatedWorker.binding.id,
    deviceId: input.authenticatedWorker.principal.deviceId,
    claimedBy: input.claimedBy,
    claimTokenHash: await sha256(claimToken),
    claimedAt: observedAt,
    leaseExpiresAt: leaseExpiryFrom(observedAt),
  });
  return claim ? claimedMergeBatch(claim, claimToken) : null;
}

export async function recordMergeBatchCandidateEnqueuedWork(
  db: D1Database,
  rawIdentity: unknown,
  rawInput: unknown,
) {
  const identity = decodeMergeBatchWorkIdentity(rawIdentity);
  const input = decodeMergeBatchCandidateEnqueued(rawInput);
  const result = await recordMergeBatchCandidateEnqueued(db, {
    ...identity,
    ...input,
    observedAt: new Date().toISOString(),
  });
  if (!result) {
    throw new HttpError(409, "Merge batch candidate identity changed");
  }
  return {
    batchId: identity.batchId,
    candidateId: result.candidate.id,
    state: result.batch.state,
  };
}

export async function recordMergeBatchAuthorityWork(
  db: D1Database,
  rawIdentity: unknown,
  rawInput: unknown,
) {
  const identity = decodeMergeBatchWorkIdentity(rawIdentity);
  const input = decodeMergeBatchAuthority(rawInput);
  const result = await recordPreparedMergeBatch(db, {
    ...identity,
    ...input,
    observedAt: new Date().toISOString(),
  });
  if (!result) {
    throw new HttpError(409, "Prepared integration ref was rejected");
  }
  if (!result.merge_group_sha) {
    throw new Error("Prepared merge batch omitted its integration SHA");
  }
  return {
    batchId: identity.batchId,
    state: result.state,
    mergeGroupSha: result.merge_group_sha,
  };
}

export async function recordMergeBatchValidationWork(
  db: D1Database,
  rawIdentity: unknown,
  rawInput: unknown,
) {
  const identity = decodeMergeBatchWorkIdentity(rawIdentity);
  const input = decodeMergeBatchValidation(rawInput);
  const result = await recordMergeBatchValidationProof(db, {
    ...identity,
    ...input,
    validatedAt: new Date().toISOString(),
  });
  if (!result) {
    throw new HttpError(409, "Merge batch validation proof was rejected");
  }
  return {
    batchId: identity.batchId,
    state: result.state,
    validatedAt: result.validated_at,
  };
}

export async function completeMergeBatchPublicationWork(
  db: D1Database,
  rawIdentity: unknown,
  rawInput: unknown,
) {
  const identity = decodeMergeBatchWorkIdentity(rawIdentity);
  const input = decodeMergeBatchPublication(rawInput);
  const result = await completeMergeBatchPublication(db, {
    ...identity,
    ...input,
    publishedAt: new Date().toISOString(),
  });
  if (!result) {
    throw new HttpError(409, "Merge batch publication claim is no longer active");
  }
  return {
    batchId: identity.batchId,
    state: result.state,
    publishedAt: result.published_at,
  };
}

export async function blockMergeBatchWork(
  db: D1Database,
  rawIdentity: unknown,
  rawInput: unknown,
) {
  const identity = decodeMergeBatchWorkIdentity(rawIdentity);
  const input = decodeMergeBatchBlock(rawInput);
  const result = await blockMergeBatch(db, {
    ...identity,
    ...input,
    observedAt: new Date().toISOString(),
  });
  if (!result) {
    throw new HttpError(409, "Merge batch claim is no longer active");
  }
  return { batchId: identity.batchId, state: result.state };
}
