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

  return (
    <jelly-card className="update-panel">
      <div>
        <span className="update-icon"><Download size={16} /></span>
        <span>
          <strong>앱 업데이트</strong>
          <small>
            {status === "current" && "최신 버전입니다."}
            {status === "available" && `v${available?.version} 업데이트 사용 가능`}
            {status === "installing" && "서명된 업데이트를 설치하고 있습니다…"}
            {(status === "idle" || status === "checking") && "서명된 Production 채널을 확인합니다."}
          </small>
        </span>
      </div>
      <div className="update-actions">
        {status === "available" ? (
          <button onClick={() => void installUpdate()} type="button">
            <Download size={13} />설치 후 재시작
          </button>
        ) : (
          <button disabled={status === "checking" || status === "installing"} onClick={() => void checkForUpdate()} type="button">
            {status === "checking" ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}
            업데이트 확인
          </button>
        )}
      </div>
      {error && <div className="update-error"><CircleAlert size={13} />업데이트 확인 실패: {error}</div>}
    </jelly-card>
  );
}
