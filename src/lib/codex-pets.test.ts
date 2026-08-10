/** @vitest-environment jsdom */

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  codexPetPageUrl,
  codexPetSpriteSheetSourceUrl,
  loadCodexPetCatalog,
  maxCodexPetSpriteSheetBytes,
  projectAgentAvatarFromCodexPet,
  type CodexPetCatalogEntry,
} from "./codex-pets";

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL",
);
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL",
);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterAll(() => {
  restoreUrlMethod("createObjectURL", originalCreateObjectUrl);
  restoreUrlMethod("revokeObjectURL", originalRevokeObjectUrl);
});

const pet: CodexPetCatalogEntry = {
  slug: "firefly--lingxiaotian",
  name: "Firefly",
  localizedNames: { en: "Firefly" },
  author: "Lingxiaotian",
  authorUrl: "https://github.com/legeling",
  category: "Game Characters",
  license: "CC BY-NC 4.0",
  description: null,
  spriteVersion: 1,
};

function spriteResponse(options?: {
  contentLength?: number;
  contentType?: string;
  ok?: boolean;
}) {
  return new Response(new Blob(["sprite"]), {
    status: options?.ok === false ? 404 : 200,
    headers: {
      "content-length": String(options?.contentLength ?? 6),
      "content-type": options?.contentType ?? "image/webp",
    },
  });
}

function installImageLoader(options?: {
  height?: number;
  loadError?: boolean;
  width?: number;
}) {
  const width = options?.width ?? 1_536;
  const height = options?.height ?? 1_872;
  class MockImage {
    naturalWidth = width;
    naturalHeight = height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => {
        if (options?.loadError) this.onerror?.();
        else this.onload?.();
      });
    }
  }
  vi.stubGlobal("Image", MockImage);
}

function installObjectUrls() {
  const createObjectURL = vi.fn(() => "blob:codex-pet");
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
  return { createObjectURL, revokeObjectURL };
}

function installCanvasRendering(options?: {
  alphaPixels?: Array<[number, number]>;
  output?: string;
}) {
  const data = new Uint8ClampedArray(192 * 208 * 4);
  for (const [x, y] of options?.alphaPixels ?? [
    [2, 1],
    [3, 2],
  ]) {
    data[(y * 192 + x) * 4 + 3] = 255;
  }
  const sourceContext = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ width: 192, height: 208, data })),
    imageSmoothingEnabled: true,
  };
  const avatarContext = {
    drawImage: vi.fn(),
    imageSmoothingEnabled: true,
  };
  const sourceCanvas = {
    getContext: vi.fn(() => sourceContext),
    height: 0,
    width: 0,
  };
  const avatarCanvas = {
    getContext: vi.fn(() => avatarContext),
    height: 0,
    toDataURL: vi.fn(
      () => options?.output ?? "data:image/webp;base64,YXZhdGFy",
    ),
    width: 0,
  };
  vi.spyOn(document, "createElement")
    .mockReturnValueOnce(sourceCanvas as unknown as HTMLCanvasElement)
    .mockReturnValueOnce(avatarCanvas as unknown as HTMLCanvasElement);
  return { avatarCanvas, avatarContext, sourceCanvas, sourceContext };
}

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

  it("creates a centered avatar from the first non-transparent sprite frame", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(spriteResponse());
    installImageLoader();
    const objectUrls = installObjectUrls();
    const canvas = installCanvasRendering();

    await expect(projectAgentAvatarFromCodexPet(pet)).resolves.toBe(
      "data:image/webp;base64,YXZhdGFy",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets/firefly--lingxiaotian/spritesheet.webp",
      { signal: undefined },
    );
    expect(canvas.sourceCanvas).toMatchObject({ width: 192, height: 208 });
    expect(canvas.sourceContext.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      192,
      208,
      0,
      0,
      192,
      208,
    );
    expect(canvas.avatarCanvas).toMatchObject({ width: 256, height: 256 });
    expect(canvas.avatarContext.drawImage).toHaveBeenCalledWith(
      canvas.sourceCanvas,
      2,
      1,
      2,
      2,
      20,
      20,
      216,
      216,
    );
    expect(canvas.avatarCanvas.toDataURL).toHaveBeenCalledWith(
      "image/webp",
      0.9,
    );
    expect(objectUrls.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith("blob:codex-pet");
  });

  it.each([
    ["an unsuccessful response", spriteResponse({ ok: false })],
    [
      "an unexpected content type",
      spriteResponse({ contentType: "image/png" }),
    ],
  ])("rejects %s before decoding", async (_, response) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    const objectUrls = installObjectUrls();

    await expect(projectAgentAvatarFromCodexPet(pet)).rejects.toThrow(
      "codex-pet-spritesheet-unavailable",
    );
    expect(objectUrls.createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects a sprite sheet whose declared size exceeds the limit", async () => {
    const response = spriteResponse({
      contentLength: maxCodexPetSpriteSheetBytes + 1,
    });
    const blob = vi.spyOn(response, "blob");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    const objectUrls = installObjectUrls();

    await expect(projectAgentAvatarFromCodexPet(pet)).rejects.toThrow(
      "codex-pet-spritesheet-too-large",
    );
    expect(blob).not.toHaveBeenCalled();
    expect(objectUrls.createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects a sprite sheet whose downloaded body exceeds the limit", async () => {
    const response = spriteResponse();
    vi.spyOn(response, "blob").mockResolvedValue({
      size: maxCodexPetSpriteSheetBytes + 1,
    } as Blob);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    const objectUrls = installObjectUrls();

    await expect(projectAgentAvatarFromCodexPet(pet)).rejects.toThrow(
      "codex-pet-spritesheet-too-large",
    );
    expect(objectUrls.createObjectURL).not.toHaveBeenCalled();
  });

  it.each([
    [1, 1_535, 1_872],
    [1, 1_536, 1_871],
    [2, 1_536, 2_287],
  ] as const)(
    "rejects invalid version %i sprite dimensions (%i x %i) and releases the object URL",
    async (spriteVersion, width, height) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(spriteResponse());
      installImageLoader({ width, height });
      const objectUrls = installObjectUrls();

      await expect(
        projectAgentAvatarFromCodexPet({ ...pet, spriteVersion }),
      ).rejects.toThrow("invalid-codex-pet-spritesheet");
      expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith("blob:codex-pet");
    },
  );

  it("releases the object URL when image decoding fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(spriteResponse());
    installImageLoader({ loadError: true });
    const objectUrls = installObjectUrls();

    await expect(projectAgentAvatarFromCodexPet(pet)).rejects.toThrow(
      "invalid-codex-pet-image",
    );
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith("blob:codex-pet");
  });

  it("rejects an empty first frame through the public avatar API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(spriteResponse());
    installImageLoader();
    installObjectUrls();
    installCanvasRendering({ alphaPixels: [] });

    await expect(projectAgentAvatarFromCodexPet(pet)).rejects.toThrow(
      "empty-codex-pet-frame",
    );
  });
});

function restoreUrlMethod(
  name: "createObjectURL" | "revokeObjectURL",
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) Object.defineProperty(URL, name, descriptor);
  else delete (URL as unknown as Record<string, unknown>)[name];
}
