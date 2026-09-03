/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  isTeamIconDataUrl,
  isSupportedTeamIconFile,
  maxTeamIconDataUrlLength,
  maxTeamIconSourceBytes,
  teamIconFromFile,
} from "./team-icon";

describe("teamIconFromFile", () => {
  it("accepts repository icon formats and rejects unsupported images", async () => {
    await expect(
      teamIconFromFile(
        new File(["gif"], "icon.gif", { type: "image/gif" }),
      ),
    ).rejects.toThrow("invalid-project-icon");
  });

  it("rejects source images over 10 MB before decoding", async () => {
    await expect(
      teamIconFromFile({
        name: "icon.png",
        size: maxTeamIconSourceBytes + 1,
        type: "image/png",
      } as File),
    ).rejects.toThrow("invalid-project-icon");
  });

  it("accepts supported extensions when a WebView omits the MIME type", () => {
    expect(
      isSupportedTeamIconFile({ name: "icon.PNG", size: 1, type: "" }),
    ).toBe(true);
    expect(
      isSupportedTeamIconFile({
        name: "icon.svg",
        size: 1,
        type: "application/octet-stream",
      }),
    ).toBe(true);
    expect(
      isSupportedTeamIconFile({ name: "icon.gif", size: 1, type: "" }),
    ).toBe(false);
    expect(
      isSupportedTeamIconFile({
        name: "icon.png",
        size: 1,
        type: "image/gif",
      }),
    ).toBe(false);
  });

  it("accepts bounded browser fallback output", () => {
    expect(isTeamIconDataUrl("data:image/webp;base64,aA==")).toBe(true);
    expect(isTeamIconDataUrl("data:image/png;base64,aA==")).toBe(true);
    expect(isTeamIconDataUrl("data:image/jpeg;base64,aA==")).toBe(true);
    expect(isTeamIconDataUrl("data:image/gif;base64,aA==")).toBe(false);
    expect(
      isTeamIconDataUrl(
        `data:image/webp;base64,${"a".repeat(maxTeamIconDataUrlLength)}`,
      ),
    ).toBe(false);
  });
});
