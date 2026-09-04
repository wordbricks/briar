import {
  CircleCheck,
  ChevronDown,
  Download,
  ExternalLink,
  Github,
  GitBranch,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SquareTerminal,
  Star,
  Trash2,
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
} from "../lib/initial-onboarding";
import {
  addProvider,
  loadAddedProviders,
  loadAppProviderSettings,
  loadAgentProviderModels,
  loadOpenRouterCredentialStatus,
  loadVertexAiCredentialStatus,
  removeProvider,
  updateAppProviderSettings,
  updateOpenRouterApiKey,
  updateVertexAiSettings,
  type AgentProvider,
  type AgentProviderModelCatalogEntry,
  defaultAgentProviderModelCatalog,
  sortAgentModelsByPreference,
} from "../lib/team-llm";
import {
  addableProviders,
  agentProviderCatalog,
  agentProviderLabels,
  agentProviders,
  isAgentProviderBuiltIn,
  sortAgentProviders,
} from "../lib/agent-provider";
import type { MessageKey } from "../i18n/messages";
import {
  readAgentProviderModelPreferences,
  writeAgentProviderModelPreference,
  type AgentProviderModelPreference,
} from "../lib/agent-model-preferences";
import {
  loadAppRuntimeSettings,
  updateAppRuntimeSettings,
} from "../lib/app-runtime-settings";
import {
  loadAgentUsage,
  openAgentProviderLogin,
} from "../lib/agent-usage";
import type {
  AgentLoginProvider,
  AgentUsageSnapshot,
  AppProviderSettings,
  AppRuntimeSettings,
  OnboardingPrerequisites,
  OpenCodeTerminalPathStatus,
  OpenRouterCredentialStatus,
  VertexAiCredentialStatus,
  ProviderUsage,
  RepositoryReadiness,
} from "../generated/tauri";
import { AgentProviderIcon } from "./AgentIcons";
import { MacSecurePasswordInput } from "./MacSecurePasswordInput";
import { AgentUsageSettings } from "./AgentUsageSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { InboxNotificationSettings } from "./InboxNotificationSettings";
import {
  localTeamReadiness,
  type LocalTeamConnectionState,
} from "../lib/local-team-connection";
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

/**
 * How one provider is drawn in settings: the artwork size its icon needs, the
 * names the status line and install button use, its one-line description, and
 * which expanded panel it gets.
 *
 * A total record over the proto enum, so a provider added to the catalog fails
 * typecheck here instead of reaching the list without a panel.
 */
type ProviderPresentation = {
  /** Size that matches this provider's artwork in a 30px tile. */
  readonly iconSize: number;
  /** How the status line names the provider ("Codex CLI"). */
  readonly cliName: string;
  /** How the install button names it; an upstream installs OpenCode. */
  readonly installName: string;
  readonly descriptionKey: MessageKey;
} & (
  | { readonly details: "account"; readonly loginProvider: AgentLoginProvider }
  | { readonly details: "openrouter" }
  | { readonly details: "vertex" }
);

