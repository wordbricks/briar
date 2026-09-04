import { describe, expect, it } from "vitest";

import { AcpRpcError } from "./acp-json-rpc";
import { acpFailureBlock } from "./acp-runner";
import { ProviderBlockedError } from "./provider-block";

const profile = { providerId: "grok" };

describe("ACP failure classification", () => {
  it("classifies JSON-RPC errors by their data, then their text", () => {
    expect(acpFailureBlock(profile, new AcpRpcError(
      "session/prompt",
      "usage limit reached",
      -32000,
      { status: 429 },
    ))).toMatchObject({ reason: "usage_exhausted", provider: "grok", statusCode: 429 });
    expect(acpFailureBlock(profile, new AcpRpcError(
      "authenticate",
      "status 401 unauthorized",
    ))).toMatchObject({ reason: "auth_required" });
    expect(acpFailureBlock(profile, new AcpRpcError(
      "session/prompt",
      "prompt failed",
      -32000,
      { code: "context_length_exceeded" },
    ))).toMatchObject({ reason: "context_window_exceeded" });
    expect(acpFailureBlock(profile, new AcpRpcError("session/prompt", "Internal error")))
      .toBeNull();
  });

  it("passes blocked errors through and judges plain errors by text", () => {
    const block = {
      reason: "billing_required" as const,
      provider: "cursor",
      message: "insufficient credits",
      nextRetryAt: null,
    };
    expect(acpFailureBlock({ providerId: "cursor" }, new ProviderBlockedError(block)))
      .toBe(block);
    expect(acpFailureBlock({ providerId: "cursor" }, new Error("Not logged in. Run cursor-agent login.")))
      .toMatchObject({ reason: "auth_required", provider: "cursor" });
    expect(acpFailureBlock(profile, new Error("Grok Agent ACP process exited with code 1.")))
      .toBeNull();
  });
});
