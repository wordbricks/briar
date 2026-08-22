import { describe, expect, it, vi } from "vitest";
import { fetchCodexPet } from "./codex-pets";

describe("fetchCodexPet", () => {
  it("rejects path traversal before fetching", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(fetchCodexPet("../private", fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
