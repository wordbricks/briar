import { useState } from "react";

import {
  SettingsAlert,
  SettingsCard,
  SettingsNote,
  SettingsToggleRow,
} from "@/components/settings";
import { useI18n } from "../i18n";
import {
  inboxNotificationCategories,
  readInboxNotificationPreferences,
  readInboxNotificationSoundPreference,
  requestInboxNotificationPermission,
  writeInboxNotificationPreferences,
  writeInboxNotificationSoundPreference,
  type InboxNotificationPreferences,
} from "../lib/inbox-notifications";
import type { InboxCategory } from "../hooks/useInbox";

export function InboxNotificationSettings() {
  const { t } = useI18n();
  const [preferences, setPreferences] =
    useState<InboxNotificationPreferences>(
      readInboxNotificationPreferences,
    );
  const [savingCategory, setSavingCategory] =
    useState<InboxCategory | null>(null);
  const [permissionError, setPermissionError] = useState(false);
  const [playSound, setPlaySound] = useState(
    readInboxNotificationSoundPreference,
  );

  const toggleCategory = async (
    category: InboxCategory,
    enabled: boolean,
  ) => {
    if (savingCategory) return;
    setSavingCategory(category);
    setPermissionError(false);
    try {
      if (enabled && !(await requestInboxNotificationPermission())) {
        setPermissionError(true);
        return;
      }
      const next = { ...preferences, [category]: enabled };
      writeInboxNotificationPreferences(next);
      setPreferences(next);
    } catch {
      setPermissionError(true);
    } finally {
      setSavingCategory(null);
    }
  };

  return (
    <>
      <SettingsCard
        aria-busy={savingCategory !== null}
        className="[&>div+div]:border-t [&>div+div]:border-border/80"
      >
        <SettingsToggleRow
          checked={playSound}
          description={t("notifications.playSound.description")}
          label={t("notifications.playSound")}
          onCheckedChange={(enabled) => {
            writeInboxNotificationSoundPreference(enabled);
            setPlaySound(enabled);
          }}
          title={t("notifications.playSound")}
        />
        {inboxNotificationCategories.map((category) => (
          <SettingsToggleRow
            checked={preferences[category]}
            description={t(`notifications.category.${category}.description`)}
            disabled={savingCategory !== null}
            key={category}
            label={t(`notifications.category.${category}`)}
            onCheckedChange={(enabled) =>
              void toggleCategory(category, enabled)
            }
            title={t(`notifications.category.${category}`)}
          />
        ))}
      </SettingsCard>
      {permissionError ? (
        <SettingsAlert>{t("notifications.permissionDenied")}</SettingsAlert>
      ) : null}
      <SettingsNote>{t("notifications.note")}</SettingsNote>
    </>
  );
}
