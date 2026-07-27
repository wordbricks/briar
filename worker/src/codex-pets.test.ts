import { describe, expect, it, vi } from "vitest";
import { fetchCodexPet } from "./codex-pets";

describe("fetchCodexPet", () => {
  it("loads canonical metadata and the complete official sprite sheet", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([
          {
            slug: "firefly--lingxiaotian",
            name: "Firefly",
            author: "Lingxiaotian",
            license: "CC BY-NC 4.0",
            spriteVersionNumber: 1,
          },
        ]),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "content-type": "image/webp",
            etag: "sprite-etag",
          },
        }),
      );

    await expect(
      fetchCodexPet("firefly--lingxiaotian", fetcher),
    ).resolves.toMatchObject({
      metadata: {
        slug: "firefly--lingxiaotian",
        name: "Firefly",
        author: "Lingxiaotian",
        license: "CC BY-NC 4.0",
        spriteVersion: 1,
      },
      etag: "sprite-etag",
    });
  });

  it("rejects path traversal before fetching", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(fetchCodexPet("../private", fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
