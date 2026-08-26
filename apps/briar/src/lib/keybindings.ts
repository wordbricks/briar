import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { remoteDesktopCapturesKeyboard } from "./remote-desktop-focus";

export type KeybindingId = "commandPalette" | "sidebarToggle";

export type Shortcut = {
  key: string;
  code: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
};

export type Keybindings = {
  commandPalette: Shortcut;
  sidebarToggle: Shortcut;
};

export type KeyboardNavigationPreferences = {
  sequenceShortcutsEnabled: boolean;
};

export const keybindingIds: KeybindingId[] = [
  "commandPalette",
  "sidebarToggle",
];

export const defaultKeybindings: Keybindings = {
  commandPalette: {
    key: "k",
    code: "KeyK",
    meta: true,
    ctrl: false,
    alt: false,
    shift: false,
  },
  sidebarToggle: {
    key: "b",
    code: "KeyB",
    meta: true,
    ctrl: false,
    alt: false,
    shift: false,
  },
};

export const keybindingsStorageKey = "briar.settings.keybindings.v1";
export const keyboardNavigationPreferencesStorageKey =
  "briar.settings.keyboard-navigation.v1";

export const defaultKeyboardNavigationPreferences:
  KeyboardNavigationPreferences = {
    sequenceShortcutsEnabled: true,
  };

const ShortcutSchema = Schema.Struct({
  key: Schema.String,
  code: Schema.String,
  meta: Schema.Boolean,
  ctrl: Schema.Boolean,
  alt: Schema.Boolean,
  shift: Schema.Boolean,
});
const StoredKeybindingsSchema = Schema.fromJsonString(Schema.Struct({
  commandPalette: Schema.optional(ShortcutSchema),
  sidebarToggle: Schema.optional(ShortcutSchema),
}));
const KeyboardNavigationPreferencesSchema = Schema.fromJsonString(
  Schema.Struct({
    sequenceShortcutsEnabled: Schema.Boolean,
  }),
);
const decodeStoredKeybindings = Schema.decodeUnknownOption(
  StoredKeybindingsSchema,
);
const decodeKeyboardNavigationPreferences = Schema.decodeUnknownOption(
  KeyboardNavigationPreferencesSchema,
);

const modifierOnlyKeys = new Set(["Meta", "Control", "Alt", "Shift", "OS"]);

let recordingKeybinding: KeybindingId | null = null;

export function keyboardEventIsComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

export function setRecordingKeybinding(id: KeybindingId | null) {
  recordingKeybinding = id;
}

export function getRecordingKeybinding(): KeybindingId | null {
  return recordingKeybinding;
}

function persist(keybindings: Keybindings) {
  try {
    window.localStorage.setItem(keybindingsStorageKey, JSON.stringify(keybindings));
  } catch {
    // Keep the keybindings for the current session when storage is unavailable.
  }
}

export function loadKeybindings(): Keybindings {
  const result: Keybindings = { ...defaultKeybindings };
  let repaired = false;
  try {
    const stored: Partial<Keybindings> = Option.getOrElse(
      decodeStoredKeybindings(
        window.localStorage.getItem(keybindingsStorageKey) ?? "{}",
      ),
      (): Partial<Keybindings> => ({}),
    );
    for (const id of keybindingIds) {
      const storedShortcut = stored[id];
      if (
        storedShortcut &&
        !isNavigationHistoryShortcut(storedShortcut)
      ) {
        result[id] = storedShortcut;
      } else if (storedShortcut) {
        repaired = true;
      }
    }
    if (shortcutsEqual(result.commandPalette, result.sidebarToggle)) {
      if (
        stored.sidebarToggle &&
        !stored.commandPalette
      ) {
        result.commandPalette = defaultKeybindings.sidebarToggle;
      } else {
        result.sidebarToggle = defaultKeybindings.sidebarToggle;
        if (shortcutsEqual(result.commandPalette, result.sidebarToggle)) {
          result.sidebarToggle = defaultKeybindings.commandPalette;
        }
      }
      persist(result);
      repaired = false;
    }
    if (repaired) persist(result);
  } catch {
    // Fall back to the defaults when stored keybindings are unreadable.
  }
  return result;
}

export function loadKeyboardNavigationPreferences():
  KeyboardNavigationPreferences {
  try {
    return Option.getOrElse(
      decodeKeyboardNavigationPreferences(
        window.localStorage.getItem(
          keyboardNavigationPreferencesStorageKey,
        ) ?? "{}",
      ),
      () => defaultKeyboardNavigationPreferences,
    );
  } catch {
    return defaultKeyboardNavigationPreferences;
  }
}

