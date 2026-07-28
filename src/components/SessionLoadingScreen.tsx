import type { CSSProperties } from "react";
import briarOutlineUrl from "../assets/app-icons/briar-outline-gray.png";
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
      data-testid="session-loading-screen"
      role="status"
    >
      <div
        className="session-loading-logo"
        style={
          {
            "--session-loading-logo": `url("${briarOutlineUrl}")`,
          } as LoadingLogoStyle
        }
      >
        <img alt="" aria-hidden="true" src={briarOutlineUrl} />
      </div>
      <span className="visually-hidden">{t("session.restoring")}</span>
    </section>
  );
}
