import {
  providerBlockMarksProviderUnhealthy,
  type ProviderBlock,
} from "../src/lib/provider-block";
import type { AgentProvider } from "../src/lib/agent-provider";
import { clearProviderUsageCache } from "./provider-usage";

/**
 * Blocks the Worker observed at run time, per provider account on this
 * machine. The periodic quota probe is cached for minutes and cannot see
 * every provider's limits, so a `usage_exhausted` frame from a runner is the
 * fastest and most reliable signal that this machine must stop claiming work
 * for that provider. The next heartbeat reads the registry through
 * `inspectWorkerProviderHealth` and the server routes around the Worker.
 */

export type ActiveProviderBlock = {
  block: ProviderBlock;
  recordedAt: string;
  /** ISO instant after which the block no longer overrides the probe. */
  until: string;
};

/** How long a block without a provider-announced reset keeps the provider offline. */
export const DEFAULT_PROVIDER_BLOCK_HOLD_MS = 30 * 60_000;
/** A provider-announced reset is honored up to this far ahead. */
export const MAX_PROVIDER_BLOCK_HOLD_MS = 24 * 60 * 60_000;
/** Blocks a person must clear are re-checked by the normal probe after this. */
export const MACHINE_PROVIDER_BLOCK_HOLD_MS = 10 * 60_000;

const registry = new Map<AgentProvider, ActiveProviderBlock>();

export function providerBlockHoldUntil(
  block: ProviderBlock,
  now: number,
): string {
  const announced = block.nextRetryAt ? Date.parse(block.nextRetryAt) : Number.NaN;
  if (Number.isFinite(announced) && announced > now) {
    return new Date(Math.min(announced, now + MAX_PROVIDER_BLOCK_HOLD_MS))
      .toISOString();
  }
  const hold = block.reason === "auth_required" ||
      block.reason === "billing_required"
    ? MACHINE_PROVIDER_BLOCK_HOLD_MS
    : DEFAULT_PROVIDER_BLOCK_HOLD_MS;
  return new Date(now + hold).toISOString();
}

/**
 * Remember a block for the provider account that produced it. Returns the
 * registry entry, or null when the block does not concern this machine's
 * provider account (a transient overload, or a request that must change).
 */
export function recordProviderBlock(
  provider: AgentProvider,
  block: ProviderBlock,
  now: () => number = Date.now,
): ActiveProviderBlock | null {
  if (!providerBlockMarksProviderUnhealthy(block.reason)) return null;
  const current = now();
  const entry: ActiveProviderBlock = {
    block,
    recordedAt: new Date(current).toISOString(),
    until: providerBlockHoldUntil(block, current),
  };
  registry.set(provider, entry);
  // The cached probe result predates the block; let the next heartbeat read
  // the provider's quota again once the hold ends.
  clearProviderUsageCache();
  return entry;
}

export function activeProviderBlock(
  provider: AgentProvider,
  now: () => number = Date.now,
): ActiveProviderBlock | null {
  const entry = registry.get(provider);
  if (!entry) return null;
  if (Date.parse(entry.until) <= now()) {
    registry.delete(provider);
    return null;
  }
  return entry;
}

export function clearProviderBlocks(provider?: AgentProvider) {
  if (provider) registry.delete(provider);
  else registry.clear();
}
