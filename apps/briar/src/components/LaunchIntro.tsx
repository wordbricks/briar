import { useCallback, useEffect, useState, type CSSProperties } from "react";
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
  /**
   * Shows the window behind the intro. When it returns a promise, the fade
   * waits for it to settle, so five seconds becomes the minimum hold rather
   * than the whole story.
   */
  onReveal?: () => void | Promise<unknown>;
  preview?: boolean;
}) {
  const { t } = useI18n();
  const lines = t("login.title").split("\n");
  // Without a reveal to wait for, the curtain runs on its CSS delay alone.
  const gated = Boolean(onReveal);
  const [isFading, setIsFading] = useState(false);

  // Escape and the skip button end the intro at once, without waiting for the
  // reveal to land — the window arriving a moment later is the better trade.
  const skipIntro = useCallback(() => {
    void Promise.resolve(onReveal?.()).catch(() => undefined);
    onComplete();
  }, [onComplete, onReveal]);

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const fadeMs = reducedMotion ? REDUCED_MOTION_FADE_MS : INTRO_FADE_MS;
    let cancelled = false;
    let fadeTimer: number | null = null;

    const holdTimer = window.setTimeout(
      () => {
        if (!onReveal) {
          onComplete();
          return;
        }
        // The reveal resolves once the main window is showing its first real
        // screen, so the curtain never lifts onto a loading spinner.
        void Promise.resolve(onReveal())
          .catch(() => undefined)
          .then(() => {
            if (cancelled) return;
            setIsFading(true);
            fadeTimer = window.setTimeout(onComplete, fadeMs);
          });
      },
      onReveal ? INTRO_HOLD_MS : INTRO_HOLD_MS + fadeMs,
    );
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") skipIntro();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelled = true;
      window.clearTimeout(holdTimer);
      if (fadeTimer !== null) window.clearTimeout(fadeTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onComplete, onReveal, preview, skipIntro]);

  let characterIndex = 0;

  return (
    <section
      aria-label={t("intro.label")}
      className={`launch-intro${native ? " launch-intro-native" : ""}${preview ? " launch-intro-preview" : ""}${gated ? " launch-intro-gated" : ""}${isFading ? " launch-intro-fading" : ""}`}
      data-testid="launch-intro"
      style={
        {
          "--launch-intro-fade-duration": `${INTRO_FADE_MS}ms`,
          "--launch-intro-hold-duration": `${INTRO_HOLD_MS}ms`,
        } as CSSProperties
      }
    >
      <button className="launch-intro-skip" onClick={skipIntro} type="button">
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
