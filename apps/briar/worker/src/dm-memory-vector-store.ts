import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { dmMemoryEmbeddingDimensions, dmMemoryEmbeddingModel } from "./dm-memory-chunks";

export class DmMemoryIndexError extends Error {
  constructor(readonly code: string, readonly retryable = true) { super(code); }
}

const Embeddings = Schema.Struct({
  data: Schema.Array(Schema.Array(Schema.Finite)
    .check(Schema.isLengthBetween(dmMemoryEmbeddingDimensions, dmMemoryEmbeddingDimensions))),
});
const IndexInfo = Schema.Struct({
  dimensions: Schema.Int,
  processedUpToDatetime: Schema.optional(Schema.NullOr(Schema.String)),
  processedUpToMutation: Schema.optional(Schema.NullOr(Schema.String)),
});
const ProviderError = Schema.Struct({
  status: Schema.optional(Schema.Int), statusCode: Schema.optional(Schema.Int),
  code: Schema.optional(Schema.Union([Schema.Int, Schema.String])),
});

export function dmMemoryEmbeddingError(error: unknown) {
  if (error instanceof DmMemoryIndexError) return error;
  const decoded = Schema.decodeUnknownOption(ProviderError)(error);
  if (decoded._tag === "Some") {
    const status = decoded.value.status ?? decoded.value.statusCode;
    const code = Number(decoded.value.code);
    if (status === 401 || status === 402 || status === 403 || [5018, 5016, 3023, 3041, 5035, 3036].includes(code)) {
      return new DmMemoryIndexError("embedding_configuration_blocked", false);
    }
    if ([5007, 3042, 5004, 3003, 3006, 5019].includes(code)) {
      return new DmMemoryIndexError("embedding_request_invalid", false);
    }
  }
  // Capacity, rate limits and transport errors may recover. Unknown provider
  // failures are bounded by the same three-attempt policy; never log their text.
  return new DmMemoryIndexError("embedding_failed");
}
// Wrangler 4.118 generates the deprecated VectorizeIndex binding type. Validate
// the V2 runtime here, keeping the generated Env untouched and rejecting V1.
const VectorizeV2 = Schema.declare<Vectorize>((value): value is Vectorize => Predicate.isObject(value)
  && ["describe", "query", "queryById", "upsert", "deleteByIds", "getByIds"]
    .every((method) => Predicate.hasProperty(value, method) && Predicate.isFunction(value[method])));

export type DmMemoryVectorStore = Pick<Vectorize, "query" | "queryById" | "upsert" | "deleteByIds" | "getByIds"> & {
  info: () => Promise<typeof IndexInfo.Type>;
  embed: (texts: string[]) => Promise<number[][]>;
};

export function dmMemoryVectorStore(ai: Ai, binding: unknown): DmMemoryVectorStore {
  const index = Schema.decodeUnknownSync(VectorizeV2)(binding);
  return {
    query: (vector, options) => index.query(vector, options),
    queryById: (id, options) => index.queryById(id, options),
    upsert: (vectors) => index.upsert(vectors),
    deleteByIds: (ids) => index.deleteByIds(ids),
    getByIds: (ids) => index.getByIds(ids),
    async info() {
      const info = Schema.decodeUnknownSync(IndexInfo)(await index.describe());
      if (info.dimensions !== dmMemoryEmbeddingDimensions) throw new DmMemoryIndexError("index_profile_mismatch", false);
      return info;
    },
    async embed(texts) {
      try {
        const result = Schema.decodeUnknownSync(Embeddings)(await ai.run(dmMemoryEmbeddingModel, { text: texts }));
        if (result.data.length !== texts.length) throw new DmMemoryIndexError("embedding_count_mismatch");
        return result.data.map((vector) => [...vector]);
      } catch (error) {
        throw dmMemoryEmbeddingError(error);
      }
    },
  };
}
