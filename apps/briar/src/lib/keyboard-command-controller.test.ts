import { describe, expect, it, vi } from "vitest";

import {
  cancelPendingKeyboardCommand,
  createKeyboardCommandCatalog,
  createKeyboardCommandController,
  makeKeyboardCommandState,
  reduceKeyboardCommandState,
  setKeyboardCommandMode,
  type KeyboardCommandDefinition,
} from "./keyboard-command-controller";

type CommandId =
  | "exitInsert"
  | "goInbox"
  | "goSettings"
  | "next"
  | "once"
  | "palette";

const commands = [
  {
    bindings: [{ kind: "plain", sequence: ["KeyG", "KeyI"] }],
    id: "goInbox",
    phase: "capture",
  },
  {
    bindings: [{ kind: "plain", sequence: ["KeyG", "KeyS"] }],
    id: "goSettings",
    phase: "capture",
  },
  {
    bindings: [{ kind: "plain", sequence: ["KeyJ"] }],
    id: "next",
    phase: "bubble",
    repeat: "allow",
  },
  {
    bindings: [{ kind: "plain", sequence: ["KeyX"] }],
    id: "once",
    phase: "capture",
  },
  {
    bindings: [{
      code: "KeyK",
      kind: "modified",
      modes: ["normal", "insert"],
      modifiers: { alt: false, control: false, meta: true, shift: false },
    }],
    id: "palette",
    phase: "capture",
  },
  {
    bindings: [{
      kind: "plain",
      modes: ["insert"],
      sequence: ["Escape"],
    }],
    id: "exitInsert",
    phase: "bubble",
  },
] as const satisfies readonly KeyboardCommandDefinition<CommandId>[];

const catalog = createKeyboardCommandCatalog(commands);

function registerAll(
  controller: ReturnType<typeof createKeyboardCommandController<CommandId>>,
  overrides: Partial<Record<CommandId, () => "handled" | "pass" | "consume">> = {},
) {
  return controller.registerScope({
    fallthrough: true,
    handlers: Object.fromEntries(
      commands.map(({ id }) => [
        id,
        { run: overrides[id] ?? (() => "handled" as const) },
      ]),
    ) as never,
    id: "root",
    priority: 0,
  });
}

