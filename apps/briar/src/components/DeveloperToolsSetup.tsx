import {
  ArrowRight,
  Check,
  Download,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n";
import {
  configureOpenCodeTerminalPath,
  inspectOpenCodeTerminalPath,
  inspectOnboardingPrerequisites,
  installOnboardingPrerequisite,
} from "../lib/initial-onboarding";
import type {
  OnboardingPrerequisite,
  OnboardingPrerequisites,
  OpenCodeTerminalPathStatus,
} from "../generated/tauri";
import { builtInProviders } from "../lib/agent-provider";
import {
  AntigravityIcon,
  ClaudeIcon,
  CodexIcon,
  CursorIcon,
  GrokIcon,
  OpenCodeIcon,
  PiIcon,
} from "./AgentIcons";

/**
 * Onboarding only asks for the built-in providers. Everything else is added
 * from settings when the user wants it, so setup does not push a machine to
 * install a CLI it has not asked for.
 */
const prerequisiteIds: OnboardingPrerequisite[] = ["git", ...builtInProviders];

export function DeveloperToolsSetup({
  onContinue,
  requireAgent = false,
}: {
  onContinue: () => void;
  requireAgent?: boolean;
}) {
  const { t } = useI18n();
  const [prerequisites, setPrerequisites] =
    useState<OnboardingPrerequisites | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] =
    useState<OnboardingPrerequisite | null>(null);
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

  const install = async (prerequisite: OnboardingPrerequisite) => {
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
  const agentReady = builtInProviders.some(
    (provider) =>
      prerequisites?.[provider].installed === true &&
      prerequisites[provider].authenticated === true,
  );
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
                ) : id === "pi" ? (
                  <PiIcon size={20} />
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
                  <Spinner className="size-[16px]" />
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
                    <Spinner className="size-[14px]" />
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
                    <Spinner className="size-[14px]" />
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
            : requireAgent && !agentReady
              ? "onboarding.developerAgentRequired"
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
        disabled={busy || !gitReady || (requireAgent && !agentReady)}
        onClick={onContinue}
        type="button"
      >
        {t("onboarding.developerToolsContinue")}
        <ArrowRight size={17} />
      </button>
    </section>
  );
}
