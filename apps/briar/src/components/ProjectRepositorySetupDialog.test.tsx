/** @vitest-environment jsdom */

import { act } from "react";
import type { Root } from "react-dom/client";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
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
  githubRepositoryId: null,
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
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("preserves focus across rerenders and closes through the latest handler", async () => {
    const onClose = vi.fn();
    const nextOnClose = vi.fn();
    const onStartWorking = vi.fn().mockResolvedValue(undefined);
    await renderReactTestRoot(
      root,
      <ProjectRepositorySetupDialog
        connectionState="disconnected"
        error={null}
        loading={false}
        onClose={onClose}
        onStartWorking={onStartWorking}
        onRefresh={vi.fn()}
        projectName="Briar"
        readiness={readiness}
      />,
    );

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain("이 컴퓨터에서 작업 시작");
    expect(container.textContent).toContain("GitHub App 저장소 권한");

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("이 컴퓨터에서 작업 시작"))
        ?.click();
    });
    expect(onStartWorking).toHaveBeenCalledOnce();

    const refreshButton = container.querySelector<HTMLButtonElement>(
      ".repository-setup-refresh",
    )!;
    refreshButton.focus();
    await renderReactTestRoot(
      root,
      <ProjectRepositorySetupDialog
        connectionState="disconnected"
        error={null}
        loading={false}
        onClose={nextOnClose}
        onStartWorking={onStartWorking}
        onRefresh={vi.fn()}
        projectName="Briar"
        readiness={readiness}
      />,
    );
    expect(document.activeElement).toBe(refreshButton);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(nextOnClose).toHaveBeenCalledOnce();

  });

  it("keeps managed setup local while it is in progress", async () => {
    await renderReactTestRoot(
      root,
      <ProjectRepositorySetupDialog
        connectionState="disconnected"
        error={null}
        loading
        onClose={vi.fn()}
        onStartWorking={vi.fn()}
        onRefresh={vi.fn()}
        projectName="Briar"
        readiness={{
          ...readiness,
          ghInstalled: true,
          ghVersion: "gh version 2.96.0",
        }}
      />,
    );

    expect(container.textContent).not.toContain("GitHub CLI 설치");
    expect(
      container.querySelector<HTMLButtonElement>(".repository-setup-primary")
        ?.disabled,
    ).toBe(true);
    expect(document.activeElement).toBe(
      container.querySelector(".repository-setup-close"),
    );

  });

  it("does not present an unknown inspection as missing software", async () => {
    await renderReactTestRoot(
      root,
      <ProjectRepositorySetupDialog
        connectionState="unknown"
        error="로컬 연결 상태를 확인하지 못했습니다."
        loading={false}
        onClose={vi.fn()}
        onStartWorking={vi.fn()}
        onRefresh={vi.fn()}
        projectName="Briar"
        readiness={null}
      />,
    );

    expect(container.textContent).toContain("확인 필요");
    expect(container.textContent).toContain("로컬 연결 상태를 확인하지 못했습니다.");
    expect(container.textContent).not.toContain("설치 안 됨");
    expect(container.textContent).not.toContain("GitHub CLI 설치");

  });

  it("does not require GitHub CLI for a workflow without PR stages", async () => {
    await renderReactTestRoot(
      root,
      <ProjectRepositorySetupDialog
        connectionState="connected"
        error={null}
        loading={false}
        onClose={vi.fn()}
        onStartWorking={vi.fn()}
        onRefresh={vi.fn()}
        projectName="Briar"
        readiness={{
          ...readiness,
          issues: [],
          remote: null,
          remoteReachable: false,
          pushAccess: false,
          requiresGithub: false,
          githubRepositoryId: null,
        }}
      />,
    );

    expect(container.textContent).toContain("Briar가 프로젝트의 GitHub 저장소");
    expect(container.textContent).toContain("Briar에서 이 컴퓨터로 작업 시작");
    expect(container.textContent).not.toContain("GitHub CLI 설치");
    expect(container.textContent).not.toContain("Push 권한 확인 필요");
    expect(container.textContent).toContain("준비 완료");

  });
});
