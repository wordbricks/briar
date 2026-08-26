/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getVisibleKeyboardListItems,
  handleKeyboardListNavigation,
  installKeyboardListNavigation,
  type KeyboardListNavigationOptions,
} from "./keyboard-list-navigation";

type ListFixture = {
  container: HTMLElement;
  items: HTMLButtonElement[];
  scrollSpies: ReturnType<typeof vi.fn>[];
};

function createList(
  labels: readonly string[] = ["one", "two", "three"],
  parent: HTMLElement = document.body,
): ListFixture {
  const container = document.createElement("section");
  container.setAttribute("data-keyboard-list", "");
  const items = labels.map((label) => {
    const item = document.createElement("button");
    item.setAttribute("data-keyboard-list-item", "");
    item.textContent = label;
    container.append(item);
    return item;
  });
  const scrollSpies = items.map((item) => {
    const spy = vi.fn();
    item.scrollIntoView = spy;
    return spy;
  });
  parent.append(container);
  return { container, items, scrollSpies };
}

function keydown(
  init: KeyboardEventInit,
  target: HTMLElement = document.body,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function handle(
  init: KeyboardEventInit,
  options: KeyboardListNavigationOptions = {},
  target: HTMLElement = document.body,
) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, "target", { configurable: true, value: target });
  return {
    event,
    handled: handleKeyboardListNavigation(event, options),
  };
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-briar-remote-desktop-active");
  vi.restoreAllMocks();
});

