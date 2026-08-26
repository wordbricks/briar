import type { KeyboardShortcutHelpSection } from "../components/KeyboardShortcutsDialog";
import type { MessageKey } from "../i18n/messages";
import type { KeyboardShortcutSequence } from "./keyboard-shortcuts";

export type AppKeyboardShortcutCommandId =
  | "createIssue"
  | "openCommandPalette"
  | "showKeyboardShortcuts"
  | "toggleSidebar"
  | "goProjectHome"
  | "goIssues"
  | "goAgents"
  | "goInbox"
  | "goChannels"
  | "goDms"
  | "goSchedule"
  | "goSettings"
  | "openIssue"
  | "openProject"
  | "openChannel"
  | "openDm"
  | "openSession";

export type AppKeyboardShortcutGroupId = "general" | "go" | "open";

export type AppKeyboardShortcutSpec = {
  group: AppKeyboardShortcutGroupId;
  id: AppKeyboardShortcutCommandId;
  labelKey: MessageKey;
  sequence: KeyboardShortcutSequence;
};

export const appKeyboardShortcutSpecs: readonly AppKeyboardShortcutSpec[] = [
  {
    group: "general",
    id: "createIssue",
    labelKey: "keyboardShortcuts.createIssue",
    sequence: ["c"],
  },
  {
    group: "general",
    id: "openCommandPalette",
    labelKey: "keyboardShortcuts.commandPalette",
    sequence: ["/"],
  },
  {
    group: "general",
    id: "showKeyboardShortcuts",
    labelKey: "keyboardShortcuts.showGuide",
    sequence: ["?"],
  },
  {
    group: "general",
    id: "toggleSidebar",
    labelKey: "keyboardShortcuts.toggleSidebar",
    sequence: ["["],
  },
  {
    group: "go",
    id: "goProjectHome",
    labelKey: "keyboardShortcuts.goProjectHome",
    sequence: ["g", "h"],
  },
  {
    group: "go",
    id: "goIssues",
    labelKey: "keyboardShortcuts.goIssues",
    sequence: ["g", "e"],
  },
  {
    group: "go",
    id: "goAgents",
    labelKey: "keyboardShortcuts.goAgents",
    sequence: ["g", "a"],
  },
  {
    group: "go",
    id: "goInbox",
    labelKey: "keyboardShortcuts.goInbox",
    sequence: ["g", "i"],
  },
  {
    group: "go",
    id: "goChannels",
    labelKey: "keyboardShortcuts.goChannels",
    sequence: ["g", "c"],
  },
  {
    group: "go",
    id: "goDms",
    labelKey: "keyboardShortcuts.goDms",
    sequence: ["g", "d"],
  },
  {
    group: "go",
    id: "goSchedule",
    labelKey: "keyboardShortcuts.goSchedule",
    sequence: ["g", "l"],
  },
  {
    group: "go",
    id: "goSettings",
    labelKey: "keyboardShortcuts.goSettings",
    sequence: ["g", "s"],
  },
  {
    group: "open",
    id: "openIssue",
    labelKey: "keyboardShortcuts.openIssue",
    sequence: ["o", "i"],
  },
  {
    group: "open",
    id: "openProject",
    labelKey: "keyboardShortcuts.openProject",
    sequence: ["o", "p"],
  },
  {
    group: "open",
    id: "openChannel",
    labelKey: "keyboardShortcuts.openChannel",
    sequence: ["o", "c"],
  },
  {
    group: "open",
    id: "openDm",
    labelKey: "keyboardShortcuts.openDm",
    sequence: ["o", "d"],
  },
  {
    group: "open",
    id: "openSession",
    labelKey: "keyboardShortcuts.openSession",
    sequence: ["o", "s"],
  },
];

const groupLabelKeys = {
  general: "keyboardShortcuts.section.general",
  go: "keyboardShortcuts.section.go",
  open: "keyboardShortcuts.section.open",
} as const satisfies Record<AppKeyboardShortcutGroupId, MessageKey>;

const combinedGeneralCommandIds = new Set<AppKeyboardShortcutCommandId>([
  "openCommandPalette",
  "showKeyboardShortcuts",
  "toggleSidebar",
]);

function displaySequence(sequence: readonly string[]): string[] {
  return sequence.map((key) =>
    key.length === 1 ? key.toUpperCase() : key
  );
}

export function createKeyboardShortcutHelpSections({
  commandPaletteShortcut,
  keyboardShortcutsShortcut,
  sidebarShortcut,
  t,
}: {
  commandPaletteShortcut: string;
  keyboardShortcutsShortcut: string;
  sidebarShortcut: string;
  t: (key: MessageKey) => string;
}): KeyboardShortcutHelpSection[] {
  const sections: KeyboardShortcutHelpSection[] = (
    ["general", "go", "open"] as const
  ).map((group) => ({
    id: group,
    items: appKeyboardShortcutSpecs
      .filter(
        (shortcut) =>
          shortcut.group === group &&
          !combinedGeneralCommandIds.has(shortcut.id),
      )
      .map((shortcut) => ({
        id: shortcut.id,
        keys: displaySequence(shortcut.sequence),
        label: t(shortcut.labelKey),
      })),
    label: t(groupLabelKeys[group]),
  }));

  const generalSection = sections[0];
  if (generalSection) {
    sections[0] = {
      ...generalSection,
      items: [
        {
          id: "configuredCommandPalette",
          join: "or",
          keys: [commandPaletteShortcut, "/"],
          label: t("keyboardShortcuts.commandPalette"),
        },
        {
          id: "configuredSidebar",
          join: "or",
          keys: [sidebarShortcut, "["],
          label: t("keyboardShortcuts.toggleSidebar"),
        },
        {
          id: "navigationBack",
          keys: ["⌘["],
          label: t("navigation.back"),
        },
        {
          id: "navigationForward",
          keys: ["⌘]"],
          label: t("navigation.forward"),
        },
        {
          id: "keyboardShortcutsModifier",
          join: "or",
          keys: [keyboardShortcutsShortcut, "?"],
          label: t("keyboardShortcuts.showGuide"),
        },
        ...generalSection.items,
      ],
    };
  }
  sections.push({
    id: "list",
    items: [
      {
        id: "moveDown",
        join: "or" as const,
        keys: ["J", "↓"],
        label: t("keyboardShortcuts.moveDown"),
      },
      {
        id: "moveUp",
        join: "or" as const,
        keys: ["K", "↑"],
        label: t("keyboardShortcuts.moveUp"),
      },
      {
        id: "openFocused",
        keys: ["Enter"],
        label: t("keyboardShortcuts.openFocused"),
      },
    ],
    label: t("keyboardShortcuts.section.list"),
  });
  return sections;
}
