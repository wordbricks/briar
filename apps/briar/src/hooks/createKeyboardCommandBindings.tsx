import { useAtomRef } from "@effect/atom-react";
import type * as Duration from "effect/Duration";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";

import { getRecordingKeybinding } from "../lib/keybindings";
import {
  createKeyboardCommandController,
  KeyboardCommandDecision,
  type KeyboardCommandCatalog,
  type KeyboardCommandController,
  type KeyboardCommandInput,
  type KeyboardCommandPhase,
  type KeyboardCommandRegistrationToken,
  type KeyboardCommandScope,
  type KeyboardCommandState,
} from "../lib/keyboard-command-controller";
import {
  isKeyboardShortcutEditableEvent,
  isKeyboardShortcutEditableTarget,
  keyboardShortcutEventIsComposing,
} from "../lib/keyboard-shortcuts";
import { remoteDesktopCapturesKeyboard } from "../lib/remote-desktop-focus";

export type KeyboardCommandDomAdapterOptions<CommandId extends string> = {
  readonly controller: KeyboardCommandController<CommandId>;
  readonly documentTarget: Document;
  readonly isKeybindingRecording?: () => boolean;
  readonly remoteCapturesKeyboard?: () => boolean;
  readonly windowTarget: Window;
};

export type KeyboardCommandBindingsOptions = {
  readonly sequenceTimeout?: Duration.Input;
};

export type KeyboardCommandProviderProps<CommandId extends string> = {
  readonly catalog: KeyboardCommandCatalog<CommandId>;
  readonly children: ReactNode;
};

function inputFromKeyboardEvent(event: KeyboardEvent): KeyboardCommandInput {
  return {
    altKey: event.altKey,
    code: event.code,
    ctrlKey: event.ctrlKey,
    defaultPrevented: event.defaultPrevented,
    isComposing: keyboardShortcutEventIsComposing(event),
    key: event.key,
    metaKey: event.metaKey,
    nativeEvent: event,
    repeat: event.repeat,
    shiftKey: event.shiftKey,
  };
}

function pendingBelongsToPhase<CommandId extends string>(
  controller: KeyboardCommandController<CommandId>,
  phase: KeyboardCommandPhase,
): boolean {
  const pending = controller.snapshot.value.pending;
  return pending === null || pending.phase === phase;
}

/**
 * Installs exactly one capture adapter and one bubble adapter. The native event
 * is transient handler context; neither it nor its target enters Atom state.
 */
export function installKeyboardCommandDomAdapters<CommandId extends string>({
  controller,
  documentTarget,
  isKeybindingRecording = () => getRecordingKeybinding() !== null,
  remoteCapturesKeyboard = remoteDesktopCapturesKeyboard,
  windowTarget,
}: KeyboardCommandDomAdapterOptions<CommandId>): () => void {
  const projectMode = (editable: boolean) => {
    const mode = editable ? "insert" : "normal";
    if (controller.snapshot.value.mode !== mode) controller.setMode(mode);
  };
  const projectEventFocus = (event: Event) => {
    projectMode(isKeyboardShortcutEditableEvent(event));
  };
  const dispatch = (
    event: KeyboardEvent,
    phase: KeyboardCommandPhase,
  ) => {
    if (phase === "capture") projectEventFocus(event);
    if (isKeybindingRecording() || remoteCapturesKeyboard()) return;
    if (!pendingBelongsToPhase(controller, phase)) return;
    const decision = controller.dispatch(inputFromKeyboardEvent(event), phase);
    if (!KeyboardCommandDecision.$is("Ignored")(decision)) {
      event.preventDefault();
    }
  };
  const captureKeydown = (event: KeyboardEvent) => dispatch(event, "capture");
  const bubbleKeydown = (event: KeyboardEvent) => dispatch(event, "bubble");
  const projectFocus = (target: EventTarget | null) => {
    projectMode(isKeyboardShortcutEditableTarget(target));
  };
  const focusin = (event: FocusEvent) => projectEventFocus(event);
  const focusout = (event: FocusEvent) => projectFocus(event.relatedTarget);
  const cancelPending = () => controller.cancelPending();

  projectFocus(documentTarget.activeElement);
  windowTarget.addEventListener("keydown", captureKeydown, true);
  documentTarget.addEventListener("keydown", bubbleKeydown);
  documentTarget.addEventListener("focusin", focusin);
  documentTarget.addEventListener("focusout", focusout);
  documentTarget.addEventListener("pointerdown", cancelPending, true);

  return () => {
    windowTarget.removeEventListener("keydown", captureKeydown, true);
    documentTarget.removeEventListener("keydown", bubbleKeydown);
    documentTarget.removeEventListener("focusin", focusin);
    documentTarget.removeEventListener("focusout", focusout);
    documentTarget.removeEventListener("pointerdown", cancelPending, true);
  };
}

