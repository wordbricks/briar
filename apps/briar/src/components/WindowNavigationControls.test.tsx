/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import { WindowNavigationControls } from "./WindowNavigationControls";

describe("WindowNavigationControls", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createReactTestRoot>["root"];

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    await cleanup();
  });

  it("exposes history state and leaves keyboard ownership to the app controller", async () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <WindowNavigationControls
          canGoBack
          canGoForward={false}
          isSidebarOpen
          onBack={onBack}
          onForward={onForward}
          onSidebarToggle={() => undefined}
        />
      </I18nProvider>,
    );

    const back = container.querySelector<HTMLButtonElement>(
      '[aria-keyshortcuts="Meta+["]',
    );
    const forward = container.querySelector<HTMLButtonElement>(
      '[aria-keyshortcuts="Meta+]"]',
    );
    expect(back?.disabled).toBe(false);
    expect(forward?.disabled).toBe(true);

    await act(async () => back?.click());
    await act(async () => forward?.click());
    expect(onBack).toHaveBeenCalledOnce();
    expect(onForward).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      code: "BracketLeft",
      key: "[",
      metaKey: true,
    }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("exposes and invokes the sidebar control", async () => {
    const onSidebarToggle = vi.fn();
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <WindowNavigationControls
          canGoBack={false}
          canGoForward={false}
          isSidebarOpen={false}
          onBack={() => undefined}
          onForward={() => undefined}
          onSidebarToggle={onSidebarToggle}
        />
      </I18nProvider>,
    );

    const sidebar = container.querySelector<HTMLButtonElement>(
      '[aria-controls="app-sidebar"]',
    );
    expect(sidebar?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => sidebar?.click());
    expect(onSidebarToggle).toHaveBeenCalledOnce();
  });
});
