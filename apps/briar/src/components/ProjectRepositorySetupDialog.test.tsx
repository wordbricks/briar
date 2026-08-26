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

  it("preserves focus across rerenders and closes through the latest handler", async () => {
    const onClose = vi.fn();
    const nextOnClose = vi.fn();
    const onInstallGithub = vi.fn().mockResolvedValue(undefined);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ProjectRepositorySetupDialog
          connectionState="connected"
          error={null}
          loading={false}
          onClose={onClose}
          onInstallGithub={onInstallGithub}
          onLoginGithub={vi.fn()}
          onReconnect={vi.fn()}
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

    const refreshButton = container.querySelector<HTMLButtonElement>(
      ".repository-setup-refresh",
    )!;
    refreshButton.focus();
    await act(async () => {
      root.render(
        <ProjectRepositorySetupDialog
          connectionState="connected"
          error={null}
          loading={false}
          onClose={nextOnClose}
          onInstallGithub={onInstallGithub}
          onLoginGithub={vi.fn()}
          onReconnect={vi.fn()}
          onRefresh={vi.fn()}
          projectName="Briar"
          readiness={readiness}
        />,
      );
    });
    expect(document.activeElement).toBe(refreshButton);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(nextOnClose).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });

  it("directs an in-progress GitHub login to the browser", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ProjectRepositorySetupDialog
          connectionState="connected"
          error={null}
          loading
          onClose={vi.fn()}
          onInstallGithub={vi.fn()}
          onLoginGithub={vi.fn()}
          onReconnect={vi.fn()}
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
    expect(document.activeElement).toBe(
      container.querySelector(".repository-setup-close"),
    );

    await act(async () => root.unmount());
  });

  it("does not present an unknown inspection as missing software", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ProjectRepositorySetupDialog
          connectionState="unknown"
          error="로컬 연결 상태를 확인하지 못했습니다."
          loading={false}
          onClose={vi.fn()}
          onInstallGithub={vi.fn()}
          onLoginGithub={vi.fn()}
          onReconnect={vi.fn()}
          onRefresh={vi.fn()}
          projectName="Briar"
          readiness={null}
        />,
      );
    });

    expect(container.textContent).toContain("확인 필요");
    expect(container.textContent).toContain("로컬 연결 상태를 확인하지 못했습니다.");
    expect(container.textContent).not.toContain("설치 안 됨");
    expect(container.textContent).not.toContain("GitHub CLI 설치");

    await act(async () => root.unmount());
  });

  it("does not require GitHub CLI for a workflow without PR stages", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ProjectRepositorySetupDialog
          connectionState="connected"
          error={null}
          loading={false}
          onClose={vi.fn()}
          onInstallGithub={vi.fn()}
          onLoginGithub={vi.fn()}
          onReconnect={vi.fn()}
          onRefresh={vi.fn()}
          projectName="Briar"
          readiness={{
            ...readiness,
            issues: [],
            remote: null,
            remoteReachable: false,
            pushAccess: false,
            requiresGithub: false,
          }}
        />,
      );
    });

    expect(container.textContent).toContain(
      "로컬 저장소 연결과 필요한 Git 도구를 확인합니다.",
    );
    expect(container.textContent).toContain("Briar 저장소 연결 확인");
    expect(container.textContent).not.toContain("GitHub 연결");
    expect(container.textContent).not.toContain("GitHub CLI 설치");
    expect(container.textContent).not.toContain("Push 권한 확인 필요");
    expect(container.textContent).toContain("준비 완료");

    await act(async () => root.unmount());
  });
});
