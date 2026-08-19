import { describe, expect, it } from "vitest";
import {
  maxEvidenceImageBytes,
  validateEvidenceImages,
} from "./evidence-images";

describe("evidence images", () => {
  it("accepts supported images within the upload limits", () => {
    expect(
      validateEvidenceImages([
        { name: "desktop.png", size: 1024, type: "image/png" },
        { name: "mobile.webp", size: 2048, type: "image/webp" },
        { name: "flow.svg", size: 3072, type: "image/svg+xml" },
      ]),
    ).toBeNull();
  });

  it("rejects non-images and oversized images", () => {
    expect(
      validateEvidenceImages([
        { name: "demo.mp4", size: 1024, type: "video/mp4" },
      ]),
    ).toMatch(/not a supported evidence image format/u);
    expect(
      validateEvidenceImages([
        {
          name: "huge.png",
          size: maxEvidenceImageBytes + 1,
          type: "image/png",
        },
      ]),
    ).toMatch(/20MB/u);
  });
});
