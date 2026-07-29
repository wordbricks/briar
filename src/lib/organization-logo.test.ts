/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  isOrganizationLogoDataUrl,
  maxOrganizationLogoDataUrlLength,
  maxOrganizationLogoSourceBytes,
  organizationLogoFromFile,
} from "./organization-logo";

describe("organizationLogoFromFile", () => {
  it("rejects unsupported image formats", async () => {
    const file = new File(["not an image"], "logo.gif", {
      type: "image/gif",
    });

    await expect(organizationLogoFromFile(file)).rejects.toThrow(
      "invalid-organization-logo",
    );
  });

  it("rejects source images over 10 MB before decoding", async () => {
    const file = {
      size: maxOrganizationLogoSourceBytes + 1,
      type: "image/png",
    } as File;

    await expect(organizationLogoFromFile(file)).rejects.toThrow(
      "invalid-organization-logo",
    );
  });

  it("accepts a browser-supported fallback when WebP canvas encoding is unavailable", () => {
    expect(isOrganizationLogoDataUrl("data:image/png;base64,aA==")).toBe(true);
    expect(isOrganizationLogoDataUrl("data:image/jpeg;base64,aA==")).toBe(true);
    expect(isOrganizationLogoDataUrl("data:image/webp;base64,aA==")).toBe(true);
  });

  it("rejects unsupported or oversized logo output", () => {
    expect(isOrganizationLogoDataUrl("data:image/gif;base64,aA==")).toBe(false);
    expect(
      isOrganizationLogoDataUrl(
        `data:image/png;base64,${"a".repeat(maxOrganizationLogoDataUrlLength)}`,
      ),
    ).toBe(false);
  });
});