export function saveKeyboardNavigationPreferences(
  preferences: KeyboardNavigationPreferences,
): KeyboardNavigationPreferences {
  try {
    window.localStorage.setItem(
      keyboardNavigationPreferencesStorageKey,
      JSON.stringify(preferences),
    );
  } catch {
    // Keep the preferences for the current session when storage is unavailable.
  }
  return preferences;
}

export function saveKeybinding(id: KeybindingId, shortcut: Shortcut): Keybindings {
  const current = loadKeybindings();
  if (isNavigationHistoryShortcut(shortcut)) return current;
  const next = { ...current };
  const conflict = keybindingIds.find(
    (candidate) =>
      candidate !== id && shortcutsEqual(current[candidate], shortcut),
  );
  if (conflict) next[conflict] = current[id];
  next[id] = shortcut;
  persist(next);
  return next;
}

export function resetKeybinding(id: KeybindingId): Keybindings {
  return saveKeybinding(id, defaultKeybindings[id]);
}

export function shortcutsEqual(a: Shortcut, b: Shortcut): boolean {
  return (
    a.key === b.key &&
    a.code === b.code &&
    a.meta === b.meta &&
    a.ctrl === b.ctrl &&
    a.alt === b.alt &&
    a.shift === b.shift
  );
}

export function isNavigationHistoryShortcut(shortcut: Shortcut): boolean {
  return (
    shortcut.meta &&
    !shortcut.ctrl &&
    !shortcut.alt &&
    !shortcut.shift &&
    (shortcut.code === "BracketLeft" ||
      shortcut.code === "BracketRight" ||
      shortcut.key === "[" ||
      shortcut.key === "]")
  );
}

export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  if (keyboardEventIsComposing(event)) return false;
  if (event.metaKey !== shortcut.meta) return false;
  if (event.ctrlKey !== shortcut.ctrl) return false;
  if (event.altKey !== shortcut.alt) return false;
  if (event.shiftKey !== shortcut.shift) return false;
  return (
    event.key.toLowerCase() === shortcut.key.toLowerCase() ||
    event.code === shortcut.code
  );
}

export function shortcutFromEvent(event: KeyboardEvent): Shortcut | null {
  if (keyboardEventIsComposing(event) || modifierOnlyKeys.has(event.key)) {
    return null;
  }
  if (event.key === "Escape") return null;
  if (!event.metaKey && !event.ctrlKey && !event.altKey) return null;
  const shortcut = {
    key: event.key,
    code: event.code,
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
  };
  return isNavigationHistoryShortcut(shortcut) ? null : shortcut;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/iu.test(
    `${navigator.platform} ${navigator.userAgent}`,
  );
}

const specialKeys = new Map([
  [" ", "Space"],
  ["Spacebar", "Space"],
  ["Enter", "Enter"],
  ["Escape", "Esc"],
  ["Tab", "Tab"],
  ["Backspace", "Backspace"],
  ["Delete", "Delete"],
  ["ArrowUp", "↑"],
  ["ArrowDown", "↓"],
  ["ArrowLeft", "←"],
  ["ArrowRight", "→"],
  ["Home", "Home"],
  ["End", "End"],
  ["PageUp", "PgUp"],
  ["PageDown", "PgDn"],
]);

function displayKey(key: string): string {
  const specialKey = specialKeys.get(key);
  if (specialKey) return specialKey;
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function formatShortcut(
  shortcut: Shortcut,
  isMac = isMacPlatform(),
): string {
  const parts: string[] = [];
  if (isMac) {
    if (shortcut.ctrl) parts.push("⌃");
    if (shortcut.alt) parts.push("⌥");
    if (shortcut.shift) parts.push("⇧");
    if (shortcut.meta) parts.push("⌘");
  } else {
    if (shortcut.ctrl) parts.push("Ctrl");
    if (shortcut.alt) parts.push("Alt");
    if (shortcut.shift) parts.push("Shift");
    if (shortcut.meta) parts.push("Cmd");
  }
  parts.push(displayKey(shortcut.key));
  return isMac ? parts.join("") : parts.join("+");
}

export function installKeybindingShortcuts(
  onShortcut: (id: KeybindingId) => void,
): () => void {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (
      event.repeat || keyboardEventIsComposing(event) || getRecordingKeybinding() ||
      remoteDesktopCapturesKeyboard()
    ) return;
    const keybindings = loadKeybindings();
    for (const id of keybindingIds) {
      if (matchesShortcut(event, keybindings[id])) {
        event.preventDefault();
        onShortcut(id);
        return;
      }
    }
  };
  window.addEventListener("keydown", handleKeyDown, true);
  return () => window.removeEventListener("keydown", handleKeyDown, true);
}
