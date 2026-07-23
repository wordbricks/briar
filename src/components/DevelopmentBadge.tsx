import { useI18n } from "../i18n";

export function DevelopmentBadge() {
  const { t } = useI18n();

  return (
    <div className="development-badge" aria-label={t("app.developmentBadge")}>
      <i aria-hidden="true" />
      {t("app.developmentBadge")}
    </div>
  );
}
