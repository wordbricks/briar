/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { setRecordingKeybinding } from "../lib/keybindings";
import { WindowNavigationControls } from "./WindowNavigationControls";

describe("WindowNavigationControls", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    setRecordingKeybinding(null);
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    setRecordingKeybinding(null);
    container.remove();
  });

  it("exposes disabled states and invokes enabled history actions", async () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onSettings = vi.fn();
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
            onSettings={onSettings}
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
    const onSettings = vi.fn();
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
            onSettings={onSettings}
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

  it("captures layout fallbacks while ignoring composition and modifiers", async () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <I18nProvider>
          <WindowNavigationControls
            canGoBack
            canGoForward
            isSidebarOpen
            onBack={onBack}
            onForward={onForward}
            onSettings={() => undefined}
            onSidebarToggle={() => undefined}
          />
        </I18nProvider>,
      ),
    );

    const editor = document.createElement("input");
    editor.addEventListener("keydown", (event) => event.stopPropagation());
    container.append(editor);
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "[",
          metaKey: true,
        }),
      );
    });

    const webkitComposition = new KeyboardEvent("keydown", {
      key: "]",
      metaKey: true,
    });
    Object.defineProperty(webkitComposition, "keyCode", { value: 229 });
    await act(async () => {
      window.dispatchEvent(webkitComposition);
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "BracketRight",
          key: "]",
          metaKey: true,
          shiftKey: true,
        }),
      );
    });

    expect(onBack).toHaveBeenCalledOnce();
    expect(onForward).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("does not navigate while a custom shortcut is being recorded", async () => {
    const onBack = vi.fn();
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <I18nProvider>
          <WindowNavigationControls
            canGoBack
            canGoForward
            isSidebarOpen
            onBack={onBack}
            onForward={() => undefined}
            onSettings={() => undefined}
            onSidebarToggle={() => undefined}
          />
        </I18nProvider>,
      ),
    );

    setRecordingKeybinding("sidebarToggle");
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "BracketLeft",
          key: "[",
          metaKey: true,
        }),
      );
    });

    expect(onBack).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("opens settings with Command-comma", async () => {
    const onSettings = vi.fn();
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <I18nProvider>
          <WindowNavigationControls
            canGoBack={false}
            canGoForward={false}
            isSidebarOpen
            onBack={() => undefined}
            onForward={() => undefined}
            onSettings={onSettings}
            onSidebarToggle={() => undefined}
          />
        </I18nProvider>,
      ),
    );

    const settingsShortcut = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Comma",
      key: ",",
      metaKey: true,
    });
    await act(async () => {
      window.dispatchEvent(settingsShortcut);
    });

    expect(settingsShortcut.defaultPrevented).toBe(true);
    expect(onSettings).toHaveBeenCalledOnce();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "Comma",
          key: ",",
        }),
      );
    });
    expect(onSettings).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
});
