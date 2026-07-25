import {
  ArrowRight,
  Check,
  Download,
  LoaderCircle,
  LogIn,
  RefreshCw,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n";
import {
  inspectOnboardingPrerequisites,
  installOnboardingPrerequisite,
  loginOnboardingVelen,
  markInitialOnboardingComplete,
  type OnboardingPrerequisites,
  type PrerequisiteId,
} from "../lib/initial-onboarding";
import { ClaudeIcon, CodexIcon, GrokIcon } from "./AgentIcons";

type Step = "welcome" | "prerequisites";

const prerequisiteIds: PrerequisiteId[] = [
  "git",
  "codex",
  "claude",
  "grok",
  "velen",
];
const agentPrerequisiteIds: PrerequisiteId[] = ["codex", "claude", "grok"];

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
  const [authenticatingVelen, setAuthenticatingVelen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authenticateVelen = useCallback(async () => {
    setAuthenticatingVelen(true);
    setError(null);
    try {
      setPrerequisites(await loginOnboardingVelen());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAuthenticatingVelen(false);
    }
  }, []);

  const checkPrerequisites = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const inspected = await inspectOnboardingPrerequisites();
      setPrerequisites(inspected);
      if (inspected.velen.installed && !inspected.velen.authenticated) {
        setChecking(false);
        await authenticateVelen();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setChecking(false);
    }
  }, [authenticateVelen]);

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
      if (
        prerequisite === "velen" &&
        installed.velen.installed &&
        !installed.velen.authenticated
      ) {
        setInstalling(null);
        await authenticateVelen();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setInstalling(null);
    }
  };

  const ready =
    prerequisites !== null &&
    prerequisites.git.installed &&
    prerequisites.git.authenticated &&
    prerequisites.velen.installed &&
    prerequisites.velen.authenticated &&
    agentPrerequisiteIds.some(
      (id) => prerequisites[id].installed && prerequisites[id].authenticated,
    );
  const busy = checking || installing !== null || authenticatingVelen;

  const continueToLogin = () => {
    markInitialOnboardingComplete();
    onComplete();
  };

  return (
    <div className="initial-onboarding-shell">
      <main
        aria-label={t("initialOnboarding.label")}
        className="initial-onboarding"
      >
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
                <p>{t("initialOnboarding.requirementsDescription")}</p>
              </div>
              <button
                aria-label={t("initialOnboarding.checkAgain")}
                className="initial-prerequisites-refresh"
                disabled={busy}
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
                const needsVelenLogin =
                  id === "velen" &&
                  status?.installed &&
                  !status.authenticated;
                return (
                  <article className="initial-prerequisite-row" key={id}>
                    <span className={`initial-prerequisite-icon ${id}`}>
                      {id === "git" ? (
                        "G"
                      ) : id === "codex" ? (
                        <CodexIcon size={20} />
                      ) : id === "claude" ? (
                        <ClaudeIcon size={20} />
                      ) : id === "grok" ? (
                        <GrokIcon size={20} />
                      ) : (
                        "V"
                      )}
                    </span>
                    <div>
                      <strong>
                        {id === "claude"
                          ? "Claude Code"
                          : t(`initialOnboarding.${id}Name`)}
                        <em>
                          {t(
                            agentPrerequisiteIds.includes(id)
                              ? "common.optional"
                              : "common.required",
                          )}
                        </em>
                      </strong>
                      <p>
                        {t(
                          `initialOnboarding.${
                            id === "claude" || id === "grok" ? "codex" : id
                          }Description`,
                        )}
                      </p>
                    </div>
                    {checking && !prerequisites ? (
                      <span className="initial-prerequisite-status checking">
                        <LoaderCircle className="spin" size={15} />
                        {t("initialOnboarding.checking")}
                      </span>
                    ) : status?.installed && status.authenticated ? (
                      <span className="initial-prerequisite-status installed">
                        <Check size={15} />
                        {id === "velen"
                          ? [
                              status.version,
                              t("initialOnboarding.velenAuthenticated"),
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : status.version ?? t("initialOnboarding.installed")}
                      </span>
                    ) : (
                      <button
                        className="initial-prerequisite-install"
                        disabled={busy}
                        onClick={() =>
                          void (needsVelenLogin
                            ? authenticateVelen()
                            : install(id))
                        }
                        type="button"
                      >
                        {isInstalling || (needsVelenLogin && authenticatingVelen) ? (
                          <LoaderCircle className="spin" size={15} />
                        ) : needsVelenLogin ? (
                          <LogIn size={15} />
                        ) : (
                          <Download size={15} />
                        )}
                        {t(
                          needsVelenLogin && authenticatingVelen
                            ? "initialOnboarding.velenLoggingIn"
                            : needsVelenLogin
                              ? "initialOnboarding.velenLogin"
                              : isInstalling
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
                  disabled={!ready || busy}
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
    </div>
  );
}
