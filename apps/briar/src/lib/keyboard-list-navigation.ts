import {
  hasOpenKeyboardShortcutOverlay,
  isKeyboardShortcutEditableTarget,
  keyboardShortcutEventIsComposing,
} from "./keyboard-shortcuts";

const keyboardListSelector = "[data-keyboard-list]";
const keyboardListItemSelector = "[data-keyboard-list-item]";
const mainSelector = 'main, [role="main"]';

export type KeyboardListNavigationRoot = Document | HTMLElement;

export type KeyboardListNavigationOptions = {
  /** Resolve a particular list when the page contains more than one candidate. */
  readonly getContainer?: () => HTMLElement | null;
  /** Read at keydown time so preference changes do not require reinstalling. */
  readonly getDisabled?: () => boolean;
  /** Read at keydown time so a remote session can temporarily own the keyboard. */
  readonly getRemoteKeyboardCaptured?: () => boolean;
  /** Limits automatic container discovery and owns the installed listener. */
  readonly root?: KeyboardListNavigationRoot;
};

function ownerDocument(root: KeyboardListNavigationRoot): Document {
  return root instanceof Document ? root : root.ownerDocument;
}

function rootForEvent(
  event: KeyboardEvent,
  configuredRoot: KeyboardListNavigationRoot | undefined,
): KeyboardListNavigationRoot | null {
  if (configuredRoot) return configuredRoot;
  if (event.target instanceof Node && event.target.ownerDocument) {
    return event.target.ownerDocument;
  }
  return typeof document === "undefined" ? null : document;
}

function isElementVisible(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  let current: HTMLElement | null = element;

  while (current) {
    if (
      current.hidden ||
      current.hasAttribute("inert") ||
      current.getAttribute("aria-hidden") === "true" ||
      current.getAttribute("data-state") === "closed"
    ) {
      return false;
    }

    if (current.localName === "dialog" && !current.hasAttribute("open")) {
      return false;
    }

    if (view) {
      const style = view.getComputedStyle(current);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.contentVisibility === "hidden"
      ) {
        return false;
      }
    }

    current = current.parentElement;
  }

  return true;
}

/** Returns rendered items belonging to this list, excluding items in nested lists. */
export function getVisibleKeyboardListItems(
  container: HTMLElement,
): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(keyboardListItemSelector)]
    .filter(
      (item) =>
        item.closest(keyboardListSelector) === container &&
        isElementVisible(item),
    );
}

function visibleKeyboardListContainers(
  root: KeyboardListNavigationRoot,
): readonly HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(keyboardListSelector)]
    .filter(isElementVisible);
}

function closestVisibleMain(
  activeElement: Element | null,
): HTMLElement | null {
  const main = activeElement?.closest<HTMLElement>(mainSelector) ?? null;
  return main && isElementVisible(main) ? main : null;
}

function resolveContainer(
  root: KeyboardListNavigationRoot,
  getContainer: KeyboardListNavigationOptions["getContainer"],
): HTMLElement | null {
  if (getContainer) {
    const explicitContainer = getContainer();
    return explicitContainer && isElementVisible(explicitContainer)
      ? explicitContainer
      : null;
  }

  const containers = visibleKeyboardListContainers(root);
  if (containers.length === 0) return null;

  const activeElement = ownerDocument(root).activeElement;
  const activeContainer = activeElement?.closest<HTMLElement>(
    keyboardListSelector,
  );
  if (activeContainer && containers.includes(activeContainer)) {
    return activeContainer;
  }

  const activeMain = closestVisibleMain(activeElement);
  if (activeMain) {
    const activeMainContainer = containers.find((container) =>
      activeMain.contains(container)
    );
    if (activeMainContainer) return activeMainContainer;
  }

  const visibleMains = [...root.querySelectorAll<HTMLElement>(mainSelector)]
    .filter(isElementVisible);
  for (const main of visibleMains) {
    const container = containers.find((candidate) => main.contains(candidate));
    if (container) return container;
  }

  return containers.length === 1 ? containers[0] : null;
}

