import { describe, expect, it } from "vitest";

import { AcpRpcError } from "./acp-json-rpc";
import { acpFailureBlock } from "./acp-runner";
import { ProviderBlockedError } from "./provider-block";

const profile = { providerId: "grok" } as const;

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

  it("reads ACP's authenticate-first error from its auth methods", () => {
    // `pi-acp` raises `RequestError.authRequired`, which carries the agent's
    // sign-in options and no error tag of its own. The -32000 code counts as
    // a sign-in signal only in that shape, because agents also report rate
    // limits under it (see the 429 case above).
    expect(acpFailureBlock({ providerId: "pi" } as const, new AcpRpcError(
      "session/new",
      "Authentication required: Configure an API key or log in with an OAuth provider.",
      -32000,
      { authMethods: [{ id: "pi_terminal_login" }] },
    ))).toMatchObject({ reason: "auth_required", provider: "pi" });
    // The same code without auth methods stays judged by its own text.
    expect(acpFailureBlock({ providerId: "pi" } as const, new AcpRpcError(
      "session/prompt",
      "upstream is overloaded",
      -32000,
      {},
    ))).toMatchObject({ reason: "upstream_overloaded" });
  });

  it("passes blocked errors through and judges plain errors by text", () => {
    const block = {
      reason: "billing_required" as const,
      provider: "cursor",
      message: "insufficient credits",
      nextRetryAt: null,
    };
    expect(acpFailureBlock({ providerId: "cursor" } as const, new ProviderBlockedError(block)))
      .toBe(block);
    expect(acpFailureBlock({ providerId: "cursor" } as const, new Error("Not logged in. Run cursor-agent login.")))
      .toMatchObject({ reason: "auth_required", provider: "cursor" });
    expect(acpFailureBlock(profile, new Error("Grok Agent ACP process exited with code 1.")))
      .toBeNull();
  });
});
