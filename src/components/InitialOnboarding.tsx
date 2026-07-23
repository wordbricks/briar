import {
  ArrowRight,
  Check,
  Download,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n";
import {
  inspectOnboardingPrerequisites,
  installOnboardingPrerequisite,
  markInitialOnboardingComplete,
  type OnboardingPrerequisites,
  type PrerequisiteId,
} from "../lib/initial-onboarding";
import { Logo } from "./Logo";

type Step = "welcome" | "prerequisites";

const prerequisiteIds: PrerequisiteId[] = ["codex", "velen"];

export function InitialOnboarding({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("welcome");
  const [prerequisites, setPrerequisites] =
    useState<OnboardingPrerequisites | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState<PrerequisiteId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkPrerequisites = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      setPrerequisites(await inspectOnboardingPrerequisites());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (step !== "prerequisites") return;
    void checkPrerequisites();
  }, [checkPrerequisites, step]);

  const install = async (prerequisite: PrerequisiteId) => {
    setInstalling(prerequisite);
    setError(null);
    try {
      setPrerequisites(
        await installOnboardingPrerequisite(prerequisite),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setInstalling(null);
    }
  };

  const ready =
    prerequisites !== null &&
    prerequisiteIds.every((id) => prerequisites[id].installed);

  const continueToLogin = () => {
    markInitialOnboardingComplete();
    onComplete();
  };

  return (
    <jelly-theme mode="light" className="initial-onboarding-shell">
      <main
        aria-label={t("initialOnboarding.label")}
        className="initial-onboarding"
      >
        <div className="initial-onboarding-ambient" aria-hidden="true">
          <span />
          <span />
        </div>

        <header className="initial-onboarding-header">
          <Logo />
          <ol aria-label={t("initialOnboarding.progress")}>
            <li className={step === "welcome" ? "active" : "complete"}>
              <span>{step === "welcome" ? "1" : <Check size={12} />}</span>
              {t("initialOnboarding.welcomeStep")}
            </li>
            <li className={step === "prerequisites" ? "active" : ""}>
              <span>2</span>
              {t("initialOnboarding.prerequisitesStep")}
            </li>
            <li>
              <span>3</span>
              {t("initialOnboarding.loginStep")}
            </li>
          </ol>
        </header>

        {step === "welcome" ? (
          <section className="initial-welcome-card">
            <div className="initial-welcome-visual" aria-hidden="true">
              <div className="initial-welcome-orbit initial-welcome-orbit-large" />
              <div className="initial-welcome-orbit initial-welcome-orbit-small" />
              <span className="initial-welcome-spark">
                <Sparkles size={28} />
              </span>
              <div className="initial-welcome-wordmark">
                <small>Agent development environment</small>
                <strong>briar</strong>
              </div>
            </div>
            <div className="initial-welcome-copy">
              <p className="eyebrow">{t("initialOnboarding.eyebrow")}</p>
              <h1>{t("initialOnboarding.welcomeTitle")}</h1>
              <p>{t("initialOnboarding.welcomeDescription")}</p>
              <button
                className="initial-onboarding-primary"
                onClick={() => setStep("prerequisites")}
                type="button"
              >
                {t("initialOnboarding.start")}
                <ArrowRight size={17} />
              </button>
            </div>
          </section>
        ) : (
          <section className="initial-prerequisites-card">
            <div className="initial-prerequisites-heading">
              <span>
                <SquareTerminal size={20} />
              </span>
              <div>
                <p className="eyebrow">
                  {t("initialOnboarding.prerequisitesEyebrow")}
                </p>
                <h1>{t("initialOnboarding.prerequisitesTitle")}</h1>
                <p>{t("initialOnboarding.prerequisitesDescription")}</p>
              </div>
              <button
                aria-label={t("initialOnboarding.checkAgain")}
                className="initial-prerequisites-refresh"
                disabled={checking || installing !== null}
                onClick={() => void checkPrerequisites()}
                type="button"
              >
                <RefreshCw className={checking ? "spin" : ""} size={17} />
              </button>
            </div>

            <div className="initial-prerequisites-list">
              {prerequisiteIds.map((id) => {
                const status = prerequisites?.[id];
                const isInstalling = installing === id;
                return (
                  <article className="initial-prerequisite-row" key={id}>
                    <span className={`initial-prerequisite-icon ${id}`}>
                      {id === "codex" ? "C" : "V"}
                    </span>
                    <div>
                      <strong>
                        {t(`initialOnboarding.${id}Name`)}
                        <em>{t("common.required")}</em>
                      </strong>
                      <p>{t(`initialOnboarding.${id}Description`)}</p>
                    </div>
                    {checking && !prerequisites ? (
                      <span className="initial-prerequisite-status checking">
                        <LoaderCircle className="spin" size={15} />
                        {t("initialOnboarding.checking")}
                      </span>
                    ) : status?.installed ? (
                      <span className="initial-prerequisite-status installed">
                        <Check size={15} />
                        {status.version ?? t("initialOnboarding.installed")}
                      </span>
                    ) : (
                      <button
                        className="initial-prerequisite-install"
                        disabled={checking || installing !== null}
                        onClick={() => void install(id)}
                        type="button"
                      >
                        {isInstalling ? (
                          <LoaderCircle className="spin" size={15} />
                        ) : (
                          <Download size={15} />
                        )}
                        {t(
                          isInstalling
                            ? "initialOnboarding.installing"
                            : "initialOnboarding.install",
                        )}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>

            {error ? (
              <div className="initial-prerequisites-error" role="alert">
                <span>{error}</span>
                <button onClick={() => void checkPrerequisites()} type="button">
                  {t("initialOnboarding.retry")}
                </button>
              </div>
            ) : null}

            <footer>
              <button
                className="initial-onboarding-back"
                onClick={() => setStep("welcome")}
                type="button"
              >
                {t("initialOnboarding.back")}
              </button>
              <div>
                <small>
                  {ready
                    ? t("initialOnboarding.ready")
                    : t("initialOnboarding.installRequired")}
                </small>
                <button
                  className="initial-onboarding-primary"
                  disabled={!ready || checking || installing !== null}
                  onClick={continueToLogin}
                  type="button"
                >
                  {t("initialOnboarding.continueLogin")}
                  <ArrowRight size={17} />
                </button>
              </div>
            </footer>
          </section>
        )}
      </main>
    </jelly-theme>
  );
}