function eventKeyIs(event: KeyboardEvent, key: string, code: string): boolean {
  return event.code === code || event.key.toLowerCase() === key;
}

function isPotentialNavigationKey(event: KeyboardEvent): boolean {
  return (
    eventKeyIs(event, "j", "KeyJ") ||
    eventKeyIs(event, "k", "KeyK") ||
    eventKeyIs(event, "h", "KeyH") ||
    eventKeyIs(event, "l", "KeyL") ||
    event.key === "ArrowUp" ||
    event.key === "ArrowDown" ||
    event.key === "ArrowLeft" ||
    event.key === "ArrowRight"
  );
}

function navigationDirection(
  event: KeyboardEvent,
  container: HTMLElement,
): -1 | 1 | null {
  const horizontal =
    container.getAttribute("data-keyboard-list-axis") === "horizontal";

  if (horizontal) {
    if (eventKeyIs(event, "h", "KeyH") || event.key === "ArrowLeft") {
      return -1;
    }
    if (eventKeyIs(event, "l", "KeyL") || event.key === "ArrowRight") {
      return 1;
    }
    return null;
  }

  if (eventKeyIs(event, "k", "KeyK") || event.key === "ArrowUp") {
    return -1;
  }
  if (eventKeyIs(event, "j", "KeyJ") || event.key === "ArrowDown") {
    return 1;
  }
  return null;
}

function hasUnsupportedModifier(event: KeyboardEvent): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}

function shouldIgnoreEvent(
  event: KeyboardEvent,
  options: KeyboardListNavigationOptions,
  document: Document,
): boolean {
  return (
    event.defaultPrevented ||
    event.repeat ||
    keyboardShortcutEventIsComposing(event) ||
    hasUnsupportedModifier(event) ||
    isKeyboardShortcutEditableTarget(event.target) ||
    hasOpenKeyboardShortcutOverlay(document) ||
    options.getDisabled?.() === true ||
    options.getRemoteKeyboardCaptured?.() === true
  );
}

/**
 * Moves focus for one keydown. The return value reports whether the event was
 * consumed; ignored and inapplicable keys are left untouched.
 */
export function handleKeyboardListNavigation(
  event: KeyboardEvent,
  options: KeyboardListNavigationOptions = {},
): boolean {
  if (!isPotentialNavigationKey(event)) return false;

  const root = rootForEvent(event, options.root);
  if (!root) return false;
  const document = ownerDocument(root);
  if (shouldIgnoreEvent(event, options, document)) return false;

  const container = resolveContainer(root, options.getContainer);
  if (!container) return false;
  const direction = navigationDirection(event, container);
  if (!direction) return false;

  const items = getVisibleKeyboardListItems(container);
  if (items.length === 0) return false;

  const activeItem = document.activeElement?.closest<HTMLElement>(
    keyboardListItemSelector,
  );
  const currentIndex = activeItem && activeItem.closest(keyboardListSelector) === container
    ? items.indexOf(activeItem)
    : -1;
  const nextIndex = currentIndex < 0
    ? direction > 0 ? 0 : items.length - 1
    : Math.min(items.length - 1, Math.max(0, currentIndex + direction));
  const nextItem = items[nextIndex];
  if (!nextItem) return false;

  nextItem.focus({ preventScroll: true });
  nextItem.scrollIntoView({ block: "nearest" });
  event.preventDefault();
  return true;
}

/** Installs list navigation and returns an idempotent cleanup function. */
export function installKeyboardListNavigation(
  options: KeyboardListNavigationOptions = {},
): () => void {
  const root = options.root ??
    (typeof document === "undefined" ? null : document);
  if (!root) return () => {};

  const onKeyDown = (event: Event) => {
    if (event instanceof KeyboardEvent) {
      handleKeyboardListNavigation(event, { ...options, root });
    }
  };
  root.addEventListener("keydown", onKeyDown);

  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    root.removeEventListener("keydown", onKeyDown);
  };
}
