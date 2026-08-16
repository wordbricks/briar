import {
  CircleCheck,
  ChevronDown,
  Download,
  Github,
  GitBranch,
  LoaderCircle,
  Moon,
  RefreshCw,
  Settings2,
  SquareTerminal,
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
import { Button } from "@/components/ui/button";
import { useI18n } from "../i18n";
import {
  configureOpenCodeTerminalPath,
  inspectOpenCodeTerminalPath,
  inspectOnboardingPrerequisites,
  installOnboardingPrerequisite,
  type OpenCodeTerminalPathStatus,
  type OnboardingPrerequisites,
} from "../lib/initial-onboarding";
import {
  loadAppProviderSettings,
  loadAgentProviderModels,
  updateAppProviderSettings,
  type AgentProvider,
  type AgentProviderModelCatalogEntry,
  type AppProviderSettings,
  defaultAgentProviderModelCatalog,
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
import {
  AntigravityIcon,
  ClaudeIcon,
  CodexIcon,
  CursorIcon,
  GrokIcon,
  OpenCodeIcon,
} from "./AgentIcons";
import { AgentUsageSettings } from "./AgentUsageSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { InboxNotificationSettings } from "./InboxNotificationSettings";
import type { RepositoryReadiness } from "../lib/project-connection";
import type { AgentUsageReport, SessionUser } from "../types";
import { AccountDeletionSettings } from "./AccountDeletionSettings";
import { AccountProfileSettings } from "./AccountProfileSettings";
import { BrowserSettings } from "./BrowserSettings";
import { KeybindingsSettings } from "./KeybindingsSettings";
import {
  appSettingsNavigationGroups,
  appSettingsNavigationItems,
  type SettingsSection,
} from "./app-settings-navigation";

export type { SettingsSection } from "./app-settings-navigation";

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
  onAccountDelete,
  onAccountSave,
  onLoadUsageReport,
  onRefresh,
  projectId,
  projectName,
  readiness,
  usageScopeKey,
  user,
}: {
  error: string | null;
  initialSection?: SettingsSection;
  isSidebarOpen: boolean;
  loading: boolean;
  navigationSidebar?: ReactNode;
  onBack: () => void;
  onAccountDelete?: (confirmation: string) => Promise<void>;
  onAccountSave?: (input: {
    username: string;
    name: string;
    image: string | null;
  }) => Promise<SessionUser>;
  onLoadUsageReport?: () => Promise<AgentUsageReport>;
  onRefresh: () => Promise<unknown>;
  projectId: string;
  projectName: string;
  readiness: RepositoryReadiness | null;
  usageScopeKey?: string;
  user?: SessionUser;
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
  const [providerInstalling, setProviderInstalling] =
    useState<AgentProvider | null>(null);
  const [openCodeTerminalPath, setOpenCodeTerminalPath] =
    useState<OpenCodeTerminalPathStatus | null>(null);
  const [terminalPathSaving, setTerminalPathSaving] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providersChecked, setProvidersChecked] = useState(false);
  const [providerUsage, setProviderUsage] =
    useState<AgentUsageSnapshot | null>(null);
  const [providerLoginOpening, setProviderLoginOpening] =
    useState<AgentProvider | null>(null);
  const [expandedProvider, setExpandedProvider] =
    useState<AgentProvider | null>(null);
  const [providerModels, setProviderModels] = useState(
    defaultAgentProviderModelCatalog,
  );
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
      const [statuses, settings, usage, models, terminalPath] = await Promise.all([
        inspectOnboardingPrerequisites(),
        loadAppProviderSettings(),
        loadAgentUsage().catch(() => null),
        loadAgentProviderModels({ refresh: true }).catch(
          () => defaultAgentProviderModelCatalog,
        ),
        inspectOpenCodeTerminalPath().catch(() => null),
      ]);
      setProviderStatuses(statuses);
      setProviderSettings(settings);
      setProviderUsage(usage);
      setProviderModels(models);
      setOpenCodeTerminalPath(terminalPath);
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

  const installProvider = async (provider: AgentProvider) => {
    if (providerInstalling || providerSaving) return;
    setProviderInstalling(provider);
    setProviderError(null);
    try {
      const statuses = await installOnboardingPrerequisite(provider);
      setProviderStatuses(statuses);
      if (provider === "opencode") {
        setOpenCodeTerminalPath(
          await inspectOpenCodeTerminalPath().catch(() => null),
        );
      }
      setProviderUsage(await loadAgentUsage().catch(() => null));
      setProvidersChecked(true);
    } catch (caught) {
      setProviderError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setProviderInstalling(null);
    }
  };

  const configureTerminalPath = async () => {
    if (terminalPathSaving) return;
    setTerminalPathSaving(true);
    setProviderError(null);
    try {
      setOpenCodeTerminalPath(await configureOpenCodeTerminalPath());
    } catch (caught) {
      setProviderError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setTerminalPathSaving(false);
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
    () =>
      appSettingsNavigationGroups.map((group) => ({
        id: group.id,
        label: t(group.labelKey),
        items: group.items.map((item) => {
          const Icon = item.icon;
          return {
            id: item.id,
            icon: <Icon size={16} strokeWidth={1.75} />,
            label: t(item.labelKey),
          };
        }),
      })),
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
  const activeDefinition = appSettingsNavigationItems.find(
    (item) => item.id === activeSection,
  );
  const sectionDescription = activeDefinition
    ? t(activeDefinition.descriptionKey)
    : undefined;

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
          {activeSection !== "usage" ? (
            <SettingsPageHeader
              description={sectionDescription}
              title={activeItem?.label ?? t("appSettings.title")}
            />
          ) : null}

          {activeSection === "account" ? (
            <SettingsContent>
              <SettingsGroupHeading title={t("account.publicProfile")} />
              {user && onAccountSave ? (
                <AccountProfileSettings onSave={onAccountSave} user={user} />
              ) : null}
              {user && onAccountDelete ? (
                <>
                  <SettingsGroupHeading title={t("account.dangerZone")} />
                  <AccountDeletionSettings
                    onDelete={onAccountDelete}
                    user={user}
                  />
                </>
              ) : null}
            </SettingsContent>
          ) : activeSection === "usage" ? (
            <AgentUsageSettings
              onManageAccounts={() => setActiveSection("providers")}
              onLoadUsageReport={onLoadUsageReport}
              usageScopeKey={usageScopeKey}
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
          ) : activeSection === "appearance" ? (
            <AppearanceSettings />
          ) : activeSection === "keybindings" ? (
            <KeybindingsSettings />
          ) : activeSection === "browser" ? (
            <BrowserSettings />
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
                      disabled={
                        providersLoading ||
                        providerSaving !== null ||
                        providerInstalling !== null
                      }
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

              <SettingsCard
                aria-busy={
                  providersLoading ||
                  providerSaving !== null ||
                  providerInstalling !== null
                }
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
                  disabled={
                    providerSaving !== null || providerInstalling !== null
                  }
                  details={
                    <ProviderDetails
                      authenticated={providerStatuses?.codex.authenticated}
                      installed={providerStatuses?.codex.installed}
                      loading={providersLoading && !providerStatuses}
                      loginOpening={providerLoginOpening === "codex"}
                      models={providerModels.codex}
                      onLogin={() => void openProviderLogin("codex")}
                      providerName="Codex"
                      usage={providerUsage?.codex}
                    />
                  }
                  detailsId="provider-codex-details"
                  detailsLabel={t("appSettings.toggleProviderDetails", { provider: "Codex" })}
                  enabled={providerSettings?.codex ?? false}
                  expanded={expandedProvider === "codex"}
                  icon={
                    <ProviderIcon tone="codex">
                      <CodexIcon size={20} />
                    </ProviderIcon>
                  }
                  name="Codex"
                  onExpandedChange={(expanded) =>
                    setExpandedProvider(expanded ? "codex" : null)
                  }
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
                    providerInstalling === "codex" ? (
                      <Button
                        aria-label={t("appSettings.installingProvider", {
                          provider: "Codex",
                        })}
                        disabled
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <LoaderCircle className="spin" />
                        {t("appSettings.installing")}
                      </Button>
                    ) : providerStatuses?.codex.installed === false ? (
                      <Button
                        aria-label={t("appSettings.installProvider", {
                          provider: "Codex",
                        })}
                        onClick={() => void installProvider("codex")}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Download />
                        {t("appSettings.install")}
                      </Button>
                    ) : providerSaving === "codex" ? (
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
                  disabled={
                    providerSaving !== null || providerInstalling !== null
                  }
                  details={
                    <ProviderDetails
                      authenticated={providerStatuses?.claude.authenticated}
                      installed={providerStatuses?.claude.installed}
                      loading={providersLoading && !providerStatuses}
                      loginOpening={providerLoginOpening === "claude"}
                      models={providerModels.claude}
                      onLogin={() => void openProviderLogin("claude")}
                      providerName="Claude"
                      usage={providerUsage?.claude}
                    />
                  }
                  detailsId="provider-claude-details"
                  detailsLabel={t("appSettings.toggleProviderDetails", { provider: "Claude" })}
                  enabled={providerSettings?.claude ?? false}
                  expanded={expandedProvider === "claude"}
                  icon={
                    <ProviderIcon tone="claude">
                      <ClaudeIcon size={19} />
                    </ProviderIcon>
                  }
                  name="Claude"
                  onExpandedChange={(expanded) =>
                    setExpandedProvider(expanded ? "claude" : null)
                  }
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
                    providerInstalling === "claude" ? (
                      <Button
                        aria-label={t("appSettings.installingProvider", {
                          provider: "Claude",
                        })}
                        disabled
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <LoaderCircle className="spin" />
                        {t("appSettings.installing")}
                      </Button>
                    ) : providerStatuses?.claude.installed === false ? (
                      <Button
                        aria-label={t("appSettings.installProvider", {
                          provider: "Claude",
                        })}
                        onClick={() => void installProvider("claude")}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Download />
                        {t("appSettings.install")}
                      </Button>
                    ) : providerSaving === "claude" ? (
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
                    providerStatuses?.cursor.installed &&
                      providerStatuses.cursor.authenticated,
                  )}
                  description={providerDescription({
                    authenticated: providerStatuses?.cursor.authenticated,
                    enabled: providerSettings?.cursor ?? false,
                    installed: providerStatuses?.cursor.installed,
                    loading: providersLoading && !providerStatuses,
                    providerName: "Cursor CLI",
                    t,
                  })}
                  disabled={
                    providerSaving !== null || providerInstalling !== null
                  }
                  details={
                    <ProviderDetails
                      authenticated={providerStatuses?.cursor.authenticated}
                      installed={providerStatuses?.cursor.installed}
                      loading={providersLoading && !providerStatuses}
                      loginOpening={providerLoginOpening === "cursor"}
                      models={providerModels.cursor}
                      onLogin={() => void openProviderLogin("cursor")}
                      providerName="Cursor"
                    />
                  }
                  detailsId="provider-cursor-details"
                  detailsLabel={t("appSettings.toggleProviderDetails", { provider: "Cursor" })}
                  enabled={providerSettings?.cursor ?? false}
                  expanded={expandedProvider === "cursor"}
                  icon={
                    <ProviderIcon tone="cursor">
                      <CursorIcon size={19} />
                    </ProviderIcon>
                  }
                  name="Cursor"
                  onExpandedChange={(expanded) =>
                    setExpandedProvider(expanded ? "cursor" : null)
                  }
                  onToggle={(enabled) => void toggleProvider("cursor", enabled)}
                  title={
                    <>
                      Cursor
                      {providerStatuses?.cursor.version ? (
                        <code>{providerStatuses.cursor.version}</code>
                      ) : null}
                    </>
                  }
                  trailing={
                    providerInstalling === "cursor" ? (
                      <Button
                        aria-label={t("appSettings.installingProvider", {
                          provider: "Cursor",
                        })}
                        disabled
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <LoaderCircle className="spin" />
                        {t("appSettings.installing")}
                      </Button>
                    ) : providerStatuses?.cursor.installed === false ? (
                      <Button
                        aria-label={t("appSettings.installProvider", {
                          provider: "Cursor",
                        })}
                        onClick={() => void installProvider("cursor")}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Download />
                        {t("appSettings.install")}
                      </Button>
                    ) : providerSaving === "cursor" ? (
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
                  disabled={
                    providerSaving !== null || providerInstalling !== null
                  }
                  details={
                    <ProviderDetails
                      authenticated={providerStatuses?.grok.authenticated}
                      installed={providerStatuses?.grok.installed}
                      loading={providersLoading && !providerStatuses}
                      loginOpening={providerLoginOpening === "grok"}
                      models={providerModels.grok}
                      onLogin={() => void openProviderLogin("grok")}
                      providerName="Grok"
                      usage={providerUsage?.grok}
                    />
                  }
                  detailsId="provider-grok-details"
                  detailsLabel={t("appSettings.toggleProviderDetails", { provider: "Grok" })}
                  enabled={providerSettings?.grok ?? false}
                  expanded={expandedProvider === "grok"}
                  icon={
                    <ProviderIcon tone="grok">
                      <GrokIcon size={19} />
                    </ProviderIcon>
                  }
                  name="Grok"
                  onExpandedChange={(expanded) =>
                    setExpandedProvider(expanded ? "grok" : null)
                  }
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
                    providerInstalling === "grok" ? (
                      <Button
                        aria-label={t("appSettings.installingProvider", {
                          provider: "Grok",
                        })}
                        disabled
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <LoaderCircle className="spin" />
                        {t("appSettings.installing")}
                      </Button>
                    ) : providerStatuses?.grok.installed === false ? (
                      <Button
                        aria-label={t("appSettings.installProvider", {
                          provider: "Grok",
                        })}
                        onClick={() => void installProvider("grok")}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Download />
                        {t("appSettings.install")}
                      </Button>
                    ) : providerSaving === "grok" ? (
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
                    providerStatuses?.agy.installed &&
                      providerStatuses.agy.authenticated,
                  )}
                  description={providerDescription({
                    authenticated: providerStatuses?.agy.authenticated,
                    enabled: providerSettings?.agy ?? false,
                    installed: providerStatuses?.agy.installed,
                    loading: providersLoading && !providerStatuses,
                    providerName: "Google Antigravity CLI",
                    t,
                  })}
                  disabled={
                    providerSaving !== null || providerInstalling !== null
                  }
                  details={
                    <ProviderDetails
                      authenticated={providerStatuses?.agy.authenticated}
                      installed={providerStatuses?.agy.installed}
                      loading={providersLoading && !providerStatuses}
                      loginOpening={providerLoginOpening === "agy"}
                      models={providerModels.agy}
                      onLogin={() => void openProviderLogin("agy")}
                      providerName="Antigravity"
                    />
                  }
                  detailsId="provider-agy-details"
                  detailsLabel={t("appSettings.toggleProviderDetails", {
                    provider: "Antigravity",
                  })}
                  enabled={providerSettings?.agy ?? false}
                  expanded={expandedProvider === "agy"}
                  icon={
                    <ProviderIcon tone="agy">
                      <AntigravityIcon size={19} />
                    </ProviderIcon>
                  }
                  name="Antigravity"
                  onExpandedChange={(expanded) =>
                    setExpandedProvider(expanded ? "agy" : null)
                  }
                  onToggle={(enabled) => void toggleProvider("agy", enabled)}
                  title={
                    <>
                      Antigravity
                      {providerStatuses?.agy.version ? (
                        <code>{providerStatuses.agy.version}</code>
                      ) : null}
                    </>
                  }
                  trailing={
                    providerInstalling === "agy" ? (
                      <Button
                        aria-label={t("appSettings.installingProvider", {
                          provider: "Antigravity",
                        })}
                        disabled
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <LoaderCircle className="spin" />
                        {t("appSettings.installing")}
                      </Button>
                    ) : providerStatuses?.agy.installed === false ? (
                      <Button
                        aria-label={t("appSettings.installProvider", {
                          provider: "Antigravity",
                        })}
                        onClick={() => void installProvider("agy")}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Download />
                        {t("appSettings.install")}
                      </Button>
                    ) : providerSaving === "agy" ? (
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
                    providerStatuses?.opencode.installed &&
                      providerStatuses.opencode.authenticated,
                  )}
                  description={providerDescription({
                    authenticated: providerStatuses?.opencode.authenticated,
                    enabled: providerSettings?.opencode ?? false,
                    installed: providerStatuses?.opencode.installed,
                    loading: providersLoading && !providerStatuses,
                    providerName: "OpenCode CLI",
                    t,
                  }) +
                    (providerStatuses?.opencode.installed &&
                    openCodeTerminalPath?.supported
                      ? ` ${t(
                          openCodeTerminalPath.configured
                            ? "appSettings.terminalPathReady"
                            : "appSettings.terminalPathNeeded",
                        )}`
                      : "")}
                  disabled={
                    providerSaving !== null || providerInstalling !== null
                  }
                  details={
                    <ProviderDetails
                      authenticated={providerStatuses?.opencode.authenticated}
                      installed={providerStatuses?.opencode.installed}
                      loading={providersLoading && !providerStatuses}
                      loginOpening={providerLoginOpening === "opencode"}
                      models={providerModels.opencode}
                      onLogin={() => void openProviderLogin("opencode")}
                      providerName="OpenCode"
                    />
                  }
                  detailsId="provider-opencode-details"
                  detailsLabel={t("appSettings.toggleProviderDetails", { provider: "OpenCode" })}
                  enabled={providerSettings?.opencode ?? false}
                  expanded={expandedProvider === "opencode"}
                  icon={
                    <ProviderIcon tone="opencode">
                      <OpenCodeIcon size={19} />
                    </ProviderIcon>
                  }
                  name="OpenCode"
                  onExpandedChange={(expanded) =>
                    setExpandedProvider(expanded ? "opencode" : null)
                  }
                  onToggle={(enabled) =>
                    void toggleProvider("opencode", enabled)
                  }
                  title={
                    <>
                      OpenCode
                      {providerStatuses?.opencode.version ? (
                        <code>{providerStatuses.opencode.version}</code>
                      ) : null}
                    </>
                  }
                  trailing={
                    providerInstalling === "opencode" ? (
                      <Button
                        aria-label={t("appSettings.installingProvider", {
                          provider: "OpenCode",
                        })}
                        disabled
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <LoaderCircle className="spin" />
                        {t("appSettings.installing")}
                      </Button>
                    ) : providerStatuses?.opencode.installed === false ? (
                      <Button
                        aria-label={t("appSettings.installProvider", {
                          provider: "OpenCode",
                        })}
                        onClick={() => void installProvider("opencode")}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Download />
                        {t("appSettings.install")}
                      </Button>
                    ) : openCodeTerminalPath?.supported &&
                      !openCodeTerminalPath.configured ? (
                      <Button
                        aria-label={t("appSettings.configureTerminalPathLabel")}
                        disabled={terminalPathSaving}
                        onClick={() => void configureTerminalPath()}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {terminalPathSaving ? (
                          <LoaderCircle className="spin" />
                        ) : (
                          <SquareTerminal />
                        )}
                        {t(
                          terminalPathSaving
                            ? "appSettings.configuringTerminalPath"
                            : "appSettings.configureTerminalPath",
                        )}
                      </Button>
                    ) : providerSaving === "opencode" ? (
                      <LoaderCircle
                        aria-label={t("common.saving")}
                        className="spin"
                        size={16}
                      />
                    ) : null
                  }
                />
              </SettingsCard>

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

function ProviderDetails({
  authenticated,
  installed,
  loading,
  loginOpening,
  models,
  onLogin,
  providerName,
  usage,
}: {
  authenticated?: boolean;
  installed?: boolean;
  loading: boolean;
  loginOpening: boolean;
  models: AgentProviderModelCatalogEntry;
  onLogin: () => void;
  providerName: string;
  usage?: AgentUsageProvider;
}) {
  const { t } = useI18n();
  const connected = Boolean(installed && authenticated);
  const connectionLabel = loading
    ? t("appSettings.checkingProviders")
    : !installed
      ? t("appSettings.providerCliNotInstalled")
      : connected
        ? usage?.accountLabel ?? t("usage.systemAccount")
        : t("usage.signInRequired");

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <section aria-label={t("appSettings.accountConnection")} className="grid content-start gap-3">
        <div>
          <Typography as="h3" variant="bodySm" className="font-semibold">
            {t("appSettings.accountConnection")}
          </Typography>
          <Typography as="p" tone="muted" variant="caption" className="mt-1">
            {t("appSettings.accountConnectionDescription", { provider: providerName })}
          </Typography>
        </div>
        <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border/80 bg-card px-3 py-3">
          {loading ? (
            <LoaderCircle aria-hidden="true" className="spin shrink-0 text-muted-foreground" size={18} />
          ) : (
            <CircleCheck
              aria-hidden="true"
              className={connected ? "shrink-0 text-success" : "shrink-0 text-warning"}
              size={18}
            />
          )}
          <div className="min-w-0 flex-1">
            <Typography as="strong" variant="bodySm">
              {loading
                ? t("appSettings.checkingProviders")
                : connected
                  ? t("appSettings.accountConnected")
                  : t("appSettings.accountNotConnected")}
            </Typography>
            <Typography as="p" className="truncate" tone="muted" variant="caption">
              {connectionLabel}
            </Typography>
          </div>
          <Button
            disabled={!installed || loginOpening}
            onClick={onLogin}
            size="sm"
            type="button"
            variant="outline"
          >
            {loginOpening ? <LoaderCircle className="spin" /> : null}
            {connected ? t("usage.reauthenticate") : t("usage.signInAction")}
          </Button>
        </div>
        {usage?.error ? (
          <Typography as="p" className="text-warning" variant="caption">
            {usage.error}
          </Typography>
        ) : null}
      </section>

      <section aria-label={t("appSettings.supportedModels")} className="min-w-0">
        <div className="flex items-center justify-between gap-3">
          <Typography as="h3" variant="bodySm" className="font-semibold">
            {t("appSettings.supportedModels")}
          </Typography>
          <Typography tone="muted" variant="caption">
            {t("appSettings.modelCount", { count: models.models.length })}
          </Typography>
        </div>
        {models.error ? (
          <Typography as="p" className="mt-1 text-warning" variant="caption">
            {t("appSettings.modelListFallback")}
          </Typography>
        ) : null}
        {models.models.length > 0 ? (
          <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-border/80 bg-card">
            {models.models.map((model) => (
              <div
                className="flex min-w-0 items-center gap-3 border-b border-border/70 px-3 py-2.5 last:border-b-0"
                key={model.id}
              >
                <div className="min-w-0 flex-1">
                  <Typography as="strong" className="block truncate" variant="bodySm">
                    {model.label}
                  </Typography>
                  {model.label !== model.id ? (
                    <code className="block truncate text-xs text-muted-foreground">{model.id}</code>
                  ) : null}
                </div>
                {model.isDefault ? (
                  <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                    {t("appSettings.defaultModel")}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <Typography as="p" className="mt-3 rounded-lg border border-dashed border-border px-3 py-4" tone="muted" variant="bodySm">
            {t("appSettings.noSupportedModels")}
          </Typography>
        )}
      </section>
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
