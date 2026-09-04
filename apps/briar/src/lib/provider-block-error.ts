import * as Schema from "effect/Schema";
import type { MessageKey } from "../i18n/messages";
import {
  formatProviderBlockRetryAt,
  providerBlockLabel,
  providerBlockReasons,
  type ProviderBlock,
  type ProviderBlockReason,
} from "./provider-block";

/**
 * Desktop Tauri commands return `Result<_, String>`, so the Rust sidecar
 * carries a provider block as this prefix followed by the block's JSON
 * (`agent::PROVIDER_BLOCKED_ERROR_PREFIX`). The frontend reads the structure
 * back here and renders it in the reader's language instead of echoing the
 * provider's text.
 */
export const providerBlockedErrorPrefix = "BRIAR_PROVIDER_BLOCKED: ";

const ProviderBlockJson = Schema.Struct({
  reason: Schema.Literals(providerBlockReasons as readonly [
    ProviderBlockReason,
    ...ProviderBlockReason[],
  ]),
  provider: Schema.String,
  message: Schema.String,
  nextRetryAt: Schema.optional(Schema.NullOr(Schema.String)),
  statusCode: Schema.optional(Schema.Int),
  providerCode: Schema.optional(Schema.String),
  serverNames: Schema.optional(Schema.Array(Schema.String)),
});

const decodeProviderBlockJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(ProviderBlockJson),
);

export function errorMessageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/** The block behind a thrown desktop error, or null for any other error. */
export function providerBlockFromError(caught: unknown): ProviderBlock | null {
  const message = errorMessageOf(caught).trim();
  if (!message.startsWith(providerBlockedErrorPrefix)) return null;
  const decoded = decodeProviderBlockJson(
    message.slice(providerBlockedErrorPrefix.length),
  );
  if (decoded._tag === "None") return null;
  const value = decoded.value;
  return {
    reason: value.reason,
    provider: value.provider,
    message: value.message,
    nextRetryAt: value.nextRetryAt ?? null,
    ...(value.statusCode !== undefined ? { statusCode: value.statusCode } : {}),
    ...(value.providerCode ? { providerCode: value.providerCode } : {}),
    ...(value.serverNames?.length ? { serverNames: [...value.serverNames] } : {}),
  };
}

export function isProviderBlockedError(caught: unknown): boolean {
  return providerBlockFromError(caught) !== null;
}

type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

/**
 * Localized sentence for a block, using the `providerBlock.*` messages. The
 * provider's own text stays available under `message` for a details view.
 */
export function providerBlockText(block: ProviderBlock, t: Translate): string {
  const values = {
    provider: providerBlockLabel(block.provider),
    servers: block.serverNames?.join(", ") ?? "",
  };
  const headline = t(`providerBlock.${block.reason}` as MessageKey, values);
  return block.nextRetryAt
    ? `${headline} ${t("providerBlock.retryAt", {
      provider: values.provider,
      time: formatProviderBlockRetryAt(block.nextRetryAt),
    })}`
    : headline;
}

/** A desktop error message for display: localized when it carries a block. */
export function describeDesktopError(caught: unknown, t: Translate): string {
  const block = providerBlockFromError(caught);
  return block ? providerBlockText(block, t) : errorMessageOf(caught);
}

export const agentUsageRefreshEvent = "briar:agent-usage-refresh";

/** Ask the usage status bar to re-read provider quotas right away. */
export function requestAgentUsageRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(agentUsageRefreshEvent));
}
