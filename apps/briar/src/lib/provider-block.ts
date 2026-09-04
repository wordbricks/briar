import { create } from "@bufbuild/protobuf";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ProviderBlockReason as ProtoProviderBlockReason,
  ProviderBlockSchema,
  type ProviderBlock as ProtoProviderBlock,
} from "@briar/contracts/gen/briar/types/v1/provider_block_pb";
import { agentProviderLabels, type AgentProvider } from "./agent-provider";

/**
 * `briar.types.v1.ProviderBlock` is the one description of why a coding-agent
 * provider stopped a turn before producing a result. The runner bundles
 * classify their provider's native failure into it, and every consumer (the
 * execution Worker, the server, the desktop) reads the `reason` instead of
 * provider error text. This module is the TypeScript projection plus the
 * user-facing copy each consumer shares.
 */

export type ProviderBlockReason =
  | "mcp_auth_required"
  | "usage_exhausted"
  | "upstream_overloaded"
  | "free_tier_limit"
  | "auth_required"
  | "context_window_exceeded"
  | "billing_required"
  | "model_unavailable";

export const providerBlockReasons: readonly ProviderBlockReason[] = [
  "mcp_auth_required",
  "usage_exhausted",
  "upstream_overloaded",
  "free_tier_limit",
  "auth_required",
  "context_window_exceeded",
  "billing_required",
  "model_unavailable",
];

export type ProviderBlock = {
  reason: ProviderBlockReason;
  /** Runner provider name, or the upstream model provider when known. */
  provider: string;
  /** Provider text already safe to show to an end user. */
  message: string;
  /** ISO timestamp of the reset the provider announced, when it did. */
  nextRetryAt: string | null;
  statusCode?: number;
  /** The provider's own identifier for the failure, for diagnostics. */
  providerCode?: string;
  serverNames?: string[];
};

export function isProviderBlockReason(
  value: unknown,
): value is ProviderBlockReason {
  return typeof value === "string" &&
    (providerBlockReasons as readonly string[]).includes(value);
}

const reasonToProto = {
  mcp_auth_required: ProtoProviderBlockReason.MCP_AUTH_REQUIRED,
  usage_exhausted: ProtoProviderBlockReason.USAGE_EXHAUSTED,
  upstream_overloaded: ProtoProviderBlockReason.UPSTREAM_OVERLOADED,
  free_tier_limit: ProtoProviderBlockReason.FREE_TIER_LIMIT,
  auth_required: ProtoProviderBlockReason.AUTH_REQUIRED,
  context_window_exceeded: ProtoProviderBlockReason.CONTEXT_WINDOW_EXCEEDED,
  billing_required: ProtoProviderBlockReason.BILLING_REQUIRED,
  model_unavailable: ProtoProviderBlockReason.MODEL_UNAVAILABLE,
} as const satisfies Record<ProviderBlockReason, ProtoProviderBlockReason>;

const reasonFromProto = new Map<ProtoProviderBlockReason, ProviderBlockReason>(
  providerBlockReasons.map((reason) => [reasonToProto[reason], reason]),
);

export const providerBlockReasonToProto = (
  reason: ProviderBlockReason,
): ProtoProviderBlockReason => reasonToProto[reason];

export const providerBlockReasonFromProto = (
  reason: ProtoProviderBlockReason,
): ProviderBlockReason | null => reasonFromProto.get(reason) ?? null;

export function providerBlockToProto(block: ProviderBlock): ProtoProviderBlock {
  const retryDate = block.nextRetryAt ? new Date(block.nextRetryAt) : undefined;
  if (retryDate && Number.isNaN(retryDate.valueOf())) {
    throw new Error(`Invalid provider block retry timestamp: ${block.nextRetryAt}`);
  }
  return create(ProviderBlockSchema, {
    reason: reasonToProto[block.reason],
    message: block.message,
    provider: block.provider || undefined,
    serverNames: block.serverNames ?? [],
    nextRetryAt: retryDate ? timestampFromDate(retryDate) : undefined,
    statusCode: block.statusCode,
    providerCode: block.providerCode,
  });
}

/**
 * Read a wire block. An unknown reason (a runner newer than this consumer)
 * yields null so callers fall back to their generic failure path instead of
 * acting on a reason they cannot interpret.
 */
