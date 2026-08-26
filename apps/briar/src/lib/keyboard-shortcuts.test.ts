/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  advanceKeyboardShortcut,
  hasOpenKeyboardShortcutOverlay,
  idleKeyboardShortcutState,
  isKeyboardShortcutEditableTarget,
  keyboardShortcutSequenceTimeoutMs,
  normalizeKeyboardShortcutToken,
  shouldIgnoreKeyboardShortcutEvent,
  type KeyboardShortcutCommand,
} from "./keyboard-shortcuts";

const commands = [
  { id: "help", label: "Help", sequence: ["?"] },
  { id: "search", label: "Search", sequence: ["/"] },
  { id: "sidebar-toggle", label: "Toggle sidebar", sequence: ["["] },
  { id: "go-inbox", label: "Go to inbox", sequence: ["g", "i"] },
  { id: "go-project", label: "Go to project", sequence: ["g", "p"] },
  {
    disabled: true,
    id: "go-disabled",
    label: "Disabled destination",
    sequence: ["g", "d"],
  },
] as const satisfies readonly KeyboardShortcutCommand[];

function keyboardEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", { bubbles: true, ...init });
}

describe("keyboard shortcuts", () => {
  it("matches a single-key command and consumes its event", () => {
    const result = advanceKeyboardShortcut(
      idleKeyboardShortcutState,
      commands,
      keyboardEvent({ code: "Slash", key: "/" }),
    );

    expect(result).toEqual({
      commandId: "search",
      consumeEvent: true,
      state: idleKeyboardShortcutState,
      status: "matched",
    });
  });

  it("enters a prefix state with only enabled candidate ids", () => {
    const result = advanceKeyboardShortcut(
      idleKeyboardShortcutState,
      commands,
      keyboardEvent({ code: "KeyG", key: "g" }),
    );

    expect(result).toEqual({
      consumeEvent: true,
      state: {
        candidateIds: ["go-inbox", "go-project"],
        prefix: ["g"],
        status: "pending",
      },
      status: "pending",
    });
    expect(keyboardShortcutSequenceTimeoutMs).toBe(1_500);
  });

  it("matches the second key against the pending candidates", () => {
    const pending = advanceKeyboardShortcut(
      idleKeyboardShortcutState,
      commands,
      keyboardEvent({ code: "KeyG", key: "g" }),
    );
    expect(pending.status).toBe("pending");
    if (pending.status !== "pending") return;

    expect(
      advanceKeyboardShortcut(
        pending.state,
        commands,
        keyboardEvent({ code: "KeyI", key: "i" }),
      ),
    ).toEqual({
      commandId: "go-inbox",
      consumeEvent: true,
      state: idleKeyboardShortcutState,
      status: "matched",
    });
  });

  it("cancels an invalid continuation without consuming that second key", () => {
    const pending = advanceKeyboardShortcut(
      idleKeyboardShortcutState,
      commands,
      keyboardEvent({ code: "KeyG", key: "g" }),
    );
    expect(pending.status).toBe("pending");
    if (pending.status !== "pending") return;

    expect(
      advanceKeyboardShortcut(
        pending.state,
        commands,
        keyboardEvent({ code: "KeyX", key: "x" }),
      ),
    ).toEqual({
      consumeEvent: false,
      reason: "invalid",
      state: idleKeyboardShortcutState,
      status: "cancelled",
    });
  });

  it("uses Escape to cancel a pending sequence and consumes the cancellation", () => {
    const pending = advanceKeyboardShortcut(
      idleKeyboardShortcutState,
      commands,
      keyboardEvent({ code: "KeyG", key: "g" }),
    );
    expect(pending.status).toBe("pending");
    if (pending.status !== "pending") return;

    expect(
      advanceKeyboardShortcut(
        pending.state,
        commands,
        keyboardEvent({ code: "Escape", key: "Escape" }),
      ),
    ).toEqual({
      consumeEvent: true,
      reason: "escape",
      state: idleKeyboardShortcutState,
      status: "cancelled",
    });
  });

  it("ignores an unmatched key from the idle state", () => {
    expect(
      advanceKeyboardShortcut(
        idleKeyboardShortcutState,
        commands,
        keyboardEvent({ code: "KeyX", key: "x" }),
      ),
    ).toEqual({
      consumeEvent: false,
      state: idleKeyboardShortcutState,
      status: "ignored",
    });
  });

  it("normalizes letters by physical code rather than localized key value", () => {
    expect(
      normalizeKeyboardShortcutToken(
        keyboardEvent({ code: "KeyA", key: "ㅁ" }),
      ),
    ).toBe("a");
    expect(
      normalizeKeyboardShortcutToken(
        keyboardEvent({ code: "KeyZ", key: "a" }),
      ),
    ).toBe("z");
    expect(
      normalizeKeyboardShortcutToken(
        keyboardEvent({ code: "Digit1", key: "a" }),
      ),
    ).toBeNull();
  });

  it("normalizes and matches physical bracket keys", () => {
    expect(
      normalizeKeyboardShortcutToken(
        keyboardEvent({ code: "BracketLeft", key: "å" }),
      ),
    ).toBe("[");
    expect(
      normalizeKeyboardShortcutToken(
        keyboardEvent({ code: "BracketRight", key: "∂" }),
      ),
    ).toBe("]");
    expect(
      advanceKeyboardShortcut(
        idleKeyboardShortcutState,
        commands,
        keyboardEvent({ code: "BracketLeft", key: "[" }),
      ),
    ).toMatchObject({ commandId: "sidebar-toggle", status: "matched" });
  });

  it("distinguishes slash and question mark on the Slash code", () => {
    expect(
      normalizeKeyboardShortcutToken(
        keyboardEvent({ code: "Slash", key: "/" }),
      ),
    ).toBe("/");
    expect(
      normalizeKeyboardShortcutToken(
        keyboardEvent({ code: "Slash", key: "?", shiftKey: true }),
      ),
    ).toBe("?");
    expect(
      advanceKeyboardShortcut(
        idleKeyboardShortcutState,
        commands,
        keyboardEvent({ code: "Slash", key: "?", shiftKey: true }),
      ),
    ).toMatchObject({ commandId: "help", status: "matched" });
  });

  it.each(["input", "textarea", "select"])(
    "recognizes %s and its descendants as editable targets",
    (tagName) => {
      const element = document.createElement(tagName);
      const target = tagName === "select"
        ? element
        : element.appendChild(document.createElement("span"));
      expect(isKeyboardShortcutEditableTarget(target)).toBe(true);
    },
  );

  it("recognizes contenteditable and textbox-like roles", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "plaintext-only");
    expect(
      isKeyboardShortcutEditableTarget(
        editable.appendChild(document.createElement("span")),
      ),
    ).toBe(true);

    const notEditable = document.createElement("div");
    notEditable.setAttribute("contenteditable", "false");
    expect(isKeyboardShortcutEditableTarget(notEditable)).toBe(false);

    for (const role of ["textbox", "combobox"]) {
      const control = document.createElement("div");
      control.setAttribute("role", role);
      expect(
        isKeyboardShortcutEditableTarget(
          control.appendChild(document.createElement("span")),
        ),
      ).toBe(true);
    }
  });

  it("distinguishes select-only combobox buttons from editable comboboxes", () => {
    const trigger = document.createElement("button");
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-expanded", "false");
    const triggerLabel = trigger.appendChild(document.createElement("span"));
    document.body.append(trigger);

    expect(isKeyboardShortcutEditableTarget(triggerLabel)).toBe(false);

    trigger.setAttribute("aria-expanded", "true");
    expect(isKeyboardShortcutEditableTarget(triggerLabel)).toBe(true);

    const editable = document.createElement("div");
    editable.setAttribute("role", "combobox");
    document.body.append(editable);
    expect(isKeyboardShortcutEditableTarget(editable)).toBe(true);

    trigger.remove();
    editable.remove();
  });

  it("ignores events dispatched from editable targets", () => {
    const input = document.createElement("input");
    input.addEventListener("keydown", (event) => {
      expect(shouldIgnoreKeyboardShortcutEvent(event)).toBe(true);
      expect(
        advanceKeyboardShortcut(idleKeyboardShortcutState, commands, event),
      ).toMatchObject({ consumeEvent: false, status: "ignored" });
    });
    input.dispatchEvent(keyboardEvent({ code: "KeyG", key: "g" }));
  });

  it("detects open menus, listboxes, dialogs, and modal elements", () => {
    for (const role of ["menu", "listbox", "dialog"]) {
      const overlay = document.createElement("div");
      overlay.setAttribute("role", role);
      document.body.append(overlay);
      expect(hasOpenKeyboardShortcutOverlay(document)).toBe(true);
      overlay.remove();
    }

    const dialog = document.createElement("dialog");
    document.body.append(dialog);
    expect(hasOpenKeyboardShortcutOverlay(document)).toBe(false);
    dialog.setAttribute("open", "");
    expect(hasOpenKeyboardShortcutOverlay(document)).toBe(true);
    dialog.remove();

    const modal = document.createElement("section");
    modal.setAttribute("aria-modal", "true");
    document.body.append(modal);
    expect(hasOpenKeyboardShortcutOverlay(document)).toBe(true);
    modal.remove();
  });

  it("does not treat explicitly closed or hidden overlays as open", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.setAttribute("data-state", "closed");
    document.body.append(menu);
    expect(hasOpenKeyboardShortcutOverlay(document)).toBe(false);

    menu.removeAttribute("data-state");
    menu.hidden = true;
    expect(hasOpenKeyboardShortcutOverlay(document)).toBe(false);
    menu.remove();
  });

  it("ignores prevented, repeated, composing, and modified events", () => {
    const prevented = keyboardEvent({
      cancelable: true,
      code: "KeyG",
      key: "g",
    });
    prevented.preventDefault();

    const legacyComposition = keyboardEvent({ code: "KeyG", key: "g" });
    Object.defineProperty(legacyComposition, "keyCode", { value: 229 });

    const ignoredEvents = [
      prevented,
      keyboardEvent({ code: "KeyG", key: "g", repeat: true }),
      keyboardEvent({ code: "KeyG", isComposing: true, key: "g" }),
      legacyComposition,
      keyboardEvent({ code: "KeyG", ctrlKey: true, key: "g" }),
      keyboardEvent({ code: "KeyG", key: "g", metaKey: true }),
      keyboardEvent({ altKey: true, code: "KeyG", key: "g" }),
      keyboardEvent({ code: "KeyG", key: "G", shiftKey: true }),
    ];

    for (const event of ignoredEvents) {
      expect(shouldIgnoreKeyboardShortcutEvent(event)).toBe(true);
    }
    expect(
      shouldIgnoreKeyboardShortcutEvent(
        keyboardEvent({ code: "Slash", key: "?", shiftKey: true }),
      ),
    ).toBe(false);
  });

  it("lets callers suppress shortcuts for overlays, recording, and remotes", () => {
    const event = keyboardEvent({ code: "KeyG", key: "g" });

    expect(
      shouldIgnoreKeyboardShortcutEvent(event, { hasOpenOverlay: true }),
    ).toBe(true);
    expect(
      shouldIgnoreKeyboardShortcutEvent(event, { isRecording: true }),
    ).toBe(true);
    expect(
      shouldIgnoreKeyboardShortcutEvent(event, {
        remoteKeyboardCaptured: true,
      }),
    ).toBe(true);
    expect(shouldIgnoreKeyboardShortcutEvent(event)).toBe(false);
  });
});
