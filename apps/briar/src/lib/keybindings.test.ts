/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultKeybindings,
  defaultKeyboardNavigationPreferences,
  formatShortcut,
  getRecordingKeybinding,
  isAppSystemShortcut,
  isKeyboardShortcutsGuideShortcut,
  isNavigationHistoryShortcut,
  loadKeybindings,
  loadKeyboardNavigationPreferences,
  matchesShortcut,
  resetKeybinding,
  saveKeybinding,
  saveKeyboardNavigationPreferences,
  setRecordingKeybinding,
  shortcutFromEvent,
  shortcutsEqual,
  subscribeKeyboardNavigationPreferences,
  subscribeKeybindings,
  keybindingsStorageKey,
  keyboardNavigationPreferencesStorageKey,
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

  it("notifies keymap subscribers and keeps a volatile storage fallback", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeKeybindings(onChange);
    const setItem = vi.spyOn(Storage.prototype, "setItem")
      .mockImplementationOnce(() => {
        throw new DOMException("Storage unavailable", "SecurityError");
      });
    const custom = {
      key: "p",
      code: "KeyP",
      meta: true,
      ctrl: false,
      alt: true,
      shift: false,
    };

    expect(saveKeybinding("commandPalette", custom).commandPalette).toEqual(
      custom,
    );
    expect(loadKeybindings().commandPalette).toEqual(custom);
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ commandPalette: custom }),
    );

    unsubscribe();
    setItem.mockRestore();
    saveKeybinding("commandPalette", defaultKeybindings.commandPalette);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("persists the Linear-style sequence shortcut preference", () => {
    expect(loadKeyboardNavigationPreferences()).toEqual(
      defaultKeyboardNavigationPreferences,
    );

    expect(
      saveKeyboardNavigationPreferences({ sequenceShortcutsEnabled: false }),
    ).toEqual({ sequenceShortcutsEnabled: false });
    expect(loadKeyboardNavigationPreferences()).toEqual({
      sequenceShortcutsEnabled: false,
    });
  });

  it("repairs malformed keyboard navigation preferences", () => {
    window.localStorage.setItem(
      keyboardNavigationPreferencesStorageKey,
      JSON.stringify({ sequenceShortcutsEnabled: "yes" }),
    );
    expect(loadKeyboardNavigationPreferences()).toEqual(
      defaultKeyboardNavigationPreferences,
    );
  });

  it("keeps a valid shortcut when its sibling is malformed", () => {
    const customCommandPalette = {
      key: "p",
      code: "KeyP",
      meta: true,
      ctrl: false,
      alt: true,
      shift: false,
    };
    window.localStorage.setItem(
      keybindingsStorageKey,
      JSON.stringify({
        commandPalette: customCommandPalette,
        sidebarToggle: { key: "b" },
      }),
    );

    expect(loadKeybindings()).toEqual({
      commandPalette: customCommandPalette,
      sidebarToggle: defaultKeybindings.sidebarToggle,
    });
  });

  it("notifies preference subscribers and keeps a volatile storage fallback", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeKeyboardNavigationPreferences(onChange);
    const setItem = vi.spyOn(Storage.prototype, "setItem")
      .mockImplementationOnce(() => {
        throw new DOMException("Storage unavailable", "SecurityError");
      });

    expect(
      saveKeyboardNavigationPreferences({ sequenceShortcutsEnabled: false }),
    ).toEqual({ sequenceShortcutsEnabled: false });
    expect(loadKeyboardNavigationPreferences()).toEqual({
      sequenceShortcutsEnabled: false,
    });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenLastCalledWith({
      sequenceShortcutsEnabled: false,
    });

    unsubscribe();
    setItem.mockRestore();
    saveKeyboardNavigationPreferences(defaultKeyboardNavigationPreferences);
    expect(onChange).toHaveBeenCalledOnce();
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

  it("reserves the modifier shortcut used by the keyboard guide", () => {
    const guideShortcut = {
      key: "/",
      code: "Slash",
      meta: true,
      ctrl: false,
      alt: false,
      shift: false,
    };
    expect(isKeyboardShortcutsGuideShortcut(guideShortcut)).toBe(true);
    expect(
      shortcutFromEvent(new KeyboardEvent("keydown", {
        key: "/",
        code: "Slash",
        metaKey: true,
      })),
    ).toBeNull();
    expect(saveKeybinding("commandPalette", guideShortcut)).toEqual(
      defaultKeybindings,
    );

    window.localStorage.setItem(
      keybindingsStorageKey,
      JSON.stringify({ commandPalette: guideShortcut }),
    );
    expect(loadKeybindings()).toEqual(defaultKeybindings);
  });

  it("reserves app-owned system chords and repairs old conflicts", () => {
    const createIssue = {
      key: "n",
      code: "KeyN",
      meta: true,
      ctrl: false,
      alt: false,
      shift: false,
    };
    const zoomIn = {
      key: "+",
      code: "Equal",
      meta: true,
      ctrl: false,
      alt: false,
      shift: true,
    };
    expect(isAppSystemShortcut(createIssue)).toBe(true);
    expect(isAppSystemShortcut(zoomIn)).toBe(true);
    expect(saveKeybinding("commandPalette", createIssue)).toEqual(
      defaultKeybindings,
    );

    window.localStorage.setItem(
      keybindingsStorageKey,
      JSON.stringify({ commandPalette: createIssue }),
    );
    expect(loadKeybindings()).toEqual(defaultKeybindings);
  });

  it("rejects persisted bindings without a configurable modifier", () => {
    const shiftOnly = {
      key: "?",
      code: "Slash",
      meta: false,
      ctrl: false,
      alt: false,
      shift: true,
    };
    expect(saveKeybinding("sidebarToggle", shiftOnly)).toEqual(
      defaultKeybindings,
    );
    window.localStorage.setItem(
      keybindingsStorageKey,
      JSON.stringify({ sidebarToggle: shiftOnly }),
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

});
