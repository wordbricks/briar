import * as Schema from "effect/Schema";

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
