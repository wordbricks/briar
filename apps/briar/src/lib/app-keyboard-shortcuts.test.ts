import { describe, expect, it } from "vitest";
import type { MessageKey } from "../i18n/messages";
import {
  appKeyboardShortcutSpecs,
  createKeyboardShortcutHelpSections,
  type AppKeyboardShortcutCommandId,
} from "./app-keyboard-shortcuts";
import type { KeyboardShortcutSequence } from "./keyboard-shortcuts";

const translate = (key: MessageKey): string => key;

describe("app keyboard shortcuts", () => {
  it("keeps the command catalog mapped to its expected plain-key sequences", () => {
    const expected = new Map<
      AppKeyboardShortcutCommandId,
      KeyboardShortcutSequence
    >([
      ["createIssue", ["c"]],
      ["openCommandPalette", ["/"]],
      ["showKeyboardShortcuts", ["?"]],
      ["toggleSidebar", ["["]],
      ["goProjectHome", ["g", "h"]],
      ["goIssues", ["g", "e"]],
      ["goAgents", ["g", "a"]],
      ["goInbox", ["g", "i"]],
      ["goChannels", ["g", "c"]],
      ["goDms", ["g", "d"]],
      ["goSchedule", ["g", "l"]],
      ["goSettings", ["g", "s"]],
      ["openIssue", ["o", "i"]],
      ["openProject", ["o", "p"]],
      ["openChannel", ["o", "c"]],
      ["openDm", ["o", "d"]],
      ["openSession", ["o", "s"]],
    ]);
    const actual = new Map(
      appKeyboardShortcutSpecs.map((shortcut) => [
        shortcut.id,
        shortcut.sequence,
      ]),
    );

    expect(actual).toEqual(expected);
  });

  it("assigns a unique sequence to every command", () => {
    const serializedSequences = appKeyboardShortcutSpecs.map((shortcut) =>
      shortcut.sequence.join("\u0000")
    );

    expect(new Set(serializedSequences).size).toBe(serializedSequences.length);
  });

  it("does not let one command shadow a longer sequence", () => {
    for (const shortcut of appKeyboardShortcutSpecs) {
      const prefix = shortcut.sequence.join("\u0000");
      const shadowed = appKeyboardShortcutSpecs.find(
        (candidate) =>
          candidate.id !== shortcut.id &&
          candidate.sequence.length > shortcut.sequence.length &&
          candidate.sequence.join("\u0000").startsWith(`${prefix}\u0000`),
      );
      expect(shadowed, `${shortcut.id} shadows ${shadowed?.id}`).toBeUndefined();
    }
  });

  it("combines configured and plain alternatives with or in general help", () => {
    const sections = createKeyboardShortcutHelpSections({
      commandPaletteShortcut: "Ctrl+K",
      keyboardShortcutsShortcut: "Ctrl+/",
      sidebarShortcut: "Ctrl+B",
      t: translate,
    });
    const general = sections.find((section) => section.id === "general");

    expect(general?.items).toEqual(expect.arrayContaining([
      {
        id: "configuredCommandPalette",
        join: "or",
        keys: ["Ctrl+K", "/"],
        label: "keyboardShortcuts.commandPalette",
      },
      {
        id: "configuredSidebar",
        join: "or",
        keys: ["Ctrl+B", "["],
        label: "keyboardShortcuts.toggleSidebar",
      },
      {
        id: "keyboardShortcutsModifier",
        join: "or",
        keys: ["Ctrl+/", "?"],
        label: "keyboardShortcuts.showGuide",
      },
    ]));
    expect(general?.items.map((item) => item.id)).not.toEqual(
      expect.arrayContaining([
        "openCommandPalette",
        "showKeyboardShortcuts",
        "toggleSidebar",
      ]),
    );
  });

  it("renders multi-key catalog entries as ordered help sequences", () => {
    const sections = createKeyboardShortcutHelpSections({
      commandPaletteShortcut: "Ctrl+K",
      keyboardShortcutsShortcut: "Ctrl+/",
      sidebarShortcut: "Ctrl+B",
      t: translate,
    });
    const goInbox = sections
      .find((section) => section.id === "go")
      ?.items.find((item) => item.id === "goInbox");
    const openIssue = sections
      .find((section) => section.id === "open")
      ?.items.find((item) => item.id === "openIssue");

    expect(goInbox).toMatchObject({ keys: ["G", "I"] });
    expect(goInbox?.join).toBeUndefined();
    expect(openIssue).toMatchObject({ keys: ["O", "I"] });
    expect(openIssue?.join).toBeUndefined();
  });

  it("documents only the implemented J, K, and Enter list controls", () => {
    const sections = createKeyboardShortcutHelpSections({
      commandPaletteShortcut: "Ctrl+K",
      keyboardShortcutsShortcut: "Ctrl+/",
      sidebarShortcut: "Ctrl+B",
      t: translate,
    });
    const list = sections.find((section) => section.id === "list");

    expect(list?.items).toEqual([
      {
        id: "moveDown",
        join: "or",
        keys: ["J", "↓"],
        label: "keyboardShortcuts.moveDown",
      },
      {
        id: "moveUp",
        join: "or",
        keys: ["K", "↑"],
        label: "keyboardShortcuts.moveUp",
      },
      {
        id: "openFocused",
        keys: ["Enter"],
        label: "keyboardShortcuts.openFocused",
      },
    ]);
  });

  it("hides inactive plain-key commands when sequence shortcuts are off", () => {
    const sections = createKeyboardShortcutHelpSections({
      commandPaletteShortcut: "Ctrl+K",
      keyboardShortcutsShortcut: "Ctrl+/",
      sequenceShortcutsEnabled: false,
      sidebarShortcut: "Ctrl+B",
      t: translate,
    });

    expect(sections.map((section) => section.id)).toEqual(["general"]);
    expect(sections[0]?.items).toEqual([
      {
        id: "configuredCommandPalette",
        join: undefined,
        keys: ["Ctrl+K"],
        label: "keyboardShortcuts.commandPalette",
      },
      {
        id: "configuredSidebar",
        join: undefined,
        keys: ["Ctrl+B"],
        label: "keyboardShortcuts.toggleSidebar",
      },
      {
        id: "navigationBack",
        keys: ["⌘["],
        label: "navigation.back",
      },
      {
        id: "navigationForward",
        keys: ["⌘]"],
        label: "navigation.forward",
      },
      {
        id: "keyboardShortcutsModifier",
        join: undefined,
        keys: ["Ctrl+/"],
        label: "keyboardShortcuts.showGuide",
      },
    ]);
  });
});
