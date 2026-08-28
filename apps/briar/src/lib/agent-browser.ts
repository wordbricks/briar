import {
  commands,
  type AgentBrowserStatus,
  type AsideBrowserStatus,
  type BrowserAutomationProvider,
  type BrowserAutomationSettings,
  type EgoBrowserStatus,
} from "../generated/tauri";

export const browserAutomationProviders = [
  "ego-browser",
  "agent-browser",
  "aside",
] as const;

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
  return commands.inspectAgentBrowser();
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
  return commands.inspectEgoBrowser();
}

export async function inspectAsideBrowser(): Promise<AsideBrowserStatus> {
  if (!isTauri()) {
    return {
      supported: false,
      installed: false,
      cliReady: false,
      mcpReady: false,
      skillReady: false,
      browserReady: false,
      version: null,
    };
  }
  return commands.inspectAsideBrowser();
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
  return commands.loadBrowserAutomationSettings();
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
  return commands.updateBrowserAutomationSettings(settings);
}

export async function installAgentBrowser(): Promise<AgentBrowserStatus> {
  if (!isTauri()) {
    throw new Error(
      "agent-browser installation is available in the Briar desktop app.",
    );
  }
  return commands.installAgentBrowser();
}

export async function setupAsideBrowser(): Promise<AsideBrowserStatus> {
  if (!isTauri()) {
    throw new Error("Aside setup is available in the Briar desktop app.");
  }
  return commands.setupAsideBrowser();
}
