/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  isProjectIconDataUrl,
  isSupportedProjectIconFile,
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

  it("accepts supported extensions when a WebView omits the MIME type", () => {
    expect(
      isSupportedProjectIconFile({ name: "icon.PNG", size: 1, type: "" }),
    ).toBe(true);
    expect(
      isSupportedProjectIconFile({
        name: "icon.svg",
        size: 1,
        type: "application/octet-stream",
      }),
    ).toBe(true);
    expect(
      isSupportedProjectIconFile({ name: "icon.gif", size: 1, type: "" }),
    ).toBe(false);
    expect(
      isSupportedProjectIconFile({
        name: "icon.png",
        size: 1,
        type: "image/gif",
      }),
    ).toBe(false);
  });

  it("accepts bounded browser fallback output", () => {
    expect(isProjectIconDataUrl("data:image/webp;base64,aA==")).toBe(true);
    expect(isProjectIconDataUrl("data:image/png;base64,aA==")).toBe(true);
    expect(isProjectIconDataUrl("data:image/jpeg;base64,aA==")).toBe(true);
    expect(isProjectIconDataUrl("data:image/gif;base64,aA==")).toBe(false);
    expect(
      isProjectIconDataUrl(
        `data:image/webp;base64,${"a".repeat(maxProjectIconDataUrlLength)}`,
      ),
    ).toBe(false);
  });
});
