/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import {
  inspectOnboardingPrerequisites,
  installOnboardingPrerequisite,
  type OnboardingPrerequisites,
} from "../lib/initial-onboarding";
import {
  loadAppProviderSettings,
  updateAppProviderSettings,
} from "../lib/project-llm";
import type { RepositoryReadiness } from "../lib/project-connection";
import {
  loadAppRuntimeSettings,
  updateAppRuntimeSettings,
} from "../lib/app-runtime-settings";
import { ThemeProvider, themeStorageKey } from "../theme";
import { AppSettings } from "./AppSettings";
import {
  inspectAgentBrowser,
  installAgentBrowser,
} from "../lib/agent-browser";

vi.mock("../lib/initial-onboarding", () => ({
  inspectOnboardingPrerequisites: vi.fn(),
  installOnboardingPrerequisite: vi.fn(),
}));

vi.mock("../lib/project-llm", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/project-llm")>();
  return {
    ...original,
    loadAppProviderSettings: vi.fn(),
    updateAppProviderSettings: vi.fn(),
  };
});

vi.mock("../lib/app-runtime-settings", () => ({
  loadAppRuntimeSettings: vi.fn(),
  updateAppRuntimeSettings: vi.fn(),
}));

vi.mock("../lib/agent-browser", () => ({
  inspectAgentBrowser: vi.fn(),
  installAgentBrowser: vi.fn(),
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
  grok: {
    installed: true,
    version: "0.2.112",
    authenticated: true,
  },
};

describe("AppSettings", () => {
  beforeEach(() => {
    vi.mocked(inspectOnboardingPrerequisites).mockReset();
    vi.mocked(installOnboardingPrerequisite).mockReset();
    vi.mocked(loadAppProviderSettings).mockReset();
    vi.mocked(updateAppProviderSettings).mockReset();
    vi.mocked(loadAppRuntimeSettings).mockReset();
    vi.mocked(updateAppRuntimeSettings).mockReset();
    vi.mocked(inspectAgentBrowser).mockReset();
    vi.mocked(installAgentBrowser).mockReset();
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
            onBack={() => undefined}
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
    await act(async () => root.unmount());
    container.remove();
  });

  it("checks and installs agent-browser from Browser settings", async () => {
    vi.mocked(inspectAgentBrowser).mockResolvedValue({
      supported: true,
      installed: false,
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
    expect(container.textContent).toContain("Not installed or not available on PATH.");

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
      grok: true,
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

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Claude enabled"]')
        ?.click();
    });
    expect(updateAppProviderSettings).toHaveBeenCalledWith({
      codex: true,
      claude: false,
      grok: true,
    });
    expect(switchState("Claude enabled")).toMatch(/unchecked|false/);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Refresh provider status"]',
        )
        ?.click();
    });
    expect(inspectOnboardingPrerequisites).toHaveBeenCalledTimes(2);

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
      grok: true,
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
});
