/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  codexPetPageUrl,
  codexPetSpriteSheetSourceUrl,
  loadCodexPetCatalog,
  opaquePixelBounds,
} from "./codex-pets";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Codex Pet catalog", () => {
  it("normalizes upstream pet metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            slug: "firefly--lingxiaotian",
            name: "Firefly",
            localized_names: { en: "Firefly", zh: "流萤" },
            author: "Lingxiaotian",
            author_url: "https://github.com/legeling",
            primary_category: "Game Characters",
            license: "CC BY-NC 4.0",
            spriteVersionNumber: 1,
          },
        ]),
        { status: 200 },
      ),
    );

    await expect(loadCodexPetCatalog()).resolves.toEqual([
      {
        slug: "firefly--lingxiaotian",
        name: "Firefly",
        localizedNames: { en: "Firefly", zh: "流萤" },
        author: "Lingxiaotian",
        authorUrl: "https://github.com/legeling",
        category: "Game Characters",
        license: "CC BY-NC 4.0",
        description: null,
        spriteVersion: 1,
      },
    ]);
  });

  it("only creates official URLs for safe slugs", () => {
    expect(codexPetPageUrl("firefly--lingxiaotian")).toBe(
      "https://codexpet.top/pets/firefly--lingxiaotian",
    );
    expect(codexPetSpriteSheetSourceUrl("firefly--lingxiaotian")).toContain(
      "/pets/firefly--lingxiaotian/spritesheet.webp",
    );
    expect(() => codexPetPageUrl("../private")).toThrow(
      "invalid-codex-pet-slug",
    );
  });

  it("trims transparent sprite margins before making the profile image", () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    data[(1 * 4 + 2) * 4 + 3] = 255;
    data[(2 * 4 + 3) * 4 + 3] = 255;

    expect(
      opaquePixelBounds({ width: 4, height: 4, data } as ImageData),
    ).toEqual({
      left: 2,
      top: 1,
      right: 3,
      bottom: 2,
    });
  });
});
