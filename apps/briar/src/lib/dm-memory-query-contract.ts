import * as Schema from "effect/Schema";
import { IsoDateTimeWithOffset } from "./date-time-schema";

const strict = <S extends Schema.Top>(schema: S) => schema.annotate({
  parseOptions: { errors: "all", onExcessProperty: "error" },
});
const query = Schema.Trim.check(Schema.makeFilter((value) =>
  Array.from(value).length >= 1 && Array.from(value).length <= 512 ? undefined : "Expected 1–512 Unicode characters",
));
export const dmMemorySearchInput = strict(Schema.Struct({
  queries: Schema.Array(query).check(Schema.isLengthBetween(1, 3)),
  max_results: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 }))),
}));
export const dmMemoryGetInput = strict(Schema.Struct({
  documents: Schema.Array(strict(Schema.Struct({
    documentId: Schema.String.check(Schema.isUUID()),
    version: Schema.Int.check(Schema.isGreaterThan(0)),
    offsetBytes: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    maxBytes: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 256, maximum: 16384 }))),
  }))).check(Schema.isLengthBetween(1, 5)),
}));
export type DmMemorySearchInput = typeof dmMemorySearchInput.Type;
export type DmMemoryGetInput = typeof dmMemoryGetInput.Type;

export type DmMemoryReference = { documentId: string; version: number };
export type DmMemoryResultMetadata = DmMemoryReference & {
  title: string; memoryClass: "profile" | "log" | "note";
  evidenceType: "explicit_user" | "observed"; protectedByUser: boolean;
  sourceLanguage: string; observedAt: string | null; validUntil: string | null;
  conflicted: boolean; sourceMessageIds: string[]; sourceEventIds: string[]; updatedAt: string;
};
export type DmMemorySearchResult = DmMemoryResultMetadata & {
  chunkId: string; headings: string[]; excerpt: string; startBytes: number; endBytes: number;
  lineStart: number; lineEnd: number; score: number;
};
export type DmMemorySearchResponse = {
  status: "ok" | "unavailable" | "timeout";
  memoryRevision: number | null; revocationEpoch: number;
  indexState: "ready" | "pending" | "failed";
  truncated: boolean; results: DmMemorySearchResult[];
};
export type DmMemoryGetResult = (DmMemoryResultMetadata & {
  status: "ok"; body: string; offsetBytes: number; endOffsetBytes: number; nextOffsetBytes: number | null;
}) | (DmMemoryReference & {
  status: "stale_reference" | "deferred"; nextOffsetBytes: number | null;
});
export type DmMemoryGetResponse = {
  memoryRevision: number; revocationEpoch: number; truncated: boolean; documents: DmMemoryGetResult[];
};
export type DmMemoryBriefItem = DmMemoryReference & {
  body: string; observedAt: string | null; validUntil: string | null; protectedByUser: boolean;
};
export type DmMemoryBrief = {
  memorySpaceId: string; memoryRevision: number; revocationEpoch: number; policyVersion: string;
  validThrough: string | null; profile: DmMemoryBriefItem[]; progress: DmMemoryBriefItem[];
  omitted: boolean; notice: string;
};

