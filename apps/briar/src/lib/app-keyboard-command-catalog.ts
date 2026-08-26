import {
  appKeyboardShortcutSpecs,
  type AppKeyboardShortcutCommandId,
  type AppKeyboardShortcutSpec,
} from "./app-keyboard-shortcuts";
import {
  createKeyboardCommandCatalog,
  type KeyboardCommandBinding,
  type KeyboardCommandCatalog,
  type KeyboardCommandDefinition,
  type KeyboardCommandModifiedBinding,
  type KeyboardCommandModifiers,
  type KeyboardCommandPlainBinding,
} from "./keyboard-command-controller";
import type { KeyboardShortcutToken } from "./keyboard-shortcuts";
import type { Keybindings, Shortcut } from "./keybindings";

export type AppKeyboardCommandId =
  | AppKeyboardShortcutCommandId
  | "historyBack"
  | "historyForward"
  | "openSettings"
  | "moveListDown"
  | "moveListUp"
  | "moveListLeft"
  | "moveListRight"
  | "closeSettings"
  | "createIssueFromSystemShortcut"
  | "zoomIn"
  | "zoomOut";

const normalModeOnly = ["normal"] as const;
const normalAndInsertModes = ["normal", "insert"] as const;

const physicalCodeByToken = {
  a: "KeyA",
  b: "KeyB",
  c: "KeyC",
  d: "KeyD",
  e: "KeyE",
  f: "KeyF",
  g: "KeyG",
  h: "KeyH",
  i: "KeyI",
  j: "KeyJ",
  k: "KeyK",
  l: "KeyL",
  m: "KeyM",
  n: "KeyN",
  o: "KeyO",
  p: "KeyP",
  q: "KeyQ",
  r: "KeyR",
  s: "KeyS",
  t: "KeyT",
  u: "KeyU",
  v: "KeyV",
  w: "KeyW",
  x: "KeyX",
  y: "KeyY",
  z: "KeyZ",
  "[": "BracketLeft",
  "]": "BracketRight",
  "/": "Slash",
  "?": "Slash",
  escape: "Escape",
} as const satisfies Record<KeyboardShortcutToken, string>;

const noModifiers = {
  alt: false,
  control: false,
  meta: false,
  shift: false,
} as const satisfies KeyboardCommandModifiers;

function modifiedBinding(
  code: string,
  modifiers: Partial<KeyboardCommandModifiers>,
): KeyboardCommandModifiedBinding {
  return {
    code,
    kind: "modified",
    modes: normalAndInsertModes,
    modifiers: { ...noModifiers, ...modifiers },
  };
}

function configuredBinding(shortcut: Shortcut): KeyboardCommandModifiedBinding {
  return modifiedBinding(shortcut.code, {
    alt: shortcut.alt,
    control: shortcut.ctrl,
    meta: shortcut.meta,
    shift: shortcut.shift,
  });
}

function physicalBinding(
  spec: AppKeyboardShortcutSpec,
): KeyboardCommandBinding {
  if (spec.sequence.includes("?")) {
    if (spec.sequence.length !== 1 || spec.sequence[0] !== "?") {
      throw new Error(
        `Keyboard shortcut ${spec.id} uses ? outside a single-key binding`,
      );
    }
    return {
      code: "Slash",
      kind: "modified",
      modes: normalModeOnly,
      modifiers: { ...noModifiers, shift: true },
    };
  }

  return {
    kind: "plain",
    modes: normalModeOnly,
    sequence: spec.sequence.map((token) => physicalCodeByToken[token]) as [
      string,
      ...string[],
    ],
  } satisfies KeyboardCommandPlainBinding;
}

function shortcutBindings(
  spec: AppKeyboardShortcutSpec,
  keybindings: Keybindings,
): readonly [KeyboardCommandBinding, ...KeyboardCommandBinding[]] {
  const physical = physicalBinding(spec);
  if (spec.id === "openCommandPalette") {
    return [physical, configuredBinding(keybindings.commandPalette)];
  }
  if (spec.id === "toggleSidebar") {
    return [physical, configuredBinding(keybindings.sidebarToggle)];
  }
  if (spec.id === "showKeyboardShortcuts") {
    return [
      physical,
      modifiedBinding("Slash", { meta: true }),
      modifiedBinding("Slash", { control: true }),
    ];
  }
  return [physical];
}

function plainListBinding(code: string): KeyboardCommandPlainBinding {
  return {
    kind: "plain",
    modes: normalModeOnly,
    sequence: [code],
  };
}

function createCommandDefinitions(
  keybindings: Keybindings,
): readonly KeyboardCommandDefinition<AppKeyboardCommandId>[] {
  const shortcutCommands: KeyboardCommandDefinition<AppKeyboardCommandId>[] =
    appKeyboardShortcutSpecs.map((spec) => ({
      bindings: shortcutBindings(spec, keybindings),
      id: spec.id,
      phase: "capture",
    }));

  return [
    ...shortcutCommands,
    {
      bindings: [modifiedBinding("BracketLeft", { meta: true })],
      id: "historyBack",
      phase: "capture",
    },
    {
      bindings: [modifiedBinding("BracketRight", { meta: true })],
      id: "historyForward",
      phase: "capture",
    },
    {
      bindings: [modifiedBinding("Comma", { meta: true })],
      id: "openSettings",
      phase: "capture",
    },
    {
      bindings: [modifiedBinding("KeyN", { meta: true })],
      id: "createIssueFromSystemShortcut",
      phase: "capture",
    },
    {
      bindings: [
        modifiedBinding("Equal", { meta: true }),
        modifiedBinding("Equal", { meta: true, shift: true }),
        modifiedBinding("NumpadAdd", { meta: true }),
        modifiedBinding("NumpadAdd", { meta: true, shift: true }),
      ],
      id: "zoomIn",
      phase: "capture",
      repeat: "allow",
    },
    {
      bindings: [
        modifiedBinding("Minus", { meta: true }),
        modifiedBinding("Minus", { meta: true, shift: true }),
        modifiedBinding("NumpadSubtract", { meta: true }),
        modifiedBinding("NumpadSubtract", { meta: true, shift: true }),
      ],
      id: "zoomOut",
      phase: "capture",
      repeat: "allow",
    },
    {
      bindings: [
        plainListBinding("KeyJ"),
        plainListBinding("ArrowDown"),
      ],
      id: "moveListDown",
      phase: "bubble",
      repeat: "allow",
    },
    {
      bindings: [
        plainListBinding("KeyK"),
        plainListBinding("ArrowUp"),
      ],
      id: "moveListUp",
      phase: "bubble",
      repeat: "allow",
    },
    {
      bindings: [
        plainListBinding("KeyH"),
        plainListBinding("ArrowLeft"),
      ],
      id: "moveListLeft",
      phase: "bubble",
      repeat: "allow",
    },
    {
      bindings: [
        plainListBinding("KeyL"),
        plainListBinding("ArrowRight"),
      ],
      id: "moveListRight",
      phase: "bubble",
      repeat: "allow",
    },
    {
      bindings: [{
        kind: "plain",
        modes: normalAndInsertModes,
        sequence: ["Escape"],
      }],
      id: "closeSettings",
      phase: "bubble",
    },
  ];
}

export function createAppKeyboardCommandCatalog(
  keybindings: Keybindings,
): KeyboardCommandCatalog<AppKeyboardCommandId> {
  return createKeyboardCommandCatalog(createCommandDefinitions(keybindings));
}