const providerPresentation = {
  codex: {
    details: "account",
    loginProvider: "codex",
    iconSize: 20,
    cliName: "Codex CLI",
    installName: "Codex",
    descriptionKey: "providers.codex.description",
  },
  claude: {
    details: "account",
    loginProvider: "claude",
    iconSize: 19,
    cliName: "Claude Code",
    installName: "Claude",
    descriptionKey: "providers.claude.description",
  },
  cursor: {
    details: "account",
    loginProvider: "cursor",
    iconSize: 19,
    cliName: "Cursor CLI",
    installName: "Cursor",
    descriptionKey: "providers.cursor.description",
  },
  grok: {
    details: "account",
    loginProvider: "grok",
    iconSize: 19,
    cliName: "Grok CLI",
    installName: "Grok",
    descriptionKey: "providers.grok.description",
  },
  agy: {
    details: "account",
    loginProvider: "agy",
    iconSize: 19,
    cliName: "Google Antigravity CLI",
    installName: "Antigravity",
    descriptionKey: "providers.agy.description",
  },
  opencode: {
    details: "account",
    loginProvider: "opencode",
    iconSize: 19,
    cliName: "OpenCode CLI",
    installName: "OpenCode",
    descriptionKey: "providers.opencode.description",
  },
  openrouter: {
    details: "openrouter",
    iconSize: 20,
    cliName: "OpenRouter",
    installName: "OpenRouter runtime",
    descriptionKey: "providers.openrouter.description",
  },
  vertex: {
    details: "vertex",
    iconSize: 20,
    cliName: "Vertex AI",
    installName: "Vertex AI runtime",
    descriptionKey: "providers.vertex.description",
  },
} as const satisfies Record<AgentProvider, ProviderPresentation>;

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
  connectionState: LocalTeamConnectionState;
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
    ? localTeamReadiness(connectionState, readiness)
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
  const [addedProviders, setAddedProviders] = useState<AgentProvider[]>([]);
  const [addProviderQuery, setAddProviderQuery] = useState("");
  const [providerAdding, setProviderAdding] = useState<AgentProvider | null>(null);
  const [providerRemoving, setProviderRemoving] =
    useState<AgentProvider | null>(null);
  const [providerRemoveConfirm, setProviderRemoveConfirm] =
    useState<AgentProvider | null>(null);
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
  const [vertexCredential, setVertexCredential] =
    useState<VertexAiCredentialStatus>({
      configured: false,
      projectId: null,
      location: null,
    });
  const [vertexProjectId, setVertexProjectId] = useState("");
  const [vertexLocation, setVertexLocation] = useState("");
  const [vertexSaving, setVertexSaving] = useState(false);
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
      const [
        statuses,
        settings,
        added,
        usage,
        models,
        terminalPath,
        openRouterStatus,
        vertexStatus,
      ] = await Promise.all([
        inspectOnboardingPrerequisites(),
        loadAppProviderSettings(),
        loadAddedProviders(),
        loadAgentUsage().catch(() => null),
        loadAgentProviderModels({ refresh: true }).catch(
          () => defaultAgentProviderModelCatalog,
        ),
        inspectOpenCodeTerminalPath().catch(() => null),
        loadOpenRouterCredentialStatus(),
        loadVertexAiCredentialStatus(),
      ]);
      setProviderStatuses(statuses);
      setProviderSettings(settings);
      setAddedProviders(added);
      setProviderUsage(usage);
      setProviderModels(models);
      setOpenCodeTerminalPath(terminalPath);
      setOpenRouterCredential(openRouterStatus);
      setVertexCredential(vertexStatus);
      setVertexProjectId(vertexStatus.projectId ?? "");
      setVertexLocation(vertexStatus.location ?? "");
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

  const addedProviderSet = useMemo(
    () => new Set(addedProviders),
    [addedProviders],
  );

  /** Built-in providers plus the ones this machine added, in menu order. */
  const visibleProviders = useMemo(
    () =>
      sortAgentProviders(
        agentProviders.filter((provider) =>
          isAgentProviderBuiltIn(provider) || addedProviderSet.has(provider),
        ),
      ),
    [addedProviderSet],
  );

  const addableMatches = useMemo(() => {
    const query = addProviderQuery.trim().toLocaleLowerCase();
    return addableProviders.filter((provider) => {
      if (addedProviderSet.has(provider)) return false;
      if (!query) return true;
      const haystack = `${agentProviderLabels[provider]} ${
        t(providerPresentation[provider].descriptionKey)
      }`;
      return haystack.toLocaleLowerCase().includes(query);
    });
  }, [addProviderQuery, addedProviderSet, t]);

  const addProviderToMachine = async (provider: AgentProvider) => {
    if (providerAdding || providerRemoving) return;
    setProviderAdding(provider);
    setProviderError(null);
    try {
      setAddedProviders(await addProvider(provider));
      setProviderSettings(await loadAppProviderSettings());
      setAddProviderQuery("");
      setExpandedProvider(provider);
    } catch (caught) {
      setProviderError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setProviderAdding(null);
    }
  };

  const removeProviderFromMachine = async (provider: AgentProvider) => {
    if (providerAdding || providerRemoving) return;
    setProviderRemoving(provider);
    setProviderError(null);
    try {
      setAddedProviders(await removeProvider(provider));
      setProviderSettings(await loadAppProviderSettings());
      setProviderRemoveConfirm(null);
      setExpandedProvider((current) =>
        current === provider ? null : current
      );
    } catch (caught) {
      setProviderError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setProviderRemoving(null);
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

  const openProviderLogin = async (provider: AgentLoginProvider) => {
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

  const saveVertexAiSettings = async (
    projectId: string | null,
    location: string | null,
  ) => {
    if (vertexSaving) return;
    setVertexSaving(true);
    setProviderError(null);
    try {
      const saved = await updateVertexAiSettings(projectId, location);
      setVertexCredential(saved);
      setVertexProjectId(saved.projectId ?? "");
      setVertexLocation(saved.location ?? "");
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
      setVertexSaving(false);
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

  /**
   * The expanded panel of one provider. The renderer is chosen by the
   * provider's presentation entry, which is a total record over the proto
   * enum, so a new provider cannot reach the list without a panel.
   */
  const providerDetailsNode = (provider: AgentProvider) => {
    const presentation = providerPresentation[provider];
    const status = providerStatuses?.[provider];
    const loading = providersLoading && !providerStatuses;
    const preferences = providerModelPreferenceProps(provider);
    switch (presentation.details) {
      case "openrouter":
        return (
          <OpenRouterDetails
            {...preferences}
            apiKey={openRouterApiKey}
            configured={openRouterCredential.configured}
            installed={status?.installed}
            loading={loading}
            models={providerModels[provider]}
            onApiKeyChange={setOpenRouterApiKey}
            onRemove={() => void saveOpenRouterApiKey(null)}
            onSave={() => void saveOpenRouterApiKey(openRouterApiKey)}
            saving={openRouterKeySaving}
          />
        );
      case "vertex":
        return (
          <VertexAiDetails
            {...preferences}
            configured={vertexCredential.configured}
            installed={status?.installed}
            loading={loading}
            location={vertexLocation}
            models={providerModels[provider]}
            onLocationChange={setVertexLocation}
            onProjectIdChange={setVertexProjectId}
            onRemove={() => void saveVertexAiSettings(null, null)}
            onSave={() =>
              void saveVertexAiSettings(vertexProjectId, vertexLocation)}
            projectId={vertexProjectId}
            saving={vertexSaving}
          />
        );
      case "account":
        return (
          <ProviderDetails
            {...preferences}
            authenticated={status?.authenticated}
            installed={status?.installed}
            loading={loading}
            loginOpening={providerLoginOpening === provider}
            models={providerModels[provider]}
            onLogin={() => void openProviderLogin(presentation.loginProvider)}
            providerName={agentProviderLabels[provider]}
            usage={providerUsage?.[provider]}
          />
        );
    }
  };

  const providerRow = (provider: AgentProvider) => {
    const presentation = providerPresentation[provider];
    const status = providerStatuses?.[provider];
    const label = agentProviderLabels[provider];
    const loading = providersLoading && !providerStatuses;
    const credentialSaving = presentation.details === "openrouter"
      ? openRouterKeySaving
      : presentation.details === "vertex"
        ? vertexSaving
        : false;
    const terminalPathSupported = provider === "opencode" &&
      openCodeTerminalPath?.supported === true;
    const terminalPathHint = terminalPathSupported && status?.installed
      ? ` ${t(
        openCodeTerminalPath?.configured
          ? "appSettings.terminalPathReady"
          : "appSettings.terminalPathNeeded",
      )}`
      : "";
    return (
      <ProviderRow
        available={Boolean(status?.installed && status.authenticated)}
        description={providerDescription({
          authenticated: status?.authenticated,
          enabled: providerSettings?.[provider] ?? false,
          installed: status?.installed,
          loading,
          providerName: presentation.cliName,
          t,
        }) + terminalPathHint}
        details={
          <div className="grid gap-5">
            {providerDetailsNode(provider)}
            {addedProviderSet.has(provider) ? (
              <ProviderRemoveSection
                confirming={providerRemoveConfirm === provider}
                label={label}
                onCancel={() => setProviderRemoveConfirm(null)}
                onConfirm={() => void removeProviderFromMachine(provider)}
                onRequest={() => setProviderRemoveConfirm(provider)}
                removing={providerRemoving === provider}
              />
            ) : null}
          </div>
        }
        detailsId={`provider-${provider}-details`}
        detailsLabel={t("appSettings.toggleProviderDetails", {
          provider: label,
        })}
        disabled={
          providerSaving !== null ||
          providerInstalling !== null ||
          providerRemoving !== null ||
          credentialSaving
        }
        enabled={providerSettings?.[provider] ?? false}
        expanded={expandedProvider === provider}
        icon={
          <ProviderIcon tone={provider}>
            <AgentProviderIcon provider={provider} size={presentation.iconSize} />
          </ProviderIcon>
        }
        key={provider}
        name={label}
        onExpandedChange={(expanded) => {
          setExpandedProvider(expanded ? provider : null);
          setProviderRemoveConfirm(null);
        }}
        onToggle={(enabled) => void toggleProvider(provider, enabled)}
        title={
          <>
            {label}
            {status?.version ? <code>{status.version}</code> : null}
          </>
        }
        trailing={providerInstalling === provider ? (
          <Button
            aria-label={t("appSettings.installingProvider", {
              provider: presentation.installName,
            })}
            disabled
            size="sm"
            type="button"
            variant="outline"
          >
            <Spinner className="size-[24px]" />
            {t("appSettings.installing")}
          </Button>
        ) : status?.installed === false ? (
          <Button
            aria-label={t("appSettings.installProvider", {
              provider: presentation.installName,
            })}
            onClick={() => void installProvider(provider)}
            size="sm"
            type="button"
            variant="outline"
          >
            <Download />
            {t("appSettings.install")}
          </Button>
        ) : terminalPathSupported && !openCodeTerminalPath?.configured ? (
          <Button
            aria-label={t("appSettings.configureTerminalPathLabel")}
            disabled={terminalPathSaving}
            onClick={() => void configureTerminalPath()}
            size="sm"
            type="button"
            variant="outline"
          >
            {terminalPathSaving ? (
              <Spinner className="size-[24px]" />
            ) : (
              <SquareTerminal />
            )}
            {t(
              terminalPathSaving
                ? "appSettings.configuringTerminalPath"
                : "appSettings.configureTerminalPath",
            )}
          </Button>
        ) : providerSaving === provider || credentialSaving ? (
          <Spinner
            aria-label={t("common.saving")}
            className="size-[16px]"
          />
        ) : null}
      />
    );
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
                        <Spinner className="size-[16px]" />
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
                  providerInstalling !== null ||
                  providerAdding !== null ||
                  providerRemoving !== null
                }
              >
                {visibleProviders.map((provider) => providerRow(provider))}
              </SettingsCard>

              <SettingsGroupHeading title={t("appSettings.addProvider")} />
              <SettingsCard aria-busy={providerAdding !== null}>
                <div className="border-b border-border/80 px-[18px] py-3">
                  <Typography as="p" tone="muted" variant="bodySm">
                    {t("appSettings.addProviderDescription")}
                  </Typography>
                  <label className="mt-3 flex h-[34px] items-center gap-2 rounded-md border border-border bg-background px-2.5 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
                    <Search aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.9} />
                    <input
                      aria-label={t("appSettings.addProviderSearch")}
                      autoCapitalize="none"
                      autoComplete="off"
                      className="h-full w-full border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                      onChange={(event) => setAddProviderQuery(event.target.value)}
                      placeholder={t("appSettings.addProviderSearchPlaceholder")}
                      spellCheck={false}
                      type="search"
                      value={addProviderQuery}
                    />
                  </label>
                </div>
                {addableMatches.length === 0 ? (
                  <div className="px-[18px] py-4">
                    <Typography as="p" tone="muted" variant="bodySm">
                      {t(
                        addableProviders.every((provider) =>
                          addedProviderSet.has(provider),
                        )
                          ? "appSettings.addProviderEmpty"
                          : "appSettings.addProviderNoMatch",
                      )}
                    </Typography>
                  </div>
                ) : (
                  addableMatches.map((provider) => (
                    <AddProviderRow
                      adding={providerAdding === provider}
                      description={t(providerPresentation[provider].descriptionKey)}
                      disabled={providerAdding !== null || providerRemoving !== null}
                      installUrl={agentProviderCatalog[provider].installUrl}
                      key={provider}
                      label={agentProviderLabels[provider]}
                      onAdd={() => void addProviderToMachine(provider)}
                      provider={provider}
                    />
                  ))
                )}
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
                        <Spinner className="size-[16px]" />
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
            {saving ? <Spinner className="size-[24px]" /> : null}
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

/**
 * Vertex AI is addressed by project and region. It has no API key to store:
 * authentication is the machine's Google Application Default Credentials, so
 * the panel points at `gcloud auth application-default login` instead of asking
 * for a secret.
 */
function VertexAiDetails({
  configured,
  installed,
  loading,
  location,
  modelPreference,
  models,
  onDefaultModelChange,
  onLocationChange,
  onProjectIdChange,
  onRemove,
  onSave,
  onToggleFavorite,
  projectId,
  saving,
}: {
  configured: boolean;
  installed?: boolean;
  loading: boolean;
  location: string;
  modelPreference: AgentProviderModelPreference;
  models: AgentProviderModelCatalogEntry;
  onDefaultModelChange: (model: string) => void;
  onLocationChange: (value: string) => void;
  onProjectIdChange: (value: string) => void;
  onRemove: () => void;
  onSave: () => void;
  onToggleFavorite: (model: string) => void;
  projectId: string;
  saving: boolean;
}) {
  const { t } = useI18n();
  const inputClassName =
    "h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <section className="grid content-start gap-3">
        <div>
          <Typography as="h3" className="font-semibold" variant="bodySm">
            {t("appSettings.vertexProject")}
          </Typography>
          <Typography as="p" className="mt-1" tone="muted" variant="caption">
            {t("appSettings.vertexProjectHelp")}
          </Typography>
        </div>
        <Typography
          as="p"
          tone={configured ? "default" : "muted"}
          variant="caption"
        >
          {t(
            configured
              ? "appSettings.vertexProjectConfigured"
              : "appSettings.vertexProjectMissing",
          )}
        </Typography>
        <input
          aria-label={t("appSettings.vertexProjectId")}
          autoCapitalize="none"
          autoComplete="off"
          className={inputClassName}
          disabled={!installed || saving}
          onChange={(event) => onProjectIdChange(event.target.value)}
          placeholder={t("appSettings.vertexProjectIdPlaceholder")}
          spellCheck={false}
          value={projectId}
        />
        <input
          aria-label={t("appSettings.vertexLocation")}
          autoCapitalize="none"
          autoComplete="off"
          className={inputClassName}
          disabled={!installed || saving}
          onChange={(event) => onLocationChange(event.target.value)}
          placeholder={t("appSettings.vertexLocationPlaceholder")}
          spellCheck={false}
          value={location}
        />
        <Typography as="p" tone="muted" variant="caption">
          {t("appSettings.vertexAdcHint")}
        </Typography>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              !installed || saving || projectId.trim().length < 6 ||
              location.trim().length === 0
            }
            onClick={onSave}
            size="sm"
            type="button"
          >
            {saving ? <Spinner className="size-[24px]" /> : null}
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
              {t("appSettings.vertexProjectRemove")}
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
  usage?: ProviderUsage;
}) {
  const { t } = useI18n();
  // A usage probe that hit revoked or expired credentials outranks the local
  // CLI auth check, which only sees that a credential file exists.
  const connected = Boolean(
    installed && authenticated && !usage?.reauthenticationRequired,
  );
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
            <Spinner aria-hidden="true" className="size-[18px] shrink-0 text-muted-foreground" />
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
            {loginOpening ? <Spinner className="size-[24px]" /> : null}
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

/**
 * One provider the machine has not added yet. The row is deliberately quieter
 * than an installed provider's: it carries no switch and no status dot, only
 * what the provider is, where its install instructions live, and the button
 * that adds it.
 */
function AddProviderRow({
  adding,
  description,
  disabled,
  installUrl,
  label,
  onAdd,
  provider,
}: {
  adding: boolean;
  description: string;
  disabled: boolean;
  installUrl: string;
  label: string;
  onAdd: () => void;
  provider: AgentProvider;
}) {
  const { t } = useI18n();
  return (
    <div className="grid min-h-[72px] grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border/80 px-[18px] py-4 last:border-b-0">
      <ProviderIcon tone={provider}>
        <AgentProviderIcon
          provider={provider}
          size={providerPresentation[provider].iconSize}
        />
      </ProviderIcon>
      <div className="grid min-w-0 gap-1">
        <Typography as="strong" className="tracking-tight" variant="body">
          {label}
        </Typography>
        <Typography as="p" tone="muted" variant="bodySm">
          {description}
        </Typography>
        <a
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground underline underline-offset-2"
          href={installUrl}
          rel="noreferrer"
          target="_blank"
        >
          {t("appSettings.providerInstallGuide")}
          <ExternalLink aria-hidden="true" size={11} />
        </a>
      </div>
      <Button
        aria-label={t("appSettings.addProviderActionLabel", { provider: label })}
        disabled={disabled}
        onClick={onAdd}
        size="sm"
        type="button"
        variant="outline"
      >
        {adding ? <Spinner className="size-[24px]" /> : <Plus />}
        {t(adding ? "appSettings.addingProvider" : "appSettings.addProviderAction")}
      </Button>
    </div>
  );
}

/**
 * Un-adds a provider from the machine. Confirmation is inline rather than a
 * modal: removing only hides and disables the provider, and every saved
 * credential survives, so the step back is cheap.
 */
function ProviderRemoveSection({
  confirming,
  label,
  onCancel,
  onConfirm,
  onRequest,
  removing,
}: {
  confirming: boolean;
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
  onRequest: () => void;
  removing: boolean;
}) {
  const { t } = useI18n();
  return (
    <section className="grid content-start gap-3 border-t border-border/70 pt-4">
      <div>
        <Typography as="h3" className="font-semibold" variant="bodySm">
          {t("appSettings.removeProvider")}
        </Typography>
        <Typography as="p" className="mt-1" tone="muted" variant="caption">
          {t("appSettings.removeProviderDescription", { provider: label })}
        </Typography>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <Typography as="p" variant="caption">
              {t("appSettings.removeProviderConfirm")}
            </Typography>
            <Button
              aria-label={t("appSettings.removeProviderConfirmAction")}
              disabled={removing}
              onClick={onConfirm}
              size="sm"
              type="button"
              variant="destructive"
            >
              {removing ? <Spinner className="size-[24px]" /> : null}
              {t(
                removing
                  ? "appSettings.removingProvider"
                  : "appSettings.removeProviderAction",
              )}
            </Button>
            <Button
              disabled={removing}
              onClick={onCancel}
              size="sm"
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
          </>
        ) : (
          <Button
            disabled={removing}
            onClick={onRequest}
            size="sm"
            type="button"
            variant="outline"
          >
            <Trash2 />
            {t("appSettings.removeProviderAction")}
          </Button>
        )}
      </div>
    </section>
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
