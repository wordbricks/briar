import * as Schema from "effect/Schema";
import {
  MERGE_QUEUE_VALIDATION_CONTEXT,
} from "../../src/lib/merge-queue-validation-contract";
import {
  integerBetween,
  mutableArray,
  strictSchema,
  trimmedText,
  UuidString,
} from "./schema-codecs";
import { decodeRequestSync } from "./request-schema";

const GitObjectId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}$/u),
);
const MergeGroupContext = Schema.Literal(MERGE_QUEUE_VALIDATION_CONTEXT);

export const MergeQueueProfileUpdate = strictSchema(Schema.Struct({
  enabled: Schema.Boolean,
  readinessStageId: Schema.optional(Schema.String.check(
    Schema.isPattern(/^[a-z][a-z0-9_-]{0,63}$/u),
  )),
  quietWindowMs: Schema.optional(integerBetween(1_000, 300_000)),
  maxBatchSize: Schema.optional(integerBetween(2, 5)),
}));

export const MergeBatchClaimInput = strictSchema(Schema.Struct({
  projectId: UuidString,
  workerId: trimmedText(1, 128),
  claimedBy: trimmedText(1, 128),
}));

const MergeBatchClaimIdentity = {
  projectId: UuidString,
  workerId: trimmedText(1, 128),
  claimToken: Schema.String.check(
    Schema.isPattern(/^briar_merge_claim_[0-9a-f]{64}$/u),
  ),
} as const;

export const MergeBatchLeaseInput = strictSchema(Schema.Struct(
  MergeBatchClaimIdentity,
));

export const MergeBatchEnqueueInput = strictSchema(Schema.Struct({
  ...MergeBatchClaimIdentity,
  candidateId: Schema.String.check(Schema.isLengthBetween(1, 128)),
  expectedHeadSha: GitObjectId,
  expectedBaseSha: GitObjectId,
  queueEntryId: trimmedText(1, 200),
}));

export const MergeBatchAuthorityInput = strictSchema(Schema.Struct({
  ...MergeBatchClaimIdentity,
  integrationRef: Schema.String.check(
    Schema.isPattern(
      /^refs\/heads\/briar\/merge-queue\/[0-9a-f-]{36}$/u,
    ),
  ),
  integrationSha: GitObjectId,
  baseSha: GitObjectId,
}));

const MergeBatchValidationResult = strictSchema(Schema.Struct({
  context: MergeGroupContext,
  passed: Schema.Boolean,
  exitCode: integerBetween(0, 255),
  failureCode: Schema.NullOr(Schema.Literals(["ci_failed", "output_limit"])),
  log: Schema.String.check(Schema.isMaxLength(64 * 1_024)),
  logSha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  logTruncated: Schema.Boolean,
}));

export const MergeBatchValidationInput = strictSchema(Schema.Struct({
  ...MergeBatchClaimIdentity,
  mergeGroupSha: GitObjectId,
  validationResults: mutableArray(MergeBatchValidationResult).check(
    Schema.isLengthBetween(1, 1),
  ),
}));

export const MergeBatchPublicationInput = strictSchema(Schema.Struct({
  ...MergeBatchClaimIdentity,
  mergeGroupSha: GitObjectId,
}));

export const MergeBatchBlockInput = strictSchema(Schema.Struct({
  ...MergeBatchClaimIdentity,
  code: Schema.String.check(
    Schema.isPattern(/^[a-z][a-z0-9_]{0,63}$/u),
  ),
  detail: Schema.Trim.check(Schema.isLengthBetween(1, 4_000)),
}));

export const decodeMergeQueueProfileUpdate = decodeRequestSync(
  MergeQueueProfileUpdate,
);
export const decodeMergeBatchClaimInput = decodeRequestSync(
  MergeBatchClaimInput,
);
export const decodeMergeBatchLeaseInput = decodeRequestSync(
  MergeBatchLeaseInput,
);
export const decodeMergeBatchEnqueueInput = decodeRequestSync(
  MergeBatchEnqueueInput,
);
export const decodeMergeBatchAuthorityInput = decodeRequestSync(
  MergeBatchAuthorityInput,
);
export const decodeMergeBatchValidationInput = decodeRequestSync(
  MergeBatchValidationInput,
);
export const decodeMergeBatchPublicationInput = decodeRequestSync(
  MergeBatchPublicationInput,
);
export const decodeMergeBatchBlockInput = decodeRequestSync(
  MergeBatchBlockInput,
);
