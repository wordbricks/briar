import { useI18n } from "../i18n";
import { APP_VERSION, formatAppVersionLabel } from "../lib/app-version";

export function AppVersionStatus({
  version = APP_VERSION,
}: {
  version?: string;
}) {
  const { t } = useI18n();
  const label = formatAppVersionLabel(version);

  return (
    <div
      aria-label={t("app.version", { version: label })}
      className="app-version-status"
      title={t("app.version", { version: label })}
    >
      <small>{label}</small>
    </div>
  );
}
