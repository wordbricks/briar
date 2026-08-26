import { CheckCircle2, RefreshCw } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { APP_VERSION, formatAppVersionLabel } from "../lib/app-version";
import { useAppUpdate } from "./AppUpdateProvider";

export function AppVersionStatus({
  version = APP_VERSION,
}: {
  version?: string;
}) {
  const { t } = useI18n();
  const { checkForUpdate, isChecking, supported } = useAppUpdate();
  const label = formatAppVersionLabel(version);
  const [isOpen, setIsOpen] = useState(false);
  const [checkResult, setCheckResult] = useState<
    { kind: "current" } | { kind: "error"; message: string } | null
  >(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const checkButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    checkButtonRef.current?.focus();

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      containerRef.current
        ?.querySelector<HTMLButtonElement>(".app-version-trigger")
        ?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const runUpdateCheck = async () => {
    setCheckResult(null);
    try {
      const update = await checkForUpdate();
      if (update) {
        setIsOpen(false);
        return;
      }
      setCheckResult({ kind: "current" });
    } catch (caught) {
      setCheckResult({
        kind: "error",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  };

  return (
    <div
      className="app-version-status"
      ref={containerRef}
      title={t("app.version", { version: label })}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="app-version-trigger"
        disabled={!supported}
        onClick={() => {
          setCheckResult(null);
          setIsOpen((open) => !open);
        }}
        type="button"
      >
        <small>{label}</small>
      </button>
      {isOpen ? (
        <div className="app-version-popover">
          <div role="menu">
            <button
              disabled={isChecking}
              onClick={() => void runUpdateCheck()}
              ref={checkButtonRef}
              role="menuitem"
              type="button"
            >
              {isChecking ? (
                <Spinner aria-hidden="true" size={14} />
              ) : (
                <RefreshCw aria-hidden="true" size={14} />
              )}
              <span>
                {isChecking ? t("update.checking") : t("update.check")}
              </span>
            </button>
          </div>
          {checkResult ? (
            <div
              className={`app-version-check-result ${checkResult.kind}`}
              role="status"
            >
              {checkResult.kind === "current" ? (
                <>
                  <CheckCircle2 aria-hidden="true" size={14} />
                  <span>{t("update.current")}</span>
                </>
              ) : (
                <span>
                  {t("update.failed", { error: checkResult.message })}
                </span>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
