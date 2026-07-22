import type { Update } from "@tauri-apps/plugin-updater";
import { CircleAlert, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";

type UpdateStatus = "idle" | "checking" | "current" | "available" | "installing";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function UpdateControl() {
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
    ? `업데이트 확인 실패: ${error}`
    : status === "current"
      ? "최신 버전입니다."
      : status === "available"
        ? `v${available?.version} 업데이트 사용 가능 · 다시 눌러 설치`
        : status === "installing"
          ? "업데이트를 설치하고 있습니다…"
          : status === "checking"
            ? "업데이트를 확인하고 있습니다…"
            : null;

  const buttonLabel = status === "available"
    ? `v${available?.version} 업데이트 설치`
    : status === "installing"
      ? "업데이트 설치 중"
      : "앱 업데이트 확인";

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
