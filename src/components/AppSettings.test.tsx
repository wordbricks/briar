/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import {
  inspectOnboardingPrerequisites,
  type OnboardingPrerequisites,
} from "../lib/initial-onboarding";
import {
  loadProjectLlmSettings,
  updateProjectLlmSettings,
} from "../lib/project-llm";
import type { RepositoryReadiness } from "../lib/project-connection";
import { AppSettings } from "./AppSettings";

vi.mock("../lib/initial-onboarding", () => ({
  inspectOnboardingPrerequisites: vi.fn(),
}));

vi.mock("../lib/project-llm", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/project-llm")>();
  return {
    ...original,
    loadProjectLlmSettings: vi.fn(),
    updateProjectLlmSettings: vi.fn(),
  };
});

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
  velen: {
    installed: true,
    version: "velen 1.0.0",
    authenticated: true,
  },
};

describe("AppSettings", () => {
  beforeEach(() => {
    vi.mocked(inspectOnboardingPrerequisites).mockReset();
    vi.mocked(loadProjectLlmSettings).mockReset();
    vi.mocked(updateProjectLlmSettings).mockReset();
    window.localStorage.clear();
    window.localStorage.setItem("briar.locale.v1", "en");
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
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
    expect(container.textContent).toContain("GitLab");
    expect(container.textContent).toContain("Azure DevOps");
    expect(container.textContent).toContain("Bitbucket");

    const gitToggle = container.querySelector<HTMLInputElement>(
      '[aria-label="Git enabled"]',
    );
    expect(gitToggle?.checked).toBe(true);
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

  it("shows provider readiness and switches the project's active provider", async () => {
    vi.mocked(inspectOnboardingPrerequisites).mockResolvedValue(
      providerStatuses,
    );
    vi.mocked(loadProjectLlmSettings).mockResolvedValue({
      provider: "codex",
      approvalPolicy: "on-request",
    });
    vi.mocked(updateProjectLlmSettings).mockImplementation(
      async (_projectId, settings) => settings,
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
    expect(container.textContent).toContain("Active for the Briar project");
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="Codex enabled"]')
        ?.checked,
    ).toBe(true);

    await act(async () => {
      container
        .querySelector<HTMLInputElement>('[aria-label="Claude enabled"]')
        ?.click();
    });
    expect(updateProjectLlmSettings).toHaveBeenCalledWith("project-1", {
      provider: "claude",
      approvalPolicy: "on-request",
    });
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="Claude enabled"]')
        ?.checked,
    ).toBe(true);

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
});
