import { describe, expect, it } from "vitest";

import {
  codexErrorCode,
  codexProviderBlock,
  consumeCodexAppServerMessage,
  createCodexAppServerState,
} from "./codex-runner-lib";
import { ProviderBlockedError } from "./provider-block";
import type { RunnerRequest } from "./runner-request";

const request: RunnerRequest = {
  message: "Fix it",
  workspaceRoot: "/repo",
  approvalPolicy: "never",
  sandboxMode: "workspaceWrite",
  networkAccess: true,
  attachments: [],
  additionalDirectories: [],
  providerBinaryPath: "/usr/local/bin/codex",
};

describe("Codex block classification", () => {
  it("reads Codex error identifiers in every shape the App Server uses", () => {
    expect(codexErrorCode({ codexErrorInfo: "usageLimitReached" })).toBe("usage_limit_reached");
    expect(codexErrorCode({ codexErrorInfo: { contextWindowExceeded: {} } }))
      .toBe("context_window_exceeded");
    expect(codexErrorCode({ code: "rate_limit_reached" })).toBe("rate_limit_reached");
    expect(codexErrorCode(null)).toBeUndefined();
  });

  it("maps turn failures to blocks and leaves ordinary failures alone", () => {
    expect(codexProviderBlock(
      { codexErrorInfo: "usageLimitReached" },
      "You've hit your usage limit. Try again in 2 hours.",
    )).toMatchObject({ reason: "usage_exhausted", provider: "codex" });
    expect(codexProviderBlock(
      { codexErrorInfo: "usageNotIncluded" },
      "This model is not included in your plan.",
    )).toMatchObject({ reason: "billing_required" });
    expect(codexProviderBlock({ status: 401 }, "unauthorized"))
      .toMatchObject({ reason: "auth_required", statusCode: 401 });
    expect(codexProviderBlock(null, "interrupted")).toBeNull();
  });

  it("throws a blocked error out of a failed turn with a usage limit", () => {
    const state = createCodexAppServerState();
    state.threadId = "thread-1";
    expect(() =>
      consumeCodexAppServerMessage(state, request, {
        method: "turn/completed",
        params: {
          turn: {
            status: "failed",
            error: {
              message: "You've hit your usage limit for GPT-5.",
              codexErrorInfo: "usageLimitReached",
            },
            items: [],
          },
        },
      })
    ).toThrowError(ProviderBlockedError);
    expect(() =>
      consumeCodexAppServerMessage(state, request, {
        method: "turn/completed",
        params: { turn: { status: "failed", error: { message: "interrupted" }, items: [] } },
      })
    ).toThrowError(/Codex turn did not complete: interrupted/);
  });

  it("throws a blocked error for an RPC rejection that names a quota", () => {
    const state = createCodexAppServerState();
    let caught: unknown;
    try {
      consumeCodexAppServerMessage(state, request, {
        id: 4,
        error: { code: -32000, message: "rate_limit_reached: too many requests" },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderBlockedError);
    expect((caught as ProviderBlockedError).block.reason).toBe("usage_exhausted");
  });
});
