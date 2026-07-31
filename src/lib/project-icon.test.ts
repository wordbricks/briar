/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  isProjectIconDataUrl,
  maxProjectIconDataUrlLength,
  maxProjectIconSourceBytes,
  projectIconFromFile,
} from "./project-icon";

describe("projectIconFromFile", () => {
  it("accepts repository icon formats and rejects unsupported images", async () => {
    await expect(
      projectIconFromFile(
        new File(["gif"], "icon.gif", { type: "image/gif" }),
      ),
    ).rejects.toThrow("invalid-project-icon");
  });

  it("rejects source images over 10 MB before decoding", async () => {
    await expect(
      projectIconFromFile({
        name: "icon.png",
        size: maxProjectIconSourceBytes + 1,
        type: "image/png",
      } as File),
    ).rejects.toThrow("invalid-project-icon");
  });

  it("accepts only bounded normalized WebP output", () => {
    expect(isProjectIconDataUrl("data:image/webp;base64,aA==")).toBe(true);
    expect(isProjectIconDataUrl("data:image/png;base64,aA==")).toBe(false);
    expect(
      isProjectIconDataUrl(
        `data:image/webp;base64,${"a".repeat(maxProjectIconDataUrlLength)}`,
      ),
    ).toBe(false);
  });
});
