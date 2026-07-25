import {
  Archive,
  ArrowLeft,
  Bot,
  Cable,
  ChevronDown,
  Cloud,
  Github,
  GitBranch,
  Gitlab,
  Keyboard,
  Link2,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import {
  inspectOnboardingPrerequisites,
  type OnboardingPrerequisites,
} from "../lib/initial-onboarding";
import {
  loadAppProviderSettings,
  updateAppProviderSettings,
  type AgentProvider,
  type AppProviderSettings,
} from "../lib/project-llm";
import type { RepositoryReadiness } from "../lib/project-connection";
import { Logo } from "./Logo";

type SettingsSection =
  | "general"
  | "keybindings"
  | "providers"
  | "source-control"
  | "connections"
  | "archive";

type ProviderToggle = "git" | "github";

function readProviderPreference(projectId: string, provider: ProviderToggle) {
  try {
    return window.localStorage.getItem(
      `briar.settings.source-control.${projectId}.${provider}`,
    ) !== "false";
  } catch {
    return true;
  }
}

function writeProviderPreference(
  projectId: string,
  provider: ProviderToggle,
  enabled: boolean,
) {
  try {
    window.localStorage.setItem(
      `briar.settings.source-control.${projectId}.${provider}`,
      String(enabled),
    );
  } catch {
    // Preferences remain available for the current session.
  }
}

export function AppSettings({
  error,
  isSidebarOpen,
  loading,
  onBack,
  onRefresh,
  projectId,
  projectName,
  readiness,
}: {
  error: string | null;
  isSidebarOpen: boolean;
  loading: boolean;
  onBack: () => void;
  onRefresh: () => Promise<unknown>;
  projectId: string;
  projectName: string;
  readiness: RepositoryReadiness | null;
}) {
  const { t } = useI18n();
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("source-control");
  const [gitEnabled, setGitEnabled] = useState(() =>
    readProviderPreference(projectId, "git"),
  );
  const [githubEnabled, setGithubEnabled] = useState(() =>
    readProviderPreference(projectId, "github"),
  );
  const [gitExpanded, setGitExpanded] = useState(false);
  const [providerStatuses, setProviderStatuses] =
    useState<OnboardingPrerequisites | null>(null);
  const [providerSettings, setProviderSettings] =
    useState<AppProviderSettings | null>(null);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providerSaving, setProviderSaving] =
    useState<AgentProvider | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providersChecked, setProvidersChecked] = useState(false);

  useEffect(() => {
    setGitEnabled(readProviderPreference(projectId, "git"));
    setGithubEnabled(readProviderPreference(projectId, "github"));
  }, [projectId]);

  const refreshProviders = useCallback(async () => {
    setProvidersLoading(true);
    setProviderError(null);
    try {
      const [statuses, settings] = await Promise.all([
        inspectOnboardingPrerequisites(),
        loadAppProviderSettings(),
      ]);
      setProviderStatuses(statuses);
      setProviderSettings(settings);
      setProvidersChecked(true);
    } catch (caught) {
      setProviderError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection !== "providers") return;
    void refreshProviders();
  }, [activeSection, refreshProviders]);

  const toggleProvider = async (
    provider: AgentProvider,
    enabled: boolean,
  ) => {
    if (!providerSettings || providerSettings[provider] === enabled || providerSaving) {
      return;
    }
    setProviderSaving(provider);
    setProviderError(null);
    try {
      setProviderSettings(
        await updateAppProviderSettings({
          ...providerSettings,
          [provider]: enabled,
        }),
      );
    } catch (caught) {
      setProviderError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setProviderSaving(null);
    }
  };

  const navigation: Array<{
    id: SettingsSection;
    icon: ReactNode;
    label: string;
  }> = [
    {
      id: "general",
      icon: <SlidersHorizontal size={17} strokeWidth={1.75} />,
      label: t("appSettings.general"),
    },
    {
      id: "keybindings",
      icon: <Keyboard size={17} strokeWidth={1.75} />,
      label: t("appSettings.keybindings"),
    },
    {
      id: "providers",
      icon: <Bot size={17} strokeWidth={1.75} />,
      label: t("appSettings.providers"),
    },
    {
      id: "source-control",
      icon: <GitBranch size={17} strokeWidth={1.75} />,
      label: t("appSettings.sourceControl"),
    },
    {
      id: "connections",
      icon: <Link2 size={17} strokeWidth={1.75} />,
      label: t("appSettings.connections"),
    },
    {
      id: "archive",
      icon: <Archive size={17} strokeWidth={1.75} />,
      label: t("appSettings.archive"),
    },
  ];

  return (
    <main className="app-settings">
      <aside
        aria-hidden={!isSidebarOpen}
        aria-label={t("appSettings.navigation")}
        className={`sidebar app-settings-sidebar${
          isSidebarOpen ? "" : " sidebar-collapsed"
        }`}
        id="app-sidebar"
        inert={!isSidebarOpen ? true : undefined}
      >
        <div className="app-settings-brand">
          <Logo />
        </div>
        <nav>
          {navigation.map((item) => (
            <button
              aria-current={activeSection === item.id ? "page" : undefined}
              className={activeSection === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              type="button"
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <button
          className="app-settings-back"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft size={17} strokeWidth={1.8} />
          <span>{t("appSettings.back")}</span>
        </button>
      </aside>

      <section className="main-content app-settings-main">
        <header
          className={`topbar app-settings-topbar${
            isSidebarOpen ? "" : " sidebar-closed"
          }`}
          data-tauri-drag-region
        >
          <h1>{t("appSettings.title")}</h1>
        </header>

        {activeSection === "providers" ? (
          <div className="app-settings-scroll">
            <div className="source-control-settings provider-settings">
              <SettingsGroupHeading
                action={
                  <div className="provider-heading-actions">
                    {providersChecked ? (
                      <span>{t("appSettings.checkedJustNow")}</span>
                    ) : null}
                    <button
                      aria-label={t("appSettings.refreshProviders")}
                      className="source-control-refresh"
                      disabled={providersLoading || providerSaving !== null}
                      onClick={() => void refreshProviders()}
                      title={t("appSettings.refreshProviders")}
                      type="button"
                    >
                      {providersLoading ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <RefreshCw size={16} />
                      )}
                    </button>
                  </div>
                }
                title={t("appSettings.providers")}
              />

              <div
                aria-busy={providersLoading || providerSaving !== null}
                className="source-control-card provider-card"
              >
                <ProviderRow
                  available={Boolean(
                    providerStatuses?.codex.installed &&
                      providerStatuses.codex.authenticated,
                  )}
                  description={providerDescription({
                    authenticated: providerStatuses?.codex.authenticated,
                    enabled: providerSettings?.codex ?? false,
                    installed: providerStatuses?.codex.installed,
                    loading: providersLoading && !providerStatuses,
                    providerName: "Codex CLI",
                    t,
                  })}
                  disabled={providerSaving !== null}
                  enabled={providerSettings?.codex ?? false}
                  icon={
                    <span className="source-control-provider-icon codex">
                      <Bot size={20} strokeWidth={1.9} />
                    </span>
                  }
                  name="Codex"
                  onToggle={(enabled) => void toggleProvider("codex", enabled)}
                  title={
                    <>
                      Codex
                      {providerStatuses?.codex.version ? (
                        <code>{providerStatuses.codex.version}</code>
                      ) : null}
                    </>
                  }
                  trailing={
                    providerSaving === "codex" ? (
                      <LoaderCircle
                        aria-label={t("common.saving")}
                        className="provider-saving spin"
                        size={16}
                      />
                    ) : null
                  }
                />
                <ProviderRow
                  available={Boolean(
                    providerStatuses?.claude.installed &&
                      providerStatuses.claude.authenticated,
                  )}
                  description={providerDescription({
                    authenticated: providerStatuses?.claude.authenticated,
                    enabled: providerSettings?.claude ?? false,
                    installed: providerStatuses?.claude.installed,
                    loading: providersLoading && !providerStatuses,
                    providerName: "Claude Code",
                    t,
                  })}
                  disabled={providerSaving !== null}
                  enabled={providerSettings?.claude ?? false}
                  icon={
                    <span className="source-control-provider-icon claude">
                      <Sparkles size={19} strokeWidth={1.8} />
                    </span>
                  }
                  name="Claude"
                  onToggle={(enabled) => void toggleProvider("claude", enabled)}
                  title={
                    <>
                      Claude
                      {providerStatuses?.claude.version ? (
                        <code>{providerStatuses.claude.version}</code>
                      ) : null}
                    </>
                  }
                  trailing={
                    providerSaving === "claude" ? (
                      <LoaderCircle
                        aria-label={t("common.saving")}
                        className="provider-saving spin"
                        size={16}
                      />
                    ) : null
                  }
                />
                <ProviderRow
                  available={Boolean(
                    providerStatuses?.grok.installed &&
                      providerStatuses.grok.authenticated,
                  )}
                  description={providerDescription({
                    authenticated: providerStatuses?.grok.authenticated,
                    enabled: providerSettings?.grok ?? false,
                    installed: providerStatuses?.grok.installed,
                    loading: providersLoading && !providerStatuses,
                    providerName: "Grok CLI",
                    t,
                  })}
                  disabled={providerSaving !== null}
                  enabled={providerSettings?.grok ?? false}
                  icon={
                    <span className="source-control-provider-icon grok">
                      <Cloud size={19} strokeWidth={1.8} />
                    </span>
                  }
                  name="Grok"
                  onToggle={(enabled) => void toggleProvider("grok", enabled)}
                  title={
                    <>
                      Grok
                      {providerStatuses?.grok.version ? (
                        <code>{providerStatuses.grok.version}</code>
                      ) : null}
                    </>
                  }
                  trailing={
                    providerSaving === "grok" ? (
                      <LoaderCircle
                        aria-label={t("common.saving")}
                        className="provider-saving spin"
                        size={16}
                      />
                    ) : null
                  }
                />
              </div>

              {providerError ? (
                <p className="source-control-error" role="alert">
                  {providerError}
                </p>
              ) : null}
              <p className="source-control-project-note provider-project-note">
                {t("appSettings.providerScope", { project: projectName })}
              </p>
            </div>
          </div>
        ) : activeSection === "source-control" ? (
          <div className="app-settings-scroll">
            <div className="source-control-settings">
              <SettingsGroupHeading
                action={
                  <button
                    aria-label={t("appSettings.refresh")}
                    className="source-control-refresh"
                    disabled={loading}
                    onClick={() => void onRefresh()}
                    title={t("appSettings.refresh")}
                    type="button"
                  >
                    {loading ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <RefreshCw size={16} />
                    )}
                  </button>
                }
                title={t("appSettings.versionControl")}
              />

              <div className="source-control-card">
                <ProviderRow
                  available={readiness?.gitInstalled ?? false}
                  description={
                    readiness?.gitInstalled
                      ? t("appSettings.available")
                      : t("appSettings.notInstalled")
                  }
                  enabled={Boolean(readiness?.gitInstalled && gitEnabled)}
                  icon={
                    <span className="source-control-provider-icon git">
                      <GitBranch size={18} strokeWidth={2.2} />
                    </span>
                  }
                  name="Git"
                  onToggle={(enabled) => {
                    setGitEnabled(enabled);
                    writeProviderPreference(projectId, "git", enabled);
                  }}
                  title={
                    <>
                      Git
                      {readiness?.gitVersion ? (
                        <code>{readiness.gitVersion}</code>
                      ) : null}
                    </>
                  }
                  trailing={
                    readiness?.gitInstalled ? (
                      <button
                        aria-expanded={gitExpanded}
                        aria-label={t("appSettings.gitDetails")}
                        className="source-control-disclosure"
                        onClick={() => setGitExpanded((expanded) => !expanded)}
                        type="button"
                      >
                        <ChevronDown size={16} />
                      </button>
                    ) : null
                  }
                />
                {gitExpanded && readiness ? (
                  <div className="source-control-details">
                    <span>
                      <strong>{t("appSettings.repository")}</strong>
                      <code>{readiness.repositoryPath}</code>
                    </span>
                    <span>
                      <strong>{t("appSettings.remote")}</strong>
                      <code>
                        {readiness.remote ?? t("appSettings.notConnected")}
                      </code>
                    </span>
                  </div>
                ) : null}
                <ProviderRow
                  available={false}
                  badge={t("appSettings.comingSoon")}
                  description={t("appSettings.jujutsuDescription")}
                  enabled={false}
                  icon={
                    <span className="source-control-provider-icon jujutsu">
                      jj
                    </span>
                  }
                  name="Jujutsu"
                  title="Jujutsu"
                />
              </div>

              <SettingsGroupHeading
                title={t("appSettings.sourceControlProviders")}
              />
              <div className="source-control-card">
                <ProviderRow
                  available={Boolean(readiness?.ghInstalled)}
                  description={
                    readiness?.ghAuthenticated
                      ? t("appSettings.authenticatedAs", {
                          account:
                            readiness.ghAccount ?? t("appSettings.unknownAccount"),
                        })
                      : readiness?.ghInstalled
                        ? t("appSettings.authenticationRequired")
                        : t("appSettings.githubUnavailable")
                  }
                  enabled={Boolean(readiness?.ghInstalled && githubEnabled)}
                  icon={
                    <span className="source-control-provider-icon github">
                      <Github size={20} strokeWidth={1.9} />
                    </span>
                  }
                  name="GitHub"
                  onToggle={(enabled) => {
                    setGithubEnabled(enabled);
                    writeProviderPreference(projectId, "github", enabled);
                  }}
                  title={
                    <>
                      GitHub
                      {readiness?.ghVersion ? (
                        <code>{readiness.ghVersion}</code>
                      ) : null}
                    </>
                  }
                />
                <ProviderRow
                  available={false}
                  description={t("appSettings.gitlabUnavailable")}
                  enabled={false}
                  icon={
                    <span className="source-control-provider-icon gitlab">
                      <Gitlab size={20} strokeWidth={1.8} />
                    </span>
                  }
                  name="GitLab"
                  title="GitLab"
                />
                <ProviderRow
                  available={false}
                  description={t("appSettings.azureUnavailable")}
                  enabled={false}
                  icon={
                    <span className="source-control-provider-icon azure">
                      <Cloud size={20} strokeWidth={1.8} />
                    </span>
                  }
                  name="Azure DevOps"
                  title="Azure DevOps"
                />
                <ProviderRow
                  available={false}
                  badge={t("appSettings.notAuthenticated")}
                  description={t("appSettings.bitbucketUnavailable")}
                  enabled={false}
                  icon={
                    <span className="source-control-provider-icon bitbucket">
                      <Cable size={19} strokeWidth={1.9} />
                    </span>
                  }
                  name="Bitbucket"
                  title="Bitbucket"
                />
              </div>

              {error ? (
                <p className="source-control-error" role="alert">
                  {error}
                </p>
              ) : null}
              <p className="source-control-project-note">
                {t("appSettings.projectScope", { project: projectName })}
              </p>
            </div>
          </div>
        ) : (
          <div className="app-settings-placeholder">
            <span>
              <Settings2 size={22} strokeWidth={1.7} />
            </span>
            <h2>
              {navigation.find((item) => item.id === activeSection)?.label}
            </h2>
            <p>{t("appSettings.sectionPlaceholder")}</p>
          </div>
        )}
      </section>
    </main>
  );
}

function SettingsGroupHeading({
  action,
  title,
}: {
  action?: ReactNode;
  title: string;
}) {
  return (
    <div className="source-control-section-heading">
      <span aria-hidden="true" />
      <h2>{title}</h2>
      {action}
    </div>
  );
}

function ProviderRow({
  available,
  badge,
  description,
  disabled = false,
  enabled,
  icon,
  name,
  onToggle,
  title,
  trailing,
}: {
  available: boolean;
  badge?: string;
  description: string;
  disabled?: boolean;
  enabled: boolean;
  icon: ReactNode;
  name: string;
  onToggle?: (enabled: boolean) => void;
  title: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className={`source-control-provider${available ? "" : " unavailable"}`}>
      <span
        aria-label={available ? "Available" : "Unavailable"}
        className={`source-control-status ${available ? "available" : "unavailable"}`}
      />
      {icon}
      <div className="source-control-provider-copy">
        <div>
          <strong>{title}</strong>
          {badge ? <span className="source-control-badge">{badge}</span> : null}
        </div>
        <p>{description}</p>
      </div>
      {trailing}
      <label className="source-control-switch">
        <input
          aria-label={`${name} enabled`}
          checked={enabled}
          disabled={disabled || !available || !onToggle}
          onChange={(event) => onToggle?.(event.currentTarget.checked)}
          type="checkbox"
        />
        <span aria-hidden="true" />
      </label>
    </div>
  );
}

function providerDescription({
  authenticated,
  enabled,
  installed,
  loading,
  providerName,
  t,
}: {
  authenticated: boolean | undefined;
  enabled: boolean;
  installed: boolean | undefined;
  loading: boolean;
  providerName: string;
  t: ReturnType<typeof useI18n>["t"];
}) {
  if (loading) return t("appSettings.checkingProviders");
  if (!installed) {
    return t("appSettings.providerNotInstalled", { provider: providerName });
  }
  if (!authenticated) {
    return t("appSettings.providerAuthenticationRequired", {
      provider: providerName,
    });
  }
  return t(
    enabled ? "appSettings.providerEnabled" : "appSettings.providerReady",
  );
}
