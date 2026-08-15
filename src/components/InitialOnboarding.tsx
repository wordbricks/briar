import { ArrowRight } from "lucide-react";
import { useState } from "react";
import onboardingEveIssueUrl from "../assets/onboarding-eve-issue.png";
import { useI18n } from "../i18n";
import { LoginScreen } from "./LoginScreen";

type Step = "welcome" | "login";

export function InitialOnboarding({
  error: loginError,
  loading: loginLoading,
  loginCode,
  onCancelLogin,
  onLogin,
}: {
  error: string | null;
  loading: boolean;
  loginCode: string | null;
  onCancelLogin: () => void;
  onLogin: () => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("welcome");
  const returnToWelcome = () => {
    onCancelLogin();
    setStep("welcome");
  };

  return (
    <div className="initial-onboarding-shell">
      <div className="initial-onboarding-drag-region" data-tauri-drag-region />
      <main
        aria-label={t("initialOnboarding.label")}
        className="initial-onboarding"
      >
        {step === "welcome" ? (
          <section className="initial-welcome-card">
            <div className="initial-welcome-visual" aria-hidden="true">
              <img
                alt=""
                className="initial-welcome-image"
                src={onboardingEveIssueUrl}
              />
            </div>
            <div className="initial-welcome-copy">
              <p className="eyebrow">{t("initialOnboarding.eyebrow")}</p>
              <h1>{t("initialOnboarding.welcomeTitle")}</h1>
              <p>{t("initialOnboarding.welcomeDescription")}</p>
              <button
                className="initial-onboarding-primary"
                onClick={() => setStep("login")}
                type="button"
              >
                {t("initialOnboarding.start")}
                <ArrowRight size={17} />
              </button>
            </div>
          </section>
        ) : (
          <section className="initial-login-step">
            <div
              aria-label={t("initialOnboarding.progress")}
              aria-valuemax={2}
              aria-valuemin={1}
              aria-valuenow={2}
              className="initial-onboarding-progress complete"
              role="progressbar"
            >
              <span />
            </div>
            <LoginScreen
              embedded
              error={loginError}
              loading={loginLoading}
              loginCode={loginCode}
              onCancel={onCancelLogin}
              onLogin={onLogin}
            />
            <button
              className="initial-onboarding-back initial-login-back"
              onClick={returnToWelcome}
              type="button"
            >
              {t("initialOnboarding.back")}
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
