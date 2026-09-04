import { describe, expect, it } from "vitest";

import {
  describeDesktopError,
  isProviderBlockedError,
  providerBlockFromError,
  providerBlockText,
  providerBlockedErrorPrefix,
} from "./provider-block-error";

const t = (key: string, values: Record<string, string | number> = {}) =>
  `${key}|${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(",")}`;

describe("provider block desktop errors", () => {
  const raw = `${providerBlockedErrorPrefix}${JSON.stringify({
    reason: "usage_exhausted",
    provider: "claude",
    message: "limit",
    nextRetryAt: "2026-09-04T10:00:00.000Z",
    statusCode: 429,
  })}`;

  it("parses the prefixed JSON the Rust sidecar throws", () => {
    expect(providerBlockFromError(raw)).toEqual({
      reason: "usage_exhausted",
      provider: "claude",
      message: "limit",
      nextRetryAt: "2026-09-04T10:00:00.000Z",
      statusCode: 429,
    });
    expect(providerBlockFromError(new Error(raw))?.reason).toBe("usage_exhausted");
    expect(isProviderBlockedError("Codex 요청이 차단되었습니다: x")).toBe(false);
    expect(providerBlockFromError(`${providerBlockedErrorPrefix}{"reason":"later"}`))
      .toBeNull();
  });

  it("localizes the block and appends the reset moment", () => {
    expect(describeDesktopError(raw, t)).toBe(
      "providerBlock.usage_exhausted|provider=Claude,servers= providerBlock.retryAt|provider=Claude,time=2026-09-04 19:00 (KST)",
    );
    expect(describeDesktopError(new Error("plain"), t)).toBe("plain");
    expect(providerBlockText({
      reason: "mcp_auth_required",
      provider: "codex",
      message: "auth",
      nextRetryAt: null,
      serverNames: ["figma"],
    }, t)).toBe("providerBlock.mcp_auth_required|provider=Codex,servers=figma");
  });
});
