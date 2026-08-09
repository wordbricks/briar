/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  isOrganizationLogoDataUrl,
  maxOrganizationLogoDataUrlLength,
  maxOrganizationLogoSourceBytes,
  organizationLogoFromFile,
} from "./organization-logo";
import {
  isProjectAgentAvatarDataUrl,
  maxProjectAgentAvatarDataUrlLength,
  maxProjectAgentAvatarSourceBytes,
  projectAgentAvatarFromFile,
} from "./project-agent-avatar";

const adapters = [
  {
    name: "organization logo",
    fromFile: organizationLogoFromFile,
    isDataUrl: isOrganizationLogoDataUrl,
    maxSourceBytes: maxOrganizationLogoSourceBytes,
    maxDataUrlLength: maxOrganizationLogoDataUrlLength,
    invalidSourceError: "invalid-organization-logo",
  },
  {
    name: "project agent avatar",
    fromFile: projectAgentAvatarFromFile,
    isDataUrl: isProjectAgentAvatarDataUrl,
    maxSourceBytes: maxProjectAgentAvatarSourceBytes,
    maxDataUrlLength: maxProjectAgentAvatarDataUrlLength,
    invalidSourceError: "invalid-avatar",
  },
] as const;

describe.each(adapters)("$name image adapter", (adapter) => {
  it("rejects unsupported image formats", async () => {
    const file = new File(["not an image"], "image.gif", {
      type: "image/gif",
    });

    await expect(adapter.fromFile(file)).rejects.toThrow(
      adapter.invalidSourceError,
    );
  });

  it("rejects oversized source images before decoding", async () => {
    const file = {
      size: adapter.maxSourceBytes + 1,
      type: "image/png",
    } as File;

    await expect(adapter.fromFile(file)).rejects.toThrow(
      adapter.invalidSourceError,
    );
  });

  it("accepts supported browser image data URLs", () => {
    expect(adapter.isDataUrl("data:image/png;base64,aA==")).toBe(true);
    expect(adapter.isDataUrl("data:image/jpeg;base64,aA==")).toBe(true);
    expect(adapter.isDataUrl("data:image/webp;base64,aA==")).toBe(true);
  });

  it("rejects unsupported or oversized output", () => {
    expect(adapter.isDataUrl("data:image/gif;base64,aA==")).toBe(false);
    expect(
      adapter.isDataUrl(
        `data:image/png;base64,${"a".repeat(adapter.maxDataUrlLength)}`,
      ),
    ).toBe(false);
  });
});
