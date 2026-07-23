import type { Update } from "@tauri-apps/plugin-updater";
import { CircleAlert, Download, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function UpdateControl() {
  const { t } = useI18n();
  const [available, setAvailable] = useState<Update | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasChecked = useRef(false);
  const isMounted = useRef(false);

  useEffect(() => {
    isMounted.current = true;

    if (isTauri() && !hasChecked.current) {
      hasChecked.current = true;
      void import("@tauri-apps/plugin-updater")
        .then(({ check }) => check())
        .then((update) => {
          if (isMounted.current) setAvailable(update);
        })
        .catch(() => {
          // A background check should not surface UI unless an update exists.
        });
    }

    return () => {
      isMounted.current = false;
    };
  }, []);

  const installUpdate = async () => {
    if (!available) return;
    setIsInstalling(true);
    setError(null);
    try {
      await available.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (caught) {
      setIsInstalling(false);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  if (!isTauri() || !available) return null;

  const feedback = error
    ? t("update.failed", { error })
    : isInstalling
      ? t("update.installing")
      : t("update.available", { version: available.version });

  const buttonLabel = isInstalling
    ? t("update.installingLabel")
    : t("update.install", { version: available.version });

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
        disabled={isInstalling}
        onClick={() => void installUpdate()}
        title={buttonLabel}
        type="button"
      >
        {isInstalling
          ? <LoaderCircle aria-hidden="true" className="spin" size={14} />
          : <Download aria-hidden="true" size={14} />}
      </button>
    </div>
  );
}
