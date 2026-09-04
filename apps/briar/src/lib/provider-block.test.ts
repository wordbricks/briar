import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ProviderBlockReason,
  ProviderBlockSchema,
} from "@briar/contracts/gen/briar/types/v1/provider_block_pb";
import { describe, expect, it } from "vitest";

import {
  formatProviderBlockRetryAt,
  providerBlockDetail,
  providerBlockFromProto,
  providerBlockMarksProviderUnhealthy,
  providerBlockNextAction,
  providerBlockRecovery,
  providerBlockReplyMessage,
  providerBlockRunSummary,
  providerBlockToProto,
  providerBlockReasons,
  type ProviderBlock,
} from "./provider-block";

describe("provider block wire mapping", () => {
  it("round-trips every reason through the proto", () => {
    for (const reason of providerBlockReasons) {
      const block: ProviderBlock = {
        reason,
        provider: "claude",
        message: `blocked by ${reason}`,
        nextRetryAt: "2026-09-04T12:00:00.000Z",
        statusCode: 429,
        providerCode: "rate_limit",
        serverNames: reason === "mcp_auth_required" ? ["figma"] : undefined,
      };
      const proto = providerBlockToProto(block);
      expect(proto.reason).not.toBe(ProviderBlockReason.UNSPECIFIED);
      expect(providerBlockFromProto(proto)).toEqual(
        reason === "mcp_auth_required" ? block : { ...block, serverNames: undefined },
      );
    }
  });

  it("drops unknown reasons and normalizes server names", () => {
    expect(providerBlockFromProto(create(ProviderBlockSchema, {
      reason: ProviderBlockReason.UNSPECIFIED,
      message: "x",
    }))).toBeNull();
    expect(providerBlockFromProto(undefined)).toBeNull();
    expect(providerBlockFromProto(create(ProviderBlockSchema, {
      reason: ProviderBlockReason.MCP_AUTH_REQUIRED,
      provider: " codex ",
      message: "  ",
      serverNames: ["figma\nplugin", "figma\nplugin", " "],
      nextRetryAt: timestampFromDate(new Date("2026-09-04T12:00:00.000Z")),
    }))).toEqual({
      reason: "mcp_auth_required",
      provider: "codex",
      message: "작업에 실제로 필요한 MCP 연결(알 수 없음)의 인증이 없습니다.",
      nextRetryAt: "2026-09-04T12:00:00.000Z",
      serverNames: ["figma plugin"],
    });
  });

  it("classifies how each reason clears", () => {
    expect(providerBlockRecovery("usage_exhausted")).toBe("wait");
    expect(providerBlockRecovery("auth_required")).toBe("machine");
    expect(providerBlockRecovery("context_window_exceeded")).toBe("request");
    expect(providerBlockMarksProviderUnhealthy("usage_exhausted")).toBe(true);
    expect(providerBlockMarksProviderUnhealthy("billing_required")).toBe(true);
    expect(providerBlockMarksProviderUnhealthy("upstream_overloaded")).toBe(false);
    expect(providerBlockMarksProviderUnhealthy("mcp_auth_required")).toBe(false);
    expect(providerBlockMarksProviderUnhealthy("model_unavailable")).toBe(false);
  });
});

describe("provider block copy", () => {
  const usage: ProviderBlock = {
    reason: "usage_exhausted",
    provider: "claude",
    message: "Claude AI usage limit reached",
    nextRetryAt: "2026-09-04T10:00:00.000Z",
  };

  it("formats the reset moment in KST", () => {
    expect(formatProviderBlockRetryAt("2026-09-04T10:00:00.000Z")).toBe(
      "2026-09-04 19:00 (KST)",
    );
    expect(formatProviderBlockRetryAt("garbage")).toBe("garbage");
  });

  it("writes a run summary, a next action and a machine detail", () => {
    expect(providerBlockRunSummary(usage)).toBe(
      "Claude 사용량 한도에 도달했습니다. 작업이 완료되지 않았으며 현재까지의 변경 사항은 worktree에 보존됩니다. Claude가 안내한 다음 사용 가능 시각은 2026-09-04 19:00 (KST)입니다.",
    );
    expect(providerBlockNextAction(usage)).toContain("2026-09-04 19:00 (KST) 이후까지 기다린 다음");
    expect(providerBlockNextAction(usage)).toContain("재시도");
    expect(providerBlockDetail(usage, { model: "opus" })).toBe(
      "Claude session entered retry/usage_exhausted; provider=claude, model=opus, providerMessage=Claude AI usage limit reached, nextRetryAt=2026-09-04T10:00:00.000Z",
    );
  });

  it("writes reply messages by recovery kind", () => {
    expect(providerBlockReplyMessage(usage)).toBe(
      "Claude 사용량 한도에 도달했습니다. 답변을 생성하지 못했습니다. Claude가 안내한 다음 사용 가능 시각은 2026-09-04 19:00 (KST)입니다. 잠시 후 다시 요청하거나 다른 provider의 Agent를 사용해 주세요.",
    );
    expect(providerBlockReplyMessage({
      reason: "auth_required",
      provider: "cursor",
      message: "Not logged in",
      nextRetryAt: null,
    })).toContain("Worker 컴퓨터에서 Cursor 설정을 확인");
    expect(providerBlockReplyMessage({
      reason: "context_window_exceeded",
      provider: "openrouter",
      message: "too long",
      nextRetryAt: null,
    })).toContain("요청 내용을 줄이거나");
    expect(providerBlockReplyMessage({
      reason: "model_unavailable",
      provider: "agy",
      message: "no model",
      nextRetryAt: null,
    }, { model: "gemini-x" })).toContain("선택한 모델(gemini-x)을 Antigravity에서");
  });
});
