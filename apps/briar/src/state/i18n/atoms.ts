import * as Atom from "effect/unstable/reactivity/Atom";

import { ko, type Messages } from "../../i18n/messages";
import { localeTags, type Locale } from "../../i18n/locale";
import type { AtomRegistry } from "../registry";

/*
  The locale, where registry-bound code can read it.

  `I18nProvider` owns the locale and the catalogs: the strings are one chunk per
  locale, loaded on demand, so "the translator for locale X" is not a pure
  function of X until that chunk has been evaluated. React context is where the
  provider publishes it, and a subscription atom has no context.

  So the provider publishes here too — one write per settled locale, from an
  effect — and the atoms below derive from that. It is the shape F3's activity
  publisher established for the same reason: the thing that *runs* and the thing
  that *reads* live in different places, so a hook mounted once puts the value
  where the readers are.

  What reads it: `state/status-tray`, whose snapshot is localized and pushed to
  Rust with no view in between. Views keep using `useI18n()` — they are already
  under the provider, and the context re-render is the one they want.
*/

/** A locale together with the catalog that is actually loaded for it. */
export interface LocaleCatalog {
  readonly locale: Locale;
  readonly messages: Messages;
}

/**
 * The locale on screen and its strings. Korean is the default and the fallback
 * for missing keys, so it is what this holds before the provider has published.
 */
export const localeCatalogAtom = Atom.make<LocaleCatalog>({
  locale: "ko",
  messages: ko,
}).pipe(Atom.keepAlive, Atom.withLabel("i18n/catalog"));

/** The locale the account is reading in. */
export const localeAtom = Atom.map(
  localeCatalogAtom,
  (catalog) => catalog.locale,
).pipe(Atom.keepAlive, Atom.withLabel("i18n/locale"));

/** The BCP 47 tag of {@link localeAtom}, for `Intl` and `document.lang`. */
export const localeTagAtom = Atom.map(
  localeAtom,
  (locale) => localeTags[locale],
).pipe(Atom.keepAlive, Atom.withLabel("i18n/localeTag"));

type Variables = Record<string, string | number>;

/** The same signature `useI18n().t` has. */
export type Translate = (key: keyof Messages, variables?: Variables) => string;

const interpolate = (message: string, variables?: Variables) =>
  message.replace(/\{([a-zA-Z0-9_]+)\}/gu, (_, key: string) =>
    variables?.[key] === undefined ? `{${key}}` : String(variables[key]),
  );

/**
 * `t` for the loaded catalog, missing keys falling back to Korean — the same
 * rule `i18n/index.tsx` applies, and the same function it hands to views.
 */
export const translatorAtom = Atom.map(
  localeCatalogAtom,
  (catalog): Translate =>
    (key, variables) =>
      interpolate(catalog.messages[key] ?? ko[key] ?? key, variables),
).pipe(Atom.keepAlive, Atom.withLabel("i18n/translate"));

/**
 * Publishes the catalog the provider has settled on. Called from the provider's
 * effect; a write of the catalog already held notifies nobody.
 */
export function publishLocaleCatalog(
  registry: AtomRegistry,
  catalog: LocaleCatalog,
): void {
  const current = registry.get(localeCatalogAtom);
  if (
    current.locale === catalog.locale &&
    current.messages === catalog.messages
  ) {
    return;
  }
  registry.set(localeCatalogAtom, catalog);
}
