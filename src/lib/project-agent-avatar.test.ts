/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
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
});
