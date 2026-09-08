import type { CSSProperties } from "react";
import briarBlackStrokeUrl from "../assets/brand/briar-black-stroke.svg";
import { useI18n } from "../i18n";

type LoadingLogoStyle = CSSProperties & {
  "--session-loading-logo": string;
};

export function SessionLoadingScreen({
  error,
  onRetry,
}: {
  readonly error?: string | null;
  readonly onRetry?: () => void;
}) {
  const { t } = useI18n();

  return (
    <section
      aria-busy={error ? undefined : "true"}
      aria-live="polite"
      className="session-loading-screen"
      data-tauri-drag-region
      data-testid="session-loading-screen"
      role="status"
    >
      <div
        aria-hidden="true"
        className="session-loading-logo"
        style={
          {
            "--session-loading-logo": `url("${briarBlackStrokeUrl}")`,
          } as LoadingLogoStyle
        }
      />
      {error ? (
        <div className="absolute top-[calc(50%+72px)] flex max-w-sm flex-col items-center gap-3 px-6 text-center">
          <strong className="text-sm">{t("session.restoreFailed")}</strong>
          <span className="text-xs text-muted-foreground">{error}</span>
          <button
            className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
            onClick={onRetry}
            type="button"
          >
            {t("session.retry")}
          </button>
        </div>
      ) : (
        <span className="visually-hidden">{t("session.restoring")}</span>
      )}
    </section>
  );
}
