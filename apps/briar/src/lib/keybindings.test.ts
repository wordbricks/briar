/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultKeybindings,
  formatShortcut,
  getRecordingKeybinding,
  installKeybindingShortcuts,
  isNavigationHistoryShortcut,
  loadKeybindings,
  matchesShortcut,
  resetKeybinding,
  saveKeybinding,
  setRecordingKeybinding,
  shortcutFromEvent,
  shortcutsEqual,
  keybindingsStorageKey,
} from "./keybindings";

describe("keybindings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setRecordingKeybinding(null);
  });

  it("defaults the command palette to command-k and sidebar toggle to command-b", () => {
    expect(loadKeybindings()).toEqual(defaultKeybindings);
    expect(defaultKeybindings.commandPalette).toEqual({
      key: "k",
      code: "KeyK",
      meta: true,
      ctrl: false,
      alt: false,
      shift: false,
    });
    expect(defaultKeybindings.sidebarToggle).toEqual({
      key: "b",
      code: "KeyB",
      meta: true,
      ctrl: false,
      alt: false,
      shift: false,
    });
  });

  it("persists saved shortcuts and resets them to defaults", () => {
    saveKeybinding("sidebarToggle", {
      key: "s",
      code: "KeyS",
      meta: true,
      ctrl: false,
      alt: false,
      shift: true,
    });
    expect(loadKeybindings().sidebarToggle).toEqual({
      key: "s",
      code: "KeyS",
      meta: true,
      ctrl: false,
      alt: false,
      shift: true,
    });

    resetKeybinding("sidebarToggle");
    expect(loadKeybindings().sidebarToggle).toEqual(
      defaultKeybindings.sidebarToggle,
    );
  });

  it("swaps conflicting shortcuts so every command remains reachable", () => {
    expect(
      saveKeybinding("sidebarToggle", defaultKeybindings.commandPalette),
    ).toEqual({
      commandPalette: defaultKeybindings.sidebarToggle,
      sidebarToggle: defaultKeybindings.commandPalette,
    });
    expect(resetKeybinding("sidebarToggle")).toEqual(defaultKeybindings);

    window.localStorage.setItem(
      keybindingsStorageKey,
      JSON.stringify({ sidebarToggle: defaultKeybindings.commandPalette }),
    );
    expect(loadKeybindings()).toEqual({
      commandPalette: defaultKeybindings.sidebarToggle,
      sidebarToggle: defaultKeybindings.commandPalette,
    });
  });

  it("ignores malformed stored values", () => {
    window.localStorage.setItem(
      keybindingsStorageKey,
      JSON.stringify({ sidebarToggle: { key: "b" } }),
    );
    expect(loadKeybindings().sidebarToggle).toEqual(
      defaultKeybindings.sidebarToggle,
    );
  });

  it("matches an event against the default command-b shortcut", () => {
    const event = new KeyboardEvent("keydown", {
      key: "b",
      code: "KeyB",
      metaKey: true,
    });
    expect(matchesShortcut(event, defaultKeybindings.sidebarToggle)).toBe(true);
  });

  it("requires the exact modifier set", () => {
    const withShift = new KeyboardEvent("keydown", {
      key: "B",
      code: "KeyB",
      metaKey: true,
      shiftKey: true,
    });
    const withCtrl = new KeyboardEvent("keydown", {
      key: "b",
      code: "KeyB",
      metaKey: true,
      ctrlKey: true,
    });
    expect(matchesShortcut(withShift, defaultKeybindings.sidebarToggle)).toBe(
      false,
    );
    expect(matchesShortcut(withCtrl, defaultKeybindings.sidebarToggle)).toBe(
      false,
    );
  });

  it("captures a shortcut from an event", () => {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      metaKey: true,
      shiftKey: true,
    });
    expect(shortcutFromEvent(event)).toEqual({
      key: "k",
      code: "KeyK",
      meta: true,
      ctrl: false,
      alt: false,
      shift: true,
    });
  });

  it("rejects modifier-only and unmodified key presses while capturing", () => {
    expect(
      shortcutFromEvent(
        new KeyboardEvent("keydown", { key: "Meta", code: "MetaLeft", metaKey: true }),
      ),
    ).toBeNull();
    expect(
      shortcutFromEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK" })),
    ).toBeNull();
    const webkitCompositionEvent = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      metaKey: true,
    });
    Object.defineProperty(webkitCompositionEvent, "keyCode", { value: 229 });
    expect(shortcutFromEvent(webkitCompositionEvent)).toBeNull();
    expect(
      matchesShortcut(
        webkitCompositionEvent,
        defaultKeybindings.commandPalette,
      ),
    ).toBe(false);
  });

  it("reserves Command-bracket shortcuts for navigation history", () => {
    const back = {
      key: "[",
      code: "BracketLeft",
      meta: true,
      ctrl: false,
      alt: false,
      shift: false,
    };
    expect(isNavigationHistoryShortcut(back)).toBe(true);
    expect(
      shortcutFromEvent(
        new KeyboardEvent("keydown", {
          key: "[",
          code: "BracketLeft",
          metaKey: true,
        }),
      ),
    ).toBeNull();
    expect(saveKeybinding("sidebarToggle", back)).toEqual(defaultKeybindings);

    window.localStorage.setItem(
      keybindingsStorageKey,
      JSON.stringify({ sidebarToggle: back }),
    );
    expect(loadKeybindings()).toEqual(defaultKeybindings);
  });

  it("formats shortcuts for macOS and other platforms", () => {
    expect(formatShortcut(defaultKeybindings.commandPalette, true)).toBe("⌘K");
    expect(formatShortcut(defaultKeybindings.commandPalette, false)).toBe(
      "Cmd+K",
    );
    expect(formatShortcut(defaultKeybindings.sidebarToggle, true)).toBe("⌘B");
    expect(formatShortcut(defaultKeybindings.sidebarToggle, false)).toBe(
      "Cmd+B",
    );
  });

  it("compares shortcuts by value", () => {
    expect(
      shortcutsEqual(
        defaultKeybindings.sidebarToggle,
        { ...defaultKeybindings.sidebarToggle },
      ),
    ).toBe(true);
    expect(
      shortcutsEqual(
        defaultKeybindings.sidebarToggle,
        { ...defaultKeybindings.sidebarToggle, key: "s" },
      ),
    ).toBe(false);
  });

  it("notifies registered handlers and ignores matches while recording", () => {
    const fired: string[] = [];
    const uninstall = installKeybindingShortcuts((id) => fired.push(id));

    const nestedTarget = document.createElement("button");
    nestedTarget.addEventListener("keydown", (event) => event.stopPropagation());
    document.body.append(nestedTarget);
    nestedTarget.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "k",
        code: "KeyK",
        metaKey: true,
      }),
    );
    const webkitCompositionEvent = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      metaKey: true,
    });
    Object.defineProperty(webkitCompositionEvent, "keyCode", { value: 229 });
    window.dispatchEvent(webkitCompositionEvent);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        code: "KeyK",
        metaKey: true,
        repeat: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        code: "KeyB",
        metaKey: true,
      }),
    );
    expect(fired).toEqual(["commandPalette", "sidebarToggle"]);

    setRecordingKeybinding("sidebarToggle");
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        code: "KeyB",
        metaKey: true,
      }),
    );
    expect(fired).toEqual(["commandPalette", "sidebarToggle"]);
    expect(getRecordingKeybinding()).toBe("sidebarToggle");

    nestedTarget.remove();
    uninstall();
  });
});
