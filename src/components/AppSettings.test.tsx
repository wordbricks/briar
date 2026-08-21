/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import {
  configureOpenCodeTerminalPath,
  inspectOpenCodeTerminalPath,
  inspectOnboardingPrerequisites,
  installOnboardingPrerequisite,
  type OnboardingPrerequisites,
} from "../lib/initial-onboarding";
import {
  loadAppProviderSettings,
  loadAgentProviderModels,
  loadOpenRouterCredentialStatus,
  updateAppProviderSettings,
  updateOpenRouterApiKey,
} from "../lib/project-llm";
import type { RepositoryReadiness } from "../lib/project-connection";
import { readAgentProviderModelPreferences } from "../lib/agent-model-preferences";
import {
  loadAppRuntimeSettings,
  updateAppRuntimeSettings,
} from "../lib/app-runtime-settings";
import { ThemeProvider, themeStorageKey } from "../theme";
import { AppSettings } from "./AppSettings";
import {
  inspectAgentBrowser,
  inspectAsideBrowser,
  inspectEgoBrowser,
  installAgentBrowser,
  loadBrowserAutomationSettings,
  setupAsideBrowser,
  updateBrowserAutomationSettings,
} from "../lib/agent-browser";

vi.mock("../lib/initial-onboarding", () => ({
  configureOpenCodeTerminalPath: vi.fn(),
  inspectOpenCodeTerminalPath: vi.fn(),
  inspectOnboardingPrerequisites: vi.fn(),
  installOnboardingPrerequisite: vi.fn(),
}));

vi.mock("../lib/project-llm", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/project-llm")>();
  return {
    ...original,
    loadAppProviderSettings: vi.fn(),
    loadAgentProviderModels: vi.fn(),
    loadOpenRouterCredentialStatus: vi.fn(),
    updateAppProviderSettings: vi.fn(),
    updateOpenRouterApiKey: vi.fn(),
  };
});

vi.mock("../lib/app-runtime-settings", () => ({
  loadAppRuntimeSettings: vi.fn(),
  updateAppRuntimeSettings: vi.fn(),
}));

vi.mock("../lib/agent-browser", () => ({
  inspectAgentBrowser: vi.fn(),
  inspectAsideBrowser: vi.fn(),
  inspectEgoBrowser: vi.fn(),
  installAgentBrowser: vi.fn(),
  loadBrowserAutomationSettings: vi.fn(),
  setupAsideBrowser: vi.fn(),
  updateBrowserAutomationSettings: vi.fn(),
}));

const readiness: RepositoryReadiness = {
  repositoryPath: "/Users/jay/git/briar",
  gitInstalled: true,
  gitVersion: "git version 2.50.1",
  repositoryHealthy: true,
  remote: "git@github.com:wordbricks/briar.git",
  remoteReachable: true,
  pushAccess: true,
  requiresGithub: true,
  githubRepository: "wordbricks/briar",
  ghInstalled: true,
  ghVersion: "gh version 2.94.0",
  ghAuthenticated: true,
  ghAccount: "jay",
  githubWriteAccess: true,
  gitReady: true,
  prReady: true,
  issues: [],
};

const providerStatuses: OnboardingPrerequisites = {
  git: {
    installed: true,
    version: "git version 2.50.1",
    authenticated: true,
  },
  codex: {
    installed: true,
    version: "codex-cli 0.145.0",
    authenticated: true,
  },
  claude: {
    installed: true,
    version: "2.1.206",
    authenticated: true,
  },
  cursor: {
    installed: true,
    version: "2026.08.1",
    authenticated: true,
  },
  grok: {
    installed: true,
    version: "0.2.112",
    authenticated: true,
  },
  agy: {
    installed: true,
    version: "1.1.13",
    authenticated: true,
  },
  opencode: {
    installed: true,
    version: "1.18.11",
    authenticated: true,
  },
  openrouter: {
    installed: true,
    version: "1.18.11",
    authenticated: true,
  },
};

