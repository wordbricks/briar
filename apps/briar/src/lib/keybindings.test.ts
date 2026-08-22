/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultKeybindings,
  formatShortcut,
  getRecordingKeybinding,
  installKeybindingShortcuts,
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

  it("defaults the sidebar toggle to command-b", () => {
    expect(loadKeybindings()).toEqual(defaultKeybindings);
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
  });

  it("formats shortcuts for macOS and other platforms", () => {
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

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        code: "KeyB",
        metaKey: true,
      }),
    );
    expect(fired).toEqual(["sidebarToggle"]);

    setRecordingKeybinding("sidebarToggle");
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        code: "KeyB",
        metaKey: true,
      }),
    );
    expect(fired).toEqual(["sidebarToggle"]);
    expect(getRecordingKeybinding()).toBe("sidebarToggle");

    uninstall();
  });
});
