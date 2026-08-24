import type { CSSProperties } from "react";
import briarBlackStrokeUrl from "../assets/brand/briar-black-stroke.svg";
import { useI18n } from "../i18n";

type LoadingLogoStyle = CSSProperties & {
  "--session-loading-logo": string;
};

export function SessionLoadingScreen() {
  const { t } = useI18n();

  return (
    <section
      aria-busy="true"
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
      <span className="visually-hidden">{t("session.restoring")}</span>
    </section>
  );
}
