/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { RepositoryReadiness } from "../lib/project-connection";
import { AppSettings } from "./AppSettings";

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

describe("AppSettings", () => {
  beforeEach(() => {
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
});
