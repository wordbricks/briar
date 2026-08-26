export type KeyboardShortcutLetter =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z";

export type KeyboardShortcutToken =
  | KeyboardShortcutLetter
  | "["
  | "]"
  | "/"
  | "?"
  | "escape";

export type KeyboardShortcutSequence = readonly [
  KeyboardShortcutToken,
  ...KeyboardShortcutToken[],
];

export type KeyboardShortcutCommand<CommandId extends string = string> = {
  readonly disabled?: boolean;
  readonly id: CommandId;
  readonly label: string;
  readonly sequence: KeyboardShortcutSequence;
};

export type KeyboardShortcutIdleState = {
  readonly status: "idle";
};

export type KeyboardShortcutPendingState<CommandId extends string = string> = {
  readonly candidateIds: readonly CommandId[];
  readonly prefix: KeyboardShortcutSequence;
  readonly status: "pending";
};

export type KeyboardShortcutState<CommandId extends string = string> =
  | KeyboardShortcutIdleState
  | KeyboardShortcutPendingState<CommandId>;

export type KeyboardShortcutIgnoredResult<CommandId extends string = string> = {
  readonly consumeEvent: false;
  readonly state: KeyboardShortcutState<CommandId>;
  readonly status: "ignored";
};

export type KeyboardShortcutPendingResult<CommandId extends string = string> = {
  readonly consumeEvent: true;
  readonly state: KeyboardShortcutPendingState<CommandId>;
  readonly status: "pending";
};

export type KeyboardShortcutMatchedResult<CommandId extends string = string> = {
  readonly commandId: CommandId;
  readonly consumeEvent: true;
  readonly state: KeyboardShortcutIdleState;
  readonly status: "matched";
};

export type KeyboardShortcutCancelledResult =
  | {
    readonly consumeEvent: true;
    readonly reason: "escape";
    readonly state: KeyboardShortcutIdleState;
    readonly status: "cancelled";
  }
  | {
    readonly consumeEvent: false;
    readonly reason: "invalid";
    readonly state: KeyboardShortcutIdleState;
    readonly status: "cancelled";
  };

export type KeyboardShortcutAdvanceResult<CommandId extends string = string> =
  | KeyboardShortcutIgnoredResult<CommandId>
  | KeyboardShortcutPendingResult<CommandId>
  | KeyboardShortcutMatchedResult<CommandId>
  | KeyboardShortcutCancelledResult;

export type KeyboardShortcutEventOptions = {
  readonly hasOpenOverlay?: boolean;
  readonly isRecording?: boolean;
  readonly remoteKeyboardCaptured?: boolean;
};

export const keyboardShortcutSequenceTimeoutMs = 1_500;

export const idleKeyboardShortcutState: KeyboardShortcutIdleState = {
  status: "idle",
};

const keyboardShortcutTokenByCode = new Map<
  string,
  KeyboardShortcutLetter
>([
  ["KeyA", "a"],
  ["KeyB", "b"],
  ["KeyC", "c"],
  ["KeyD", "d"],
  ["KeyE", "e"],
  ["KeyF", "f"],
  ["KeyG", "g"],
  ["KeyH", "h"],
  ["KeyI", "i"],
  ["KeyJ", "j"],
  ["KeyK", "k"],
  ["KeyL", "l"],
  ["KeyM", "m"],
  ["KeyN", "n"],
  ["KeyO", "o"],
  ["KeyP", "p"],
  ["KeyQ", "q"],
  ["KeyR", "r"],
  ["KeyS", "s"],
  ["KeyT", "t"],
  ["KeyU", "u"],
  ["KeyV", "v"],
  ["KeyW", "w"],
  ["KeyX", "x"],
  ["KeyY", "y"],
  ["KeyZ", "z"],
]);

const overlaySelector = [
  "dialog",
  '[aria-modal="true"]',
  '[role="alertdialog"]',
  '[role="dialog"]',
  '[role="listbox"]',
  '[role="menu"]',
  "[data-briar-dialog-overlay]",
].join(",");

const closedOverlayAncestorSelector = [
  "[hidden]",
  "[inert]",
  '[aria-hidden="true"]',
  '[data-state="closed"]',
].join(",");

function eventTargetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

export function isKeyboardShortcutEditableTarget(
  target: EventTarget | null,
): boolean {
  const element = eventTargetElement(target);
  if (!element) return false;
  if (element.closest("input,select,textarea")) return true;
  if (element.closest('[role="combobox"],[role="textbox"]')) return true;

  const contentEditable = element.closest("[contenteditable]");
  if (!contentEditable) return false;
  return contentEditable.getAttribute("contenteditable") !== "false";
}

export function isOpenKeyboardShortcutOverlay(element: Element): boolean {
  if (element.closest(closedOverlayAncestorSelector)) return false;

  if (element.localName === "dialog") return element.hasAttribute("open");
  if (element.getAttribute("aria-modal") === "true") return true;
  if (
    element.hasAttribute("data-briar-dialog-overlay") &&
    element.getAttribute("data-state") === "open"
  ) {
    return true;
  }

  const role = element.getAttribute("role");
  return (
    role === "alertdialog" ||
    role === "dialog" ||
    role === "listbox" ||
    role === "menu"
  );
}