export function providerBlockFromProto(
  value: ProtoProviderBlock | undefined | null,
): ProviderBlock | null {
  if (!value) return null;
  const reason = reasonFromProto.get(value.reason);
  if (!reason) return null;
  const provider = value.provider?.trim() || "provider";
  const serverNames = [
    ...new Set(
      value.serverNames
        .map((name) =>
          name
            .replace(/[\r\n\t]+/g, " ")
            .replace(/[^\p{L}\p{N} ._@/-]+/gu, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 200)
        )
        .filter(Boolean),
    ),
  ].sort();
  const nextRetryAt = value.nextRetryAt
    ? timestampDate(value.nextRetryAt).toISOString()
    : null;
  return {
    reason,
    provider,
    message: value.message.trim() || providerBlockHeadline({
      reason,
      provider,
      message: "",
      nextRetryAt,
    }),
    nextRetryAt,
    ...(value.statusCode !== undefined ? { statusCode: value.statusCode } : {}),
    ...(value.providerCode?.trim()
      ? { providerCode: value.providerCode.trim() }
      : {}),
    ...(serverNames.length > 0 ? { serverNames } : {}),
  };
}

/**
 * How a block clears. `wait`: the same account recovers by itself and
 * `nextRetryAt` may say when. `machine`: a person must act on the machine or
 * account that ran the turn, but another Worker may already be able to take
 * the work. `request`: the request itself must change; no Worker can help.
 */
export type ProviderBlockRecovery = "wait" | "machine" | "request";

export function providerBlockRecovery(
  reason: ProviderBlockReason,
): ProviderBlockRecovery {
  switch (reason) {
    case "usage_exhausted":
    case "free_tier_limit":
    case "upstream_overloaded":
      return "wait";
    case "mcp_auth_required":
    case "auth_required":
    case "billing_required":
      return "machine";
    case "context_window_exceeded":
    case "model_unavailable":
      return "request";
  }
}

/** Blocks that mean this machine's provider account cannot take more work now. */
export function providerBlockMarksProviderUnhealthy(
  reason: ProviderBlockReason,
): boolean {
  return providerBlockRecovery(reason) !== "request" &&
    reason !== "upstream_overloaded" && reason !== "mcp_auth_required";
}

export function providerBlockLabel(provider: string): string {
  const label = (agentProviderLabels as Record<string, string>)[provider];
  return label ?? provider;
}

const seoulTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** `2026-09-04 19:00 (KST)` for the reset moment a provider announced. */
export function formatProviderBlockRetryAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = Object.fromEntries(
    seoulTime.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (KST)`;
}

export type ProviderBlockCopyOptions = {
  model?: string | null;
};

/** One sentence naming the cause, in the language Briar's runtime copy uses. */
export function providerBlockHeadline(
  block: ProviderBlock,
  options: ProviderBlockCopyOptions = {},
): string {
  const label = providerBlockLabel(block.provider);
  switch (block.reason) {
    case "mcp_auth_required":
      return `작업에 실제로 필요한 MCP 연결(${
        block.serverNames?.join(", ") || "알 수 없음"
      })의 인증이 없습니다.`;
    case "usage_exhausted":
      return `${label} 사용량 한도에 도달했습니다.`;
    case "free_tier_limit":
      return `${label} 무료 사용 한도가 소진되었습니다.`;
    case "upstream_overloaded":
      return `${label} 서비스가 혼잡해 요청을 처리하지 못했습니다.`;
    case "auth_required":
      return `${label} 로그인이 만료되었거나 인증이 거부되었습니다.`;
    case "billing_required":
      return `${label} 계정의 결제 또는 크레딧 상태 때문에 요청이 거부되었습니다.`;
    case "context_window_exceeded":
      return `요청이 ${label} 모델의 컨텍스트 한도를 초과했습니다.`;
    case "model_unavailable":
      return `선택한 모델(${
        options.model?.trim() || "provider default"
      })을 ${label}에서 사용할 수 없습니다.`;
  }
}

export function providerBlockRetryHint(block: ProviderBlock): string {
  if (!block.nextRetryAt) return "";
  return ` ${providerBlockLabel(block.provider)}가 안내한 다음 사용 가능 시각은 ${
    formatProviderBlockRetryAt(block.nextRetryAt)
  }입니다.`;
}

/** The exact step a person takes so the same work can run again. */
export function providerBlockNextAction(
  block: ProviderBlock,
  options: ProviderBlockCopyOptions = {},
): string {
  const label = providerBlockLabel(block.provider);
  const retryAfter = block.nextRetryAt
    ? `${formatProviderBlockRetryAt(block.nextRetryAt)} 이후까지 기다린 다음`
    : null;
  switch (block.reason) {
    case "mcp_auth_required":
      return `Worker 컴퓨터를 관리하는 담당자가 ${label}의 MCP 또는 플러그인 설정에서 ${
        block.serverNames?.join(", ") || "필요한 서버"
      } 연결을 다시 인증하고 인증됨으로 표시되는지 확인한 다음, Briar 이슈 화면에서 재시도를 눌러 실행이 다시 시작되는지 확인해 주세요.`;
    case "usage_exhausted":
      return `프로젝트 또는 이슈의 실행 provider나 모델을 사용량이 남은 것으로 변경하거나 ${
        retryAfter ?? `${label} 사용량이 초기화될 때까지 기다린 다음`
      }, Briar 이슈 화면에서 재시도를 눌러 새 실행이 시작되는지 확인해 주세요.`;
    case "free_tier_limit":
      return `프로젝트 또는 이슈의 실행 모델을 사용 가능한 모델로 변경하거나 ${
        retryAfter ?? `${label} 요금제를 활성화한 다음`
      }, Briar 이슈 화면에서 재시도를 눌러 새 실행이 시작되는지 확인해 주세요.`;
    case "upstream_overloaded":
      return "잠시 기다린 뒤 Briar 이슈 화면에서 재시도를 누르거나, 프로젝트 또는 이슈의 실행 모델을 다른 사용 가능한 모델로 변경한 뒤 새 실행이 시작되는지 확인해 주세요.";
    case "auth_required":
      return `Worker 컴퓨터를 관리하는 담당자가 그 컴퓨터에서 ${label} CLI에 다시 로그인해 인증됨으로 표시되는지 확인한 다음, Briar 이슈 화면에서 재시도를 눌러 실행이 다시 시작되는지 확인해 주세요.`;
    case "billing_required":
      return `${label} 계정 관리자가 요금제, 결제 수단 또는 크레딧을 확인해 문제를 해결한 다음, Briar 이슈 화면에서 재시도를 눌러 새 실행이 시작되는지 확인해 주세요.`;
    case "context_window_exceeded":
      return "이슈 내용이나 첨부를 줄이거나 컨텍스트가 더 큰 모델로 실행 모델을 변경한 다음, Briar 이슈 화면에서 재시도를 눌러 새 실행이 시작되는지 확인해 주세요.";
    case "model_unavailable":
      return `프로젝트 또는 이슈의 실행 모델을 ${label}에서 사용할 수 있는 모델로 변경한 다음, Briar 이슈 화면에서 재시도를 눌러 새 실행이 시작되는지 확인해 주세요.`;
  }
}

/** Blocked-run summary for a nontechnical reader; the work is preserved. */
export function providerBlockRunSummary(
  block: ProviderBlock,
  options: ProviderBlockCopyOptions = {},
): string {
  if (block.reason === "mcp_auth_required") {
    return `${
      providerBlockHeadline(block, options)
    } 실행을 안전하게 멈췄습니다. 전체 실패로 처리하지 않았으며 현재까지의 코드와 작업 기록은 worktree에 보존됩니다.`;
  }
  return `${
    providerBlockHeadline(block, options)
  } 작업이 완료되지 않았으며 현재까지의 변경 사항은 worktree에 보존됩니다.${
    providerBlockRetryHint(block)
  }`;
}

/** What a channel, DM, or issue-conversation reader sees instead of a reply. */
export function providerBlockReplyMessage(
  block: ProviderBlock,
  options: ProviderBlockCopyOptions = {},
): string {
  const label = providerBlockLabel(block.provider);
  const headline = providerBlockHeadline(block, options);
  switch (providerBlockRecovery(block.reason)) {
    case "wait":
      return `${headline} 답변을 생성하지 못했습니다.${
        providerBlockRetryHint(block)
      } 잠시 후 다시 요청하거나 다른 provider의 Agent를 사용해 주세요.`;
    case "machine":
      return `${headline} 답변을 생성하지 못했습니다. Worker 컴퓨터에서 ${label} 설정을 확인한 뒤 다시 요청해 주세요.`;
    case "request":
      return `${headline} 답변을 생성하지 못했습니다. 요청 내용을 줄이거나 다른 모델의 Agent를 사용해 다시 요청해 주세요.`;
  }
}

/** Technical detail kept under "View details" and in logs. */
export function providerBlockDetail(
  block: ProviderBlock,
  options: ProviderBlockCopyOptions = {},
): string {
  const label = providerBlockLabel(block.provider);
  const lead = block.reason === "mcp_auth_required"
    ? `${label} required MCP authentication; servers=${
      block.serverNames?.join(", ") ?? ""
    }; `
    : block.reason === "upstream_overloaded"
      ? `${label} upstream returned transient HTTP ${block.statusCode ?? "5xx"}; `
      : `${label} session entered retry/${block.reason}; `;
  return `${lead}provider=${block.provider}, model=${
    options.model?.trim() || "provider default"
  }, providerMessage=${block.message}` +
    (block.nextRetryAt ? `, nextRetryAt=${block.nextRetryAt}` : "") +
    (block.statusCode !== undefined && block.reason !== "upstream_overloaded"
      ? `, statusCode=${block.statusCode}`
      : "") +
    (block.providerCode ? `, providerCode=${block.providerCode}` : "");
}

export function providerBlockProviderName(
  block: ProviderBlock,
): AgentProvider | null {
  return block.provider in agentProviderLabels
    ? (block.provider as AgentProvider)
    : null;
}