describe("AppSettings", () => {
  beforeEach(() => {
    vi.mocked(inspectOnboardingPrerequisites).mockReset();
    vi.mocked(installOnboardingPrerequisite).mockReset();
    vi.mocked(inspectOpenCodeTerminalPath).mockReset();
    vi.mocked(configureOpenCodeTerminalPath).mockReset();
    vi.mocked(inspectOpenCodeTerminalPath).mockResolvedValue({
      supported: true,
      configured: true,
      binaryPath: "/Users/jay/.bun/bin/opencode",
      configPath: "/Users/jay/.zshrc",
    });
    vi.mocked(loadAppProviderSettings).mockReset();
    vi.mocked(loadAgentProviderModels).mockReset();
    vi.mocked(loadOpenRouterCredentialStatus).mockReset();
    vi.mocked(loadOpenRouterCredentialStatus).mockResolvedValue({ configured: false });
    vi.mocked(updateOpenRouterApiKey).mockReset();
    vi.mocked(updateOpenRouterApiKey).mockResolvedValue({ configured: true });
    vi.mocked(loadAgentProviderModels).mockResolvedValue({
      codex: {
        models: [{
          id: "gpt-5.6-sol",
          label: "GPT-5.6 Sol",
          efforts: [{ id: "high", label: "High" }],
        }],
        defaultEfforts: [],
        allowCustomModels: false,
        error: null,
      },
      claude: {
        models: [{
          id: "sonnet",
          label: "Claude Sonnet",
          efforts: [{ id: "high", label: "High" }],
        }],
        defaultEfforts: [],
        allowCustomModels: true,
        error: null,
      },
      cursor: {
        models: [],
        defaultEfforts: [],
        allowCustomModels: true,
        error: null,
      },
      grok: {
        models: [],
        defaultEfforts: [],
        allowCustomModels: false,
        error: null,
      },
      agy: {
        models: [{
          id: "gemini-3.7-flash-high",
          label: "Gemini 3.7 Flash (High)",
          efforts: [{ id: "high", label: "high" }],
        }],
        defaultEfforts: [{ id: "low", label: "low" }, { id: "medium", label: "medium" }, { id: "high", label: "high" }],
        allowCustomModels: false,
        error: null,
      },
      opencode: {
        models: [],
        defaultEfforts: [],
        allowCustomModels: true,
        error: null,
      },
      openrouter: {
        models: [],
        defaultEfforts: [],
        allowCustomModels: true,
        error: null,
      },
    });
    vi.mocked(updateAppProviderSettings).mockReset();
    vi.mocked(loadAppRuntimeSettings).mockReset();
    vi.mocked(updateAppRuntimeSettings).mockReset();
    vi.mocked(inspectAgentBrowser).mockReset();
    vi.mocked(inspectAsideBrowser).mockReset();
    vi.mocked(inspectEgoBrowser).mockReset();
    vi.mocked(installAgentBrowser).mockReset();
    vi.mocked(loadBrowserAutomationSettings).mockReset();
    vi.mocked(setupAsideBrowser).mockReset();
    vi.mocked(updateBrowserAutomationSettings).mockReset();
    window.localStorage.clear();
    window.localStorage.setItem("briar.locale.v1", "en");
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("shows account deletion beside the profile settings", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onBack = vi.fn();
    await act(async () => {
      root.render(
        <I18nProvider>
          <AppSettings
            error={null}
            initialSection="account"
            isSidebarOpen
            loading={false}
            onAccountDelete={async () => undefined}
            onAccountSave={async (input) => ({
              id: "user-1",
              email: "jay@example.com",
              ...input,
            })}
            onBack={onBack}
            onRefresh={() => Promise.resolve(readiness)}
            projectId="project-1"
            projectName="Briar"
            readiness={readiness}
            user={{
              id: "user-1",
              username: "jay",
              name: "Jay",
              email: "jay@example.com",
            }}
          />
        </I18nProvider>,
      );
    });

    expect(container.textContent).toContain("Profile information");
    expect(container.textContent).toContain("Delete account and data");
    expect(container.textContent).toContain("Delete account");

    const shell = container.querySelector<HTMLElement>("main.settings-shell");
    const sidebar = shell?.querySelector<HTMLElement>(
      'aside[aria-label="Settings navigation"]',
    );
    expect(sidebar?.getAttribute("aria-hidden")).toBe("false");
    expect(sidebar?.querySelector('input[type="search"]')?.getAttribute("aria-label"))
      .toBe("Search settings");
    expect(sidebar?.querySelectorAll("nav > .settings-nav-group").length)
      .toBeGreaterThan(0);

    const settingsMain = shell?.querySelector<HTMLElement>(
      "section.settings-main",
    );
    expect(settingsMain?.querySelector("header h1")?.textContent).toBe(
      "My account",
    );
    await act(async () => {
      sidebar?.querySelector<HTMLButtonElement>("button.settings-back")?.click();
    });
    expect(onBack).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });

  it("checks ego (lite) and installs agent-browser from Browser settings", async () => {
    vi.mocked(loadBrowserAutomationSettings).mockResolvedValue({
      provider: "ego-browser",
    });
    vi.mocked(updateBrowserAutomationSettings).mockResolvedValue({
      provider: "agent-browser",
    });
    vi.mocked(inspectEgoBrowser).mockResolvedValue({
      supported: true,
      installed: false,
      browserReady: false,
      version: null,
    });
    vi.mocked(inspectAgentBrowser).mockResolvedValue({
      supported: true,
      installed: false,
      browserReady: false,
      version: null,
    });
    vi.mocked(inspectAsideBrowser).mockResolvedValue({
      supported: true,
      installed: false,
      cliReady: false,
      mcpReady: false,
      skillReady: false,
      browserReady: false,
      version: null,
    });
    vi.mocked(installAgentBrowser).mockResolvedValue({
      supported: true,
      installed: true,
      browserReady: true,
      version: "agent-browser 0.32.3",
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <AppSettings
            error={null}
            initialSection="browser"
            isSidebarOpen
            loading={false}
            onBack={() => undefined}
            onRefresh={() => Promise.resolve(readiness)}
            projectId="project-1"
            projectName="Briar"
            readiness={readiness}
          />
        </I18nProvider>,
      );
    });

    expect(inspectAgentBrowser).toHaveBeenCalledOnce();
    expect(inspectAsideBrowser).toHaveBeenCalledOnce();
    expect(inspectEgoBrowser).toHaveBeenCalledOnce();
    expect(
      container
        .querySelector<HTMLAnchorElement>('[aria-label="Download ego (lite)"]')
        ?.getAttribute("href"),
    ).toBe("https://lite.ego.app/download?auto=1");
    expect(container.textContent).toContain("Not installed or not available on PATH.");
    expect(
      container
        .querySelector<HTMLAnchorElement>(
          '[aria-label="Install and onboard Aside"]',
        )
        ?.getAttribute("href"),
    ).toBe("https://docs.aside.com/help/get-started");

    const agentBrowserChoice = container.querySelector<HTMLButtonElement>(
      '[aria-label="Select agent-browser for browser automation"]',
    );
    expect(agentBrowserChoice?.getAttribute("aria-checked")).toBe("false");

    await act(async () => agentBrowserChoice?.click());

    expect(updateBrowserAutomationSettings).toHaveBeenCalledWith({
      provider: "agent-browser",
    });
    expect(agentBrowserChoice?.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Install agent-browser"]')
        ?.click();
    });

    expect(installAgentBrowser).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("agent-browser 0.32.3");
    expect(container.textContent).toContain("Agents can verify interfaces");

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows Aside readiness and prepares its CLI, MCP, and skill", async () => {
    vi.mocked(loadBrowserAutomationSettings).mockResolvedValue({
      provider: "ego-browser",
    });
    vi.mocked(updateBrowserAutomationSettings).mockResolvedValue({
      provider: "aside",
    });
    vi.mocked(inspectEgoBrowser).mockResolvedValue({
      supported: true,
      installed: true,
      browserReady: true,
      version: "ego-browser 1.0.0",
    });
    vi.mocked(inspectAgentBrowser).mockResolvedValue({
      supported: true,
      installed: true,
      browserReady: true,
      version: "agent-browser 0.32.3",
    });
    vi.mocked(inspectAsideBrowser).mockResolvedValue({
      supported: true,
      installed: true,
      cliReady: false,
      mcpReady: false,
      skillReady: true,
      browserReady: false,
      version: null,
    });
    vi.mocked(setupAsideBrowser).mockResolvedValue({
      supported: true,
      installed: true,
      cliReady: true,
      mcpReady: true,
      skillReady: true,
      browserReady: true,
      version: "1.26.810.1915",
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <AppSettings
            error={null}
            initialSection="browser"
            isSidebarOpen
            loading={false}
            onBack={() => undefined}
            onRefresh={() => Promise.resolve(readiness)}
            projectId="project-1"
            projectName="Briar"
            readiness={readiness}
          />
        </I18nProvider>,
      );
    });

    expect(container.textContent).toContain("CLI");
    expect(container.textContent).toContain("MCP");
    expect(container.textContent).toContain("Skill");
    const asideChoice = container.querySelector<HTMLButtonElement>(
      '[aria-label="Select Aside for browser automation"]',
    );
    expect(asideChoice?.disabled).toBe(true);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Set up Aside developer tools"]',
        )
        ?.click();
    });

    expect(setupAsideBrowser).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("1.26.810.1915");
    expect(container.textContent).toContain(
      "Agents can control the Aside browser through MCP.",
    );
    expect(asideChoice?.disabled).toBe(false);
    await act(async () => asideChoice?.click());
    expect(updateBrowserAutomationSettings).toHaveBeenCalledWith({
      provider: "aside",
    });

    await act(async () => root.unmount());
    container.remove();
  });

  it("persists the Prevent sleep while running setting", async () => {
    vi.mocked(loadAppRuntimeSettings).mockResolvedValue({
      preventSleepWhileRunning: false,
      preventSleepSupported: true,
    });
    vi.mocked(updateAppRuntimeSettings).mockResolvedValue({
      preventSleepWhileRunning: true,
      preventSleepSupported: true,
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <AppSettings
            error={null}
            initialSection="general"
            isSidebarOpen
            loading={false}
            onBack={() => undefined}
            onRefresh={() => Promise.resolve(readiness)}
            projectId="project-1"
            projectName="Briar"
            readiness={readiness}
          />
        </I18nProvider>,
      );
    });

    expect(container.textContent).toContain("Prevent sleep while running");
    const toggle = container.querySelector<HTMLButtonElement>(
      '[aria-label="Prevent sleep while running"]',
    );
    expect(
      toggle?.getAttribute("data-state") ??
        toggle?.getAttribute("aria-checked"),
    ).toMatch(/unchecked|false/);

    await act(async () => toggle?.click());

    expect(updateAppRuntimeSettings).toHaveBeenCalledWith({
      preventSleepWhileRunning: true,
    });
    expect(
      toggle?.getAttribute("data-state") ??
        toggle?.getAttribute("aria-checked"),
    ).toMatch(/checked|true/);

    await act(async () => root.unmount());
    container.remove();
  });

  it("offers system, light, and dark appearance themes", async () => {
    window.localStorage.setItem(themeStorageKey, "system");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ThemeProvider>
          <I18nProvider>
            <AppSettings
              error={null}
              initialSection="appearance"
              isSidebarOpen
              loading={false}
              onBack={() => undefined}
              onRefresh={() => Promise.resolve(readiness)}
              projectId="project-1"
              projectName="Briar"
              readiness={readiness}
            />
          </I18nProvider>
        </ThemeProvider>,
      );
    });

    const options = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    );
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      "System",
      "Light",
      "Dark",
    ]);
    expect(options[0]?.getAttribute("aria-checked")).toBe("true");

    await act(async () => options[2]?.click());

    expect(window.localStorage.getItem(themeStorageKey)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows the Source Control tab and persists provider preferences", async () => {
    const onRefresh = vi.fn().mockResolvedValue(readiness);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <AppSettings
            error={null}
            isSidebarOpen
            loading={false}
            onBack={() => undefined}
            onRefresh={onRefresh}
            projectId="project-1"
            projectName="Briar"
            readiness={readiness}
          />
        </I18nProvider>,
      );
    });

    expect(container.textContent).toContain("Source Control");
    expect(container.textContent).toContain("Version Control");
    expect(container.textContent).toContain("git version 2.50.1");
    expect(container.textContent).toContain("Authenticated as jay");
    expect(container.textContent).toContain("GitHub");
    expect(container.textContent).not.toContain("Jujutsu");
    expect(container.textContent).not.toContain("GitLab");
    expect(container.textContent).not.toContain("Azure DevOps");
    expect(container.textContent).not.toContain("Bitbucket");

    const gitToggle = container.querySelector<HTMLButtonElement>(
      '[aria-label="Git enabled"]',
    );
    expect(gitToggle?.getAttribute("data-state") ?? gitToggle?.getAttribute("aria-checked")).toMatch(
      /checked|true/,
    );
    await act(async () => gitToggle?.click());
    expect(
      window.localStorage.getItem(
        "briar.settings.source-control.project-1.git",
      ),
    ).toBe("false");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Refresh source control status"]',
        )
        ?.click();
    });
    expect(onRefresh).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows provider readiness and enables both providers independently", async () => {
    vi.mocked(inspectOnboardingPrerequisites).mockResolvedValue(
      providerStatuses,
    );
    vi.mocked(loadAppProviderSettings).mockResolvedValue({
      codex: true,
      claude: true,
      cursor: true,
      grok: true,
      agy: true,
      opencode: true,
      openrouter: true,
    });
    vi.mocked(updateAppProviderSettings).mockImplementation(
      async (settings) => settings,
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <AppSettings
            error={null}
            isSidebarOpen
            loading={false}
            onBack={() => undefined}
            onRefresh={() => Promise.resolve(readiness)}
            projectId="project-1"
            projectName="Briar"
            readiness={readiness}
          />
        </I18nProvider>,
      );
    });

    const providersTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>("nav button"),
    ).find((button) => button.textContent === "Providers");
    await act(async () => providersTab?.click());

    expect(container.textContent).toContain("codex-cli 0.145.0");
    expect(container.textContent).toContain("Claude");
    expect(container.textContent).toContain("2.1.206");
    expect(container.textContent).toContain(
      "Enabled · Available in project settings.",
    );
    const switchState = (label: string) =>
      container
        .querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
        ?.getAttribute("data-state") ??
      container
        .querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
        ?.getAttribute("aria-checked");

    expect(switchState("Codex enabled")).toMatch(/checked|true/);
    expect(switchState("Claude enabled")).toMatch(/checked|true/);
    expect(container.textContent).not.toContain("GPT-5.6 Sol");

    const codexDetails = container.querySelector<HTMLButtonElement>(
      '[aria-label="Toggle Codex details"]',
    );
    expect(codexDetails?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => codexDetails?.click());
    expect(codexDetails?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Account connection");
    expect(container.textContent).toContain("Connected");
    expect(container.textContent).toContain("Supported models");
    expect(container.textContent).toContain("GPT-5.6 Sol");

    const defaultModelSelect = container.querySelector<HTMLButtonElement>(
      '[aria-label="Default"]',
    );
    await act(async () => defaultModelSelect?.click());
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '.select-menu-option[data-value="gpt-5.6-sol"]',
        )
        ?.click();
    });
    const favoriteButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Star GPT-5.6 Sol"]',
    );
    await act(async () => favoriteButton?.click());
    expect(favoriteButton?.getAttribute("aria-pressed")).toBe("true");
    expect(readAgentProviderModelPreferences().codex).toEqual({
      defaultModel: "gpt-5.6-sol",
      favoriteModels: ["gpt-5.6-sol"],
    });

    const claudeDetails = container.querySelector<HTMLButtonElement>(
      '[aria-label="Toggle Claude details"]',
    );
    await act(async () => claudeDetails?.click());
    expect(codexDetails?.getAttribute("aria-expanded")).toBe("false");
    expect(claudeDetails?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Claude Sonnet");

    const openRouterDetails = container.querySelector<HTMLButtonElement>(
      '[aria-label="Toggle OpenRouter details"]',
    );
    await act(async () => openRouterDetails?.click());
    const apiKeyInput = container.querySelector<HTMLInputElement>(
      '[aria-label="OpenRouter API key"]',
    );
    const inputSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      inputSetter?.call(apiKeyInput, "sk-or-v1-ui-test-key");
      apiKeyInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const saveButton = Array.from(
      apiKeyInput?.closest("section")?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent === "Save");
    await act(async () => saveButton?.click());
    expect(updateOpenRouterApiKey).toHaveBeenCalledWith("sk-or-v1-ui-test-key");
    expect(apiKeyInput?.value).toBe("");
    expect(container.textContent).toContain("An API key is saved.");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Claude enabled"]')
        ?.click();
    });
    expect(updateAppProviderSettings).toHaveBeenCalledWith({
      codex: true,
      claude: false,
      cursor: true,
      grok: true,
      agy: true,
      opencode: true,
      openrouter: true,
    });
    expect(switchState("Claude enabled")).toMatch(/unchecked|false/);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Refresh provider status"]',
        )
        ?.click();
    });
    expect(inspectOnboardingPrerequisites).toHaveBeenCalledTimes(3);

    await act(async () => root.unmount());
    container.remove();
  });

  it("installs a missing provider from the Providers settings", async () => {
    const missingCodex = {
      ...providerStatuses,
      codex: {
        installed: false,
        version: null,
        authenticated: false,
      },
    };
    vi.mocked(inspectOnboardingPrerequisites).mockResolvedValue(missingCodex);
    vi.mocked(installOnboardingPrerequisite).mockResolvedValue({
      ...providerStatuses,
      codex: {
        installed: true,
        version: "codex-cli 0.145.0",
        authenticated: false,
      },
    });
    vi.mocked(loadAppProviderSettings).mockResolvedValue({
      codex: true,
      claude: true,
      cursor: true,
      grok: true,
      agy: true,
      opencode: true,
      openrouter: true,
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <AppSettings
            error={null}
            initialSection="providers"
            isSidebarOpen
            loading={false}
            onBack={() => undefined}
            onRefresh={() => Promise.resolve(readiness)}
            projectId="project-1"
            projectName="Briar"
            readiness={readiness}
          />
        </I18nProvider>,
      );
    });

    const installButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Install Codex"]',
    );
    expect(installButton).not.toBeNull();

    await act(async () => installButton?.click());

    expect(installOnboardingPrerequisite).toHaveBeenCalledWith("codex");
    expect(container.textContent).toContain("codex-cli 0.145.0");
    expect(
      container.querySelector('[aria-label="Install Codex"]'),
    ).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("offers to add an installed OpenCode binary to the terminal PATH", async () => {
    vi.mocked(inspectOnboardingPrerequisites).mockResolvedValue(providerStatuses);
    vi.mocked(inspectOpenCodeTerminalPath).mockResolvedValue({
      supported: true,
      configured: false,
      binaryPath: "/Users/jay/.bun/bin/opencode",
      configPath: "/Users/jay/.zshrc",
    });
    vi.mocked(configureOpenCodeTerminalPath).mockResolvedValue({
      supported: true,
      configured: true,
      binaryPath: "/Users/jay/.bun/bin/opencode",
      configPath: "/Users/jay/.zshrc",
    });
    vi.mocked(loadAppProviderSettings).mockResolvedValue({
      codex: true,
      claude: true,
      cursor: true,
      grok: true,
      agy: true,
      opencode: true,
      openrouter: true,
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <AppSettings
            error={null}
            initialSection="providers"
            isSidebarOpen
            loading={false}
            onBack={() => undefined}
            onRefresh={() => Promise.resolve(readiness)}
            projectId="project-1"
            projectName="Briar"
            readiness={readiness}
          />
        </I18nProvider>,
      );
    });

    const setupButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Set up OpenCode terminal PATH"]',
    );
    expect(setupButton).not.toBeNull();
    expect(container.textContent).toContain(
      "Set up PATH to use OpenCode from a terminal.",
    );

    await act(async () => setupButton?.click());

    expect(configureOpenCodeTerminalPath).toHaveBeenCalledOnce();
    expect(
      container.querySelector('[aria-label="Set up OpenCode terminal PATH"]'),
    ).toBeNull();
    expect(container.textContent).toContain(
      "The opencode command is available in new terminals.",
    );

    await act(async () => root.unmount());
    container.remove();
  });
});
