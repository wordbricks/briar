import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { en, ko, zh, type MessageKey, type Messages } from "./messages";
import { localeTags, type Locale } from "./locale";

export { localeTags, type Locale } from "./locale";
type Variables = Record<string, string | number>;
type Translate = (key: MessageKey, variables?: Variables) => string;

const storageKey = "briar.locale.v1";
const resources = { ko, en, zh } satisfies Record<Locale, Messages>;

const interpolate = (message: string, variables?: Variables) =>
  message.replace(/\{([a-zA-Z0-9_]+)\}/gu, (_, key: string) =>
    variables?.[key] === undefined ? `{${key}}` : String(variables[key]),
  );

const translate = (locale: Locale): Translate => (key, variables) =>
  interpolate(resources[locale][key] ?? ko[key] ?? key, variables);

const defaultValue = {
  locale: "ko" as Locale,
  localeTag: localeTags.ko,
  setLocale: (_locale: Locale) => {},
  t: translate("ko"),
};

export const I18nContext = createContext(defaultValue);

const detectLocale = (): Locale => {
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

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(detectLocale);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, locale);
    } catch {
      // Keep the in-memory locale when storage is unavailable.
    }
    document.documentElement.lang = localeTags[locale];
  }, [locale]);

  const value = useMemo(
    () => ({ locale, localeTag: localeTags[locale], setLocale, t: translate(locale) }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
