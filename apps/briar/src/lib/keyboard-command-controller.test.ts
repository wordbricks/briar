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
      consumeEvent: true,
      state: {
        mode: "normal",
        pending: {
          candidateIds: ["goInbox", "goSettings"],
          sequence: ["KeyG"],
        },
      },
      status: "pending",
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
    expect(pending.status).toBe("pending");

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
      status: "matched",
    });
    expect(
      reduceKeyboardCommandState(
        pending.state,
        catalog,
        ["goInbox", "goSettings"],
        { code: "KeyZ" },
      ),
    ).toEqual({
      consumeEvent: false,
      reason: "unmatched",
      state: { mode: "normal", pending: null },
      status: "ignored",
    });
  });

  it("separates capture commands from contextual bubble fallback", () => {
    const pending = reduceKeyboardCommandState(
      makeKeyboardCommandState<CommandId>(),
      catalog,
      ["goInbox", "next"],
      { code: "KeyG" },
      "capture",
    );
    expect(pending.status).toBe("pending");

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
      status: "ignored",
    });
    expect(
      reduceKeyboardCommandState(
        invalidContinuation.state,
        catalog,
        ["goInbox", "next"],
        { code: "KeyJ" },
        "bubble",
      ),
    ).toMatchObject({ commandId: "next", status: "matched" });
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
      consumeEvent: true,
      reason: "cancelled",
      state: { mode: "normal", pending: null },
      status: "consume",
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
      ).toMatchObject({ commandId: "palette", status: "matched" });
    }
    expect(
      reduceKeyboardCommandState(
        makeKeyboardCommandState<CommandId>(),
        catalog,
        ["palette"],
        { code: "KeyK", controlKey: true },
      ),
    ).toMatchObject({ status: "ignored" });
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
      status: "matched",
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
    ).toMatchObject({ commandId: "next", status: "matched" });
    expect(
      reduceKeyboardCommandState(
        makeKeyboardCommandState<CommandId>(),
        catalog,
        ["once"],
        { code: "KeyX", repeat: true },
      ),
    ).toMatchObject({ reason: "repeat", status: "ignored" });

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
      consumeEvent: false,
      reason: "repeat",
      state: pending.state,
      status: "ignored",
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

    expect(controller.dispatch({ code: "KeyG" }, "capture").status).toBe(
      "pending",
    );
    const result = controller.dispatch({ code: "KeyI" }, "capture");
    seen.push("returned");

    expect(result).toMatchObject({
      commandId: "goInbox",
      consumeEvent: true,
      scopeId: "root",
      status: "matched",
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
      status: "matched",
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
      status: "matched",
    });
    expect(calls).toEqual(["high", "pass", "root"]);

    expect(controller.dispatch({ code: "KeyJ" }, "bubble")).toMatchObject({
      status: "ignored",
    });
  });

  it("routes contextual commands only from the bubble adapter", () => {
    const controller = createKeyboardCommandController({ catalog });
    const bubble = vi.fn(() => "handled" as const);
    registerAll(controller, { next: bubble });

    expect(controller.dispatch({ code: "KeyJ" }, "capture")).toMatchObject({
      status: "ignored",
    });
    expect(bubble).not.toHaveBeenCalled();
    expect(controller.dispatch({ code: "KeyJ" }, "bubble")).toMatchObject({
      commandId: "next",
      scopeId: "root",
      status: "matched",
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
      status: "matched",
    });
    controller.updateScope(high, {
      fallthrough: false,
      handlers: { once: { isAvailable: () => false, run: vi.fn() } },
      id: "panel",
      priority: 10,
    });
    expect(controller.dispatch({ code: "KeyX" }, "capture")).toMatchObject({
      reason: "unmatched",
      status: "ignored",
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
      consumeEvent: false,
      reason: "unmatched",
      status: "ignored",
    });
    expect(controller.snapshot.value.pending).toBeNull();
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
    expect(controller.dispatch({ code: "KeyX" }, "capture").status).toBe(
      "ignored",
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

    expect(controller.dispatch({ code: "KeyX" }, "capture").status).toBe(
      "ignored",
    );
    expect(controller.dispatch({ code: "KeyY" }, "capture")).toMatchObject({
      commandId: "once",
      scopeId: "root",
      status: "matched",
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
    expect(controller.dispatch({ code: "KeyG" }, "capture").status).toBe(
      "pending",
    );

    controller.setCatalog(createKeyboardCommandCatalog([
      {
        bindings: [{ kind: "plain", sequence: ["KeyG", "KeyS"] }],
        id: "goInbox",
        phase: "capture",
      },
    ]));

    expect(controller.snapshot.value.pending).toBeNull();
    expect(controller.dispatch({ code: "KeyI" }, "capture").status).toBe(
      "ignored",
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
    ).toMatchObject({ status: "ignored" });
    expect(
      controller.dispatch({ code: "KeyK", metaKey: true }, "capture"),
    ).toMatchObject({ commandId: "everyMode", status: "matched" });
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
      status: "ignored",
    });
  });

  it("keeps plain normal commands out of insert mode while allowing explicit bindings", () => {
    const controller = createKeyboardCommandController({ catalog });
    registerAll(controller);
    controller.setMode("insert");

    expect(controller.dispatch({ code: "KeyJ" }, "bubble").status).toBe(
      "ignored",
    );
    expect(
      controller.dispatch({ code: "KeyK", metaKey: true }, "capture"),
    ).toMatchObject({ commandId: "palette", status: "matched" });
    expect(controller.dispatch({ code: "Escape" }, "bubble")).toMatchObject({
      commandId: "exitInsert",
      status: "matched",
    });
    expect(controller.snapshot.value).toEqual({
      mode: "insert",
      pending: null,
    });
  });
});
