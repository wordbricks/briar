import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  SettingsAlert,
  SettingsCard,
  SettingsNote,
  SettingsToggleRow,
} from "@/components/settings";
import { useI18n } from "../i18n";
import {
  defaultInboxNotificationPreferences,
  inboxNotificationCategories,
  inboxNotificationsEnabled,
  openInboxNotificationSystemSettings,
  readInboxNotificationPermissionStatus,
  readInboxNotificationPreferences,
  readInboxNotificationSoundPreference,
  recommendedInboxNotificationPreferences,
  requestInboxNotificationPermission,
  writeInboxNotificationPreferences,
  writeInboxNotificationSoundPreference,
  type InboxNotificationPermissionStatus,
  type InboxNotificationPreferences,
} from "../lib/inbox-notifications";
import type { InboxCategory } from "../hooks/useInbox";
import { isMacDesktopTauri } from "../lib/platform";

type InboxNotificationSettingsProps = {
  macDesktop?: boolean;
  openSystemSettings?: typeof openInboxNotificationSystemSettings;
  readPermissionStatus?: typeof readInboxNotificationPermissionStatus;
  requestPermission?: typeof requestInboxNotificationPermission;
};

export function InboxNotificationSettings({
  macDesktop = isMacDesktopTauri(),
  openSystemSettings = openInboxNotificationSystemSettings,
  readPermissionStatus = readInboxNotificationPermissionStatus,
  requestPermission = requestInboxNotificationPermission,
}: InboxNotificationSettingsProps = {}) {
  const { t } = useI18n();
  const [preferences, setPreferences] =
    useState<InboxNotificationPreferences>(
      readInboxNotificationPreferences,
    );
  const [savingPreference, setSavingPreference] = useState<
    InboxCategory | "master" | null
  >(null);
  const [permissionError, setPermissionError] = useState(false);
  const [permissionStatus, setPermissionStatus] =
    useState<InboxNotificationPermissionStatus | null>(null);
  const [playSound, setPlaySound] = useState(
    readInboxNotificationSoundPreference,
  );
  const notificationsEnabled = inboxNotificationsEnabled(preferences);

  const refreshPermissionStatus = useCallback(async () => {
    if (!macDesktop) return;
    try {
      setPermissionStatus(await readPermissionStatus());
    } catch {
      setPermissionStatus("unsupported");
    }
  }, [macDesktop, readPermissionStatus]);

  useEffect(() => {
    if (!macDesktop) return;
    void refreshPermissionStatus();
    const refreshOnFocus = () => void refreshPermissionStatus();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [macDesktop, refreshPermissionStatus]);

  const persistPreferences = (next: InboxNotificationPreferences) => {
    writeInboxNotificationPreferences(next);
    setPreferences(next);
  };

  const toggleMaster = async (enabled: boolean) => {
    if (savingPreference) return;
    setSavingPreference("master");
    setPermissionError(false);
    try {
      if (enabled && !(await requestPermission())) {
        setPermissionError(true);
        return;
      }
      persistPreferences(
        enabled
          ? recommendedInboxNotificationPreferences()
          : defaultInboxNotificationPreferences(),
      );
    } catch {
      setPermissionError(true);
    } finally {
      setSavingPreference(null);
      await refreshPermissionStatus();
    }
  };

  const toggleCategory = async (
    category: InboxCategory,
    enabled: boolean,
  ) => {
    if (savingPreference) return;
    setSavingPreference(category);
    setPermissionError(false);
    try {
      if (enabled && !(await requestPermission())) {
        setPermissionError(true);
        return;
      }
      const next = { ...preferences, [category]: enabled };
      writeInboxNotificationPreferences(next);
      setPreferences(next);
    } catch {
      setPermissionError(true);
    } finally {
      setSavingPreference(null);
      await refreshPermissionStatus();
    }
  };

  const permissionStatusDescription = permissionStatus === "authorized"
    ? t("notifications.permission.authorized")
    : permissionStatus === "denied"
    ? t("notifications.permission.denied")
    : permissionStatus === "not_determined"
    ? t("notifications.permission.notDetermined")
    : permissionStatus === "unsupported"
    ? t("notifications.permission.unavailable")
    : t("notifications.permission.checking");

  const soundToggle = (
    <SettingsToggleRow
      checked={playSound}
      description={t("notifications.playSound.description")}
      disabled={
        savingPreference !== null || (macDesktop && !notificationsEnabled)
      }
      label={t("notifications.playSound")}
      onCheckedChange={(enabled) => {
        writeInboxNotificationSoundPreference(enabled);
        setPlaySound(enabled);
      }}
      title={t("notifications.playSound")}
    />
  );

  return (
    <>
      {macDesktop ? (
        <SettingsCard
          aria-busy={savingPreference !== null}
          className="mb-4"
        >
          <SettingsToggleRow
            checked={notificationsEnabled}
            description={t("notifications.system.description")}
            disabled={savingPreference !== null}
            label={t("notifications.system")}
            onCheckedChange={(enabled) => void toggleMaster(enabled)}
            title={t("notifications.system")}
          />
        </SettingsCard>
      ) : null}
      {macDesktop ? (
        <SettingsCard className="mb-4">
          <div
            aria-live="polite"
            className="grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-[18px] py-4"
          >
            <div className="grid min-w-0 gap-1">
              <strong className="text-sm font-medium">
                {t("notifications.permission.title")}
              </strong>
              <p className="text-xs text-muted-foreground">
                {permissionStatusDescription}
              </p>
            </div>
            {permissionStatus === "authorized" ||
                permissionStatus === "denied"
              ? (
                <Button
                  onClick={() => {
                    void openSystemSettings().catch(() => {
                      setPermissionError(true);
                    });
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {t("notifications.openSystemSettings")}
                </Button>
              )
              : null}
          </div>
        </SettingsCard>
      ) : null}
      <SettingsCard
        aria-busy={savingPreference !== null}
        className="[&>div+div]:border-t [&>div+div]:border-border/80"
      >
        {!macDesktop ? soundToggle : null}
        {inboxNotificationCategories.map((category) => (
          <SettingsToggleRow
            checked={preferences[category]}
            description={t(`notifications.category.${category}.description`)}
            disabled={
              savingPreference !== null || (macDesktop && !notificationsEnabled)
            }
            key={category}
            label={t(`notifications.category.${category}`)}
            onCheckedChange={(enabled) =>
              void toggleCategory(category, enabled)
            }
            title={t(`notifications.category.${category}`)}
          />
        ))}
        {macDesktop ? soundToggle : null}
      </SettingsCard>
      {permissionError ? (
        <SettingsAlert>{t("notifications.permissionDenied")}</SettingsAlert>
      ) : null}
      <SettingsNote>{t("notifications.note")}</SettingsNote>
    </>
  );
}
