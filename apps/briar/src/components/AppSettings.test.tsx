/** @vitest-environment jsdom */

import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import { demoRepositoryReadiness } from "../lib/demo-data";
import { AppSettings } from "./AppSettings";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("AppSettings source control", () => {
  it("distinguishes remote state from a local workflow where GitHub is optional", async () => {
    localStorage.setItem("briar.locale.v1", "ko");
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = {
      connectionState: "connected",
      error: null,
      initialSection: "source-control",
      isSidebarOpen: true,
      loading: false,
      onBack: vi.fn(),
      onRefresh: vi.fn().mockResolvedValue(undefined),
      projectId: "project-1",
      projectName: "Briar",
      readiness: demoRepositoryReadiness,
      requiresLocalReadiness: false,
    } satisfies ComponentProps<typeof AppSettings>;

    await act(async () => {
      root.render(
        <I18nProvider>
          <AppSettings {...props} />
        </I18nProvider>,
      );
    });

    expect(container.textContent).toContain(
      "데스크톱 앱에서 연결 상태를 확인할 수 있습니다.",
    );
    expect(container.querySelectorAll(".settings-provider-row")).toHaveLength(0);
    expect(
      container.querySelector('[aria-label="소스 제어 상태 새로고침"]'),
    ).toBeNull();

    await act(async () => {
      root.render(
        <I18nProvider>
          <AppSettings
            {...props}
            readiness={{
              ...demoRepositoryReadiness,
              ghAuthenticated: false,
              ghInstalled: false,
              ghVersion: null,
              githubRepository: null,
              githubWriteAccess: false,
              prReady: false,
              requiresGithub: false,
            }}
            requiresLocalReadiness
          />
        </I18nProvider>,
      );
    });

    const providerRows = container.querySelectorAll(".settings-provider-row");
    expect(providerRows).toHaveLength(2);
    expect(providerRows[0]?.textContent).toContain("Git");
    expect(providerRows[1]?.textContent).toContain(
      "현재 워크플로우에는 GitHub CLI가 필요하지 않습니다.",
    );
    expect(providerRows[1]?.querySelector('[aria-label="선택"]')).not.toBeNull();
    expect(providerRows[1]?.textContent).not.toContain(
      "GitHub CLI를 사용할 수 없습니다.",
    );
    expect(
      container.querySelector('[aria-label="소스 제어 상태 새로고침"]'),
    ).not.toBeNull();

    await act(async () => root.unmount());
  });
});
