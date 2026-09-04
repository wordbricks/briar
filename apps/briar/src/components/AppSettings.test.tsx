/** @vitest-environment jsdom */

import { act, type ComponentProps } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import { demoRepositoryReadiness } from "../lib/demo-data";
import { AppSettings } from "./AppSettings";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const providerProps = {
  connectionState: "connected",
  error: null,
  initialSection: "providers",
  isSidebarOpen: true,
  loading: false,
  onBack: vi.fn(),
  onRefresh: vi.fn().mockResolvedValue(undefined),
  projectId: "project-1",
  projectName: "Briar",
  readiness: demoRepositoryReadiness,
  requiresLocalReadiness: false,
} satisfies ComponentProps<typeof AppSettings>;

describe("AppSettings providers", () => {
  it("lists the built-in providers and adds one from the add list", async () => {
    localStorage.setItem("briar.locale.v1", "ko");
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <AppSettings {...providerProps} />
      </I18nProvider>,
    );

    // Built-in providers are always listed; the rest wait in the add list.
    for (const provider of ["Codex", "Claude", "Antigravity", "OpenCode"]) {
      expect(
        container.querySelector(`[aria-label="${provider} enabled"]`),
      ).not.toBeNull();
    }
    for (const provider of ["Cursor", "Grok", "OpenRouter", "Vertex AI"]) {
      expect(
        container.querySelector(`[aria-label="${provider} enabled"]`),
      ).toBeNull();
      expect(
        container.querySelector(`[aria-label="${provider} 추가"]`),
      ).not.toBeNull();
    }

    const search = container.querySelector<HTMLInputElement>(
      '[aria-label="프로바이더 검색"]',
    );
    expect(search).not.toBeNull();

    const add = container.querySelector<HTMLButtonElement>(
      '[aria-label="Grok 추가"]',
    );
    await act(async () => {
      add?.click();
      await Promise.resolve();
    });

    // An added provider moves into the list with the normal enable toggle, and
    // leaves the add list behind.
    expect(
      container.querySelector('[aria-label="Grok enabled"]'),
    ).not.toBeNull();
    expect(container.querySelector('[aria-label="Grok 추가"]')).toBeNull();

    await cleanup();
  });
});

describe("AppSettings source control", () => {
  it("distinguishes remote state from a local workflow where GitHub is optional", async () => {
    localStorage.setItem("briar.locale.v1", "ko");
    const { cleanup, container, root } = createReactTestRoot();
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

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <AppSettings {...props} />
      </I18nProvider>,
    );

    expect(container.textContent).toContain(
      "데스크톱 앱에서 연결 상태를 확인할 수 있습니다.",
    );
    expect(container.querySelector('[aria-label="Git enabled"]')).toBeNull();
    expect(container.querySelector('[aria-label="GitHub enabled"]')).toBeNull();
    expect(
      container.querySelector('[aria-label="소스 제어 상태 새로고침"]'),
    ).toBeNull();

    await renderReactTestRoot(
      root,
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

    expect(
      container.querySelector('[aria-label="Git enabled"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="GitHub enabled"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      "현재 워크플로우에는 GitHub CLI가 필요하지 않습니다.",
    );
    expect(container.querySelector('[aria-label="선택"]')).not.toBeNull();
    expect(container.textContent).not.toContain(
      "GitHub CLI를 사용할 수 없습니다.",
    );
    expect(
      container.querySelector('[aria-label="소스 제어 상태 새로고침"]'),
    ).not.toBeNull();

    await cleanup();
  });
});
