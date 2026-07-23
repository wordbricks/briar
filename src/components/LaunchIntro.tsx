import { useEffect, type CSSProperties } from "react";
import briarMarkUrl from "../assets/briar-mark.svg";
import { useI18n } from "../i18n";

const INTRO_DURATION_MS = 5_200;
const INTRO_REVEAL_MS = 4_575;
const REDUCED_MOTION_DURATION_MS = 900;
const REDUCED_MOTION_REVEAL_MS = 650;

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
    const timer = preview
      ? null
      : window.setTimeout(
          onComplete,
          reducedMotion ? REDUCED_MOTION_DURATION_MS : INTRO_DURATION_MS,
        );
    const revealTimer = !preview && onReveal
      ? window.setTimeout(
          onReveal,
          reducedMotion ? REDUCED_MOTION_REVEAL_MS : INTRO_REVEAL_MS,
        )
      : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onReveal?.();
        onComplete();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
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
      </div>
    </section>
  );
}
