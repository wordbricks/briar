import {
  SettingsAlert,
  SettingsCard,
  SettingsNote,
  SettingsSection,
  SettingsToggleRow,
} from "@/components/settings";
import { useI18n } from "../i18n";

export function ProjectTabsSettings({
  canEdit,
  error,
  onScheduleChange,
  saved,
  saving,
  scheduleEnabled,
}: {
  canEdit: boolean;
  error: string | null;
  onScheduleChange: (enabled: boolean) => void;
  saved: boolean;
  saving: boolean;
  scheduleEnabled: boolean;
}) {
  const { t } = useI18n();

  return (
    <SettingsSection>
      <SettingsCard
        aria-busy={saving}
        className="[&>div+div]:border-t [&>div+div]:border-border/80"
        data-project-settings-panel="tabs"
      >
        <SettingsToggleRow
          checked
          description={t("settings.tabsIssuesDescription")}
          disabled
          label={t("sidebar.issues")}
          onCheckedChange={() => undefined}
          title={`${t("sidebar.issues")} · ${t("common.required")}`}
        />
        <SettingsToggleRow
          checked
          description={t("settings.tabsAgentsDescription")}
          disabled
          label={t("sidebar.agents")}
          onCheckedChange={() => undefined}
          title={`${t("sidebar.agents")} · ${t("common.required")}`}
        />
        <SettingsToggleRow
          checked={scheduleEnabled}
          description={t("settings.tabsScheduleDescription")}
          disabled={!canEdit || saving}
          label={t("sidebar.schedule")}
          onCheckedChange={onScheduleChange}
          title={t("sidebar.schedule")}
        />
      </SettingsCard>
      {error ? <SettingsAlert>{error}</SettingsAlert> : null}
      {saved && !error ? (
        <SettingsNote>{t("settings.tabsSaved")}</SettingsNote>
      ) : null}
      {!canEdit ? (
        <SettingsNote>{t("settings.tabsPermission")}</SettingsNote>
      ) : null}
    </SettingsSection>
  );
}
