import { describe, expect, it, vi } from "vitest";
import { dmMemoryEmbeddingError, dmMemoryVectorStore, dmMemoryRelevanceModel } from "./dm-memory-vector-store";

describe("DM embedding failure policy", () => {
  it("blocks configuration and daily allocation failures without preserving provider text", () => {
    for (const error of [{ status: 403 }, { statusCode: 402 }, { code: 3036 }, { code: "5035" }]) {
      const classified = dmMemoryEmbeddingError({ ...error, message: "synthetic private request text" });
      expect(classified.retryable).toBe(false);
      expect(classified.code).toBe("embedding_configuration_blocked");
      expect(classified.message).not.toContain("private");
    }
  });
  it("retries capacity and unknown transport failures but rejects invalid model configuration", () => {
    expect(dmMemoryEmbeddingError({ code: 3040, status: 429 }).retryable).toBe(true);
    expect(dmMemoryEmbeddingError(new Error("Synthetic connection failure")).retryable).toBe(true);
    expect(dmMemoryEmbeddingError({ code: 5007 }).retryable).toBe(false);
  });
});

describe("DM relevance verification", () => {
  const vector = {
    describe: async () => ({ dimensions: 1024 }), query: async () => ({ count: 0, matches: [] }),
    queryById: async () => ({ count: 0, matches: [] }), upsert: async () => ({ mutationId: "synthetic" }),
    deleteByIds: async () => ({ mutationId: "synthetic" }), getByIds: async () => [],
  } as unknown as Vectorize;

  it("submits private candidates only as untrusted user data and maps bounded indices", async () => {
    type RelevanceRequest = { messages: Array<{ content: string }> };
    const run = vi.fn(async (_model: string, _request: RelevanceRequest) => ({ choices: [{ finish_reason: "stop",
      message: { content: JSON.stringify({ relevant: [1, 1, 7] }) } }] }));
    const store = dmMemoryVectorStore({ run } as unknown as Ai, vector);
    expect(await store.verify(["안드로이드 최소 버전은?"], [
      { id: "first", text: "Unrelated upload limit" }, { id: "second", text: "Android 12" },
    ])).toEqual(["second"]);
    expect(run).toHaveBeenCalledTimes(1);
    const [model, request] = run.mock.calls[0]!;
    expect(model).toBe(dmMemoryRelevanceModel);
    expect(request.messages[0].content).not.toContain("Android 12");
    expect(request.messages[1].content).toContain("Android 12");
    expect(request).not.toHaveProperty("tools");
  });

  it("rejects malformed provider output without retaining its text", async () => {
    const store = dmMemoryVectorStore({ run: async () => ({ response: "private malformed response" }) } as unknown as Ai, vector);
    const error = await store.verify(["query"], [{ id: "first", text: "private memory" }]).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: "relevance_verification_failed", retryable: true });
    expect(String(error)).not.toContain("private");
  });

  it("accepts the direct Workers AI JSON response shape", async () => {
    const store = dmMemoryVectorStore({ run: async () => ({ response: { relevant: [0] } }) } as unknown as Ai, vector);
    expect(await store.verify(["query"], [{ id: "first", text: "answer" }])).toEqual(["first"]);
  });
});