const uuid = Schema.String.check(Schema.isUUID());
const nonnegative = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const positive = Schema.Int.check(Schema.isGreaterThan(0));
const date = Schema.NullOr(IsoDateTimeWithOffset);
const references = { documentId: uuid, version: positive };
export const dmMemoryReferenceSchema = strict(Schema.Struct(references));
const metadata = {
  ...references, title: Schema.String, memoryClass: Schema.Literals(["profile", "log", "note"]),
  evidenceType: Schema.Literals(["explicit_user", "observed"]), protectedByUser: Schema.Boolean,
  sourceLanguage: Schema.String, observedAt: date, validUntil: date, conflicted: Schema.Boolean,
  sourceMessageIds: Schema.mutable(Schema.Array(uuid)), sourceEventIds: Schema.mutable(Schema.Array(uuid)),
  updatedAt: Schema.String,
};
export const dmMemorySearchResponseSchema = strict(Schema.Struct({
  status: Schema.Literals(["ok", "unavailable", "timeout"]), memoryRevision: Schema.NullOr(nonnegative),
  revocationEpoch: nonnegative, indexState: Schema.Literals(["ready", "pending", "failed"]),
  truncated: Schema.Boolean, results: Schema.mutable(Schema.Array(strict(Schema.Struct({
    ...metadata, chunkId: Schema.String, headings: Schema.mutable(Schema.Array(Schema.String)),
    excerpt: Schema.String, startBytes: nonnegative, endBytes: nonnegative,
    lineStart: positive, lineEnd: positive, score: Schema.Finite,
  })))).check(Schema.isMaxLength(10)),
}));
export const dmMemoryGetResponseSchema = strict(Schema.Struct({
  memoryRevision: nonnegative, revocationEpoch: nonnegative, truncated: Schema.Boolean,
  documents: Schema.mutable(Schema.Array(Schema.Union([
    strict(Schema.Struct({ ...metadata, status: Schema.Literal("ok"), body: Schema.String,
      offsetBytes: nonnegative, endOffsetBytes: nonnegative, nextOffsetBytes: Schema.NullOr(nonnegative) })),
    strict(Schema.Struct({ ...references, status: Schema.Literals(["stale_reference", "deferred"]),
      nextOffsetBytes: Schema.NullOr(nonnegative) })),
  ]))).check(Schema.isMaxLength(5)),
}));
const briefItem = strict(Schema.Struct({ ...references, body: Schema.String,
  observedAt: date, validUntil: date, protectedByUser: Schema.Boolean }));
export const dmMemoryBriefSchema = strict(Schema.Struct({
  memorySpaceId: uuid, memoryRevision: nonnegative, revocationEpoch: nonnegative,
  policyVersion: Schema.String, validThrough: date,
  profile: Schema.mutable(Schema.Array(briefItem)), progress: Schema.mutable(Schema.Array(briefItem)),
  omitted: Schema.Boolean, notice: Schema.String,
}));
export const dmMemoryCapability = { protocol: 1 } as const;
export const dmMemoryDescriptorSchema = strict(Schema.Struct({
  protocol: Schema.Literal(1), memorySpaceId: uuid, memoryRevision: nonnegative,
  revocationEpoch: nonnegative, searchEnabled: Schema.Boolean,
  briefState: Schema.Literals(["available", "disabled"]),
}));
export type DmMemoryDescriptor = typeof dmMemoryDescriptorSchema.Type;
export const dmMemoryRequestSchema = Schema.Union([
  strict(Schema.Struct({ operation: Schema.Literal("search"), ...dmMemorySearchInput.fields })),
  strict(Schema.Struct({ operation: Schema.Literal("get"), ...dmMemoryGetInput.fields })),
]);
export type DmMemoryRequest = typeof dmMemoryRequestSchema.Type;
export const dmMemoryLookupInputSchema = strict(Schema.Struct({
  workerId: Schema.Trim.check(Schema.isLengthBetween(1, 64)), requestId: uuid,
  revocationEpoch: nonnegative, request: dmMemoryRequestSchema,
}));
export const dmMemoryLookupResponseSchema = Schema.Union([
  strict(Schema.Struct({ operation: Schema.Literal("search"), ...dmMemorySearchResponseSchema.fields })),
  strict(Schema.Struct({ operation: Schema.Literal("get"), ...dmMemoryGetResponseSchema.fields })),
]);
export type DmMemoryLookupResponse = typeof dmMemoryLookupResponseSchema.Type;
export const dmMemoryBriefResponseSchema = strict(Schema.Struct({
  memory: dmMemoryDescriptorSchema, brief: Schema.NullOr(dmMemoryBriefSchema),
}));
