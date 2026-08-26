/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import {
  defaultKeybindings,
  formatShortcut,
  loadKeybindings,
  loadKeyboardNavigationPreferences,
} from "../lib/keybindings";
import { KeybindingsSettings } from "./KeybindingsSettings";

describe("KeybindingsSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("briar.locale.v1", "en");
  });

  it("records a new shortcut and persists it", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <KeybindingsSettings />
      </I18nProvider>,
    );

    const changeButton = container.querySelector<HTMLButtonElement>(
      '[data-keybinding-id="sidebarToggle"] [aria-label="Change"]',
    );
    await act(async () => changeButton?.click());

    expect(container.textContent).toContain("Press a new shortcut…");

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          code: "KeyS",
          metaKey: true,
          shiftKey: true,
        }),
      );
    });

    expect(loadKeybindings().sidebarToggle).toEqual({
      key: "s",
      code: "KeyS",
      meta: true,
      ctrl: false,
      alt: false,
      shift: true,
    });
    expect(container.textContent).toContain(
      formatShortcut({
        key: "s",
        code: "KeyS",
        meta: true,
        ctrl: false,
        alt: false,
        shift: true,
      }),
    );

    await cleanup();
  });

  it("toggles Linear-style single-key and sequence shortcuts", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <KeybindingsSettings />
      </I18nProvider>,
    );

    const toggle = container.querySelector<HTMLButtonElement>(
      '[aria-label="Single-key and sequence shortcuts"]',
    );
    expect(toggle?.getAttribute("data-state")).toBe("checked");

    await act(async () => toggle?.click());

    expect(loadKeyboardNavigationPreferences()).toEqual({
      sequenceShortcutsEnabled: false,
    });
    expect(toggle?.getAttribute("data-state")).toBe("unchecked");

    await cleanup();
  });

  it("cancels recording with Escape", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <KeybindingsSettings />
      </I18nProvider>,
    );

    const changeButton = container.querySelector<HTMLButtonElement>(
      '[data-keybinding-id="sidebarToggle"] [aria-label="Change"]',
    );
    await act(async () => changeButton?.click());
    expect(container.textContent).toContain("Press a new shortcut…");

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", code: "Escape" }),
      );
    });

    expect(loadKeybindings().sidebarToggle).toEqual(
      defaultKeybindings.sidebarToggle,
    );
    expect(container.textContent).not.toContain("Press a new shortcut…");

    await cleanup();
  });

  it("resets a customized binding back to its default", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <KeybindingsSettings />
      </I18nProvider>,
    );

    const changeButton = container.querySelector<HTMLButtonElement>(
      '[data-keybinding-id="sidebarToggle"] [aria-label="Change"]',
    );
    await act(async () => changeButton?.click());
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          code: "KeyS",
          metaKey: true,
        }),
      );
    });
    expect(loadKeybindings().sidebarToggle.key).toBe("s");

    const resetButton = container.querySelector<HTMLButtonElement>(
      '[data-keybinding-id="sidebarToggle"] [aria-label="Reset to default"]',
    );
    expect(resetButton).not.toBeNull();
    await act(async () => resetButton?.click());

    expect(loadKeybindings().sidebarToggle).toEqual(
      defaultKeybindings.sidebarToggle,
    );

    await cleanup();
  });
});
