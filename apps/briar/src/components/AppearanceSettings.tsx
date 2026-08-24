import { Check, Laptop, Moon, Sun } from "lucide-react";

import {
  SettingsCard,
  SettingsGroupHeading,
  SettingsSection,
} from "@/components/settings";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n";
import {
  themePreferences,
  useTheme,
  type ThemePreference,
} from "../theme";

const themeIcons = {
  system: Laptop,
  light: Sun,
  dark: Moon,
} satisfies Record<ThemePreference, typeof Sun>;

export function AppearanceSettings({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { t } = useI18n();
  const { setTheme, theme } = useTheme();
  const labels = {
    system: t("appSettings.themeSystem"),
    light: t("appSettings.themeLight"),
    dark: t("appSettings.themeDark"),
  } satisfies Record<ThemePreference, string>;

  const choices = (
    <div
      aria-label={t("appSettings.theme")}
      className={cn(
        "grid gap-3",
        compact ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-3",
      )}
      role="radiogroup"
    >
      {themePreferences.map((option) => {
        const Icon = themeIcons[option];
        const selected = theme === option;
        return (
          <button
            aria-checked={selected}
            className={cn(
              "group grid min-w-0 gap-3 rounded-xl border p-3 text-left transition-colors",
              selected
                ? "border-primary bg-accent text-accent-foreground"
                : "border-border bg-card text-foreground hover:bg-secondary",
            )}
            key={option}
            onClick={() => setTheme(option)}
            role="radio"
            type="button"
          >
            <span
              aria-hidden="true"
              className={cn(
                "relative block aspect-[1.45/1] overflow-hidden rounded-lg border",
                option === "dark"
                  ? "border-[#34343b] bg-[#161618]"
                  : "border-[#dedfd9] bg-[#f7f7f3]",
              )}
            >
              <span
                className={cn(
                  "absolute inset-y-0 left-0 w-[29%] border-r",
                  option === "dark"
                    ? "border-[#2a2a30] bg-[#1e1e22]"
                    : "border-[#e3e4dd] bg-[#f0f0ec]",
                )}
              />
              <span
                className={cn(
                  "absolute left-[37%] right-[8%] top-[20%] h-[12%] rounded-full",
                  option === "dark" ? "bg-[#f2f2ef]" : "bg-[#30312d]",
                )}
              />
              <span
                className={cn(
                  "absolute bottom-[18%] left-[37%] right-[8%] top-[42%] rounded",
                  option === "dark" ? "bg-[#242428]" : "bg-white",
                )}
              />
              {option === "system" ? (
                <span className="absolute inset-y-0 right-0 w-1/2 bg-[#161618] opacity-90 [clip-path:polygon(45%_0,100%_0,100%_100%,0_100%)]" />
              ) : null}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              <Typography
                as="strong"
                className="min-w-0 flex-1 truncate"
                variant="bodySm"
              >
                {labels[option]}
              </Typography>
              {selected ? (
                <Check aria-hidden="true" className="size-4 shrink-0" />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );

  if (compact) return choices;

  return (
    <SettingsSection>
      <SettingsGroupHeading title={t("appSettings.theme")} />
      <SettingsCard className="p-4">{choices}</SettingsCard>
      <Typography className="mt-3.5" tone="muted" variant="caption">
        {t("appSettings.themeDescription")}
      </Typography>
    </SettingsSection>
  );
}
