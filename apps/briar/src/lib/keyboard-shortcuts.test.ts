/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import {
  hasOpenKeyboardShortcutOverlay,
  isKeyboardShortcutEditableTarget,
  keyboardShortcutEventIsComposing,
} from "./keyboard-shortcuts";

describe("keyboard shortcut DOM guards", () => {
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

  it("detects only open Briar overlays", () => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-briar-dialog-overlay", "");
    overlay.setAttribute("data-state", "closed");
    document.body.append(overlay);
    expect(hasOpenKeyboardShortcutOverlay(document)).toBe(false);

    overlay.setAttribute("data-state", "open");
    expect(hasOpenKeyboardShortcutOverlay(document)).toBe(true);
    overlay.remove();
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

  it("recognizes standard and WebKit composition events", () => {
    const composing = new KeyboardEvent("keydown", { isComposing: true });
    expect(keyboardShortcutEventIsComposing(composing)).toBe(true);

    const legacyComposition = new KeyboardEvent("keydown");
    Object.defineProperty(legacyComposition, "keyCode", { value: 229 });
    expect(keyboardShortcutEventIsComposing(legacyComposition)).toBe(true);

    expect(keyboardShortcutEventIsComposing(new KeyboardEvent("keydown")))
      .toBe(false);
  });
});
