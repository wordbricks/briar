import { useI18n } from "@/i18n";

/** The issue list's column headers, shared by both lists that render rows. */
export function IssueListHeader() {
  const { t } = useI18n();
  return <div className="issue-list-grid issue-list-header" role="row">
      <span role="columnheader">{t("dashboard.task")}</span>
      <span role="columnheader">{t("dashboard.status")}</span>
      <span role="columnheader">{t("issue.priority")}</span>
      <span role="columnheader">{t("dashboard.updated")}</span>
      <span aria-hidden="true" />
    </div>;
}
