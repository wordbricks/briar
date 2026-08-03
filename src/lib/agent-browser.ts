export type AgentBrowserStatus = {
  supported: boolean;
  installed: boolean;
  browserReady: boolean;
  version: string | null;
};

export type EgoBrowserStatus = AgentBrowserStatus;

export const browserAutomationProviders = [
  "ego-browser",
  "agent-browser",
] as const;

export type BrowserAutomationProvider =
  (typeof browserAutomationProviders)[number];

export type BrowserAutomationSettings = {
  provider: BrowserAutomationProvider;
};

const browserSettingsStorageKey = "briar.settings.browser.v1";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function inspectAgentBrowser(): Promise<AgentBrowserStatus> {
  if (!isTauri()) {
    return {
      supported: false,
      installed: false,
      browserReady: false,
      version: null,
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentBrowserStatus>("inspect_agent_browser");
}

export async function inspectEgoBrowser(): Promise<EgoBrowserStatus> {
  if (!isTauri()) {
    return {
      supported: false,
      installed: false,
      browserReady: false,
      version: null,
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<EgoBrowserStatus>("inspect_ego_browser");
}

export async function loadBrowserAutomationSettings(): Promise<BrowserAutomationSettings> {
  if (!isTauri()) {
    try {
      const stored = JSON.parse(
        window.localStorage.getItem(browserSettingsStorageKey) ?? "{}",
      ) as Partial<BrowserAutomationSettings>;
      if (
        browserAutomationProviders.includes(
          stored.provider as BrowserAutomationProvider,
        )
      ) {
        return { provider: stored.provider as BrowserAutomationProvider };
      }
    } catch {
      // Use the default when browser storage is unavailable or invalid.
    }
    return { provider: "ego-browser" };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<BrowserAutomationSettings>("load_browser_automation_settings");
}

export async function updateBrowserAutomationSettings(
  settings: BrowserAutomationSettings,
): Promise<BrowserAutomationSettings> {
  if (!isTauri()) {
    try {
      window.localStorage.setItem(
        browserSettingsStorageKey,
        JSON.stringify(settings),
      );
    } catch {
      // Keep the preference for the current session when storage is unavailable.
    }
    return settings;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<BrowserAutomationSettings>(
    "update_browser_automation_settings",
    { settings },
  );
}

export async function installAgentBrowser(): Promise<AgentBrowserStatus> {
  if (!isTauri()) {
    throw new Error(
      "agent-browser installation is available in the Briar desktop app.",
    );
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentBrowserStatus>("install_agent_browser");
}
