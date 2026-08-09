import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  maxNormalizedActivityTextBytes,
  maxNormalizedActivityTitleBytes,
  normalizedActivityText,
  normalizedActivityTitle,
} from "./normalized-agent-event";

describe("normalized agent activity bounds", () => {
  it("bounds multibyte output and titles by UTF-8 bytes without splitting characters", () => {
    const source = `HEAD-${"한🙂".repeat(20_000)}-TAIL`;
    const text = normalizedActivityText(source);
    const title = normalizedActivityTitle(source);

    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(
      maxNormalizedActivityTextBytes,
    );
    expect(Buffer.byteLength(title, "utf8")).toBeLessThanOrEqual(
      maxNormalizedActivityTitleBytes,
    );
    expect(text).toMatch(/^HEAD-/);
    expect(text).toMatch(/-TAIL$/);
    expect(text).toContain("… output truncated …");
    expect(title).toMatch(/^HEAD-/);
    expect(title).toMatch(/-TAIL$/);
    expect(text).not.toContain("�");
    expect(title).not.toContain("�");
  });
});
