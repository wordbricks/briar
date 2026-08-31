import { describe, expect, it } from "vitest";
import { dmMemoryEmbeddingError } from "./dm-memory-vector-store";

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
