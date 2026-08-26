import { useCallback, useEffect, useRef, useState } from "react";

import { getRecordingKeybinding } from "../lib/keybindings";
import {
  advanceKeyboardShortcut,
  hasOpenKeyboardShortcutOverlay,
  idleKeyboardShortcutState,
  keyboardShortcutSequenceTimeoutMs,
  shouldIgnoreKeyboardShortcutEvent,
  type KeyboardShortcutCommand,
  type KeyboardShortcutPendingState,
  type KeyboardShortcutState,
} from "../lib/keyboard-shortcuts";
import { remoteDesktopCapturesKeyboard } from "../lib/remote-desktop-focus";

export type KeyboardShortcutAction<CommandId extends string = string> =
  KeyboardShortcutCommand<CommandId> & {
    readonly onTrigger: () => void;
  };

export type KeyboardShortcutHookResult<CommandId extends string> = {
  cancelPendingShortcut: () => void;
  pendingShortcut: KeyboardShortcutPendingState<CommandId> | null;
};

export function useKeyboardShortcuts<CommandId extends string>({
  commands,
  enabled,
}: {
  commands: readonly KeyboardShortcutAction<CommandId>[];
  enabled: boolean;
}): KeyboardShortcutHookResult<CommandId> {
  const commandsRef = useRef(commands);
  const enabledRef = useRef(enabled);
  const stateRef = useRef<KeyboardShortcutState<CommandId>>(
    idleKeyboardShortcutState,
  );
  const [pendingShortcut, setPendingShortcut] =
    useState<KeyboardShortcutPendingState<CommandId> | null>(null);
  commandsRef.current = commands;
  enabledRef.current = enabled;

  const updateState = useCallback((state: KeyboardShortcutState<CommandId>) => {
    stateRef.current = state;
    setPendingShortcut(state.status === "pending" ? state : null);
  }, []);

  const cancelPendingShortcut = useCallback(() => {
    updateState(idleKeyboardShortcutState);
  }, [updateState]);

  useEffect(() => {
    if (enabled) return;
    cancelPendingShortcut();
  }, [cancelPendingShortcut, enabled]);

  useEffect(() => {
    if (!pendingShortcut) return;
    const timeout = window.setTimeout(
      cancelPendingShortcut,
      keyboardShortcutSequenceTimeoutMs,
    );
    return () => window.clearTimeout(timeout);
  }, [cancelPendingShortcut, pendingShortcut]);

  useEffect(() => {
    if (!pendingShortcut) return;
    document.addEventListener("pointerdown", cancelPendingShortcut, true);
    return () =>
      document.removeEventListener("pointerdown", cancelPendingShortcut, true);
  }, [cancelPendingShortcut, pendingShortcut]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!enabledRef.current) return;
      const activeCommands = commandsRef.current;
      const eventOptions = {
        isRecording: getRecordingKeybinding() !== null,
        remoteKeyboardCaptured: remoteDesktopCapturesKeyboard(),
      };
      if (shouldIgnoreKeyboardShortcutEvent(event, eventOptions)) return;
      const result = advanceKeyboardShortcut(
        stateRef.current,
        activeCommands,
        event,
        {
          ...eventOptions,
          hasOpenOverlay: hasOpenKeyboardShortcutOverlay(document),
        },
      );
      if (result.consumeEvent) event.preventDefault();
      if (result.state !== stateRef.current) updateState(result.state);
      if (result.status !== "matched") return;
      activeCommands.find((command) => command.id === result.commandId)
        ?.onTrigger();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [updateState]);

  return { cancelPendingShortcut, pendingShortcut };
}
