/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectRepositorySetupDialog } from "./ProjectRepositorySetupDialog";

const readiness = {
  repositoryPath: "/Users/jay/git/briar",
  gitInstalled: true,
  gitVersion: "git version 2.50.1",
  repositoryHealthy: true,
  remote: "git@github.com:wordbricks/briar.git",
  remoteReachable: true,
  pushAccess: true,
  requiresGithub: true,
  githubRepository: "wordbricks/briar",
  ghInstalled: false,
  ghVersion: null,
  ghAuthenticated: false,
  ghAccount: null,
  githubWriteAccess: false,
  gitReady: true,
  prReady: false,
  issues: ["PR 단계 실행에 필요한 GitHub CLI가 설치되지 않았습니다."],
};

describe("ProjectRepositorySetupDialog", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it("offers GitHub CLI installation and closes on Escape", async () => {
    const onClose = vi.fn();
    const onInstallGithub = vi.fn().mockResolvedValue(undefined);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ProjectRepositorySetupDialog
          error={null}
          loading={false}
          onClose={onClose}
          onInstallGithub={onInstallGithub}
          onLoginGithub={vi.fn()}
          onRefresh={vi.fn()}
          projectName="Briar"
          readiness={readiness}
        />,
      );
    });

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain("GitHub CLI 설치");
    expect(container.textContent).toContain("Git push 권한");

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("GitHub CLI 설치"))
        ?.click();
    });
    expect(onInstallGithub).toHaveBeenCalledOnce();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });

  it("directs an in-progress GitHub login to the browser", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ProjectRepositorySetupDialog
          error={null}
          loading
          onClose={vi.fn()}
          onInstallGithub={vi.fn()}
          onLoginGithub={vi.fn()}
          onRefresh={vi.fn()}
          projectName="Briar"
          readiness={{
            ...readiness,
            ghInstalled: true,
            ghVersion: "gh version 2.96.0",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("브라우저에서 로그인 완료");

    await act(async () => root.unmount());
  });
});
