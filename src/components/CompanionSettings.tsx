import { ArrowLeft, Check, Languages, UserRound } from "lucide-react";
import { useI18n, type Locale } from "../i18n";
import type { SessionUser } from "../types";

export function CompanionSettings({
  onBack,
  user,
}: {
  onBack: () => void;
  user: SessionUser;
}) {
  const { locale, setLocale, t } = useI18n();
  const languages: Array<{ locale: Locale; label: string }> = [
    { locale: "ko", label: t("language.ko") },
    { locale: "en", label: t("language.en") },
    { locale: "zh", label: t("language.zh") },
  ];

  return (
    <main className="companion-settings">
      <header>
        <button
          aria-label={t("navigation.back")}
          onClick={onBack}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={21} />
        </button>
        <h1>{t("account.settings")}</h1>
      </header>
      <section>
        <div className="companion-settings-section-heading">
          <UserRound aria-hidden="true" size={19} />
          <h2>{t("companion.settingsAccount")}</h2>
        </div>
        <div className="companion-settings-identity">
          <strong>{user.name || user.email}</strong>
          <small>{user.email}</small>
        </div>
      </section>
      <section>
        <div className="companion-settings-section-heading">
          <Languages aria-hidden="true" size={19} />
          <h2>{t("account.language")}</h2>
        </div>
        <div
          aria-label={t("account.languageMenu")}
          className="companion-settings-language"
          role="radiogroup"
        >
          {languages.map((language) => (
            <button
              aria-checked={locale === language.locale}
              key={language.locale}
              lang={language.locale}
              onClick={() => setLocale(language.locale)}
              role="radio"
              type="button"
            >
              <span>{language.label}</span>
              {locale === language.locale ? (
                <Check aria-hidden="true" size={17} strokeWidth={2} />
              ) : null}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