describe("keyboard command state reducer", () => {
  it("tracks mode and pending sequence orthogonally with immutable transitions", () => {
    const initial = makeKeyboardCommandState<CommandId>();
    const pending = reduceKeyboardCommandState(
      initial,
      catalog,
      ["goInbox", "goSettings"],
      { code: "KeyG" },
    );

    expect(pending).toEqual({
      _tag: "Pending",
      state: {
        mode: "normal",
        pending: {
          candidateIds: ["goInbox", "goSettings"],
          phase: "capture",
          sequence: ["KeyG"],
        },
      },
    });
    expect(initial).toEqual({ mode: "normal", pending: null });

    const insert = setKeyboardCommandMode(pending.state, "insert");
    expect(insert).toEqual({ mode: "insert", pending: null });
    expect(cancelPendingKeyboardCommand(pending.state)).toEqual(initial);
  });

  it("finishes a physical-code prefix and cancels an invalid continuation", () => {
    const pending = reduceKeyboardCommandState(
      makeKeyboardCommandState<CommandId>(),
      catalog,
      ["goInbox", "goSettings"],
      { code: "KeyG" },
    );
    expect(pending._tag).toBe("Pending");

    expect(
      reduceKeyboardCommandState(
        pending.state,
        catalog,
        ["goInbox", "goSettings"],
        { code: "KeyI", key: "ㅑ" },
      ),
    ).toMatchObject({
      commandId: "goInbox",
      state: { mode: "normal", pending: null },
      _tag: "Matched",
    });
    expect(
      reduceKeyboardCommandState(
        pending.state,
        catalog,
        ["goInbox", "goSettings"],
        { code: "KeyZ" },
      ),
    ).toEqual({
      _tag: "Ignored",
      reason: "unmatched",
      state: { mode: "normal", pending: null },
    });
  });

  it("preserves declaration order after indexed prefix discovery", () => {
    type OrderedCommandId = "alpha" | "zeta";
    const orderedCatalog = createKeyboardCommandCatalog([
      {
        bindings: [{ kind: "plain", sequence: ["KeyG", "KeyZ"] }],
        id: "zeta",
        phase: "capture",
      },
      {
        bindings: [{ kind: "plain", sequence: ["KeyG", "KeyA"] }],
        id: "alpha",
        phase: "capture",
      },
    ]);

    expect(
      reduceKeyboardCommandState(
        makeKeyboardCommandState<OrderedCommandId>(),
        orderedCatalog,
        ["zeta", "alpha"],
        { code: "KeyG" },
      ).state.pending?.candidateIds,
    ).toEqual(["zeta", "alpha"]);
  });

  it("keeps physical-code token boundaries distinct in indexed lookup", () => {
    type FramedCommandId = "left" | "right";
    const framedCatalog = createKeyboardCommandCatalog([
      {
        bindings: [{ kind: "plain", sequence: ["A", "BC"] }],
        id: "left",
        phase: "capture",
      },
      {
        bindings: [{ kind: "plain", sequence: ["AB", "C"] }],
        id: "right",
        phase: "capture",
      },
    ]);
    const active: readonly FramedCommandId[] = ["left", "right"];
    const leftPending = reduceKeyboardCommandState(
      makeKeyboardCommandState<FramedCommandId>(),
      framedCatalog,
      active,
      { code: "A" },
    );
    const rightPending = reduceKeyboardCommandState(
      makeKeyboardCommandState<FramedCommandId>(),
      framedCatalog,
      active,
      { code: "AB" },
    );

    expect(leftPending.state.pending?.candidateIds).toEqual(["left"]);
    expect(
      reduceKeyboardCommandState(
        leftPending.state,
        framedCatalog,
        active,
        { code: "BC" },
      ),
    ).toMatchObject({ commandId: "left", _tag: "Matched" });
    expect(rightPending.state.pending?.candidateIds).toEqual(["right"]);
    expect(
      reduceKeyboardCommandState(
        rightPending.state,
        framedCatalog,
        active,
        { code: "C" },
      ),
    ).toMatchObject({ commandId: "right", _tag: "Matched" });
  });

  it("separates capture commands from contextual bubble fallback", () => {
    const pending = reduceKeyboardCommandState(
      makeKeyboardCommandState<CommandId>(),
      catalog,
      ["goInbox", "next"],
      { code: "KeyG" },
      "capture",
    );
    expect(pending._tag).toBe("Pending");

    const invalidContinuation = reduceKeyboardCommandState(
      pending.state,
      catalog,
      ["goInbox", "next"],
      { code: "KeyJ" },
      "capture",
    );
    expect(invalidContinuation).toMatchObject({
      reason: "unmatched",
      state: { pending: null },
      _tag: "Ignored",
    });
    expect(
      reduceKeyboardCommandState(
        invalidContinuation.state,
        catalog,
        ["goInbox", "next"],
        { code: "KeyJ" },
        "bubble",
      ),
    ).toMatchObject({ commandId: "next", _tag: "Matched" });
  });

  it("consumes Escape to cancel a prefix without treating it as a command", () => {
    const pending = reduceKeyboardCommandState(
      makeKeyboardCommandState<CommandId>(),
      catalog,
      ["goInbox"],
      { code: "KeyG" },
    );

    expect(
      reduceKeyboardCommandState(
        pending.state,
        catalog,
        ["goInbox"],
        { code: "Escape" },
      ),
    ).toEqual({
      _tag: "Consumed",
      reason: "cancelled",
      state: { mode: "normal", pending: null },
    });
  });

  it("matches configured modifier strokes exactly in either mode", () => {
    for (const mode of ["normal", "insert"] as const) {
      expect(
        reduceKeyboardCommandState(
          makeKeyboardCommandState<CommandId>(mode),
          catalog,
          ["palette"],
          { code: "KeyK", metaKey: true },
        ),
      ).toMatchObject({ commandId: "palette", _tag: "Matched" });
    }
    expect(
      reduceKeyboardCommandState(
        makeKeyboardCommandState<CommandId>(),
        catalog,
        ["palette"],
        { code: "KeyK", controlKey: true },
      ),
    ).toMatchObject({ _tag: "Ignored" });
  });

  it("cancels a pending sequence and still matches a modifier command", () => {
    const pending = reduceKeyboardCommandState(
      makeKeyboardCommandState<CommandId>(),
      catalog,
      ["goInbox", "palette"],
      { code: "KeyG" },
    );

    expect(
      reduceKeyboardCommandState(
        pending.state,
        catalog,
        ["goInbox", "palette"],
        { code: "KeyK", metaKey: true },
      ),
    ).toMatchObject({
      commandId: "palette",
      state: { pending: null },
      _tag: "Matched",
    });
  });

  it("applies repeat policy per command and preserves a denied prefix", () => {
    expect(
      reduceKeyboardCommandState(
        makeKeyboardCommandState<CommandId>(),
        catalog,
        ["next"],
        { code: "KeyJ", repeat: true },
        "bubble",
      ),
    ).toMatchObject({ commandId: "next", _tag: "Matched" });
    expect(
      reduceKeyboardCommandState(
        makeKeyboardCommandState<CommandId>(),
        catalog,
        ["once"],
        { code: "KeyX", repeat: true },
      ),
    ).toMatchObject({ reason: "repeat", _tag: "Ignored" });

    const pending = reduceKeyboardCommandState(
      makeKeyboardCommandState<CommandId>(),
      catalog,
      ["goInbox"],
      { code: "KeyG" },
    );
    expect(
      reduceKeyboardCommandState(
        pending.state,
        catalog,
        ["goInbox"],
        { code: "KeyG", repeat: true },
      ),
    ).toEqual({
      _tag: "Ignored",
      reason: "repeat",
      state: pending.state,
    });
  });

  it("preserves mixed repeat policy across frozen prefix candidates", () => {
    type RepeatCommandId = "allowed" | "denied";
    const repeatCatalog = createKeyboardCommandCatalog([
      {
        bindings: [{ kind: "plain", sequence: ["KeyG", "KeyI"] }],
        id: "denied",
        phase: "capture",
      },
      {
        bindings: [{ kind: "plain", sequence: ["KeyG", "KeyA"] }],
        id: "allowed",
        phase: "capture",
        repeat: "allow",
      },
    ]);
    const active: readonly RepeatCommandId[] = ["denied", "allowed"];
    const pending = reduceKeyboardCommandState(
      makeKeyboardCommandState<RepeatCommandId>(),
      repeatCatalog,
      active,
      { code: "KeyG" },
    );

    expect(
      reduceKeyboardCommandState(
        pending.state,
        repeatCatalog,
        ["denied"],
        { code: "KeyI", repeat: true },
      ),
    ).toMatchObject({ reason: "repeat", state: pending.state });
    expect(
      reduceKeyboardCommandState(
        pending.state,
        repeatCatalog,
        active,
        { code: "KeyA", repeat: true },
      ),
    ).toMatchObject({ commandId: "allowed", _tag: "Matched" });
    expect(
      reduceKeyboardCommandState(
        pending.state,
        repeatCatalog,
        active,
        { code: "KeyI", repeat: true },
      ),
    ).toMatchObject({
      reason: "unmatched",
      state: { pending: null },
      _tag: "Ignored",
    });
  });
});

