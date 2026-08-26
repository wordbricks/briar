import { useEffect, useRef } from "react";

import {
  getRecordingKeybinding,
  keyboardEventIsComposing,
} from "../lib/keybindings";
import { hasOpenKeyboardShortcutOverlay } from "../lib/keyboard-shortcuts";
import { remoteDesktopCapturesKeyboard } from "../lib/remote-desktop-focus";

export function useSettingsEscape({
  enabled,
  onClose,
}: {
  enabled: boolean;
  onClose: () => void;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled) return;
    const closeSettings = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        keyboardEventIsComposing(event) ||
        getRecordingKeybinding() !== null ||
        remoteDesktopCapturesKeyboard() ||
        hasOpenKeyboardShortcutOverlay(document)
      ) {
        return;
      }
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", closeSettings);
    return () => window.removeEventListener("keydown", closeSettings);
  }, [enabled]);
}
