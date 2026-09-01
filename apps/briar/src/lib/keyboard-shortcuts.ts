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

function eventTargetElement(
  target: EventTarget | null | undefined,
): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

export function isKeyboardShortcutEditableTarget(
  target: EventTarget | null | undefined,
): boolean {
  const element = eventTargetElement(target);
  if (!element) return false;
  if (element.closest("input,select,textarea")) return true;
  if (element.closest('[role="textbox"]')) return true;

  const combobox = element.closest('[role="combobox"]');
  if (
    combobox &&
    !(
      combobox.localName === "button" &&
      combobox.getAttribute("aria-expanded") !== "true"
    )
  ) {
    return true;
  }

  const contentEditable = element.closest("[contenteditable]");
  if (!contentEditable) return false;
  return contentEditable.getAttribute("contenteditable") !== "false";
}

export function isKeyboardShortcutEditableEvent(event: Event): boolean {
  const path = event.composedPath();
  return path.length > 0
    ? path.some(isKeyboardShortcutEditableTarget)
    : isKeyboardShortcutEditableTarget(event.target);
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
