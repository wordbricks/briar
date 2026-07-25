import type { Update } from "@tauri-apps/plugin-updater";
import { CircleAlert, Download, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";

/** How often the signed update channel is re-checked while the app is open. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function UpdateControl() {
  const { t } = useI18n();
  const [available, setAvailable] = useState<Update | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(false);
  const isInstallingRef = useRef(false);

  useEffect(() => {
    isInstallingRef.current = isInstalling;
  }, [isInstalling]);

  useEffect(() => {
    isMounted.current = true;
    if (!isTauri()) {
      return () => {
        isMounted.current = false;
      };
    }

    let cancelled = false;
    let inFlight = false;

    const checkForUpdate = async () => {
      if (cancelled || inFlight || isInstallingRef.current) return;
      inFlight = true;
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (!cancelled && isMounted.current && !isInstallingRef.current) {
          setAvailable(update);
        }
      } catch {
        // A background check should not surface UI unless an update exists.
      } finally {
        inFlight = false;
      }
    };

    void checkForUpdate();
    const intervalId = window.setInterval(() => {
      void checkForUpdate();
    }, UPDATE_CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      isMounted.current = false;
      window.clearInterval(intervalId);
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
