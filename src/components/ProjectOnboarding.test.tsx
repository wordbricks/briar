/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProjectOnboarding } from "./ProjectOnboarding";

const baseProps = {
  connection: null,
  error: null,
  loading: false,
  onCancel: () => undefined,
  onConnect: async () => undefined,
  onCreate: async () => undefined,
  onLogout: () => undefined,
  onSkip: () => undefined,
  onRepositorySelect: async () => null,
  onRepositoryInspect: async (repositoryPath: string) => ({
    repositoryPath,
    gitInstalled: true,
    gitVersion: "git version 2.50.1",
    repositoryHealthy: true,
    remote: "git@github.com:wordbricks/briar.git",
    remoteReachable: true,
    pushAccess: true,
    requiresGithub: false,
    githubRepository: "wordbricks/briar",
    ghInstalled: true,
    ghVersion: "gh version 2.76.1",
    ghAuthenticated: true,
    ghAccount: "jay",
    githubWriteAccess: true,
    gitReady: true,
    prReady: true,
    issues: [],
  }),
  onWorkspaceCreate: async (name: string) => ({
    repositoryPath: `/Users/jay/Briar/${name}`,
    created: true,
  }),
  user: { id: "user-1", name: "Jay", email: "jay@example.com" },
};

function mountOnboarding() {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  return { container, root: createRoot(container) };
}

function buttonWithText(container: HTMLElement, label: string) {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((button) => button.textContent?.trim().startsWith(label));
}

