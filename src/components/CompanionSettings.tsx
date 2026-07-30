import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Bell,
  Check,
  Languages,
  Palette,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
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
import { AppearanceSettings } from "./AppearanceSettings";
import { InboxNotificationSettings } from "./InboxNotificationSettings";

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
    <main className="companion-settings flex h-full min-h-0 flex-col overflow-auto bg-background px-5 pb-[max(28px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))]">
      <header className="mb-6 flex items-center gap-2">
        <Button
          aria-label={t("navigation.back")}
          className="size-10 shrink-0"
          onClick={onBack}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowLeft aria-hidden="true" size={21} />
        </Button>
        <Typography as="h1" variant="heading">
          {t("account.settings")}
        </Typography>
      </header>

      <section className="mb-7 grid gap-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <UserRound aria-hidden="true" size={19} />
          <Typography as="h2" variant="bodyLg">
            {t("companion.settingsAccount")}
          </Typography>
        </div>
        <Card>
          <CardContent className="grid gap-1 p-4">
            <Typography as="strong" variant="body">
              {user.name || user.email}
            </Typography>
            <Typography as="small" tone="muted" variant="caption">
              {user.email}
            </Typography>
          </CardContent>
        </Card>
      </section>

      <section className="mb-7 grid gap-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Palette aria-hidden="true" size={19} />
          <Typography as="h2" variant="bodyLg">
            {t("appSettings.appearance")}
          </Typography>
        </div>
        <Typography tone="muted" variant="bodySm">
          {t("appSettings.themeDescription")}
        </Typography>
        <AppearanceSettings compact />
      </section>

      <section className="mb-7 grid gap-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Palette aria-hidden="true" size={19} />
          <Typography as="h2" variant="bodyLg">
            {t("companion.appIcon")}
          </Typography>
        </div>
        <Typography tone="muted" variant="bodySm">
          {t("companion.appIconDescription")}
        </Typography>
        <div
          aria-busy={changingAppIcon}
          aria-label={t("companion.appIconMenu")}
          className="grid grid-cols-2 gap-2"
          role="radiogroup"
        >
          {appIcons.map((option) => {
            const selected = appIcon === option.icon;
            return (
              <button
                aria-checked={selected}
                className={cn(
                  "flex items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors",
                  selected
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border hover:bg-secondary",
                )}
                disabled={changingAppIcon}
                key={option.icon}
                onClick={() => void selectAppIcon(option.icon)}
                role="radio"
                type="button"
              >
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-10 rounded-lg"
                  src={option.image}
                />
                <span className="min-w-0 flex-1 text-sm font-medium">
                  {option.label}
                </span>
                {selected ? (
                  <Check aria-hidden="true" size={17} strokeWidth={2} />
                ) : null}
              </button>
            );
          })}
        </div>
        {appIconError ? (
          <Typography className="text-destructive" role="alert" variant="caption">
            {t("companion.appIconError")}
          </Typography>
        ) : null}
      </section>

      <section className="mb-7 grid gap-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Bell aria-hidden="true" size={19} />
          <Typography as="h2" variant="bodyLg">
            {t("notifications.title")}
          </Typography>
        </div>
        <Typography tone="muted" variant="bodySm">
          {t("notifications.description")}
        </Typography>
        <InboxNotificationSettings />
      </section>

      <section className="grid gap-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Languages aria-hidden="true" size={19} />
          <Typography as="h2" variant="bodyLg">
            {t("account.language")}
          </Typography>
        </div>
        <div
          aria-label={t("account.languageMenu")}
          className="grid gap-2"
          role="radiogroup"
        >
          {languages.map((language) => {
            const selected = locale === language.locale;
            return (
              <button
                aria-checked={selected}
                className={cn(
                  "flex h-12 items-center justify-between rounded-xl border bg-card px-4 text-left text-sm font-medium transition-colors",
                  selected
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border hover:bg-secondary",
                )}
                key={language.locale}
                lang={language.locale}
                onClick={() => setLocale(language.locale)}
                role="radio"
                type="button"
              >
                <span>{language.label}</span>
                {selected ? (
                  <Check aria-hidden="true" size={17} strokeWidth={2} />
                ) : null}
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}
