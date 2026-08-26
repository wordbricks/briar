import { useI18n } from "../i18n";

export function DevelopmentBadge() {
  const { t } = useI18n();

  return (
    <div className="development-badge">
      <i aria-hidden="true" />
      {t("app.developmentBadge")}
    </div>
  );
}
