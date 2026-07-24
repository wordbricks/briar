/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProjectOnboarding } from "./ProjectOnboarding";

class TestJellySelect extends HTMLElement {
  value = "";
  syncOptions() {}
}

if (!customElements.get("jelly-select")) {
  customElements.define("jelly-select", TestJellySelect);
}

const baseProps = {
  connection: null,
  error: null,
  loading: false,
  onCancel: () => undefined,
  onConnect: async () => undefined,
  onCreate: async () => undefined,
  onLogout: () => undefined,
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
  onVelenOrgChange: async () => null,
  user: { id: "user-1", name: "Jay", email: "jay@example.com" },
  velen: null,
};

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
        velen={{
          authenticated: true,
          currentOrg: "briar",
          email: "jay@example.com",
          organizations: [{ name: "Briar", slug: "briar" }],
          sources: [],
        }}
      />,
    );

    expect(markup).toContain('<jelly-select label="Velen 조직"');
    expect(markup).toContain("워크플로우 자동 생성");
    expect(markup).toContain("Agent backend");
    expect(markup).toContain("저장소 선택");
    expect(markup).toContain("백그라운드");
    expect(markup).toContain(">확인 ");
    expect(markup).not.toContain('label="Auto Hunt 워크플로"');
    expect(markup).not.toContain('aria-pressed="true"');
    expect(markup).not.toContain("<select");
  });

  it("keeps first-project onboarding non-cancellable", () => {
    const markup = renderToStaticMarkup(<ProjectOnboarding {...baseProps} />);

    expect(markup).toContain("프로젝트 만들기");
    expect(markup).not.toContain("대시보드로 돌아가기");
  });

  it("selects a repository from its card before confirming the connection", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
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
        velen={{
          authenticated: true,
          currentOrg: "briar",
          email: "jay@example.com",
          organizations: [{ name: "Briar", slug: "briar" }],
          sources: [],
        }}
      />,
    ));

    const confirm = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "확인");
    expect(confirm?.disabled).toBe(true);

    const select = container.querySelector<HTMLButtonElement>(
      ".setup-repository-action",
    );
    await act(async () => select?.click());

    expect(onRepositorySelect).toHaveBeenCalledOnce();
    expect(onRepositoryInspect).toHaveBeenCalledWith(
      "/Users/jay/git/briar",
      expect.objectContaining({ preset: "local" }),
    );
    expect(container.textContent).toContain("/Users/jay/git/briar");
    expect(container.textContent).toContain("push 권한 확인됨");
    expect(confirm?.disabled).toBe(false);

    await act(async () => confirm?.click());
    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        velenOrg: "briar",
        linearEnabled: false,
      }),
      "/Users/jay/git/briar",
    );

    await act(async () => root.unmount());
    container.remove();
  });
});
