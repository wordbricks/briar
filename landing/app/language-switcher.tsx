"use client";

import { localeCookieName, type Locale } from "./i18n";

type LanguageSwitcherProps = {
  locale: Locale;
  label: string;
  englishLabel: string;
  koreanLabel: string;
};

export function LanguageSwitcher({
  locale,
  label,
  englishLabel,
  koreanLabel,
}: LanguageSwitcherProps) {
  function changeLanguage(nextLocale: Locale) {
    if (nextLocale === locale) {
      return;
    }

    document.cookie = `${localeCookieName}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.location.reload();
  }

  return (
    <div className="language-switcher" aria-label={label} role="group">
      <span aria-hidden="true">◎</span>
      <button
        type="button"
        className={locale === "en" ? "is-active" : undefined}
        aria-pressed={locale === "en"}
        aria-label={englishLabel}
        onClick={() => changeLanguage("en")}
      >
        EN
      </button>
      <i aria-hidden="true" />
      <button
        type="button"
        className={locale === "ko" ? "is-active" : undefined}
        aria-pressed={locale === "ko"}
        aria-label={koreanLabel}
        onClick={() => changeLanguage("ko")}
      >
        KO
      </button>
    </div>
  );
}