describe("keyboard command catalog", () => {
  it("rejects exact conflicts in overlapping modes", () => {
    expect(() =>
      createKeyboardCommandCatalog([
        {
          bindings: [{ kind: "plain", sequence: ["KeyJ"] }],
          id: "a",
          phase: "capture",
        },
        {
          bindings: [{ kind: "plain", sequence: ["KeyJ"] }],
          id: "b",
          phase: "capture",
        },
      ])
    ).toThrow(/conflicts/i);
  });

  it("rejects a shorter sequence that would shadow a longer one", () => {
    expect(() =>
      createKeyboardCommandCatalog([
        {
          bindings: [{ kind: "plain", sequence: ["KeyG"] }],
          id: "go",
          phase: "capture",
        },
        {
          bindings: [{ kind: "plain", sequence: ["KeyG", "KeyI"] }],
          id: "inbox",
          phase: "capture",
        },
      ])
    ).toThrow(/shadows/i);
  });

  it("allows the same physical key in different DOM ownership phases", () => {
    expect(() =>
      createKeyboardCommandCatalog([
        {
          bindings: [{ kind: "plain", sequence: ["Escape"] }],
          id: "capture",
          phase: "capture",
        },
        {
          bindings: [{ kind: "plain", sequence: ["Escape"] }],
          id: "bubble",
          phase: "bubble",
        },
      ])
    ).not.toThrow();
  });
});

