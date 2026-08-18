"use client";

import { localeCookieName, type Locale } from "./i18n";

type LanguageSwitcherProps = {
  locale: Locale;
  label: string;
  englishLabel: string;
  koreanLabel: string;
  chineseLabel: string;
  /** The real, crawlable URL for this page in each locale. */
  hrefs: Record<Locale, string>;
};

export function LanguageSwitcher({
  locale,
  label,
  englishLabel,
  koreanLabel,
  chineseLabel,
  hrefs,
}: LanguageSwitcherProps) {
  function changeLanguage(nextLocale: Locale) {
    if (nextLocale === locale) {
      return;
    }

    // Remember the choice so a future visit to an unprefixed (English) URL
    // convenience-redirects straight to this locale (see proxy.ts) — but
    // the navigation below is what actually reaches the language; the
    // cookie is never the only way to get there.
    document.cookie = `${localeCookieName}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.location.href = hrefs[nextLocale];
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
      <i aria-hidden="true" />
      <button
        type="button"
        className={locale === "zh" ? "is-active" : undefined}
        aria-pressed={locale === "zh"}
        aria-label={chineseLabel}
        onClick={() => changeLanguage("zh")}
      >
        ZH
      </button>
    </div>
  );
}
