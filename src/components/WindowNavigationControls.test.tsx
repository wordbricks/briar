/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { WindowNavigationControls } from "./WindowNavigationControls";

describe("WindowNavigationControls", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("exposes disabled states and invokes enabled history actions", async () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const root = createRoot(container);
    await act(async () =>
      root.render(
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
      ),
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
    const disabledForwardShortcut = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "BracketRight",
      key: "]",
      metaKey: true,
    });
    await act(async () => {
      window.dispatchEvent(disabledForwardShortcut);
    });
    expect(onBack).toHaveBeenCalledOnce();
    expect(onForward).not.toHaveBeenCalled();
    expect(disabledForwardShortcut.defaultPrevented).toBe(true);
    await act(async () => root.unmount());
  });

  it("maps Command-bracket shortcuts to backward and forward actions", async () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <I18nProvider>
          <WindowNavigationControls
            canGoBack
            canGoForward
            isSidebarOpen={false}
            onBack={onBack}
            onForward={onForward}
            onSidebarToggle={() => undefined}
          />
        </I18nProvider>,
      ),
    );

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "BracketLeft",
          key: "[",
          metaKey: true,
        }),
      );
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "BracketRight",
          key: "]",
          metaKey: true,
        }),
      );
    });

    expect(onBack).toHaveBeenCalledOnce();
    expect(onForward).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
});
