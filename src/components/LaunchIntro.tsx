import { useEffect, type CSSProperties } from "react";
import briarWhiteStrokeUrl from "../assets/brand/briar-white-stroke.svg";
import { useI18n } from "../i18n";

const INTRO_HOLD_MS = 5_000;
const INTRO_FADE_MS = 600;
const REDUCED_MOTION_FADE_MS = 200;

export function LaunchIntro({
  native = false,
  onComplete,
  onReveal,
  preview = false,
}: {
  native?: boolean;
  onComplete: () => void;
  onReveal?: () => void;
  preview?: boolean;
}) {
  const { t } = useI18n();
  const lines = t("login.title").split("\n");

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = window.setTimeout(
      onComplete,
      INTRO_HOLD_MS +
        (reducedMotion ? REDUCED_MOTION_FADE_MS : INTRO_FADE_MS),
    );
    const revealTimer = onReveal
      ? window.setTimeout(onReveal, INTRO_HOLD_MS)
      : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onReveal?.();
        onComplete();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      if (revealTimer !== null) window.clearTimeout(revealTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onComplete, onReveal, preview]);

  let characterIndex = 0;

  return (
    <section
      aria-label={t("intro.label")}
      className={`launch-intro${native ? " launch-intro-native" : ""}${preview ? " launch-intro-preview" : ""}`}
      data-testid="launch-intro"
      style={
        {
          "--launch-intro-fade-duration": `${INTRO_FADE_MS}ms`,
          "--launch-intro-hold-duration": `${INTRO_HOLD_MS}ms`,
        } as CSSProperties
      }
    >
      <button
        className="launch-intro-skip"
        onClick={() => {
          onReveal?.();
          onComplete();
        }}
        type="button"
      >
        {t("intro.skip")}
      </button>

      <div className="launch-intro-content" aria-hidden="true">
        <div className="launch-intro-brand">
          <img src={briarWhiteStrokeUrl} alt="" />
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
      </div>
    </section>
  );
}
