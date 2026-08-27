import { describe, expect, it } from "vitest";

import {
  appKeyboardShortcutSpecs,
  type AppKeyboardShortcutCommandId,
} from "./app-keyboard-shortcuts";
import {
  createAppKeyboardCommandCatalog,
  type AppKeyboardCommandId,
} from "./app-keyboard-command-catalog";
import {
  makeKeyboardCommandState,
  reduceKeyboardCommandState,
  type KeyboardCommandCatalog,
  type KeyboardCommandInput,
  type KeyboardCommandMode,
  type KeyboardCommandPhase,
} from "./keyboard-command-controller";
import { defaultKeybindings, type Keybindings } from "./keybindings";

const expectedPhysicalSequences = {
  createIssue: ["KeyC"],
  openCommandPalette: ["Slash"],
  showKeyboardShortcuts: ["Slash"],
  toggleSidebar: ["BracketLeft"],
  goProjectHome: ["KeyG", "KeyH"],
  goIssues: ["KeyG", "KeyE"],
  goAgents: ["KeyG", "KeyA"],
  goInbox: ["KeyG", "KeyI"],
  goChannels: ["KeyG", "KeyC"],
  goDms: ["KeyG", "KeyD"],
  goSchedule: ["KeyG", "KeyL"],
  goSettings: ["KeyG", "KeyS"],
  openIssue: ["KeyO", "KeyI"],
  openProject: ["KeyG", "KeyP"],
  openChannel: ["KeyO", "KeyC"],
  openDm: ["KeyO", "KeyD"],
  openSession: ["KeyO", "KeyS"],
} as const satisfies Record<AppKeyboardShortcutCommandId, readonly string[]>;

const additionalCommandIds = [
  "historyBack",
  "historyForward",
  "openNavigationHistory",
  "openSettings",
  "createIssueFromSystemShortcut",
  "zoomIn",
  "zoomOut",
  "moveListDown",
  "moveListUp",
  "moveListLeft",
  "moveListRight",
  "closeSettings",
] as const satisfies readonly AppKeyboardCommandId[];

function dispatch(
  catalog: KeyboardCommandCatalog<AppKeyboardCommandId>,
  commandId: AppKeyboardCommandId,
  input: KeyboardCommandInput,
  phase: KeyboardCommandPhase,
  mode: KeyboardCommandMode = "normal",
) {
  return reduceKeyboardCommandState(
    makeKeyboardCommandState<AppKeyboardCommandId>(mode),
    catalog,
    [commandId],
    input,
    phase,
  );
}