describe("keyboard command controller", () => {
  it("publishes a root-owned AtomRef snapshot and invokes handlers synchronously", () => {
    const controller = createKeyboardCommandController({ catalog });
    const seen: string[] = [];
    const snapshots: string[] = [];
    controller.snapshot.subscribe((state) => {
      snapshots.push(state.pending?.sequence.join(" ") ?? state.mode);
    });
    registerAll(controller, {
      goInbox: () => {
        seen.push(`handler:${controller.snapshot.value.pending}`);
        return "handled";
      },
    });

    expect(controller.dispatch({ code: "KeyG" }, "capture")._tag).toBe(
      "Pending",
    );
    const result = controller.dispatch({ code: "KeyI" }, "capture");
    seen.push("returned");

    expect(result).toMatchObject({
      commandId: "goInbox",
      scopeId: "root",
      _tag: "Matched",
    });
    expect(seen).toEqual(["handler:null", "returned"]);
    expect(snapshots).toEqual(["KeyG", "normal"]);
  });

  it("honors scope priority, explicit pass, and non-fallthrough shadowing", () => {
    const controller = createKeyboardCommandController({ catalog });
    const calls: string[] = [];
    registerAll(controller, { once: () => { calls.push("root"); return "handled"; } });
    const high = controller.registerScope({
      fallthrough: false,
      handlers: {
        once: { run: () => { calls.push("high"); return "handled"; } },
      },
      id: "overlay",
      priority: 100,
    });

    expect(controller.dispatch({ code: "KeyX" }, "capture")).toMatchObject({
      scopeId: "overlay",
      _tag: "Matched",
    });
    expect(calls).toEqual(["high"]);

    controller.updateScope(high, {
      fallthrough: false,
      handlers: {
        once: { run: () => { calls.push("pass"); return "pass"; } },
      },
      id: "overlay",
      priority: 100,
    });
    expect(controller.dispatch({ code: "KeyX" }, "capture")).toMatchObject({
      scopeId: "root",
      _tag: "Matched",
    });
    expect(calls).toEqual(["high", "pass", "root"]);

    expect(controller.dispatch({ code: "KeyJ" }, "bubble")).toMatchObject({
      _tag: "Ignored",
    });
  });

  it("routes contextual commands only from the bubble adapter", () => {
    const controller = createKeyboardCommandController({ catalog });
    const bubble = vi.fn(() => "handled" as const);
    registerAll(controller, { next: bubble });

    expect(controller.dispatch({ code: "KeyJ" }, "capture")).toMatchObject({
      _tag: "Ignored",
    });
    expect(bubble).not.toHaveBeenCalled();
    expect(controller.dispatch({ code: "KeyJ" }, "bubble")).toMatchObject({
      commandId: "next",
      scopeId: "root",
      _tag: "Matched",
    });
    expect(bubble).toHaveBeenCalledOnce();
  });

  it("falls through unavailable handlers only when the scope permits it", () => {
    const controller = createKeyboardCommandController({ catalog });
    const root = vi.fn(() => "handled" as const);
    registerAll(controller, { once: root });
    const high = controller.registerScope({
      fallthrough: true,
      handlers: { once: { isAvailable: () => false, run: vi.fn() } },
      id: "panel",
      priority: 10,
    });

    expect(controller.dispatch({ code: "KeyX" }, "capture")).toMatchObject({
      scopeId: "root",
      _tag: "Matched",
    });
    controller.updateScope(high, {
      fallthrough: false,
      handlers: { once: { isAvailable: () => false, run: vi.fn() } },
      id: "panel",
      priority: 10,
    });
    expect(controller.dispatch({ code: "KeyX" }, "capture")).toMatchObject({
      reason: "unmatched",
      _tag: "Ignored",
    });
    expect(root).toHaveBeenCalledTimes(1);
  });

  it("does not reserve a prefix for an unavailable-only command", () => {
    const controller = createKeyboardCommandController({ catalog });
    controller.registerScope({
      fallthrough: false,
      handlers: {
        goInbox: { isAvailable: () => false, run: vi.fn() },
      },
      id: "disabled-page",
      priority: 10,
    });

    expect(controller.dispatch({ code: "KeyG" }, "capture")).toMatchObject({
      reason: "unmatched",
      _tag: "Ignored",
    });
    expect(controller.snapshot.value.pending).toBeNull();
  });

  it("checks availability only for structural key candidates", () => {
    const controller = createKeyboardCommandController({ catalog });
    const availability = {
      exitInsert: vi.fn(() => true),
      goInbox: vi.fn(() => true),
      goSettings: vi.fn(() => true),
      next: vi.fn(() => true),
      once: vi.fn(() => true),
      palette: vi.fn(() => true),
    } satisfies Record<CommandId, () => boolean>;
    controller.registerScope({
      fallthrough: true,
      handlers: {
        exitInsert: {
          isAvailable: availability.exitInsert,
          run: () => "handled",
        },
        goInbox: {
          isAvailable: availability.goInbox,
          run: () => "handled",
        },
        goSettings: {
          isAvailable: availability.goSettings,
          run: () => "handled",
        },
        next: { isAvailable: availability.next, run: () => "handled" },
        once: { isAvailable: availability.once, run: () => "handled" },
        palette: {
          isAvailable: availability.palette,
          run: () => "handled",
        },
      },
      id: "root",
      priority: 0,
    });

    expect(controller.dispatch({ code: "KeyX" }, "capture"))
      .toMatchObject({ commandId: "once", _tag: "Matched" });
    expect(availability.once).toHaveBeenCalledOnce();
    expect(availability.exitInsert).not.toHaveBeenCalled();
    expect(availability.goInbox).not.toHaveBeenCalled();
    expect(availability.goSettings).not.toHaveBeenCalled();
    expect(availability.next).not.toHaveBeenCalled();
    expect(availability.palette).not.toHaveBeenCalled();
  });

  it("freezes prefix candidates while rechecking their availability", () => {
    const controller = createKeyboardCommandController({ catalog });
    let inboxAvailable = true;
    let settingsAvailable = false;
    const inboxAvailability = vi.fn(() => inboxAvailable);
    const settingsAvailability = vi.fn(() => settingsAvailable);
    const inboxRun = vi.fn(() => "handled" as const);
    controller.registerScope({
      fallthrough: true,
      handlers: {
        goInbox: { isAvailable: inboxAvailability, run: inboxRun },
        goSettings: {
          isAvailable: settingsAvailability,
          run: () => "handled",
        },
      },
      id: "root",
      priority: 0,
    });

    expect(controller.dispatch({ code: "KeyG" }, "capture").state.pending)
      .toMatchObject({ candidateIds: ["goInbox"], phase: "capture" });
    expect(inboxAvailability).toHaveBeenCalledOnce();
    expect(settingsAvailability).toHaveBeenCalledOnce();

    inboxAvailable = false;
    settingsAvailable = true;
    expect(controller.dispatch({ code: "KeyS" }, "capture"))
      .toMatchObject({ reason: "unmatched", state: { pending: null } });
    expect(inboxAvailability).toHaveBeenCalledOnce();
    expect(settingsAvailability).toHaveBeenCalledOnce();

    settingsAvailable = false;
    inboxAvailable = true;
    controller.dispatch({ code: "KeyG" }, "capture");
    inboxAvailable = false;
    expect(controller.dispatch({ code: "KeyI" }, "capture"))
      .toMatchObject({ reason: "unmatched", state: { pending: null } });
    expect(inboxAvailability).toHaveBeenCalledTimes(3);
    expect(inboxRun).not.toHaveBeenCalled();
  });

  it("keeps newest equal-priority scope precedence in the cached order", () => {
    const controller = createKeyboardCommandController({ catalog });
    const calls: string[] = [];
    controller.registerScope({
      fallthrough: true,
      handlers: {
        once: { run: () => { calls.push("older"); return "handled"; } },
      },
      id: "older",
      priority: 10,
    });
    const newer = controller.registerScope({
      fallthrough: true,
      handlers: {
        once: { run: () => { calls.push("newer"); return "handled"; } },
      },
      id: "newer",
      priority: 10,
    });

    expect(controller.dispatch({ code: "KeyX" }, "capture"))
      .toMatchObject({ scopeId: "newer" });
    controller.unregisterScope(newer);
    expect(controller.dispatch({ code: "KeyX" }, "capture"))
      .toMatchObject({ scopeId: "older" });
    expect(calls).toEqual(["newer", "older"]);
  });

  it("updates callbacks through stable registration tokens and cleans them up", () => {
    const controller = createKeyboardCommandController({ catalog });
    const oldHandler = vi.fn(() => "handled" as const);
    const newHandler = vi.fn(() => "handled" as const);
    const token = controller.registerScope({
      fallthrough: true,
      handlers: { once: { run: oldHandler } },
      id: "page",
      priority: 1,
    });
    controller.updateScope(token, {
      fallthrough: true,
      handlers: { once: { run: newHandler } },
      id: "page",
      priority: 1,
    });

    controller.dispatch({ code: "KeyX" }, "capture");
    expect(oldHandler).not.toHaveBeenCalled();
    expect(newHandler).toHaveBeenCalledOnce();
    expect(controller.unregisterScope(token)).toBe(true);
    expect(controller.unregisterScope(token)).toBe(false);
    expect(controller.dispatch({ code: "KeyX" }, "capture")._tag).toBe(
      "Ignored",
    );
  });

  it("updates runtime bindings without replacing registered scopes", () => {
    const initialCatalog = createKeyboardCommandCatalog([
      {
        bindings: [{ kind: "plain", sequence: ["KeyX"] }],
        id: "once",
        phase: "capture",
      },
    ]);
    const controller = createKeyboardCommandController({
      catalog: initialCatalog,
    });
    const run = vi.fn(() => "handled" as const);
    controller.registerScope({
      fallthrough: true,
      handlers: { once: { run } },
      id: "root",
      priority: 0,
    });
    controller.setCatalog(createKeyboardCommandCatalog([
      {
        bindings: [{ kind: "plain", sequence: ["KeyY"] }],
        id: "once",
        phase: "capture",
      },
    ]));

    expect(controller.dispatch({ code: "KeyX" }, "capture")._tag).toBe(
      "Ignored",
    );
    expect(controller.dispatch({ code: "KeyY" }, "capture")).toMatchObject({
      commandId: "once",
      scopeId: "root",
      _tag: "Matched",
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it("cancels a pending sequence when the runtime catalog changes", () => {
    const initialCatalog = createKeyboardCommandCatalog([
      {
        bindings: [{ kind: "plain", sequence: ["KeyG", "KeyI"] }],
        id: "goInbox",
        phase: "capture",
      },
    ]);
    const controller = createKeyboardCommandController({
      catalog: initialCatalog,
    });
    controller.registerScope({
      fallthrough: true,
      handlers: { goInbox: { run: () => "handled" } },
      id: "root",
      priority: 0,
    });
    expect(controller.dispatch({ code: "KeyG" }, "capture")._tag).toBe(
      "Pending",
    );

    controller.setCatalog(createKeyboardCommandCatalog([
      {
        bindings: [{ kind: "plain", sequence: ["KeyG", "KeyS"] }],
        id: "goInbox",
        phase: "capture",
      },
    ]));

    expect(controller.snapshot.value.pending).toBeNull();
    expect(controller.dispatch({ code: "KeyI" }, "capture")._tag).toBe(
      "Ignored",
    );
  });

  it("keeps modified bindings normal-only unless insert is explicit", () => {
    const modifierCatalog = createKeyboardCommandCatalog([
      {
        bindings: [{
          code: "Slash",
          kind: "modified",
          modifiers: { alt: false, control: false, meta: false, shift: true },
        }],
        id: "normalOnly",
        phase: "capture",
      },
      {
        bindings: [{
          code: "KeyK",
          kind: "modified",
          modes: ["normal", "insert"],
          modifiers: { alt: false, control: false, meta: true, shift: false },
        }],
        id: "everyMode",
        phase: "capture",
      },
    ]);
    const controller = createKeyboardCommandController({
      catalog: modifierCatalog,
    });
    controller.registerScope({
      fallthrough: true,
      handlers: {
        everyMode: { run: () => "handled" },
        normalOnly: { run: () => "handled" },
      },
      id: "root",
      priority: 0,
    });
    controller.setMode("insert");

    expect(
      controller.dispatch({ code: "Slash", shiftKey: true }, "capture"),
    ).toMatchObject({ _tag: "Ignored" });
    expect(
      controller.dispatch({ code: "KeyK", metaKey: true }, "capture"),
    ).toMatchObject({ commandId: "everyMode", _tag: "Matched" });
  });

  it("uses an injected prefix deadline and cancels it on resolution and dispose", () => {
    let expire: (() => void) | undefined;
    const cancel = vi.fn();
    const schedule = vi.fn((callback: () => void, delayMs: number) => {
      expire = callback;
      expect(delayMs).toBe(1_500);
      return cancel;
    });
    const controller = createKeyboardCommandController({
      catalog,
      scheduleSequenceTimeout: schedule,
      sequenceTimeout: "1.5 seconds",
    });
    registerAll(controller);

    controller.dispatch({ code: "KeyG" }, "capture");
    expect(schedule).toHaveBeenCalledOnce();
    expire?.();
    expect(controller.snapshot.value.pending).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();

    controller.dispatch({ code: "KeyG" }, "capture");
    controller.dispose();
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(controller.dispatch({ code: "KeyI" }, "capture")).toMatchObject({
      reason: "disposed",
      _tag: "Ignored",
    });
  });

  it("keeps plain normal commands out of insert mode while allowing explicit bindings", () => {
    const controller = createKeyboardCommandController({ catalog });
    registerAll(controller);
    controller.setMode("insert");

    expect(controller.dispatch({ code: "KeyJ" }, "bubble")._tag).toBe(
      "Ignored",
    );
    expect(
      controller.dispatch({ code: "KeyK", metaKey: true }, "capture"),
    ).toMatchObject({ commandId: "palette", _tag: "Matched" });
    expect(controller.dispatch({ code: "Escape" }, "bubble")).toMatchObject({
      commandId: "exitInsert",
      _tag: "Matched",
    });
    expect(controller.snapshot.value).toEqual({
      mode: "insert",
      pending: null,
    });
  });
});
