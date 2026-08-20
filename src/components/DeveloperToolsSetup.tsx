import {
  ArrowRight,
  Check,
  Download,
  LoaderCircle,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n";
import {
  configureOpenCodeTerminalPath,
  inspectOpenCodeTerminalPath,
  inspectOnboardingPrerequisites,
  installOnboardingPrerequisite,
  type OpenCodeTerminalPathStatus,
  type OnboardingPrerequisites,
  type PrerequisiteId,
} from "../lib/initial-onboarding";
import { agentProviders } from "../lib/agent-provider";
import {
  AntigravityIcon,
  ClaudeIcon,
  CodexIcon,
  CursorIcon,
  GrokIcon,
  OpenCodeIcon,
} from "./AgentIcons";

const prerequisiteIds: PrerequisiteId[] = ["git", ...agentProviders];

export function DeveloperToolsSetup({
  onContinue,
}: {
  onContinue: () => void;
}) {
  const { t } = useI18n();
  const [prerequisites, setPrerequisites] =
    useState<OnboardingPrerequisites | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState<PrerequisiteId | null>(null);
  const [openCodeTerminalPath, setOpenCodeTerminalPath] =
    useState<OpenCodeTerminalPathStatus | null>(null);
  const [terminalPathSaving, setTerminalPathSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkPrerequisites = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const [inspected, terminalPath] = await Promise.all([
        inspectOnboardingPrerequisites(),
        inspectOpenCodeTerminalPath().catch(() => null),
      ]);
      setPrerequisites(inspected);
      setOpenCodeTerminalPath(terminalPath);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkPrerequisites();
  }, [checkPrerequisites]);

  const install = async (prerequisite: PrerequisiteId) => {
    setInstalling(prerequisite);
    setError(null);
    try {
      const installed = await installOnboardingPrerequisite(prerequisite);
      setPrerequisites(installed);
      if (prerequisite === "opencode") {
        setOpenCodeTerminalPath(
          await inspectOpenCodeTerminalPath().catch(() => null),
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setInstalling(null);
    }
  };

  const configureTerminalPath = async () => {
    if (terminalPathSaving) return;
    setTerminalPathSaving(true);
    setError(null);
    try {
      setOpenCodeTerminalPath(await configureOpenCodeTerminalPath());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTerminalPathSaving(false);
    }
  };

  const allReady =
    prerequisites !== null &&
    prerequisiteIds.every(
      (id) => prerequisites[id].installed && prerequisites[id].authenticated,
    );
  const gitReady =
    prerequisites?.git.installed === true &&
    prerequisites.git.authenticated === true;
  const busy = checking || installing !== null || terminalPathSaving;

  return (
    <section className="developer-tools-setup">
      <div className="onboarding-icon">
        <Wrench size={24} />
      </div>
      <p className="eyebrow">{t("onboarding.developerToolsEyebrow")}</p>
      <h1>{t("onboarding.developerToolsTitle")}</h1>
      <p className="onboarding-copy">
        {t("onboarding.developerToolsDescription")}
      </p>

      <div className="initial-prerequisites-list developer-prerequisites-list">
        {prerequisiteIds.map((id) => {
          const status = prerequisites?.[id];
          const isInstalling = installing === id;
          const isReady =
            status?.installed === true && status.authenticated === true;
          const needsTerminalPath =
            id === "opencode" &&
            isReady &&
            openCodeTerminalPath?.supported === true &&
            !openCodeTerminalPath.configured;
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
                ) : id === "cursor" ? (
                  <CursorIcon size={20} />
                ) : id === "grok" ? (
                  <GrokIcon size={20} />
                ) : id === "agy" ? (
                  <AntigravityIcon size={20} />
                ) : id === "opencode" ? (
                  <OpenCodeIcon size={20} />
                ) : null}
              </span>
              <div className="initial-prerequisite-copy">
                <strong>
                  {id === "claude"
                    ? "Claude Code"
                    : t(`initialOnboarding.${id}Name`)}
                  <em>
                    {t(id === "git" ? "common.required" : "common.optional")}
                  </em>
                </strong>
                <span>{t(`initialOnboarding.${id}Summary`)}</span>
              </div>
              {checking && !prerequisites ? (
                <span
                  className="initial-prerequisite-check checking"
                  role="status"
                >
                  <LoaderCircle className="spin" size={16} />
                  {t("initialOnboarding.checking")}
                </span>
              ) : needsTerminalPath ? (
                <button
                  className="initial-prerequisite-install"
                  disabled={busy}
                  onClick={() => void configureTerminalPath()}
                  type="button"
                >
                  {terminalPathSaving ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <SquareTerminal size={14} />
                  )}
                  {t(
                    terminalPathSaving
                      ? "appSettings.configuringTerminalPath"
                      : "appSettings.configureTerminalPath",
                  )}
                </button>
              ) : isReady ? (
                <span
                  className="initial-prerequisite-check checked"
                  role="status"
                >
                  <Check size={17} strokeWidth={2.5} />
                  {t("initialOnboarding.installed")}
                </span>
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

      <p className="initial-prerequisites-summary">
        {t(
          allReady
            ? "initialOnboarding.allToolsReady"
            : "onboarding.developerToolsLater",
        )}
      </p>

      {error ? (
        <div className="initial-prerequisites-error" role="alert">
          <span>{error}</span>
          <button onClick={() => void checkPrerequisites()} type="button">
            {t("initialOnboarding.retry")}
          </button>
        </div>
      ) : null}

      <button
        className="onboarding-primary-action developer-tools-continue"
        disabled={busy || !gitReady}
        onClick={onContinue}
        type="button"
      >
        {t("onboarding.developerToolsContinue")}
        <ArrowRight size={17} />
      </button>
    </section>
  );
}
