import { useEffect, type CSSProperties } from "react";
import briarMarkUrl from "../assets/briar-mark.svg";
import { useI18n } from "../i18n";

const INTRO_DURATION_MS = 5_200;
const REDUCED_MOTION_DURATION_MS = 900;

export function LaunchIntro({ onComplete }: { onComplete: () => void }) {
  const { t } = useI18n();
  const lines = t("login.title").split("\n");

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = window.setTimeout(
      onComplete,
      reducedMotion ? REDUCED_MOTION_DURATION_MS : INTRO_DURATION_MS,
    );
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onComplete();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onComplete]);

  let characterIndex = 0;

  return (
    <section
      aria-label={t("intro.label")}
      className="launch-intro"
      data-testid="launch-intro"
    >
      <button
        className="launch-intro-skip"
        onClick={onComplete}
        type="button"
      >
        {t("intro.skip")}
      </button>

      <div className="launch-intro-window" aria-hidden="true">
        <div className="launch-intro-gradient launch-intro-gradient-primary" />
        <div className="launch-intro-gradient launch-intro-gradient-secondary" />
        <div className="launch-intro-grain" />
        <div className="launch-intro-brand">
          <img src={briarMarkUrl} alt="" />
          <span>briar</span>
        </div>
        <div className="launch-intro-copy">
          <p>{t("login.eyebrow")}</p>
          <h1>
            {lines.map((line, lineIndex) => (
              <span className="launch-intro-line" key={line}>
                {Array.from(line).map((character) => {
                  const index = characterIndex++;
                  return (
                    <span
                      className="launch-intro-character"
                      key={`${lineIndex}-${index}`}
                      style={
                        {
                          "--launch-character-index": index,
                        } as CSSProperties
                      }
                    >
                      {character === " " ? "\u00A0" : character}
                    </span>
                  );
                })}
              </span>
            ))}
          </h1>
        </div>
        <div className="launch-intro-status">
          <span />
          <span />
          <span />
        </div>
      </div>
    </section>
  );
}
