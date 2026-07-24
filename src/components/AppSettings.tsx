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
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
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

  useEffect(() => {
    setGitEnabled(readProviderPreference(projectId, "git"));
    setGithubEnabled(readProviderPreference(projectId, "github"));
  }, [projectId]);

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
    <main
      className={`app-settings${isSidebarOpen ? "" : " settings-sidebar-closed"}`}
    >
      <aside
        aria-label={t("appSettings.navigation")}
        className="app-settings-sidebar"
        id="app-sidebar"
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

      <section className="app-settings-main">
        <header className="app-settings-topbar" data-tauri-drag-region>
          <h1>{t("appSettings.title")}</h1>
        </header>

        {activeSection === "source-control" ? (
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
          disabled={!available || !onToggle}
          onChange={(event) => onToggle?.(event.currentTarget.checked)}
          type="checkbox"
        />
        <span aria-hidden="true" />
      </label>
    </div>
  );
}
