import type { Update } from "@tauri-apps/plugin-updater";
import { CircleAlert, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../i18n";

type UpdateStatus = "idle" | "checking" | "current" | "available" | "installing";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function UpdateControl() {
  const { t } = useI18n();
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [available, setAvailable] = useState<Update | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isTauri()) return null;

  const checkForUpdate = async () => {
    setStatus("checking");
    setError(null);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      setAvailable(update);
      setStatus(update ? "available" : "current");
    } catch (caught) {
      setStatus("idle");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const installUpdate = async () => {
    if (!available) return;
    setStatus("installing");
    setError(null);
    try {
      await available.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (caught) {
      setStatus("available");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const feedback = error
    ? t("update.failed", { error })
    : status === "current"
      ? t("update.current")
      : status === "available"
        ? t("update.available", { version: available?.version ?? "" })
        : status === "installing"
          ? t("update.installing")
          : status === "checking"
            ? t("update.checking")
            : null;

  const buttonLabel = status === "available"
    ? t("update.install", { version: available?.version ?? "" })
    : status === "installing"
      ? t("update.installingLabel")
      : t("update.check");

  const runUpdateAction = () => {
    if (status === "available") return installUpdate();
    return checkForUpdate();
  };

  return (
    <div className="sidebar-update-control">
      {feedback && (
        <div className={`sidebar-update-feedback${error ? " error" : ""}`} role="status">
          {error && <CircleAlert size={13} />}
          <span>{feedback}</span>
        </div>
      )}
      <button
        aria-label={buttonLabel}
        className="sidebar-update-trigger"
        disabled={status === "checking" || status === "installing"}
        onClick={() => void runUpdateAction()}
        title={buttonLabel}
        type="button"
      >
        {status === "checking" || status === "installing"
          ? <LoaderCircle className="spin" size={16} />
          : status === "current"
            ? <RefreshCw size={16} />
            : <Download size={16} />}
      </button>
    </div>
  );
}
