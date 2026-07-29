import {
  ArrowRight,
  Check,
  Download,
  LoaderCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import onboardingEveIssueUrl from "../assets/onboarding-eve-issue.png";
import onboardingPrerequisitesUrl from "../assets/onboarding-prerequisites.png";
import { useI18n } from "../i18n";
import {
  inspectOnboardingPrerequisites,
  installOnboardingPrerequisite,
  type OnboardingPrerequisites,
  type PrerequisiteId,
} from "../lib/initial-onboarding";
import { ClaudeIcon, CodexIcon, GrokIcon } from "./AgentIcons";
import { LoginScreen } from "./LoginScreen";

type Step = "welcome" | "prerequisites" | "login";

const prerequisiteIds: PrerequisiteId[] = ["git", "codex", "claude", "grok"];

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
  const [prerequisites, setPrerequisites] =
    useState<OnboardingPrerequisites | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState<PrerequisiteId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkPrerequisites = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const inspected = await inspectOnboardingPrerequisites();
      setPrerequisites(inspected);
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
      const installed = await installOnboardingPrerequisite(prerequisite);
      setPrerequisites(installed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setInstalling(null);
    }
  };

  const hasAnyReady =
    prerequisites !== null &&
    prerequisiteIds.some(
      (id) => prerequisites[id].installed && prerequisites[id].authenticated,
    );
  const busy = checking || installing !== null;

  const continueToLogin = () => {
    setStep("login");
  };

  const returnToPrerequisites = () => {
    onCancelLogin();
    setStep("prerequisites");
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
                onClick={() => setStep("prerequisites")}
                type="button"
              >
                {t("initialOnboarding.start")}
                <ArrowRight size={17} />
              </button>
            </div>
          </section>
        ) : step === "prerequisites" ? (
          <section className="initial-prerequisites-card">
            <div
              aria-label={t("initialOnboarding.progress")}
              aria-valuemax={3}
              aria-valuemin={1}
              aria-valuenow={2}
              className="initial-onboarding-progress"
              role="progressbar"
            >
              <span />
            </div>

            <div className="initial-prerequisites-layout">
              <div className="initial-prerequisites-content">
                <div className="initial-prerequisites-heading">
                  <h1>{t("initialOnboarding.prerequisitesTitle")}</h1>
                  <p>{t("initialOnboarding.requirementsDescription")}</p>
                </div>

                <div className="initial-prerequisites-list">
                  {prerequisiteIds.map((id) => {
                    const status = prerequisites?.[id];
                    const isInstalling = installing === id;
                    const isReady =
                      status?.installed === true &&
                      status.authenticated === true;
                    return (
                      <article
                        className={`initial-prerequisite-row${isReady ? " ready" : ""}`}
                        key={id}
                      >
                        <span className={`initial-prerequisite-icon ${id}`}>
                          {id === "git" ? (
                            "G"
                          ) : id === "codex" ? (
                            <CodexIcon size={20} />
                          ) : id === "claude" ? (
                            <ClaudeIcon size={20} />
                          ) : id === "grok" ? (
                            <GrokIcon size={20} />
                          ) : null}
                        </span>
                        <div className="initial-prerequisite-copy">
                          <strong>
                            {id === "claude"
                              ? "Claude Code"
                              : t(`initialOnboarding.${id}Name`)}
                            <em>{t("common.optional")}</em>
                          </strong>
                        </div>
                        <span
                          aria-label={
                            isReady
                              ? t("initialOnboarding.installed")
                              : undefined
                          }
                          className={`initial-prerequisite-check${isReady ? " checked" : ""}${checking && !prerequisites ? " checking" : ""}`}
                          role={isReady ? "status" : undefined}
                        >
                          {checking && !prerequisites ? (
                            <LoaderCircle className="spin" size={16} />
                          ) : isReady ? (
                            <Check size={17} strokeWidth={2.5} />
                          ) : null}
                        </span>
                        {isReady ? (
                          <small className="initial-prerequisite-state">
                            {t("initialOnboarding.installed")}
                          </small>
                        ) : checking && !prerequisites ? (
                          <small className="initial-prerequisite-state">
                            {t("initialOnboarding.checking")}
                          </small>
                        ) : (
                          <button
                            className="initial-prerequisite-install"
                            disabled={busy}
                            onClick={() => void install(id)}
                            type="button"
                          >
                            {isInstalling ? (
                              <LoaderCircle className="spin" size={14} />
                            ) : (
                              <Download size={14} />
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
                    <button
                      onClick={() => void checkPrerequisites()}
                      type="button"
                    >
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
                  <button
                    className="initial-onboarding-primary"
                    disabled={busy}
                    onClick={continueToLogin}
                    type="button"
                  >
                    {t(
                      hasAnyReady
                        ? "initialOnboarding.next"
                        : "initialOnboarding.installLater",
                    )}
                    <ArrowRight size={17} />
                  </button>
                </footer>
              </div>

              <aside
                aria-hidden="true"
                className="initial-prerequisites-visual"
              >
                <img
                  alt=""
                  className="initial-prerequisites-image"
                  src={onboardingPrerequisitesUrl}
                />
              </aside>
            </div>
          </section>
        ) : (
          <section className="initial-login-step">
            <div
              aria-label={t("initialOnboarding.progress")}
              aria-valuemax={3}
              aria-valuemin={1}
              aria-valuenow={3}
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
              onClick={returnToPrerequisites}
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
