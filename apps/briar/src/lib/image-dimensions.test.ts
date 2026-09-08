/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { readAttachmentDimensions, readImageDimensions } from "./image-dimensions";

const originalImage = globalThis.Image;

function stubImage(behaviour: "load" | "error" | "never", size = 640) {
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: class {
      naturalWidth = size;
      naturalHeight = size / 2;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        if (behaviour === "never") return;
        queueMicrotask(() =>
          behaviour === "load" ? this.onload?.() : this.onerror?.()
        );
      }
    },
  });
}

describe("attachment image dimensions", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: originalImage,
    });
    vi.restoreAllMocks();
  });

  it("measures the object URL the sender already holds", async () => {
    stubImage("load", 1_600);
    await expect(
      readAttachmentDimensions([
        { contentType: "image/png", source: "blob:existing" },
      ]),
    ).resolves.toEqual([{ width: 1_600, height: 800 }]);
  });

  it("skips files that are not images and never touches object URLs", async () => {
    const create = vi.spyOn(URL, "createObjectURL");
    stubImage("load");
    await expect(
      readAttachmentDimensions([
        { contentType: "application/pdf", source: "blob:doc" },
      ]),
    ).resolves.toEqual([null]);
    expect(create).not.toHaveBeenCalled();
  });

  it("gives up rather than holding the message back on a stalled decode", async () => {
    stubImage("never");
    await expect(
      readAttachmentDimensions(
        [{ contentType: "image/png", source: "blob:stalled" }],
        1,
      ),
    ).resolves.toEqual([null]);
  });

  it("releases the object URL it created for an unreadable upload", async () => {
    stubImage("error");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:measured");
    await expect(
      readImageDimensions(new File(["x"], "broken.png", { type: "image/png" })),
    ).resolves.toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:measured");
  });
});
