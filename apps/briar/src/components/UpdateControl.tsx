import { CircleAlert, Download } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useI18n } from "../i18n";
import { useAppUpdate } from "./AppUpdateProvider";

export function UpdateControl() {
  const { t } = useI18n();
  const {
    available,
    installError,
    installUpdate,
    isInstalling,
    supported,
  } = useAppUpdate();

  if (!supported || !available) return null;

  const buttonLabel = isInstalling
    ? t("update.installingLabel")
    : t("update.install", { version: available.version });

  return (
    <div className="sidebar-update-control">
      {installError && (
        <div className="sidebar-update-feedback error" role="status">
          <CircleAlert size={13} />
          <span>{t("update.failed", { error: installError })}</span>
        </div>
      )}
      <button
        aria-label={buttonLabel}
        className={`sidebar-update-trigger ${isInstalling ? "is-installing" : "is-available"}`}
        disabled={isInstalling}
        onClick={() => void installUpdate()}
        title={buttonLabel}
        type="button"
      >
        {isInstalling
          ? <Spinner aria-hidden="true" className="size-[14px]" />
          : <Download aria-hidden="true" size={14} />}
      </button>
    </div>
  );
}