function scheduleWindowTimeout(
  callback: () => void,
  delayMs: number,
): () => void {
  const timeout = window.setTimeout(callback, delayMs);
  return () => window.clearTimeout(timeout);
}

export function createKeyboardCommandBindings<CommandId extends string>(
  options: KeyboardCommandBindingsOptions = {},
) {
  const ControllerContext = createContext<
    KeyboardCommandController<CommandId> | null
  >(null);
  ControllerContext.displayName = "KeyboardCommandControllerContext";

  function KeyboardCommandProvider({
    catalog,
    children,
  }: KeyboardCommandProviderProps<CommandId>) {
    const controllerRef = useRef<KeyboardCommandController<CommandId> | null>(
      null,
    );
    const lifecycleGenerationRef = useRef(0);
    if (controllerRef.current === null) {
      controllerRef.current = createKeyboardCommandController({
        catalog,
        scheduleSequenceTimeout: scheduleWindowTimeout,
        sequenceTimeout: options.sequenceTimeout,
      });
    }
    const controller = controllerRef.current;

    useLayoutEffect(() => {
      controller.setCatalog(catalog);
    }, [catalog, controller]);

    useEffect(() =>
      installKeyboardCommandDomAdapters({
        controller,
        documentTarget: document,
        windowTarget: window,
      }), [controller]);

    useEffect(() => {
      const generation = ++lifecycleGenerationRef.current;
      return () => {
        queueMicrotask(() => {
          if (lifecycleGenerationRef.current === generation) {
            controller.dispose();
          }
        });
      };
    }, [controller]);

    return (
      <ControllerContext.Provider value={controller}>
        {children}
      </ControllerContext.Provider>
    );
  }

  function useOptionalKeyboardCommandController():
    KeyboardCommandController<CommandId> | null {
    return useContext(ControllerContext);
  }

  function useKeyboardCommandController(): KeyboardCommandController<CommandId> {
    const controller = useOptionalKeyboardCommandController();
    if (controller === null) {
      throw new Error(
        "useKeyboardCommandController must be used inside KeyboardCommandProvider",
      );
    }
    return controller;
  }

  function useKeyboardCommandState(): KeyboardCommandState<CommandId> {
    return useAtomRef(useKeyboardCommandController().snapshot);
  }

  function useKeyboardCommandScope(
    scope: KeyboardCommandScope<CommandId>,
  ): void {
    const controller = useKeyboardCommandController();
    const latestScopeRef = useRef(scope);
    const tokenRef = useRef<KeyboardCommandRegistrationToken | null>(null);
    latestScopeRef.current = scope;

    useLayoutEffect(() => {
      const token = controller.registerScope(latestScopeRef.current);
      tokenRef.current = token;
      return () => {
        if (tokenRef.current === token) tokenRef.current = null;
        controller.unregisterScope(token);
      };
    }, [controller]);

    useLayoutEffect(() => {
      const token = tokenRef.current;
      if (token !== null) controller.updateScope(token, scope);
    }, [controller, scope]);
  }

  return {
    KeyboardCommandProvider,
    useKeyboardCommandController,
    useKeyboardCommandScope,
    useKeyboardCommandState,
    useOptionalKeyboardCommandController,
  } as const;
}
