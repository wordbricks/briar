import {
  Activity,
  Archive,
  Bell,
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
  Moon,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  ProviderIcon,
  ProviderRow,
  SettingsBackButton,
  SettingsCard,
  SettingsGroupHeading,
  SettingsIconButton,
  SettingsMain,
  SettingsNav,
  SettingsNavGroup,
  SettingsNavItem,
  SettingsNote,
  SettingsPageHeader,
  SettingsPlaceholder,
  SettingsScroll,
  SettingsSearch,
  SettingsSection as SettingsContent,
  SettingsShell,
  SettingsSidebar,
  SettingsToggleRow,
  SettingsAlert,
} from "@/components/settings";
import { Typography } from "@/components/ui/typography";
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
import {
  loadAppRuntimeSettings,
  updateAppRuntimeSettings,
  type AppRuntimeSettings,
} from "../lib/app-runtime-settings";
import {
  loadAgentUsage,
  openAgentProviderLogin,
  type AgentUsageProvider,
  type AgentUsageSnapshot,
} from "../lib/agent-usage";
import { ClaudeIcon, CodexIcon, GrokIcon } from "./AgentIcons";
import { AgentUsageSettings } from "./AgentUsageSettings";
import { InboxNotificationSettings } from "./InboxNotificationSettings";
import type { RepositoryReadiness } from "../lib/project-connection";

export type SettingsSection =
  | "general"
  | "notifications"
  | "keybindings"
  | "usage"
  | "providers"
  | "source-control"
  | "connections"
  | "archive";

type ProviderToggle = "git" | "github";

