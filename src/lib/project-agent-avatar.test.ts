/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  isProjectAgentAvatarDataUrl,
  maxProjectAgentAvatarDataUrlLength,
  maxProjectAgentAvatarSourceBytes,
  projectAgentAvatarFromFile,
} from "./project-agent-avatar";

describe("projectAgentAvatarFromFile", () => {
  it("rejects unsupported image formats", async () => {
    const file = new File(["not an image"], "avatar.gif", {
      type: "image/gif",
    });

    await expect(projectAgentAvatarFromFile(file)).rejects.toThrow(
      "invalid-avatar",
    );
  });

  it("rejects source images over 10 MB before decoding", async () => {
    const file = {
      size: maxProjectAgentAvatarSourceBytes + 1,
      type: "image/png",
    } as File;

    await expect(projectAgentAvatarFromFile(file)).rejects.toThrow(
      "invalid-avatar",
    );
  });

  it("accepts a browser-supported fallback when WebP canvas encoding is unavailable", () => {
    expect(isProjectAgentAvatarDataUrl("data:image/png;base64,aA==")).toBe(
      true,
    );
    expect(isProjectAgentAvatarDataUrl("data:image/jpeg;base64,aA==")).toBe(
      true,
    );
    expect(isProjectAgentAvatarDataUrl("data:image/webp;base64,aA==")).toBe(
      true,
    );
  });

  it("rejects unsupported or oversized avatar output", () => {
    expect(isProjectAgentAvatarDataUrl("data:image/gif;base64,aA==")).toBe(
      false,
    );
    expect(
      isProjectAgentAvatarDataUrl(
        `data:image/png;base64,${"a".repeat(maxProjectAgentAvatarDataUrlLength)}`,
      ),
    ).toBe(false);
  });
});