describe("app keyboard command catalog", () => {
  it("contains every existing shortcut and every controller-only command once", () => {
    const catalog = createAppKeyboardCommandCatalog(defaultKeybindings);
    const expectedIds: AppKeyboardCommandId[] = [
      ...appKeyboardShortcutSpecs.map(({ id }) => id),
      ...additionalCommandIds,
    ];

    expect(catalog.commands.map(({ id }) => id)).toEqual(expectedIds);
    expect(catalog.commandById.size).toBe(expectedIds.length);
  });

  it("converts the 17 public shortcut specs to physical codes", () => {
    const catalog = createAppKeyboardCommandCatalog(defaultKeybindings);

    for (const spec of appKeyboardShortcutSpecs) {
      const command = catalog.commandById.get(spec.id);
      expect(command?.phase, spec.id).toBe("capture");
      const physical = command?.bindings[0];

      if (spec.id === "showKeyboardShortcuts") {
        expect(physical).toEqual({
          code: "Slash",
          kind: "modified",
          modes: ["normal"],
          modifiers: {
            alt: false,
            control: false,
            meta: false,
            shift: true,
          },
        });
      } else {
        expect(physical).toEqual({
          kind: "plain",
          modes: ["normal"],
          sequence: expectedPhysicalSequences[spec.id],
        });
      }
    }
  });

  it("matches physical codes when Korean input changes KeyboardEvent.key", () => {
    const catalog = createAppKeyboardCommandCatalog(defaultKeybindings);

    expect(
      dispatch(
        catalog,
        "createIssue",
        { code: "KeyC", key: "ㅊ" },
        "capture",
      ),
    ).toMatchObject({ commandId: "createIssue", _tag: "Matched" });

    const prefix = dispatch(
      catalog,
      "goInbox",
      { code: "KeyG", key: "ㅎ" },
      "capture",
    );
    expect(prefix).toMatchObject({ _tag: "Pending" });
    expect(
      reduceKeyboardCommandState(
        prefix.state,
        catalog,
        ["goInbox"],
        { code: "KeyI", key: "ㅑ" },
        "capture",
      ),
    ).toMatchObject({ commandId: "goInbox", _tag: "Matched" });

    expect(
      dispatch(
        catalog,
        "openCommandPalette",
        { code: "KeyK", key: "ㅏ", metaKey: true },
        "capture",
      ),
    ).toMatchObject({ commandId: "openCommandPalette", _tag: "Matched" });
  });

  it("selects projects with G P while preserving O P as an alias", () => {
    const catalog = createAppKeyboardCommandCatalog(defaultKeybindings);

    for (const prefixCode of ["KeyG", "KeyO"]) {
      const prefix = dispatch(
        catalog,
        "openProject",
        { code: prefixCode },
        "capture",
      );
      expect(prefix).toMatchObject({ _tag: "Pending" });
      expect(
        reduceKeyboardCommandState(
          prefix.state,
          catalog,
          ["openProject"],
          { code: "KeyP" },
          "capture",
        ),
      ).toMatchObject({ commandId: "openProject", _tag: "Matched" });
    }
  });

  it("keeps plain shortcuts in normal mode and app chords in both modes", () => {
    const catalog = createAppKeyboardCommandCatalog(defaultKeybindings);

    expect(
      dispatch(catalog, "createIssue", { code: "KeyC" }, "capture"),
    ).toMatchObject({ commandId: "createIssue", _tag: "Matched" });
    expect(
      dispatch(
        catalog,
        "createIssue",
        { code: "KeyC" },
        "capture",
        "insert",
      ),
    ).toMatchObject({ _tag: "Ignored" });

    for (const commandId of [
      "openCommandPalette",
      "historyBack",
      "historyForward",
      "openNavigationHistory",
      "openSettings",
      "createIssueFromSystemShortcut",
    ] as const) {
      const inputs = {
        createIssueFromSystemShortcut: { code: "KeyN", metaKey: true },
        historyBack: { code: "BracketLeft", metaKey: true },
        historyForward: { code: "BracketRight", metaKey: true },
        openNavigationHistory: { code: "KeyY", metaKey: true },
        openCommandPalette: { code: "KeyK", metaKey: true },
        openSettings: { code: "Comma", metaKey: true },
      } satisfies Record<typeof commandId, KeyboardCommandInput>;
      for (const mode of ["normal", "insert"] as const) {
        expect(
          dispatch(catalog, commandId, inputs[commandId], "capture", mode),
        ).toMatchObject({ commandId, _tag: "Matched" });
      }
      expect(
        dispatch(catalog, commandId, inputs[commandId], "bubble"),
      ).toMatchObject({ _tag: "Ignored" });
    }
  });

  it("keeps ? normal-only while primary-modifier slash works while editing", () => {
    const catalog = createAppKeyboardCommandCatalog(defaultKeybindings);

    expect(
      dispatch(
        catalog,
        "showKeyboardShortcuts",
        { code: "Slash", key: "?", shiftKey: true },
        "capture",
      ),
    ).toMatchObject({ commandId: "showKeyboardShortcuts", _tag: "Matched" });
    expect(
      dispatch(
        catalog,
        "showKeyboardShortcuts",
        { code: "Slash", key: "?", shiftKey: true },
        "capture",
        "insert",
      ),
    ).toMatchObject({ _tag: "Ignored" });

    for (const input of [
      { code: "Slash", metaKey: true },
      { code: "Slash", controlKey: true },
    ]) {
      expect(
        dispatch(
          catalog,
          "showKeyboardShortcuts",
          input,
          "capture",
          "insert",
        ),
      ).toMatchObject({
        commandId: "showKeyboardShortcuts",
        _tag: "Matched",
      });
    }
  });

  it("routes list movement and settings Escape through bubble", () => {
    const catalog = createAppKeyboardCommandCatalog(defaultKeybindings);
    const listInputs = [
      ["moveListDown", "KeyJ"],
      ["moveListDown", "ArrowDown"],
      ["moveListUp", "KeyK"],
      ["moveListUp", "ArrowUp"],
      ["moveListLeft", "KeyH"],
      ["moveListLeft", "ArrowLeft"],
      ["moveListRight", "KeyL"],
      ["moveListRight", "ArrowRight"],
    ] as const satisfies readonly (readonly [AppKeyboardCommandId, string])[];

    for (const [commandId, code] of listInputs) {
      expect(
        dispatch(catalog, commandId, { code, repeat: true }, "bubble"),
      ).toMatchObject({ commandId, _tag: "Matched" });
      expect(
        dispatch(catalog, commandId, { code }, "capture"),
      ).toMatchObject({ _tag: "Ignored" });
      expect(
        dispatch(catalog, commandId, { code }, "bubble", "insert"),
      ).toMatchObject({ _tag: "Ignored" });
    }

    for (const mode of ["normal", "insert"] as const) {
      expect(
        dispatch(catalog, "closeSettings", { code: "Escape" }, "bubble", mode),
      ).toMatchObject({ commandId: "closeSettings", _tag: "Matched" });
    }
    expect(
      dispatch(catalog, "closeSettings", { code: "Escape" }, "capture"),
    ).toMatchObject({ _tag: "Ignored" });
  });

  it("keeps both physical zoom clusters and their current repeat behavior", () => {
    const catalog = createAppKeyboardCommandCatalog(defaultKeybindings);

    for (const [commandId, code] of [
      ["zoomIn", "Equal"],
      ["zoomIn", "NumpadAdd"],
      ["zoomOut", "Minus"],
      ["zoomOut", "NumpadSubtract"],
    ] as const) {
      for (const shiftKey of [false, true]) {
        expect(
          dispatch(
            catalog,
            commandId,
            { code, metaKey: true, repeat: true, shiftKey },
            "capture",
            "insert",
          ),
        ).toMatchObject({ commandId, _tag: "Matched" });
      }
    }
  });

  it("rebuilds configured bindings from code and the exact modifier shape", () => {
    const first = createAppKeyboardCommandCatalog(defaultKeybindings);
    const updatedKeybindings: Keybindings = {
      commandPalette: {
        key: "ㄱ",
        code: "KeyR",
        meta: false,
        ctrl: true,
        alt: true,
        shift: false,
      },
      sidebarToggle: {
        key: "B",
        code: "KeyB",
        meta: true,
        ctrl: false,
        alt: false,
        shift: true,
      },
    };
    const updated = createAppKeyboardCommandCatalog(updatedKeybindings);

    expect(first.commandById.get("openCommandPalette")?.bindings[1]).toEqual({
      code: "KeyK",
      kind: "modified",
      modes: ["normal", "insert"],
      modifiers: {
        alt: false,
        control: false,
        meta: true,
        shift: false,
      },
    });
    expect(updated.commandById.get("openCommandPalette")?.bindings[1]).toEqual({
      code: "KeyR",
      kind: "modified",
      modes: ["normal", "insert"],
      modifiers: {
        alt: true,
        control: true,
        meta: false,
        shift: false,
      },
    });
    expect(updated.commandById.get("toggleSidebar")?.bindings[1]).toEqual({
      code: "KeyB",
      kind: "modified",
      modes: ["normal", "insert"],
      modifiers: {
        alt: false,
        control: false,
        meta: true,
        shift: true,
      },
    });
    expect(
      dispatch(
        updated,
        "openCommandPalette",
        {
          altKey: true,
          code: "KeyR",
          controlKey: true,
          key: "ㄱ",
        },
        "capture",
        "insert",
      ),
    ).toMatchObject({ commandId: "openCommandPalette", _tag: "Matched" });
  });

  it("rejects configurable conflicts with each other and reserved app chords", () => {
    const duplicateConfigured: Keybindings = {
      commandPalette: defaultKeybindings.commandPalette,
      sidebarToggle: defaultKeybindings.commandPalette,
    };
    expect(() => createAppKeyboardCommandCatalog(duplicateConfigured)).toThrow(
      "Keyboard command openCommandPalette conflicts with toggleSidebar",
    );

    const conflictsWithCreate: Keybindings = {
      ...defaultKeybindings,
      commandPalette: {
        key: "n",
        code: "KeyN",
        meta: true,
        ctrl: false,
        alt: false,
        shift: false,
      },
    };
    expect(() => createAppKeyboardCommandCatalog(conflictsWithCreate)).toThrow(
      "Keyboard command openCommandPalette conflicts with createIssueFromSystemShortcut",
    );

    const unmodifiedConfigured: Keybindings = {
      ...defaultKeybindings,
      sidebarToggle: {
        key: "b",
        code: "KeyB",
        meta: false,
        ctrl: false,
        alt: false,
        shift: false,
      },
    };
    expect(() => createAppKeyboardCommandCatalog(unmodifiedConfigured)).toThrow(
      "Keyboard command toggleSidebar has a modified binding without a modifier",
    );
  });
});
