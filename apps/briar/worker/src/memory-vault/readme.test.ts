import { describe, expect, it } from "vitest";
import { MEMORY_VAULT_README } from "./readme";

describe("memory vault README", () => {
  it("serves the user's README byte for byte", async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(MEMORY_VAULT_README),
    );
    const hex = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(hex).toBe("d907567be6ee97bae6df48a58ce4018a1a4e98d5dc628031ef208956a74ba583");
  });
});
