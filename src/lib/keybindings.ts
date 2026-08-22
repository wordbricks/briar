import { remoteDesktopCapturesKeyboard } from "./remote-desktop-focus";

export type KeybindingId = "sidebarToggle";

export type Shortcut = {
  key: string;
  code: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
};

export type Keybindings = Record<KeybindingId, Shortcut>;

export const keybindingIds: KeybindingId[] = ["sidebarToggle"];

export const defaultKeybindings: Keybindings = {
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

const modifierOnlyKeys = new Set(["Meta", "Control", "Alt", "Shift", "OS"]);

let recordingKeybinding: KeybindingId | null = null;

export function setRecordingKeybinding(id: KeybindingId | null) {
  recordingKeybinding = id;
}

export function getRecordingKeybinding(): KeybindingId | null {
  return recordingKeybinding;
}

function isShortcut(value: unknown): value is Shortcut {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.code === "string" &&
    typeof candidate.meta === "boolean" &&
    typeof candidate.ctrl === "boolean" &&
    typeof candidate.alt === "boolean" &&
    typeof candidate.shift === "boolean"
  );
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
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(keybindingsStorageKey) ?? "{}",
    ) as Partial<Keybindings>;
    for (const id of keybindingIds) {
      if (isShortcut(stored[id])) result[id] = stored[id]!;
    }
  } catch {
    // Fall back to the defaults when stored keybindings are unreadable.
  }
  return result;
}

export function saveKeybinding(id: KeybindingId, shortcut: Shortcut): Keybindings {
  const next = { ...loadKeybindings(), [id]: shortcut };
  persist(next);
  return next;
}

export function resetKeybinding(id: KeybindingId): Keybindings {
  const next = { ...loadKeybindings(), [id]: defaultKeybindings[id] };
  persist(next);
  return next;
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

export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  if (event.isComposing) return false;
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
  if (event.isComposing || modifierOnlyKeys.has(event.key)) return null;
  if (event.key === "Escape") return null;
  if (!event.metaKey && !event.ctrlKey && !event.altKey) return null;
  return {
    key: event.key,
    code: event.code,
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
  };
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/iu.test(
    `${navigator.platform} ${navigator.userAgent}`,
  );
}

const specialKeys: Record<string, string> = {
  " ": "Space",
  Spacebar: "Space",
  Enter: "Enter",
  Escape: "Esc",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Home: "Home",
  End: "End",
  PageUp: "PgUp",
  PageDown: "PgDn",
};

function displayKey(key: string): string {
  if (specialKeys[key]) return specialKeys[key];
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
      event.isComposing || getRecordingKeybinding() ||
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
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}
