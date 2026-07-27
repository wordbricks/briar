import { useEffect, useState } from "react";
import { ArrowLeft, Check, Languages, Palette, UserRound } from "lucide-react";
import iconGray from "../assets/app-icons/gray.png";
import iconGreen from "../assets/app-icons/green.png";
import iconPink from "../assets/app-icons/pink.png";
import iconPurple from "../assets/app-icons/purple.png";
import { useI18n, type Locale } from "../i18n";
import {
  changeAppIcon,
  getCurrentAppIcon,
  type AppIconName,
} from "../lib/app-icon";
import type { SessionUser } from "../types";

export function CompanionSettings({
  onBack,
  user,
}: {
  onBack: () => void;
  user: SessionUser;
}) {
  const { locale, setLocale, t } = useI18n();
  const [appIcon, setAppIcon] = useState<AppIconName>("purple");
  const [changingAppIcon, setChangingAppIcon] = useState(false);
  const [appIconError, setAppIconError] = useState(false);
  const languages: Array<{ locale: Locale; label: string }> = [
    { locale: "ko", label: t("language.ko") },
    { locale: "en", label: t("language.en") },
    { locale: "zh", label: t("language.zh") },
  ];
  const appIcons: Array<{
    icon: AppIconName;
    image: string;
    label: string;
  }> = [
    { icon: "purple", image: iconPurple, label: t("companion.appIconPurple") },
    { icon: "gray", image: iconGray, label: t("companion.appIconGray") },
    { icon: "pink", image: iconPink, label: t("companion.appIconPink") },
    { icon: "green", image: iconGreen, label: t("companion.appIconGreen") },
  ];

  useEffect(() => {
    let active = true;
    void getCurrentAppIcon()
      .then((icon) => {
        if (active) setAppIcon(icon);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const selectAppIcon = async (icon: AppIconName) => {
    if (changingAppIcon || icon === appIcon) return;
    setChangingAppIcon(true);
    setAppIconError(false);
    try {
      await changeAppIcon(icon);
      setAppIcon(icon);
    } catch {
      setAppIconError(true);
    } finally {
      setChangingAppIcon(false);
    }
  };

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
          <Palette aria-hidden="true" size={19} />
          <h2>{t("companion.appIcon")}</h2>
        </div>
        <p className="companion-settings-description">
          {t("companion.appIconDescription")}
        </p>
        <div
          aria-busy={changingAppIcon}
          aria-label={t("companion.appIconMenu")}
          className="companion-settings-app-icons"
          role="radiogroup"
        >
          {appIcons.map((option) => (
            <button
              aria-checked={appIcon === option.icon}
              disabled={changingAppIcon}
              key={option.icon}
              onClick={() => void selectAppIcon(option.icon)}
              role="radio"
              type="button"
            >
              <img alt="" aria-hidden="true" src={option.image} />
              <span>{option.label}</span>
              {appIcon === option.icon ? (
                <Check aria-hidden="true" size={17} strokeWidth={2} />
              ) : null}
            </button>
          ))}
        </div>
        {appIconError ? (
          <p className="companion-settings-error" role="alert">
            {t("companion.appIconError")}
          </p>
        ) : null}
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
