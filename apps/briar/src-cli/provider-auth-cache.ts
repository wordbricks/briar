/**
 * One auth spawn per provider per probe round.
 *
 * Checking whether a provider CLI is signed in means spawning it (`agy
 * --output-format json models`, `claude auth status`, `cursor about`), and the
 * worker asks twice per round: once through `inspectWorkerProviderHealth` and
 * again inside the usage loader for the same provider. On a machine running
 * three Worker services that showed up as 10-12 `agy` language-server launches
 * a minute. Both callers go through this cache, so the second one reuses the
 * first one's answer.
 *
 * The window is deliberately short - well under the 5-minute usage cache - so a
 * sign-in or a sign-out is still noticed within a probe round or two.
 */

export const PROVIDER_AUTH_CACHE_TTL_MS = 60_000;

type CacheEntry = {
  expiresAt: number;
  result: Promise<boolean>;
};

const cache = new Map<string, CacheEntry>();

export type ProviderAuthCacheOptions = {
  now?: () => number;
  ttlMs?: number;
};

/**
 * Run `check` unless the same `key` was checked within the TTL. In-flight
 * checks are shared, so two callers racing on the same key spawn once.
 */
export function cachedProviderAuthentication(
  key: string,
  check: () => Promise<boolean>,
  { now = Date.now, ttlMs = PROVIDER_AUTH_CACHE_TTL_MS }: ProviderAuthCacheOptions = {},
): Promise<boolean> {
  const at = now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > at) return cached.result;
  const result = check().catch((error: unknown) => {
    // A thrown check is not an answer; drop it so the next caller retries.
    cache.delete(key);
    throw error;
  });
  cache.set(key, { expiresAt: at + ttlMs, result });
  return result;
}

export function clearProviderAuthenticationCache() {
  cache.clear();
}