describe("keyboard list navigation", () => {
  it.each([
    { code: "KeyJ", key: "j" },
    { code: "ArrowDown", key: "ArrowDown" },
  ])("focuses the first item for an initial forward $key", (init) => {
    const { items, scrollSpies } = createList();
    const focus = vi.spyOn(items[0], "focus");

    const { event, handled } = handle(init);

    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(items[0]);
    expect(scrollSpies[0]).toHaveBeenCalledWith({ block: "nearest" });
  });

  it.each([
    { code: "KeyK", key: "k" },
    { code: "ArrowUp", key: "ArrowUp" },
  ])("focuses the last item for an initial backward $key", (init) => {
    const { items } = createList();

    expect(handle(init).handled).toBe(true);
    expect(document.activeElement).toBe(items[2]);
  });

  it("moves relative to the item containing the active element", () => {
    const { items } = createList();
    const nestedControl = document.createElement("button");
    items[1].replaceWith(document.createElement("div"));
    const middle = document.createElement("div");
    middle.tabIndex = -1;
    middle.setAttribute("data-keyboard-list-item", "");
    middle.append(nestedControl);
    items[0].after(middle);
    middle.scrollIntoView = vi.fn();
    nestedControl.focus();

    expect(handle({ code: "KeyJ", key: "j" }, {}, nestedControl).handled)
      .toBe(true);
    expect(document.activeElement).toBe(items[2]);

    expect(handle({ code: "KeyK", key: "k" }, {}, items[2]).handled)
      .toBe(true);
    expect(document.activeElement).toBe(middle);
  });

  it("clamps at both boundaries instead of wrapping", () => {
    const { items, scrollSpies } = createList();
    const firstFocus = vi.spyOn(items[0], "focus");
    const lastFocus = vi.spyOn(items[2], "focus");

    items[0].focus();
    firstFocus.mockClear();
    const backward = handle({ code: "KeyK", key: "k" }, {}, items[0]);
    expect(backward.handled).toBe(true);
    expect(backward.event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[0]);
    expect(firstFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollSpies[0]).toHaveBeenCalledWith({ block: "nearest" });

    items[2].focus();
    lastFocus.mockClear();
    const forward = handle({ code: "KeyJ", key: "j" }, {}, items[2]);
    expect(forward.handled).toBe(true);
    expect(document.activeElement).toBe(items[2]);
    expect(lastFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollSpies[2]).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("skips hidden, aria-hidden, inert, closed, and CSS-hidden items", () => {
    const { container, items } = createList([
      "hidden",
      "aria",
      "inert",
      "closed",
      "display",
      "visibility",
      "visible",
    ]);
    items[0].hidden = true;
    items[1].setAttribute("aria-hidden", "true");
    items[2].setAttribute("inert", "");
    items[3].setAttribute("data-state", "closed");
    items[4].style.display = "none";
    items[5].style.visibility = "hidden";

    expect(getVisibleKeyboardListItems(container)).toEqual([items[6]]);
    expect(handle({ code: "KeyJ", key: "j" }).handled).toBe(true);
    expect(document.activeElement).toBe(items[6]);
  });

  it("skips an item whose ancestor is hidden", () => {
    const { container, items } = createList(["visible"]);
    const hiddenGroup = document.createElement("div");
    hiddenGroup.hidden = true;
    const hiddenItem = document.createElement("button");
    hiddenItem.setAttribute("data-keyboard-list-item", "");
    hiddenGroup.append(hiddenItem);
    container.prepend(hiddenGroup);

    expect(getVisibleKeyboardListItems(container)).toEqual(items);
  });

  it("does not include items owned by a nested keyboard list", () => {
    const outer = createList(["outer"]);
    const nested = createList(["nested"], outer.container);

    expect(getVisibleKeyboardListItems(outer.container)).toEqual(outer.items);
    expect(getVisibleKeyboardListItems(nested.container)).toEqual(nested.items);
  });

  it.each([
    { code: "Enter", key: "Enter" },
    { code: "Space", key: " " },
    { code: "KeyX", key: "x" },
  ])("leaves the unrelated $key key untouched", (init) => {
    createList();
    const { event, handled } = handle(init);
    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not consume navigation when the selected list is empty", () => {
    createList([]);
    const { event, handled } = handle({ code: "KeyJ", key: "j" });
    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it.each(["input", "textarea", "select"])(
    "ignores events from %s descendants",
    (tagName) => {
      createList();
      const editable = document.createElement(tagName);
      const target = tagName === "select"
        ? editable
        : editable.appendChild(document.createElement("span"));
      document.body.append(editable);

      const { event, handled } = handle(
        { code: "KeyJ", key: "j" },
        {},
        target,
      );
      expect(handled).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    },
  );

  it.each([
    ["contenteditable", "plaintext-only"],
    ["role", "textbox"],
    ["role", "combobox"],
  ])("ignores descendants of [%s=%s]", (attribute, value) => {
    createList();
    const editable = document.createElement("div");
    editable.setAttribute(attribute, value);
    const target = editable.appendChild(document.createElement("span"));
    document.body.append(editable);

    expect(
      handle({ code: "KeyJ", key: "j" }, {}, target).handled,
    ).toBe(false);
  });

  it("allows contenteditable=false targets", () => {
    const { items } = createList();
    const target = document.createElement("div");
    target.setAttribute("contenteditable", "false");
    document.body.append(target);

    expect(handle({ code: "KeyJ", key: "j" }, {}, target).handled).toBe(true);
    expect(document.activeElement).toBe(items[0]);
  });

  it("ignores prevented, repeated, composing, legacy IME, and modified events", () => {
    createList();
    const prevented = new KeyboardEvent("keydown", {
      cancelable: true,
      code: "KeyJ",
      key: "j",
    });
    prevented.preventDefault();
    const legacyIme = new KeyboardEvent("keydown", { code: "KeyJ", key: "j" });
    Object.defineProperty(legacyIme, "keyCode", { value: 229 });

    const events = [
      prevented,
      new KeyboardEvent("keydown", { code: "KeyJ", key: "j", repeat: true }),
      new KeyboardEvent("keydown", {
        code: "KeyJ",
        isComposing: true,
        key: "j",
      }),
      legacyIme,
      new KeyboardEvent("keydown", { altKey: true, code: "KeyJ", key: "j" }),
      new KeyboardEvent("keydown", { code: "KeyJ", ctrlKey: true, key: "j" }),
      new KeyboardEvent("keydown", { code: "KeyJ", key: "j", metaKey: true }),
      new KeyboardEvent("keydown", { code: "KeyJ", key: "J", shiftKey: true }),
    ];

    for (const event of events) {
      expect(handleKeyboardListNavigation(event)).toBe(false);
    }
    expect(document.activeElement).toBe(document.body);
  });

  it.each([
    ["menu", "div", false],
    ["listbox", "div", false],
    ["dialog", "dialog", true],
  ] as const)("pauses while an open %s is present", (role, tag, open) => {
    createList();
    const overlay = document.createElement(tag);
    if (tag !== "dialog") overlay.setAttribute("role", role);
    if (open) overlay.setAttribute("open", "");
    document.body.append(overlay);

    const result = handle({ code: "KeyJ", key: "j" });
    expect(result.handled).toBe(false);
    expect(result.event.defaultPrevented).toBe(false);
  });

  it("does not pause for a closed or hidden overlay", () => {
    const { items } = createList();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.setAttribute("data-state", "closed");
    document.body.append(menu);

    expect(handle({ code: "KeyJ", key: "j" }).handled).toBe(true);
    expect(document.activeElement).toBe(items[0]);
  });

  it("reads disabled and remote-capture getters for every keydown", () => {
    const { items } = createList();
    let disabled = true;
    let remoteCaptured = false;
    const options = {
      getDisabled: () => disabled,
      getRemoteKeyboardCaptured: () => remoteCaptured,
    };

    expect(handle({ code: "KeyJ", key: "j" }, options).handled).toBe(false);
    disabled = false;
    remoteCaptured = true;
    expect(handle({ code: "KeyJ", key: "j" }, options).handled).toBe(false);
    remoteCaptured = false;
    expect(handle({ code: "KeyJ", key: "j" }, options).handled).toBe(true);
    expect(document.activeElement).toBe(items[0]);
  });

  it("prefers the list containing the active element", () => {
    const first = createList(["first"]);
    const second = createList(["second-a", "second-b"]);
    second.items[0].focus();

    expect(
      handle({ code: "KeyJ", key: "j" }, {}, second.items[0]).handled,
    ).toBe(true);
    expect(document.activeElement).toBe(second.items[1]);
    expect(first.scrollSpies[0]).not.toHaveBeenCalled();
  });

  it("selects a list in the visible main when several lists exist", () => {
    const sidebar = createList(["sidebar"]);
    const hiddenMain = document.createElement("main");
    hiddenMain.hidden = true;
    document.body.append(hiddenMain);
    createList(["hidden-main"], hiddenMain);
    const visibleMain = document.createElement("main");
    document.body.append(visibleMain);
    const content = createList(["content"], visibleMain);

    expect(handle({ code: "KeyJ", key: "j" }).handled).toBe(true);
    expect(document.activeElement).toBe(content.items[0]);
    expect(sidebar.scrollSpies[0]).not.toHaveBeenCalled();
  });

  it("uses an explicit container and ignores all other candidates", () => {
    const first = createList(["first"]);
    const second = createList(["second"]);

    expect(
      handle(
        { code: "KeyJ", key: "j" },
        { getContainer: () => second.container },
      ).handled,
    ).toBe(true);
    expect(document.activeElement).toBe(second.items[0]);
    expect(first.scrollSpies[0]).not.toHaveBeenCalled();
  });

  it("does nothing when multiple lists are ambiguous outside a main", () => {
    createList(["first"]);
    createList(["second"]);

    const result = handle({ code: "KeyJ", key: "j" });
    expect(result.handled).toBe(false);
    expect(result.event.defaultPrevented).toBe(false);
  });

  it.each([
    [{ code: "KeyL", key: "l" }, 0],
    [{ code: "ArrowRight", key: "ArrowRight" }, 0],
    [{ code: "KeyH", key: "h" }, 2],
    [{ code: "ArrowLeft", key: "ArrowLeft" }, 2],
  ] as const)("supports horizontal navigation with $0.key", (init, index) => {
    const { container, items } = createList();
    container.setAttribute("data-keyboard-list-axis", "horizontal");

    expect(handle(init).handled).toBe(true);
    expect(document.activeElement).toBe(items[index]);
  });

  it("does not apply vertical keys to a horizontal list", () => {
    const { container } = createList();
    container.setAttribute("data-keyboard-list-axis", "horizontal");

    const result = handle({ code: "KeyJ", key: "j" });
    expect(result.handled).toBe(false);
    expect(result.event.defaultPrevented).toBe(false);
  });

  it("installs a keydown listener, reads live options, and cleans it up", () => {
    const { items } = createList();
    let disabled = true;
    const cleanup = installKeyboardListNavigation({
      getDisabled: () => disabled,
    });

    const ignored = keydown({ code: "KeyJ", key: "j" });
    expect(ignored.defaultPrevented).toBe(false);
    disabled = false;
    const handled = keydown({ code: "KeyJ", key: "j" });
    expect(handled.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[0]);

    cleanup();
    cleanup();
    const afterCleanup = keydown({ code: "KeyK", key: "k" });
    expect(afterCleanup.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(items[0]);
  });

  it("can install on an element root without selecting outside lists", () => {
    const scope = document.createElement("div");
    document.body.append(scope);
    const inside = createList(["inside"], scope);
    const outside = createList(["outside"]);
    const cleanup = installKeyboardListNavigation({ root: scope });

    const event = keydown({ code: "KeyJ", key: "j" }, scope);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(inside.items[0]);
    expect(outside.scrollSpies[0]).not.toHaveBeenCalled();
    cleanup();
  });
});
