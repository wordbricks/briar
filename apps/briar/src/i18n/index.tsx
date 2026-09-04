import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  ko,
  loadedLocaleMessages,
  loadLocaleMessages,
  type MessageKey,
  type Messages,
} from "./messages";
import { localeTags, type Locale } from "./locale";
import { useRegistry } from "../state/registry";
import { publishLocaleCatalog } from "../state/i18n/atoms";

export { localeTags, type Locale } from "./locale";
export { loadLocaleMessages } from "./messages";
type Variables = Record<string, string | number>;
type Translate = (key: MessageKey, variables?: Variables) => string;

const storageKey = "briar.locale.v1";

const interpolate = (message: string, variables?: Variables) =>
  message.replace(/\{([a-zA-Z0-9_]+)\}/gu, (_, key: string) =>
    variables?.[key] === undefined ? `{${key}}` : String(variables[key]),
  );

const translate = (messages: Messages): Translate => (key, variables) =>
  interpolate(messages[key] ?? ko[key] ?? key, variables);

const defaultValue = {
  locale: "ko" as Locale,
  localeTag: localeTags.ko,
  setLocale: (_locale: Locale) => {},
  t: translate(ko),
};

export const I18nContext = createContext(defaultValue);

export const detectLocale = (): Locale => {
  if (typeof window === "undefined") return "ko";
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(storageKey);
  } catch {
    // Locale detection still works when persistence is unavailable.
  }
  if (stored === "ko" || stored === "en" || stored === "zh") return stored;
  const language = window.navigator.language.toLowerCase();
  if (language.startsWith("ko")) return "ko";
  if (language.startsWith("zh")) return "zh";
  return "en";
};

type LoadedMessages = { locale: Locale; messages: Messages };

export function I18nProvider({
  children,
  initial,
}: {
  children: React.ReactNode;
  /** Locale resolved before the first render, with its messages already loaded. */
  initial?: LoadedMessages;
}) {
  const registry = useRegistry();
  const [locale, setLocale] = useState<Locale>(() => initial?.locale ?? detectLocale());
  const [loaded, setLoaded] = useState<LoadedMessages>(() => {
    if (initial) return initial;
    const messages = loadedLocaleMessages(locale);
    return messages ? { locale, messages } : { locale: "ko", messages: ko };
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, locale);
    } catch {
      // Keep the in-memory locale when storage is unavailable.
    }
    document.documentElement.lang = localeTags[locale];
  }, [locale]);

  useEffect(() => {
    if (loaded.locale === locale) return;
    let active = true;
    void loadLocaleMessages(locale).then(
      (messages) => {
        // Keep the previous locale's strings on screen until the swap lands.
        if (active) setLoaded({ locale, messages });
      },
      (error: unknown) => {
        console.error(`Failed to load the ${locale} messages`, error);
      },
    );
    return () => {
      active = false;
    };
  }, [locale, loaded.locale]);

  /*
    Registry bound code has no React context, and the macOS tray's snapshot is
    localized with no view in between. The loaded catalog is published to
    `state/i18n` so a subscription atom can build the same `t`; the locale it
    carries is the settled one, so the tray and the screen never disagree while
    a chunk is still loading.
  */
  useEffect(() => {
    publishLocaleCatalog(registry, loaded);
  }, [loaded, registry]);

  const value = useMemo(
    () => ({ locale, localeTag: localeTags[locale], setLocale, t: translate(loaded.messages) }),
    [locale, loaded],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
