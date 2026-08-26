import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

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

type StoredKeybindingValues = Partial<Record<KeybindingId, unknown>>;

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
export const keybindingsChangedEvent = "briar:keybindings-changed";
export const keyboardNavigationPreferencesStorageKey =
  "briar.settings.keyboard-navigation.v1";
export const keyboardNavigationPreferencesChangedEvent =
  "briar:keyboard-navigation-preferences-changed";

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
const shortcutEquivalence = Schema.toEquivalence(ShortcutSchema);
const StoredKeybindingsSchema = Schema.fromJsonString(Schema.Struct({
  commandPalette: Schema.optional(Schema.Unknown),
  sidebarToggle: Schema.optional(Schema.Unknown),
}));
const KeyboardNavigationPreferencesValueSchema = Schema.Struct({
  sequenceShortcutsEnabled: Schema.Boolean,
});
const KeyboardNavigationPreferencesSchema = Schema.fromJsonString(
  KeyboardNavigationPreferencesValueSchema,
);
const decodeShortcut = Schema.decodeUnknownOption(ShortcutSchema);
const decodeStoredKeybindings = Schema.decodeUnknownOption(
  StoredKeybindingsSchema,
);
const decodeKeyboardNavigationPreferences = Schema.decodeUnknownOption(
  KeyboardNavigationPreferencesSchema,
);
const decodeKeyboardNavigationPreferencesValue = Schema.decodeUnknownOption(
  KeyboardNavigationPreferencesValueSchema,
);

const modifierOnlyKeys = new Set(["Meta", "Control", "Alt", "Shift", "OS"]);

function hasConfigurableModifier(shortcut: Shortcut): boolean {
  return shortcut.meta || shortcut.ctrl || shortcut.alt;
}

let recordingKeybinding: KeybindingId | null = null;
let volatileKeybindings: Keybindings | null = null;
let volatileKeyboardNavigationPreferences:
  KeyboardNavigationPreferences | null = null;

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
    volatileKeybindings = null;
  } catch {
    volatileKeybindings = keybindings;
  }
}

export function loadKeybindings(): Keybindings {
  if (volatileKeybindings) return volatileKeybindings;
  const result: Keybindings = { ...defaultKeybindings };
  let repaired = false;
  try {
    const stored: StoredKeybindingValues = Option.getOrElse(
      decodeStoredKeybindings(
        window.localStorage.getItem(keybindingsStorageKey) ?? "{}",
      ),
      (): StoredKeybindingValues => ({}),
    );
    for (const id of keybindingIds) {
      const storedValue = stored[id];
      const storedShortcut = Option.getOrUndefined(
        decodeShortcut(storedValue),
      );
      if (
        storedShortcut &&
        hasConfigurableModifier(storedShortcut) &&
        !isReservedGlobalShortcut(storedShortcut)
      ) {
        result[id] = storedShortcut;
      } else if (storedValue !== undefined) {
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
  if (volatileKeyboardNavigationPreferences) {
    return volatileKeyboardNavigationPreferences;
  }
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
  volatileKeyboardNavigationPreferences = preferences;
  try {
    window.localStorage.setItem(
      keyboardNavigationPreferencesStorageKey,
      JSON.stringify(preferences),
    );
    volatileKeyboardNavigationPreferences = null;
  } catch {
    // Keep the preferences for the current session when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent<KeyboardNavigationPreferences>(
    keyboardNavigationPreferencesChangedEvent,
    { detail: preferences },
  ));
  return preferences;
}

export function subscribeKeyboardNavigationPreferences(
  onChange: (preferences: KeyboardNavigationPreferences) => void,
): () => void {
  const handleChange = (event: Event) => {
    const decoded = event instanceof CustomEvent
      ? decodeKeyboardNavigationPreferencesValue(event.detail)
      : Option.none<KeyboardNavigationPreferences>();
    onChange(Option.getOrElse(decoded, loadKeyboardNavigationPreferences));
  };
  const handleStorage = (event: StorageEvent) => {
    if (
      event.key !== null &&
      event.key !== keyboardNavigationPreferencesStorageKey
    ) return;
    volatileKeyboardNavigationPreferences = null;
    onChange(loadKeyboardNavigationPreferences());
  };
  window.addEventListener(
    keyboardNavigationPreferencesChangedEvent,
    handleChange,
  );
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(
      keyboardNavigationPreferencesChangedEvent,
      handleChange,
    );
    window.removeEventListener("storage", handleStorage);
  };
}

export function saveKeybinding(id: KeybindingId, shortcut: Shortcut): Keybindings {
  const current = loadKeybindings();
  if (
    !hasConfigurableModifier(shortcut) ||
    isReservedGlobalShortcut(shortcut)
  ) return current;
  const next = { ...current };
  const conflict = keybindingIds.find(
    (candidate) =>
      candidate !== id && shortcutsEqual(current[candidate], shortcut),
  );
  if (conflict) next[conflict] = current[id];
  next[id] = shortcut;
  persist(next);
  window.dispatchEvent(
    new CustomEvent<Keybindings>(keybindingsChangedEvent, { detail: next }),
  );
  return next;
}

export function resetKeybinding(id: KeybindingId): Keybindings {
  return saveKeybinding(id, defaultKeybindings[id]);
}

export function subscribeKeybindings(
  onChange: (keybindings: Keybindings) => void,
): () => void {
  const handleChange = (event: Event) => {
    if (event instanceof CustomEvent) {
      onChange(event.detail as Keybindings);
      return;
    }
    volatileKeybindings = null;
    onChange(loadKeybindings());
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== keybindingsStorageKey) return;
    handleChange(event);
  };
  window.addEventListener(keybindingsChangedEvent, handleChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(keybindingsChangedEvent, handleChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function shortcutsEqual(a: Shortcut, b: Shortcut): boolean {
  return shortcutEquivalence(a, b);
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

export function isKeyboardShortcutsGuideShortcut(
  shortcut: Shortcut,
): boolean {
  return (
    shortcut.meta !== shortcut.ctrl &&
    (shortcut.meta || shortcut.ctrl) &&
    !shortcut.alt &&
    !shortcut.shift &&
    (shortcut.code === "Slash" || shortcut.key === "/")
  );
}

export function isAppSystemShortcut(shortcut: Shortcut): boolean {
  if (!shortcut.meta || shortcut.ctrl || shortcut.alt) return false;
  if (
    !shortcut.shift &&
    (shortcut.code === "KeyN" ||
      shortcut.code === "Comma" ||
      shortcut.key.toLowerCase() === "n" ||
      shortcut.key === ",")
  ) {
    return true;
  }
  return shortcut.code === "Equal" ||
    shortcut.code === "NumpadAdd" ||
    shortcut.code === "Minus" ||
    shortcut.code === "NumpadSubtract" ||
    shortcut.key === "+" ||
    shortcut.key === "=" ||
    shortcut.key === "-" ||
    shortcut.key === "−";
}

export function isReservedGlobalShortcut(shortcut: Shortcut): boolean {
  return isNavigationHistoryShortcut(shortcut) ||
    isKeyboardShortcutsGuideShortcut(shortcut) ||
    isAppSystemShortcut(shortcut);
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
  return isReservedGlobalShortcut(shortcut) ? null : shortcut;
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
