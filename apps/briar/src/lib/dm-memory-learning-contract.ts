import * as Schema from "effect/Schema";
import { ModelEffort } from "./agent-provider-contract";
import { agentProviders } from "./agent-provider";
import { IsoDateTimeWithOffset } from "./date-time-schema";

export const dmMemoryLearningPolicyVersion = "dm-learning-verified-v1";
export const dmMemoryLearningMaxChanges = 32;
export const dmMemoryLearningMaxCalls = 6;

const strict = <S extends Schema.Top>(schema: S) => schema.annotate({
  parseOptions: { errors: "all", onExcessProperty: "error" },
});
const id = Schema.String.check(Schema.isUUID());
const positive = Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER));
const nonnegative = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER));
const hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const label = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,64}$/u));
const text = (max: number) => Schema.String.check(Schema.makeFilter((value) =>
  value.trim().length > 0 && [...value].length <= max ? undefined : "Invalid text length",
));
const list = <S extends Schema.Top>(schema: S, max: number) =>
  Schema.Array(schema).check(Schema.isMaxLength(max));

export const DmLearningSourceRef = strict(Schema.Struct({
  type: Schema.Literals(["message", "user_edit_event", "memory", "clock"]),
  id: Schema.String.check(Schema.isLengthBetween(1, 128)),
  version: positive,
}));
export type DmLearningSourceRef = typeof DmLearningSourceRef.Type;

export const DmLearningRoot = strict(Schema.Struct({
  type: Schema.Literals(["message", "user_edit_event"]),
  id, version: positive, hash, body: text(65_536),
  speaker: Schema.Literals(["user", "agent"]),
  observedAt: IsoDateTimeWithOffset,
}));
export type DmLearningRoot = typeof DmLearningRoot.Type;

export const DmLearningDocument = strict(Schema.Struct({
  id, version: positive, kind: Schema.Literals(["observation", "topic"]),
  title: text(200), body: text(65_536), hash,
  memoryClass: Schema.Literals(["profile", "log", "note"]),
  evidenceType: Schema.Literals(["explicit_user", "observed"]),
  protectedByUser: Schema.Boolean, conflicted: Schema.Boolean,
  observedAt: Schema.NullOr(IsoDateTimeWithOffset),
  validUntil: Schema.NullOr(IsoDateTimeWithOffset),
  sourceLanguage: text(32),
  sources: list(DmLearningSourceRef, 128),
}));
export type DmLearningDocument = typeof DmLearningDocument.Type;

const DmLearningOpenRouterModel = strict(Schema.Struct({
  transport: Schema.Literal("openrouter"),
  model: text(200), upstreamProvider: text(100),
  maxOutputTokens: positive.check(Schema.isLessThanOrEqualTo(16_384)),
  maxInputMicroUsdPerMillionTokens: positive,
  maxOutputMicroUsdPerMillionTokens: positive,
}));

const DmLearningAgentModel = strict(Schema.Struct({
  transport: Schema.Literal("agent"),
  provider: Schema.Literals(agentProviders),
  model: Schema.NullOr(text(200)),
  effort: Schema.NullOr(ModelEffort),
  maxOutputTokens: positive.check(Schema.isLessThanOrEqualTo(16_384)),
  // Subscription-backed Agent CLIs do not expose a reliable per-call price.
  // Zero keeps the existing reservation ledger explicit without inventing cost.
  maxInputMicroUsdPerMillionTokens: nonnegative,
  maxOutputMicroUsdPerMillionTokens: nonnegative,
}));

export const DmLearningModel = Schema.Union([
  DmLearningOpenRouterModel,
  DmLearningAgentModel,
]);
export type DmLearningModel = typeof DmLearningModel.Type;

export const DmLearningPolicy = strict(Schema.Struct({
  version: Schema.Literal(dmMemoryLearningPolicyVersion),
  proposer: DmLearningModel, verifier: DmLearningModel,
  maxInputBytes: positive.check(Schema.isLessThanOrEqualTo(131_072)),
  spaceDailyCalls: positive, organizationDailyCalls: positive,
  spaceDailyMicroUsd: nonnegative, organizationDailyMicroUsd: nonnegative,
}));
export type DmLearningPolicy = typeof DmLearningPolicy.Type;

export const DmLearningSnapshot = strict(Schema.Struct({
  memorySpaceId: id, memoryRevision: nonnegative, revocationEpoch: nonnegative,
  kind: Schema.Literals(["extract", "explicit_request", "consolidate"]),
  policy: DmLearningPolicy,
  clock: strict(Schema.Struct({ id, version: Schema.Literal(1), at: IsoDateTimeWithOffset,
    timeZone: Schema.Literal("UTC") })),
  sourceStart: nonnegative, sourceEnd: nonnegative,
  requestSource: Schema.NullOr(DmLearningSourceRef),
  inputSources: list(DmLearningSourceRef, 32),
  roots: list(DmLearningRoot, 128), documents: list(DmLearningDocument, 128),
  excludedSources: list(DmLearningSourceRef, 1024),
}));
export type DmLearningSnapshot = typeof DmLearningSnapshot.Type;

