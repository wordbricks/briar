import * as Schema from "effect/Schema";
import { IsoDateTimeWithOffset } from "./date-time-schema";
import { dmLearningFailureCodes } from "./dm-memory-learning-contract";

export const dmMemoryDocumentMaxBytes = 65_536;
export const dmMemoryPageSize = 50;
export const dmMemoryClasses = ["profile", "log", "note"] as const;
export type DmMemoryClass = (typeof dmMemoryClasses)[number];

const strict = <S extends Schema.Top>(schema: S) => schema.annotate({
  parseOptions: { errors: "all", onExcessProperty: "error" },
});
const id = Schema.String.check(Schema.isUUID());
const version = Schema.Int.check(Schema.isGreaterThan(0));
const body = Schema.String.check(Schema.makeFilter((value) =>
  value.trim().length > 0 && new TextEncoder().encode(value).length <= dmMemoryDocumentMaxBytes
    ? undefined : "Memory must contain text and fit within 64 KiB",
));
const fields = {
  requestId: id,
  memorySpaceId: Schema.optional(id),
  title: Schema.Trim.check(Schema.isLengthBetween(1, 200)),
  body,
  memoryClass: Schema.Literals(dmMemoryClasses),
  sourceLanguage: Schema.String.check(Schema.isPattern(/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/iu)),
  observedAt: Schema.NullOr(IsoDateTimeWithOffset),
  validUntil: Schema.NullOr(IsoDateTimeWithOffset),
  sourceMessage: Schema.optional(strict(Schema.Struct({ id, version }))),
};

export const dmMemoryCreateInput = strict(Schema.Struct(fields));
export const dmMemoryEditInput = strict(Schema.Struct({ ...fields, expectedVersion: version }));
export const dmMemorySettingsInput = strict(Schema.Struct({
  requestId: id,
  memorySpaceId: Schema.optional(id),
  expectedMemoryRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  useEnabled: Schema.Boolean,
  autoEnabled: Schema.Boolean,
}));
export type DmMemoryCreateInput = typeof dmMemoryCreateInput.Type;
export type DmMemoryEditInput = typeof dmMemoryEditInput.Type;
export type DmMemorySettingsInput = typeof dmMemorySettingsInput.Type;
export const dmMemoryLearningRetryInput = strict(Schema.Struct({
  requestId: id, revocationEpoch: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}));
export type DmMemoryLearningRetryInput = typeof dmMemoryLearningRetryInput.Type;

export const DmMemorySpace = Schema.Struct({
  id, channelId: id, agentId: id, rosterEpoch: Schema.Int,
  status: Schema.Literals(["active", "closed"]), useEnabled: Schema.Boolean,
  autoEnabled: Schema.Boolean, memoryRevision: Schema.Int, revocationEpoch: Schema.Int,
  createdAt: Schema.String, updatedAt: Schema.String,
});
export type DmMemorySpace = typeof DmMemorySpace.Type;