type NavItem = {
  id: SettingsSection;
  icon: ReactNode;
  label: string;
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

function readProviderPreference(projectId: string, provider: ProviderToggle) {
  try {
    return (
      window.localStorage.getItem(
        `briar.settings.source-control.${projectId}.${provider}`,
      ) !== "false"
    );
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
  initialSection = "source-control",
  isSidebarOpen,
  loading,
  navigationSidebar,
  onBack,
  onRefresh,
  projectId,
  projectName,
  readiness,
}: {
  error: string | null;
  initialSection?: SettingsSection;
  isSidebarOpen: boolean;
  loading: boolean;
  navigationSidebar?: ReactNode;
  onBack: () => void;
  onRefresh: () => Promise<unknown>;
  projectId: string;
  projectName: string;
  readiness: RepositoryReadiness | null;
}) {
  const { t } = useI18n();
  const [activeSection, setActiveSection] =
    useState<SettingsSection>(initialSection);
  const [searchQuery, setSearchQuery] = useState("");
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
  const [providerUsage, setProviderUsage] =
    useState<AgentUsageSnapshot | null>(null);
  const [providerLoginOpening, setProviderLoginOpening] =
    useState<AgentProvider | null>(null);
  const [runtimeSettings, setRuntimeSettings] =
    useState<AppRuntimeSettings | null>(null);
  const [runtimeSettingsLoading, setRuntimeSettingsLoading] = useState(false);
  const [runtimeSettingsSaving, setRuntimeSettingsSaving] = useState(false);
  const [runtimeSettingsError, setRuntimeSettingsError] =
    useState<string | null>(null);

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    setGitEnabled(readProviderPreference(projectId, "git"));
    setGithubEnabled(readProviderPreference(projectId, "github"));
  }, [projectId]);

  const refreshProviders = useCallback(async () => {
    setProvidersLoading(true);
    setProviderError(null);
    try {
      const [statuses, settings, usage] = await Promise.all([
        inspectOnboardingPrerequisites(),
        loadAppProviderSettings(),
        loadAgentUsage().catch(() => null),
      ]);
      setProviderStatuses(statuses);
      setProviderSettings(settings);
      setProviderUsage(usage);
      setProvidersChecked(true);
    } catch (caught) {
      setProviderError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection !== "providers") return;
    void refreshProviders();
  }, [activeSection, refreshProviders]);

  useEffect(() => {
    if (activeSection !== "general" || runtimeSettings) return;
    setRuntimeSettingsLoading(true);
    setRuntimeSettingsError(null);
    void loadAppRuntimeSettings()
      .then(setRuntimeSettings)
      .catch((caught) =>
        setRuntimeSettingsError(
          caught instanceof Error ? caught.message : String(caught),
        ),
      )
      .finally(() => setRuntimeSettingsLoading(false));
  }, [activeSection, runtimeSettings]);

  const toggleProvider = async (
    provider: AgentProvider,
    enabled: boolean,
  ) => {
    if (
      !providerSettings ||
      providerSettings[provider] === enabled ||
      providerSaving
    ) {
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
      setProviderError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setProviderSaving(null);
    }
  };

  const openProviderLogin = async (provider: AgentProvider) => {
    if (providerLoginOpening) return;
    setProviderLoginOpening(provider);
    setProviderError(null);
    try {
      await openAgentProviderLogin(provider);
    } catch (caught) {
      setProviderError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setProviderLoginOpening(null);
    }
  };

  const togglePreventSleep = async (enabled: boolean) => {
    if (!runtimeSettings || runtimeSettingsSaving) return;
    const previous = runtimeSettings;
    setRuntimeSettings({
      ...runtimeSettings,
      preventSleepWhileRunning: enabled,
    });
    setRuntimeSettingsSaving(true);
    setRuntimeSettingsError(null);
    try {
      setRuntimeSettings(
        await updateAppRuntimeSettings({
          preventSleepWhileRunning: enabled,
        }),
      );
    } catch (caught) {
      setRuntimeSettings(previous);
      setRuntimeSettingsError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setRuntimeSettingsSaving(false);
    }
  };

  const navigationGroups: NavGroup[] = useMemo(
    () => [
      {
        id: "setup",
        label: t("appSettings.groupSetup"),
        items: [
          {
            id: "general",
            icon: <SlidersHorizontal size={16} strokeWidth={1.75} />,
            label: t("appSettings.general"),
          },
          {
            id: "notifications",
            icon: <Bell size={16} strokeWidth={1.75} />,
            label: t("notifications.title"),
          },
          {
            id: "keybindings",
            icon: <Keyboard size={16} strokeWidth={1.75} />,
            label: t("appSettings.keybindings"),
          },
        ],
      },
      {
        id: "ai",
        label: t("appSettings.groupAi"),
        items: [
          {
            id: "usage",
            icon: <Activity size={16} strokeWidth={1.75} />,
            label: t("usage.title"),
          },
          {
            id: "providers",
            icon: <Bot size={16} strokeWidth={1.75} />,
            label: t("appSettings.providers"),
          },
        ],
      },
      {
        id: "workflows",
        label: t("appSettings.groupWorkflows"),
        items: [
          {
            id: "source-control",
            icon: <GitBranch size={16} strokeWidth={1.75} />,
            label: t("appSettings.sourceControl"),
          },
          {
            id: "connections",
            icon: <Link2 size={16} strokeWidth={1.75} />,
            label: t("appSettings.connections"),
          },
        ],
      },
      {
        id: "data",
        label: t("appSettings.groupData"),
        items: [
          {
            id: "archive",
            icon: <Archive size={16} strokeWidth={1.75} />,
            label: t("appSettings.archive"),
          },
        ],
      },
    ],
    [t],
  );

  const flatNavigation = useMemo(
    () => navigationGroups.flatMap((group) => group.items),
    [navigationGroups],
  );

  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return navigationGroups;
    return navigationGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          item.label.toLocaleLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [navigationGroups, searchQuery]);

  const activeItem = flatNavigation.find((item) => item.id === activeSection);
  const sectionDescriptions: Record<SettingsSection, string> = {
    general: t("appSettings.generalDescription"),
    notifications: t("notifications.description"),
    keybindings: t("appSettings.keybindingsDescription"),
    usage: t("usage.settingsDescription"),
    providers: t("appSettings.providersDescription"),
    "source-control": t("appSettings.sourceControlDescription"),
    connections: t("appSettings.connectionsDescription"),
    archive: t("appSettings.archiveDescription"),
  };
  const sectionDescription = sectionDescriptions[activeSection];

  return (
    <SettingsShell>
      {navigationSidebar || <SettingsSidebar isOpen={isSidebarOpen} label={t("appSettings.navigation")}>
        <SettingsBackButton onClick={onBack}>
          {t("appSettings.back")}
        </SettingsBackButton>

        <SettingsSearch
          label={t("appSettings.search")}
          onChange={setSearchQuery}
          value={searchQuery}
        />

        <SettingsNav>
          {filteredGroups.map((group) => (
            <SettingsNavGroup key={group.id} label={group.label}>
              {group.items.map((item) => (
                <SettingsNavItem
                  active={activeSection === item.id}
                  icon={item.icon}
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                >
                  {item.label}
                </SettingsNavItem>
              ))}
            </SettingsNavGroup>
          ))}
        </SettingsNav>
      </SettingsSidebar>}

      <SettingsMain isSidebarOpen={isSidebarOpen}>
        <SettingsScroll>
          <SettingsPageHeader
            description={sectionDescription}
            title={activeItem?.label ?? t("appSettings.title")}
          />

          {activeSection === "usage" ? (
            <AgentUsageSettings
              onManageAccounts={() => setActiveSection("providers")}
            />
          ) : activeSection === "notifications" ? (
            <SettingsContent>
              <SettingsGroupHeading title={t("notifications.inboxImportance")} />
              <InboxNotificationSettings />
            </SettingsContent>
          ) : activeSection === "general" ? (
            <SettingsContent>
              <SettingsGroupHeading title={t("appSettings.power")} />
              <SettingsCard aria-busy={runtimeSettingsLoading || runtimeSettingsSaving}>
                <SettingsToggleRow
                  checked={runtimeSettings?.preventSleepWhileRunning ?? false}
                  description={
                    runtimeSettings?.preventSleepSupported === false
                      ? t("appSettings.preventSleepUnsupported")
                      : t("appSettings.preventSleepDescription")
                  }
                  disabled={
                    runtimeSettingsLoading ||
                    runtimeSettingsSaving ||
                    !runtimeSettings?.preventSleepSupported
                  }
                  label={t("appSettings.preventSleep")}
                  onCheckedChange={(enabled) => void togglePreventSleep(enabled)}
                  title={
                    <span className="flex items-center gap-2">
                      <Moon aria-hidden="true" size={16} strokeWidth={1.8} />
                      {t("appSettings.preventSleep")}
                    </span>
                  }
                />
              </SettingsCard>
              {runtimeSettingsError ? (
                <SettingsAlert>{runtimeSettingsError}</SettingsAlert>
              ) : null}
              <SettingsNote>{t("appSettings.preventSleepNote")}</SettingsNote>
            </SettingsContent>
          ) : activeSection === "providers" ? (
            <SettingsContent>
              <SettingsGroupHeading
                action={
                  <div className="flex items-center justify-end gap-2">
                    {providersChecked ? (
                      <Typography tone="muted" variant="caption">
                        {t("appSettings.checkedJustNow")}
                      </Typography>
                    ) : null}
                    <SettingsIconButton
                      aria-label={t("appSettings.refreshProviders")}
                      disabled={providersLoading || providerSaving !== null}
                      onClick={() => void refreshProviders()}
                      title={t("appSettings.refreshProviders")}
                    >
                      {providersLoading ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <RefreshCw size={16} />
                      )}
                    </SettingsIconButton>
                  </div>
                }
                title={t("appSettings.providers")}
              />

              <SettingsCard aria-busy={providersLoading || providerSaving !== null}>
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
                    <ProviderIcon tone="codex">
                      <CodexIcon size={20} />
                    </ProviderIcon>
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
                        className="spin"
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
                    <ProviderIcon tone="claude">
                      <ClaudeIcon size={19} />
                    </ProviderIcon>
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
                        className="spin"
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
                    <ProviderIcon tone="grok">
                      <GrokIcon size={19} />
                    </ProviderIcon>
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
                        className="spin"
                        size={16}
                      />
                    ) : null
                  }
                />
              </SettingsCard>

              <SettingsGroupHeading title={t("usage.accounts")} />
              <SettingsCard>
                {(
                  [
                    ["codex", <CodexIcon size={18} />],
                    ["claude", <ClaudeIcon size={18} />],
                    ["grok", <GrokIcon size={18} />],
                  ] as const
                ).map(([provider, icon]) => {
                  const usage = providerUsage?.[provider] as
                    | AgentUsageProvider
                    | undefined;
                  const installed = providerStatuses?.[provider].installed;
                  return (
                    <div className="provider-account-row" key={provider}>
                      <ProviderIcon tone={provider}>{icon}</ProviderIcon>
                      <div>
                        <strong>
                          {provider === "codex"
                            ? "Codex"
                            : provider === "claude"
                              ? "Claude"
                              : "Grok"}
                        </strong>
                        <span>
                          {usage?.accountLabel ??
                            (usage?.authenticated
                              ? t("usage.systemAccount")
                              : t("usage.signInRequired"))}
                        </span>
                        {usage?.error ? <small>{usage.error}</small> : null}
                      </div>
                      <span
                        className={`provider-account-health ${usage?.status ?? "unavailable"}`}
                      >
                        {t(
                          `usage.status.${usage?.status ?? "unavailable"}` as
                            | "usage.status.ok"
                            | "usage.status.error"
                            | "usage.status.unavailable",
                        )}
                      </span>
                      <button
                        disabled={
                          !installed || providerLoginOpening !== null
                        }
                        onClick={() => void openProviderLogin(provider)}
                        type="button"
                      >
                        {providerLoginOpening === provider ? (
                          <LoaderCircle className="spin" size={14} />
                        ) : null}
                        {usage?.authenticated
                          ? t("usage.reauthenticate")
                          : t("usage.signInAction")}
                      </button>
                    </div>
                  );
                })}
              </SettingsCard>
              <SettingsNote>{t("usage.accountsNote")}</SettingsNote>

              {providerError ? <SettingsAlert>{providerError}</SettingsAlert> : null}
              <SettingsNote>
                {t("appSettings.providerScope", { project: projectName })}
              </SettingsNote>
            </SettingsContent>
          ) : activeSection === "source-control" ? (
            <SettingsContent>
              <SettingsGroupHeading
                action={
                  <SettingsIconButton
                    aria-label={t("appSettings.refresh")}
                    disabled={loading}
                    onClick={() => void onRefresh()}
                    title={t("appSettings.refresh")}
                  >
                    {loading ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <RefreshCw size={16} />
                    )}
                  </SettingsIconButton>
                }
                title={t("appSettings.versionControl")}
              />

              <SettingsCard>
                <ProviderRow
                  available={readiness?.gitInstalled ?? false}
                  description={
                    readiness?.gitInstalled
                      ? t("appSettings.available")
                      : t("appSettings.notInstalled")
                  }
                  enabled={Boolean(readiness?.gitInstalled && gitEnabled)}
                  icon={
                    <ProviderIcon tone="git">
                      <GitBranch size={18} strokeWidth={2.2} />
                    </ProviderIcon>
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
                      <SettingsIconButton
                        aria-expanded={gitExpanded}
                        aria-label={t("appSettings.gitDetails")}
                        onClick={() => setGitExpanded((expanded) => !expanded)}
                      >
                        <ChevronDown
                          className={gitExpanded ? "rotate-180 transition-transform" : "transition-transform"}
                          size={16}
                        />
                      </SettingsIconButton>
                    ) : null
                  }
                />
                {gitExpanded && readiness ? (
                  <div className="mx-[18px] mb-0 mt-[-1px] grid grid-cols-2 gap-3.5 border-t border-border/80 py-3 pl-12">
                    <span className="grid min-w-0 gap-1">
                      <Typography
                        as="strong"
                        className="tracking-wide uppercase"
                        tone="muted"
                        variant="micro"
                      >
                        {t("appSettings.repository")}
                      </Typography>
                      <code className="truncate font-mono text-xs font-medium text-muted-foreground">
                        {readiness.repositoryPath}
                      </code>
                    </span>
                    <span className="grid min-w-0 gap-1">
                      <Typography
                        as="strong"
                        className="tracking-wide uppercase"
                        tone="muted"
                        variant="micro"
                      >
                        {t("appSettings.remote")}
                      </Typography>
                      <code className="truncate font-mono text-xs font-medium text-muted-foreground">
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
                  icon={<ProviderIcon tone="jujutsu">jj</ProviderIcon>}
                  name="Jujutsu"
                  title="Jujutsu"
                />
              </SettingsCard>

              <SettingsGroupHeading
                title={t("appSettings.sourceControlProviders")}
              />
              <SettingsCard>
                <ProviderRow
                  available={Boolean(readiness?.ghInstalled)}
                  description={
                    readiness?.ghAuthenticated
                      ? t("appSettings.authenticatedAs", {
                          account:
                            readiness.ghAccount ??
                            t("appSettings.unknownAccount"),
                        })
                      : readiness?.ghInstalled
                        ? t("appSettings.authenticationRequired")
                        : t("appSettings.githubUnavailable")
                  }
                  enabled={Boolean(readiness?.ghInstalled && githubEnabled)}
                  icon={
                    <ProviderIcon tone="github">
                      <Github size={20} strokeWidth={1.9} />
                    </ProviderIcon>
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
                    <ProviderIcon tone="gitlab">
                      <Gitlab size={20} strokeWidth={1.8} />
                    </ProviderIcon>
                  }
                  name="GitLab"
                  title="GitLab"
                />
                <ProviderRow
                  available={false}
                  description={t("appSettings.azureUnavailable")}
                  enabled={false}
                  icon={
                    <ProviderIcon tone="azure">
                      <Cloud size={20} strokeWidth={1.8} />
                    </ProviderIcon>
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
                    <ProviderIcon tone="bitbucket">
                      <Cable size={19} strokeWidth={1.9} />
                    </ProviderIcon>
                  }
                  name="Bitbucket"
                  title="Bitbucket"
                />
              </SettingsCard>

              {error ? <SettingsAlert>{error}</SettingsAlert> : null}
              <SettingsNote>
                {t("appSettings.projectScope", { project: projectName })}
              </SettingsNote>
            </SettingsContent>
          ) : (
            <SettingsPlaceholder
              description={t("appSettings.sectionPlaceholder")}
              icon={<Settings2 size={22} strokeWidth={1.7} />}
              title={activeItem?.label}
            />
          )}
        </SettingsScroll>
      </SettingsMain>
    </SettingsShell>
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
