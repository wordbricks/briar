import { describe, expect, it } from "vitest";
import {
  assertDetachedProviderTurnSucceeded,
  detachedProviderTurnFailure,
  type DetachedProviderTurnResult,
} from "./detached-provider-turn";

const result = (
  overrides: Partial<DetachedProviderTurnResult> = {},
): DetachedProviderTurnResult => ({
  exitCode: 0,
  stderr: "",
  runnerError: null,
  completed: true,
  resultText: null,
  conversationId: "conversation-1",
  ...overrides,
});

describe("detached provider turn outcome", () => {
  it("returns an Antigravity error for the issue lifecycle to recover", () => {
    expect(
      detachedProviderTurnFailure(result({
        runnerError: "Antigravity CLI가 코드 1(으)로 종료되었습니다.",
        completed: false,
      })),
    ).toBe("Antigravity CLI가 코드 1(으)로 종료되었습니다.");
  });

  it("preserves strict failure assertions for bounded provider calls", () => {
    expect(() =>
      assertDetachedProviderTurnSucceeded(result({
        exitCode: 1,
        stderr: "provider failed",
        completed: false,
      }))
    ).toThrow("provider failed");
  });

  it("allows callers that do not require a structured result", () => {
    expect(
      detachedProviderTurnFailure(result({ completed: false }), {
        requireResult: false,
      }),
    ).toBeNull();
  });
});