const documentFields = {
  id, memorySpaceId: id, kind: Schema.Literals(["observation", "topic"]),
  title: Schema.String, version, status: Schema.Literals(["active", "invalidated", "superseded"]),
  conflicted: Schema.Boolean, memoryClass: Schema.Literals(dmMemoryClasses),
  evidenceType: Schema.Literals(["explicit_user", "observed"]), protectedByUser: Schema.Boolean,
  sourceLanguage: Schema.String, observedAt: Schema.NullOr(Schema.String),
  validUntil: Schema.NullOr(Schema.String), createdAt: Schema.String, updatedAt: Schema.String,
  indexState: Schema.Literals(["pending", "ready", "failed"]),
};
export const DmMemoryDocument = Schema.Struct(documentFields);
export type DmMemoryDocument = typeof DmMemoryDocument.Type;
export const DmMemorySource = Schema.Struct({
  type: Schema.Literals(["message", "user_edit_event"]), id: Schema.String, version,
});
export type DmMemorySource = typeof DmMemorySource.Type;
export const DmMemoryDocumentDetail = Schema.Struct({
  ...documentFields, body: Schema.String, sources: Schema.Array(DmMemorySource),
});
export type DmMemoryDocumentDetail = typeof DmMemoryDocumentDetail.Type;
export const DmMemoryRevisionSummary = Schema.Struct({
  version, createdAt: Schema.String, memoryClass: Schema.Literals(dmMemoryClasses),
  protectedByUser: Schema.Boolean, validUntil: Schema.NullOr(Schema.String),
  origin: Schema.Literals(["user_edit", "explicit_request", "extract", "consolidate"]),
});
export const DmMemoryRevisionPage = Schema.Struct({
  documentId: id, currentVersion: version, revisions: Schema.Array(DmMemoryRevisionSummary),
  nextCursor: Schema.NullOr(version),
});
export type DmMemoryRevisionPage = typeof DmMemoryRevisionPage.Type;
export const DmMemoryLearningStatus = Schema.Struct({
  configuration: Schema.NullOr(Schema.Struct({
    proposer: Schema.Struct({ transport: Schema.Literals(["agent", "openrouter"]), model: Schema.String, provider: Schema.String }),
    verifier: Schema.Struct({ transport: Schema.Literals(["agent", "openrouter"]), model: Schema.String, provider: Schema.String }),
    costTracked: Schema.Boolean,
    spaceDailyCalls: Schema.Int, spaceDailyMicroUsd: Schema.Int,
    agentProvider: Schema.String, agentProviderVerified: Schema.Boolean, workerAvailable: Schema.Boolean,
  })),
  callsToday: Schema.Int, reservedMicroUsdToday: Schema.Int, pendingJobs: Schema.Int, failedJobs: Schema.Int,
  retryableJob: Schema.optional(Schema.NullOr(Schema.Struct({ id, callsUsed: Schema.Int }))),
  lastJob: Schema.NullOr(Schema.Struct({
    id, kind: Schema.Literals(["extract", "explicit_request", "consolidate"]),
    status: Schema.Literals(["pending", "running", "retry_wait", "failed", "cancelled", "succeeded", "no_change"]),
    stage: Schema.NullOr(Schema.Literals(["proposing", "verifying", "committing"])),
    errorCode: Schema.NullOr(Schema.Literals(dmLearningFailureCodes)), updatedAt: Schema.String,
  })),
});
export type DmMemoryLearningStatus = typeof DmMemoryLearningStatus.Type;
export const DmMemoryPage = Schema.Struct({
  eligible: Schema.Boolean,
  capabilities: Schema.Struct({ recall: Schema.Boolean, automaticLearning: Schema.Boolean }),
  spaces: Schema.Array(DmMemorySpace), selectedSpaceId: Schema.NullOr(id),
  documents: Schema.Array(DmMemoryDocument), nextCursor: Schema.NullOr(id),
  learning: Schema.optional(Schema.NullOr(DmMemoryLearningStatus)),
});
export type DmMemoryPage = typeof DmMemoryPage.Type;

export const dmMemoryOperationSchemas = {
  listDmMemory: { response: DmMemoryPage },
  getDmMemoryDocument: { response: Schema.Struct({ document: DmMemoryDocumentDetail }) },
  listDmMemoryRevisions: { response: DmMemoryRevisionPage },
  createDmMemoryDocument: {
    request: dmMemoryCreateInput,
    response: Schema.Struct({ documentId: Schema.String, version: Schema.Int, replayed: Schema.Boolean }),
  },
  editDmMemoryDocument: {
    request: dmMemoryEditInput,
    response: Schema.Struct({ documentId: Schema.String, version: Schema.Int, replayed: Schema.Boolean }),
  },
  deleteDmMemoryDocument: { response: Schema.Struct({ deleted: Schema.Boolean, purgeState: Schema.String }) },
  setDmMemorySettings: { request: dmMemorySettingsInput, response: Schema.Struct({ space: DmMemorySpace }) },
};