function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setValue?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ProjectOnboarding", () => {
  it("shows a cancellable new-project flow for an existing workspace", () => {
    const markup = renderToStaticMarkup(
      <ProjectOnboarding {...baseProps} canCancel />,
    );

    expect(markup).toContain("프로젝트 추가");
    expect(markup).toContain("대시보드로 돌아가기");
  });

  it("explains automatic workflow generation during repository connection", () => {
    const markup = renderToStaticMarkup(
      <ProjectOnboarding
        {...baseProps}
        connection={{
          project: { id: "project-1", name: "Briar", createdAt: "2026-07-22T00:00:00Z" },
          agentToken: "token",
        }}
      />,
    );

    expect(markup).not.toContain("Velen");
    expect(markup).not.toContain("Linear 연동");
    expect(markup).toContain("워크플로우 자동 생성");
    expect(markup).toContain("Agent backend");
    expect(markup).toContain("저장소 선택");
    expect(markup).not.toContain("실행 호스트");
    expect(markup).not.toContain("SSH 별칭");
    expect(markup).not.toContain("SSH 호스트 추가");
    expect(markup).toContain("완료되어야 연결");
    expect(markup).toContain(">확인 ");
    expect(markup).not.toContain('label="Auto Hunt 워크플로"');
    expect(markup).not.toContain('aria-pressed="true"');
  });

  it("keeps first-project onboarding non-cancellable", () => {
    const markup = renderToStaticMarkup(<ProjectOnboarding {...baseProps} />);

    expect(markup).toContain("프로젝트 만들기");
    expect(markup).toContain("나중에 만들기");
    expect(markup).not.toContain("대시보드로 돌아가기");
  });

  it("lets first-time users continue without creating a project", async () => {
    const { container, root } = mountOnboarding();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onSkip = vi.fn();

    await act(async () =>
      root.render(
        <ProjectOnboarding
          {...baseProps}
          onCreate={onCreate}
          onSkip={onSkip}
        />,
      ),
    );

    await act(async () => buttonWithText(container, "나중에 만들기")?.click());

    expect(onSkip).toHaveBeenCalledOnce();
    expect(onCreate).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("offers both an existing repository and a from-scratch start", () => {
    const markup = renderToStaticMarkup(
      <ProjectOnboarding {...baseProps} canCancel />,
    );

    expect(markup).toContain("기존 저장소 연결");
    expect(markup).toContain("처음부터 시작");
    expect(markup).toContain("저장소 선택");
    expect(markup).not.toContain("나중에 만들기");
  });

  it("names a project after the repository it connects", async () => {
    const { container, root } = mountOnboarding();
    const onRepositorySelect = vi.fn().mockResolvedValue("/Users/jay/git/briar");
    const onRepositoryInspect = vi.fn(baseProps.onRepositoryInspect);
    const onCreate = vi.fn().mockResolvedValue(undefined);

    await act(async () => root.render(
      <ProjectOnboarding
        {...baseProps}
        canCancel
        onCreate={onCreate}
        onRepositoryInspect={onRepositoryInspect}
        onRepositorySelect={onRepositorySelect}
      />,
    ));

    const create = buttonWithText(container, "프로젝트 만들기");
    expect(create?.disabled).toBe(true);

    const select = container.querySelector<HTMLButtonElement>(
      ".repository-setup .setup-repository-action",
    );
    await act(async () => select?.click());

    const nameInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="프로젝트 이름"]',
    );
    expect(onRepositoryInspect).toHaveBeenCalledWith(
      "/Users/jay/git/briar",
      expect.objectContaining({ version: 1 }),
      "local",
    );
    expect(nameInput?.value).toBe("briar");
    expect(create?.disabled).toBe(false);

    await act(async () => create?.click());
    expect(onCreate).toHaveBeenCalledWith({ name: "briar" });

    await act(async () => root.unmount());
    container.remove();
  });

  it("creates a Briar-managed repository when starting from scratch", async () => {
    const { container, root } = mountOnboarding();
    const onWorkspaceCreate = vi.fn().mockResolvedValue({
      repositoryPath: "/Users/jay/Briar/atlas",
      created: true,
    });
    const onRepositoryInspect = vi.fn(baseProps.onRepositoryInspect);
    const onCreate = vi.fn().mockResolvedValue(undefined);

    await act(async () => root.render(
      <ProjectOnboarding
        {...baseProps}
        canCancel
        onCreate={onCreate}
        onRepositoryInspect={onRepositoryInspect}
        onWorkspaceCreate={onWorkspaceCreate}
      />,
    ));

    await act(async () => buttonWithText(container, "처음부터 시작")?.click());
    expect(container.querySelector(".repository-setup")).toBeNull();

    const nameInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="프로젝트 이름"]',
    );
    await act(async () => typeInto(nameInput!, "atlas"));

    await act(async () => buttonWithText(container, "프로젝트 만들기")?.click());

    expect(onWorkspaceCreate).toHaveBeenCalledWith("atlas");
    expect(onRepositoryInspect).toHaveBeenCalledWith(
      "/Users/jay/Briar/atlas",
      expect.objectContaining({ version: 1 }),
      "local",
    );
    expect(onCreate).toHaveBeenCalledWith({ name: "atlas" });

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps a failed repository creation on the create step", async () => {
    const { container, root } = mountOnboarding();
    const onWorkspaceCreate = vi
      .fn()
      .mockRejectedValue(new Error("Briar 폴더가 이미 있습니다."));
    const onCreate = vi.fn().mockResolvedValue(undefined);

    await act(async () => root.render(
      <ProjectOnboarding
        {...baseProps}
        canCancel
        onCreate={onCreate}
        onWorkspaceCreate={onWorkspaceCreate}
      />,
    ));

    await act(async () => buttonWithText(container, "처음부터 시작")?.click());
    const nameInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="프로젝트 이름"]',
    );
    await act(async () => typeInto(nameInput!, "atlas"));
    await act(async () => buttonWithText(container, "프로젝트 만들기")?.click());

    expect(onCreate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Briar 폴더가 이미 있습니다.");

    await act(async () => root.unmount());
    container.remove();
  });

  it("selects a repository from its card before confirming the connection", async () => {
    const { container, root } = mountOnboarding();
    const onConnect = vi.fn().mockResolvedValue("/Users/jay/git/briar");
    const onRepositorySelect = vi.fn().mockResolvedValue("/Users/jay/git/briar");
    const onRepositoryInspect = vi.fn(baseProps.onRepositoryInspect);

    await act(async () => root.render(
      <ProjectOnboarding
        {...baseProps}
        connection={{
          project: { id: "project-1", name: "Briar", createdAt: "2026-07-22T00:00:00Z" },
          agentToken: "token",
        }}
        onConnect={onConnect}
        onRepositorySelect={onRepositorySelect}
        onRepositoryInspect={onRepositoryInspect}
      />,
    ));

    const confirm = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "확인");
    expect(confirm?.disabled).toBe(true);

    const select = container.querySelector<HTMLButtonElement>(
      ".repository-setup .setup-repository-action",
    );
    await act(async () => select?.click());

    expect(onRepositorySelect).toHaveBeenCalledOnce();
    expect(onRepositoryInspect).toHaveBeenCalledWith(
      "/Users/jay/git/briar",
      expect.objectContaining({ version: 1 }),
      "local",
    );
    expect(container.textContent).toContain("/Users/jay/git/briar");
    expect(container.textContent).toContain("push 권한 확인됨");
    expect(confirm?.disabled).toBe(false);

    await act(async () => confirm?.click());
    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        velenOrg: null,
        linearEnabled: false,
        githubRepository: "wordbricks/briar",
      }),
      "/Users/jay/git/briar",
      "local",
    );

    await act(async () => root.unmount());
    container.remove();
  });
});
