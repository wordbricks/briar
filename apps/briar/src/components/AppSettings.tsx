import {
  CircleCheck,
  ChevronDown,
  Download,
  Github,
  GitBranch,
  Moon,
  RefreshCw,
  Settings2,
  SquareTerminal,
  Star,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
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
  loadOpenRouterCredentialStatus,
  updateAppProviderSettings,
  updateOpenRouterApiKey,
  type AgentProvider,
  type AgentProviderModelCatalogEntry,
  type AppProviderSettings,
  type OpenRouterCredentialStatus,
  defaultAgentProviderModelCatalog,
  sortAgentModelsByPreference,
} from "../lib/project-llm";
import {
  readAgentProviderModelPreferences,
  writeAgentProviderModelPreference,
  type AgentProviderModelPreference,
} from "../lib/agent-model-preferences";
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
  OpenRouterIcon,
} from "./AgentIcons";
import { MacSecurePasswordInput } from "./MacSecurePasswordInput";
import { AgentUsageSettings } from "./AgentUsageSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { InboxNotificationSettings } from "./InboxNotificationSettings";
import type { RepositoryReadiness } from "../lib/project-connection";
import {
  localProjectReadiness,
  type LocalProjectConnectionState,
} from "../lib/local-project-connection";
import type { AgentUsageReport, SessionUser } from "../types";
import { AccountDeletionSettings } from "./AccountDeletionSettings";
import { AccountProfileSettings } from "./AccountProfileSettings";
import { BrowserSettings } from "./BrowserSettings";
import { KeybindingsSettings } from "./KeybindingsSettings";
import { NativeSelect } from "./NativeSelect";
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
  connectionState,
  error,
  initialSection = "source-control",
  isSidebarOpen,
  loading,
  navigationSidebar,
  onBack,
  onAccountDelete,
  onAccountSave,
  onLoadUsageReport,
  onSectionChange,
  onRefresh,
  projectId,
  projectName,
  readiness,
  requiresLocalReadiness,
  usageScopeKey,
  user,
}: {
  connectionState: LocalProjectConnectionState;
  error: string | null;
  initialSection?: SettingsSection;
  isSidebarOpen: boolean;
  loading: boolean;
  navigationSidebar?: ReactNode;
  onBack: () => void;
  onAccountDelete?: (confirmation: string) => Promise<void>;
  onAccountSave?: (input: {
    username: string | null;
    name: string;
    image: string | null;
  }) => Promise<SessionUser>;
  onLoadUsageReport?: () => Promise<AgentUsageReport>;
  onSectionChange?: (section: SettingsSection) => void;
  onRefresh: () => Promise<unknown>;
  projectId: string;
  projectName: string;
  readiness: RepositoryReadiness | null;
  requiresLocalReadiness: boolean;
  usageScopeKey?: string;
  user?: SessionUser;
}) {
  const { t } = useI18n();
  const inspectedReadiness = requiresLocalReadiness
    ? localProjectReadiness(connectionState, readiness)
    : null;
  const githubRequired = inspectedReadiness?.requiresGithub === true;
  const unresolvedReadiness = connectionState === "disconnected"
    ? t("common.notConnected")
    : t("common.checkNeeded");
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
  const [providerModelPreferences, setProviderModelPreferences] = useState(
    readAgentProviderModelPreferences,
  );
  const [openRouterCredential, setOpenRouterCredential] =
    useState<OpenRouterCredentialStatus>({ configured: false });
  const [openRouterApiKey, setOpenRouterApiKey] = useState("");
  const [openRouterKeySaving, setOpenRouterKeySaving] = useState(false);
  const [runtimeSettings, setRuntimeSettings] =
    useState<AppRuntimeSettings | null>(null);
  const [runtimeSettingsLoading, setRuntimeSettingsLoading] = useState(false);
  const [runtimeSettingsSaving, setRuntimeSettingsSaving] = useState(false);
  const [runtimeSettingsError, setRuntimeSettingsError] =
    useState<string | null>(null);

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  const selectSection = useCallback(
    (section: SettingsSection) => {
      setActiveSection(section);
      onSectionChange?.(section);
    },
    [onSectionChange],
  );

  useEffect(() => {
    setGitEnabled(readProviderPreference(projectId, "git"));
    setGithubEnabled(readProviderPreference(projectId, "github"));
  }, [projectId]);

  const refreshProviders = useCallback(async () => {
    setProvidersLoading(true);
    setProviderError(null);
    try {
      const [statuses, settings, usage, models, terminalPath, openRouterStatus] = await Promise.all([
        inspectOnboardingPrerequisites(),
        loadAppProviderSettings(),
        loadAgentUsage().catch(() => null),
        loadAgentProviderModels({ refresh: true }).catch(
          () => defaultAgentProviderModelCatalog,
        ),
        inspectOpenCodeTerminalPath().catch(() => null),
        loadOpenRouterCredentialStatus(),
      ]);
      setProviderStatuses(statuses);
      setProviderSettings(settings);
      setProviderUsage(usage);
      setProviderModels(models);
      setOpenCodeTerminalPath(terminalPath);
      setOpenRouterCredential(openRouterStatus);
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

  const updateProviderModelPreference = (
    provider: AgentProvider,
    update: (current: AgentProviderModelPreference) => AgentProviderModelPreference,
  ) => {
    setProviderModelPreferences(
      writeAgentProviderModelPreference(
        provider,
        update(providerModelPreferences[provider]),
      ),
    );
  };

  const providerModelPreferenceProps = (provider: AgentProvider) => ({
    modelPreference: providerModelPreferences[provider],
    onDefaultModelChange: (model: string) =>
      updateProviderModelPreference(provider, (current) => ({
        ...current,
        defaultModel: model || null,
      })),
    onToggleFavorite: (model: string) =>
      updateProviderModelPreference(provider, (current) => ({
        ...current,
        favoriteModels: current.favoriteModels.includes(model)
          ? current.favoriteModels.filter((favorite) => favorite !== model)
          : [...current.favoriteModels, model],
      })),
  });

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

  const saveOpenRouterApiKey = async (apiKey: string | null) => {
    if (openRouterKeySaving) return;
    setOpenRouterKeySaving(true);
    setProviderError(null);
    try {
      setOpenRouterCredential(await updateOpenRouterApiKey(apiKey));
      setOpenRouterApiKey("");
      setProviderStatuses(await inspectOnboardingPrerequisites());
      setProviderModels(
        await loadAgentProviderModels({ refresh: true }).catch(
          () => defaultAgentProviderModelCatalog,
        ),
      );
    } catch (caught) {
      setProviderError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setOpenRouterKeySaving(false);
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
                  onClick={() => selectSection(item.id)}
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
              onManageAccounts={() => selectSection("providers")}
              onLoadUsageReport={onLoadUsageReport}
              usageScopeKey={usageScopeKey}
            />
          ) : activeSection === "notifications" ? (
            <SettingsContent>
              <SettingsGroupHeading title={t("notifications.preferences")} />
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
                        <Spinner size={16} />
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
                      {...providerModelPreferenceProps("codex")}
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
                        <Spinner />
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
                      <Spinner
                        aria-label={t("common.saving")}
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
                      {...providerModelPreferenceProps("claude")}
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
                        <Spinner />
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
                      <Spinner
                        aria-label={t("common.saving")}
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
                      {...providerModelPreferenceProps("cursor")}
                      authenticated={providerStatuses?.cursor.authenticated}
                      installed={providerStatuses?.cursor.installed}
                      loading={providersLoading && !providerStatuses}
                      loginOpening={providerLoginOpening === "cursor"}
                      models={providerModels.cursor}
                      onLogin={() => void openProviderLogin("cursor")}
                      providerName="Cursor"
                      usage={providerUsage?.cursor}
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
                        <Spinner />
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
                      <Spinner
                        aria-label={t("common.saving")}
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
                      {...providerModelPreferenceProps("grok")}
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
                        <Spinner />
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
                      <Spinner
                        aria-label={t("common.saving")}
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
                      {...providerModelPreferenceProps("agy")}
                      authenticated={providerStatuses?.agy.authenticated}
                      installed={providerStatuses?.agy.installed}
                      loading={providersLoading && !providerStatuses}
                      loginOpening={providerLoginOpening === "agy"}
                      models={providerModels.agy}
                      onLogin={() => void openProviderLogin("agy")}
                      providerName="Antigravity"
                      usage={providerUsage?.agy}
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
                        <Spinner />
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
                      <Spinner
                        aria-label={t("common.saving")}
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
                      {...providerModelPreferenceProps("opencode")}
                      authenticated={providerStatuses?.opencode.authenticated}
                      installed={providerStatuses?.opencode.installed}
                      loading={providersLoading && !providerStatuses}
                      loginOpening={providerLoginOpening === "opencode"}
                      models={providerModels.opencode}
                      onLogin={() => void openProviderLogin("opencode")}
                      providerName="OpenCode"
                      usage={providerUsage?.opencode}
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
                        <Spinner />
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
                          <Spinner />
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
                      <Spinner
                        aria-label={t("common.saving")}
                        size={16}
                      />
                    ) : null
                  }
                />
                <ProviderRow
                  available={Boolean(
                    providerStatuses?.openrouter.installed &&
                      providerStatuses.openrouter.authenticated,
                  )}
                  description={providerDescription({
                    authenticated: providerStatuses?.openrouter.authenticated,
                    enabled: providerSettings?.openrouter ?? false,
                    installed: providerStatuses?.openrouter.installed,
                    loading: providersLoading && !providerStatuses,
                    providerName: "OpenRouter",
                    t,
                  })}
                  disabled={
                    providerSaving !== null ||
                    providerInstalling !== null ||
                    openRouterKeySaving
                  }
                  details={
                    <OpenRouterDetails
                      {...providerModelPreferenceProps("openrouter")}
                      apiKey={openRouterApiKey}
                      configured={openRouterCredential.configured}
                      installed={providerStatuses?.openrouter.installed}
                      loading={providersLoading && !providerStatuses}
                      models={providerModels.openrouter}
                      onApiKeyChange={setOpenRouterApiKey}
                      onRemove={() => void saveOpenRouterApiKey(null)}
                      onSave={() => void saveOpenRouterApiKey(openRouterApiKey)}
                      saving={openRouterKeySaving}
                    />
                  }
                  detailsId="provider-openrouter-details"
                  detailsLabel={t("appSettings.toggleProviderDetails", {
                    provider: "OpenRouter",
                  })}
                  enabled={providerSettings?.openrouter ?? false}
                  expanded={expandedProvider === "openrouter"}
                  icon={
                    <ProviderIcon tone="openrouter">
                      <OpenRouterIcon size={20} />
                    </ProviderIcon>
                  }
                  name="OpenRouter"
                  onExpandedChange={(expanded) =>
                    setExpandedProvider(expanded ? "openrouter" : null)
                  }
                  onToggle={(enabled) =>
                    void toggleProvider("openrouter", enabled)
                  }
                  title={
                    <>
                      OpenRouter
                      {providerStatuses?.openrouter.version ? (
                        <code>{providerStatuses.openrouter.version}</code>
                      ) : null}
                    </>
                  }
                  trailing={
                    providerInstalling === "openrouter" ? (
                      <Button disabled size="sm" type="button" variant="outline">
                        <Spinner />
                        {t("appSettings.installing")}
                      </Button>
                    ) : providerStatuses?.openrouter.installed === false ? (
                      <Button
                        aria-label={t("appSettings.installProvider", {
                          provider: "OpenRouter runtime",
                        })}
                        onClick={() => void installProvider("openrouter")}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Download />
                        {t("appSettings.install")}
                      </Button>
                    ) : providerSaving === "openrouter" || openRouterKeySaving ? (
                      <Spinner
                        aria-label={t("common.saving")}
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
                  requiresLocalReadiness ? (
                    <SettingsIconButton
                      aria-label={t("appSettings.refresh")}
                      disabled={loading}
                      onClick={() => void onRefresh()}
                      title={t("appSettings.refresh")}
                    >
                      {loading ? (
                        <Spinner size={16} />
                      ) : (
                        <RefreshCw size={16} />
                      )}
                    </SettingsIconButton>
                  ) : undefined
                }
                title={t("appSettings.versionControl")}
              />

              {requiresLocalReadiness ? (
                <>
              <SettingsCard>
                <ProviderRow
                  available={inspectedReadiness?.gitInstalled ?? false}
                  availabilityLabel={
                    inspectedReadiness ? undefined : unresolvedReadiness
                  }
                  description={
                    inspectedReadiness
                      ? inspectedReadiness.gitInstalled
                        ? t("appSettings.available")
                        : t("appSettings.notInstalled")
                      : unresolvedReadiness
                  }
                  enabled={Boolean(
                    inspectedReadiness?.gitInstalled && gitEnabled,
                  )}
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
                  statusTone={inspectedReadiness ? undefined : "neutral"}
                  title={
                    <>
                      Git
                      {inspectedReadiness?.gitVersion ? (
                        <code>{inspectedReadiness.gitVersion}</code>
                      ) : null}
                    </>
                  }
                  trailing={
                    inspectedReadiness?.gitInstalled ? (
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
                {gitExpanded && inspectedReadiness ? (
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
                        {inspectedReadiness.repositoryPath}
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
                        {inspectedReadiness.remote ??
                          t("appSettings.notConnected")}
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
                  available={Boolean(
                    githubRequired && inspectedReadiness?.githubRepository,
                  )}
                  availabilityLabel={
                    !inspectedReadiness
                      ? unresolvedReadiness
                      : !githubRequired
                        ? t("common.optional")
                        : undefined
                  }
                  description={
                    !inspectedReadiness
                      ? unresolvedReadiness
                      : !githubRequired
                        ? t("appSettings.githubNotRequired")
                        : inspectedReadiness.githubRepository
                          ? t("appSettings.githubAppReady")
                          : t("appSettings.githubAppUnavailable")
                  }
                  enabled={Boolean(
                    githubRequired &&
                      inspectedReadiness?.githubRepository &&
                      githubEnabled,
                  )}
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
                  statusTone={
                    !inspectedReadiness || !githubRequired
                      ? "neutral"
                      : undefined
                  }
                  title={
                    <>
                      GitHub
                      {inspectedReadiness?.githubRepository ? (
                        <code>{inspectedReadiness.githubRepository}</code>
                      ) : null}
                    </>
                  }
                />
              </SettingsCard>

              {error ? <SettingsAlert>{error}</SettingsAlert> : null}
              <SettingsNote>
                {t("appSettings.projectScope", { project: projectName })}
              </SettingsNote>
                </>
              ) : (
                <SettingsNote>{t("health.desktopOnly")}</SettingsNote>
              )}
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

function ProviderModelsSettings({
  loading,
  modelPreference,
  models,
  onDefaultModelChange,
  onToggleFavorite,
}: {
  loading: boolean;
  modelPreference: AgentProviderModelPreference;
  models: AgentProviderModelCatalogEntry;
  onDefaultModelChange: (model: string) => void;
  onToggleFavorite: (model: string) => void;
}) {
  const { t } = useI18n();
  const orderedModels = sortAgentModelsByPreference(
    models.models,
    modelPreference.favoriteModels,
  );
  const defaultModelKnown = !modelPreference.defaultModel || models.models.some(
    (model) => model.id === modelPreference.defaultModel,
  );
  const defaultModelOptions = [
    { label: t("settings.providerDefaultModel"), value: "" },
    ...(!defaultModelKnown && modelPreference.defaultModel
      ? [{
          label: modelPreference.defaultModel,
          value: modelPreference.defaultModel,
        }]
      : []),
    ...orderedModels.map((model) => ({
      description: model.label === model.id ? undefined : model.id,
      label: model.label,
      value: model.id,
    })),
  ];

  return (
    <section aria-label={t("appSettings.supportedModels")} className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <Typography as="h3" className="font-semibold" variant="bodySm">
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
      <div className="mt-3 grid gap-1.5">
        <Typography as="span" className="font-medium" variant="caption">
          {t("appSettings.defaultModel")}
        </Typography>
        <NativeSelect
          disabled={loading}
          label={t("appSettings.defaultModel")}
          onValueChange={onDefaultModelChange}
          options={defaultModelOptions}
          searchable={models.models.length > 8}
          searchEmptyMessage={t("issue.noModelsFound")}
          searchPlaceholder={t("issue.searchModels")}
          value={modelPreference.defaultModel ?? ""}
        />
        <Typography as="p" tone="muted" variant="caption">
          {t("appSettings.defaultModelDescription")}
        </Typography>
      </div>
      {loading ? (
        <Typography as="p" className="mt-3" tone="muted" variant="bodySm">
          {t("appSettings.checkingProviders")}
        </Typography>
      ) : orderedModels.length > 0 ? (
        <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-border/80 bg-card">
          {orderedModels.map((model) => {
            const favorite = modelPreference.favoriteModels.includes(model.id);
            return (
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
                {modelPreference.defaultModel === model.id ? (
                  <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                    {t("appSettings.defaultModel")}
                  </span>
                ) : model.isDefault ? (
                  <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                    {t("settings.providerDefaultModel")}
                  </span>
                ) : null}
                <Button
                  aria-label={t(
                    favorite
                      ? "appSettings.removeFavoriteModel"
                      : "appSettings.addFavoriteModel",
                    { model: model.label },
                  )}
                  aria-pressed={favorite}
                  className={favorite ? "text-warning" : "text-muted-foreground"}
                  onClick={() => onToggleFavorite(model.id)}
                  size="icon-sm"
                  title={t(
                    favorite
                      ? "appSettings.removeFavoriteModel"
                      : "appSettings.addFavoriteModel",
                    { model: model.label },
                  )}
                  type="button"
                  variant="ghost"
                >
                  <Star fill={favorite ? "currentColor" : "none"} />
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <Typography as="p" className="mt-3 rounded-lg border border-dashed border-border px-3 py-4" tone="muted" variant="bodySm">
          {t("appSettings.noSupportedModels")}
        </Typography>
      )}
      <Typography as="p" className="mt-2" tone="muted" variant="caption">
        {t("appSettings.favoriteModelDescription")}
      </Typography>
    </section>
  );
}

function OpenRouterDetails({
  apiKey,
  configured,
  installed,
  loading,
  modelPreference,
  models,
  onApiKeyChange,
  onDefaultModelChange,
  onRemove,
  onSave,
  onToggleFavorite,
  saving,
}: {
  apiKey: string;
  configured: boolean;
  installed?: boolean;
  loading: boolean;
  modelPreference: AgentProviderModelPreference;
  models: AgentProviderModelCatalogEntry;
  onApiKeyChange: (value: string) => void;
  onDefaultModelChange: (model: string) => void;
  onRemove: () => void;
  onSave: () => void;
  onToggleFavorite: (model: string) => void;
  saving: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <section className="grid content-start gap-3">
        <div>
          <Typography as="h3" className="font-semibold" variant="bodySm">
            {t("appSettings.openrouterApiKey")}
          </Typography>
          <Typography as="p" className="mt-1" tone="muted" variant="caption">
            {t("appSettings.openrouterApiKeyHelp")}
          </Typography>
        </div>
        <Typography as="p" tone={configured ? "default" : "muted"} variant="caption">
          {t(
            configured
              ? "appSettings.openrouterApiKeyConfigured"
              : "appSettings.openrouterApiKeyMissing",
          )}
        </Typography>
        <MacSecurePasswordInput
          aria-label={t("appSettings.openrouterApiKey")}
          autoCapitalize="none"
          autoComplete="off"
          className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={!installed || saving}
          onChange={(event) => onApiKeyChange(event.target.value)}
          placeholder={t("appSettings.openrouterApiKeyPlaceholder")}
          secureInputEligible={Boolean(installed && !saving)}
          spellCheck={false}
          value={apiKey}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!installed || saving || apiKey.trim().length < 10}
            onClick={onSave}
            size="sm"
            type="button"
          >
            {saving ? <Spinner /> : null}
            {t("common.save")}
          </Button>
          {configured ? (
            <Button
              disabled={saving}
              onClick={onRemove}
              size="sm"
              type="button"
              variant="outline"
            >
              {t("appSettings.openrouterApiKeyRemove")}
            </Button>
          ) : null}
        </div>
      </section>
      <ProviderModelsSettings
        loading={loading}
        modelPreference={modelPreference}
        models={models}
        onDefaultModelChange={onDefaultModelChange}
        onToggleFavorite={onToggleFavorite}
      />
    </div>
  );
}

function ProviderDetails({
  authenticated,
  installed,
  loading,
  loginOpening,
  modelPreference,
  models,
  onDefaultModelChange,
  onLogin,
  onToggleFavorite,
  providerName,
  usage,
}: {
  authenticated?: boolean;
  installed?: boolean;
  loading: boolean;
  loginOpening: boolean;
  modelPreference: AgentProviderModelPreference;
  models: AgentProviderModelCatalogEntry;
  onDefaultModelChange: (model: string) => void;
  onLogin: () => void;
  onToggleFavorite: (model: string) => void;
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
            <Spinner aria-hidden="true" className="shrink-0 text-muted-foreground" size={18} />
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
            {loginOpening ? <Spinner /> : null}
            {connected ? t("usage.reauthenticate") : t("usage.signInAction")}
          </Button>
        </div>
        {usage?.error ? (
          <Typography as="p" className="text-warning" variant="caption">
            {usage.error}
          </Typography>
        ) : null}
      </section>

      <ProviderModelsSettings
        loading={loading}
        modelPreference={modelPreference}
        models={models}
        onDefaultModelChange={onDefaultModelChange}
        onToggleFavorite={onToggleFavorite}
      />
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
