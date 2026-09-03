import type { Locale } from "../locale";
import { ko } from "./ko";
import type { Messages } from "./ko";

export { ko } from "./ko";
export type { MessageKey, Messages } from "./ko";

/**
 * Locales whose chunk has already been evaluated. `ko` is the default locale and
 * the fallback for missing keys, so it ships with the initial chunk.
 */
const loaded = new Map<Locale, Messages>([["ko", ko]]);

/** Messages for an already loaded locale, or `null` when its chunk is still pending. */
export const loadedLocaleMessages = (locale: Locale): Messages | null =>
  loaded.get(locale) ?? null;

/**
 * Loads a single locale bundle on demand so the initial chunk only carries the
 * default (`ko`) messages. Every locale resolves through a static `import()`
 * specifier, which lets the bundler emit one chunk per locale.
 */
export async function loadLocaleMessages(locale: Locale): Promise<Messages> {
  const cached = loaded.get(locale);
  if (cached) return cached;
  const messages =
    locale === "en" ? (await import("./en")).en : (await import("./zh")).zh;
  loaded.set(locale, messages);
  return messages;
}