export function hasOpenKeyboardShortcutOverlay(root: ParentNode): boolean {
  return [...root.querySelectorAll(overlaySelector)].some(
    isOpenKeyboardShortcutOverlay,
  );
}

export function keyboardShortcutEventIsComposing(
  event: KeyboardEvent,
): boolean {
  return event.isComposing || event.keyCode === 229;
}

function keyboardShortcutEventHasUnsupportedModifier(
  event: KeyboardEvent,
): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) return true;
  if (!event.shiftKey) return false;
  return !(event.code === "Slash" && event.key === "?");
}

export function shouldIgnoreKeyboardShortcutEvent(
  event: KeyboardEvent,
  options: KeyboardShortcutEventOptions = {},
): boolean {
  return (
    event.defaultPrevented ||
    event.repeat ||
    keyboardShortcutEventIsComposing(event) ||
    keyboardShortcutEventHasUnsupportedModifier(event) ||
    isKeyboardShortcutEditableTarget(event.target) ||
    options.hasOpenOverlay === true ||
    options.isRecording === true ||
    options.remoteKeyboardCaptured === true
  );
}

export function normalizeKeyboardShortcutToken(
  event: KeyboardEvent,
): KeyboardShortcutToken | null {
  const letter = keyboardShortcutTokenByCode.get(event.code);
  if (letter) return letter;
  if (event.code === "Escape") return "escape";
  if (event.code === "BracketLeft") return "[";
  if (event.code === "BracketRight") return "]";
  if (event.code !== "Slash") return null;
  return event.key === "?" ? "?" : "/";
}

function sequenceStartsWith(
  sequence: KeyboardShortcutSequence,
  prefix: KeyboardShortcutSequence,
): boolean {
  if (sequence.length < prefix.length) return false;
  return prefix.every((token, index) => sequence[index] === token);
}

function appendKeyboardShortcutToken(
  prefix: KeyboardShortcutSequence,
  token: KeyboardShortcutToken,
): KeyboardShortcutSequence {
  return [prefix[0], ...prefix.slice(1), token];
}

export function advanceKeyboardShortcutState<CommandId extends string>(
  state: KeyboardShortcutState<CommandId>,
  commands: readonly KeyboardShortcutCommand<CommandId>[],
  token: KeyboardShortcutToken,
): KeyboardShortcutAdvanceResult<CommandId> {
  if (state.status === "pending" && token === "escape") {
    return {
      consumeEvent: true,
      reason: "escape",
      state: idleKeyboardShortcutState,
      status: "cancelled",
    };
  }

  const prefix: KeyboardShortcutSequence = state.status === "pending"
    ? appendKeyboardShortcutToken(state.prefix, token)
    : [token];
  const pendingCandidateIds = state.status === "pending"
    ? new Set<CommandId>(state.candidateIds)
    : null;
  const candidates = commands.filter((command) =>
    command.disabled !== true &&
    (pendingCandidateIds === null || pendingCandidateIds.has(command.id)) &&
    sequenceStartsWith(command.sequence, prefix)
  );

  if (candidates.length === 0) {
    if (state.status === "idle") {
      return {
        consumeEvent: false,
        state,
        status: "ignored",
      };
    }
    return {
      consumeEvent: false,
      reason: "invalid",
      state: idleKeyboardShortcutState,
      status: "cancelled",
    };
  }

  const exactMatch = candidates.find(
    (command) => command.sequence.length === prefix.length,
  );
  if (exactMatch) {
    return {
      commandId: exactMatch.id,
      consumeEvent: true,
      state: idleKeyboardShortcutState,
      status: "matched",
    };
  }

  const pendingState: KeyboardShortcutPendingState<CommandId> = {
    candidateIds: candidates.map((command) => command.id),
    prefix,
    status: "pending",
  };
  return {
    consumeEvent: true,
    state: pendingState,
    status: "pending",
  };
}

export function advanceKeyboardShortcut<CommandId extends string>(
  state: KeyboardShortcutState<CommandId>,
  commands: readonly KeyboardShortcutCommand<CommandId>[],
  event: KeyboardEvent,
  options: KeyboardShortcutEventOptions = {},
): KeyboardShortcutAdvanceResult<CommandId> {
  if (shouldIgnoreKeyboardShortcutEvent(event, options)) {
    return {
      consumeEvent: false,
      state,
      status: "ignored",
    };
  }

  const token = normalizeKeyboardShortcutToken(event);
  if (token) return advanceKeyboardShortcutState(state, commands, token);
  if (state.status === "idle") {
    return {
      consumeEvent: false,
      state,
      status: "ignored",
    };
  }
  return {
    consumeEvent: false,
    reason: "invalid",
    state: idleKeyboardShortcutState,
    status: "cancelled",
  };
}