const TopicItem = strict(Schema.Struct({
  itemId: label, section: Schema.Literals(["Current", "History"]),
  content: text(500), sourceRefs: list(DmLearningSourceRef, 32).check(Schema.isMinLength(1)),
}));

export const DmLearningChange = strict(Schema.Struct({
  changeId: label, action: Schema.Literals(["create", "revise", "supersede"]),
  documentId: Schema.NullOr(id), expectedVersion: Schema.NullOr(positive),
  replacementDocumentId: Schema.NullOr(id), replacementVersion: Schema.NullOr(positive),
  replacementChangeId: Schema.NullOr(label),
  documentKind: Schema.Literals(["observation", "topic"]),
  title: text(200), content: Schema.NullOr(text(500)),
  items: list(TopicItem, 32),
  memoryClass: Schema.Literals(["profile", "log", "note"]),
  evidenceType: Schema.Literals(["explicit_user", "observed"]),
  sourceLanguage: Schema.String.check(Schema.isPattern(/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/iu)),
  observedAt: Schema.NullOr(IsoDateTimeWithOffset), validUntil: Schema.NullOr(IsoDateTimeWithOffset),
  conflicted: Schema.Boolean,
  sourceRefs: list(DmLearningSourceRef, 64).check(Schema.isMinLength(1)),
}));
export type DmLearningChange = typeof DmLearningChange.Type;

export const DmLearningProposal = strict(Schema.Struct({
  explicitRequest: Schema.Boolean,
  changes: list(DmLearningChange, dmMemoryLearningMaxChanges),
}));
export type DmLearningProposal = typeof DmLearningProposal.Type;

export const dmLearningVerdicts = ["supported", "unsupported", "contradicted", "wrong_scope",
  "protected", "uncertain", "invalid_temporal_change"] as const;
export const DmLearningVerification = strict(Schema.Struct({
  approved: Schema.Boolean, explicitRequestAuthorized: Schema.Boolean,
  decisions: list(strict(Schema.Struct({ changeId: label,
    verdict: Schema.Literals(dmLearningVerdicts) })), dmMemoryLearningMaxChanges),
}));
export type DmLearningVerification = typeof DmLearningVerification.Type;

export const DmLearningUsage = strict(Schema.Struct({
  inputTokens: nonnegative, outputTokens: nonnegative, costMicroUsd: Schema.NullOr(nonnegative),
}));
export type DmLearningUsage = typeof DmLearningUsage.Type;

export const DmLearningCommitResult = strict(Schema.Struct({
  status: Schema.Literals(["succeeded", "no_change"]), revocationEpoch: nonnegative,
  documents: list(strict(Schema.Struct({ documentId: id, version: positive,
    action: Schema.Literals(["create", "revise", "supersede"]) })), dmMemoryLearningMaxChanges),
}));
export type DmLearningCommitResult = typeof DmLearningCommitResult.Type;
export const DmLearningProposalResult = Schema.Union([DmLearningCommitResult, strict(Schema.Struct({
  status: Schema.Literal("verifying"), proposalId: id, proposalHash: hash,
}))]);
export type DmLearningProposalResult = typeof DmLearningProposalResult.Type;
export const dmLearningFailureCodes = ["invalid_proposal", "verification_rejected", "stale", "scope_revoked",
  "budget_exhausted", "model_unavailable", "model_timeout", "model_credentials", "model_configuration", "input_capacity"] as const;

export const DmLearningInvocation = strict(Schema.Struct({
  callId: id, stage: Schema.Literals(["proposing", "verifying"]),
  inputHash: hash, proposalHash: Schema.NullOr(hash), proposalId: Schema.NullOr(id),
  model: DmLearningModel, snapshot: DmLearningSnapshot, proposal: Schema.NullOr(DmLearningProposal),
  status: Schema.Literals(["reserved", "completed", "failed"]),
}));
export type DmLearningInvocation = typeof DmLearningInvocation.Type;

export const ClaimedDmMemory = strict(Schema.Struct({
  workType: Schema.Literal("dmMemory"), workId: id, runId: id,
  organizationId: id, workerId: Schema.NonEmptyString,
  sourceKey: Schema.Literal("dm-memory"), title: Schema.Literal("DM memory learning"),
  claimToken: Schema.String.check(Schema.isStartsWith("briar_memory_claim_")),
  claimedAt: IsoDateTimeWithOffset, leaseExpiresAt: IsoDateTimeWithOffset,
  inputHash: hash, snapshot: DmLearningSnapshot,
}));
export type ClaimedDmMemory = typeof ClaimedDmMemory.Type;
export const decodeClaimedDmMemory = Schema.decodeUnknownSync(ClaimedDmMemory);
