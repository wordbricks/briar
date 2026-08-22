import type { CSSProperties } from "react";
import briarMarkDarkUrl from "../assets/brand/briar-mark-dark.png";
import briarMarkLightUrl from "../assets/brand/briar-mark-light.png";
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
            "--session-loading-logo-light": `url("${briarMarkLightUrl}")`,
            "--session-loading-logo-dark": `url("${briarMarkDarkUrl}")`,
          } as LoadingLogoStyle
        }
      >
        <img
          alt=""
          aria-hidden="true"
          className="session-loading-logo-light"
          src={briarMarkLightUrl}
        />
        <img
          alt=""
          aria-hidden="true"
          className="session-loading-logo-dark"
          src={briarMarkDarkUrl}
        />
      </div>
      <span className="visually-hidden">{t("session.restoring")}</span>
    </section>
  );
}
