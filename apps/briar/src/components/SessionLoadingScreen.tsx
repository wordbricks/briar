import type { CSSProperties } from "react";
import briarWhiteStrokeUrl from "../assets/brand/briar-white-stroke.svg";
import briarBlackStrokeUrl from "../assets/brand/briar-black-stroke.svg";
import { useI18n } from "../i18n";

type LoadingLogoStyle = CSSProperties & {
  "--session-loading-logo-light": string;
  "--session-loading-logo-dark": string;
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
        className="session-loading-logo"
        style={
          {
            "--session-loading-logo-light": `url("${briarBlackStrokeUrl}")`,
            "--session-loading-logo-dark": `url("${briarWhiteStrokeUrl}")`,
          } as LoadingLogoStyle
        }
      >
        <img
          alt=""
          aria-hidden="true"
          className="session-loading-logo-light"
          src={briarBlackStrokeUrl}
        />
        <img
          alt=""
          aria-hidden="true"
          className="session-loading-logo-dark"
          src={briarWhiteStrokeUrl}
        />
      </div>
      <span className="visually-hidden">{t("session.restoring")}</span>
    </section>
  );
}
